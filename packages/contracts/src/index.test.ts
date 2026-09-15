import { describe, expect, test } from "bun:test";
import {
	autoChooserPatchSchema,
	autoChoosersResponseSchema,
	checkpointsStateResponseSchema,
	driverStationPatchSchema,
	gamepadClientMessageSchema,
	gamepadServerMessageSchema,
	gamepadStateSchema,
	importRequestSchema,
	importResponseSchema,
	isWorkspaceSlug,
	lessonCatalogResponseSchema,
	lessonCatalogSchema,
	lessonLoadRequestSchema,
	runClientMessageSchema,
	runServerMessageSchema,
	simRunCommandRequestSchema,
	simStatusResponseSchema,
} from "./index";

describe("isWorkspaceSlug", () => {
	test("accepts route-safe workspace slugs", () => {
		expect(isWorkspaceSlug("alice")).toBe(true);
		expect(isWorkspaceSlug("team_6328-2026")).toBe(true);
	});

	test("rejects path-like or empty slugs", () => {
		expect(isWorkspaceSlug("")).toBe(false);
		expect(isWorkspaceSlug("../alice")).toBe(false);
		expect(isWorkspaceSlug("alice/bob")).toBe(false);
		expect(isWorkspaceSlug("alice.bob")).toBe(false);
		expect(isWorkspaceSlug("a".repeat(41))).toBe(false);
	});
});

describe("run message schemas", () => {
	test("parses the run WebSocket contract", () => {
		expect(runClientMessageSchema.parse({ type: "start" })).toEqual({
			type: "start",
		});
		expect(
			runServerMessageSchema.parse({
				type: "status",
				status: "building",
			}),
		).toEqual({
			type: "status",
			status: "building",
		});
	});
});

describe("simulation API schemas", () => {
	test("parses sim command and Driver Station patch payloads", () => {
		expect(simRunCommandRequestSchema.parse({ action: "restart" })).toEqual({
			action: "restart",
		});
		expect(
			driverStationPatchSchema.parse({ enabled: false, mode: "teleop" }),
		).toEqual({
			enabled: false,
			mode: "teleop",
		});
		expect(driverStationPatchSchema.safeParse({}).success).toBe(false);
		expect(
			simRunCommandRequestSchema.safeParse({ action: "toggle" }).success,
		).toBe(false);
	});

	test("parses auto chooser payloads", () => {
		expect(
			autoChooserPatchSchema.parse({
				key: "SmartDashboard/Auto Choices",
				selected: "Taxi",
			}),
		).toEqual({
			key: "SmartDashboard/Auto Choices",
			selected: "Taxi",
		});
		expect(
			autoChoosersResponseSchema.parse({
				ok: true,
				nt4: {
					connection: "connected",
					connected: true,
					stale: false,
					lastMessageAt: new Date(0).toISOString(),
					error: null,
				},
				choosers: [
					{
						key: "SmartDashboard/Auto Choices",
						displayKey: "SmartDashboard/Auto Choices",
						options: ["Taxi", "Score"],
						default: "Taxi",
						active: "Score",
						selected: "Score",
					},
				],
			}),
		).toMatchObject({ choosers: [{ active: "Score" }] });
	});

	test("parses a full sim status snapshot", () => {
		expect(
			simStatusResponseSchema.parse({
				ok: true,
				workspace: { id: "ws_0123456789abcdef0123456789abcdef", slug: "alice" },
				container: { state: "running" },
				run: { status: "running", runId: "run_abc" },
				halsim: {
					connection: "connected",
					connected: true,
					stale: false,
					lastMessageAt: new Date(0).toISOString(),
					error: null,
				},
				driverStation: {
					enabled: false,
					mode: "teleop",
					eStopped: false,
					alliance: "red1",
				},
				comms: { canEnable: true },
				joysticks: {
					status: "unknown",
					port: null,
					label: null,
					lastInputAt: null,
				},
			}),
		).toMatchObject({
			run: { status: "running" },
			driverStation: { mode: "teleop" },
		});
	});
});

