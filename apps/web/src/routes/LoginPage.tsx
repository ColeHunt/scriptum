import { LogIn } from "lucide-react";
import { useSearchParams } from "react-router";

export function LoginPage() {
	const [searchParams] = useSearchParams();
	const returnTo = searchParams.get("return_to") || "/";
	const legionSignInUrl = `/login/legion?return_to=${encodeURIComponent(returnTo)}`;

	return (
		<div className="flex min-h-screen w-full items-center justify-center bg-background px-6">
			<div className="w-full max-w-[380px] rounded-lg border border-border bg-card p-8 text-center">
				<h1 className="text-2xl font-bold text-primary italic">Scriptum</h1>
				<p className="mt-2 text-sm text-muted-foreground">
					Sign in with your Legion account.
				</p>

				<a
					href={legionSignInUrl}
					className="mt-6 flex h-11 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
				>
					<LogIn className="size-[18px] shrink-0" />
					Sign in via Legion
				</a>

				<p className="mt-6 text-xs text-muted-foreground">
					Not on the roster? Ask your coach to add you in Legion.
				</p>
			</div>
		</div>
	);
}
