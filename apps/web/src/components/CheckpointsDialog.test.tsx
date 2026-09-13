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
			/>,
		);
		expect(
			screen.getByText("A verify is already running."),
		).toBeInTheDocument();
	});
});