describe("lesson catalog schemas", () => {
	test("parses a well-formed manifest", () => {
		expect(
			lessonCatalogSchema.parse({
				schemaVersion: 1,
				modules: [
					{
						id: "hello-world",
						title: "Hello, World",
						description: "Variables and stdin.",
						subdir: "modules/hello-world",
						kind: "plain-java",
						order: 10,
					},
				],
			}),
		).toMatchObject({ modules: [{ id: "hello-world", kind: "plain-java" }] });
	});

	test("rejects an unknown module kind", () => {
		expect(
			lessonCatalogSchema.safeParse({
				schemaVersion: 1,
				modules: [
					{
						id: "x",
						title: "X",
						description: "",
						subdir: "modules/x",
						kind: "console",
						order: 10,
					},
				],
			}).success,
		).toBe(false);
	});

	test("rejects unsafe module subdir values", () => {
		for (const subdir of [
			"../escape",
			"/modules/hello-world",
			"modules/../escape",
			"modules/hello name",
			"modules/hello;rm",
			"modules/$HOME",
		]) {
			expect(
				lessonCatalogSchema.safeParse({
					schemaVersion: 1,
					modules: [
						{
							id: "x",
							title: "X",
							description: "",
							subdir,
							kind: "plain-java",
							order: 10,
						},
					],
				}).success,
			).toBe(false);
		}
	});

	test("lessonCatalogResponseSchema requires ok:true and modules", () => {
		expect(
			lessonCatalogResponseSchema.parse({
				ok: true,
				modules: [],
				error: null,
			}),
		).toMatchObject({ ok: true, modules: [] });
		expect(
			lessonCatalogResponseSchema.safeParse({ ok: false, modules: [] }).success,
		).toBe(false);
	});

	test("lessonLoadRequestSchema requires a non-empty moduleId", () => {
		expect(lessonLoadRequestSchema.parse({ moduleId: "hello-world" })).toEqual({
			moduleId: "hello-world",
		});
		expect(lessonLoadRequestSchema.safeParse({ moduleId: "" }).success).toBe(
			false,
		);
	});

	test("accepts the git kind and a module with checkpoints + setupScript", () => {
		const parsed = lessonCatalogSchema.parse({
			schemaVersion: 1,
			modules: [
				{
					id: "git-basics",
					title: "Git Basics",
					description: "Commit, branch, merge, and rebase.",
					subdir: "modules/git-basics",
					kind: "git",
					order: 5,
					setupScript: "checkpoints/git-basics/setup.sh",
					checkpoints: [
						{
							id: "first-commit",
							title: "First commit",
							description: "Add your name and commit it.",
							verifier: {
								type: "script",
								path: "checkpoints/git-basics/verify/first-commit.sh",
							},
						},
					],
				},
			],
		});
		expect(parsed.modules[0]).toMatchObject({ kind: "git" });
		expect(parsed.modules[0]?.checkpoints[0]).toMatchObject({
			id: "first-commit",
			optional: false,
		});
	});

	test("a module without checkpoints defaults to an empty list", () => {
		const parsed = lessonCatalogSchema.parse({
			schemaVersion: 1,
			modules: [
				{
					id: "hello-world",
					title: "Hello, World",
					description: "",
					subdir: "modules/hello-world",
					kind: "plain-java",
					order: 10,
				},
			],
		});
		expect(parsed.modules[0]?.checkpoints).toEqual([]);
	});

	test("rejects a non-kebab-case checkpoint id", () => {
		expect(
			lessonCatalogSchema.safeParse({
				schemaVersion: 1,
				modules: [
					{
						id: "x",
						title: "X",
						description: "",
						subdir: "modules/x",
						kind: "git",
						order: 10,
						checkpoints: [
							{
								id: "First_Commit",
								title: "X",
								description: "",
								verifier: { type: "script", path: "checkpoints/x/verify.sh" },
							},
						],
					},
				],
			}).success,
		).toBe(false);
	});

	test("rejects an unknown verifier type", () => {
		expect(
			lessonCatalogSchema.safeParse({
				schemaVersion: 1,
				modules: [
					{
						id: "x",
						title: "X",
						description: "",
						subdir: "modules/x",
						kind: "git",
						order: 10,
						checkpoints: [
							{
								id: "a",
								title: "X",
								description: "",
								verifier: { type: "junit", testClass: "frc.Foo" },
							},
						],
					},
				],
			}).success,
		).toBe(false);
	});
});

