/**
 * The workbench's pane toggles, wired end to end: WorkspacePage + topbar
 * toggle row + all four panes (editor/AdvantageScope/Choreo/Driver Station)
 * + the project-swap remount. The component tests cover PaneVisibility and
 * IDELayout in isolation; these cover the assembly.
 *
 * Unlike the old exclusive-tab model, any subset of panes can be visible at
 * once - toggling every other pane off is what makes the remaining one fill
 * the whole screen, so there's no separate "maximize" to test. Driver Station
 * is a full sibling row rather than a workbench column, so it can be hidden
 * on its own to let the workbench (editor/AdvantageScope/Choreo) grow to the
 * full window height too.
 *
 * The fake Choreo dist (createChoreoDist) counts its loads in sessionStorage
 * and exposes the count on <body>, which is the only way to tell a real
 * iframe reload from a no-op — the iframe's `src` never changes.
 */
import type { Page } from "@playwright/test";
import type { AppFixtures } from "../../fixtures/app";
import { expect, test } from "../../fixtures/app";
import { loginAs } from "../../fixtures/auth";
import {
	seedRuntimeRunning,
	seedWorkspaceProject,
} from "../../fixtures/runtime";
import { WorkspacePage } from "../../page-objects/workspace.po";

type Deps = Pick<AppFixtures, "app" | "runtime" | "fakeVscode" | "fakeHalsim">;

/**
 * Log in, seed a non-empty project (so the Switch Project dialog doesn't
 * auto-open over the UI) and a running runtime, then open the workspace.
 */
async function openWorkspace(
	page: Page,
	{ app, runtime, fakeVscode, fakeHalsim }: Deps,
	name: string,
): Promise<WorkspacePage> {
	const { user } = await loginAs(page, app, { name });
	const workspace = app.storage.findWorkspaceBySlug(user.slug as never)!;
	await seedWorkspaceProject(workspace.project_path);
	seedRuntimeRunning({
		runtime,
		workspaceId: workspace.id,
		fakeVscode,
		fakeHalsim,
	});

	const po = new WorkspacePage(page, user.slug);
	await po.goto();
	return po;
}

/** Waits for the fake Choreo page and returns how many times it loaded. */
async function choreoLoads(po: WorkspacePage): Promise<number> {
	const body = po.choreoIframe().locator("body");
	await expect(body).toHaveAttribute("data-fake-choreo-ready", "true");
	await expect(body).toHaveAttribute("data-fake-choreo-loads", /^[0-9]+$/);
	return Number(await body.getAttribute("data-fake-choreo-loads"));
}

function editorToggle(page: Page) {
	return page.getByRole("button", { name: "Editor" });
}

function scopeToggle(page: Page) {
	return page.getByRole("button", { name: "AdvantageScope" });
}

function choreoToggle(page: Page) {
	return page.getByRole("button", { name: "Choreo" });
}

function driverStationToggle(page: Page) {
	return page.getByRole("button", { name: "Driver Station" });
}

/**
 * A collapsed pane is still mounted, just sized to (close to) zero width.
 * The resizable panel div and the iframe inside it both carry data-pane, so
 * this narrows to the panel itself via its resizable-panel data-slot.
 */
async function paneWidth(page: Page, pane: string): Promise<number> {
	const box = await page
		.locator(`[data-slot="resizable-panel"][data-pane="${pane}"]`)
		.boundingBox();
	return box?.width ?? 0;
}

/** Same idea as paneWidth, but for the vertical split (workbench vs. console). */
async function paneHeight(page: Page, pane: string): Promise<number> {
	const box = await page
		.locator(`[data-slot="resizable-panel"][data-pane="${pane}"]`)
		.boundingBox();
	return box?.height ?? 0;
}

test("editor and AdvantageScope are visible by default, Choreo collapsed", async ({
	page,
	app,
	runtime,
	fakeVscode,
	fakeHalsim,
}) => {
	await openWorkspace(
		page,
		{ app, runtime, fakeVscode, fakeHalsim },
		"Toggle Default",
	);

	await expect(editorToggle(page)).toHaveAttribute("aria-pressed", "true");
	await expect(scopeToggle(page)).toHaveAttribute("aria-pressed", "true");
	await expect(choreoToggle(page)).toHaveAttribute("aria-pressed", "false");

	expect(await paneWidth(page, "editor")).toBeGreaterThan(50);
	expect(await paneWidth(page, "scope")).toBeGreaterThan(50);
	expect(await paneWidth(page, "choreo")).toBeLessThan(5);
});

test("toggling Choreo on reveals it alongside AdvantageScope, not instead of it", async ({
	page,
	app,
	runtime,
	fakeVscode,
	fakeHalsim,
}) => {
	const po = await openWorkspace(
		page,
		{ app, runtime, fakeVscode, fakeHalsim },
		"Toggle Additive",
	);

	await choreoToggle(page).click();

	await expect(scopeToggle(page)).toHaveAttribute("aria-pressed", "true");
	await expect(choreoToggle(page)).toHaveAttribute("aria-pressed", "true");
	expect(await paneWidth(page, "scope")).toBeGreaterThan(20);
	expect(await paneWidth(page, "choreo")).toBeGreaterThan(20);
	await expect(po.scopeIframe().locator("body")).toContainText("AS Lite");
	await expect(po.choreoIframe().locator("body")).toContainText(
		"Choreo test dist",
	);
});

