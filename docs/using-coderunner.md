---
sidebar_position: 2
title: Using CodeRunner
---

# Using CodeRunner

## Get started

1. Sign in.
2. Click **Switch project**, then load a lesson or import a public GitHub project.
3. For a lesson, open its README and follow the instructions. For an imported
   project, open the files you want to work on.

:::warning[Switching projects discards your current workspace]

Switching or resetting replaces your current files. For an imported project,
commit and push any work you want to keep.

:::

## Robot lessons and imported projects

:::important[Start the simulation from CodeRunner]

The WPILib extension can start a simulation, but you should not use it here.
Click **Start** in the Driver Station at the bottom of the page so CodeRunner
can use its supported headless simulation setup and connect the controls and
telemetry.

:::

![The Driver Station before a run, with Start available and Enable waiting for robot code and communications](/img/screenshots/using-coderunner-start.png)

1. Click **Start** in the Driver Station.
2. Wait for **Comms** and **Robot Code** to turn green.

![The Driver Station ready to enable, with Comms and Robot Code green](/img/screenshots/using-coderunner-ready.png)

3. Select **Teleop**, **Auto**, or **Test**, then click **Enable**.
4. Click **Stop** when you are finished, or **Restart** to stop the code and re-run with any changes you've made.

Build output and robot output appear in the **Console** tab. Use the top-bar
**AdvantageScope**, **Choreo**, **Elastic Dashboard**, and **Preview** tabs to
switch tools beside the editor — each is independently toggleable, so you can
show more than one at once. AdvantageScope opens by default, and switching
tabs does not reload any of them. Drag the dividers to resize panes.

## Choreo

For robot lessons and imported projects, the **Choreo** tab opens the path
editor. For path and auto editing basics, see the
[official Choreo guide](https://choreo.autos).

Choreo writes to `src/main/deploy/choreo/**` in the current project — it runs
as its own process inside your workspace container, with direct access to
those files. If you edit a Choreo file directly in VSCodium, refresh the
CodeRunner page before looking for that change in Choreo. Switching or
resetting the project reloads Choreo with the new project's files.

Choreo's robot telemetry and hot reload are not connected. Use AdvantageScope
or Elastic Dashboard for simulated robot telemetry.

## Elastic Dashboard

The **Elastic Dashboard** tab is an alternative to AdvantageScope for viewing
live NetworkTables telemetry while a simulation runs. Its layout (which
widgets you've added and how they're arranged) is saved automatically to
`src/main/deploy/elastic-layout.json` in the current project, so it travels
with your code and survives a project switch.

## Preview

Use **Preview** to read project Markdown and generated HTML reports beside the
editor. Choose a file from the searchable picker, then click **Refresh** after a
build or edit. Preview uses local files, so external images and CDN assets will
not load.

See [Reading Documents](./lessons/preview.md) for the full details.

## Console lessons

`Console` type lessons are pure Java exercises, not robot projects. Because they
do not run a robot simulation, the simulation tools and Driver Station are
hidden and the VS Code editor expands to fill the screen. Use the editor's
**Run** button to run them.

The top bar still offers a **Preview** button for instructions and reports.

## Explore more

While a robot simulation is running, explore the Driver Station's **Auto** and
**Controls** tabs. **Auto** appears when the robot code publishes an autonomous
chooser; **Controls** lets you select a gamepad or keyboard input to control the
simulation.
