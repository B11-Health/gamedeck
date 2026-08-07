package io.gamedeck.mobile;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.graphics.Color;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.hardware.input.InputManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.view.InputDevice;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public class ControllerActivity extends Activity implements
    InputManager.InputDeviceListener,
    SensorEventListener {

    private static final String PREFS = "gamedeck_mobile";
    private static final String URL_KEY = "deck_url";
    private static final String ORIENTATION_KEY = "orientation";
    private static final String MOTION_KEY = "motion_enabled";
    private static final String BRIDGE_NAME = "GameDeckNative";
    private static final String LOCAL_HOST = "appassets.local";
    private static final String LOCAL_APP_URL = "http://" + LOCAL_HOST + "/controller/index.html";
    private static final float AXIS_PRESS = 0.55f;
    private static final float AXIS_RELEASE = 0.35f;
    private static final float AXIS_DEADZONE = 0.08f;

    private final boolean[] inputStates = new boolean[16];
    private final float[] axisStates = new float[4];
    private WebView webView;
    private InputManager inputManager;
    private SensorManager sensorManager;
    private Sensor rotationSensor;
    private Sensor gyroscopeSensor;
    private Vibrator vibrator;
    private BluetoothGamepadManager bluetoothGamepad;
    private boolean motionEnabled;
    private long lastMotionDispatch;
    private float motionRoll;
    private float motionPitch;
    private float motionYaw;
    private float gyroX;
    private float gyroY;
    private float gyroZ;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.rgb(9, 11, 16));
        getWindow().setNavigationBarColor(Color.rgb(9, 11, 16));
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        inputManager = (InputManager) getSystemService(Context.INPUT_SERVICE);
        sensorManager = (SensorManager) getSystemService(Context.SENSOR_SERVICE);
        rotationSensor = sensorManager == null ? null : sensorManager.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR);
        gyroscopeSensor = sensorManager == null ? null : sensorManager.getDefaultSensor(Sensor.TYPE_GYROSCOPE);
        vibrator = resolveVibrator();
        motionEnabled = getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean(MOTION_KEY, false);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            bluetoothGamepad = new BluetoothGamepadManager(this, new BluetoothGamepadManager.Listener() {
                @Override
                public void onBluetoothStateChanged(String snapshot) {
                    notifyBluetoothState(snapshot);
                }

                @Override
                public void onBluetoothRumble(int low, int high, int durationMs) {
                    int strength = Math.max(low, high);
                    performHapticPulse(strength, durationMs);
                    notifyBluetoothRumble(low, high, durationMs);
                }
            });
        }

        buildWebView();
        applySavedOrientation();
        enterImmersiveMode();

        String incoming = incomingDeckUrl(getIntent());
        if (!incoming.isEmpty()) saveDeckUrl(incoming);
        webView.loadUrl(LOCAL_APP_URL);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String incoming = incomingDeckUrl(intent);
        if (!incoming.isEmpty()) {
            saveDeckUrl(incoming);
            notifyDeckUrl(incoming);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (inputManager != null) inputManager.registerInputDeviceListener(this, null);
        if (motionEnabled) registerMotionSensors();
        enterImmersiveMode();
        notifyControllerState();
        notifyOrientation();
        notifyBluetoothState(bluetoothStatus());
    }

    @Override
    protected void onPause() {
        if (inputManager != null) inputManager.unregisterInputDeviceListener(this);
        unregisterMotionSensors();
        releaseAllInputs();
        super.onPause();
    }

    private Vibrator resolveVibrator() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            VibratorManager manager = (VibratorManager) getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
            return manager == null ? null : manager.getDefaultVibrator();
        }
        return (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
    }

    private void buildWebView() {
        webView = new WebView(this);
        WebView.setWebContentsDebuggingEnabled(false);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setTextZoom(100);
        settings.setUserAgentString(settings.getUserAgentString() + " GameDeckController/1.2");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) settings.setSafeBrowsingEnabled(true);

        webView.setBackgroundColor(Color.BLACK);
        webView.setFocusable(true);
        webView.setFocusableInTouchMode(true);
        webView.setLongClickable(false);
        webView.setOnLongClickListener(view -> true);
        webView.setWebChromeClient(new WebChromeClient());
        webView.addJavascriptInterface(new NativeBridge(), BRIDGE_NAME);
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!LOCAL_HOST.equalsIgnoreCase(uri.getHost())) return null;
                return localAssetResponse(uri.getPath());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (LOCAL_HOST.equalsIgnoreCase(uri.getHost())) return false;
                String target = uri.toString();
                if (isAllowedDeckUrl(target)) {
                    saveDeckUrl(target);
                    notifyDeckUrl(target);
                    return true;
                }
                Toast.makeText(ControllerActivity.this, "GameDeck blocked a non-local page.", Toast.LENGTH_SHORT).show();
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                view.requestFocus();
                enterImmersiveMode();
                notifyControllerState();
                notifyOrientation();
                notifyMotionState();
                notifyBluetoothState(bluetoothStatus());
                notifyDeckUrl(savedDeckUrl());
            }
        });
        setContentView(webView);
    }

    private WebResourceResponse localAssetResponse(String path) {
        String requested = path == null || path.isEmpty() || "/".equals(path)
            ? "controller/index.html"
            : path.replaceFirst("^/", "");
        if (!requested.startsWith("controller/") || requested.contains("..")) {
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not found", null,
                new ByteArrayInputStream(new byte[0]));
        }
        try {
            InputStream stream = getAssets().open(requested);
            return new WebResourceResponse(mimeType(requested), "utf-8", stream);
        } catch (Exception ignored) {
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not found", null,
                new ByteArrayInputStream(new byte[0]));
        }
    }

    private String mimeType(String path) {
        String lower = path.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".html")) return "text/html";
        if (lower.endsWith(".css")) return "text/css";
        if (lower.endsWith(".js")) return "text/javascript";
        if (lower.endsWith(".json") || lower.endsWith(".webmanifest")) return "application/json";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        return "application/octet-stream";
    }

    private String incomingDeckUrl(Intent intent) {
        if (intent == null || intent.getData() == null) return "";
        Uri data = intent.getData();
        if ("gamedeck".equalsIgnoreCase(data.getScheme())) {
            String value = data.getQueryParameter("url");
            return value != null && isAllowedDeckUrl(value) ? value : "";
        }
        String direct = data.toString();
        return isAllowedDeckUrl(direct) ? direct : "";
    }

    private String savedDeckUrl() {
        return getSharedPreferences(PREFS, MODE_PRIVATE).getString(URL_KEY, "");
    }

    private boolean saveDeckUrl(String value) {
        String normalized = normalizeDeckUrl(value);
        if (normalized.isEmpty()) return false;
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(URL_KEY, normalized).apply();
        return true;
    }

    private String normalizeDeckUrl(String raw) {
        String value = raw == null ? "" : raw.trim();
        if (value.isEmpty()) return "";
        if (!value.startsWith("http://") && !value.startsWith("https://")) value = "http://" + value;
        if (!isAllowedDeckUrl(value)) return "";
        Uri uri = Uri.parse(value);
        StringBuilder base = new StringBuilder();
        base.append(uri.getScheme()).append("://").append(uri.getHost());
        if (uri.getPort() > 0) base.append(":").append(uri.getPort());
        return base.toString();
    }

    private boolean isAllowedDeckUrl(String value) {
        try {
            Uri uri = Uri.parse(value);
            String scheme = uri.getScheme();
            String host = uri.getHost();
            if (!("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) || host == null) return false;
            String normalized = host.toLowerCase(Locale.ROOT);
            if ("localhost".equals(normalized) || "127.0.0.1".equals(normalized)
                || "::1".equals(normalized) || normalized.endsWith(".local")) return true;
            if (normalized.startsWith("10.") || normalized.startsWith("192.168.")
                || normalized.startsWith("169.254.")) return true;
            if (normalized.startsWith("172.")) {
                String[] parts = normalized.split("\\.");
                if (parts.length == 4) {
                    int second = Integer.parseInt(parts[1]);
                    return second >= 16 && second <= 31;
                }
            }
            return false;
        } catch (Exception ignored) {
            return false;
        }
    }

    private void enterImmersiveMode() {
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        );
    }

    private boolean isController(InputDevice device) {
        if (device == null || device.isVirtual()) return false;
        int sources = device.getSources();
        return (sources & InputDevice.SOURCE_GAMEPAD) == InputDevice.SOURCE_GAMEPAD
            || (sources & InputDevice.SOURCE_JOYSTICK) == InputDevice.SOURCE_JOYSTICK;
    }

    private List<InputDevice> connectedControllers() {
        List<InputDevice> result = new ArrayList<>();
        for (int id : InputDevice.getDeviceIds()) {
            InputDevice device = InputDevice.getDevice(id);
            if (isController(device)) result.add(device);
        }
        return result;
    }

    private String controllerSnapshot() {
        try {
            List<InputDevice> devices = connectedControllers();
            JSONObject result = new JSONObject();
            result.put("connected", !devices.isEmpty());
            result.put("count", devices.size());
            JSONArray names = new JSONArray();
            for (InputDevice device : devices) names.put(device.getName());
            result.put("names", names);
            return result.toString();
        } catch (Exception ignored) {
            return "{\"connected\":false,\"count\":0,\"names\":[]}";
        }
    }

    private void evaluate(String script) {
        if (webView == null) return;
        webView.post(() -> webView.evaluateJavascript(script, null));
    }

    private void notifyControllerState() {
        String snapshot = JSONObject.quote(controllerSnapshot());
        evaluate("window.GameDeckAndroid&&window.GameDeckAndroid.onControllerState(" + snapshot + ");");
    }

    private void notifyDeckUrl(String url) {
        String quoted = JSONObject.quote(url == null ? "" : url);
        evaluate("window.GameDeckAndroid&&window.GameDeckAndroid.onDeckUrl(" + quoted + ");");
    }

    private void notifyBluetoothState(String snapshot) {
        String quoted = JSONObject.quote(snapshot == null ? "{}" : snapshot);
        evaluate("window.GameDeckAndroid&&window.GameDeckAndroid.onBluetoothState(" + quoted + ");");
    }

    private void notifyBluetoothRumble(int low, int high, int durationMs) {
        evaluate("window.GameDeckAndroid&&window.GameDeckAndroid.onBluetoothRumble({low:"
            + low + ",high:" + high + ",duration:" + durationMs + "});");
    }

    private void sendInput(int id, boolean pressed) {
        if (id < 0 || id >= inputStates.length || inputStates[id] == pressed) return;
        inputStates[id] = pressed;
        if (bluetoothGamepad != null) bluetoothGamepad.setButton(id, pressed);
        int state = pressed ? 1 : 0;
        evaluate("window.GameDeckAndroid&&window.GameDeckAndroid.onNativeInput({id:" + id
            + ",state:" + state + ",source:'android'});");
        if (pressed) performHaptic("tick");
    }

    private void sendAxis(int axis, float rawValue) {
        if (axis < 0 || axis >= axisStates.length) return;
        float value = centered(rawValue);
        if (Math.abs(value - axisStates[axis]) < 0.015f) return;
        axisStates[axis] = value;
        if (bluetoothGamepad != null) {
            bluetoothGamepad.setAxes(axisStates[0], axisStates[1], axisStates[2], axisStates[3]);
        }
        evaluate("window.GameDeckAndroid&&window.GameDeckAndroid.onNativeAxis({axis:" + axis
            + ",value:" + value + ",source:'android'});");
    }

    private float centered(float value) {
        if (!Float.isFinite(value) || Math.abs(value) < AXIS_DEADZONE) return 0f;
        float magnitude = (Math.abs(value) - AXIS_DEADZONE) / (1f - AXIS_DEADZONE);
        return Math.copySign(Math.min(1f, magnitude), value);
    }

    private void releaseAllInputs() {
        for (int id = 0; id < inputStates.length; id++) {
            if (inputStates[id]) sendInput(id, false);
        }
        for (int axis = 0; axis < axisStates.length; axis++) sendAxis(axis, 0f);
        if (bluetoothGamepad != null) bluetoothGamepad.releaseAll();
    }

    private int retroPadIdForKey(int keyCode) {
        switch (keyCode) {
            case KeyEvent.KEYCODE_BUTTON_A: return 0;
            case KeyEvent.KEYCODE_BUTTON_B: return 8;
            case KeyEvent.KEYCODE_BUTTON_X: return 1;
            case KeyEvent.KEYCODE_BUTTON_Y: return 9;
            case KeyEvent.KEYCODE_BUTTON_L1: return 10;
            case KeyEvent.KEYCODE_BUTTON_R1: return 11;
            case KeyEvent.KEYCODE_BUTTON_L2: return 12;
            case KeyEvent.KEYCODE_BUTTON_R2: return 13;
            case KeyEvent.KEYCODE_BUTTON_SELECT: return 2;
            case KeyEvent.KEYCODE_BUTTON_START: return 3;
            case KeyEvent.KEYCODE_BUTTON_THUMBL: return 14;
            case KeyEvent.KEYCODE_BUTTON_THUMBR: return 15;
            case KeyEvent.KEYCODE_DPAD_UP: return 4;
            case KeyEvent.KEYCODE_DPAD_DOWN: return 5;
            case KeyEvent.KEYCODE_DPAD_LEFT: return 6;
            case KeyEvent.KEYCODE_DPAD_RIGHT: return 7;
            default: return -1;
        }
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        int id = retroPadIdForKey(event.getKeyCode());
        if (id >= 0 && isController(event.getDevice())) {
            if (event.getRepeatCount() == 0) sendInput(id, event.getAction() == KeyEvent.ACTION_DOWN);
            return true;
        }
        return super.dispatchKeyEvent(event);
    }

    private boolean axisPressed(float value, boolean current, boolean positive) {
        float signed = positive ? value : -value;
        return current ? signed > AXIS_RELEASE : signed > AXIS_PRESS;
    }

    private float axis(MotionEvent event, int preferred, int fallback) {
        float value = event.getAxisValue(preferred);
        return Math.abs(value) > 0.001f ? value : event.getAxisValue(fallback);
    }

    @Override
    public boolean dispatchGenericMotionEvent(MotionEvent event) {
        if ((event.getSource() & InputDevice.SOURCE_JOYSTICK) == InputDevice.SOURCE_JOYSTICK
            && event.getAction() == MotionEvent.ACTION_MOVE) {
            float hatX = event.getAxisValue(MotionEvent.AXIS_HAT_X);
            float hatY = event.getAxisValue(MotionEvent.AXIS_HAT_Y);
            sendInput(6, axisPressed(hatX, inputStates[6], false));
            sendInput(7, axisPressed(hatX, inputStates[7], true));
            sendInput(4, axisPressed(hatY, inputStates[4], false));
            sendInput(5, axisPressed(hatY, inputStates[5], true));
            sendInput(12, event.getAxisValue(MotionEvent.AXIS_LTRIGGER) > 0.45f
                || event.getAxisValue(MotionEvent.AXIS_BRAKE) > 0.45f);
            sendInput(13, event.getAxisValue(MotionEvent.AXIS_RTRIGGER) > 0.45f
                || event.getAxisValue(MotionEvent.AXIS_GAS) > 0.45f);
            sendAxis(0, event.getAxisValue(MotionEvent.AXIS_X));
            sendAxis(1, event.getAxisValue(MotionEvent.AXIS_Y));
            sendAxis(2, axis(event, MotionEvent.AXIS_Z, MotionEvent.AXIS_RX));
            sendAxis(3, axis(event, MotionEvent.AXIS_RZ, MotionEvent.AXIS_RY));
            return true;
        }
        return super.dispatchGenericMotionEvent(event);
    }

    private void vibrateTarget(Vibrator target, int effect, long duration, int amplitude) {
        if (target == null || !target.hasVibrator()) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            target.vibrate(VibrationEffect.createPredefined(effect));
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            target.vibrate(VibrationEffect.createOneShot(duration, amplitude));
        } else {
            target.vibrate(duration);
        }
    }

    private void performHaptic(String style) {
        int effect = VibrationEffect.EFFECT_TICK;
        long duration = 12;
        int amplitude = 72;
        if ("success".equals(style)) {
            effect = VibrationEffect.EFFECT_CLICK;
            duration = 28;
            amplitude = 120;
        } else if ("warning".equals(style)) {
            effect = VibrationEffect.EFFECT_DOUBLE_CLICK;
            duration = 46;
            amplitude = 160;
        } else if ("heavy".equals(style)) {
            effect = VibrationEffect.EFFECT_HEAVY_CLICK;
            duration = 36;
            amplitude = 180;
        }
        vibrateTarget(vibrator, effect, duration, amplitude);
        for (InputDevice device : connectedControllers()) {
            vibrateTarget(device.getVibrator(), effect, duration, amplitude);
        }
    }

    private void performHapticPulse(int strength, int durationMs) {
        int amplitude = Math.max(1, Math.min(255, strength));
        long duration = Math.max(8, Math.min(600, durationMs));
        if (vibrator != null && vibrator.hasVibrator()) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator.vibrate(VibrationEffect.createOneShot(duration, amplitude));
            } else {
                vibrator.vibrate(duration);
            }
        }
        for (InputDevice device : connectedControllers()) {
            Vibrator target = device.getVibrator();
            if (target == null || !target.hasVibrator()) continue;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                target.vibrate(VibrationEffect.createOneShot(duration, amplitude));
            } else {
                target.vibrate(duration);
            }
        }
    }

    private void applySavedOrientation() {
        String mode = getSharedPreferences(PREFS, MODE_PRIVATE).getString(ORIENTATION_KEY, "auto");
        setOrientationMode(mode);
    }

    private boolean setOrientationMode(String rawMode) {
        String mode = rawMode == null ? "auto" : rawMode.toLowerCase(Locale.ROOT);
        int requested;
        if ("landscape".equals(mode)) {
            requested = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE;
        } else if ("portrait".equals(mode)) {
            requested = ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT;
        } else {
            mode = "auto";
            requested = ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR;
        }
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(ORIENTATION_KEY, mode).apply();
        setRequestedOrientation(requested);
        notifyOrientation();
        return true;
    }

    private String orientationSnapshot() {
        boolean landscape = getResources().getConfiguration().orientation == Configuration.ORIENTATION_LANDSCAPE;
        String mode = getSharedPreferences(PREFS, MODE_PRIVATE).getString(ORIENTATION_KEY, "auto");
        try {
            JSONObject result = new JSONObject();
            result.put("mode", mode);
            result.put("current", landscape ? "landscape" : "portrait");
            return result.toString();
        } catch (Exception ignored) {
            return "{\"mode\":\"auto\",\"current\":\"portrait\"}";
        }
    }

    private void notifyOrientation() {
        String quoted = JSONObject.quote(orientationSnapshot());
        evaluate("window.GameDeckAndroid&&window.GameDeckAndroid.onOrientation(" + quoted + ");");
    }

    private void registerMotionSensors() {
        if (sensorManager == null) return;
        if (rotationSensor != null) sensorManager.registerListener(this, rotationSensor, SensorManager.SENSOR_DELAY_GAME);
        if (gyroscopeSensor != null) sensorManager.registerListener(this, gyroscopeSensor, SensorManager.SENSOR_DELAY_GAME);
    }

    private void unregisterMotionSensors() {
        if (sensorManager != null) sensorManager.unregisterListener(this);
    }

    private boolean setMotionEnabled(boolean enabled) {
        motionEnabled = enabled && (rotationSensor != null || gyroscopeSensor != null);
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean(MOTION_KEY, motionEnabled).apply();
        unregisterMotionSensors();
        if (motionEnabled) registerMotionSensors();
        if (!motionEnabled) {
            motionRoll = motionPitch = motionYaw = gyroX = gyroY = gyroZ = 0f;
            notifyMotionState();
        }
        return motionEnabled;
    }

    private String motionSnapshot() {
        try {
            JSONObject result = new JSONObject();
            result.put("supported", rotationSensor != null || gyroscopeSensor != null);
            result.put("enabled", motionEnabled);
            result.put("roll", motionRoll);
            result.put("pitch", motionPitch);
            result.put("yaw", motionYaw);
            result.put("gyroX", gyroX);
            result.put("gyroY", gyroY);
            result.put("gyroZ", gyroZ);
            return result.toString();
        } catch (Exception ignored) {
            return "{\"supported\":false,\"enabled\":false}";
        }
    }

    private void notifyMotionState() {
        String quoted = JSONObject.quote(motionSnapshot());
        evaluate("window.GameDeckAndroid&&window.GameDeckAndroid.onMotion(" + quoted + ");");
    }

    @Override
    public void onSensorChanged(SensorEvent event) {
        if (!motionEnabled || event == null) return;
        if (event.sensor.getType() == Sensor.TYPE_ROTATION_VECTOR) {
            float[] matrix = new float[9];
            float[] orientation = new float[3];
            SensorManager.getRotationMatrixFromVector(matrix, event.values);
            SensorManager.getOrientation(matrix, orientation);
            motionYaw = clampUnit(orientation[0] / (float) Math.PI);
            motionPitch = clampUnit(-orientation[1] / 0.65f);
            motionRoll = clampUnit(orientation[2] / 0.65f);
        } else if (event.sensor.getType() == Sensor.TYPE_GYROSCOPE) {
            gyroX = clampUnit(event.values[0] / 4f);
            gyroY = clampUnit(event.values[1] / 4f);
            gyroZ = clampUnit(event.values[2] / 4f);
        }
        if (bluetoothGamepad != null) bluetoothGamepad.setAxes(motionRoll, motionPitch, gyroX, gyroY);
        long now = System.nanoTime();
        if (now - lastMotionDispatch >= 33_000_000L) {
            lastMotionDispatch = now;
            notifyMotionState();
        }
    }

    private float clampUnit(float value) {
        if (!Float.isFinite(value)) return 0f;
        return Math.max(-1f, Math.min(1f, value));
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) {}

    private String bluetoothStatus() {
        return bluetoothGamepad == null
            ? "{\"supported\":false,\"enabled\":false,\"permission\":false,\"registered\":false,\"connected\":false}"
            : bluetoothGamepad.statusSnapshot();
    }

    private final class NativeBridge {
        @JavascriptInterface
        public String controllerState() {
            return controllerSnapshot();
        }

        @JavascriptInterface
        public boolean haptic(String style) {
            runOnUiThread(() -> performHaptic(style == null ? "tick" : style));
            return vibrator != null && vibrator.hasVibrator();
        }

        @JavascriptInterface
        public boolean hapticPulse(int strength, int durationMs) {
            runOnUiThread(() -> performHapticPulse(strength, durationMs));
            return vibrator != null && vibrator.hasVibrator();
        }

        @JavascriptInterface
        public String platform() {
            return "android";
        }

        @JavascriptInterface
        public String savedDeckUrl() {
            return ControllerActivity.this.savedDeckUrl();
        }

        @JavascriptInterface
        public boolean saveDeckUrl(String value) {
            return ControllerActivity.this.saveDeckUrl(value);
        }

        @JavascriptInterface
        public boolean setOrientation(String mode) {
            runOnUiThread(() -> setOrientationMode(mode));
            return true;
        }

        @JavascriptInterface
        public String orientation() {
            return orientationSnapshot();
        }

        @JavascriptInterface
        public boolean setMotionEnabled(boolean enabled) {
            runOnUiThread(() -> ControllerActivity.this.setMotionEnabled(enabled));
            return rotationSensor != null || gyroscopeSensor != null;
        }

        @JavascriptInterface
        public String motionState() {
            return motionSnapshot();
        }

        @JavascriptInterface
        public String bluetoothState() {
            return bluetoothStatus();
        }

        @JavascriptInterface
        public String bluetoothDevices() {
            return bluetoothGamepad == null ? "[]" : bluetoothGamepad.devicesSnapshot();
        }

        @JavascriptInterface
        public boolean bluetoothPrepare() {
            if (bluetoothGamepad == null) return false;
            runOnUiThread(() -> bluetoothGamepad.requestAccessAndDiscoverable());
            return true;
        }

        @JavascriptInterface
        public boolean bluetoothConnect(String address) {
            if (bluetoothGamepad == null) return false;
            return bluetoothGamepad.connect(address);
        }

        @JavascriptInterface
        public boolean bluetoothDisconnect() {
            return bluetoothGamepad != null && bluetoothGamepad.disconnect();
        }

        @JavascriptInterface
        public boolean bluetoothButton(int id, boolean pressed) {
            if (bluetoothGamepad == null) return false;
            bluetoothGamepad.setButton(id, pressed);
            return true;
        }

        @JavascriptInterface
        public boolean bluetoothAxis(int axis, float value) {
            if (bluetoothGamepad == null || axis < 0 || axis >= axisStates.length) return false;
            axisStates[axis] = clampUnit(value);
            bluetoothGamepad.setAxes(axisStates[0], axisStates[1], axisStates[2], axisStates[3]);
            return true;
        }

        @JavascriptInterface
        public void showConnection() {
            notifyDeckUrl(savedDeckUrl());
        }
    }

    @Override
    public void onInputDeviceAdded(int deviceId) {
        notifyControllerState();
    }

    @Override
    public void onInputDeviceRemoved(int deviceId) {
        releaseAllInputs();
        notifyControllerState();
    }

    @Override
    public void onInputDeviceChanged(int deviceId) {
        notifyControllerState();
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        enterImmersiveMode();
        notifyOrientation();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == BluetoothGamepadManager.PERMISSION_REQUEST_CODE && bluetoothGamepad != null) {
            bluetoothGamepad.requestAccessAndDiscoverable();
            notifyBluetoothState(bluetoothStatus());
        }
    }

    @Override
    protected void onDestroy() {
        releaseAllInputs();
        unregisterMotionSensors();
        if (bluetoothGamepad != null) bluetoothGamepad.close();
        if (webView != null) {
            webView.removeJavascriptInterface(BRIDGE_NAME);
            webView.loadUrl("about:blank");
            webView.destroy();
        }
        super.onDestroy();
    }
}
