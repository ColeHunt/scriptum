import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAdminPoll } from "../hooks/useAdminPoll";

type CatalogModule = {
	id: string;
	title: string;
	track?: string;
};

type Assignment = {
	id: number;
	target_type: "module" | "track";
	target_id: string;
	assignee_type: "user" | "group";
	assignee_id: string;
	created_at: string;
};

async function fetchCatalog(): Promise<CatalogModule[]> {
	const res = await fetch("/admin/lessons/catalog", {
		credentials: "same-origin",
	});
	if (!res.ok) throw new Error(`${res.status}`);
	const body = (await res.json()) as { modules: CatalogModule[] };
	return body.modules;
}

async function fetchAssignments(): Promise<Assignment[]> {
	const res = await fetch("/admin/lessons/assignments", {
		credentials: "same-origin",
	});
	if (!res.ok) throw new Error(`${res.status}`);
	const body = (await res.json()) as { assignments: Assignment[] };
	return body.assignments;
}

export function Lessons() {
	const {
		data: modules,
		loading: modulesLoading,
		error: modulesError,
	} = useAdminPoll(useCallback(fetchCatalog, []), 30000);
	const {
		data: assignments,
		loading: assignmentsLoading,
		error: assignmentsError,
		refetch,
	} = useAdminPoll(useCallback(fetchAssignments, []), 10000);

	const [targetType, setTargetType] = useState<"module" | "track">("module");
	const [targetId, setTargetId] = useState("");
	const [assigneeType, setAssigneeType] = useState<"user" | "group">("group");
	const [assigneeId, setAssigneeId] = useState("");
	const [busy, setBusy] = useState(false);
	const [formError, setFormError] = useState<string | null>(null);

	const tracks = Array.from(
		new Set(
			(modules ?? [])
				.map((m) => m.track)
				.filter((t): t is string => Boolean(t)),
		),
	).sort();

	async function addAssignment() {
		if (!targetId.trim() || !assigneeId.trim()) return;
		setBusy(true);
		setFormError(null);
		try {
			const res = await fetch("/admin/lessons/assignments", {
				method: "POST",
				credentials: "same-origin",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					targetType,
					targetId: targetId.trim(),
					assigneeType,
					assigneeId: assigneeId.trim(),
				}),
			});
			const body = (await res.json().catch(() => null)) as {
				error?: string;
			} | null;
			if (!res.ok) {
				setFormError(body?.error ?? `Failed (${res.status}).`);
				return;
			}
			setTargetId("");
			setAssigneeId("");
			refetch();
		} finally {
			setBusy(false);
		}
	}

	async function removeAssignment(id: number) {
		setBusy(true);
		try {
			await fetch(`/admin/lessons/assignments/${id}`, {
				method: "DELETE",
				credentials: "same-origin",
			});
			refetch();
		} finally {
			setBusy(false);
		}
	}

	const loading = modulesLoading || assignmentsLoading;
	const error = modulesError ?? assignmentsError;

	if (loading && !modules && !assignments)
		return <p className="text-muted-foreground p-4">Loading…</p>;
	if (error) return <p className="text-destructive p-4">Error: {error}</p>;

	const moduleTitle = (id: string) =>
		modules?.find((m) => m.id === id)?.title ?? id;

	return (
		<div className="space-y-6">
			<div>
				<h2 className="text-xl font-semibold">Lessons</h2>
				<p className="text-muted-foreground text-sm">
					Modules and tracks with no assignment stay visible to every student.
					Adding an assignment narrows a module (or every module in a track) to
					just the listed users and Legion groups.
				</p>
			</div>

			<Card>
				<CardHeader>
					<CardTitle className="text-sm">Add assignment</CardTitle>
				</CardHeader>
				<CardContent className="space-y-3">
					{formError && (
						<p className="text-destructive text-sm" role="alert">
							{formError}
						</p>
					)}
					<div className="flex flex-wrap gap-2">
						<select
							value={targetType}
							onChange={(e) => {
								setTargetType(e.target.value as "module" | "track");
								setTargetId("");
							}}
							className="rounded border border-border bg-muted px-2 py-1 text-sm"
						>
							<option value="module">Module</option>
							<option value="track">Track</option>
						</select>
						{targetType === "module" ? (
							<select
								value={targetId}
								onChange={(e) => setTargetId(e.target.value)}
								className="min-w-48 rounded border border-border bg-muted px-2 py-1 text-sm"
							>
								<option value="">Select a module…</option>
								{(modules ?? []).map((m) => (
									<option key={m.id} value={m.id}>
										{m.title}
									</option>
								))}
							</select>
						) : (
							<select
								value={targetId}
								onChange={(e) => setTargetId(e.target.value)}
								className="min-w-48 rounded border border-border bg-muted px-2 py-1 text-sm"
							>
								<option value="">Select a track…</option>
								{tracks.map((t) => (
									<option key={t} value={t}>
										{t}
									</option>
								))}
							</select>
						)}
						<select
							value={assigneeType}
							onChange={(e) =>
								setAssigneeType(e.target.value as "user" | "group")
							}
							className="rounded border border-border bg-muted px-2 py-1 text-sm"
						>
							<option value="group">Legion group</option>
							<option value="user">User (member code)</option>
						</select>
						<input
							type="text"
							value={assigneeId}
							onChange={(e) => setAssigneeId(e.target.value)}
							placeholder={
								assigneeType === "group" ? "team-4143" : "8-char member code"
							}
							className="flex-1 rounded border border-border bg-muted px-3 py-1 text-sm"
							onKeyDown={(e) => e.key === "Enter" && addAssignment()}
						/>
						<Button
							size="sm"
							onClick={addAssignment}
							disabled={busy || !targetId.trim() || !assigneeId.trim()}
						>
							Add
						</Button>
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardContent className="pt-6">
					{!assignments || assignments.length === 0 ? (
						<p className="text-muted-foreground">
							No assignments — every module and track is visible to everyone.
						</p>
					) : (
						<table className="w-full text-sm">
							<thead>
								<tr className="border-b text-left text-muted-foreground">
									<th className="pb-2">Target</th>
									<th className="pb-2">Assigned to</th>
									<th className="pb-2">Added</th>
									<th className="pb-2">Actions</th>
								</tr>
							</thead>
							<tbody>
								{assignments.map((a) => (
									<tr key={a.id} className="border-b last:border-0">
										<td className="py-2">
											<span className="text-muted-foreground text-xs uppercase">
												{a.target_type}
											</span>{" "}
											{a.target_type === "module"
												? moduleTitle(a.target_id)
												: a.target_id}
										</td>
										<td className="py-2 font-mono">
											{a.assignee_type === "group" ? (
												a.assignee_id
											) : (
												<span>user:{a.assignee_id}</span>
											)}
										</td>
										<td className="py-2">
											{new Date(a.created_at).toLocaleString()}
										</td>
										<td className="py-2">
											<Button
												variant="ghost"
												size="sm"
												onClick={() => void removeAssignment(a.id)}
												disabled={busy}
											>
												Remove
											</Button>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
