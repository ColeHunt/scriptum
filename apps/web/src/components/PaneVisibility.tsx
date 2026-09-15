import { Code, Gamepad2, LayoutDashboard, Waypoints } from "lucide-react";
import type { ReactNode } from "react";
import {
	createContext,
	useCallback,
	useContext,
	useMemo,
	useState,
} from "react";
import advantagescopeLogo from "@/assets/advantagescope-logo.png";
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

const STORAGE_KEY = "coderunner:pane-visibility";
const DEFAULT_VISIBILITY: PaneVisibility = {
	editor: true,
	scope: true,
	choreo: false,
	elastic: false,
	driverStation: true,
};

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
		return WORKBENCH_PANE_KEYS.some((k) => next[k]) ? next : DEFAULT_VISIBILITY;
	} catch {
		return DEFAULT_VISIBILITY;
	}
}

interface PaneVisibilityContextValue {
	visible: PaneVisibility;
	toggle: (key: PaneKey) => void;
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
}

/**
 * Shares which of the editor/AdvantageScope/Choreo panes are visible between
 * the topbar toggle row and IDELayout's resizable panels (siblings under
 * WorkspacePage). Any subset can be shown at once - toggling down to a
 * single pane makes it fill the whole workbench area, which is what gives
 * the "one app fullscreen" behavior without a separate maximize concept.
 */
export function PaneVisibilityRoot({
	className,
	children,
}: PaneVisibilityRootProps) {
	const [visible, setVisible] = useState<PaneVisibility>(readStoredVisibility);

	const toggle = useCallback((key: PaneKey) => {
		setVisible((prev) => {
			const next = { ...prev, [key]: !prev[key] };
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

	const value = useMemo(() => ({ visible, toggle }), [visible, toggle]);

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

/** Topbar toggle row: independently shows/hides each pane. Must sit inside `PaneVisibilityRoot`. */
export function PaneToggleRow() {
	return (
		<div className="relative flex h-8 items-center gap-[3px] rounded-full border border-border bg-background p-[3px]">
			<PaneToggleButton
				paneKey="editor"
				icon={<Code className="size-4 shrink-0" />}
			/>
			<PaneToggleButton
				paneKey="scope"
				icon={
					<img src={advantagescopeLogo} alt="" className="size-4 shrink-0" />
				}
			/>
			<PaneToggleButton
				paneKey="choreo"
				icon={<Waypoints className="size-4 shrink-0" />}
			/>
			<PaneToggleButton
				paneKey="elastic"
				icon={<LayoutDashboard className="size-4 shrink-0" />}
			/>
			<PaneToggleButton
				paneKey="driverStation"
				icon={<Gamepad2 className="size-4 shrink-0" />}
			/>
		</div>
	);
}
