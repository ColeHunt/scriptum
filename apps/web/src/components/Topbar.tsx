import { ListChecks, Replace } from "lucide-react";
import { PaneToggleRow } from "@/components/PaneVisibility";
import { UserMenu } from "@/components/UserMenu";
import { Button } from "@/components/ui/button";

interface TopbarProps {
	displayName: string;
	email: string;
	avatarUrl: string | null;
	isAdmin: boolean;
	onSwitchProject: () => void;
	/** Only for layouts that render the sim pane; requires a `PaneVisibilityRoot`. */
	showPaneToggle?: boolean;
	/** Shown only when the current lesson has checkpoints to verify. */
	checkpoints?: { passed: number; total: number; onOpen: () => void };
}

export function Topbar({
	displayName,
	email,
	avatarUrl,
	isAdmin,
	onSwitchProject,
	showPaneToggle = false,
	checkpoints,
}: TopbarProps) {
	return (
		<header className="flex h-[48px] shrink-0 items-center border-b border-border px-4">
			<div className="flex items-center gap-2.5">
				<strong className="whitespace-nowrap text-[15px] font-bold text-primary italic">
					Scriptum
				</strong>
			</div>
			<div className="ml-auto flex items-center gap-5">
				{showPaneToggle && <PaneToggleRow />}
				{checkpoints && (
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="h-8 gap-1.5 px-2.5 text-[12.5px]"
						onClick={checkpoints.onOpen}
					>
						<ListChecks className="size-[15px] text-muted-foreground" />
						Checkpoints {checkpoints.passed}/{checkpoints.total}
					</Button>
				)}
				<Button
					type="button"
					variant="outline"
					size="sm"
					className="h-8 gap-1.5 px-2.5 text-[12.5px]"
					onClick={onSwitchProject}
				>
					<Replace className="size-[15px] text-muted-foreground" />
					Switch project
				</Button>
				<UserMenu
					displayName={displayName}
					email={email}
					avatarUrl={avatarUrl}
					isAdmin={isAdmin}
				/>
			</div>
		</header>
	);
}
