import {
	AlertCircle,
	ArrowRight,
	CheckCircle2,
	Circle,
	Loader2,
	PartyPopper,
	Unlock,
	XCircle,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Confetti } from "@/components/Confetti";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import type {
	CheckpointStatus,
	CheckpointsState,
	LessonModuleWithLockState,
} from "@/lib/contracts";
import { cn } from "@/lib/utils";

interface CheckpointsDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	state: CheckpointsState;
	loading: boolean;
	verifying: boolean;
	error: string | null;
	verify: (checkpointIds?: string[]) => Promise<void>;
	/** Other lessons this completion just unlocked (their prerequisite was
	 * this module), shown on the completion celebration. Empty when nothing
	 * newly unlocked, e.g. this module had no dependents or they still need
	 * another prerequisite too. */
	newlyUnlocked: LessonModuleWithLockState[];
	/** Called when the student picks "Return to lesson browser" off the
	 * completion celebration. Closes this dialog and opens the lesson picker,
	 * with nothing preselected. */
	onLaunchNewLesson: () => void;
	/** Called when the student clicks one of the newly-unlocked lessons
	 * directly. Closes this dialog and jumps straight to that lesson in the
	 * picker (skipping browsing for it), still behind its normal "this
	 * discards your current work" confirmation. */
	onLaunchModule: (moduleId: string) => void;
}

const STATUS_ICON: Record<CheckpointStatus, typeof CheckCircle2> = {
	passed: CheckCircle2,
	failed: XCircle,
	error: AlertCircle,
	"not-run": Circle,
};

const STATUS_COLOR: Record<CheckpointStatus, string> = {
	passed: "text-emerald-600 dark:text-emerald-400",
	failed: "text-destructive",
	error: "text-amber-600 dark:text-amber-400",
	"not-run": "text-muted-foreground/40",
};