test("toggling off every other pane fills the workbench with the one left", async ({
	page,
	app,
	runtime,
	fakeVscode,
	fakeHalsim,
}) => {
	await openWorkspace(
		page,
		{ app, runtime, fakeVscode, fakeHalsim },
		"Toggle Fullscreen",
	);

	await choreoToggle(page).click();
	await editorToggle(page).click();
	await scopeToggle(page).click();

	// Editor and AdvantageScope both off, Choreo the only one left - it
	// should now span (approximately) the full workbench width.
	const workbenchWidth = await paneWidth(page, "choreo");
	const viewport = page.viewportSize();
	expect(viewport).not.toBeNull();
	expect(workbenchWidth).toBeGreaterThan((viewport?.width ?? 0) * 0.9);
});

test("toggling off AdvantageScope, Choreo, and Driver Station makes the editor fill the entire screen", async ({
	page,
	app,
	runtime,
	fakeVscode,
	fakeHalsim,
}) => {
	await openWorkspace(
		page,
		{ app, runtime, fakeVscode, fakeHalsim },
		"Toggle Just The IDE",
	);

	await scopeToggle(page).click();
	await driverStationToggle(page).click();

	// Choreo was already collapsed by default; only Editor is left, both
	// across the workbench's columns and against the console row below it.
	const viewport = page.viewportSize();
	expect(viewport).not.toBeNull();
	expect(await paneWidth(page, "editor")).toBeGreaterThan(
		(viewport?.width ?? 0) * 0.9,
	);
	expect(await paneHeight(page, "editor")).toBeGreaterThan(
		(viewport?.height ?? 0) * 0.9,
	);
	expect(await paneHeight(page, "console")).toBeLessThan(5);
});

test("Driver Station toggles independently and comes back without disturbing the other panes", async ({
	page,
	app,
	runtime,
	fakeVscode,
	fakeHalsim,
}) => {
	await openWorkspace(
		page,
		{ app, runtime, fakeVscode, fakeHalsim },
		"Toggle Driver Station",
	);

	await expect(driverStationToggle(page)).toHaveAttribute(
		"aria-pressed",
		"true",
	);

	await driverStationToggle(page).click();
	await expect(driverStationToggle(page)).toHaveAttribute(
		"aria-pressed",
		"false",
	);
	// Editor and AdvantageScope are untouched by the Driver Station toggle.
	await expect(editorToggle(page)).toHaveAttribute("aria-pressed", "true");
	await expect(scopeToggle(page)).toHaveAttribute("aria-pressed", "true");

	await driverStationToggle(page).click();
	await expect(driverStationToggle(page)).toHaveAttribute(
		"aria-pressed",
		"true",
	);
	expect(await paneHeight(page, "console")).toBeGreaterThan(20);
});

test("refuses to hide the last visible pane", async ({
	page,
	app,
	runtime,
	fakeVscode,
	fakeHalsim,
}) => {
	await openWorkspace(
		page,
		{ app, runtime, fakeVscode, fakeHalsim },
		"Toggle Last One",
	);

	await choreoToggle(page).click();
	await scopeToggle(page).click();
	await choreoToggle(page).click();
	// Only Editor is left visible now; toggling it must be a no-op.
	await editorToggle(page).click();

	await expect(editorToggle(page)).toHaveAttribute("aria-pressed", "true");
});

test("the pane selection survives a page reload", async ({
	page,
	app,
	runtime,
	fakeVscode,
	fakeHalsim,
}) => {
	await openWorkspace(
		page,
		{ app, runtime, fakeVscode, fakeHalsim },
		"Toggle Reload",
	);

	await choreoToggle(page).click();
	await scopeToggle(page).click();

	await page.reload();

	// sessionStorage-backed, so the reload comes back with the same panes.
	await expect(choreoToggle(page)).toHaveAttribute("aria-pressed", "true");
	await expect(scopeToggle(page)).toHaveAttribute("aria-pressed", "false");
});

test("a project swap reloads the Choreo iframe even while it's toggled on", async ({
	page,
	app,
	runtime,
	fakeVscode,
	fakeHalsim,
}) => {
	const po = await openWorkspace(
		page,
		{ app, runtime, fakeVscode, fakeHalsim },
		"Toggle Swap",
	);
	await choreoToggle(page).click();
	const loadsBefore = await choreoLoads(po);

	await page.getByRole("button", { name: "Switch project" }).click();
	const dialog = page.getByRole("dialog");

	// The bundled-catalog fixture offers a console module and a robot module;
	// pick the robot one, since console modules hide the sim panes entirely.
	await expect(
		dialog.getByRole("heading", { name: "Robot Starter" }),
	).toBeVisible();
	const robotCard = dialog
		.locator("div")
		.filter({ has: page.getByRole("heading", { name: "Robot Starter" }) })
		.filter({ has: page.getByRole("button", { name: "Load" }) })
		.last();

	await robotCard.getByRole("button", { name: "Load" }).click();
	await dialog.getByRole("button", { name: "Continue" }).click();
	await expect(dialog.getByText("Project ready")).toBeVisible({
		timeout: 15_000,
	});
	await dialog.getByRole("button", { name: "Done" }).click();

	// The remount keeps the same `src`, so assert on the load counter instead.
	await expect
		.poll(() => choreoLoads(po), { timeout: 15_000 })
		.toBeGreaterThan(loadsBefore);
});
