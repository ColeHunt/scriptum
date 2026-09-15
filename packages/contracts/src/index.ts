import { z } from "zod";

/**
 * Set on a 503 from the editor proxy when the editor is still coming up rather
 * than broken, so the shell can show "starting" instead of an error.
 */
export const EDITOR_STATE_HEADER = "x-coderunner-editor-state";

export const ROUTE_SLUG_PATTERN = /^[a-zA-Z0-9_-]{1,40}$/;
export const WORKSPACE_ID_PATTERN = /^ws_[a-f0-9]{32}$/;
// User ids are Legion `member_code`s (8 lowercase hex chars) in normal
// operation, the fixed demo user id, or the `<admin-token>` break-glass
// sentinel — keep the bound loose enough to absorb all three plus a future
// generator change, without going so loose it stops catching malformed ids.
export const USER_ID_PATTERN = /^[A-Za-z0-9_<>-]{4,64}$/;

export const workspaceSlugSchema = z.string().regex(ROUTE_SLUG_PATTERN);
export const userIdSchema = z.string().regex(USER_ID_PATTERN);
export const workspaceIdSchema = z.string().regex(WORKSPACE_ID_PATTERN);

export const displayNameSchema = z
	.string()
	.trim()
	.min(1, "Display name is required.")
	.max(80, "Display name must be 80 characters or fewer.");

export const workspaceRouteSchema = z.object({
	workspaceSlug: workspaceSlugSchema,
});

export function isWorkspaceSlug(value: string): boolean {
	return workspaceSlugSchema.safeParse(value).success;
}

export type WorkspaceRoute = z.infer<typeof workspaceRouteSchema>;
export type UserId = z.infer<typeof userIdSchema>;
export type WorkspaceId = z.infer<typeof workspaceIdSchema>;
export type WorkspaceSlug = z.infer<typeof workspaceSlugSchema>;

export const heartbeatRequestSchema = z.object({
	closing: z.boolean().optional(),
});

export const lessonModuleKindSchema = z.enum(["plain-java", "robot", "git"]);

// Top-level (pre-workspace) session probe: does the SPA's `RootIndex` have a
// slug to redirect to, or should it send the visitor to /login? Deliberately
// separate from `sessionResponseSchema`, which requires a resolved workspace
// and is only reachable from inside `/u/:slug/`.
export const topLevelSessionResponseSchema = z.object({
	authenticated: z.boolean(),
	slug: workspaceSlugSchema.nullable(),
});

export const sessionResponseSchema = z.object({
	user: z.object({
		id: userIdSchema,
		displayName: z.string(),
		email: z.string(),
		avatarUrl: z.string().url().nullable(),
		slug: workspaceSlugSchema,
		role: z.enum(["student", "admin"]),
	}),
	workspace: z.object({
		id: workspaceIdSchema,
		slug: workspaceSlugSchema,
		currentModule: z.string().nullable(),
		currentModuleKind: lessonModuleKindSchema.nullable(),
		projectEmpty: z.boolean(),
	}),
	demo: z.boolean().optional(),
});

export const heartbeatResponseSchema = z.object({
	ok: z.literal(true),
	closing: z.boolean(),
});

export const containerStateSchema = z.enum([
	"missing",
	"starting",
	"running",
	"stopped",
	"error",
]);

export const containersStatusResponseSchema = z.object({
	workspace: z.object({
		id: workspaceIdSchema,
		slug: workspaceSlugSchema,
	}),
	code: z.object({
		role: z.literal("code"),
		state: containerStateSchema,
		image: z.string().min(1),
		containerName: z.string().min(1).nullable(),
		simPortAllocated: z.boolean(),
		vscodePortAllocated: z.boolean(),
		halsimPortAllocated: z.boolean(),
		lastUsedAt: z.string().nullable(),
		error: z.string().nullable(),
	}),
});

