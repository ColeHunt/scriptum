public class ContainsCheck {
    public static void main(String[] args) {
        int[] sample = {4, 1, 4, 3, 9};
        if (!Main.contains(sample, 9)) {
            System.out.println("contains(sample, 9) returned false, expected true.");
            System.exit(1);
        }
        if (Main.contains(sample, 100)) {
            System.out.println("contains(sample, 100) returned true, expected false.");
            System.exit(1);
        }
        System.out.println("contains looks good.");
    }
}
