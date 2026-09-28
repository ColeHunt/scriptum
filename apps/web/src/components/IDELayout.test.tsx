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

function renderLayout(
	props: Partial<ComponentProps<typeof IDELayout>> = {},
	initialVisibility?: Record<string, boolean>,
) {
	if (initialVisibility) {
		sessionStorage.setItem(
			"scriptum:pane-visibility",
			JSON.stringify(initialVisibility),
		);
	}
	return render(
		<PaneVisibilityRoot>
			<IDELayout
				editor={<div>Editor</div>}
				scope={<div>Scope</div>}
				choreo={<div>Choreo</div>}
				elastic={<div>Elastic</div>}
				preview={<div>Preview</div>}
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

	test("renders editor, scope, choreo, elastic, and Driver Station in robot mode", () => {
		renderLayout();

		expect(screen.getByText("Editor")).toBeInTheDocument();
		expect(screen.getByText("Scope")).toBeInTheDocument();
		expect(screen.getByText("Choreo")).toBeInTheDocument();
		expect(screen.getByText("Elastic")).toBeInTheDocument();
		expect(screen.getByText("Driver Station")).toBeInTheDocument();
		expect(screen.queryByText(/Run this lesson from the editor/)).toBeNull();
	});

	test("Preview is mounted in robot mode too, alongside scope/choreo/elastic", () => {
		renderLayout();

		expect(document.querySelector('[data-pane="preview"]')).not.toBeNull();
		expect(screen.getByText("Preview")).toBeInTheDocument();
	});

	test("hides simulator panels in console lesson mode, but Preview stays available", () => {
		renderLayout({ showSimPanels: false });

		expect(screen.getByText("Editor")).toBeInTheDocument();
		expect(screen.queryByText("Scope")).toBeNull();
		expect(screen.queryByText("Choreo")).toBeNull();
		expect(screen.queryByText("Elastic")).toBeNull();
		expect(screen.queryByText("Driver Station")).toBeNull();
		expect(
			screen.getByText(/Run this lesson from the editor/),
		).toBeInTheDocument();
		// Mounted (so its document list can load in the background), even
		// though Preview defaults to collapsed like every other tool pane.
		expect(document.querySelector('[data-pane="preview"]')).not.toBeNull();
	});

	test("console lesson mode reveals Preview when toggled on in shared state", () => {
		renderLayout(
			{ showSimPanels: false },
			{ editor: true, scope: false, choreo: false, preview: true },
		);

		expect(screen.getByText("Editor")).toBeInTheDocument();
		expect(screen.getByText("Preview")).toBeInTheDocument();
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
		// Two independent persisted layouts: the outer workbench row
		// (editor/tools/preview) and the tools sub-group's own split
		// (scope/elastic/choreo) - see IDELayout's nested ToolsPanels.
		sessionStorage.setItem(
			"react-resizable-panels:ide-columns",
			JSON.stringify({ "ide-editor": 40, "ide-tools": 30, "ide-preview": 30 }),
		);
		sessionStorage.setItem(
			"react-resizable-panels:ide-tools-columns",
			JSON.stringify({ "ide-scope": 50, "ide-elastic": 30, "ide-choreo": 20 }),
		);

		renderLayout();

		expect(document.getElementById("ide-workbench")?.style.flexGrow).toBe("30");
		expect(document.getElementById("ide-console")?.style.flexGrow).toBe("70");
		expect(document.getElementById("ide-editor")?.style.flexGrow).toBe("40");
		expect(document.getElementById("ide-tools")?.style.flexGrow).toBe("30");
		expect(document.getElementById("ide-preview")?.style.flexGrow).toBe("30");
		expect(document.getElementById("ide-scope")?.style.flexGrow).toBe("50");
		expect(document.getElementById("ide-elastic")?.style.flexGrow).toBe("30");
		expect(document.getElementById("ide-choreo")?.style.flexGrow).toBe("20");
	});

	test("Preview's separator always pairs with exactly the tools panel, never scope/choreo/elastic directly", () => {
		// Regression test for the resize bug this nesting fixes: Preview's own
		// handle sits between the tools sub-group and Preview at every level,
		// never flush against scope/choreo/elastic - so there is only ever one
		// collapsed neighbor to walk through, not up to three stacked ones.
		renderLayout();

		const workbench = document.getElementById("ide-editor")?.parentElement;
		const directChildIds = Array.from(workbench?.children ?? [])
			.filter(
				(el) =>
					el.hasAttribute("data-panel") || el.hasAttribute("data-separator"),
			)
			.map((el) =>
				el.hasAttribute("data-separator")
					? el.getAttribute("data-pane")
					: el.id,
			);
		expect(directChildIds).toEqual([
			"ide-editor",
			"tools-handle",
			"ide-tools",
			"preview-handle",
			"ide-preview",
		]);
	});

	test("a pane toggled off in shared state stays mounted (not removed)", () => {
		// The actual collapse-to-zero-width behavior needs real layout
		// measurement, which jsdom's fake ResizeObserver can't provide -
		// covered instead by e2e/specs/workspace/choreo-pane.spec.ts in a
		// real browser. This just confirms the panel isn't unmounted, which
		// is what preserves the iframe's live state while hidden.
		sessionStorage.setItem(
			"scriptum:pane-visibility",
			JSON.stringify({ editor: true, scope: false, choreo: false }),
		);

		renderLayout();

		expect(document.querySelector('[data-pane="scope"]')).not.toBeNull();
		expect(screen.getByText("Scope")).toBeInTheDocument();
	});

	test("Driver Station toggled off in shared state stays mounted, letting the editor fill the screen", () => {
		sessionStorage.setItem(
			"scriptum:pane-visibility",
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
