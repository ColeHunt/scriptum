public class DisableCheck {
    public static void main(String[] args) {
        MotorController motor = new MotorController(false);
        motor.enableMotor();
        motor.setMotorSpeed(0.8);
        motor.disableMotor();
        if (Math.abs(motor.getMotorSpeed() - 0.0) > 0.0001) {
            System.out.println(
                "getMotorSpeed() after disableMotor() was " + motor.getMotorSpeed() + ", expected 0.0."
            );
            System.exit(1);
        }
        // Once disabled, setMotorSpeed should be gated again too.
        motor.setMotorSpeed(0.5);
        if (Math.abs(motor.getMotorSpeed() - 0.0) > 0.0001) {
            System.out.println("setMotorSpeed still worked after disableMotor() - the motor should stay off.");
            System.exit(1);
        }
        System.out.println("disableMotor looks good.");
    }
}
