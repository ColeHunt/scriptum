public class TeamNumberCheck {
    public static void main(String[] args) {
        int actual = Main.teamNumber();
        if (actual != 4143) {
            System.out.println("teamNumber() returned " + actual + ", expected 4143.");
            System.exit(1);
        }
        System.out.println("teamNumber looks good.");
    }
}
