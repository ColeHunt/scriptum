import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.lang.reflect.Method;

public class HelloWorldCheck {
    public static void main(String[] args) throws Exception {
        Method method;
        try {
            method = Main.class.getMethod("main", String[].class);
        } catch (NoSuchMethodException e) {
            System.out.println("No main(String[] args) method found on Main.");
            System.exit(1);
            return;
        }

        PrintStream originalOut = System.out;
        ByteArrayOutputStream captured = new ByteArrayOutputStream();
        System.setOut(new PrintStream(captured));
        try {
            method.invoke(null, (Object) new String[0]);
        } finally {
            System.setOut(originalOut);
        }
        String printed = captured.toString();
        if (!printed.contains("Hello, World!")) {
            System.out.println(
                "Running Main didn't print \"Hello, World!\" - check your System.out.println call."
            );
            System.exit(1);
        }
        System.out.println("Hello, World looks good.");
    }
}
