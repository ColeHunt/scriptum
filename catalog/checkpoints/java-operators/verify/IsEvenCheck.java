public class IsEvenCheck {
    public static void main(String[] args) {
        check(Main.isEven(4), true, "isEven(4)");
        check(Main.isEven(7), false, "isEven(7)");
        check(Main.isEven(0), true, "isEven(0)");
        check(Main.isEven(-3), false, "isEven(-3)");
        System.out.println("isEven looks good.");
    }

    static void check(boolean actual, boolean expected, String label) {
        if (actual != expected) {
            System.out.println(label + " returned " + actual + ", expected " + expected + ".");
            System.exit(1);
        }
    }
}
