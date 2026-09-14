public class GamePieceLoadedCheck {
    public static void main(String[] args) {
        boolean sawTrue = false;
        boolean sawFalse = false;
        for (double t = 0; t <= 10; t += 0.5) {
            if (Main.gamePieceLoaded(t)) {
                sawTrue = true;
            } else {
                sawFalse = true;
            }
        }
        if (!sawTrue || !sawFalse) {
            System.out.println("gamePieceLoaded(t) never changes - it should toggle as t changes.");
            System.exit(1);
        }
        System.out.println("gamePieceLoaded looks good.");
    }
}
