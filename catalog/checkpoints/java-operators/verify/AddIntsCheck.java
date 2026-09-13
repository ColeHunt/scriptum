public class AddIntsCheck {
    public static void main(String[] args) {
        check(Main.addInts(3, 4), 7, "addInts(3, 4)");
        check(Main.addInts(-2, 5), 3, "addInts(-2, 5)");
        check(Main.addInts(0, 0), 0, "addInts(0, 0)");
        System.out.println("addInts looks good.");
    }

    static void check(int actual, int expected, String label) {
        if (actual != expected) {
            System.out.println(label + " returned " + actual + ", expected " + expected + ".");
            System.exit(1);
        }
    }
}
