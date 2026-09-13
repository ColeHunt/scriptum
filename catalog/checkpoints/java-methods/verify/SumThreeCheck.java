public class SumThreeCheck {
    public static void main(String[] args) {
        check(1, 2, 3, 6.0);
        check(0.5, 0.25, 0.25, 1.0);
        check(-2, 2, 0, 0.0);
        System.out.println("sumThree looks good.");
    }

    static void check(double a, double b, double c, double expected) {
        double actual = Main.sumThree(a, b, c);
        if (Math.abs(actual - expected) > 0.0001) {
            System.out.println(
                "sumThree(" + a + ", " + b + ", " + c + ") returned " + actual + ", expected " + expected + "."
            );
            System.exit(1);
        }
    }
}
