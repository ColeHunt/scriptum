import java.util.Arrays;

public class DoubleAllCheck {
    public static void main(String[] args) {
        int[] input = {1, 2, 3};
        int[] result = Main.doubleAll(input);
        int[] expected = {2, 4, 6};
        if (result == null || !Arrays.equals(result, expected)) {
            System.out.println(
                "doubleAll({1, 2, 3}) returned "
                    + (result == null ? "null" : Arrays.toString(result))
                    + ", expected " + Arrays.toString(expected) + "."
            );
            System.exit(1);
        }
        if (!Arrays.equals(input, new int[] {1, 2, 3})) {
            System.out.println("doubleAll modified the array it was given - build and return a new one instead.");
            System.exit(1);
        }
        System.out.println("doubleAll looks good.");
    }
}
