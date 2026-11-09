package dev.pocketnexus.omarchy;

import android.view.InputDevice;
import android.view.KeyEvent;
import android.view.MotionEvent;

/**
 * The Odin controller as PocketJS buttons, by the buttons' labels as Android
 * reports them: A confirms (CIRCLE, the framework's focus press), B goes back
 * (CROSS), X is TRIANGLE and Y is SQUARE, as on the RG DS Plus. The D-pad
 * arrives as keys and as the hat; L2 and R2 as keys and as analog triggers.
 */
final class Gamepad {
    // pocket_spec::btn
    static final int SELECT = 0x0001;
    static final int START = 0x0008;
    static final int UP = 0x0010;
    static final int RIGHT = 0x0020;
    static final int DOWN = 0x0040;
    static final int LEFT = 0x0080;
    static final int LTRIGGER = 0x0100;
    static final int RTRIGGER = 0x0200;
    static final int ZL = 0x0400;
    static final int ZR = 0x0800;
    static final int TRIANGLE = 0x1000;
    static final int CIRCLE = 0x2000;
    static final int CROSS = 0x4000;
    static final int SQUARE = 0x8000;

    /** The analog triggers count as pressed past this. */
    private static final float TRIGGER = 0.5f;

    private int hat;
    private int triggers;

    static int bits(int keyCode) {
        switch (keyCode) {
            case KeyEvent.KEYCODE_BUTTON_A: return CIRCLE;
            case KeyEvent.KEYCODE_BUTTON_B: return CROSS;
            case KeyEvent.KEYCODE_BUTTON_X: return TRIANGLE;
            case KeyEvent.KEYCODE_BUTTON_Y: return SQUARE;
            case KeyEvent.KEYCODE_BUTTON_L1: return LTRIGGER;
            case KeyEvent.KEYCODE_BUTTON_R1: return RTRIGGER;
            case KeyEvent.KEYCODE_BUTTON_L2: return ZL;
            case KeyEvent.KEYCODE_BUTTON_R2: return ZR;
            case KeyEvent.KEYCODE_BUTTON_SELECT: return SELECT;
            case KeyEvent.KEYCODE_BUTTON_START: return START;
            case KeyEvent.KEYCODE_DPAD_UP: return UP;
            case KeyEvent.KEYCODE_DPAD_DOWN: return DOWN;
            case KeyEvent.KEYCODE_DPAD_LEFT: return LEFT;
            case KeyEvent.KEYCODE_DPAD_RIGHT: return RIGHT;
            default: return 0;
        }
    }

    /** Handles a key the shell takes; false for one Android keeps. */
    boolean key(KeyEvent event) {
        int bits = bits(event.getKeyCode());
        if (bits == 0) return false;
        if (event.getRepeatCount() == 0) {
            if (event.getAction() == KeyEvent.ACTION_DOWN) Native.button(bits, true);
            else if (event.getAction() == KeyEvent.ACTION_UP) Native.button(bits, false);
        }
        return true;
    }

    /** The sticks, the hat and the analog triggers. */
    boolean motion(MotionEvent event) {
        if ((event.getSource() & InputDevice.SOURCE_JOYSTICK) != InputDevice.SOURCE_JOYSTICK
                || event.getAction() != MotionEvent.ACTION_MOVE) {
            return false;
        }
        Native.sticks(
                flat(event, MotionEvent.AXIS_X), flat(event, MotionEvent.AXIS_Y),
                flat(event, MotionEvent.AXIS_Z), flat(event, MotionEvent.AXIS_RZ));
        float hx = event.getAxisValue(MotionEvent.AXIS_HAT_X);
        float hy = event.getAxisValue(MotionEvent.AXIS_HAT_Y);
        int nextHat = (hx < -0.5f ? LEFT : 0) | (hx > 0.5f ? RIGHT : 0) | (hy < -0.5f ? UP : 0) | (hy > 0.5f ? DOWN : 0);
        change(hat, nextHat);
        hat = nextHat;
        float lt = Math.max(event.getAxisValue(MotionEvent.AXIS_LTRIGGER), event.getAxisValue(MotionEvent.AXIS_BRAKE));
        float rt = Math.max(event.getAxisValue(MotionEvent.AXIS_RTRIGGER), event.getAxisValue(MotionEvent.AXIS_GAS));
        int nextTriggers = (lt > TRIGGER ? ZL : 0) | (rt > TRIGGER ? ZR : 0);
        change(triggers, nextTriggers);
        triggers = nextTriggers;
        return true;
    }

    private static void change(int before, int after) {
        int down = after & ~before;
        int up = before & ~after;
        if (down != 0) Native.button(down, true);
        if (up != 0) Native.button(up, false);
    }

    /** An axis with the device's dead zone taken out. */
    private static float flat(MotionEvent event, int axis) {
        InputDevice device = event.getDevice();
        float value = event.getAxisValue(axis);
        if (device == null) return value;
        InputDevice.MotionRange range = device.getMotionRange(axis, event.getSource());
        if (range == null) return 0;
        return Math.abs(value) > Math.max(range.getFlat(), 0.08f) ? value : 0;
    }
}
