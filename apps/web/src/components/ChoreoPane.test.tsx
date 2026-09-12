import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { ChoreoPane } from "./ChoreoPane";

describe("ChoreoPane", () => {
	test("renders the iframe pointed at the workspace's Choreo URL", () => {
		render(<ChoreoPane workspaceSlug="alice" />);
		const frame = screen.getByTitle<HTMLIFrameElement>("Choreo");
		expect(frame).toBeInTheDocument();
		expect(frame.getAttribute("src")).toBe("/choreo/?ws=alice");
	});

	test("shows the loading overlay until the iframe loads", () => {
		render(<ChoreoPane workspaceSlug="alice" />);
		expect(screen.getByText(/Loading Choreo/)).toBeInTheDocument();

		fireEvent.load(screen.getByTitle("Choreo"));
		expect(screen.queryByText(/Loading Choreo/)).toBeNull();
	});

	// A project swap (lesson load or team import) rewrites the deploy files on
	// disk. WorkspacePage remounts this pane by bumping its `key`, which must
	// give the iframe a fresh document so Choreo re-fetches the project
	// instead of writing its stale in-memory tree back over the new one.
	test("remounting drops the loaded iframe so the project is re-fetched", () => {
		const { rerender } = render(<ChoreoPane key={0} workspaceSlug="alice" />);
		const first = screen.getByTitle<HTMLIFrameElement>("Choreo");
		fireEvent.load(first);
		expect(screen.queryByText(/Loading Choreo/)).toBeNull();

		rerender(<ChoreoPane key={1} workspaceSlug="alice" />);

		const second = screen.getByTitle<HTMLIFrameElement>("Choreo");
		expect(second).not.toBe(first);
		expect(screen.getByText(/Loading Choreo/)).toBeInTheDocument();
	});

	test("renders a calm empty state without a slug, not a stuck spinner", () => {
		render(<ChoreoPane workspaceSlug={null} />);
		expect(screen.queryByTitle("Choreo")).toBeNull();
		expect(screen.queryByText(/Loading Choreo/)).toBeNull();
		expect(
			screen.getByText(/Choreo is not available for this module/),
		).toBeInTheDocument();
	});
});
