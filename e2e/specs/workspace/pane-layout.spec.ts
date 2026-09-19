/**
 * Pane sizing persists across a reload (sessionStorage), and resets in a new session.
 */
import { expect, test } from "../../fixtures/app";
import { loginAs } from "../../fixtures/auth";
import {
	seedRuntimeRunning,
	seedWorkspaceProject,
} from "../../fixtures/runtime";

test("resized pane sizes survive a reload and reset in a new session", async ({
	page,
	app,
	runtime,
	fakeVscode,
	fakeHalsim,
}) => {
	const session = await loginAs(page, app, { name: "Panes" });
	const workspace = app.storage.findWorkspaceBySlug(
		session.user.slug as never,
	)!;
	await seedWorkspaceProject(workspace.project_path);
	seedRuntimeRunning({
		runtime,
		workspaceId: workspace.id,
		fakeVscode,
		fakeHalsim,
	});

	await page.goto(`/u/${session.user.slug}/`);

	const console_ = page.locator("#ide-console");
	await expect(console_).toBeVisible();
	const defaultHeight = (await console_.boundingBox())!.height;

	// Grow the console pane with the separator's keyboard resize.
	const separator = page.locator(
		'[data-slot="resizable-handle"][aria-orientation="horizontal"]',
	);
	await separator.focus();
	for (let i = 0; i < 10; i++) {
		await separator.press("ArrowUp");
	}

	const resizedHeight = (await console_.boundingBox())!.height;
	expect(resizedHeight).toBeGreaterThan(defaultHeight + 50);

	await page.reload();
	await expect(console_).toBeVisible();
	const restoredHeight = (await console_.boundingBox())!.height;
	expect(Math.abs(restoredHeight - resizedHeight)).toBeLessThan(5);

	// A fresh browser session (new sessionStorage) falls back to the defaults.
	const freshContext = await page.context().browser()!.newContext();
	const freshPage = await freshContext.newPage();
	const freshSession = await loginAs(freshPage, app, { name: "Panes Fresh" });
	const freshWorkspace = app.storage.findWorkspaceBySlug(
		freshSession.user.slug as never,
	)!;
	await seedWorkspaceProject(freshWorkspace.project_path);
	seedRuntimeRunning({
		runtime,
		workspaceId: freshWorkspace.id,
		fakeVscode,
		fakeHalsim,
	});
	await freshPage.goto(`/u/${freshSession.user.slug}/`);
	const freshConsole = freshPage.locator("#ide-console");
	await expect(freshConsole).toBeVisible();
	const freshHeight = (await freshConsole.boundingBox())!.height;
	expect(Math.abs(freshHeight - defaultHeight)).toBeLessThan(5);

	await freshContext.close();
});