describe("checkpointsStateResponseSchema", () => {
	test("parses a state payload with mixed checkpoint results", () => {
		const parsed = checkpointsStateResponseSchema.parse({
			ok: true,
			state: {
				moduleId: "git-basics",
				available: true,
				checkpoints: [
					{
						id: "first-commit",
						title: "First commit",
						description: "",
						optional: false,
						verifier: { type: "script", path: "checkpoints/git-basics/a.sh" },
						result: {
							checkpointId: "first-commit",
							status: "passed",
							message: null,
							verifiedAt: new Date(0).toISOString(),
						},
					},
					{
						id: "rebase",
						title: "Rebase",
						description: "",
						optional: false,
						verifier: { type: "script", path: "checkpoints/git-basics/b.sh" },
						result: null,
					},
				],
			},
		});
		expect(
			parsed.state.checkpoints.map((c) => c.result?.status ?? "not-run"),
		).toEqual(["passed", "not-run"]);
	});

	test("rejects an unknown checkpoint status", () => {
		expect(
			checkpointsStateResponseSchema.safeParse({
				ok: true,
				state: {
					moduleId: "git-basics",
					available: true,
					checkpoints: [
						{
							id: "a",
							title: "A",
							description: "",
							optional: false,
							verifier: { type: "script", path: "checkpoints/x/a.sh" },
							result: {
								checkpointId: "a",
								status: "flaky",
								message: null,
								verifiedAt: null,
							},
						},
					],
				},
			}).success,
		).toBe(false);
	});
});

describe("importRequestSchema", () => {
	test("accepts a bare url and ignores legacy branch/subdir fields", () => {
		expect(
			importRequestSchema.parse({ url: "https://github.com/owner/repo" }),
		).toEqual({ url: "https://github.com/owner/repo" });
	});

	test("rejects an empty url", () => {
		expect(importRequestSchema.safeParse({ url: "" }).success).toBe(false);
	});

	test("importResponseSchema matches the validation endpoint response", () => {
		expect(
			importResponseSchema.parse({
				ok: true,
				cloneUrl: "https://github.com/owner/repo.git",
			}),
		).toEqual({ ok: true, cloneUrl: "https://github.com/owner/repo.git" });
	});
});

describe("gamepad message schemas", () => {
	test("accepts select / state / release frames", () => {
		expect(
			gamepadClientMessageSchema.parse({
				type: "select",
				id: "045e-0b13",
				label: "Xbox Wireless Controller",
			}),
		).toMatchObject({ type: "select" });

		expect(
			gamepadClientMessageSchema.parse({
				type: "state",
				seq: 42,
				state: {
					axes: [0.5, -0.25, 0, 0, 0, 0],
					buttons: [
						true,
						false,
						false,
						false,
						false,
						false,
						false,
						false,
						false,
						false,
					],
					povs: [90],
				},
			}),
		).toMatchObject({ type: "state", seq: 42 });

		expect(gamepadClientMessageSchema.parse({ type: "release" })).toEqual({
			type: "release",
		});
	});

	test("rejects out-of-range axis values", () => {
		expect(() =>
			gamepadStateSchema.parse({
				axes: [2.5, 0, 0, 0, 0, 0],
				buttons: [false],
				povs: [-1],
			}),
		).toThrow();
	});

	test("rejects too many axes", () => {
		expect(() =>
			gamepadStateSchema.parse({
				axes: new Array(20).fill(0),
				buttons: [false],
				povs: [-1],
			}),
		).toThrow();
	});

	test("server messages include hello / halsim-disconnected / error", () => {
		expect(gamepadServerMessageSchema.parse({ type: "hello" })).toEqual({
			type: "hello",
		});
		expect(
			gamepadServerMessageSchema.parse({ type: "halsim-disconnected" }),
		).toEqual({ type: "halsim-disconnected" });
		expect(
			gamepadServerMessageSchema.parse({
				type: "error",
				message: "Simulator is not running.",
			}),
		).toMatchObject({ type: "error" });
	});
});
