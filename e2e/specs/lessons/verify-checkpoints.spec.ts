/**
 * The Checkpoints topbar button + dialog, wired end to end against the
 * bundled fixture's `checkpoint-demo` module (kind "git", two checkpoints —
 * see createCatalogDir in apps/control/src/__tests__/helpers.ts). The
 * exec results are scripted via injectExecFailure on the mock runtime, not
 * by actually running the checkpoint's shell scripts.
 */
import { expect, test } from "../../fixtures/app";
import { loginAs } from "../../fixtures/auth";
import {
	seedRuntimeRunning,
	seedWorkspaceProject,
} from "../../fixtures/runtime";
import { WorkspacePage } from "../../page-objects/workspace.po";

test("the Checkpoints button is hidden until a lesson with checkpoints is loaded", async ({
	page,
	app,
	runtime,
	fakeVscode,
	fakeHalsim,
}) => {
	const { user } = await loginAs(page, app, { name: "No Checkpoints Yet" });
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

	await expect(
		page.getByRole("button", { name: /Checkpoints \d+\/\d+/ }),
	).toHaveCount(0);
});

test("verifying shows pass/fail per checkpoint with a failure hint", async ({
	page,
	app,
	runtime,
	fakeVscode,
	fakeHalsim,
}) => {
	const { user } = await loginAs(page, app, { name: "Checkpoint Student" });
	const workspace = app.storage.findWorkspaceBySlug(user.slug as never)!;
	await seedWorkspaceProject(workspace.project_path);
	seedRuntimeRunning({
		runtime,
		workspaceId: workspace.id,
		fakeVscode,
		fakeHalsim,
	});
	app.storage.setCurrentModule(workspace.id, "checkpoint-demo", "git");

	runtime.injectExecFailure(
		workspace.id,
		(cmd) => cmd.some((a) => a.includes("rebase.sh")),
		{
			exitCode: 1,
			stdout: "develop shouldn't change for this exercise.\n",
			stderr: "",
		},
	);

	const po = new WorkspacePage(page, user.slug);
	await po.goto();

	const checkpointsButton = page.getByRole("button", {
		name: /Checkpoints \d+\/\d+/,
	});
	await expect(checkpointsButton).toBeVisible();
	await expect(checkpointsButton).toHaveText("Checkpoints 0/2");

	await checkpointsButton.click();
	const dialog = page.getByRole("dialog");
	await expect(dialog.getByText("Checkpoints", { exact: true })).toBeVisible();
	await expect(dialog.getByText("First commit")).toBeVisible();
	await expect(dialog.getByText("Rebase")).toBeVisible();

	await dialog.getByRole("button", { name: "Verify all" }).click();

	await expect(
		dialog.getByText("develop shouldn't change for this exercise."),
	).toBeVisible({ timeout: 10_000 });
	await expect(
		dialog.getByText("1 of 2 passing.", { exact: false }),
	).toBeVisible();

	await dialog.getByRole("button", { name: "Close" }).click();
	await expect(checkpointsButton).toHaveText("Checkpoints 1/2");
});

test("a per-row Verify only re-runs that one checkpoint", async ({
	page,
	app,
	runtime,
	fakeVscode,
	fakeHalsim,
}) => {
	const { user } = await loginAs(page, app, { name: "Single Checkpoint" });
	const workspace = app.storage.findWorkspaceBySlug(user.slug as never)!;
	await seedWorkspaceProject(workspace.project_path);
	seedRuntimeRunning({
		runtime,
		workspaceId: workspace.id,
		fakeVscode,
		fakeHalsim,
	});
	app.storage.setCurrentModule(workspace.id, "checkpoint-demo", "git");

	const po = new WorkspacePage(page, user.slug);
	await po.goto();

	await page.getByRole("button", { name: /Checkpoints \d+\/\d+/ }).click();
	const dialog = page.getByRole("dialog");
	const firstCommitRow = dialog
		.locator("li")
		.filter({ has: page.getByText("First commit") });
	await firstCommitRow.getByRole("button", { name: "Verify" }).click();

	await expect(
		dialog.getByText("1 of 2 passing.", { exact: false }),
	).toBeVisible();

	const rebaseCall = runtime.execCalls.find((c) =>
		c.command.some((a) => a.includes("rebase.sh")),
	);
	expect(rebaseCall).toBeUndefined();

	const firstCommitCall = runtime.execCalls.find((c) =>
		c.command.some((a) => a.includes("first-commit.sh")),
	);
	expect(firstCommitCall?.options.user).toBe("abc");
	expect(firstCommitCall?.options.workdir).toBe("/workspace/project");
});
