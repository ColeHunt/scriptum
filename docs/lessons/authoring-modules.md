---
sidebar_position: 2
title: Authoring Lesson Modules
---

# Authoring Lesson Modules

You can write your own lessons for your team and serve them from a public GitHub
repository, with no app rebuild. This page covers the repository layout, the
manifest schema, the three lesson kinds, checkpoints and hard prerequisites,
and how to publish.

If you only want to use the built-in demo lessons, you do not need any of this;
see [How Lessons Work](./overview.md).

## Worked examples

Real examples to read alongside this page:

- **A complete standalone lessons repo:**
  [github.com/mathewdunne/coderunner-lessons](https://github.com/mathewdunne/coderunner-lessons),
  the maintainer's own team lessons, structured exactly as described here and
  exercising all three `kind`s, `track`/`requires` grouping, and both
  checkpoint verifier types.
- **The bundled demo catalog:**
  [`catalog/` in the CodeRunner repo](https://github.com/mathewdunne/CodeRunner/tree/main/catalog),
  intentionally minimal (just `hello-world` and `robot-starter`, for a
  zero-config/offline first run) — see
  [How Lessons Work](./overview.md#the-bundled-catalog) for why the full
  curriculum lives in a lessons repo instead of here.

## Repository layout

A lessons repository has a manifest at its root, one directory per module, and
(for any module with checkpoints) a matching `checkpoints/` tree:

```text
modules.json              ← the catalog manifest (required, at repo root)
modules/
  hello-world/             ← one directory per module
    README.md             ← the lesson text
    .vscode/              ← editor config (run config, Java settings)
    src/...               ← the starting source files
  git-basics/
    01-first-commit/
    02-feature-branch/
    ...
checkpoints/
  hello-world/
    verify/
      prints-hello-world.sh
  git-basics/
    setup.sh               ← runs once, right after the module loads
    verify/
      first-commit.sh
      feature-branch.sh
      ...
```

Each `modules/<id>/` directory is a **complete starting project**: everything
the student needs the moment the lesson loads. There is no separate build or
packaging step; CodeRunner copies the directory contents directly into the
student's workspace. `checkpoints/<id>/` is separate — its contents are never
copied into the student's project; they're fetched and run by the control
plane itself (see [Checkpoints](#checkpoints-and-hard-prerequisites) below).

The `modules/`/`checkpoints/` folder names are a convention used by these
examples, not a requirement. The manifest's `subdir` field (below) is what
actually points at each module's directory; a checkpoint's `verifier.path`
(or a module's `setupScript`) is what points at its script, always as a path
relative to the repo root. Lay the repo out however you like as long as those
fields match.

## The `modules.json` manifest

`modules.json` lists every module in the catalog. Here is a complete, valid
example covering every field (see `catalog/modules.json` in the CodeRunner
repo for the real bundled manifest, which exercises all of this at once):

```json
{
  "schemaVersion": 1,
  "modules": [
    {
      "id": "hello-world",
      "title": "Hello, World",
      "description": "Basic java hello world project",
      "subdir": "modules/hello-world",
      "kind": "plain-java",
      "order": 10,
      "track": "Java Basics",
      "checkpoints": [
        {
          "id": "prints-hello-world",
          "title": "Prints Hello, World!",
          "description": "Running Main prints \"Hello, World!\" to standard out.",
          "verifier": {
            "type": "script",
            "path": "checkpoints/hello-world/verify/prints-hello-world.sh"
          }
        }
      ]
    },
    {
      "id": "java-variables",
      "title": "Variables",
      "description": "Declare variables, define a constant, and define your first enum.",
      "subdir": "modules/java-variables",
      "kind": "plain-java",
      "order": 11,
      "track": "Java Basics",
      "requires": ["hello-world"]
    },
    {
      "id": "git-basics",
      "title": "Git Basics",
      "description": "Commit, branch, merge, resolve a conflict, and rebase.",
      "subdir": "modules/git-basics",
      "kind": "git",
      "order": 5,
      "track": "Tools",
      "setupScript": "checkpoints/git-basics/setup.sh",
      "checkpoints": [
        {
          "id": "first-commit",
          "title": "First commit",
          "description": "Add your name to roster.txt and commit it with a real message.",
          "verifier": {
            "type": "script",
            "path": "checkpoints/git-basics/verify/first-commit.sh"
          }
        }
      ]
    },
    {
      "id": "robot-starter",
      "title": "Robot Starter",
      "description": "A minimal WPILib command-based robot you run from the Driver Station.",
      "subdir": "modules/robot-starter",
      "kind": "robot",
      "order": 20,
      "track": "FRC Robot",
      "requires": ["git-basics"]
    }
  ]
}
```

### Top-level fields

| Field | Type | Notes |
| --- | --- | --- |
| `schemaVersion` | integer | Manifest format version. Use `1`. |
| `modules` | array | One entry per lesson module. |

### Module fields

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string | yes | Stable, unique identifier. Used internally and recorded as the student's current module. Don't reuse or rename casually. |
| `title` | string | yes | Shown in the Switch Project menu. |
| `description` | string | yes | One-line summary shown under the title. May be empty. |
| `subdir` | string | yes | Relative path from the repo root to the module directory (for example `modules/hello-world`). Must be a relative path of safe segments: no leading slash and no `..`. |
| `kind` | string | yes | One of `plain-java`, `robot`, `git`. See below. |
| `order` | integer | yes | Sort position in the menu (ascending). |
| `track` | string | no | A cosmetic grouping label shown in the menu (for example `"Java Basics"`). Purely for display — it does **not** gate anything. Don't confuse it with `requires`. |
| `requires` | string[] | no | Ids of other modules that must be completed first (every non-optional checkpoint passed) before this one can be loaded — the actual hard-lock gate. Default `[]` (no prerequisites). An id that doesn't resolve to a real module is skipped, not treated as blocking. |
| `checkpoints` | array | no | Verifiable goals for this module. Default `[]` (no checkpoints, no lock gating possible for anything that `requires` this module). See [Checkpoints](#checkpoints-and-hard-prerequisites). |
| `setupScript` | string | no | A repo-root-relative script run once, immediately after the module's files are copied in. Used by the `git` kind to build real commit history — see below. |
| `showScope` | boolean | no | Default `false`. Mounts the AdvantageScope telemetry pane even for a non-`robot` module - for a `plain-java` module that generates a static log file and wants students opening it in AdvantageScope with no live robot involved. `advantagescope-intro` is `robot`-kind (live NT4 telemetry) and does not use this. |

### Sparse ordering

`order` is just a sort key, so leave gaps. Numbering modules `10`, `20`, `30`
instead of `1`, `2`, `3` lets you insert a new lesson between two existing ones
later (say `15`) without renumbering everything else.

## The three lesson kinds

The `kind` field controls how the student runs the lesson and what the UI shows.

### `plain-java`

A bare Java project with no Gradle or WPILib, just `.java` source files. The
student runs it **from the editor's Run button**, and the robot simulation UI is
hidden because there is no robot. Use this for programming fundamentals:
variables, loops, classes, terminal I/O.

A `plain-java` module needs a `.vscode/launch.json` with a run configuration so
the editor knows what to launch. The bundled `hello-world` module uses this:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "java",
      "name": "Run Main",
      "request": "launch",
      "mainClass": "Main",
      "cwd": "${workspaceFolder}",
      "console": "integratedTerminal"
    }
  ]
}
```

Point `mainClass` at the class with your `main` method.

### `robot`

A full WPILib/Gradle robot project, the same structure WPILib's project
generator produces (`build.gradle`, `gradlew`, `vendordeps/`, `.wpilib/`,
`src/main/java/frc/robot/...`). The student clicks **Start** in the Driver
Station, which builds the project and starts it in simulation. Once it is
ready, they choose a mode and click **Enable**. The full Driver Station and
the AdvantageScope/Choreo/Elastic tool panes are available. Use this for robot programming.

To seed Choreo content, include its normal deploy tree under
`src/main/deploy/choreo/`. Those files are copied with the rest of the
module and are editable from either Choreo or VSCodium.

You do not need to do anything special to make a robot project run headless in
the container. CodeRunner applies a non-destructive Gradle override at run time
that strips the desktop simulation GUI and enables the WebSocket server the web
Driver Station needs. The student still sees their original `build.gradle`
unchanged in the editor. (This means projects that call `addGui()` /
`addDriverstation()` work without edits, which is useful to know if you base a
`robot` module on an existing team project.)

### `git`

A project that keeps its `.git` history — every other kind is **gitless**
(loaded fresh, no repository, "reset" just means re-copy the starting files).
Use this for lessons that teach Git itself: commit, branch, merge, resolve a
conflict, rebase. The bundled `git-basics` module builds five small scenario
repos (first commit, feature branch, merge, merge conflict, rebase) via its
`setupScript`, each checkpoint verifying real repo state (an actual commit,
an actual merge, a resolved conflict) rather than file contents.

A `git` module almost always pairs with `setupScript`: the module directory
holds the starting *files*, and the setup script turns them into a real
repository with the commit/branch history the lesson needs (`git init`,
scripted commits, branches, etc. — see `checkpoints/git-basics/setup.sh` in
[github.com/mathewdunne/coderunner-lessons](https://github.com/mathewdunne/coderunner-lessons)
for the real example). The script runs once,
immediately after the module's files land in the workspace, as the same
non-root user the student's own shell runs as, from the workspace project
root.

## Checkpoints and hard prerequisites

A module's `checkpoints` are goals the student can verify against, and the
mechanism behind `requires` (hard prerequisite locking): a module is only
"complete" once every one of its non-optional checkpoints has passed, and
another module that lists it in `requires` stays locked (can't be loaded)
until it's complete. A module with no checkpoints is always considered
complete — `requires` only gates on modules that actually have something to
check.

### Checkpoint fields

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string | yes | Kebab-case, unique within the module. |
| `title` | string | yes | Shown to the student. |
| `description` | string | yes | What the student needs to do. |
| `optional` | boolean | no | Default `false`. An optional checkpoint can fail without blocking the module's "complete" status or anything that `requires` it. |
| `verifier` | object | yes | How this checkpoint is checked — one of the two types below. |

### Verifier type `script`

Runs a script you write against the student's live project, inside their own
container. Exit code `0` means passed; anything else means failed. The
script's last non-empty line of stdout (or stderr, on failure) is shown to
the student as a hint, so make failure output actionable.

```json
{ "type": "script", "path": "checkpoints/hello-world/verify/prints-hello-world.sh" }
```

`path` is repo-root-relative, by convention under `checkpoints/<moduleId>/verify/`.
The script is invoked as `bash <path> <projectDir> <scopeLayoutPath>` — most
verify scripts only need the first argument (the project directory to check
against); the second exists for checkpoints that need to inspect the
student's current AdvantageScope layout (see `advantagescope-intro`'s
checkpoints for an example). A script has 15 seconds to run. It can be a
supporting file alongside a compiled check, too — `hello-world`'s verifier
compiles and runs a small `HelloWorldCheck.java` from
`checkpoints/hello-world/verify/`, not just shell.

### Verifier type `nt4-value`

For a `robot`-kind module: checks a live NetworkTables value the running
robot program is publishing, instead of anything on disk. Two checks:
`"range"` (stays within `min`/`max` across several samples) and `"changes"`
(isn't frozen — the value actually varies over time, to rule out a hardcoded
constant passing a naive check).

```json
{
  "type": "nt4-value",
  "topic": "/AdvantageKit/RealOutputs/ClimberSpeed",
  "check": "range",
  "min": 0.0,
  "max": 1.0
}
```

### How checkpoint scripts get to the student's container

For the **bundled** catalog, `checkpoints/` is baked into the application
image and always available. For a **remote** catalog, the control plane
fetches a module's `checkpoints/<id>/` directory itself — you don't need to
do anything differently as an author, but it's worth understanding what
happens: `setupScript` is fetched once, at load time, alongside the module's
own files (so it can run immediately); `verify/*.sh` scripts are fetched
fresh from your repo on every Verify click (not cached), which is what makes
this safe to run regardless of how long ago the lesson was loaded. Both run
at the same trust level as the bundled catalog's scripts — the control plane
runs whatever your repo ships, so don't point `LESSONS_CATALOG_REPO` at a
repository you don't control. See
[decision 044](https://github.com/mathewdunne/CodeRunner/blob/main/docs/decisions/044-remote-catalog-checkpoints.md)
for the full design.

## The README is the lesson text

Each module's `README.md` is the lesson. When a student loads a module,
the README appears at the workspace root. Write it as the student-facing
walkthrough: goal, steps, and optional bonus challenges.

Students open `README.md` from the Explorer sidebar, so use a clear filename and
make the document useful from its first heading. For example, the bundled
`hello-world` README begins with the goal, lists numbered steps, and finishes
with bonus challenges.

![A lesson opened side by side with the README](/img/screenshots/lesson-readme-opened.png)

## The `.vscode/` folder

The module's `.vscode/` folder ships editor configuration into the workspace:

- For `plain-java`, a `launch.json` run configuration (above) plus a
  `settings.json` that tells the Java extension how to treat the project (for
  example marking `src` as the source path and disabling Gradle import).
- For `robot`, editor settings appropriate to a Gradle/WPILib project.

Including a sensible `.vscode/` is what makes a lesson "just work" when it loads,
instead of the student having to configure the editor themselves.

## Publishing

1. Put your repo on a public GitHub repository with `modules.json` at the root.
2. On the control plane, set `LESSONS_CATALOG_REPO` to `owner/repo` (or the full
   `https://github.com/owner/repo` URL), and optionally `LESSONS_CATALOG_BRANCH`
   if you are not using `main`. See
   [Configuration](../reference/configuration.md).
3. Push your changes. CodeRunner caches the module list for **60 seconds**, so
   edits go live within about a minute with no app rebuild or redeploy.

When a remote catalog is configured, students never see the bundled demo
modules; your repo's modules fully replace them.

## Example curriculum

A natural progression is to start with plain-Java fundamentals and build toward
a working WPILib robot. One worked sequence:

1. **Hello, World** (`plain-java`): variables, terminal input, printing.
2. **Number guessing game** (`plain-java`): loops, conditionals, input
   validation.
3. **Perimeter / area** (`plain-java`): methods and arithmetic, then again
   class-based to introduce objects.
4. **First robot run** (`robot`): a starter robot you run from the Driver
   Station, logging values and a moving pose so students see telemetry.
5. **Timed and command-based robots** (`robot`): `teleopPeriodic`, subsystems,
   commands bound to controller buttons, an autonomous chooser.
6. **Controllers and templates** (`robot`): PID control and a kitbot-style
   drivetrain template.

The early `plain-java` lessons teach Java with fast edit-and-run feedback; the
later `robot` lessons move into real FRC code running in simulation. Mix and
order them to suit your team using the `order` field.
