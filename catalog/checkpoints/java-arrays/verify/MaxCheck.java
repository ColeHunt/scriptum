public class MaxCheck {
    public static void main(String[] args) {
        check(new int[] {4, 1, 4, 3, 9}, 9);
        check(new int[] {-5, -1, -10}, -1);
        check(new int[] {7}, 7);
        System.out.println("max looks good.");
    }

    static void check(int[] values, int expected) {
        int actual = Main.max(values);
        if (actual != expected) {
            System.out.println("max(...) returned " + actual + ", expected " + expected + ".");
            System.exit(1);
        }
    }
}
