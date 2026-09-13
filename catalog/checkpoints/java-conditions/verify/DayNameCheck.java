public class DayNameCheck {
    public static void main(String[] args) {
        check(1, "Monday");
        check(4, "Thursday");
        check(7, "Sunday");
        check(0, "Invalid day");
        check(8, "Invalid day");
        System.out.println("dayName looks good.");
    }

    static void check(int day, String expected) {
        String actual = Main.dayName(day);
        if (!expected.equals(actual)) {
            System.out.println("dayName(" + day + ") returned " + actual + ", expected " + expected + ".");
            System.exit(1);
        }
    }
}
