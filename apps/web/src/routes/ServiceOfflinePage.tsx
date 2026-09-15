import { Loader2 } from "lucide-react";

interface ServiceOfflinePageProps {
	/** When true, the card shows a spinner instead of the offline content. */
	loading?: boolean;
	onRetry?: () => void;
}

export function ServiceOfflinePage({
	loading = false,
	onRetry,
}: ServiceOfflinePageProps) {
	return (
		<div className="flex min-h-screen w-full items-center justify-center bg-background px-6">
			<div className="w-full max-w-[380px] rounded-lg border border-border bg-card p-8 text-center">
				{loading ? (
					<div className="flex h-32 items-center justify-center">
						<Loader2 className="size-6 animate-spin text-muted-foreground" />
					</div>
				) : (
					<>
						<h1 className="text-2xl font-bold text-primary italic">Scriptum</h1>
						<p className="mt-4 text-sm font-semibold text-foreground">
							Service is offline
						</p>
						<p className="mt-2 text-sm text-muted-foreground">
							This service is currently unavailable. Check back soon or contact
							an administrator.
						</p>

						<button
							type="button"
							onClick={onRetry}
							className="mt-6 flex h-11 w-full items-center justify-center gap-2 rounded-md border border-border bg-muted px-4 text-sm font-semibold text-foreground transition-colors hover:bg-muted/80"
						>
							Retry
						</button>
					</>
				)}
			</div>
		</div>
	);
}
