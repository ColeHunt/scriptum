public class BatteryStatusCheck {
    public static void main(String[] args) {
        check(0, "EMPTY");
        check(25, "LOW");
        check(49.9, "LOW");
        check(50, "MEDIUM");
        check(89.9, "MEDIUM");
        check(90, "FULL");
        check(100, "FULL");
        System.out.println("batteryStatus looks good.");
    }

    static void check(double percent, String expected) {
        String actual = Main.batteryStatus(percent);
        if (!expected.equals(actual)) {
            System.out.println(
                "batteryStatus(" + percent + ") returned " + actual + ", expected " + expected + "."
            );
            System.exit(1);
        }
    }
}
