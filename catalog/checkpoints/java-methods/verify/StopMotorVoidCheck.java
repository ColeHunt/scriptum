import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;

public class StopMotorVoidCheck {
    public static void main(String[] args) throws Exception {
        Method method;
        try {
            method = Main.class.getMethod("stopMotor");
        } catch (NoSuchMethodException e) {
            System.out.println("No stopMotor() method found on Main.");
            System.exit(1);
            return;
        }
        if (method.getReturnType() != void.class) {
            System.out.println("stopMotor() should be void - it shouldn't return a value.");
            System.exit(1);
            return;
        }
        if (!Modifier.isStatic(method.getModifiers())) {
            System.out.println("stopMotor() should be static, like the rest of Main's methods.");
            System.exit(1);
            return;
        }

        PrintStream originalOut = System.out;
        ByteArrayOutputStream captured = new ByteArrayOutputStream();
        System.setOut(new PrintStream(captured));
        try {
            method.invoke(null);
        } finally {
            System.setOut(originalOut);
        }
        String printed = captured.toString().trim();
        if (!printed.equals("MOTOR STOPPED")) {
            System.out.println("stopMotor() printed \"" + printed + "\", expected \"MOTOR STOPPED\".");
            System.exit(1);
        }
        System.out.println("stopMotor looks good.");
    }
}
