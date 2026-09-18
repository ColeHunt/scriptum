import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { SwitchProjectDialog } from "./SwitchProjectDialog";

const TRACKED_CATALOG = {
	ok: true,
	error: null,
	modules: [
		{
			id: "git-basics",
			title: "Git Basics",
			description: "Commit, branch, merge.",
			subdir: "modules/git-basics",
			kind: "git",
			order: 5,
			checkpoints: [],
			requires: [],
			track: "Tools",
			locked: false,
			missingPrerequisites: [],
			completed: false,
		},
		{
			id: "robot-starter",
			title: "Robot Starter",
			description: "A starter robot project.",
			subdir: "modules/robot-starter",
			kind: "robot",
			order: 20,
			checkpoints: [],
			requires: ["git-basics"],
			track: "FRC Robot",
			locked: true,
			missingPrerequisites: ["Git Basics"],
			completed: false,
		},
		{
			id: "hello-world",
			title: "Hello, World",
			description: "Variables and stdin.",
			subdir: "modules/hello-world",
			kind: "plain-java",
			order: 10,
			checkpoints: [],
			requires: [],
			track: "Java Basics",
			locked: false,
			missingPrerequisites: [],
			completed: false,
		},
		{
			id: "untracked-lesson",
			title: "Untracked Lesson",
			description: "No track set.",
			subdir: "modules/untracked",
			kind: "plain-java",
			order: 100,
			checkpoints: [],
			requires: [],
			locked: false,
			missingPrerequisites: [],
			completed: false,
		},
	],
};

const LOCKING_CATALOG = {
	ok: true,
	error: null,
	modules: [
		{
			id: "git-basics",
			title: "Git Basics",
			description: "Commit, branch, merge.",
			subdir: "modules/git-basics",
			kind: "git",
			order: 5,
			checkpoints: [],
			requires: [],
			locked: false,
			missingPrerequisites: [],
			completed: false,
		},
		{
			id: "robot-starter",
			title: "Robot Starter",
			description: "A starter robot project.",
			subdir: "modules/robot-starter",
			kind: "robot",
			order: 20,
			checkpoints: [],
			requires: ["git-basics"],
			locked: true,
			missingPrerequisites: ["Git Basics"],
			completed: false,
		},
	],
};

const COMPLETED_CATALOG = {
	ok: true,
	error: null,
	modules: [
		{
			id: "git-basics",
			title: "Git Basics",
			description: "Commit, branch, merge.",
			subdir: "modules/git-basics",
			kind: "git",
			order: 5,
			checkpoints: [
				{
					id: "first-commit",
					title: "First commit",
					description: "",
					optional: false,
					verifier: { type: "script", path: "checkpoints/git-basics/a.sh" },
				},
			],
			requires: [],
			locked: false,
			missingPrerequisites: [],
			completed: true,
		},
		{
			id: "hello-world",
			title: "Hello, World",
			description: "Variables and stdin.",
			subdir: "modules/hello-world",
			kind: "plain-java",
			order: 10,
			checkpoints: [
				{
					id: "print",
					title: "Print",
					description: "",
					optional: false,
					verifier: { type: "script", path: "checkpoints/hello-world/a.sh" },
				},
			],
			requires: [],
			locked: false,
			missingPrerequisites: [],
			completed: false,
		},
	],
};

function noop() {}

describe("SwitchProjectDialog — track grouping", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	test("groups lessons under their track headings, ordered by curriculum sequence, with untracked lessons last", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve(TRACKED_CATALOG),
			}),
		);

		render(
			<SwitchProjectDialog
				open
				onOpenChange={noop}
				workspaceSlug="test-slug"
				currentModule={null}
				onSwapComplete={noop}
			/>,
		);

		await waitFor(() => expect(screen.getByText("Tools")).toBeInTheDocument());
		expect(screen.getByText("Java Basics")).toBeInTheDocument();
		expect(screen.getByText("FRC Robot")).toBeInTheDocument();
		// The generic fallback heading for modules with no track.
		expect(screen.getByText("Lessons")).toBeInTheDocument();

		const headings = screen
			.getAllByRole("heading", { level: 3 })
			.map((el) => el.textContent);
		// git-basics (order 5) < hello-world (order 10) < robot-starter (order 20);
		// the untracked group always sorts last regardless of its own order.
		// "Import from GitHub" is the dialog's own trailing section, also an h3.
		expect(headings).toEqual([
			"Tools",
			"Java Basics",
			"FRC Robot",
			"Lessons",
			"Import from GitHub",
		]);
	});
});

describe("SwitchProjectDialog — whole-lesson locking", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	test("shows a disabled Locked button and the missing prerequisite for a locked lesson", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve(LOCKING_CATALOG),
			}),
		);

		render(
			<SwitchProjectDialog
				open
				onOpenChange={noop}
				workspaceSlug="test-slug"
				currentModule={null}
				onSwapComplete={noop}
			/>,
		);

		await waitFor(() =>
			expect(
				screen.getByText("Robot Starter", { exact: false }),
			).toBeInTheDocument(),
		);

		expect(screen.getByText("Requires Git Basics")).toBeInTheDocument();
		const lockedButton = screen.getByRole("button", { name: "Locked" });
		expect(lockedButton).toBeDisabled();

		// The unlocked lesson still gets a normal, enabled Load button.
		const loadButtons = screen.getAllByRole("button", { name: "Load" });
		expect(loadButtons).toHaveLength(1);
		expect(loadButtons[0]).toBeEnabled();
	});
});

describe("SwitchProjectDialog — completed lessons", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	test("shows a green checkmark only on the completed lesson", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve(COMPLETED_CATALOG),
			}),
		);

		render(
			<SwitchProjectDialog
				open
				onOpenChange={noop}
				workspaceSlug="test-slug"
				currentModule={null}
				onSwapComplete={noop}
			/>,
		);

		await waitFor(() =>
			expect(screen.getByText("Git Basics")).toBeInTheDocument(),
		);

		expect(screen.getAllByTitle("Completed")).toHaveLength(1);
	});
});
