package io.gamedeck.mobile;

import android.view.InputDevice;
import android.view.KeyEvent;
import android.view.MotionEvent;

/** Standard Android/Xbox/PlayStation controller mapping shared by emulator frontends. */
final class GameDeckHardwareInput {
    private GameDeckHardwareInput() {}

    static boolean isGamepadSource(int source) {
        return (source & InputDevice.SOURCE_GAMEPAD) == InputDevice.SOURCE_GAMEPAD
            || (source & InputDevice.SOURCE_JOYSTICK) == InputDevice.SOURCE_JOYSTICK;
    }

    static int ps2ButtonForKey(int keyCode) {
        switch (keyCode) {
            case KeyEvent.KEYCODE_DPAD_UP: return 19;
            case KeyEvent.KEYCODE_DPAD_DOWN: return 20;
            case KeyEvent.KEYCODE_DPAD_LEFT: return 21;
            case KeyEvent.KEYCODE_DPAD_RIGHT: return 22;
            case KeyEvent.KEYCODE_BUTTON_A:
            case KeyEvent.KEYCODE_DPAD_CENTER: return 96;  // Cross
            case KeyEvent.KEYCODE_BUTTON_B: return 97;    // Circle
            case KeyEvent.KEYCODE_BUTTON_X: return 99;    // Square
            case KeyEvent.KEYCODE_BUTTON_Y: return 100;   // Triangle
            case KeyEvent.KEYCODE_BUTTON_L1: return 102;
            case KeyEvent.KEYCODE_BUTTON_R1: return 103;
            case KeyEvent.KEYCODE_BUTTON_L2: return 104;
            case KeyEvent.KEYCODE_BUTTON_R2: return 105;
            case KeyEvent.KEYCODE_BUTTON_THUMBL: return 106;
            case KeyEvent.KEYCODE_BUTTON_THUMBR: return 107;
            case KeyEvent.KEYCODE_BUTTON_START: return 108;
            case KeyEvent.KEYCODE_BUTTON_SELECT:
            case KeyEvent.KEYCODE_BACK: return 109;
            default: return -1;
        }
    }

    static float leftX(MotionEvent event) { return shapedAxis(event, MotionEvent.AXIS_X); }
    static float leftY(MotionEvent event) { return shapedAxis(event, MotionEvent.AXIS_Y); }

    static float rightX(MotionEvent event) {
        if (hasAxis(event, MotionEvent.AXIS_RX)) return shapedAxis(event, MotionEvent.AXIS_RX);
        return shapedAxis(event, MotionEvent.AXIS_Z);
    }

    static float rightY(MotionEvent event) {
        if (hasAxis(event, MotionEvent.AXIS_RY)) return shapedAxis(event, MotionEvent.AXIS_RY);
        return shapedAxis(event, MotionEvent.AXIS_RZ);
    }

    static float leftTrigger(MotionEvent event) {
        return clamp01(Math.max(rawAxis(event, MotionEvent.AXIS_LTRIGGER), rawAxis(event, MotionEvent.AXIS_BRAKE)));
    }

    static float rightTrigger(MotionEvent event) {
        return clamp01(Math.max(rawAxis(event, MotionEvent.AXIS_RTRIGGER), rawAxis(event, MotionEvent.AXIS_GAS)));
    }

    static boolean hasLeftTriggerAxis(MotionEvent event) {
        return hasAxis(event, MotionEvent.AXIS_LTRIGGER) || hasAxis(event, MotionEvent.AXIS_BRAKE);
    }

    static boolean hasRightTriggerAxis(MotionEvent event) {
        return hasAxis(event, MotionEvent.AXIS_RTRIGGER) || hasAxis(event, MotionEvent.AXIS_GAS);
    }

    static int hatX(MotionEvent event) { return Math.round(rawAxis(event, MotionEvent.AXIS_HAT_X)); }
    static int hatY(MotionEvent event) { return Math.round(rawAxis(event, MotionEvent.AXIS_HAT_Y)); }

    private static float shapedAxis(MotionEvent event, int axis) {
        float value = rawAxis(event, axis);
        float magnitude = Math.abs(value);
        if (magnitude <= 0.12f) return 0f;
        float shaped = (magnitude - 0.12f) / 0.88f;
        return Math.copySign(Math.min(1f, shaped), value);
    }

    private static float rawAxis(MotionEvent event, int axis) {
        try { return event.getAxisValue(axis); }
        catch (Throwable ignored) { return 0f; }
    }

    private static boolean hasAxis(MotionEvent event, int axis) {
        InputDevice device = event.getDevice();
        if (device == null) return false;
        for (InputDevice.MotionRange range : device.getMotionRanges()) {
            if (range.getAxis() == axis && (range.getSource() & InputDevice.SOURCE_CLASS_JOYSTICK) != 0) return true;
        }
        return false;
    }

    private static float clamp01(float value) { return Math.max(0f, Math.min(1f, value)); }
}
