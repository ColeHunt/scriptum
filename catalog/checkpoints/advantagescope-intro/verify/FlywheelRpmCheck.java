public class FlywheelRpmCheck {
    public static void main(String[] args) {
        double min = Double.POSITIVE_INFINITY;
        double max = Double.NEGATIVE_INFINITY;
        for (double t = 0; t <= 10; t += 0.5) {
            double rpm = Main.flywheelRpm(t);
            if (rpm < 0 || rpm > 6000) {
                System.out.println("flywheelRpm(" + t + ") returned " + rpm + ", expected a value between 0 and 6000.");
                System.exit(1);
            }
            min = Math.min(min, rpm);
            max = Math.max(max, rpm);
        }
        if (max - min < 100) {
            System.out.println("flywheelRpm(t) looks constant - it should oscillate as t changes.");
            System.exit(1);
        }
        System.out.println("flywheelRpm looks good.");
    }
}
