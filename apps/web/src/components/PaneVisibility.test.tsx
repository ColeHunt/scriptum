import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import type { ToolPaneKey } from "@/lib/contracts";
import {
	PaneToggleRow,
	PaneVisibilityRoot,
	usePaneVisibility,
} from "./PaneVisibility";

function Probe() {
	const { visible } = usePaneVisibility();
	return <span data-testid="visible-state">{JSON.stringify(visible)}</span>;
}

function renderToggles(allowedTools?: readonly ToolPaneKey[]) {
	return render(
		<PaneVisibilityRoot allowedTools={allowedTools}>
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

		fireEvent.click(screen.getByRole("button", { name: "Driver Station" }));

		expect(screen.getByRole("button", { name: "Editor" })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		expect(
			screen.getByRole("button", { name: "AdvantageScope" }),
		).toHaveAttribute("aria-pressed", "true");
		expect(
			screen.getByRole("button", { name: "Driver Station" }),
		).toHaveAttribute("aria-pressed", "false");
	});

	test("turning Choreo on collapses AdvantageScope - its canvas doesn't fit a 3-pane split", () => {
		renderToggles();

		fireEvent.click(screen.getByRole("button", { name: "Choreo" }));

		expect(screen.getByRole("button", { name: "Choreo" })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		expect(
			screen.getByRole("button", { name: "AdvantageScope" }),
		).toHaveAttribute("aria-pressed", "false");
		expect(screen.getByRole("button", { name: "Editor" })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
	});

	test("turning Choreo on collapses Elastic too", () => {
		renderToggles();

		fireEvent.click(screen.getByRole("button", { name: "Elastic" }));
		fireEvent.click(screen.getByRole("button", { name: "Choreo" }));

		expect(screen.getByRole("button", { name: "Choreo" })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		expect(screen.getByRole("button", { name: "Elastic" })).toHaveAttribute(
			"aria-pressed",
			"false",
		);
	});

	test("turning AdvantageScope on while Choreo is active turns Choreo off instead of no-op'ing", () => {
		renderToggles();

		fireEvent.click(screen.getByRole("button", { name: "Choreo" }));
		fireEvent.click(screen.getByRole("button", { name: "AdvantageScope" }));

		expect(
			screen.getByRole("button", { name: "AdvantageScope" }),
		).toHaveAttribute("aria-pressed", "true");
		expect(screen.getByRole("button", { name: "Choreo" })).toHaveAttribute(
			"aria-pressed",
			"false",
		);
	});

	test("turning Elastic on while Choreo is active turns Choreo off instead of no-op'ing", () => {
		renderToggles();

		fireEvent.click(screen.getByRole("button", { name: "Choreo" }));
		fireEvent.click(screen.getByRole("button", { name: "Elastic" }));

		expect(screen.getByRole("button", { name: "Elastic" })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		expect(screen.getByRole("button", { name: "Choreo" })).toHaveAttribute(
			"aria-pressed",
			"false",
		);
	});

	test("sanitizes a stale persisted state with both Choreo and AdvantageScope visible", () => {
		sessionStorage.setItem(
			"scriptum:pane-visibility",
			JSON.stringify({ editor: true, scope: true, choreo: true }),
		);

		renderToggles();

		expect(screen.getByRole("button", { name: "Choreo" })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		expect(
			screen.getByRole("button", { name: "AdvantageScope" }),
		).toHaveAttribute("aria-pressed", "false");
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
			"scriptum:pane-visibility",
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
			"scriptum:pane-visibility",
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

describe("PaneVisibility restrictTools", () => {
	afterEach(() => {
		sessionStorage.clear();
	});

	test("only the allowed tool's toggle button renders", () => {
		renderToggles(["choreo"]);

		expect(screen.getByRole("button", { name: "Editor" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Choreo" })).toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: "AdvantageScope" }),
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: "Elastic" }),
		).not.toBeInTheDocument();
		// Driver Station is never restricted.
		expect(
			screen.getByRole("button", { name: "Driver Station" }),
		).toBeInTheDocument();
	});

	test("the allowed tool is visible by default even though Choreo defaults to off", () => {
		renderToggles(["choreo"]);

		expect(screen.getByRole("button", { name: "Choreo" })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
	});

	test("a pane left visible from another lesson is forced hidden on entry", () => {
		// Simulates having toggled AdvantageScope on in an unrestricted lesson,
		// then switching to the Choreo-only lesson in the same tab/session.
		sessionStorage.setItem(
			"scriptum:pane-visibility",
			JSON.stringify({
				editor: true,
				scope: true,
				choreo: false,
				elastic: false,
				driverStation: true,
			}),
		);

		renderToggles(["choreo"]);

		const probe = screen.getByTestId("visible-state");
		const visible = JSON.parse(probe.textContent ?? "{}");
		expect(visible.scope).toBe(false);
		expect(visible.elastic).toBe(false);
		expect(visible.choreo).toBe(true);
	});

	test("undefined allowedTools renders every tool button, unchanged from before", () => {
		renderToggles(undefined);

		expect(
			screen.getByRole("button", { name: "AdvantageScope" }),
		).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Choreo" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Elastic" })).toBeInTheDocument();
	});
});
