import { ChevronDown, LogOut, ShieldUser } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface UserMenuProps {
	displayName: string;
	email: string;
	avatarUrl: string | null;
	isAdmin: boolean;
}

function initialsOf(name: string) {
	return (
		name
			.split(/\s+/)
			.map((part) => part[0])
			.filter(Boolean)
			.slice(0, 2)
			.join("")
			.toUpperCase() || "?"
	);
}

function Avatar({
	name,
	src,
	size = 24,
	className,
}: {
	name: string;
	src: string | null;
	size?: number;
	className?: string;
}) {
	const initials = useMemo(() => initialsOf(name), [name]);
	const [failedSrc, setFailedSrc] = useState<string | null>(null);
	const showImage = src !== null && src !== failedSrc;

	return (
		<span
			style={{ width: size, height: size }}
			className={cn(
				"inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-[#e05540] to-[#991900] text-[11px] font-semibold text-white ring-1 ring-white/10",
				className,
			)}
		>
			{showImage ? (
				<img
					src={src}
					alt=""
					className="h-full w-full object-cover"
					referrerPolicy="no-referrer"
					onError={() => setFailedSrc(src)}
				/>
			) : (
				initials
			)}
		</span>
	);
}

function signOut() {
	// Single logout via Legion's /sso/logout, which clears the shared mw_sso
	// cookie for every MARS/WARS app, not just CodeRunner.
	window.location.assign("/logout");
}

function navigateToAdmin() {
	window.location.assign("/admin");
}

export function UserMenu({
	displayName,
	email,
	avatarUrl,
	isAdmin,
}: UserMenuProps) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						type="button"
						variant="outline"
						className="h-8 gap-1.5 rounded-full border-border bg-card pl-1 pr-2"
						aria-label="User menu"
					/>
				}
			>
				<Avatar name={displayName} src={avatarUrl} size={24} />
				<ChevronDown className="size-3.5 text-muted-foreground" />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-64 p-0">
				<div className="flex items-center gap-2.5 border-b border-border px-3 py-3">
					<Avatar name={displayName} src={avatarUrl} size={36} />
					<div className="min-w-0">
						<div
							data-testid="user-menu-name"
							className="truncate text-[13px] font-medium text-foreground"
						>
							{displayName}
						</div>
						<div className="truncate text-[11.5px] text-muted-foreground">
							{email}
						</div>
					</div>
				</div>
				<div className="p-1">
					{isAdmin ? (
						<>
							<DropdownMenuItem
								onClick={navigateToAdmin}
								className="gap-2.5 px-2.5 py-2 text-[12.5px]"
							>
								<ShieldUser className="size-[15px] text-muted-foreground" />
								Admin
							</DropdownMenuItem>
							<DropdownMenuSeparator />
						</>
					) : null}
					<DropdownMenuItem
						onClick={signOut}
						className="gap-2.5 px-2.5 py-2 text-[12.5px]"
					>
						<LogOut className="size-[15px] text-muted-foreground" />
						Logout
					</DropdownMenuItem>
				</div>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
