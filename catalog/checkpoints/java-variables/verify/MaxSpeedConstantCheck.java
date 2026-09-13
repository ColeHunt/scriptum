import java.lang.reflect.Field;
import java.lang.reflect.Modifier;

public class MaxSpeedConstantCheck {
    public static void main(String[] args) {
        Field field;
        try {
            field = Main.class.getField("MAX_SPEED");
        } catch (NoSuchFieldException e) {
            System.out.println("No MAX_SPEED field found on Main.");
            System.exit(1);
            return;
        }
        if (!Modifier.isFinal(field.getModifiers())) {
            System.out.println("MAX_SPEED needs the `final` keyword - team standard for constants.");
            System.exit(1);
        }
        double value;
        try {
            value = field.getDouble(null);
        } catch (IllegalAccessException e) {
            System.out.println("Couldn't read MAX_SPEED - make sure it's public.");
            System.exit(1);
            return;
        }
        if (Math.abs(value - 5.0) > 0.0001) {
            System.out.println("MAX_SPEED is " + value + ", expected 5.0.");
            System.exit(1);
        }
        System.out.println("MAX_SPEED constant looks good.");
    }
}
