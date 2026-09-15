import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AdminTableHead, AdminTh } from "../components/AdminTableHead";
import { StatusBadge } from "../components/StatusBadge";
import { useAdminPoll } from "../hooks/useAdminPoll";

type UserRow = {
	id: string;
	name: string;
	email: string;
	role: string | null;
	slug: string | null;
	createdAt: string;
	lastSeenAt: string | null;
};

async function fetchUsers(): Promise<UserRow[]> {
	const res = await fetch("/admin/users", { credentials: "same-origin" });
	if (!res.ok) throw new Error(`${res.status}`);
	const body = await res.json();
	return body.users;
}

export function Users() {
	const {
		data: users,
		loading,
		error,
		refetch,
	} = useAdminPoll(useCallback(fetchUsers, []), 10000);
	const [busy, setBusy] = useState<string | null>(null);

	async function removeUser(user: UserRow) {
		if (
			!confirm(
				`Delete ${user.name}'s workspace and project files? This cannot be undone. ` +
					"Their Legion access is unaffected — they'll get a fresh, empty " +
					"workspace the next time they sign in.",
			)
		)
			return;
		setBusy(user.id);
		try {
			const response = await fetch(`/admin/users/${user.id}`, {
				method: "DELETE",
				credentials: "same-origin",
			});
			if (!response.ok) throw new Error(`${response.status}`);
			await refetch();
		} finally {
			setBusy(null);
		}
	}

	if (loading && !users)
		return <p className="text-muted-foreground p-4">Loading…</p>;
	if (error) return <p className="text-destructive p-4">Error: {error}</p>;

	return (
		<div className="space-y-6">
			<div>
				<h2 className="text-xl font-semibold">Users</h2>
				<p className="text-muted-foreground text-sm">
					Roles come from Legion group membership and can't be changed here —
					grant or revoke <code className="font-mono">scriptum-admin</code> in
					Legion's own <code className="font-mono">/admin/groups</code>.
				</p>
			</div>
			<Card className="py-0">
				<CardContent className="p-0">
					{!users || users.length === 0 ? (
						<p className="text-muted-foreground p-4">No users yet.</p>
					) : (
						<table className="w-full text-sm">
							<AdminTableHead>
								<AdminTh>Username</AdminTh>
								<AdminTh>Name</AdminTh>
								<AdminTh>Role</AdminTh>
								<AdminTh>Slug</AdminTh>
								<AdminTh>Last seen</AdminTh>
								<AdminTh>Actions</AdminTh>
							</AdminTableHead>
							<tbody>
								{users.map((u) => (
									<tr key={u.id} className="border-b last:border-0">
										<td className="px-2 py-2">{u.email}</td>
										<td className="px-2 py-2">{u.name}</td>
										<td className="px-2 py-2">
											<StatusBadge
												tone={u.role === "admin" ? "accent" : "neutral"}
											>
												{u.role ?? "student"}
											</StatusBadge>
										</td>
										<td className="px-2 py-2 font-mono">{u.slug ?? "—"}</td>
										<td className="px-2 py-2">
											{u.lastSeenAt
												? new Date(u.lastSeenAt).toLocaleString()
												: "—"}
										</td>
										<td className="px-2 py-2">
											<Button
												variant="destructive"
												size="sm"
												disabled={busy === u.id}
												onClick={() => void removeUser(u)}
											>
												Delete workspace
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
