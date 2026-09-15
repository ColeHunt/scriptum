import {
	BookOpen,
	Container,
	FolderOpen,
	Gauge,
	type LucideIcon,
	ScrollText,
	Users,
} from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

type Tab =
	| "dashboard"
	| "containers"
	| "workspaces"
	| "users"
	| "lessons"
	| "audit-log";

const tabs: Array<{ id: Tab; label: string; icon: LucideIcon }> = [
	{ id: "dashboard", label: "Dashboard", icon: Gauge },
	{ id: "containers", label: "Containers", icon: Container },
	{ id: "workspaces", label: "Workspaces", icon: FolderOpen },
	{ id: "users", label: "Users", icon: Users },
	{ id: "lessons", label: "Lessons", icon: BookOpen },
	{ id: "audit-log", label: "Audit Log", icon: ScrollText },
];

export function AdminLayout({
	children,
	activeTab,
	onTabChange,
}: {
	children: ReactNode;
	activeTab: Tab;
	onTabChange: (tab: Tab) => void;
}) {
	return (
		<div className="flex min-h-screen bg-background text-foreground">
			<nav className="w-48 shrink-0 border-r border-border p-4">
				<a
					href="/"
					className="mb-6 block text-lg font-bold text-primary italic"
				>
					Scriptum
				</a>
				<ul className="space-y-1">
					{tabs.map((tab) => (
						<li key={tab.id}>
							<Button
								variant="ghost"
								className={
									activeTab === tab.id
										? "w-full justify-start gap-2 bg-sidebar-accent text-sidebar-accent-foreground hover:bg-sidebar-accent"
										: "w-full justify-start gap-2"
								}
								onClick={() => onTabChange(tab.id)}
							>
								<tab.icon className="size-4 text-muted-foreground" />
								{tab.label}
							</Button>
						</li>
					))}
				</ul>
				<div className="mt-8 border-t border-border pt-4">
					<a
						href="/"
						className="text-sm text-muted-foreground hover:text-foreground"
					>
						← Back to workspace
					</a>
				</div>
			</nav>
			<main className="flex-1 p-6">{children}</main>
		</div>
	);
}

export type { Tab };
