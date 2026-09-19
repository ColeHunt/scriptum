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
	elastic: ReactNode;
	preview: ReactNode;
	driverStation: ReactNode;
	/**
	 * When false (a `plain-java` console lesson), AdvantageScope, Choreo,
	 * Elastic, and Driver Station are hidden - there's no live sim to show.
	 * Preview is the exception: it reads the project's own files, not the
	 * sim, so it stays available (editor | Preview) even here.
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
 * last panel pairs with the one to its left - so scope, choreo, elastic, and
 * preview (indices 1-4) all resize against whichever of them is rightmost.
 * That means collapsing scope directly can silently no-op whenever
 * everything to its right is *already* collapsed: the pivot has nowhere to
 * put scope's freed space. Resizing left to right instead lets each call
 * push space through whatever's already settled to its right, so a target
 * combination is always reachable regardless of which columns are hidden.
 */
type WorkbenchColumnKey = "editor" | "scope" | "choreo" | "elastic" | "preview";

const WORKBENCH_COLUMN_ORDER: readonly WorkbenchColumnKey[] = [
	"editor",
	"scope",
	"choreo",
	"elastic",
	"preview",
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

/** editor | Preview split for a console lesson, which has no sim panes at
 * all - a separate, minimal resizable group rather than reusing the full
 * workbench one below, since nothing else here ever applies. */
function ConsoleLayout({
	editor,
	preview,
}: {
	editor: ReactNode;
	preview: ReactNode;
}) {
	const columns = useResizableLayout({
		id: "ide-console-columns",
		storage: sessionStorage,
	});
	const { visible } = usePaneVisibility();
	const previewRef = useRef<PanelImperativeHandle>(null);

	useEffect(() => {
		syncPanel(previewRef, visible.preview);
	}, [visible.preview]);

	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
			<ResizablePanelGroup
				orientation="horizontal"
				className="min-h-0 flex-1"
				defaultLayout={columns.defaultLayout}
				onLayoutChanged={columns.onLayoutChanged}
			>
				<ResizablePanel
					id="ide-console-editor"
					collapsible
					collapsedSize={0}
					defaultSize={60}
					minSize={20}
					data-pane="editor"
					className="min-h-0"
				>
					<div className="h-full min-h-0 min-w-0 bg-card">{editor}</div>
				</ResizablePanel>
				<ResizableHandle withHandle data-pane="preview-handle" />
				<ResizablePanel
					id="ide-console-preview"
					panelRef={previewRef}
					collapsible
					collapsedSize={0}
					defaultSize={visible.preview ? 40 : 0}
					minSize={20}
					className="min-h-0"
					data-pane="preview"
				>
					{preview}
				</ResizablePanel>
			</ResizablePanelGroup>
			<div
				data-pane="console-hint"
				className="flex shrink-0 items-center gap-2 border-t border-border bg-card px-4 py-2 text-[12px] text-muted-foreground"
			>
				<Play className="size-3.5 text-primary" />
				Run this lesson from the editor's Run button (▷ top-right of the file).
			</div>
		</div>
	);
}

export function IDELayout({
	editor,
	scope,
	choreo,
	elastic,
	preview,
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
	const elasticRef = useRef<PanelImperativeHandle>(null);
	const previewRef = useRef<PanelImperativeHandle>(null);
	const driverStationRef = useRef<PanelImperativeHandle>(null);
	// Tracks the last (editor, scope, choreo, elastic, preview) visibility
	// combo an even-split resize was computed for, so a Driver Station-only
	// toggle doesn't reset any manual drag the student has done between the
	// workbench columns.
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
				{
					editor: editorRef,
					scope: scopeRef,
					choreo: choreoRef,
					elastic: elasticRef,
					preview: previewRef,
				},
				visible,
			);
		}
		syncPanel(driverStationRef, visible.driverStation);
	}, [visible]);

	if (!showSimPanels) {
		return <ConsoleLayout editor={editor} preview={preview} />;
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
					<ResizableHandle withHandle data-pane="elastic-handle" />
					<ResizablePanel
						id="ide-elastic"
						panelRef={elasticRef}
						collapsible
						collapsedSize={0}
						defaultSize={30}
						minSize={20}
						className="min-h-0"
						data-pane="elastic"
					>
						{elastic}
					</ResizablePanel>
					<ResizableHandle withHandle data-pane="preview-handle" />
					<ResizablePanel
						id="ide-preview"
						panelRef={previewRef}
						collapsible
						collapsedSize={0}
						defaultSize={30}
						minSize={20}
						className="min-h-0"
						data-pane="preview"
					>
						{preview}
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
