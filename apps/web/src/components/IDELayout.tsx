import { Play } from "lucide-react";
import { Fragment, type ReactNode, useEffect, useRef } from "react";
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
 * Resizes `keys[i]`'s panel to an even share of whichever are visible, or 0%
 * if hidden. Calls `.resize()` left to right: react-resizable-panels' drag
 * math always redistributes against ONE fixed DOM neighbor (a non-last panel
 * against the one to its right, the last against the one to its left), and
 * this same pairing governs `.resize()` too, so processing left to right lets
 * each call push space through whatever's already settled to its right -
 * otherwise collapsing an earlier panel can silently no-op when its pivot
 * neighbor has nothing to give.
 *
 * This is also *why* the workbench row nests AdvantageScope/Choreo/Elastic in
 * their own sub-group (see IDELayout below) instead of sitting flat between
 * editor and Preview: with three always-mounted, frequently-collapsed panels
 * in a row, Preview's own separator is permanently pivot-paired with
 * whichever of them sits immediately to its left in the DOM (Elastic) - not
 * with whatever's actually visible next to it on screen. A user drag (unlike
 * this function's own `.resize()` calls) has to walk that same pivot chain
 * live, and with three stacked zero-width panels in the way it can grab the
 * wrong one or need an extra "unstick" drag before it responds - the panel
 * looks pinned to the right with barely any room until you fight it. Keeping
 * each nesting level to at most a couple of real siblings keeps every
 * separator's pivot pair obvious and short.
 */
function resizeEvenSplit<K extends string>(
	order: readonly K[],
	refs: Record<K, React.RefObject<PanelImperativeHandle | null>>,
	isVisible: (key: K) => boolean,
): void {
	const visibleCount = order.filter(isVisible).length;
	const share = visibleCount > 0 ? 100 / visibleCount : 0;
	for (const key of order) {
		// resize() takes a bare number as pixels, not percent - it needs an
		// explicit unit to target a share of the group.
		refs[key].current?.resize(`${isVisible(key) ? share : 0}%`);
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

type ToolKey = "scope" | "elastic" | "choreo";

/**
 * Order here is deliberate: Choreo is mutually exclusive with the other two
 * (withChoreoSpace, in PaneVisibility), so it's either the sole visible tool
 * (filling this whole sub-group) or fully collapsed - never sandwiched
 * between two visible siblings the way it would be in toggle-button order
 * (scope, choreo, elastic). Trailing it here means the common "AdvantageScope
 * and Elastic both on, Choreo off" combination leaves them next to each
 * other with nothing collapsed in between, and vice versa. See
 * resizeEvenSplit's docs for why that placement matters for dragging.
 */
const TOOL_ORDER: readonly ToolKey[] = ["scope", "elastic", "choreo"];

/** AdvantageScope | Choreo | Elastic, nested as their own sub-group so the
 * panels on either side (editor, Preview) never pivot-pair against whichever
 * of these three happens to sit at the group's own edge - see
 * resizeEvenSplit's docs. */
function ToolsPanels({
	scope,
	choreo,
	elastic,
	visible,
	refs,
}: {
	scope: ReactNode;
	choreo: ReactNode;
	elastic: ReactNode;
	visible: PaneVisibility;
	refs: Record<ToolKey, React.RefObject<PanelImperativeHandle | null>>;
}) {
	const columns = useResizableLayout({
		id: "ide-tools-columns",
		storage: sessionStorage,
	});
	const comboRef = useRef<string>("");

	useEffect(() => {
		const combo = TOOL_ORDER.map((key) => (visible[key] ? "1" : "0")).join("");
		if (comboRef.current !== combo) {
			comboRef.current = combo;
			resizeEvenSplit(TOOL_ORDER, refs, (key) => visible[key]);
		}
	}, [visible, refs]);

	const content: Record<ToolKey, ReactNode> = { scope, choreo, elastic };

	return (
		<ResizablePanelGroup
			orientation="horizontal"
			className="min-h-0"
			defaultLayout={columns.defaultLayout}
			onLayoutChanged={columns.onLayoutChanged}
		>
			{TOOL_ORDER.map((key, index) => (
				<Fragment key={key}>
					{index > 0 && (
						<ResizableHandle withHandle data-pane={`${key}-handle`} />
					)}
					<ResizablePanel
						id={`ide-${key}`}
						panelRef={refs[key]}
						collapsible
						collapsedSize={0}
						defaultSize={30}
						minSize={20}
						className="min-h-0"
						data-pane={key}
					>
						{content[key]}
					</ResizablePanel>
				</Fragment>
			))}
		</ResizablePanelGroup>
	);
}

type WorkbenchColumnKey = "editor" | "tools" | "preview";

const WORKBENCH_COLUMN_ORDER: readonly WorkbenchColumnKey[] = [
	"editor",
	"tools",
	"preview",
];

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
	const toolsRef = useRef<PanelImperativeHandle>(null);
	const scopeRef = useRef<PanelImperativeHandle>(null);
	const choreoRef = useRef<PanelImperativeHandle>(null);
	const elasticRef = useRef<PanelImperativeHandle>(null);
	const previewRef = useRef<PanelImperativeHandle>(null);
	const driverStationRef = useRef<PanelImperativeHandle>(null);
	const toolRefs: Record<
		ToolKey,
		React.RefObject<PanelImperativeHandle | null>
	> = { scope: scopeRef, choreo: choreoRef, elastic: elasticRef };
	// Tracks the last (editor, tools, preview) visibility combo an even-split
	// resize was computed for, so a Driver Station-only toggle - or a change
	// among scope/choreo/elastic that doesn't flip whether *any* tool is
	// visible - doesn't reset any manual drag the student has done between
	// the workbench columns.
	const workbenchComboRef = useRef<string>("");

	const toolsVisible = visible.scope || visible.choreo || visible.elastic;
	const editorVisible = visible.editor;
	const previewVisible = visible.preview;
	const driverStationVisible = visible.driverStation;

	// The toggle row (Topbar) and these panels are siblings under
	// WorkspacePage, so visibility is driven imperatively from shared
	// context rather than by conditionally rendering panels - each stays
	// mounted (collapsed to 0 size) so its iframe never reloads, the same
	// reasoning PaneVisibility/ChoreoPane/ScopePane already document.
	useEffect(() => {
		const outerVisible: Record<WorkbenchColumnKey, boolean> = {
			editor: editorVisible,
			tools: toolsVisible,
			preview: previewVisible,
		};
		const combo = WORKBENCH_COLUMN_ORDER.map((key) =>
			outerVisible[key] ? "1" : "0",
		).join("");
		if (workbenchComboRef.current !== combo) {
			workbenchComboRef.current = combo;
			resizeEvenSplit(
				WORKBENCH_COLUMN_ORDER,
				{ editor: editorRef, tools: toolsRef, preview: previewRef },
				(key) => outerVisible[key],
			);
		}
		syncPanel(driverStationRef, driverStationVisible);
	}, [editorVisible, toolsVisible, previewVisible, driverStationVisible]);

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
					<ResizableHandle withHandle data-pane="tools-handle" />
					<ResizablePanel
						id="ide-tools"
						panelRef={toolsRef}
						collapsible
						collapsedSize={0}
						defaultSize={30}
						minSize={20}
						className="min-h-0"
						data-pane="tools"
					>
						<ToolsPanels
							scope={scope}
							choreo={choreo}
							elastic={elastic}
							visible={visible}
							refs={toolRefs}
						/>
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
