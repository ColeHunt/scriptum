public class CountDivisibleByThreeCheck {
    public static void main(String[] args) {
        check(3, 1);
        check(9, 3);
        check(10, 3);
        check(12, 4);
        System.out.println("countDivisibleByThree looks good.");
    }

    static void check(int n, int expected) {
        int actual = Main.countDivisibleByThree(n);
        if (actual != expected) {
            System.out.println(
                "countDivisibleByThree(" + n + ") returned " + actual + ", expected " + expected + "."
            );
            System.exit(1);
        }
    }
}
