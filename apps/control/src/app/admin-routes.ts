import { mkdir, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type {
	AdminActionResponse,
	WorkspaceId,
} from "@frc-coderunner/contracts";
import { queryAuditLog, recordAuditEvent } from "../audit";
import { requireAdmin } from "../auth/middleware";
import type { CatalogSource } from "../catalog";
import { getLogger } from "../logging";
import type { RunManager } from "../runs";
import type { WorkspaceRuntimeProvider } from "../runtime";
import type { AppStorage } from "../storage";
import {
	createProjectArchive,
	directorySizeBytes,
	restoreProjectArchive,
} from "./archive-utils";
import { isInsideDirectory, webAssetResponse } from "./assets";
import { apiErrorResponse, jsonResponse, notFound } from "./responses";
import { adminStatusResponse, auditActor } from "./status";

const log = getLogger("admin");

export type AdminRouteContext = {
	storage: AppStorage;
	runs: RunManager;
	runtimeProvider: WorkspaceRuntimeProvider;
	catalogSource: CatalogSource;
};

export async function handleAdminRoute(
	ctx: AdminRouteContext,
	url: URL,
	request: Request,
): Promise<Response> {
	const { storage, runs, runtimeProvider, catalogSource } = ctx;
	const adminResult = await requireAdmin(storage, request);
	if (adminResult instanceof Response) {
		return adminResult;
	}
	log.debug("admin route", {
		method: request.method,
		path: url.pathname,
		actor: adminResult.user.id,
	});

	// Serve static assets for the admin SPA
	if (url.pathname.startsWith("/admin/assets/") && request.method === "GET") {
		return webAssetResponse(
			storage,
			`assets/${url.pathname.slice("/admin/assets/".length)}`,
		);
	}

	if (url.pathname === "/admin/status" && request.method === "GET") {
		return jsonResponse(adminStatusResponse(storage, runs));
	}

	if (url.pathname === "/admin/containers/stats" && request.method === "GET") {
		const workspacesById = new Map(
			storage
				.listAllWorkspacesWithLeases()
				.map((entry) => [entry.workspace.id, entry]),
		);
		const stats = await runtimeProvider.listRuntimes();
		return jsonResponse({
			ok: true,
			containers: stats.map((container) => {
				const entry = container.workspaceId
					? workspacesById.get(container.workspaceId as WorkspaceId)
					: undefined;
				const lease = entry?.lease ?? null;
				return {
					...container,
					workspaceSlug: entry?.workspace.slug ?? null,
					ports: {
						nt4: lease?.nt4_port ?? null,
						vscode: lease?.vscode_port ?? null,
						halsim: lease?.halsim_port ?? null,
					},
				};
			}),
		});
	}

	if (
		url.pathname === "/admin/workspaces/disk-usage" &&
		request.method === "GET"
	) {
		const entries = storage.listAllWorkspacesWithLeases();
		const usage = await Promise.all(
			entries.map(async (entry) => ({
				workspaceId: entry.workspace.id,
				workspaceSlug: entry.workspace.slug,
				projectPath: entry.workspace.project_path,
				bytes: await directorySizeBytes(entry.workspace.project_path),
			})),
		);
		return jsonResponse({ ok: true, workspaces: usage });
	}

	const adminWorkspaceMatch = /^\/admin\/workspaces\/([^/]+)\/(.+)$/.exec(
		url.pathname,
	);
	if (adminWorkspaceMatch && request.method === "POST") {
		const targetWorkspaceId = adminWorkspaceMatch[1] ?? "";
		const action = adminWorkspaceMatch[2] ?? "";
		const workspace = storage.findWorkspaceById(
			targetWorkspaceId as WorkspaceId,
		);
		if (!workspace) {
			return jsonResponse({ error: "Workspace not found." }, { status: 404 });
		}

		const actor = auditActor(adminResult);

		try {
			if (action === "restart-code") {
				await runtimeProvider.restartWorkspace(workspace.id);
				recordAuditEvent(storage, {
					actor,
					action: "container.restart-code",
					target: { kind: "workspace", id: workspace.id },
				});
				return jsonResponse({
					ok: true,
					action: "restart-code",
					workspaceId: workspace.id,
					detail: "Code container restarted.",
				} satisfies AdminActionResponse);
			}

			if (action === "stop-containers") {
				await runtimeProvider.stopWorkspace(workspace.id);
				recordAuditEvent(storage, {
					actor,
					action: "container.stop",
					target: { kind: "workspace", id: workspace.id },
				});
				return jsonResponse({
					ok: true,
					action: "stop-containers",
					workspaceId: workspace.id,
					detail: "All containers stopped.",
				} satisfies AdminActionResponse);
			}

			if (action === "backup") {
				const projectDir = workspace.project_path;
				try {
					const s = await stat(projectDir);
					if (!s.isDirectory()) {
						return jsonResponse(
							{ error: "Project directory does not exist." },
							{ status: 404 },
						);
					}
				} catch {
					return jsonResponse(
						{ error: "Project directory does not exist." },
						{ status: 404 },
					);
				}
				const now = new Date();
				const pad = (n: number) => String(n).padStart(2, "0");
				const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
				const backupRoot = resolve(storage.config.dataDir, "backups", ts);
				const workspaceBackupDir = resolve(backupRoot, workspace.id);
				const dest = resolve(workspaceBackupDir, "project.tar.gz");
				await mkdir(workspaceBackupDir, { recursive: true });
				await createProjectArchive(projectDir, dest);
				recordAuditEvent(storage, {
					actor,
					action: "workspace.backup",
					target: { kind: "workspace", id: workspace.id },
					metadata: { dest },
				});
				return jsonResponse({
					ok: true,
					action: "backup",
					workspaceId: workspace.id,
					detail: `Backed up to ${dest}`,
				} satisfies AdminActionResponse);
			}

			if (action === "restore") {
				let body: { path?: string };
				try {
					body = (await request.json()) as { path?: string };
				} catch {
					return jsonResponse(
						{ error: "Request body must be valid JSON." },
						{ status: 400 },
					);
				}
				if (typeof body.path !== "string" || body.path.trim().length === 0) {
					return jsonResponse(
						{ error: "Missing or empty 'path' in request body." },
						{ status: 400 },
					);
				}
				const backupsRoot = resolve(storage.config.dataDir, "backups");
				const sourcePath = resolve(body.path);
				if (!isInsideDirectory(backupsRoot, sourcePath)) {
					return jsonResponse(
						{ error: "Restore path must be under data/backups/." },
						{ status: 403 },
					);
				}
				try {
					const s = await stat(sourcePath);
					if (!s.isFile()) {
						return jsonResponse(
							{ error: "Restore source is not a file." },
							{ status: 404 },
						);
					}
				} catch {
					return jsonResponse(
						{ error: "Restore source not found." },
						{ status: 404 },
					);
				}
				const projectDir = workspace.project_path;
				await mkdir(dirname(projectDir), { recursive: true });
				await restoreProjectArchive(projectDir, sourcePath);
				recordAuditEvent(storage, {
					actor,
					action: "workspace.restore",
					target: { kind: "workspace", id: workspace.id },
					metadata: { source: sourcePath },
				});
				return jsonResponse({
					ok: true,
					action: "restore",
					workspaceId: workspace.id,
					detail: `Restored from ${sourcePath}`,
				} satisfies AdminActionResponse);
			}
		} catch (error) {
			return apiErrorResponse(error, `Admin action ${action} failed.`);
		}
	}

	// --- User management endpoints ---
	if (url.pathname === "/admin/users" && request.method === "GET") {
		const users = storage.db
			.query(
				`
        SELECT
          u.id, u.name, u.email, u.role, u.slug, u.createdAt, u.updatedAt,
          w.id AS workspaceId, w.last_accessed_at AS lastSeenAt
        FROM user u
        LEFT JOIN workspaces w ON w.user_id = u.id
        ORDER BY u.name
      `,
			)
			.all() as Array<{
			id: string;
			name: string;
			email: string;
			role: string | null;
			slug: string | null;
			createdAt: string;
			updatedAt: string;
			workspaceId: string | null;
			lastSeenAt: string | null;
		}>;
		return jsonResponse({ ok: true, users });
	}

	// Role is no longer a local mutable field — it is recomputed on every
	// request from the Legion `mw_sso` cookie's `groups` claim (see
	// legion/session.ts), so there is no promote/demote route: admin access is
	// granted/revoked entirely in Legion's own /admin/groups.

	const userDeleteMatch = /^\/admin\/users\/([^/]+)$/.exec(url.pathname);
	if (userDeleteMatch && request.method === "DELETE") {
		const userId = userDeleteMatch[1] ?? "";
		const user = storage.db
			.query("SELECT id, name, email, role FROM user WHERE id = ?")
			.get(userId) as {
			id: string;
			name: string;
			email: string;
			role: string | null;
		} | null;
		if (!user) {
			return jsonResponse({ error: "User not found." }, { status: 404 });
		}

		// Deleting the local row does not revoke Legion access — the person is
		// lazily re-upserted (with a fresh workspace) on their next login. This
		// only clears their CodeRunner workspace and project files.
		const workspace = storage.findWorkspaceByUserId(userId);
		if (workspace) {
			runs.stopWorkspace(workspace.id);
			await runtimeProvider.stopWorkspace(workspace.id);
			await runtimeProvider.removeWorkspace(workspace.id);
		}

		storage.db.exec("BEGIN");
		try {
			if (workspace) {
				storage.db
					.query("DELETE FROM run_jobs WHERE workspace_id = ?")
					.run(workspace.id);
				storage.db
					.query("DELETE FROM container_leases WHERE workspace_id = ?")
					.run(workspace.id);
				storage.db
					.query("DELETE FROM workspaces WHERE id = ?")
					.run(workspace.id);
			}
			storage.db.query("DELETE FROM user WHERE id = ?").run(userId);
			storage.db.exec("COMMIT");
		} catch (error) {
			storage.db.exec("ROLLBACK");
			throw error;
		}

		if (workspace) {
			await rm(dirname(workspace.project_path), {
				recursive: true,
				force: true,
			});
		}

		recordAuditEvent(storage, {
			actor: auditActor(adminResult),
			action: "workspace.delete",
			target: { kind: "user", id: userId },
			metadata: { email: user.email },
		});

		return jsonResponse({ ok: true, userId });
	}

	// --- Capacity cap runtime override ---
	if (
		url.pathname === "/admin/config/max-active-containers" &&
		request.method === "POST"
	) {
		let body: { value?: unknown };
		try {
			body = (await request.json()) as { value?: unknown };
		} catch {
			return jsonResponse({ error: "Invalid JSON body." }, { status: 400 });
		}
		const value = Number(body.value);
		if (!Number.isInteger(value) || value < 1) {
			return jsonResponse(
				{ error: "value must be a positive integer." },
				{ status: 400 },
			);
		}
		storage.setRuntimeConfig("max_active_containers", String(value));
		const actor = auditActor(adminResult);
		recordAuditEvent(storage, {
			actor,
			action: "config.max-active-containers",
			metadata: { value },
		});
		return jsonResponse({ ok: true, maxActiveContainers: value });
	}

	if (
		url.pathname === "/admin/config/max-active-containers" &&
		request.method === "GET"
	) {
		return jsonResponse({
			ok: true,
			maxActiveContainers: storage.getEffectiveMaxActiveContainers(),
			configDefault: storage.config.maxActiveContainers,
		});
	}

	// --- Audit log ---
	if (url.pathname === "/admin/audit-log" && request.method === "GET") {
		const limit = Number(url.searchParams.get("limit") ?? "100");
		const before = url.searchParams.get("before")
			? Number(url.searchParams.get("before"))
			: undefined;
		const actorEmail = url.searchParams.get("actor") ?? undefined;
		const actionPrefix = url.searchParams.get("action") ?? undefined;
		const days = url.searchParams.get("days")
			? Number(url.searchParams.get("days"))
			: undefined;
		const sinceMs = days ? Date.now() - days * 86_400_000 : undefined;
		const entries = queryAuditLog(storage, {
			limit,
			before,
			actorEmail,
			actionPrefix,
			sinceMs,
		});
		return jsonResponse({ ok: true, entries });
	}

	// --- Lesson/track assignment ---
	if (url.pathname === "/admin/lessons/catalog" && request.method === "GET") {
		const { modules, error } = await catalogSource.getManifest();
		return jsonResponse({ ok: true, modules, error });
	}

	if (
		url.pathname === "/admin/lessons/assignments" &&
		request.method === "GET"
	) {
		return jsonResponse({
			ok: true,
			assignments: storage.listLessonAssignments(),
		});
	}

	if (
		url.pathname === "/admin/lessons/assignments" &&
		request.method === "POST"
	) {
		let body: {
			targetType?: string;
			targetId?: string;
			assigneeType?: string;
			assigneeId?: string;
		};
		try {
			body = (await request.json()) as typeof body;
		} catch {
			return jsonResponse({ error: "Invalid JSON body." }, { status: 400 });
		}
		if (body.targetType !== "module" && body.targetType !== "track") {
			return jsonResponse(
				{ error: "targetType must be 'module' or 'track'." },
				{ status: 400 },
			);
		}
		if (body.assigneeType !== "user" && body.assigneeType !== "group") {
			return jsonResponse(
				{ error: "assigneeType must be 'user' or 'group'." },
				{ status: 400 },
			);
		}
		if (
			typeof body.targetId !== "string" ||
			!body.targetId.trim() ||
			typeof body.assigneeId !== "string" ||
			!body.assigneeId.trim()
		) {
			return jsonResponse(
				{ error: "targetId and assigneeId are required." },
				{ status: 400 },
			);
		}
		try {
			const assignment = storage.addLessonAssignment({
				targetType: body.targetType,
				targetId: body.targetId.trim(),
				assigneeType: body.assigneeType,
				assigneeId: body.assigneeId.trim(),
				createdBy: adminResult.user.id,
			});
			recordAuditEvent(storage, {
				actor: auditActor(adminResult),
				action: "lesson-assignment.add",
				target: { kind: assignment.target_type, id: assignment.target_id },
				metadata: {
					assigneeType: assignment.assignee_type,
					assigneeId: assignment.assignee_id,
				},
			});
			return jsonResponse({ ok: true, assignment });
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Could not add assignment.";
			const isDuplicate = message.includes("UNIQUE constraint");
			return jsonResponse(
				{
					error: isDuplicate
						? "That assignment already exists."
						: "Could not add assignment.",
				},
				{ status: isDuplicate ? 409 : 500 },
			);
		}
	}

	const lessonAssignmentDeleteMatch =
		/^\/admin\/lessons\/assignments\/(\d+)$/.exec(url.pathname);
	if (lessonAssignmentDeleteMatch && request.method === "DELETE") {
		const id = Number(lessonAssignmentDeleteMatch[1]);
		const assignments = storage.listLessonAssignments();
		const existing = assignments.find((a) => a.id === id);
		if (!existing) {
			return jsonResponse({ error: "Assignment not found." }, { status: 404 });
		}
		storage.removeLessonAssignment(id);
		recordAuditEvent(storage, {
			actor: auditActor(adminResult),
			action: "lesson-assignment.remove",
			target: { kind: existing.target_type, id: existing.target_id },
			metadata: {
				assigneeType: existing.assignee_type,
				assigneeId: existing.assignee_id,
			},
		});
		return jsonResponse({ ok: true, id });
	}

	return notFound();
}
