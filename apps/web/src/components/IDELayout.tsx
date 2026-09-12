import { Play } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";
import {
	type PaneVisibility,
	usePaneVisibility,
} from "@/components/PaneVisibility";
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
	useResizableLayout,
} from "@/components/ui/resizable";

interface IDELayoutProps {
	editor: ReactNode;
	scope: ReactNode;
	choreo: ReactNode;
	driverStation: ReactNode;
	/**
	 * When false (a `plain-java` console lesson), AdvantageScope, Choreo, and
	 * Driver Station are hidden and the editor fills the workspace, with a
	 * hint to run from the editor's Run button. The pane toggles don't apply
	 * here - there's nothing to toggle.
	 */
	showSimPanels?: boolean;
}

/** Expands or collapses a panel to match `shouldShow`, if it isn't already. */
function syncPanel(
	ref: React.RefObject<PanelImperativeHandle | null>,
	shouldShow: boolean,
): void {
	const panel = ref.current;
	if (!panel) return;
	if (shouldShow && panel.isCollapsed()) panel.expand();
	if (!shouldShow && !panel.isCollapsed()) panel.collapse();
}

/**
 * Left-to-right order of the workbench columns, matching JSX render order.
 * react-resizable-panels' imperative `resize()` always redistributes against
 * one fixed neighbor - a non-last panel pairs with the one to its right, the
 * last panel pairs with the one to its left - so scope and choreo (indices 1
 * and 2) both resize against the same [scope, choreo] pivot. That means
 * collapsing scope directly can silently no-op whenever choreo is *already*
 * collapsed: the pivot has nowhere to put scope's freed space. Resizing left
 * to right instead lets each call push space through whatever's already
 * settled to its right, so a target combination is always reachable
 * regardless of which columns are hidden.
 */
type WorkbenchColumnKey = "editor" | "scope" | "choreo";

const WORKBENCH_COLUMN_ORDER: readonly WorkbenchColumnKey[] = [
	"editor",
	"scope",
	"choreo",
];

/** Recomputes an even split of 100% across whichever workbench columns are visible. */
function resizeWorkbenchColumns(
	refs: Record<
		WorkbenchColumnKey,
		React.RefObject<PanelImperativeHandle | null>
	>,
	visible: PaneVisibility,
): void {
	const visibleCount = WORKBENCH_COLUMN_ORDER.filter(
		(key) => visible[key],
	).length;
	const share = visibleCount > 0 ? 100 / visibleCount : 0;
	for (const key of WORKBENCH_COLUMN_ORDER) {
		// resize() takes a bare number as pixels, not percent - it needs an
		// explicit unit to target a share of the group.
		refs[key].current?.resize(`${visible[key] ? share : 0}%`);
	}
}

export function IDELayout({
	editor,
	scope,
	choreo,
	driverStation,
	showSimPanels = true,
}: IDELayoutProps) {
	// Pane sizes survive a refresh but not a new tab/session.
	const rows = useResizableLayout({
		id: "ide-rows",
		storage: sessionStorage,
	});
	const columns = useResizableLayout({
		id: "ide-columns",
		storage: sessionStorage,
	});

	const { visible } = usePaneVisibility();
	const editorRef = useRef<PanelImperativeHandle>(null);
	const scopeRef = useRef<PanelImperativeHandle>(null);
	const choreoRef = useRef<PanelImperativeHandle>(null);
	const driverStationRef = useRef<PanelImperativeHandle>(null);
	// Tracks the last (editor, scope, choreo) visibility combo an even-split
	// resize was computed for, so a Driver Station-only toggle doesn't reset
	// any manual drag the student has done between the workbench columns.
	const workbenchComboRef = useRef<string>("");

	// The toggle row (Topbar) and these panels are siblings under
	// WorkspacePage, so visibility is driven imperatively from shared
	// context rather than by conditionally rendering panels - each stays
	// mounted (collapsed to 0 size) so its iframe never reloads, the same
	// reasoning PaneVisibility/ChoreoPane/ScopePane already document.
	useEffect(() => {
		const combo = WORKBENCH_COLUMN_ORDER.map((key) =>
			visible[key] ? "1" : "0",
		).join("");
		if (workbenchComboRef.current !== combo) {
			workbenchComboRef.current = combo;
			resizeWorkbenchColumns(
				{ editor: editorRef, scope: scopeRef, choreo: choreoRef },
				visible,
			);
		}
		syncPanel(driverStationRef, visible.driverStation);
	}, [visible]);

	if (!showSimPanels) {
		return (
			<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
				<div className="min-h-0 min-w-0 flex-1 bg-card">{editor}</div>
				<div
					data-pane="console-hint"
					className="flex shrink-0 items-center gap-2 border-t border-border bg-card px-4 py-2 text-[12px] text-muted-foreground"
				>
					<Play className="size-3.5 text-primary" />
					Run this lesson from the editor's Run button (▷ top-right of the
					file).
				</div>
			</div>
		);
	}

	return (
		<ResizablePanelGroup
			orientation="vertical"
			className="min-h-0 flex-1 overflow-hidden"
			defaultLayout={rows.defaultLayout}
			onLayoutChanged={rows.onLayoutChanged}
		>
			<ResizablePanel
				id="ide-workbench"
				defaultSize={75}
				minSize={20}
				className="min-h-0"
			>
				<ResizablePanelGroup
					orientation="horizontal"
					className="min-h-0"
					defaultLayout={columns.defaultLayout}
					onLayoutChanged={columns.onLayoutChanged}
				>
					<ResizablePanel
						id="ide-editor"
						panelRef={editorRef}
						collapsible
						collapsedSize={0}
						defaultSize={40}
						minSize={20}
						data-pane="editor"
						className="min-h-0"
					>
						<div className="h-full min-h-0 min-w-0 bg-card">{editor}</div>
					</ResizablePanel>
					<ResizableHandle withHandle data-pane="scope-handle" />
					<ResizablePanel
						id="ide-scope"
						panelRef={scopeRef}
						collapsible
						collapsedSize={0}
						defaultSize={30}
						minSize={20}
						className="min-h-0"
						data-pane="scope"
					>
						{scope}
					</ResizablePanel>
					<ResizableHandle withHandle data-pane="choreo-handle" />
					<ResizablePanel
						id="ide-choreo"
						panelRef={choreoRef}
						collapsible
						collapsedSize={0}
						defaultSize={30}
						minSize={20}
						className="min-h-0"
						data-pane="choreo"
					>
						{choreo}
					</ResizablePanel>
				</ResizablePanelGroup>
			</ResizablePanel>
			<ResizableHandle withHandle />
			<ResizablePanel
				id="ide-console"
				panelRef={driverStationRef}
				collapsible
				collapsedSize={0}
				defaultSize={25}
				minSize={15}
				data-pane="console"
				className="min-h-0 overflow-hidden"
			>
				{driverStation}
			</ResizablePanel>
		</ResizablePanelGroup>
	);
}
