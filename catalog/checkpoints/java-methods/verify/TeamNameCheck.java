public class TeamNameCheck {
    public static void main(String[] args) {
        String actual = Main.teamName();
        if (!"MARS/WARS".equals(actual)) {
            System.out.println("teamName() returned " + actual + ", expected MARS/WARS.");
            System.exit(1);
        }
        System.out.println("teamName looks good.");
    }
}
