package io.gamedeck.mobile;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.hardware.input.InputManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.view.Gravity;
import android.view.InputDevice;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public class MainActivity extends Activity implements InputManager.InputDeviceListener {
    private static final String PREFS = "gamedeck_mobile";
    private static final String URL_KEY = "deck_url";
    private static final String BRIDGE_NAME = "GameDeckNative";
    private static final float AXIS_PRESS = 0.55f;
    private static final float AXIS_RELEASE = 0.35f;

    private final boolean[] inputStates = new boolean[16];
    private WebView webView;
    private EditText address;
    private LinearLayout connectBar;
    private InputManager inputManager;
    private Vibrator vibrator;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.rgb(9, 11, 16));
        getWindow().setNavigationBarColor(Color.rgb(9, 11, 16));
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        inputManager = (InputManager) getSystemService(Context.INPUT_SERVICE);
        vibrator = resolveVibrator();
        buildInterface();
        enterImmersiveMode();

        String incoming = incomingDeckUrl(getIntent());
        String saved = getSharedPreferences(PREFS, MODE_PRIVATE).getString(URL_KEY, "");
        String initial = incoming.isEmpty() ? saved : incoming;
        address.setText(initial);
        if (!initial.isEmpty()) connect(initial);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String incoming = incomingDeckUrl(intent);
        if (!incoming.isEmpty()) connect(incoming);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (inputManager != null) inputManager.registerInputDeviceListener(this, null);
        enterImmersiveMode();
        notifyControllerState();
    }

    @Override
    protected void onPause() {
        if (inputManager != null) inputManager.unregisterInputDeviceListener(this);
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

    private TextView label(String text) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextColor(Color.rgb(200, 255, 82));
        view.setTextSize(12);
        view.setGravity(Gravity.CENTER_VERTICAL);
        view.setPadding(18, 0, 12, 0);
        return view;
    }

    private void buildInterface() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(9, 11, 16));

        connectBar = new LinearLayout(this);
        connectBar.setOrientation(LinearLayout.HORIZONTAL);
        connectBar.setGravity(Gravity.CENTER_VERTICAL);
        connectBar.setPadding(8, 8, 8, 8);
        connectBar.setBackgroundColor(Color.rgb(14, 18, 25));
        connectBar.addView(label("GAMEDECK"), new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, 52));

        address = new EditText(this);
        address.setSingleLine(true);
        address.setHint("192.168.1.20:41783/?code=123456");
        address.setTextColor(Color.WHITE);
        address.setHintTextColor(Color.rgb(103, 115, 133));
        address.setBackgroundColor(Color.rgb(20, 27, 38));
        address.setPadding(14, 0, 14, 0);
        address.setOnEditorActionListener((view, actionId, event) -> {
            connect(address.getText().toString());
            return true;
        });
        LinearLayout.LayoutParams inputParams = new LinearLayout.LayoutParams(0, 48, 1f);
        connectBar.addView(address, inputParams);

        Button connect = new Button(this);
        connect.setText("CONNECT");
        connect.setTextColor(Color.rgb(9, 11, 16));
        connect.setBackgroundColor(Color.rgb(200, 255, 82));
        connect.setOnClickListener(view -> connect(address.getText().toString()));
        LinearLayout.LayoutParams buttonParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, 48);
        buttonParams.setMargins(8, 0, 0, 0);
        connectBar.addView(connect, buttonParams);
        root.addView(connectBar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 68));

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
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setTextZoom(100);
        settings.setUserAgentString(settings.getUserAgentString() + " GameDeckAndroid/1.1");
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
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String target = request.getUrl().toString();
                if (isAllowedDeckUrl(target)) return false;
                Toast.makeText(MainActivity.this, "GameDeck blocked a non-local page.", Toast.LENGTH_SHORT).show();
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (!isAllowedDeckUrl(url)) return;
                connectBar.setVisibility(View.GONE);
                view.requestFocus();
                enterImmersiveMode();
                notifyControllerState();
            }
        });
        root.addView(webView, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        setContentView(root);
    }

    private String incomingDeckUrl(Intent intent) {
        if (intent == null || intent.getData() == null) return "";
        Uri data = intent.getData();
        if ("gamedeck".equalsIgnoreCase(data.getScheme())) {
            String value = data.getQueryParameter("url");
            return value == null ? "" : value;
        }
        String direct = data.toString();
        return isAllowedDeckUrl(direct) ? direct : "";
    }

    private void connect(String raw) {
        String value = raw == null ? "" : raw.trim();
        if (value.isEmpty()) return;
        if (!value.startsWith("http://") && !value.startsWith("https://")) value = "http://" + value;
        if (!isAllowedDeckUrl(value)) {
            Toast.makeText(this, "Enter the local GameDeck address shown on your computer.", Toast.LENGTH_LONG).show();
            return;
        }
        address.setText(value);
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(URL_KEY, value).apply();
        webView.loadUrl(value);
    }

    private boolean isAllowedDeckUrl(String value) {
        try {
            Uri uri = Uri.parse(value);
            String scheme = uri.getScheme();
            String host = uri.getHost();
            if (!("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) || host == null) return false;
            String normalized = host.toLowerCase(Locale.ROOT);
            if ("localhost".equals(normalized) || "127.0.0.1".equals(normalized) || "::1".equals(normalized) || normalized.endsWith(".local")) return true;
            if (normalized.startsWith("10.") || normalized.startsWith("192.168.") || normalized.startsWith("169.254.")) return true;
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

    private void notifyControllerState() {
        if (webView == null) return;
        String snapshot = JSONObject.quote(controllerSnapshot());
        webView.post(() -> webView.evaluateJavascript(
            "window.GameDeckAndroid&&window.GameDeckAndroid.onControllerState(" + snapshot + ");",
            null
        ));
    }

    private void sendInput(int id, boolean pressed) {
        if (id < 0 || id >= inputStates.length || inputStates[id] == pressed) return;
        inputStates[id] = pressed;
        if (webView == null) return;
        int state = pressed ? 1 : 0;
        webView.post(() -> webView.evaluateJavascript(
            "window.GameDeckAndroid&&window.GameDeckAndroid.onNativeInput({id:" + id + ",state:" + state + ",source:'android'});",
            null
        ));
        if (pressed) performHaptic("tick");
    }

    private void releaseAllInputs() {
        for (int id = 0; id < inputStates.length; id++) {
            if (inputStates[id]) sendInput(id, false);
        }
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

    @Override
    public boolean dispatchGenericMotionEvent(MotionEvent event) {
        if ((event.getSource() & InputDevice.SOURCE_JOYSTICK) == InputDevice.SOURCE_JOYSTICK
            && event.getAction() == MotionEvent.ACTION_MOVE) {
            float hatX = event.getAxisValue(MotionEvent.AXIS_HAT_X);
            float hatY = event.getAxisValue(MotionEvent.AXIS_HAT_Y);
            float x = Math.abs(hatX) > 0.1f ? hatX : event.getAxisValue(MotionEvent.AXIS_X);
            float y = Math.abs(hatY) > 0.1f ? hatY : event.getAxisValue(MotionEvent.AXIS_Y);
            sendInput(6, axisPressed(x, inputStates[6], false));
            sendInput(7, axisPressed(x, inputStates[7], true));
            sendInput(4, axisPressed(y, inputStates[4], false));
            sendInput(5, axisPressed(y, inputStates[5], true));
            sendInput(12, event.getAxisValue(MotionEvent.AXIS_LTRIGGER) > 0.45f || event.getAxisValue(MotionEvent.AXIS_BRAKE) > 0.45f);
            sendInput(13, event.getAxisValue(MotionEvent.AXIS_RTRIGGER) > 0.45f || event.getAxisValue(MotionEvent.AXIS_GAS) > 0.45f);
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
        public String platform() {
            return "android";
        }

        @JavascriptInterface
        public void showConnection() {
            runOnUiThread(() -> connectBar.setVisibility(View.VISIBLE));
        }
    }

    @Override public void onInputDeviceAdded(int deviceId) { notifyControllerState(); }
    @Override public void onInputDeviceRemoved(int deviceId) { releaseAllInputs(); notifyControllerState(); }
    @Override public void onInputDeviceChanged(int deviceId) { notifyControllerState(); }

    @Override
    protected void onDestroy() {
        releaseAllInputs();
        if (webView != null) {
            webView.removeJavascriptInterface(BRIDGE_NAME);
            webView.loadUrl("about:blank");
            webView.destroy();
        }
        super.onDestroy();
    }
}
