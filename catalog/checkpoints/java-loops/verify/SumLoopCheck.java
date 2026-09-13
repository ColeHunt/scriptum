public class SumLoopCheck {
    public static void main(String[] args) {
        check(1, 1);
        check(5, 15);
        check(10, 55);
        System.out.println("sumTo looks good.");
    }

    static void check(int n, int expected) {
        int actual = Main.sumTo(n);
        if (actual != expected) {
            System.out.println("sumTo(" + n + ") returned " + actual + ", expected " + expected + ".");
            System.exit(1);
        }
    }
}
