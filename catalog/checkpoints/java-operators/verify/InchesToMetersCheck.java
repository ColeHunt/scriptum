public class InchesToMetersCheck {
    public static void main(String[] args) {
        check(Main.inchesToMeters(10), 0.254, "inchesToMeters(10)");
        check(Main.inchesToMeters(0), 0.0, "inchesToMeters(0)");
        check(Main.inchesToMeters(39.3701), 1.0, "inchesToMeters(39.3701)");
        System.out.println("inchesToMeters looks good.");
    }

    static void check(double actual, double expected, String label) {
        if (Math.abs(actual - expected) > 0.001) {
            System.out.println(label + " returned " + actual + ", expected about " + expected + ".");
            System.exit(1);
        }
    }
}
