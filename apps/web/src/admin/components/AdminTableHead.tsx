import type { ReactNode } from "react";

/**
 * Shared admin-table header treatment, matching the MARS/WARS sibling apps'
 * table headers (small, muted, uppercase, letter-spaced, on a raised band) —
 * repeats identically across Dashboard/Users/AuditLog/Lessons, so it's a
 * component rather than duplicated Tailwind classes per page.
 */
export function AdminTableHead({ children }: { children: ReactNode }) {
	return (
		<thead>
			<tr className="border-b border-border bg-muted">{children}</tr>
		</thead>
	);
}

export function AdminTh({ children }: { children: ReactNode }) {
	return (
		<th className="px-2 py-2 text-left text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
			{children}
		</th>
	);
}
