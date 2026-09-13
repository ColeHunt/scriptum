public class IndependentObjectsCheck {
    public static void main(String[] args) {
        MotorController left = new MotorController(false);
        MotorController right = new MotorController(false);

        left.enableMotor();
        left.setMotorSpeed(0.6);
        // right was never enabled, and never touched - it must still be at rest.
        if (Math.abs(right.getMotorSpeed() - 0.0) > 0.0001) {
            System.out.println(
                "A second MotorController's speed changed to " + right.getMotorSpeed()
                    + " just from creating and using the first one - each object needs its own fields."
            );
            System.exit(1);
        }
        if (Math.abs(left.getMotorSpeed() - 0.6) > 0.0001) {
            System.out.println("left.getMotorSpeed() was " + left.getMotorSpeed() + ", expected 0.6.");
            System.exit(1);
        }
        System.out.println("Independent objects look good.");
    }
}
