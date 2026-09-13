public class Main {
    // TODO: return the largest value in values.
    public static int max(int[] values) {
        return 0;
    }

    // TODO: return the average of all values in values, as a double.
    public static double average(int[] values) {
        return 0.0;
    }

    // TODO: return a NEW array where every value from `values` is doubled.
    // Don't modify the array that was passed in - build and return a new one.
    public static int[] doubleAll(int[] values) {
        return null;
    }

    // TODO: return true if target appears anywhere in values.
    public static boolean contains(int[] values, int target) {
        return false;
    }

    public static void main(String[] args) {
        int[] sample = {4, 1, 4, 3, 9};
        System.out.println("Max: " + max(sample));
        System.out.println("Average: " + average(sample));
        System.out.println("Doubled: " + java.util.Arrays.toString(doubleAll(sample)));
        System.out.println("Contains 9? " + contains(sample, 9));
    }
}
