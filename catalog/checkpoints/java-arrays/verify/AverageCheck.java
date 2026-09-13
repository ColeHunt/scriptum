public class AverageCheck {
    public static void main(String[] args) {
        check(new int[] {2, 4, 6}, 4.0);
        check(new int[] {1}, 1.0);
        check(new int[] {1, 2}, 1.5);
        System.out.println("average looks good.");
    }

    static void check(int[] values, double expected) {
        double actual = Main.average(values);
        if (Math.abs(actual - expected) > 0.0001) {
            System.out.println("average(...) returned " + actual + ", expected " + expected + ".");
            System.exit(1);
        }
    }
}
