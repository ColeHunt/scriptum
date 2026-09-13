# Classes & Objects

Background: [Classes and Objects](https://frc-team-4143.github.io/docs/software/java/classes-objs).

This lesson builds the exact `MotorController` example from that page. Fill
in `src/MotorController.java`; `src/Main.java` already creates two motors and
runs them, so click **Run** any time to see it in action.

## Contract

Team standard: class member fields use `trailing_snake_case_`.

- Fields: `current_motor_speed_` (double), `target_motor_speed_` (double),
  `motor_enabled_` (boolean), `motor_direction_` (double — `1.0` forward,
  `-1.0` reversed).
- `MotorController(boolean is_reversed)` — `target_motor_speed_` starts at
  `0.0`, `motor_enabled_` starts `false`, `motor_direction_` is `-1.0` when
  `is_reversed` is true, otherwise `1.0`.
- `setMotorSpeed(double speed)` — does nothing if the motor isn't enabled;
  otherwise sets `target_motor_speed_ = speed * motor_direction_`.
- `getMotorSpeed()` — returns `target_motor_speed_`.
- `enableMotor()` — sets `motor_enabled_ = true`.
- `disableMotor()` — sets `target_motor_speed_ = 0.0` and
  `motor_enabled_ = false`.

## Checking your work

Click **Checkpoints** in the top bar and run **Verify** whenever you want.
