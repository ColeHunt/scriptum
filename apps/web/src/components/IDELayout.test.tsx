import { render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { IDELayout } from "./IDELayout";
import { PaneVisibilityRoot } from "./PaneVisibility";

class FakeResizeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
}

function renderLayout(props: Partial<ComponentProps<typeof IDELayout>> = {}) {
	return render(
		<PaneVisibilityRoot>
			<IDELayout
				editor={<div>Editor</div>}
				scope={<div>Scope</div>}
				choreo={<div>Choreo</div>}
				driverStation={<div>Driver Station</div>}
				{...props}
			/>
		</PaneVisibilityRoot>,
	);
}

describe("IDELayout", () => {
	const originalResizeObserver = globalThis.ResizeObserver;

	beforeEach(() => {
		globalThis.ResizeObserver = FakeResizeObserver as typeof ResizeObserver;
	});

	afterEach(() => {
		globalThis.ResizeObserver = originalResizeObserver;
		sessionStorage.clear();
	});

	test("renders editor, scope, choreo, and Driver Station in robot mode", () => {
		renderLayout();

		expect(screen.getByText("Editor")).toBeInTheDocument();
		expect(screen.getByText("Scope")).toBeInTheDocument();
		expect(screen.getByText("Choreo")).toBeInTheDocument();
		expect(screen.getByText("Driver Station")).toBeInTheDocument();
		expect(screen.queryByText(/Run this lesson from the editor/)).toBeNull();
	});

	test("hides simulator panels in console lesson mode", () => {
		renderLayout({ showSimPanels: false });

		expect(screen.getByText("Editor")).toBeInTheDocument();
		expect(screen.queryByText("Scope")).toBeNull();
		expect(screen.queryByText("Choreo")).toBeNull();
		expect(screen.queryByText("Driver Station")).toBeNull();
		expect(
			screen.getByText(/Run this lesson from the editor/),
		).toBeInTheDocument();
	});

	test("restores persisted pane sizes from sessionStorage", () => {
		sessionStorage.setItem(
			"react-resizable-panels:ide-rows",
			JSON.stringify({ "ide-workbench": 30, "ide-console": 70 }),
		);
		sessionStorage.setItem(
			"react-resizable-panels:ide-columns",
			JSON.stringify({
				"ide-editor": 50,
				"ide-scope": 25,
				"ide-choreo": 25,
			}),
		);

		renderLayout();

		expect(document.getElementById("ide-workbench")?.style.flexGrow).toBe("30");
		expect(document.getElementById("ide-console")?.style.flexGrow).toBe("70");
		expect(document.getElementById("ide-editor")?.style.flexGrow).toBe("50");
		expect(document.getElementById("ide-scope")?.style.flexGrow).toBe("25");
		expect(document.getElementById("ide-choreo")?.style.flexGrow).toBe("25");
	});

	test("a pane toggled off in shared state stays mounted (not removed)", () => {
		// The actual collapse-to-zero-width behavior needs real layout
		// measurement, which jsdom's fake ResizeObserver can't provide -
		// covered instead by e2e/specs/workspace/choreo-pane.spec.ts in a
		// real browser. This just confirms the panel isn't unmounted, which
		// is what preserves the iframe's live state while hidden.
		sessionStorage.setItem(
			"coderunner:pane-visibility",
			JSON.stringify({ editor: true, scope: false, choreo: false }),
		);

		renderLayout();

		expect(document.querySelector('[data-pane="scope"]')).not.toBeNull();
		expect(screen.getByText("Scope")).toBeInTheDocument();
	});

	test("Driver Station toggled off in shared state stays mounted, letting the editor fill the screen", () => {
		sessionStorage.setItem(
			"coderunner:pane-visibility",
			JSON.stringify({
				editor: true,
				scope: false,
				choreo: false,
				driverStation: false,
			}),
		);

		renderLayout();

		expect(document.querySelector('[data-pane="console"]')).not.toBeNull();
		expect(screen.getByText("Driver Station")).toBeInTheDocument();
	});
});
