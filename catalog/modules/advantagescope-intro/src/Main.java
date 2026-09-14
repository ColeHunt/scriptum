import java.io.File;
import java.io.PrintWriter;

public class Main {
    // TODO: return a flywheel RPM that oscillates between 0 and 6000 as t
    // increases - a sine wave works well, e.g. 3000 + 3000 * Math.sin(t).
    public static double flywheelRpm(double t) {
        return 0.0;
    }

    // TODO: return whether a game piece is loaded at time t. It should
    // toggle back and forth as t increases, not stay fixed - e.g. based on
    // whether (int) t is even or odd.
    public static boolean gamePieceLoaded(double t) {
        return false;
    }

    // Provided: sweeps t from 0 to 10 seconds and writes a CSV log
    // AdvantageScope can open directly. Don't edit this - fill in the two
    // methods above instead.
    private static void writeLog() throws Exception {
        File dir = new File("logs");
        dir.mkdirs();
        try (PrintWriter out = new PrintWriter(new File(dir, "telemetry.csv"))) {
            out.println("Timestamp,FlywheelRPM,GamePieceLoaded");
            for (double t = 0.0; t <= 10.0; t += 0.1) {
                out.println(t + "," + flywheelRpm(t) + "," + gamePieceLoaded(t));
            }
        }
    }

    public static void main(String[] args) throws Exception {
        writeLog();
        System.out.println("Wrote logs/telemetry.csv");
        System.out.println("Click \"Open log in AdvantageScope\" in the Scope pane to view it.");
    }
}
