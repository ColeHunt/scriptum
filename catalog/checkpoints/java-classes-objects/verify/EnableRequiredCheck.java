public class EnableRequiredCheck {
    public static void main(String[] args) {
        MotorController motor = new MotorController(false);
        motor.setMotorSpeed(1.0);
        if (Math.abs(motor.getMotorSpeed() - 0.0) > 0.0001) {
            System.out.println(
                "setMotorSpeed(1.0) before enableMotor() changed the speed to "
                    + motor.getMotorSpeed() + " - it should do nothing until the motor is enabled."
            );
            System.exit(1);
        }
        System.out.println("Enable-required gating looks good.");
    }
}
