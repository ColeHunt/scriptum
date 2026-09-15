import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AdminTableHead, AdminTh } from "../components/AdminTableHead";
import { useAdminPoll } from "../hooks/useAdminPoll";

type AuditEntry = {
	id: number;
	actor_user_id: string;
	actor_email: string;
	action: string;
	target_kind: string | null;
	target_id: string | null;
	metadata_json: string | null;
	occurred_at: number;
};

type AuditLogResponse = {
	ok: boolean;
	entries: AuditEntry[];
};

export function AuditLog() {
	const [actorFilter, setActorFilter] = useState("");
	const [actionFilter, setActionFilter] = useState("");
	const [daysFilter, setDaysFilter] = useState("");
	const [beforeId, setBeforeId] = useState<number | undefined>(undefined);

	const fetcher = useCallback(async (): Promise<AuditLogResponse> => {
		const params = new URLSearchParams();
		params.set("limit", "50");
		if (beforeId !== undefined) params.set("before", String(beforeId));
		if (actorFilter.trim()) params.set("actor", actorFilter.trim());
		if (actionFilter.trim()) params.set("action", actionFilter.trim());
		if (daysFilter.trim()) params.set("days", daysFilter.trim());
		const res = await fetch(`/admin/audit-log?${params}`, {
			credentials: "same-origin",
		});
		if (!res.ok) throw new Error(`${res.status}`);
		return res.json();
	}, [beforeId, actorFilter, actionFilter, daysFilter]);

	const { data, loading, error } = useAdminPoll(fetcher, 10_000);

	const entries = data?.entries ?? [];
	const lastId =
		entries.length > 0 ? entries[entries.length - 1]?.id : undefined;

	return (
		<div className="space-y-6">
			<div className="flex flex-wrap items-baseline justify-between gap-2">
				<h2 className="text-xl font-semibold">
					Audit Log
					{data && (
						<span className="ml-2 text-sm font-normal text-muted-foreground">
							({entries.length} entr{entries.length === 1 ? "y" : "ies"}
							{beforeId !== undefined ? ", older" : ""})
						</span>
					)}
				</h2>
				<div className="flex flex-wrap items-center gap-2 text-sm">
					<input
						placeholder="Filter actor email…"
						className="rounded border border-border bg-muted px-2 py-1"
						value={actorFilter}
						onChange={(e) => {
							setActorFilter(e.target.value);
							setBeforeId(undefined);
						}}
					/>
					<input
						placeholder="Action prefix…"
						className="rounded border border-border bg-muted px-2 py-1"
						value={actionFilter}
						onChange={(e) => {
							setActionFilter(e.target.value);
							setBeforeId(undefined);
						}}
					/>
					<input
						placeholder="Last N days…"
						type="number"
						min={1}
						className="w-24 rounded border border-border bg-muted px-2 py-1"
						value={daysFilter}
						onChange={(e) => {
							setDaysFilter(e.target.value);
							setBeforeId(undefined);
						}}
					/>
					{beforeId !== undefined && (
						<Button
							variant="ghost"
							size="sm"
							onClick={() => setBeforeId(undefined)}
						>
							← Back to latest
						</Button>
					)}
				</div>
			</div>

			{loading && !data && <p className="text-muted-foreground">Loading…</p>}
			{error && <p className="text-destructive">Error: {error}</p>}

			{data && (
				<Card className="py-0">
					<CardContent className="p-0">
						{entries.length === 0 ? (
							<p className="text-muted-foreground p-4">
								No audit events found.
							</p>
						) : (
							<table className="w-full text-sm">
								<AdminTableHead>
									<AdminTh>Time</AdminTh>
									<AdminTh>Actor</AdminTh>
									<AdminTh>Action</AdminTh>
									<AdminTh>Target</AdminTh>
									<AdminTh>Details</AdminTh>
								</AdminTableHead>
								<tbody>
									{entries.map((entry) => (
										<AuditRow key={entry.id} entry={entry} />
									))}
								</tbody>
							</table>
						)}
					</CardContent>
				</Card>
			)}

			{data && entries.length >= 50 && lastId !== undefined && (
				<div className="text-center">
					<Button
						variant="outline"
						size="sm"
						onClick={() => setBeforeId(lastId)}
					>
						Load older →
					</Button>
				</div>
			)}
		</div>
	);
}

function AuditRow({ entry }: { entry: AuditEntry }) {
	const [expanded, setExpanded] = useState(false);
	const time = new Date(entry.occurred_at).toLocaleString();
	const targetSummary = entry.target_kind
		? `${entry.target_kind}: ${truncate(entry.target_id ?? "", 20)}`
		: "—";

	return (
		<>
			<tr
				className="cursor-pointer border-b last:border-0 hover:bg-muted/50"
				onClick={() => setExpanded(!expanded)}
			>
				<td className="px-2 py-2 text-xs text-muted-foreground">{time}</td>
				<td className="px-2 py-2">{entry.actor_email}</td>
				<td className="px-2 py-2 font-mono text-xs">{entry.action}</td>
				<td className="px-2 py-2 text-xs">{targetSummary}</td>
				<td className="px-2 py-2 text-xs text-muted-foreground">
					{entry.metadata_json ? "▸" : ""}
				</td>
			</tr>
			{expanded && entry.metadata_json && (
				<tr>
					<td colSpan={5} className="bg-muted/30 px-4 py-2">
						<pre className="whitespace-pre-wrap text-xs text-muted-foreground">
							{formatJson(entry.metadata_json)}
						</pre>
					</td>
				</tr>
			)}
		</>
	);
}

function truncate(value: string, max: number): string {
	return value.length > max ? `${value.slice(0, max)}…` : value;
}

function formatJson(raw: string): string {
	try {
		return JSON.stringify(JSON.parse(raw), null, 2);
	} catch {
		return raw;
	}
}
