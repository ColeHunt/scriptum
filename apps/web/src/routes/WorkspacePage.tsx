import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router";
import { CheckpointsDialog } from "@/components/CheckpointsDialog";
import { ChoreoPane } from "@/components/ChoreoPane";
import { DemoBanner } from "@/components/DemoBanner";
import { DriverStation } from "@/components/DriverStation";
import { EditorPane } from "@/components/EditorPane";
import { ElasticPane } from "@/components/ElasticPane";
import { IDELayout } from "@/components/IDELayout";
import { PaneVisibilityRoot } from "@/components/PaneVisibility";
import { PreviewPane } from "@/components/PreviewPane";
import { ScopePane } from "@/components/ScopePane";
import { SwitchProjectDialog } from "@/components/SwitchProjectDialog";
import { Topbar } from "@/components/Topbar";
import { Button } from "@/components/ui/button";
import { useAutoChoosers } from "@/hooks/useAutoChoosers";
import { useCheckpoints } from "@/hooks/useCheckpoints";
import { useEditorReachability } from "@/hooks/useEditorReachability";
import { type GamepadInfo, useGamepad } from "@/hooks/useGamepad";
import { useGamepadChannel } from "@/hooks/useGamepadChannel";
import { useLessons } from "@/hooks/useLessons";
import { useRunChannel } from "@/hooks/useRunChannel";
import { useScopeHandshake } from "@/hooks/useScopeHandshake";
import { useScopeLogOpener } from "@/hooks/useScopeLogOpener";
import { useSession } from "@/hooks/useSession";
import { useSimulationState } from "@/hooks/useSimulationState";
import { isWorkspaceSlug } from "@/lib/contracts";
import { gamepadFrameToWpilib } from "@/lib/gamepad-mapping";
import {
	gamepadStateToVisualizerFrame,
	KEYBOARD_GAMEPAD_ID,
	KEYBOARD_GAMEPAD_LABEL,
	keyboardCodesToWpilib,
	NEUTRAL_GAMEPAD_STATE,
} from "@/lib/keyboard-mapping";
import { readScopeLayout } from "@/lib/scope-layout";
import { useUIStore } from "@/state/store";