export const runClientMessageSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("start") }),
	z.object({ type: z.literal("stop") }),
	z.object({ type: z.literal("ping") }),
]);

export const runServerMessageSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("hello"),
		runId: z.string().min(1),
	}),
	z.object({
		type: z.literal("status"),
		status: z.enum(["stopping", "building", "running", "failed", "stopped"]),
	}),
	z.object({
		type: z.literal("log"),
		stream: z.enum(["stdout", "stderr", "sim"]),
		line: z.string(),
	}),
	z.object({
		type: z.literal("exit"),
		code: z.number().int().nullable(),
		signal: z.string().nullable(),
	}),
	z.object({
		type: z.literal("error"),
		message: z.string(),
	}),
]);

export const simRunStatusSchema = z.enum([
	"idle",
	"building",
	"running",
	"stopping",
	"failed",
	"stopped",
	"error",
]);
export const simRunCommandSchema = z.enum(["start", "stop", "restart"]);
export const dsModeSchema = z.enum(["auto", "teleop", "test"]);
export const allianceStationSchema = z.enum([
	"red1",
	"red2",
	"red3",
	"blue1",
	"blue2",
	"blue3",
]);
export const bridgeConnectionSchema = z.enum([
	"connected",
	"reconnecting",
	"disconnected",
]);

export const simRunCommandRequestSchema = z.object({
	action: simRunCommandSchema,
});

export const driverStationPatchSchema = z
	.object({
		enabled: z.boolean().optional(),
		mode: dsModeSchema.optional(),
		eStopped: z.boolean().optional(),
		alliance: allianceStationSchema.optional(),
	})
	.refine((value) => Object.keys(value).length > 0, {
		message: "At least one Driver Station field is required.",
	});

export const autoChooserSchema = z.object({
	key: z.string().min(1),
	displayKey: z.string().min(1),
	options: z.array(z.string()),
	default: z.string().nullable(),
	active: z.string().nullable(),
	selected: z.string().nullable(),
});

export const autoChoosersResponseSchema = z.object({
	ok: z.literal(true),
	nt4: z.object({
		connection: bridgeConnectionSchema,
		connected: z.boolean(),
		stale: z.boolean(),
		lastMessageAt: z.string().nullable(),
		error: z.string().nullable(),
	}),
	choosers: z.array(autoChooserSchema),
});

export const autoChooserPatchSchema = z.object({
	key: z.string().min(1),
	selected: z.string().min(1),
});

export const simStatusResponseSchema = z.object({
	ok: z.literal(true),
	workspace: z.object({
		id: workspaceIdSchema,
		slug: workspaceSlugSchema,
	}),
	container: z.object({
		state: containerStateSchema,
	}),
	run: z.object({
		status: simRunStatusSchema,
		runId: z.string().min(1).nullable(),
	}),
	halsim: z.object({
		connection: bridgeConnectionSchema,
		connected: z.boolean(),
		stale: z.boolean(),
		lastMessageAt: z.string().nullable(),
		error: z.string().nullable(),
	}),
	driverStation: z.object({
		enabled: z.boolean(),
		mode: dsModeSchema,
		eStopped: z.boolean(),
		alliance: allianceStationSchema,
	}),
	comms: z.object({
		canEnable: z.boolean(),
	}),
	joysticks: z.object({
		status: z.enum(["unknown", "connected", "disconnected"]),
		port: z.number().int().min(0).max(5).nullable(),
		label: z.string().nullable(),
		lastInputAt: z.string().nullable(),
	}),
});

// --- Gamepad WebSocket messages ---

export const gamepadStateSchema = z.object({
	axes: z.array(z.number().min(-1.1).max(1.1)).max(8),
	buttons: z.array(z.boolean()).max(32),
	povs: z.array(z.number().int().min(-1).max(360)).max(2),
});

