import { Gamepad2 } from "lucide-react";
import type { ReactNode } from "react";
import {
	createContext,
	useCallback,
	useContext,
	useMemo,
	useState,
} from "react";
import advantagescopeLogo from "@/assets/advantagescope-logo.png";
import choreoLogo from "@/assets/choreo-logo.png";
import elasticLogo from "@/assets/elastic-logo.png";
import vscodeLogo from "@/assets/vscode-logo.svg";
import type { ToolPaneKey } from "@/lib/contracts";
import { cn } from "@/lib/utils";

export type PaneKey =
	| "editor"
	| "scope"
	| "choreo"
	| "elastic"
	| "driverStation";

const PANE_KEYS: readonly PaneKey[] = [
	"editor",
	"scope",
	"choreo",
	"elastic",
	"driverStation",
];

const TOOL_PANE_KEYS: readonly ToolPaneKey[] = ["scope", "choreo", "elastic"];

// Panes whose group must keep at least one member visible - hiding all of
// them would leave the workbench row blank (its own panel isn't collapsible,
// only its children are), so the toggle refuses that combination. Driver
// Station isn't in this group: it's a full sibling row, and collapsing it
// just lets the workbench row above grow to fill the freed space, which is
// exactly the single-app-fullscreen behavior.
const WORKBENCH_PANE_KEYS: readonly PaneKey[] = [
	"editor",
	"scope",
	"choreo",
	"elastic",
];

export type PaneVisibility = Record<PaneKey, boolean>;

const STORAGE_KEY = "scriptum:pane-visibility";
const DEFAULT_VISIBILITY: PaneVisibility = {
	editor: true,
	scope: true,
	choreo: false,
	elastic: false,
	driverStation: true,
};

// Choreo's field canvas needs more width than a 3-pane split leaves it - it
// refuses to render below its own internal minimum and shows a "not enough
// space" placeholder instead of the actual path editor. AdvantageScope and
// Elastic tolerate that squeeze fine, so Choreo can't be visible alongside
// either: whichever of the three the student just turned on wins, and the
// other side of the conflict turns off - never a silent no-op on the button
// they just clicked.
function withChoreoSpace(
	visibility: PaneVisibility,
	justToggled?: PaneKey,
): PaneVisibility {
	if (!visibility.choreo || (!visibility.scope && !visibility.elastic)) {
		return visibility;
	}
	if (justToggled === "scope" || justToggled === "elastic") {
		return { ...visibility, choreo: false };
	}
	return { ...visibility, scope: false, elastic: false };
}

function readStoredVisibility(): PaneVisibility {
	try {
		const raw = sessionStorage.getItem(STORAGE_KEY);
		if (!raw) return DEFAULT_VISIBILITY;
		const parsed = JSON.parse(raw);
		const next: PaneVisibility = { ...DEFAULT_VISIBILITY };
		for (const key of PANE_KEYS) {
			if (typeof parsed[key] === "boolean") {
				next[key] = parsed[key];
			}
		}
		// Never trust a persisted state with every workbench pane hidden - it
		// would render a blank workbench with no way to bring anything back.
		// No "just toggled" key on initial load - fall back to Choreo losing.
		return WORKBENCH_PANE_KEYS.some((k) => next[k])
			? withChoreoSpace(next)
			: DEFAULT_VISIBILITY;
	} catch {
		return DEFAULT_VISIBILITY;
	}
}

/** Forces every tool pane not in `allowed` to false, regardless of stored
 * visibility - used so switching into a restricted lesson can't leave a
 * previously-toggled-on pane from another lesson visible. Also guarantees
 * at least one allowed pane stays visible: stored visibility might have
 * every allowed pane off (e.g. Choreo defaults to off in DEFAULT_VISIBILITY,
 * so a fresh choreo-intro session would otherwise show nothing but the
 * editor). `undefined` means unrestricted (every tool pane stays whatever
 * it already was). Never writes back to sessionStorage - this is a display
 * override, not a preference change. */
function applyToolRestriction(
	visibility: PaneVisibility,
	allowed: readonly ToolPaneKey[] | undefined,
): PaneVisibility {
	if (allowed === undefined) return visibility;
	const next = { ...visibility };
	for (const key of TOOL_PANE_KEYS) {
		if (!allowed.includes(key)) next[key] = false;
	}
	if (!allowed.some((key) => next[key])) {
		next[allowed[0]] = true;
	}
	return next;
}

interface PaneVisibilityContextValue {
	visible: PaneVisibility;
	toggle: (key: PaneKey) => void;
	/** Which tool panes this lesson allows - undefined means all of them.
	 * Consumed by `PaneToggleRow` to decide which buttons to render at all. */
	allowedTools: readonly ToolPaneKey[] | undefined;
}

const PaneVisibilityContext = createContext<PaneVisibilityContextValue | null>(
	null,
);

export function usePaneVisibility(): PaneVisibilityContextValue {
	const ctx = useContext(PaneVisibilityContext);
	if (!ctx) {
		throw new Error("usePaneVisibility must be used within PaneVisibilityRoot");
	}
	return ctx;
}

