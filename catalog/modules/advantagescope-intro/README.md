# AdvantageScope: Reading Robot Telemetry

Background: [AdvantageScope](https://docs.advantagescope.org/) is the tool
teams use to visualize robot telemetry - line graphs, 3D/2D fields, tables,
and more.

A sample `logs/telemetry.csv` is already included, so you can start
practicing AdvantageScope right away - click **Open log in AdvantageScope**
in the Scope pane on the right to load it, no need to write any code first.

Separately, fill in the two methods in `src/Main.java`. Running the program
overwrites `logs/telemetry.csv` with your own version - a nice way to check
your implementation looks right, but not required to work through the
AdvantageScope steps below.

## Contract

- `double flywheelRpm(double t)` - oscillates between 0 and 6000 as `t`
  increases (a sine wave works well).
- `boolean gamePieceLoaded(double t)` - toggles back and forth as `t`
  increases.

## Using AdvantageScope

Once the log is open:

1. Drag **FlywheelRPM** onto a new **Line Graph** tab.
2. Right-click the graph's Y axis and lock its range to roughly 0-6000.
3. (Optional) Drag **GamePieceLoaded** onto a new **Table** tab.

## Checking your work

Click **Checkpoints** in the top bar and run **Verify** whenever you want -
the checkpoints always look at what's actually configured in AdvantageScope
right now, not a cached snapshot. If you re-run your program, click **Open
log in AdvantageScope** again to load the new version.