export const gamepadClientMessageSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("select"),
		id: z.string().min(1).max(256),
		label: z.string().min(1).max(256),
	}),
	z.object({
		type: z.literal("state"),
		seq: z.number().int().min(0),
		state: gamepadStateSchema,
	}),
	z.object({
		type: z.literal("release"),
	}),
]);

export const gamepadServerMessageSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("hello") }),
	z.object({ type: z.literal("halsim-disconnected") }),
	z.object({ type: z.literal("error"), message: z.string() }),
]);

export type GamepadState = z.infer<typeof gamepadStateSchema>;
export type GamepadClientMessage = z.infer<typeof gamepadClientMessageSchema>;
export type GamepadServerMessage = z.infer<typeof gamepadServerMessageSchema>;

export const simRunCommandResponseSchema = z.object({
	ok: z.literal(true),
	action: simRunCommandSchema,
	runId: z.string().min(1).nullable(),
	status: simRunStatusSchema,
});

export type HeartbeatRequest = z.infer<typeof heartbeatRequestSchema>;
export type SessionResponse = z.infer<typeof sessionResponseSchema>;
export type TopLevelSessionResponse = z.infer<
	typeof topLevelSessionResponseSchema
>;
export type HeartbeatResponse = z.infer<typeof heartbeatResponseSchema>;
export type ContainerRole = "sim" | "code" | "halsim";
export type ContainerState = z.infer<typeof containerStateSchema>;
export type ContainersStatusResponse = z.infer<
	typeof containersStatusResponseSchema
>;
export type RunClientMessage = z.infer<typeof runClientMessageSchema>;
export type RunServerMessage = z.infer<typeof runServerMessageSchema>;
export type SimRunStatus = z.infer<typeof simRunStatusSchema>;
export type SimRunCommand = z.infer<typeof simRunCommandSchema>;
export type DsMode = z.infer<typeof dsModeSchema>;
export type AllianceStation = z.infer<typeof allianceStationSchema>;
export type BridgeConnection = z.infer<typeof bridgeConnectionSchema>;
export type SimRunCommandRequest = z.infer<typeof simRunCommandRequestSchema>;
export type DriverStationPatch = z.infer<typeof driverStationPatchSchema>;
export type AutoChooser = z.infer<typeof autoChooserSchema>;
export type AutoChoosersResponse = z.infer<typeof autoChoosersResponseSchema>;
export type AutoChooserPatch = z.infer<typeof autoChooserPatchSchema>;
export type SimStatusResponse = z.infer<typeof simStatusResponseSchema>;
export type SimRunCommandResponse = z.infer<typeof simRunCommandResponseSchema>;

// --- Admin / operator schemas ---

export const adminWorkspaceStatusSchema = z.object({
	workspace: z.object({
		id: workspaceIdSchema,
		slug: workspaceSlugSchema,
		lastAccessedAt: z.string(),
	}),
	user: z.object({
		displayName: z.string(),
		email: z.string(),
		role: z.enum(["student", "admin"]),
		slug: workspaceSlugSchema,
		lastSeenAt: z.string(),
	}),
	code: z.object({
		state: containerStateSchema,
		containerName: z.string().nullable(),
		simPort: z.number().int().nullable(),
		vscodePort: z.number().int().nullable(),
		halsimPort: z.number().int().nullable(),
	}),
	idle: z.boolean(),
	lastActivity: z.string(),
});

export const adminStatusResponseSchema = z.object({
	ok: z.literal(true),
	workspaces: z.array(adminWorkspaceStatusSchema),
	idleStopMinutes: z.number().int().min(1),
	activeBuilds: z.number().int().min(0),
	maxActiveContainers: z.number().int().min(1).optional(),
});

export const adminActionResponseSchema = z.object({
	ok: z.literal(true),
	action: z.string(),
	workspaceId: workspaceIdSchema,
	detail: z.string().optional(),
});

