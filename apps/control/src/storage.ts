import { Database } from "bun:sqlite";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { chmod, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type {
	CheckpointResult,
	CheckpointStatus,
	ContainerRole,
	ContainerState,
	LessonModuleKind,
	WorkspaceId,
	WorkspaceSlug,
} from "@frc-fabrica/contracts";
import type { ControlConfig, ControlConfigInput } from "./config";
import { loadControlConfig } from "./config";
import { getLogger } from "./logging";
import { applyMigrations } from "./migrations";

const log = getLogger("storage");

export type WorkspaceRow = {
	id: WorkspaceId;
	user_id: string;
	slug: WorkspaceSlug;
	project_path: string;
	created_at: string;
	last_accessed_at: string;
	current_module: string | null;
	current_module_kind: LessonModuleKind | null;
};

export type ContainerLeaseRow = {
	workspace_id: WorkspaceId;
	nt4_port: number | null;
	halsim_port: number | null;
	vscode_container: string | null;
	vscode_port: number | null;
	code_state: ContainerState;
	last_used_at: string;
	created_at: string;
};

export type RunJobState = "building" | "running" | "failed" | "stopped";

export type RunJobRow = {
	id: string;
	workspace_id: WorkspaceId;
	state: RunJobState;
	requested_at: string;
	started_at: string | null;
	finished_at: string | null;
	exit_code: number | null;
	log_path: string | null;
};

export type LessonAssignmentRow = {
	id: number;
	target_type: "module" | "track";
	target_id: string;
	assignee_type: "user" | "group";
	assignee_id: string;
	created_at: string;
	created_by: string;
};

/** Context returned by session resolution + workspace lookup. */
export type AuthContext = {
	user: {
		id: string;
		email: string;
		name: string;
		image: string | null;
		role: string;
		slug: string;
		groups: string[];
	};
	workspace: WorkspaceRow;
};

export class SlugTakenError extends Error {
	constructor(slug: string) {
		super(`The classroom name "${slug}" is already taken.`);
		this.name = "SlugTakenError";
	}
}

function randomId(prefix: "ws" | "run"): string {
	return `${prefix}_${randomBytes(16).toString("hex")}`;
}

function nowIso(): string {
	return new Date().toISOString();
}

/** Canonical on-disk project path for a workspace. Single source of truth —
 * normalizeWorkspaceProjectPaths re-roots every DB row against it at boot. */
function projectPathFor(
	config: ControlConfig,
	workspaceId: WorkspaceId,
): string {
	return resolve(config.dataDir, "users", workspaceId, "project");
}

async function ensureWorkspaceFiles(
	config: ControlConfig,
	workspaceId: WorkspaceId,
): Promise<string> {
	const workspaceDir = resolve(config.dataDir, "users", workspaceId);
	const projectDir = projectPathFor(config, workspaceId);
	const homeDir = resolve(workspaceDir, "home");

	const scopeStateDir = resolve(workspaceDir, "scope-state");

	await mkdir(projectDir, { recursive: true });
	await mkdir(homeDir, { recursive: true, mode: 0o700 });
	await mkdir(resolve(workspaceDir, "logs", "runs"), { recursive: true });
	await mkdir(resolve(workspaceDir, "assets"), { recursive: true });
	// See workspaceScopeStatePath (containers/metadata.ts) for why this one is
	// world-readable rather than owner-only like homeDir.
	await mkdir(scopeStateDir, { recursive: true, mode: 0o755 });

	try {
		await chmod(homeDir, 0o700);
	} catch {
		// Windows filesystems may ignore POSIX modes; the Linux Docker host enforces ownership at runtime.
	}
	try {
		await chmod(scopeStateDir, 0o755);
	} catch {
		// Windows filesystems may ignore POSIX modes; the Linux Docker host enforces ownership at runtime.
	}

	// The project dir starts EMPTY: the student fills it from the lesson catalog
	// (or a GitHub import) via the picker on first login. No template seeding.
	return projectDir;
}

export class AppStorage {
	readonly config: ControlConfig;
	readonly db: Database;

	constructor(configInput: ControlConfigInput = {}) {
		this.config = loadControlConfig(configInput);
		mkdirSync(dirname(this.config.dbPath), { recursive: true });
		this.db = new Database(this.config.dbPath, { create: true });
		this.db.exec("PRAGMA foreign_keys = ON;");
	}

	async initialize(): Promise<void> {
		await mkdir(dirname(this.config.dbPath), { recursive: true });

		// 1. Run our migrations (including the Legion identity schema).
		const applied = await applyMigrations(this.db, this.config.migrationsDir);
		log.info("storage initialized", {
			dbPath: this.config.dbPath,
			migrationsApplied: applied.length,
			migrationNames:
				applied.length > 0 ? applied.map((m) => m.name) : undefined,
		});

		// 2. Re-root persisted project paths under the current data directory.
		// project_path is always <dataDir>/users/<id>/project by construction, but
		// rows written by a differently-rooted deployment (host vs container, or a
		// restored backup) carry the old prefix. Docker mounts and file APIs use
		// the path the control plane sees now, so normalize eagerly.
		this.normalizeWorkspaceProjectPaths();
	}

	close(): void {
		this.db.close();
	}

	private normalizeWorkspaceProjectPaths(): void {
		const rows = this.db
			.query("SELECT id, project_path FROM workspaces")
			.all() as Array<{ id: WorkspaceId; project_path: string }>;
		let updated = 0;
		for (const row of rows) {
			const canonical = projectPathFor(this.config, row.id);
			if (row.project_path !== canonical) {
				this.db
					.query("UPDATE workspaces SET project_path = ? WHERE id = ?")
					.run(canonical, row.id);
				updated += 1;
			}
		}
		if (updated > 0) {
			log.info("re-rooted workspace project paths", {
				updated,
				dataDir: this.config.dataDir,
			});
		}
	}

	findWorkspaceByUserId(userId: string): WorkspaceRow | null {
		return (
			(this.db
				.query("SELECT * FROM workspaces WHERE user_id = ?")
				.get(userId) as WorkspaceRow | null) ?? null
		);
	}

	findWorkspaceBySlug(slug: WorkspaceSlug): WorkspaceRow | null {
		return (
			(this.db
				.query("SELECT * FROM workspaces WHERE slug = ?")
				.get(slug) as WorkspaceRow | null) ?? null
		);
	}

	findWorkspaceById(workspaceId: WorkspaceId): WorkspaceRow | null {
		return (
			(this.db
				.query("SELECT * FROM workspaces WHERE id = ?")
				.get(workspaceId) as WorkspaceRow | null) ?? null
		);
	}

	/**
	 * Insert or refresh the local `user` row for a Legion identity. Called on
	 * every Legion session resolution (see legion/session.ts) — role is always
	 * recomputed from the cookie's `groups` claim, so this keeps it in sync
	 * without a separate promote/demote mechanism.
	 */
	upsertLegionUser(input: {
		id: string;
		email: string;
		name: string;
		role: string;
	}): void {
		const now = nowIso();
		this.db
			.query(
				`INSERT INTO user (id, name, email, image, createdAt, updatedAt, role, slug)
				 VALUES (?, ?, ?, NULL, ?, ?, ?, NULL)
				 ON CONFLICT(id) DO UPDATE SET
				   name = excluded.name,
				   email = excluded.email,
				   role = excluded.role,
				   updatedAt = excluded.updatedAt`,
			)
			.run(input.id, input.name, input.email, now, now, input.role);
	}

	/** Create a workspace for a user (called on first login). */
	async ensureWorkspaceForUser(
		userId: string,
		slug: string,
	): Promise<WorkspaceRow> {
		const existing = this.findWorkspaceByUserId(userId);
		if (existing) {
			this.touchWorkspace(existing.id);
			return existing;
		}

		// Reserve the row first (slug uniqueness enforced by the DB), then
		// materialize project files. If two concurrent first-logins pick the
		// same base slug, the second INSERT loses the race on the UNIQUE
		// constraint and we retry with a suffix.
		const baseSlug = slug.slice(0, 40) || "student";
		const workspaceId = randomId("ws") as WorkspaceId;
		const timestamp = nowIso();
		const placeholderProjectPath = projectPathFor(this.config, workspaceId);

		let finalSlug: WorkspaceSlug | null = null;
		const MAX_ATTEMPTS = 16;
		for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
			const candidate =
				attempt === 0
					? (baseSlug as WorkspaceSlug)
					: (`${baseSlug.slice(0, 40 - `-${attempt}`.length)}-${attempt}` as WorkspaceSlug);

			if (this.findWorkspaceBySlug(candidate)) continue;

			try {
				const transaction = this.db.transaction(() => {
					this.db
						.query(
							"INSERT INTO workspaces (id, user_id, slug, project_path, created_at, last_accessed_at) VALUES (?, ?, ?, ?, ?, ?)",
						)
						.run(
							workspaceId,
							userId,
							candidate,
							placeholderProjectPath,
							timestamp,
							timestamp,
						);
					this.db
						.query("UPDATE user SET slug = ?, updatedAt = ? WHERE id = ?")
						.run(candidate, timestamp, userId);
				});
				transaction();
				finalSlug = candidate;
				break;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				// Only retry on the slug uniqueness collision. Anything else (e.g.
				// a UNIQUE on user_id) means the caller is wrong, so rethrow.
				if (message.includes("workspaces.slug")) continue;
				throw error;
			}
		}

		if (!finalSlug) {
			throw new Error(
				`Could not allocate a unique workspace slug for base "${baseSlug}".`,
			);
		}

		try {
			const projectPath = await ensureWorkspaceFiles(this.config, workspaceId);
			if (projectPath !== placeholderProjectPath) {
				this.db
					.query("UPDATE workspaces SET project_path = ? WHERE id = ?")
					.run(projectPath, workspaceId);
			}
		} catch (error) {
			this.db.query("DELETE FROM workspaces WHERE id = ?").run(workspaceId);
			throw error;
		}

		const workspace = this.findWorkspaceById(workspaceId);
		if (!workspace) {
			throw new Error("Failed to reload newly created workspace.");
		}

		return workspace;
	}

	touchWorkspace(workspaceId: WorkspaceId): void {
		const timestamp = nowIso();
		this.db
			.query("UPDATE workspaces SET last_accessed_at = ? WHERE id = ?")
			.run(timestamp, workspaceId);
	}

	setCurrentModule(
		workspaceId: WorkspaceId,
		moduleId: string | null,
		kind: LessonModuleKind | null,
	): void {
		this.db
			.query(
				"UPDATE workspaces SET current_module = ?, current_module_kind = ? WHERE id = ?",
			)
			.run(moduleId, kind, workspaceId);
	}

	getCheckpointResults(
		workspaceId: WorkspaceId,
		moduleId: string,
	): CheckpointResult[] {
		const rows = this.db
			.query(
				"SELECT checkpoint_id, status, message, verified_at FROM checkpoint_results WHERE workspace_id = ? AND module_id = ?",
			)
			.all(workspaceId, moduleId) as {
			checkpoint_id: string;
			status: CheckpointStatus;
			message: string | null;
			verified_at: string;
		}[];
		return rows.map((row) => ({
			checkpointId: row.checkpoint_id,
			status: row.status,
			message: row.message,
			verifiedAt: row.verified_at,
		}));
	}

	setCheckpointResult(
		workspaceId: WorkspaceId,
		moduleId: string,
		result: CheckpointResult,
	): void {
		this.db
			.query(
				`INSERT INTO checkpoint_results (workspace_id, module_id, checkpoint_id, status, message, verified_at)
				 VALUES (?, ?, ?, ?, ?, ?)
				 ON CONFLICT (workspace_id, module_id, checkpoint_id)
				 DO UPDATE SET status = excluded.status, message = excluded.message, verified_at = excluded.verified_at`,
			)
			.run(
				workspaceId,
				moduleId,
				result.checkpointId,
				result.status,
				result.message,
				result.verifiedAt ?? nowIso(),
			);
	}

	/** Called on every lesson (re)load: stale results from the previous attempt shouldn't linger. */
	clearCheckpointResults(workspaceId: WorkspaceId, moduleId: string): void {
		this.db
			.query(
				"DELETE FROM checkpoint_results WHERE workspace_id = ? AND module_id = ?",
			)
			.run(workspaceId, moduleId);
	}

	getContainerLease(workspaceId: WorkspaceId): ContainerLeaseRow | null {
		return (
			(this.db
				.query("SELECT * FROM container_leases WHERE workspace_id = ?")
				.get(workspaceId) as ContainerLeaseRow | null) ?? null
		);
	}

	listLeasedPorts(
		role: ContainerRole,
		exceptWorkspaceId?: WorkspaceId,
	): number[] {
		const column =
			role === "sim"
				? "nt4_port"
				: role === "halsim"
					? "halsim_port"
					: "vscode_port";
		const rows = (
			exceptWorkspaceId
				? this.db
						.query(
							`SELECT ${column} AS port FROM container_leases WHERE ${column} IS NOT NULL AND workspace_id != ?`,
						)
						.all(exceptWorkspaceId)
				: this.db
						.query(
							`SELECT ${column} AS port FROM container_leases WHERE ${column} IS NOT NULL`,
						)
						.all()
		) as Array<{ port: number }>;
		return rows.map((row) => row.port);
	}

	clearReservedPort(
		role: ContainerRole,
		workspaceId: WorkspaceId,
		port: number,
	): void {
		const timestamp = nowIso();
		if (role === "sim") {
			this.db
				.query(
					`
            UPDATE container_leases
            SET nt4_port = NULL,
                code_state = ?,
                last_used_at = ?
            WHERE workspace_id = ?
              AND nt4_port = ?
          `,
				)
				.run("error", timestamp, workspaceId, port);
		} else if (role === "halsim") {
			this.db
				.query(
					`
            UPDATE container_leases
            SET halsim_port = NULL,
                code_state = ?,
                last_used_at = ?
            WHERE workspace_id = ?
              AND halsim_port = ?
          `,
				)
				.run("error", timestamp, workspaceId, port);
		} else {
			this.db
				.query(
					`
            UPDATE container_leases
            SET vscode_port = NULL,
                code_state = ?,
                last_used_at = ?
            WHERE workspace_id = ?
              AND vscode_port = ?
          `,
				)
				.run("error", timestamp, workspaceId, port);
		}
	}

	upsertCodeContainerLease(input: {
		workspaceId: WorkspaceId;
		containerName: string;
		simPort: number | null;
		vscodePort: number | null;
		halsimPort: number | null;
		state: ContainerState;
	}): ContainerLeaseRow {
		const timestamp = nowIso();
		this.db
			.query(
				`
          INSERT INTO container_leases (
            workspace_id,
            vscode_container,
            nt4_port,
            vscode_port,
            halsim_port,
            code_state,
            last_used_at,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(workspace_id) DO UPDATE SET
            vscode_container = excluded.vscode_container,
            nt4_port = excluded.nt4_port,
            vscode_port = excluded.vscode_port,
            halsim_port = excluded.halsim_port,
            code_state = excluded.code_state,
            last_used_at = excluded.last_used_at
        `,
			)
			.run(
				input.workspaceId,
				input.containerName,
				input.simPort,
				input.vscodePort,
				input.halsimPort,
				input.state,
				timestamp,
				timestamp,
			);

		const lease = this.getContainerLease(input.workspaceId);
		if (!lease) {
			throw new Error(
				`Failed to reload container lease for workspace ${input.workspaceId}.`,
			);
		}
		return lease;
	}

	touchContainerLeaseActivity(workspaceId: WorkspaceId): void {
		const timestamp = nowIso();
		this.db
			.query(
				"UPDATE container_leases SET last_used_at = ? WHERE workspace_id = ?",
			)
			.run(timestamp, workspaceId);
	}

	listAllWorkspacesWithLeases(): Array<{
		workspace: WorkspaceRow;
		user: {
			id: string;
			name: string;
			email: string;
			role: string;
			slug: string | null;
		};
		lease: ContainerLeaseRow | null;
	}> {
		const rows = this.db
			.query(
				`
          SELECT
            w.id AS w_id, w.user_id AS w_user_id, w.slug AS w_slug,
            w.project_path AS w_project_path, w.created_at AS w_created_at,
            w.last_accessed_at AS w_last_accessed_at,
            w.current_module AS w_current_module,
            w.current_module_kind AS w_current_module_kind,
            u.id AS u_id, u.name AS u_name, u.email AS u_email,
            u.role AS u_role, u.slug AS u_slug,
            cl.workspace_id AS cl_workspace_id, cl.nt4_port,
            cl.vscode_container, cl.vscode_port, cl.halsim_port, cl.code_state AS cl_code_state,
            cl.last_used_at AS cl_last_used_at, cl.created_at AS cl_created_at
          FROM workspaces w
          LEFT JOIN user u ON u.id = w.user_id
          LEFT JOIN container_leases cl ON cl.workspace_id = w.id
          ORDER BY w.last_accessed_at DESC
        `,
			)
			.all() as Array<{
			w_id: WorkspaceId;
			w_user_id: string;
			w_slug: WorkspaceSlug;
			w_project_path: string;
			w_created_at: string;
			w_last_accessed_at: string;
			w_current_module: string | null;
			w_current_module_kind: LessonModuleKind | null;
			u_id: string | null;
			u_name: string | null;
			u_email: string | null;
			u_role: string | null;
			u_slug: string | null;
			cl_workspace_id: WorkspaceId | null;
			nt4_port: number | null;
			halsim_port: number | null;
			vscode_container: string | null;
			vscode_port: number | null;
			cl_code_state: ContainerState | null;
			cl_last_used_at: string | null;
			cl_created_at: string | null;
		}>;

		return rows.map((row) => ({
			workspace: {
				id: row.w_id,
				user_id: row.w_user_id,
				slug: row.w_slug,
				project_path: row.w_project_path,
				created_at: row.w_created_at,
				last_accessed_at: row.w_last_accessed_at,
				current_module: row.w_current_module,
				current_module_kind: row.w_current_module_kind,
			},
			user: {
				id: row.u_id ?? row.w_user_id,
				name: row.u_name ?? "Unknown",
				email: row.u_email ?? "",
				role: row.u_role ?? "student",
				slug: row.u_slug,
			},
			lease: row.cl_workspace_id
				? {
						workspace_id: row.cl_workspace_id,
						nt4_port: row.nt4_port,
						halsim_port: row.halsim_port,
						vscode_container: row.vscode_container,
						vscode_port: row.vscode_port,
						code_state: (row.cl_code_state ?? "missing") as ContainerState,
						last_used_at: row.cl_last_used_at!,
						created_at: row.cl_created_at!,
					}
				: null,
		}));
	}

	listIdleWorkspaceIds(idleMinutes: number): WorkspaceId[] {
		const cutoff = new Date(Date.now() - idleMinutes * 60_000).toISOString();
		const rows = this.db
			.query(
				`
          SELECT w.id
          FROM workspaces w
          JOIN container_leases cl ON cl.workspace_id = w.id
          WHERE w.last_accessed_at < ?
            AND cl.code_state IN ('running', 'starting')
        `,
			)
			.all(cutoff) as Array<{ id: WorkspaceId }>;
		return rows.map((row) => row.id);
	}

	createRunJob(input: {
		workspaceId: WorkspaceId;
		logPath: string;
		id?: string;
	}): RunJobRow {
		const id = input.id ?? randomId("run");
		const timestamp = nowIso();
		this.db
			.query(
				`
          INSERT INTO run_jobs (
            id,
            workspace_id,
            state,
            requested_at,
            log_path
          )
          VALUES (?, ?, ?, ?, ?)
        `,
			)
			.run(id, input.workspaceId, "building", timestamp, input.logPath);

		const row = this.getRunJob(id);
		if (!row) {
			throw new Error(`Failed to reload run job ${id}.`);
		}
		return row;
	}

	getRunJob(id: string): RunJobRow | null {
		return (
			(this.db
				.query("SELECT * FROM run_jobs WHERE id = ?")
				.get(id) as RunJobRow | null) ?? null
		);
	}

	getLatestRunJobForWorkspace(workspaceId: WorkspaceId): RunJobRow | null {
		return (
			(this.db
				.query(
					`
            SELECT *
            FROM run_jobs
            WHERE workspace_id = ?
            ORDER BY requested_at DESC
            LIMIT 1
          `,
				)
				.get(workspaceId) as RunJobRow | null) ?? null
		);
	}

	listOrphanableRunJobs(): RunJobRow[] {
		return this.db
			.query(
				`
          SELECT *
          FROM run_jobs
          WHERE state IN ('building', 'running')
            AND finished_at IS NULL
          ORDER BY requested_at ASC
        `,
			)
			.all() as RunJobRow[];
	}

	updateRunJob(input: {
		id: string;
		state: RunJobState;
		started?: boolean;
		finished?: boolean;
		exitCode?: number | null;
	}): RunJobRow {
		const timestamp = nowIso();
		const existing = this.getRunJob(input.id);
		if (!existing) {
			throw new Error(`Run job ${input.id} does not exist.`);
		}

		this.db
			.query(
				`
          UPDATE run_jobs
          SET
            state = ?,
            started_at = ?,
            finished_at = ?,
            exit_code = ?
          WHERE id = ?
        `,
			)
			.run(
				input.state,
				input.started
					? (existing.started_at ?? timestamp)
					: existing.started_at,
				input.finished
					? (existing.finished_at ?? timestamp)
					: existing.finished_at,
				input.exitCode === undefined ? existing.exit_code : input.exitCode,
				input.id,
			);

		const row = this.getRunJob(input.id);
		if (!row) {
			throw new Error(`Failed to reload run job ${input.id}.`);
		}
		return row;
	}

	// --- Runtime config ---

	getRuntimeConfig(key: string): string | null {
		const row = this.db
			.query("SELECT value FROM runtime_config WHERE key = ?")
			.get(key) as { value: string } | null;
		return row?.value ?? null;
	}

	setRuntimeConfig(key: string, value: string): void {
		this.db
			.query(
				`INSERT INTO runtime_config (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
			)
			.run(key, value, nowIso());
	}

	getEffectiveMaxActiveContainers(): number {
		const override = this.getRuntimeConfig("max_active_containers");
		if (override !== null) {
			const parsed = Number(override);
			if (Number.isInteger(parsed) && parsed >= 1) {
				return parsed;
			}
		}
		return this.config.maxActiveContainers;
	}

	// --- Lesson/track assignment (admin portal) ---

	listLessonAssignments(): LessonAssignmentRow[] {
		return this.db
			.query(
				"SELECT * FROM lesson_assignments ORDER BY target_type, target_id, assignee_type, assignee_id",
			)
			.all() as LessonAssignmentRow[];
	}

	addLessonAssignment(input: {
		targetType: "module" | "track";
		targetId: string;
		assigneeType: "user" | "group";
		assigneeId: string;
		createdBy: string;
	}): LessonAssignmentRow {
		const now = nowIso();
		this.db
			.query(
				`INSERT INTO lesson_assignments (target_type, target_id, assignee_type, assignee_id, created_at, created_by)
				 VALUES (?, ?, ?, ?, ?, ?)`,
			)
			.run(
				input.targetType,
				input.targetId,
				input.assigneeType,
				input.assigneeId,
				now,
				input.createdBy,
			);
		const row = this.db
			.query(
				"SELECT * FROM lesson_assignments WHERE target_type = ? AND target_id = ? AND assignee_type = ? AND assignee_id = ?",
			)
			.get(
				input.targetType,
				input.targetId,
				input.assigneeType,
				input.assigneeId,
			) as LessonAssignmentRow | null;
		if (!row) {
			throw new Error("Failed to reload newly created lesson assignment.");
		}
		return row;
	}

	/** Returns true if a row was deleted. */
	removeLessonAssignment(id: number): boolean {
		const result = this.db
			.query("DELETE FROM lesson_assignments WHERE id = ?")
			.run(id);
		return result.changes > 0;
	}
}

export async function createStorage(
	configInput: ControlConfigInput = {},
): Promise<AppStorage> {
	const storage = new AppStorage(configInput);
	await storage.initialize();
	return storage;
}