export function CheckpointsDialog({
	open,
	onOpenChange,
	state,
	loading,
	verifying,
	error,
	verify,
	newlyUnlocked,
	onLaunchNewLesson,
	onLaunchModule,
}: CheckpointsDialogProps) {
	const [runningId, setRunningId] = useState<string | null>(null);
	const [celebrating, setCelebrating] = useState(false);

	const runOne = async (id: string) => {
		setRunningId(id);
		try {
			await verify([id]);
		} finally {
			setRunningId(null);
		}
	};

	const passedCount = state.checkpoints.filter(
		(c) => c.result?.status === "passed",
	).length;

	const required = state.checkpoints.filter((c) => !c.optional);
	const allRequiredPassed =
		required.length > 0 && required.every((c) => c.result?.status === "passed");

	// Fires the celebration only on the transition into "all passed" for the
	// currently-loaded module - never just from loading a module that was
	// already completed in an earlier session.
	const prevModuleIdRef = useRef<string | null>(null);
	const prevAllPassedRef = useRef(false);
	useEffect(() => {
		if (state.moduleId !== prevModuleIdRef.current) {
			prevModuleIdRef.current = state.moduleId;
			prevAllPassedRef.current = allRequiredPassed;
			return;
		}
		if (allRequiredPassed && !prevAllPassedRef.current) {
			setCelebrating(true);
		}
		prevAllPassedRef.current = allRequiredPassed;
	}, [state.moduleId, allRequiredPassed]);

	// Reset so the next lesson's completion can celebrate again.
	useEffect(() => {
		if (!open) setCelebrating(false);
	}, [open]);

	const continueExperimenting = () => {
		setCelebrating(false);
		onOpenChange(false);
	};

	const launchNewLesson = () => {
		setCelebrating(false);
		onOpenChange(false);
		onLaunchNewLesson();
	};

	const launchModule = (moduleId: string) => {
		setCelebrating(false);
		onOpenChange(false);
		onLaunchModule(moduleId);
	};

	if (celebrating) {
		return (
			<Dialog open={open} onOpenChange={onOpenChange}>
				<DialogContent className="sm:max-w-md" showCloseButton={false}>
					<Confetti />
					<div className="flex flex-col items-center gap-3 py-4 text-center">
						<PartyPopper className="size-10 text-emerald-500" />
						<DialogHeader className="items-center">
							<DialogTitle className="text-[16px]">
								Lesson complete!
							</DialogTitle>
							<DialogDescription className="text-[12.5px]">
								You passed every checkpoint. Keep tinkering here, or move on to
								the next lesson.
							</DialogDescription>
						</DialogHeader>
						{newlyUnlocked.length > 0 && (
							<div className="w-full rounded-lg border border-border/60 bg-accent/30 px-3 py-2.5 text-left">
								<p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
									{newlyUnlocked.length === 1
										? "Lesson unlocked"
										: "Lessons unlocked"}
								</p>
								<ul className="flex flex-col gap-1">
									{newlyUnlocked.map((module) => (
										<li key={module.id}>
											<button
												type="button"
												onClick={() => launchModule(module.id)}
												className="group flex w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-[13px] transition-colors hover:bg-accent"
											>
												<Unlock className="size-3.5 shrink-0 text-primary" />
												<span className="truncate font-medium">
													{module.title}
												</span>
												<ArrowRight className="ml-auto size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
											</button>
										</li>
									))}
								</ul>
							</div>
						)}
					</div>
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={continueExperimenting}
						>
							Continue experimenting
						</Button>
						<Button type="button" onClick={launchNewLesson}>
							Return to lesson browser
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		);
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg" showCloseButton={false}>
				<DialogHeader>
					<DialogTitle>Checkpoints</DialogTitle>
					<DialogDescription>
						{state.available
							? `${passedCount} of ${state.checkpoints.length} passing. Nothing here is graded — verify as many times as you want.`
							: "This lesson has no checkpoints, or none is loaded yet."}
					</DialogDescription>
				</DialogHeader>

				{error && (
					<p className="rounded-md bg-destructive/10 px-3 py-2 text-[12.5px] text-destructive">
						{error}
					</p>
				)}

				{loading ? (
					<div className="flex items-center justify-center py-8 text-muted-foreground">
						<Loader2 className="size-5 animate-spin" />
					</div>
				) : state.available ? (
					<ScrollArea className="max-h-[50vh]">
						<ul className="flex flex-col gap-1 pr-3">
							{state.checkpoints.map((checkpoint) => {
								const status = checkpoint.result?.status ?? "not-run";
								const Icon = STATUS_ICON[status];
								const isRunningThis = verifying && runningId === checkpoint.id;
								return (
									<li
										key={checkpoint.id}
										className="rounded-lg border border-border/60 px-3 py-2"
									>
										<div className="flex items-start gap-2.5">
											{isRunningThis ? (
												<Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground" />
											) : (
												<Icon
													className={cn(
														"mt-0.5 size-4 shrink-0",
														STATUS_COLOR[status],
													)}
												/>
											)}
											<div className="min-w-0 flex-1">
												<div className="flex flex-wrap items-center gap-1.5">
													<span className="text-[13px] font-medium">
														{checkpoint.title}
													</span>
													{checkpoint.optional && (
														<Badge
															variant="outline"
															className="px-1.5 py-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
														>
															Optional
														</Badge>
													)}
												</div>
												<p className="text-[12px] text-muted-foreground">
													{checkpoint.description}
												</p>
												{status === "failed" || status === "error" ? (
													<p className="mt-1 text-[12px] text-destructive">
														{checkpoint.result?.message ?? "Verify failed."}
													</p>
												) : null}
											</div>
											<Button
												type="button"
												variant="ghost"
												size="sm"
												className="h-7 shrink-0 px-2 text-[12px]"
												disabled={verifying}
												onClick={() => void runOne(checkpoint.id)}
											>
												Verify
											</Button>
										</div>
									</li>
								);
							})}
						</ul>
					</ScrollArea>
				) : (
					<p className="py-6 text-center text-[13px] text-muted-foreground">
						Load a lesson with checkpoints (like Git Basics) to see them here.
					</p>
				)}

				<DialogFooter>
					<Button
						type="button"
						variant="outline"
						onClick={() => onOpenChange(false)}
					>
						Close
					</Button>
					{state.available && (
						<Button
							type="button"
							disabled={verifying || loading}
							onClick={() => void verify()}
						>
							{verifying && !runningId ? (
								<Loader2 className="size-4 animate-spin" />
							) : null}
							Verify all
						</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
