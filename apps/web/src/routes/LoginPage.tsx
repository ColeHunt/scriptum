import { LogIn } from "lucide-react";
import { useSearchParams } from "react-router";
import coderunnerMascotImg from "@/assets/coderunner-mascot.png";

export function LoginPage() {
	const [searchParams] = useSearchParams();
	const returnTo = searchParams.get("return_to") || "/";
	const legionSignInUrl = `/login/legion?return_to=${encodeURIComponent(returnTo)}`;

	return (
		<div className="flex h-screen w-full overflow-hidden bg-background">
			{/* Left panel — mascot */}
			<div
				className="relative hidden flex-col items-center justify-center lg:flex"
				style={{ width: "55%" }}
			>
				<div
					className="absolute inset-0 bg-card"
					style={{
						background:
							"radial-gradient(ellipse at 50% 60%, oklch(0.24 0 0) 0%, oklch(0.145 0 0) 75%)",
					}}
				/>
				<img
					src={coderunnerMascotImg}
					alt="CodeRunner mascot"
					className="relative z-10 w-150 select-none drop-shadow-2xl"
					draggable={false}
				/>
			</div>

			{/* Divider */}
			<div className="hidden w-px shrink-0 bg-border lg:block" />

			{/* Right panel — sign in */}
			<div className="flex flex-1 flex-col items-center justify-center px-8">
				<div className="w-full max-w-[320px]">
					{/* DS-style section label */}
					<p className="mb-6 text-[9.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
						Sign in to continue
					</p>

					<div className="rounded-lg border border-border bg-card p-2">
						<a
							href={legionSignInUrl}
							className="flex h-11 w-full items-center justify-center gap-3 rounded-md border border-border bg-white/[0.06] px-4 text-[13px] font-semibold tracking-wide text-foreground transition-all hover:bg-white/[0.11] hover:shadow-[0_0_18px_rgba(34,197,94,0.12)]"
						>
							<LogIn className="size-[18px] shrink-0" />
							Sign in via Legion
						</a>
					</div>

					{/* Fine print */}
					<p className="mt-6 text-[10.5px] leading-relaxed text-muted-foreground">
						Not on the roster?{" "}
						<span className="text-foreground/60">
							Ask your coach to add you in Legion.
						</span>
					</p>
				</div>
			</div>
		</div>
	);
}
