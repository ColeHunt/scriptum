import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { CheckpointsState } from "@/lib/contracts";
import { CheckpointsDialog } from "./CheckpointsDialog";

const AVAILABLE_STATE: CheckpointsState = {
	moduleId: "git-basics",
	available: true,
	checkpoints: [
		{
			id: "first-commit",
			title: "First commit",
			description: "Add your name and commit it.",
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
			description: "Rebase the feature branch.",
			optional: false,
			verifier: { type: "script", path: "checkpoints/git-basics/b.sh" },
			result: {
				checkpointId: "rebase",
				status: "failed",
				message: "develop shouldn't change for this exercise.",
				verifiedAt: new Date(0).toISOString(),
			},
		},
	],
};

const ALL_PASSED_STATE: CheckpointsState = {
	moduleId: "git-basics",
	available: true,
	checkpoints: [
		AVAILABLE_STATE.checkpoints[0]!,
		{
			...AVAILABLE_STATE.checkpoints[1]!,
			result: {
				checkpointId: "rebase",
				status: "passed",
				message: null,
				verifiedAt: new Date(1).toISOString(),
			},
		},
	],
};

const UNAVAILABLE_STATE: CheckpointsState = {
	moduleId: null,
	available: false,
	checkpoints: [],
};

function noop() {}

describe("CheckpointsDialog", () => {
	test("shows an empty state when no checkpoints are available", () => {
		render(
			<CheckpointsDialog
				open
				onOpenChange={noop}
				state={UNAVAILABLE_STATE}
				loading={false}
				verifying={false}
				error={null}
				verify={async () => {}}
				onLaunchNewLesson={noop}
			/>,
		);

		expect(
			screen.getByText(/Load a lesson with checkpoints/),
		).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "Verify all" })).toBeNull();
	});

	test("lists checkpoints with their pass/fail state and failure message", () => {
		render(
			<CheckpointsDialog
				open
				onOpenChange={noop}
				state={AVAILABLE_STATE}
				loading={false}
				verifying={false}
				error={null}
				verify={async () => {}}
				onLaunchNewLesson={noop}
			/>,
		);

		expect(screen.getByText("First commit")).toBeInTheDocument();
		expect(screen.getByText("Rebase")).toBeInTheDocument();
		expect(
			screen.getByText("develop shouldn't change for this exercise."),
		).toBeInTheDocument();
		expect(
			screen.getByText("1 of 2 passing.", { exact: false }),
		).toBeInTheDocument();
	});

	test("Verify all calls verify with no arguments", () => {
		const verify = vi.fn().mockResolvedValue(undefined);
		render(
			<CheckpointsDialog
				open
				onOpenChange={noop}
				state={AVAILABLE_STATE}
				loading={false}
				verifying={false}
				error={null}
				verify={verify}
				onLaunchNewLesson={noop}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Verify all" }));
		expect(verify).toHaveBeenCalledWith();
	});

	test("a row's Verify button calls verify with just that checkpoint's id", () => {
		const verify = vi.fn().mockResolvedValue(undefined);
		render(
			<CheckpointsDialog
				open
				onOpenChange={noop}
				state={AVAILABLE_STATE}
				loading={false}
				verifying={false}
				error={null}
				verify={verify}
				onLaunchNewLesson={noop}
			/>,
		);

		fireEvent.click(screen.getAllByRole("button", { name: "Verify" })[0]!);
		expect(verify).toHaveBeenCalledWith(["first-commit"]);
	});

	test("shows the error banner when present", () => {
		render(
			<CheckpointsDialog
				open
				onOpenChange={noop}
				state={AVAILABLE_STATE}
				loading={false}
				verifying={false}
				error="A verify is already running."
				verify={async () => {}}
				onLaunchNewLesson={noop}
			/>,
		);
		expect(
			screen.getByText("A verify is already running."),
		).toBeInTheDocument();
	});

	test("does not celebrate when a lesson loads already fully passed", () => {
		render(
			<CheckpointsDialog
				open
				onOpenChange={noop}
				state={ALL_PASSED_STATE}
				loading={false}
				verifying={false}
				error={null}
				verify={async () => {}}
				onLaunchNewLesson={noop}
			/>,
		);

		expect(screen.queryByText("Lesson complete!")).toBeNull();
		expect(screen.getByText("Rebase")).toBeInTheDocument();
	});

	test("celebrates once a verify completes every required checkpoint, then 'Launch new lesson' opens the picker", () => {
		const onOpenChange = vi.fn();
		const onLaunchNewLesson = vi.fn();
		const { rerender } = render(
			<CheckpointsDialog
				open
				onOpenChange={onOpenChange}
				state={AVAILABLE_STATE}
				loading={false}
				verifying={false}
				error={null}
				verify={async () => {}}
				onLaunchNewLesson={onLaunchNewLesson}
			/>,
		);
		expect(screen.queryByText("Lesson complete!")).toBeNull();

		rerender(
			<CheckpointsDialog
				open
				onOpenChange={onOpenChange}
				state={ALL_PASSED_STATE}
				loading={false}
				verifying={false}
				error={null}
				verify={async () => {}}
				onLaunchNewLesson={onLaunchNewLesson}
			/>,
		);
		expect(screen.getByText("Lesson complete!")).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "Launch new lesson" }));
		expect(onOpenChange).toHaveBeenCalledWith(false);
		expect(onLaunchNewLesson).toHaveBeenCalledTimes(1);
	});

	test("'Continue experimenting' dismisses the celebration without opening the picker", () => {
		const onOpenChange = vi.fn();
		const onLaunchNewLesson = vi.fn();
		const { rerender } = render(
			<CheckpointsDialog
				open
				onOpenChange={onOpenChange}
				state={AVAILABLE_STATE}
				loading={false}
				verifying={false}
				error={null}
				verify={async () => {}}
				onLaunchNewLesson={onLaunchNewLesson}
			/>,
		);
		rerender(
			<CheckpointsDialog
				open
				onOpenChange={onOpenChange}
				state={ALL_PASSED_STATE}
				loading={false}
				verifying={false}
				error={null}
				verify={async () => {}}
				onLaunchNewLesson={onLaunchNewLesson}
			/>,
		);

		fireEvent.click(
			screen.getByRole("button", { name: "Continue experimenting" }),
		);
		expect(onOpenChange).toHaveBeenCalledWith(false);
		expect(onLaunchNewLesson).not.toHaveBeenCalled();
	});
});