interface PaneVisibilityRootProps {
	className?: string;
	children: ReactNode;
	/** Restricts this lesson to a subset of the tool panes (scope/choreo/
	 * elastic) - e.g. `["scope"]` for the AdvantageScope-only lesson.
	 * Undefined (the default) leaves every tool pane available, which is
	 * what every module except the three single-tool lessons wants. */
	allowedTools?: readonly ToolPaneKey[];
}

/**
 * Shares which of the editor/AdvantageScope/Choreo panes are visible between
 * the topbar toggle row and IDELayout's resizable panels (siblings under
 * WorkspacePage). Almost any subset can be shown at once - toggling down to
 * a single pane makes it fill the whole workbench area, which is what gives
 * the "one app fullscreen" behavior without a separate maximize concept. The
 * one exception is Choreo, which forces AdvantageScope and Elastic off when
 * it's turned on (see withChoreoSpace). `allowedTools` layers a second,
 * lesson-driven restriction on top: the raw toggle state still lives in
 * sessionStorage (shared across whichever lessons a student visits in this
 * tab), but a disallowed pane is always reported and rendered as hidden,
 * and its toggle button doesn't render at all - see applyToolRestriction.
 */
export function PaneVisibilityRoot({
	className,
	children,
	allowedTools,
}: PaneVisibilityRootProps) {
	const [visible, setVisible] = useState<PaneVisibility>(readStoredVisibility);

	const toggle = useCallback((key: PaneKey) => {
		setVisible((prev) => {
			const next = withChoreoSpace({ ...prev, [key]: !prev[key] }, key);
			// Never allow hiding every workbench pane at once - there would be
			// nothing left to toggle it back on with. Driver Station is exempt:
			// it's free to toggle independently (see WORKBENCH_PANE_KEYS).
			if (WORKBENCH_PANE_KEYS.every((k) => !next[k])) {
				return prev;
			}
			try {
				sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
			} catch {
				// Session storage unavailable (private mode); the toggle still works.
			}
			return next;
		});
	}, []);

	const effectiveVisible = useMemo(
		() => applyToolRestriction(visible, allowedTools),
		[visible, allowedTools],
	);
	const value = useMemo(
		() => ({ visible: effectiveVisible, toggle, allowedTools }),
		[effectiveVisible, toggle, allowedTools],
	);

	return (
		<PaneVisibilityContext.Provider value={value}>
			<div className={className}>{children}</div>
		</PaneVisibilityContext.Provider>
	);
}

const PANE_LABELS: Record<PaneKey, string> = {
	editor: "Editor",
	scope: "AdvantageScope",
	choreo: "Choreo",
	elastic: "Elastic",
	driverStation: "Driver Station",
};

function PaneToggleButton({
	paneKey,
	icon,
}: {
	paneKey: PaneKey;
	icon: ReactNode;
}) {
	const { visible, toggle } = usePaneVisibility();
	const active = visible[paneKey];

	return (
		<button
			type="button"
			aria-pressed={active}
			onClick={() => toggle(paneKey)}
			className={cn(
				"relative inline-flex h-[calc(100%-1px)] items-center justify-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium whitespace-nowrap transition-all",
				"focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
				active
					? "bg-background text-foreground shadow-sm dark:border-input dark:bg-input/30"
					: "text-foreground/60 hover:text-foreground",
			)}
		>
			{icon}
			{PANE_LABELS[paneKey]}
		</button>
	);
}

/** Topbar toggle row: independently shows/hides each pane. Tool panes
 * (scope/choreo/elastic) this lesson's `allowedTools` excludes don't render
 * as buttons at all - there's nothing to toggle them to. Must sit inside
 * `PaneVisibilityRoot`. */
export function PaneToggleRow() {
	const { allowedTools } = usePaneVisibility();
	const showTool = (key: ToolPaneKey) =>
		allowedTools === undefined || allowedTools.includes(key);

	return (
		<div className="relative flex h-8 items-center gap-[3px] rounded-full border border-border bg-background p-[3px]">
			<PaneToggleButton
				paneKey="editor"
				icon={<img src={vscodeLogo} alt="" className="size-4 shrink-0" />}
			/>
			{showTool("scope") && (
				<PaneToggleButton
					paneKey="scope"
					icon={
						<img src={advantagescopeLogo} alt="" className="size-4 shrink-0" />
					}
				/>
			)}
			{showTool("choreo") && (
				<PaneToggleButton
					paneKey="choreo"
					icon={<img src={choreoLogo} alt="" className="size-4 shrink-0" />}
				/>
			)}
			{showTool("elastic") && (
				<PaneToggleButton
					paneKey="elastic"
					icon={<img src={elasticLogo} alt="" className="size-4 shrink-0" />}
				/>
			)}
			<PaneToggleButton
				paneKey="driverStation"
				icon={<Gamepad2 className="size-4 shrink-0" />}
			/>
		</div>
	);
}
