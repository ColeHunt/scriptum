import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AdminTableHead, AdminTh } from "../components/AdminTableHead";
import { useAdminPoll } from "../hooks/useAdminPoll";

type ContainerRow = {
	name: string;
	workspaceId: string | null;
	workspaceSlug: string | null;
	role: string | null;
	state: string | null;
	cpuPercent: number | null;
	memoryUsage: string | null;
	memoryLimit: string | null;
	memoryPercent: number | null;
	ports: { nt4: number | null; vscode: number | null; halsim: number | null };
};

async function fetchContainers(): Promise<ContainerRow[]> {
	const res = await fetch("/admin/containers/stats", {
		credentials: "same-origin",
	});
	if (!res.ok) throw new Error(`${res.status}`);
	const body = await res.json();
	return body.containers;
}

export function Containers() {
	const { data, loading, error, refetch } = useAdminPoll(
		useCallback(fetchContainers, []),
		5000,
	);

	async function postWorkspaceAction(
		workspaceId: string,
		action: "stop-containers" | "restart-code",
	) {
		const response = await fetch(`/admin/workspaces/${workspaceId}/${action}`, {
			method: "POST",
			credentials: "same-origin",
		});
		if (!response.ok) {
			throw new Error(`${response.status}`);
		}
		await refetch();
	}

	if (loading && !data)
		return <p className="text-muted-foreground p-4">Loading…</p>;
	if (error) return <p className="text-destructive p-4">Error: {error}</p>;

	return (
		<div className="space-y-6">
			<h2 className="text-xl font-semibold">Containers</h2>
			<Card className="py-0">
				<CardContent className="p-0">
					{!data || data.length === 0 ? (
						<p className="text-muted-foreground p-4">No managed containers.</p>
					) : (
						<table className="w-full text-sm">
							<AdminTableHead>
								<AdminTh>Workspace</AdminTh>
								<AdminTh>Container</AdminTh>
								<AdminTh>State</AdminTh>
								<AdminTh>Ports</AdminTh>
								<AdminTh>CPU</AdminTh>
								<AdminTh>Memory</AdminTh>
								<AdminTh>Actions</AdminTh>
							</AdminTableHead>
							<tbody>
								{data.map((container) => (
									<tr key={container.name} className="border-b last:border-0">
										<td className="px-2 py-2 font-mono">
											{container.workspaceSlug ?? container.workspaceId ?? "—"}
										</td>
										<td className="px-2 py-2 font-mono">{container.name}</td>
										<td className="px-2 py-2">
											{container.state ?? "unknown"}
										</td>
										<td className="px-2 py-2 font-mono">
											nt4:{container.ports.nt4 ?? "—"} · vscode:
											{container.ports.vscode ?? "—"} · halsim:
											{container.ports.halsim ?? "—"}
										</td>
										<td className="px-2 py-2">
											{container.cpuPercent === null
												? "—"
												: `${container.cpuPercent.toFixed(1)}%`}
										</td>
										<td className="px-2 py-2">
											{container.memoryUsage ?? "—"}
											{container.memoryLimit
												? ` / ${container.memoryLimit}`
												: ""}
											{container.memoryPercent === null
												? ""
												: ` (${container.memoryPercent.toFixed(1)}%)`}
										</td>
										<td className="flex gap-2 px-2 py-2">
											{container.workspaceSlug && (
												<a
													className="inline-flex h-7 items-center rounded-lg border border-border px-2.5 text-[0.8rem] hover:bg-muted"
													href={`/u/${container.workspaceSlug}/`}
												>
													Open
												</a>
											)}
											{container.workspaceId && (
												<>
													<Button
														variant="outline"
														size="sm"
														onClick={() =>
															void postWorkspaceAction(
																container.workspaceId!,
																"restart-code",
															)
														}
													>
														Restart
													</Button>
													<Button
														variant="outline"
														size="sm"
														onClick={() =>
															void postWorkspaceAction(
																container.workspaceId!,
																"stop-containers",
															)
														}
													>
														Stop
													</Button>
												</>
											)}
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
