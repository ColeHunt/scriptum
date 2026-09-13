public class Main {
    public static void main(String[] args) {
        MotorController left_shooter_motor = new MotorController(false);
        MotorController right_shooter_motor = new MotorController(true);

        left_shooter_motor.enableMotor();
        right_shooter_motor.enableMotor();

        left_shooter_motor.setMotorSpeed(1.0);
        right_shooter_motor.setMotorSpeed(1.0);

        System.out.println("Left speed: " + left_shooter_motor.getMotorSpeed());
        System.out.println("Right speed: " + right_shooter_motor.getMotorSpeed());
    }
}
