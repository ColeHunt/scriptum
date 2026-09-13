public class ConstructorDirectionCheck {
    public static void main(String[] args) {
        MotorController forward = new MotorController(false);
        forward.enableMotor();
        forward.setMotorSpeed(1.0);
        if (Math.abs(forward.getMotorSpeed() - 1.0) > 0.0001) {
            System.out.println(
                "new MotorController(false), enabled, setMotorSpeed(1.0) -> getMotorSpeed() was "
                    + forward.getMotorSpeed() + ", expected 1.0."
            );
            System.exit(1);
        }

        MotorController reversed = new MotorController(true);
        reversed.enableMotor();
        reversed.setMotorSpeed(1.0);
        if (Math.abs(reversed.getMotorSpeed() - (-1.0)) > 0.0001) {
            System.out.println(
                "new MotorController(true), enabled, setMotorSpeed(1.0) -> getMotorSpeed() was "
                    + reversed.getMotorSpeed() + ", expected -1.0 (reversed direction)."
            );
            System.exit(1);
        }
        System.out.println("Constructor and direction look good.");
    }
}