export function WorkspacePage() {
	const { slug } = useParams<{ slug: string }>();
	const workspaceSlug = useMemo(
		() => (slug && isWorkspaceSlug(slug) ? slug : null),
		[slug],
	);

	// Bumped after a project swap so the session refetches and the editor remounts.
	const [reloadNonce, setReloadNonce] = useState(0);
	const sessionState = useSession(workspaceSlug, reloadNonce);

	const workspace =
		sessionState.status === "ready" ? sessionState.session.workspace : null;
	const currentModule = workspace?.currentModule ?? null;
	const currentModuleKind = workspace?.currentModuleKind ?? null;
	const projectEmpty = workspace?.projectEmpty ?? false;

	// `plain-java` console lessons and the `git` lesson hide the sim chrome;
	// everything else (robot lessons, empty workspace, team import) renders
	// the full robot layout.
	const hideSimChrome =
		currentModuleKind === "plain-java" || currentModuleKind === "git";
	// Gate the sim data hooks themselves (not just rendering): they no-op on a
	// null slug, so hiding the sim chrome also stops the sim polls + idle
	// HALSim/run sockets.
	const simSlug = hideSimChrome ? null : workspaceSlug;

	// A `showScope: true` module (e.g. the AdvantageScope Tools lesson) wants
	// the Scope pane mounted despite being `plain-java` - it has no live NT4
	// server, so `simSlug` stays null and the run-channel/Driver-Station/NT4
	// handshake hooks below still never try to connect.
	const lessons = useLessons(workspaceSlug);
	const currentModuleInfo = lessons.modules.find((m) => m.id === currentModule);
	const showScope = currentModuleInfo?.showScope === true;
	// The three single-tool lessons (advantagescope-intro, elastic-intro,
	// choreo-intro) each set restrictTools in modules.json so the other two
	// tool panes - and their topbar toggle buttons - don't appear at all.
	// Everything else (general robot lessons, empty workspace) leaves this
	// undefined and keeps every tool pane available.
	const allowedTools = currentModuleInfo?.restrictTools;

	const [switchOpen, setSwitchOpen] = useState(false);
	const [checkpointsOpen, setCheckpointsOpen] = useState(false);
	const scopeFrameRef = useRef<HTMLIFrameElement>(null);
	// Must match the condition that actually mounts the Scope pane below
	// (`showSimPanels`/`ScopePane`'s render), not just `showScope` - that flag
	// only covers the plain-java-opt-in case. A `robot`-kind module (e.g.
	// advantagescope-intro) renders the pane via `!hideSimChrome` alone, and
	// previously fell through to `undefined` here, so its layout checkpoints
	// silently read a stale/missing snapshot instead of the live one.
	const scopeMounted = !hideSimChrome || showScope;
	const getScopeLayout = useCallback(
		() => (scopeMounted ? readScopeLayout(scopeFrameRef.current) : undefined),
		[scopeMounted],
	);
	const checkpoints = useCheckpoints(workspaceSlug, getScopeLayout);

	const { connection: runConnection, consoleLines } = useRunChannel(simSlug);
	const simulation = useSimulationState(simSlug);
	const autoChoosers = useAutoChoosers(simSlug);
	const editorUrl = workspaceSlug
		? `/u/${workspaceSlug}/vscode/?folder=/workspace/project`
		: null;
	const {
		status: editorStatus,
		waitingSeconds: editorWaitingSeconds,
		errorDetail: editorErrorDetail,
	} = useEditorReachability(editorUrl);
	useScopeHandshake(simSlug, scopeFrameRef);
	const scopeLog = useScopeLogOpener(
		scopeFrameRef,
		showScope && workspaceSlug ? `/u/${workspaceSlug}/api/scope-log` : null,
	);

	const gamepad = useGamepad();
	const channel = useGamepadChannel(simSlug);
	const inputMode = useUIStore((state) => state.inputMode);
	const setInputMode = useUIStore((state) => state.setInputMode);
	const [keyboardCodes, setKeyboardCodes] = useState<ReadonlySet<string>>(
		() => new Set(),
	);
	const keyboardState = useMemo(
		() => keyboardCodesToWpilib(keyboardCodes),
		[keyboardCodes],
	);
	const keyboardFrame = useMemo(
		() => gamepadStateToVisualizerFrame(keyboardState),
		[keyboardState],
	);

	// Bridge: when a gamepad frame arrives, ship the WPILib-mapped state to
	// the channel. pushState handles its own throttle / heartbeat / diffing,
	// so we can call it on every frame without burning bandwidth.
	useEffect(() => {
		if (
			inputMode !== "controller" ||
			!gamepad.frame ||
			gamepad.selectedIndex === null
		)
			return;
		channel.pushState(gamepadFrameToWpilib(gamepad.frame));
	}, [inputMode, gamepad.frame, gamepad.selectedIndex, channel]);

	useEffect(() => {
		if (inputMode !== "keyboard") return;
		channel.pushState(keyboardState);
	}, [inputMode, keyboardState, channel]);

	const onSelectGamepad = useCallback(
		(info: GamepadInfo) => {
			setInputMode("controller");
			setKeyboardCodes(new Set());
			gamepad.selectGamepad(info.index);
			channel.select(info.id, info.label);
		},
		[gamepad, channel, setInputMode],
	);

	const onReleaseGamepad = useCallback(() => {
		gamepad.selectGamepad(null);
		channel.release();
	}, [gamepad, channel]);

	const onSelectControllerMode = useCallback(() => {
		setInputMode("controller");
		setKeyboardCodes(new Set());
		const selected = gamepad.available.find(
			(info) => info.index === gamepad.selectedIndex,
		);
		if (selected) {
			channel.select(selected.id, selected.label);
		} else {
			channel.release();
		}
	}, [channel, gamepad.available, gamepad.selectedIndex, setInputMode]);

	const onSelectKeyboardMode = useCallback(() => {
		setInputMode("keyboard");
		gamepad.selectGamepad(null);
		setKeyboardCodes(new Set());
		channel.select(KEYBOARD_GAMEPAD_ID, KEYBOARD_GAMEPAD_LABEL);
		channel.pushState(NEUTRAL_GAMEPAD_STATE);
	}, [channel, gamepad, setInputMode]);

	const onKeyboardCodesChange = useCallback((codes: ReadonlySet<string>) => {
		setKeyboardCodes(codes);
	}, []);

	const onKeyboardRelease = useCallback(() => {
		setKeyboardCodes(new Set());
		if (inputMode === "keyboard") {
			channel.pushState(NEUTRAL_GAMEPAD_STATE);
		}
	}, [channel, inputMode]);

	// Safety: if the selected gamepad disappears (useGamepad clears
	// selectedIndex), tell the server to release.
	const lastSelectedRef = useRef<number | null>(null);
	useEffect(() => {
		if (
			inputMode === "controller" &&
			lastSelectedRef.current !== null &&
			gamepad.selectedIndex === null
		) {
			channel.release();
		}
		lastSelectedRef.current = gamepad.selectedIndex;
	}, [inputMode, gamepad.selectedIndex, channel]);

	// First login (D7): an empty workspace auto-opens the Switch Project surface
	// so the student starts by picking a lesson. Fire once per empty state.
	const autoOpenedRef = useRef(false);
	useEffect(() => {
		if (projectEmpty && !autoOpenedRef.current) {
			autoOpenedRef.current = true;
			setSwitchOpen(true);
		}
		if (!projectEmpty) {
			autoOpenedRef.current = false;
		}
	}, [projectEmpty]);

	const onSwapComplete = useCallback(() => {
		setReloadNonce((n) => n + 1);
		checkpoints.refetch();
	}, [checkpoints.refetch]);

	const displayName =
		sessionState.status === "ready"
			? sessionState.session.user.displayName
			: "Loading";
	const email =
		sessionState.status === "ready" ? sessionState.session.user.email : "";
	const avatarUrl =
		sessionState.status === "ready"
			? sessionState.session.user.avatarUrl
			: null;
	const isAdmin =
		sessionState.status === "ready" &&
		sessionState.session.user.role === "admin";
	const isDemo =
		sessionState.status === "ready" && sessionState.session.demo === true;

	const sessionReady = sessionState.status === "ready";
	const errorMessage =
		sessionState.status === "error" ? sessionState.message : undefined;

	// Preview reads project files, which exist independently of the simulator,
	// so it is addressed by `workspaceSlug` rather than the sim-gated `simSlug`.
	// Always active: unlike upstream's tab-switcher, every pane here stays
	// mounted regardless of toggle state (see IDELayout), so there's no
	// separate "first opened" moment to gate the document fetch on.
	const previewPane = (
		<PreviewPane
			workspaceSlug={workspaceSlug}
			active
			reloadNonce={reloadNonce}
		/>
	);

	return (
		<PaneVisibilityRoot
			className="flex h-screen flex-col gap-0 bg-background"
			allowedTools={allowedTools}
		>
			{isDemo && <DemoBanner />}
			<Topbar
				displayName={displayName}
				email={email}
				avatarUrl={avatarUrl}
				isAdmin={isAdmin}
				onSwitchProject={() => setSwitchOpen(true)}
				showPaneToggle={!hideSimChrome || showScope}
				showPreviewToggle={hideSimChrome && !showScope}
				checkpoints={
					checkpoints.state.available
						? {
								passed: checkpoints.state.checkpoints.filter(
									(c) => c.result?.status === "passed",
								).length,
								total: checkpoints.state.checkpoints.length,
								onOpen: () => setCheckpointsOpen(true),
							}
						: undefined
				}
			/>
			<IDELayout
				showSimPanels={!hideSimChrome || showScope}
				editor={
					<EditorPane
						key={reloadNonce}
						editorUrl={editorUrl}
						editorStatus={editorStatus}
						errorMessage={errorMessage}
						waitingSeconds={editorWaitingSeconds}
						errorDetail={editorErrorDetail}
					/>
				}
				scope={
					<ScopePane
						ref={scopeFrameRef}
						expectNt4Endpoint={simSlug !== null}
						toolbar={
							showScope ? (
								<div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-card px-3 py-2 text-[12px] text-muted-foreground">
									<span>
										{scopeLog.status === "loaded"
											? "Log loaded."
											: scopeLog.status === "error"
												? (scopeLog.error ?? "Couldn't load the log.")
												: "Click to load the log into AdvantageScope."}
									</span>
									<Button
										size="sm"
										variant="outline"
										onClick={scopeLog.openLog}
										disabled={scopeLog.status === "loading"}
									>
										Open log in AdvantageScope
									</Button>
								</div>
							) : undefined
						}
					/>
				}
				choreo={<ChoreoPane key={reloadNonce} workspaceSlug={simSlug} />}
				elastic={<ElasticPane workspaceSlug={simSlug} />}
				preview={previewPane}
				driverStation={
					<DriverStation
						simulationStatus={simulation.status}
						runStatus={simulation.runStatus}
						runConnection={runConnection}
						sessionReady={sessionReady}
						consoleLines={consoleLines}
						autoStatus={autoChoosers.status}
						gamepad={{
							inputMode,
							available: gamepad.available,
							selectedIndex: gamepad.selectedIndex,
							frame: gamepad.frame,
							keyboardFrame,
							keyboardPressedCodes: keyboardCodes,
							channelConnection: channel.connection,
							channelHalsimDisconnected: channel.halsimDisconnected,
							onSelectControllerMode,
							onSelectKeyboardMode,
							onKeyboardCodesChange,
							onKeyboardRelease,
							onSelect: onSelectGamepad,
							onRelease: onReleaseGamepad,
						}}
						onStartRun={simulation.startRun}
						onStopRun={simulation.stopRun}
						onRestartRun={simulation.restartRun}
						onSetDriverStation={simulation.setDriverStation}
						onSelectAuto={autoChoosers.selectAuto}
					/>
				}
			/>
			<SwitchProjectDialog
				open={switchOpen}
				onOpenChange={setSwitchOpen}
				workspaceSlug={workspaceSlug}
				currentModule={currentModule}
				onSwapComplete={onSwapComplete}
			/>
			<CheckpointsDialog
				open={checkpointsOpen}
				onOpenChange={setCheckpointsOpen}
				state={checkpoints.state}
				loading={checkpoints.loading}
				verifying={checkpoints.verifying}
				error={checkpoints.error}
				verify={checkpoints.verify}
				onLaunchNewLesson={() => setSwitchOpen(true)}
			/>
		</PaneVisibilityRoot>
	);
}
