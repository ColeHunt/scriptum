import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Shared status-pill vocabulary for admin tables, matching the MARS/WARS
 * sibling apps' consistent badge/chip treatment (one meaning per color,
 * reused everywhere) instead of each page picking its own ad hoc classes.
 * Tones preserve the exact colors already in use before this component
 * existed (Dashboard's running/starting/other, Users' admin/student) — see
 * the theming pass earlier this session for why these specific colors are
 * load-bearing (green=running/pass, amber=starting/warning) and must not be
 * repurposed for anything else.
 */
export type BadgeTone = "success" | "warning" | "accent" | "neutral";

const toneClasses: Record<BadgeTone, string> = {
	success: "bg-green-900 text-green-300",
	warning: "bg-yellow-900 text-yellow-300",
	accent: "bg-primary/20 text-primary",
	neutral: "bg-muted text-muted-foreground",
};

export function StatusBadge({
	tone,
	children,
}: {
	tone: BadgeTone;
	children: ReactNode;
}) {
	return (
		<span
			className={cn(
				"inline-block rounded px-2 py-0.5 text-xs",
				toneClasses[tone],
			)}
		>
			{children}
		</span>
	);
}