export type AdminWorkspaceStatus = z.infer<typeof adminWorkspaceStatusSchema>;
export type AdminStatusResponse = z.infer<typeof adminStatusResponseSchema>;
export type AdminActionResponse = z.infer<typeof adminActionResponseSchema>;

// --- Import schemas ---

export const importRequestSchema = z.object({
	url: z.string().min(1, "URL is required."),
});

export const importResponseSchema = z.object({
	ok: z.literal(true),
	cloneUrl: z.string().min(1),
});

export const importServerMessageSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("hello"),
		importId: z.string().min(1),
	}),
	z.object({
		type: z.literal("progress"),
		stage: z.string(),
		detail: z.string().optional(),
	}),
	z.object({
		type: z.literal("log"),
		line: z.string(),
	}),
	z.object({
		type: z.literal("done"),
		success: z.boolean(),
		message: z.string(),
	}),
	z.object({
		type: z.literal("error"),
		message: z.string(),
	}),
]);

export type ImportRequest = z.infer<typeof importRequestSchema>;
export type ImportResponse = z.infer<typeof importResponseSchema>;
export type ImportServerMessage = z.infer<typeof importServerMessageSchema>;

// --- Lesson catalog schemas ---

export const lessonModuleSubdirSchema = z
	.string()
	.min(1)
	.max(200)
	.regex(
		/^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/,
		"Subdir must be a relative path made of safe path segments.",
	);

/**
 * A checkpoint's verifier says how to check it.
 * - "script": a shell script baked into the image under `checkpoints/`, run
 *   as the workspace user against the student's project and expected to
 *   exit 0 (pass) or non-zero (fail). `path` is a catalog-root-relative
 *   subdir, resolved the same way `lessonModuleSubdirSchema` resolves a
 *   module's own subdir.
 * - "nt4-value": checked directly by the control plane against a live NT4
 *   topic (via the already-connected auto-chooser NT4 bridge), for a
 *   `robot`-kind module whose student code can't be compiled against by a
 *   hidden checkpoint class the way plain-java lessons can. "range" checks
 *   every sample falls within [min, max]; "changes" checks at least two
 *   distinct values were observed (catches a frozen number OR boolean).
 */
export const lessonCheckpointVerifierSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("script"),
		path: lessonModuleSubdirSchema,
	}),
	z.object({
		type: z.literal("nt4-value"),
		topic: z.string().min(1),
		check: z.enum(["range", "changes"]),
		min: z.number().optional(),
		max: z.number().optional(),
	}),
]);

export const lessonCheckpointSchema = z.object({
	id: z
		.string()
		.min(1)
		.max(100)
		.regex(
			/^[a-z0-9]+(?:-[a-z0-9]+)*$/,
			"Checkpoint id must be lowercase kebab-case.",
		),
	title: z.string().min(1),
	description: z.string(),
	optional: z.boolean().default(false),
	verifier: lessonCheckpointVerifierSchema,
});

export const lessonModuleSchema = z.object({
	id: z.string().min(1),
	title: z.string().min(1),
	description: z.string(),
	subdir: lessonModuleSubdirSchema,
	kind: lessonModuleKindSchema,
	order: z.number().int(),
	/** Runs once, right after the module's files are copied in (e.g. the git
	 * lesson builds its scenario repos here, since real `.git` directories
	 * can't ship as static files). Catalog-root-relative, like `subdir`. */
	setupScript: lessonModuleSubdirSchema.optional(),
	checkpoints: z.array(lessonCheckpointSchema).default([]),
	/** Display grouping shown in the Switch Project picker (e.g. "Software
	 * Onboarding"). Purely cosmetic - `requires` is what actually gates a
	 * module, tracks are just modules that happen to chain via it. */
	track: z.string().min(1).optional(),
	/** Module ids that must be fully complete (every non-optional checkpoint
	 * passed) before this one can be loaded. A module with no checkpoints of
	 * its own can still be a prerequisite target as long as it exists. */
	requires: z.array(z.string().min(1)).default([]),
	/** Mounts the AdvantageScope pane (and its supporting panes) for a
	 * `plain-java` module that isn't a full robot simulation - e.g. a lesson
	 * where the student's program writes a log file and opens it in Scope by
	 * hand, rather than connecting to a live NT4 server. */
	showScope: z.boolean().default(false).optional(),
});

