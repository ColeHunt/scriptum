import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import {
	PaneToggleRow,
	PaneVisibilityRoot,
	usePaneVisibility,
} from "./PaneVisibility";

function Probe() {
	const { visible } = usePaneVisibility();
	return <span data-testid="visible-state">{JSON.stringify(visible)}</span>;
}

function renderToggles() {
	return render(
		<PaneVisibilityRoot>
			<PaneToggleRow />
			<Probe />
		</PaneVisibilityRoot>,
	);
}

describe("PaneVisibility", () => {
	afterEach(() => {
		sessionStorage.clear();
	});

	test("defaults to editor + AdvantageScope + Driver Station visible, Choreo hidden", () => {
		renderToggles();

		expect(screen.getByRole("button", { name: "Editor" })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		expect(
			screen.getByRole("button", { name: "AdvantageScope" }),
		).toHaveAttribute("aria-pressed", "true");
		expect(screen.getByRole("button", { name: "Choreo" })).toHaveAttribute(
			"aria-pressed",
			"false",
		);
		expect(
			screen.getByRole("button", { name: "Driver Station" }),
		).toHaveAttribute("aria-pressed", "true");
	});

	test("toggling shows and hides independently, without excluding others", () => {
		renderToggles();

		fireEvent.click(screen.getByRole("button", { name: "Choreo" }));

		expect(screen.getByRole("button", { name: "Editor" })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		expect(
			screen.getByRole("button", { name: "AdvantageScope" }),
		).toHaveAttribute("aria-pressed", "true");
		expect(screen.getByRole("button", { name: "Choreo" })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
	});

	test("toggling the same pane off hides just that one", () => {
		renderToggles();

		fireEvent.click(screen.getByRole("button", { name: "AdvantageScope" }));

		expect(
			screen.getByRole("button", { name: "AdvantageScope" }),
		).toHaveAttribute("aria-pressed", "false");
		expect(screen.getByRole("button", { name: "Editor" })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
	});

	test("refuses to hide the last visible pane", () => {
		renderToggles();

		fireEvent.click(screen.getByRole("button", { name: "AdvantageScope" }));
		fireEvent.click(screen.getByRole("button", { name: "Editor" }));

		// Only Editor was left visible; clicking it again must be a no-op.
		expect(screen.getByRole("button", { name: "Editor" })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
	});

	test("persists the choice and restores it on remount", () => {
		const { unmount } = renderToggles();
		fireEvent.click(screen.getByRole("button", { name: "Choreo" }));
		unmount();

		renderToggles();

		expect(screen.getByRole("button", { name: "Choreo" })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
	});

	test("never restores a persisted all-hidden state", () => {
		sessionStorage.setItem(
			"fabrica:pane-visibility",
			JSON.stringify({ editor: false, scope: false, choreo: false }),
		);

		renderToggles();

		expect(screen.getByRole("button", { name: "Editor" })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
	});

	test("Driver Station toggles independently of the workbench guard, enabling a fullscreen IDE", () => {
		renderToggles();

		fireEvent.click(screen.getByRole("button", { name: "AdvantageScope" }));
		fireEvent.click(screen.getByRole("button", { name: "Driver Station" }));

		// Only Editor is left visible - allowed, since Driver Station isn't
		// part of the workbench-must-have-one-pane guard.
		expect(screen.getByRole("button", { name: "Editor" })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		expect(
			screen.getByRole("button", { name: "AdvantageScope" }),
		).toHaveAttribute("aria-pressed", "false");
		expect(
			screen.getByRole("button", { name: "Driver Station" }),
		).toHaveAttribute("aria-pressed", "false");
	});

	test("hiding Driver Station does not exempt the workbench from its own guard", () => {
		sessionStorage.setItem(
			"fabrica:pane-visibility",
			JSON.stringify({
				editor: false,
				scope: false,
				choreo: false,
				driverStation: false,
			}),
		);

		renderToggles();

		// A persisted state with every workbench pane hidden still resets to
		// the default, even though Driver Station was also hidden.
		expect(screen.getByRole("button", { name: "Editor" })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
	});
});