export const lessonCatalogSchema = z.object({
	schemaVersion: z.number().int(),
	modules: z.array(lessonModuleSchema),
});

/** A catalog module as returned to a specific workspace: whether it's
 * currently locked, and the titles of whatever unmet prerequisites are
 * blocking it (empty when unlocked). */
export const lessonModuleWithLockStateSchema = lessonModuleSchema.extend({
	locked: z.boolean(),
	missingPrerequisites: z.array(z.string()),
});

export const lessonCatalogResponseSchema = z.object({
	ok: z.literal(true),
	modules: z.array(lessonModuleWithLockStateSchema),
	error: z.string().nullable().optional(),
});

export const lessonLoadRequestSchema = z.object({
	moduleId: z.string().min(1),
});

export type LessonModuleKind = z.infer<typeof lessonModuleKindSchema>;
export type LessonModuleSubdir = z.infer<typeof lessonModuleSubdirSchema>;
export type LessonCheckpointVerifier = z.infer<
	typeof lessonCheckpointVerifierSchema
>;
export type LessonCheckpoint = z.infer<typeof lessonCheckpointSchema>;
export type LessonModule = z.infer<typeof lessonModuleSchema>;
export type LessonModuleWithLockState = z.infer<
	typeof lessonModuleWithLockStateSchema
>;
export type LessonCatalog = z.infer<typeof lessonCatalogSchema>;
export type LessonCatalogResponse = z.infer<typeof lessonCatalogResponseSchema>;
export type LessonLoadRequest = z.infer<typeof lessonLoadRequestSchema>;

// --- Checkpoint verification ---

export const checkpointStatusSchema = z.enum([
	"not-run",
	"passed",
	"failed",
	"error",
]);

export const checkpointResultSchema = z.object({
	checkpointId: z.string(),
	status: checkpointStatusSchema,
	message: z.string().nullable(),
	verifiedAt: z.string().nullable(),
});

/** A module's checkpoints, each paired with its most recent stored result. */
export const checkpointsStateSchema = z.object({
	moduleId: z.string().nullable(),
	/** False when the current module has no checkpoints (or isn't loaded). */
	available: z.boolean(),
	checkpoints: z.array(
		lessonCheckpointSchema.extend({
			result: checkpointResultSchema.nullable(),
		}),
	),
});

export const checkpointsStateResponseSchema = z.object({
	ok: z.literal(true),
	state: checkpointsStateSchema,
});

export const verifyCheckpointsRequestSchema = z.object({
	/** Omit to verify every checkpoint in the current module. */
	checkpointIds: z.array(z.string()).optional(),
	/** A snapshot of the AdvantageScope Lite iframe's own saved UI state
	 * (tabs, plotted fields, axis ranges, etc.), read from its localStorage by
	 * the web client right before this request. Deliberately untyped - it's
	 * AdvantageScope's own schema, not ours, and only the catalog's jq-based
	 * checkpoint scripts need to track its shape. Persisted server-side so
	 * every checkpoint in this verify pass sees the same snapshot. */
	scopeLayout: z.unknown().optional(),
});

export type CheckpointStatus = z.infer<typeof checkpointStatusSchema>;
export type CheckpointResult = z.infer<typeof checkpointResultSchema>;
export type CheckpointsState = z.infer<typeof checkpointsStateSchema>;
export type CheckpointsStateResponse = z.infer<
	typeof checkpointsStateResponseSchema
>;
export type VerifyCheckpointsRequest = z.infer<
	typeof verifyCheckpointsRequestSchema
>;
