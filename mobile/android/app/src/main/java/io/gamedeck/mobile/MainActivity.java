package io.gamedeck.mobile;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.BroadcastReceiver;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ActivityInfo;
import android.content.pm.ApplicationInfo;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.view.InputDevice;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.PixelCopy;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.provider.MediaStore;
import android.widget.FrameLayout;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    static final int REQUEST_LIBRARY = 4101;
    static final int REQUEST_RGSX = 4102;
    private static final String LOCAL_URL = "file:///android_asset/desktop/index.html";
    private static final String QA_ACTION = "io.gamedeck.mobile.QA";
    private static final String DEBUG_FIXTURE_FILE = "renderer-fixture.enabled";

    private FrameLayout rootView;
    private WebView webView;
    private DeckBridge bridge;
    private BroadcastReceiver qaReceiver;
    private boolean remoteMode = false;
    private boolean bridgeExposed = false;
    private Uri remoteOrigin;
    private int horizontalDirection = 0;
    private int verticalDirection = 0;
    private boolean leftTriggerPressed = false;
    private boolean rightTriggerPressed = false;
    private final ExecutorService qaIo = Executors.newSingleThreadExecutor();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.rgb(9, 11, 16));
        getWindow().setNavigationBarColor(Color.rgb(9, 11, 16));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().setDecorFitsSystemWindows(false);
        }
        buildWebView();
        registerQaReceiver();
        loadLocalShell();
    }

    private void buildWebView() {
        rootView = new FrameLayout(this);
        rootView.setBackgroundColor(Color.rgb(9, 11, 16));

        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(9, 11, 16));
        webView.setVisibility(View.VISIBLE);
        webView.setAlpha(1f);
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) settings.setOffscreenPreRaster(true);
        settings.setUserAgentString(settings.getUserAgentString() + " GameDeckAndroid/0.4.4-console");

        bridge = new DeckBridge(this);
        exposeBridge();
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme();
                if (remoteMode) {
                    if (isSameRemoteOrigin(uri)) return false;
                    openExternal(uri.toString());
                    return true;
                }
                if ("file".equalsIgnoreCase(scheme)) return false;
                openExternal(uri.toString());
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                view.setVisibility(View.VISIBLE);
                view.setAlpha(1f);
                view.invalidate();
                view.requestLayout();
                view.requestFocus(View.FOCUS_DOWN);
            }
        });

        rootView.addView(
            webView,
            new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        );
        setContentView(rootView);
        applySystemBarInsets(rootView);
    }

    private void applySystemBarInsets(View target) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            target.setOnApplyWindowInsetsListener((view, windowInsets) -> {
                Insets bars = windowInsets.getInsets(
                    WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout()
                );
                if (view.getPaddingLeft() != bars.left
                    || view.getPaddingTop() != bars.top
                    || view.getPaddingRight() != bars.right
                    || view.getPaddingBottom() != bars.bottom) {
                    view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                }
                return WindowInsets.CONSUMED;
            });
            target.requestApplyInsets();
        } else {
            target.setFitsSystemWindows(true);
        }
    }

    private void useLocalRendererLayer() {
        if (webView == null) return;
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        webView.setVisibility(View.VISIBLE);
        webView.setAlpha(1f);
        webView.invalidate();
    }

    private void useRemoteRendererLayer() {
        if (webView == null) return;
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        webView.setVisibility(View.VISIBLE);
        webView.setAlpha(1f);
        webView.invalidate();
    }

    private void loadLocalShell() {
        remoteMode = false;
        remoteOrigin = null;
        useLocalRendererLayer();
        exposeBridge();
        webView.loadUrl(LOCAL_URL);
    }

    private void exposeBridge() {
        if (bridgeExposed || webView == null || bridge == null) return;
        webView.addJavascriptInterface(bridge, "GameDeckAndroid");
        bridgeExposed = true;
    }

    private void hideBridge() {
        if (!bridgeExposed || webView == null) return;
        webView.removeJavascriptInterface("GameDeckAndroid");
        bridgeExposed = false;
    }

    private boolean isSameRemoteOrigin(Uri uri) {
        if (remoteOrigin == null || uri == null) return false;
        return safeEquals(remoteOrigin.getScheme(), uri.getScheme())
            && safeEquals(remoteOrigin.getHost(), uri.getHost())
            && effectivePort(remoteOrigin) == effectivePort(uri);
    }

    private int effectivePort(Uri uri) {
        if (uri.getPort() >= 0) return uri.getPort();
        return "https".equalsIgnoreCase(uri.getScheme()) ? 443 : 80;
    }

    private boolean safeEquals(String left, String right) {
        return left == null ? right == null : left.equalsIgnoreCase(right);
    }

    private boolean isDebugBuild() {
        return (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
    }

    private boolean isDebugFixtureEnabled() {
        return isDebugBuild() && new File(getFilesDir(), DEBUG_FIXTURE_FILE).isFile();
    }

    private void registerQaReceiver() {
        if (!isDebugBuild()) return;
        qaReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                runQaCommand(intent == null ? null : intent.getStringExtra("command"));
            }
        };
        IntentFilter filter = new IntentFilter(QA_ACTION);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(qaReceiver, filter, Context.RECEIVER_EXPORTED);
        } else {
            registerReceiver(qaReceiver, filter);
        }
    }

    private void runQaCommand(String rawCommand) {
        if (!isDebugBuild()) return;
        String command = rawCommand == null ? "" : rawCommand.trim();
        if ("fixture:on".equals(command)) {
            try (OutputStream ignored = new FileOutputStream(new File(getFilesDir(), DEBUG_FIXTURE_FILE), false)) {
                writeQaTextArtifact("fixture-status.json", "{\"enabled\":true}");
            } catch (Exception error) {
                writeQaTextArtifact("fixture-status.json", "{\"enabled\":false,\"error\":\"write-failed\"}");
            }
            return;
        }
        if ("fixture:off".equals(command)) {
            File marker = new File(getFilesDir(), DEBUG_FIXTURE_FILE);
            boolean removed = !marker.exists() || marker.delete();
            writeQaTextArtifact("fixture-status.json", "{\"enabled\":false,\"removed\":" + removed + "}");
            return;
        }
        if (command.startsWith("screenshot:")) {
            captureQaScreenshot(command.substring("screenshot:".length()));
            return;
        }
        if (command.startsWith("orientation:")) {
            String orientation = command.substring("orientation:".length());
            if ("portrait".equals(orientation)) {
                setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
            } else if ("landscape".equals(orientation)) {
                setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE);
            }
            return;
        }
        if ("app:restart".equals(command)) {
            recreate();
            return;
        }
        if ("rgsx:snapshot".equals(command)) {
            bridge.writeRgsxQaSnapshot();
            return;
        }
        if ("rgsx:reset-fixture".equals(command)) {
            bridge.resetRgsxQaFixture();
            return;
        }
        if ("input-devices".equals(command)) {
            writeInputDevicesArtifact();
            return;
        }
        if (command.startsWith("key:")) {
            try {
                int keyCode = Integer.parseInt(command.substring("key:".length()));
                long now = android.os.SystemClock.uptimeMillis();
                dispatchKeyEvent(new KeyEvent(now, now, KeyEvent.ACTION_DOWN, keyCode, 0));
                dispatchKeyEvent(new KeyEvent(now, now, KeyEvent.ACTION_UP, keyCode, 0));
            } catch (NumberFormatException ignored) {}
            return;
        }
        if (command.startsWith("view:")) {
            String view = command.substring(5);
            if (!("home".equals(view) || "discover".equals(view) || "favorites".equals(view)
                || "recent".equals(view) || "community".equals(view))) return;
            evaluate("(()=>{const n=document.querySelector('.nav[data-view=\"" + view + "\"]');if(n)n.click();const c=document.querySelector('.content');if(c)c.scrollTo(0,0);window.scrollTo(0,0);})()");
            return;
        }
        switch (command) {
            case "rgsx:get-ui":
                runRgsxUiQa();
                break;
            case "menu:open":
                evaluate("(()=>{const m=document.querySelector('#headerMenu');if(m&&m.classList.contains('hidden'))document.querySelector('#headerMenuToggle')?.click();})()");
                break;
            case "menu:close":
                evaluate("(()=>{const m=document.querySelector('#headerMenu');if(m&&!m.classList.contains('hidden'))document.querySelector('#headerMenuToggle')?.click();})()");
                break;
            case "scroll:top":
                evaluate("(()=>{const c=document.querySelector('.content');if(c)c.scrollTo(0,0);document.scrollingElement?.scrollTo(0,0);window.scrollTo(0,0);})()");
                break;
            case "scroll:down":
                evaluate("(()=>{const c=document.querySelector('.content');if(c&&c.scrollHeight>c.clientHeight)c.scrollTo(0,Math.min(c.scrollHeight-c.clientHeight,Math.max(520,c.clientHeight*.9)));else{const d=document.scrollingElement;d?.scrollTo(0,Math.min(d.scrollHeight-innerHeight,Math.max(520,innerHeight*.9)));}})()");
                break;
            default:
                break;
        }
    }

    private void writeInputDevicesArtifact() {
        JSONArray devices = new JSONArray();
        for (int id : InputDevice.getDeviceIds()) {
            InputDevice device = InputDevice.getDevice(id);
            if (device == null) continue;
            JSONObject item = new JSONObject();
            try {
                int sources = device.getSources();
                item.put("id", id);
                item.put("name", device.getName());
                item.put("descriptor", device.getDescriptor());
                item.put("vendorId", device.getVendorId());
                item.put("productId", device.getProductId());
                item.put("sources", sources);
                item.put("gamepad", (sources & InputDevice.SOURCE_GAMEPAD) == InputDevice.SOURCE_GAMEPAD);
                item.put("joystick", (sources & InputDevice.SOURCE_JOYSTICK) == InputDevice.SOURCE_JOYSTICK);
                item.put("keyboard", (sources & InputDevice.SOURCE_KEYBOARD) == InputDevice.SOURCE_KEYBOARD);
                devices.put(item);
            } catch (Exception ignored) {}
        }
        JSONObject output = new JSONObject();
        try {
            output.put("count", devices.length());
            output.put("devices", devices);
        } catch (Exception ignored) {}
        writeQaTextArtifact("input-devices.json", output.toString());
    }

    private void captureQaScreenshot(String rawName) {
        if (!isDebugBuild()) return;
        String name = sanitizeArtifactName(rawName, "capture") + ".png";
        runOnUiThread(() -> {
            View decor = getWindow().getDecorView();
            int width = decor.getWidth();
            int height = decor.getHeight();
            if (width <= 0 || height <= 0) {
                writeQaTextArtifact("capture-status.json", "{\"ok\":false,\"error\":\"window-not-laid-out\"}");
                return;
            }
            Bitmap bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
            PixelCopy.request(getWindow(), bitmap, result -> {
                if (result != PixelCopy.SUCCESS) {
                    bitmap.recycle();
                    writeQaTextArtifact(
                        "capture-status.json",
                        String.format(Locale.US, "{\"ok\":false,\"name\":\"%s\",\"pixelCopyResult\":%d}", name, result)
                    );
                    return;
                }
                qaIo.execute(() -> {
                    boolean saved = writeQaBitmapNow(name, bitmap);
                    bitmap.recycle();
                    writeQaTextArtifactNow(
                        "capture-status.json",
                        String.format(
                            Locale.US,
                            "{\"ok\":%s,\"name\":\"%s\",\"width\":%d,\"height\":%d}",
                            saved,
                            name,
                            width,
                            height
                        )
                    );
                });
            }, new Handler(Looper.getMainLooper()));
        });
    }

    void writeQaTextArtifact(String rawName, String text) {
        if (!isDebugBuild()) return;
        String name = sanitizeArtifactName(rawName, "qa-state.json");
        String payload = text == null ? "" : text;
        qaIo.execute(() -> writeQaTextArtifactNow(name, payload));
    }

    private boolean writeQaTextArtifactNow(String name, String text) {
        byte[] data = text.getBytes(StandardCharsets.UTF_8);
        return writeQaBytesNow(name, "application/json", output -> output.write(data));
    }

    private boolean writeQaBitmapNow(String name, Bitmap bitmap) {
        return writeQaBytesNow(name, "image/png", output -> {
            if (!bitmap.compress(Bitmap.CompressFormat.PNG, 100, output)) {
                throw new IllegalStateException("PNG compression failed.");
            }
        });
    }

    private interface QaWriter {
        void write(OutputStream output) throws Exception;
    }

    private boolean writeQaBytesNow(String name, String mimeType, QaWriter writer) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentResolver resolver = getContentResolver();
                String relativePath = Environment.DIRECTORY_DOWNLOADS + "/GameDeck-QA/";
                resolver.delete(
                    MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                    MediaStore.MediaColumns.DISPLAY_NAME + "=? AND " + MediaStore.MediaColumns.RELATIVE_PATH + "=?",
                    new String[]{name, relativePath}
                );
                ContentValues values = new ContentValues();
                values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                values.put(MediaStore.MediaColumns.MIME_TYPE, mimeType);
                values.put(MediaStore.MediaColumns.RELATIVE_PATH, relativePath);
                values.put(MediaStore.MediaColumns.IS_PENDING, 1);
                Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (uri == null) return false;
                try (OutputStream output = resolver.openOutputStream(uri, "w")) {
                    if (output == null) return false;
                    writer.write(output);
                }
                values.clear();
                values.put(MediaStore.MediaColumns.IS_PENDING, 0);
                resolver.update(uri, values, null, null);
                return true;
            }

            File base = getExternalFilesDir(Environment.DIRECTORY_PICTURES);
            if (base == null) return false;
            File directory = new File(base, "GameDeck-QA");
            if (!directory.isDirectory() && !directory.mkdirs()) return false;
            File file = new File(directory, name);
            try (OutputStream output = new FileOutputStream(file, false)) {
                writer.write(output);
            }
            return true;
        } catch (Exception error) {
            return false;
        }
    }

    private String sanitizeArtifactName(String raw, String fallback) {
        String value = raw == null ? "" : raw.trim();
        value = value.replaceAll("[^A-Za-z0-9._-]+", "-");
        value = value.replaceAll("^-+|-+$", "");
        if (value.isEmpty()) value = fallback;
        return value.length() > 96 ? value.substring(0, 96) : value;
    }

    private void runRgsxUiQa() {
        evaluate(
            "(()=>{" +
            "const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));" +
            "const report=(qa,detail)=>{try{window.GameDeckAndroid.reportQaState(JSON.stringify({qa,detail:detail||''}));}catch{}};" +
            "(async()=>{" +
            "const nav=document.querySelector('.nav[data-view=\"discover\"]');" +
            "if(!nav){report('rgsx-get-error','Discover navigation missing');return;}" +
            "nav.click();" +
            "let system=null;" +
            "for(let i=0;i<100&&!system;i++){system=document.querySelector('.console-card:not(.catalog-skeleton)');if(!system)await wait(100);}" +
            "if(!system){report('rgsx-get-error','Catalog system card missing');return;}" +
            "system.click();" +
            "let game=null;" +
            "for(let i=0;i<100&&!game;i++){game=document.querySelector('.catalog-game:not(.catalog-skeleton)');if(!game)await wait(100);}" +
            "if(!game){report('rgsx-get-error','Catalog game card missing');return;}" +
            "game.click();" +
            "let button=null;" +
            "for(let i=0;i<100&&!button;i++){const candidate=document.querySelector('#catalogFeatureAction');const visible=!!candidate&&candidate.getClientRects().length>0;if(visible&&!candidate.disabled&&!/Working|Downloading|Play now|Finish setup/i.test(candidate.textContent||''))button=candidate;if(!button)await wait(100);}" +
            "if(!button){report('rgsx-get-error','Discover Get action missing');return;}" +
            "const label=(button.textContent||'').trim();" +
            "button.click();" +
            "report('rgsx-get-clicked',label);" +
            "})().catch(error=>report('rgsx-get-error',String(error&&error.message||error)));" +
            "})()"
        );
    }

    void chooseTree(int requestCode) {
        runOnUiThread(() -> {
            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
                | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
            startActivityForResult(intent, requestCode);
        });
    }

    void openRemoteReceiver(String raw) {
        runOnUiThread(() -> {
            String value = raw == null ? "" : raw.trim();
            if (!value.startsWith("http://") && !value.startsWith("https://")) value = "http://" + value;
            Uri uri = Uri.parse(value);
            if (!("http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme())) || uri.getHost() == null) {
                evaluate("window.GameDeckNative&&window.GameDeckNative.showMessage('Enter a valid GameDeck host address.','warning')");
                return;
            }
            remoteMode = true;
            remoteOrigin = uri;
            hideBridge();
            useRemoteRendererLayer();
            webView.loadUrl(uri.toString());
        });
    }

    void openExternal(String raw) {
        runOnUiThread(() -> {
            try {
                Uri uri = Uri.parse(raw == null ? "" : raw.trim());
                String scheme = uri.getScheme();
                if (!("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)
                    || "mailto".equalsIgnoreCase(scheme) || "market".equalsIgnoreCase(scheme))) return;
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
            } catch (ActivityNotFoundException ignored) {}
        });
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (resultCode != RESULT_OK || data == null || data.getData() == null) return;
        Uri uri = data.getData();
        int flags = data.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        try {
            getContentResolver().takePersistableUriPermission(uri, flags);
        } catch (SecurityException ignored) {}
        if (requestCode == REQUEST_LIBRARY) {
            bridge.setLibraryRoot(uri);
            evaluate("window.GameDeckNative&&window.GameDeckNative.onStorageChanged('library')");
        } else if (requestCode == REQUEST_RGSX) {
            bridge.setRgsxRoot(uri);
            evaluate("window.GameDeckNative&&window.GameDeckNative.onStorageChanged('rgsx')");
        }
    }

    void notifyRuntimeChanged(String runtimeJson) {
        String payload = runtimeJson == null || runtimeJson.trim().isEmpty() ? "{}" : runtimeJson;
        evaluate("window.GameDeckNative&&window.GameDeckNative.onRuntimeChanged(" + payload + ")");
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (bridge != null) new Handler(Looper.getMainLooper()).postDelayed(bridge::resumeRuntimeProvisioning, 650);
    }

    private void evaluate(String script) {
        if (webView != null) webView.post(() -> webView.evaluateJavascript(script, null));
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (remoteMode) return super.dispatchKeyEvent(event);
        String input = keyName(event.getKeyCode());
        if (input != null) {
            evaluate("window.GameDeckInput&&window.GameDeckInput.handle('" + input + "'," + (event.getAction() == KeyEvent.ACTION_DOWN) + ")");
            return true;
        }
        return super.dispatchKeyEvent(event);
    }

    @Override
    public boolean dispatchGenericMotionEvent(MotionEvent event) {
        if (remoteMode) return super.dispatchGenericMotionEvent(event);
        if ((event.getSource() & InputDevice.SOURCE_JOYSTICK) == InputDevice.SOURCE_JOYSTICK
            && event.getAction() == MotionEvent.ACTION_MOVE) {
            float x = strongest(event.getAxisValue(MotionEvent.AXIS_HAT_X), event.getAxisValue(MotionEvent.AXIS_X));
            float y = strongest(event.getAxisValue(MotionEvent.AXIS_HAT_Y), event.getAxisValue(MotionEvent.AXIS_Y));
            int nextHorizontal = axisDirection(x, horizontalDirection);
            int nextVertical = axisDirection(y, verticalDirection);
            if (nextHorizontal != horizontalDirection) {
                if (horizontalDirection < 0) sendAxis("LEFT", false);
                if (horizontalDirection > 0) sendAxis("RIGHT", false);
                if (nextHorizontal < 0) sendAxis("LEFT", true);
                if (nextHorizontal > 0) sendAxis("RIGHT", true);
                horizontalDirection = nextHorizontal;
            }
            if (nextVertical != verticalDirection) {
                if (verticalDirection < 0) sendAxis("UP", false);
                if (verticalDirection > 0) sendAxis("DOWN", false);
                if (nextVertical < 0) sendAxis("UP", true);
                if (nextVertical > 0) sendAxis("DOWN", true);
                verticalDirection = nextVertical;
            }

            float leftTrigger = Math.max(
                event.getAxisValue(MotionEvent.AXIS_LTRIGGER),
                event.getAxisValue(MotionEvent.AXIS_BRAKE)
            );
            float rightTrigger = Math.max(
                event.getAxisValue(MotionEvent.AXIS_RTRIGGER),
                event.getAxisValue(MotionEvent.AXIS_GAS)
            );
            boolean nextLeftTrigger = triggerPressed(leftTrigger, leftTriggerPressed);
            boolean nextRightTrigger = triggerPressed(rightTrigger, rightTriggerPressed);
            if (nextLeftTrigger != leftTriggerPressed) {
                sendAxis("L2", nextLeftTrigger);
                leftTriggerPressed = nextLeftTrigger;
            }
            if (nextRightTrigger != rightTriggerPressed) {
                sendAxis("R2", nextRightTrigger);
                rightTriggerPressed = nextRightTrigger;
            }
            return true;
        }
        return super.dispatchGenericMotionEvent(event);
    }

    private float strongest(float first, float second) {
        return Math.abs(first) >= Math.abs(second) ? first : second;
    }

    private int axisDirection(float value, int current) {
        if (current < 0) return value > -0.34f ? 0 : -1;
        if (current > 0) return value < 0.34f ? 0 : 1;
        if (value < -0.58f) return -1;
        if (value > 0.58f) return 1;
        return 0;
    }

    private boolean triggerPressed(float value, boolean current) {
        return current ? value > 0.32f : value > 0.62f;
    }

    private void sendAxis(String input, boolean pressed) {
        evaluate("window.GameDeckInput&&window.GameDeckInput.handle('" + input + "'," + pressed + ")");
    }

    private String keyName(int keyCode) {
        switch (keyCode) {
            case KeyEvent.KEYCODE_DPAD_UP: return "UP";
            case KeyEvent.KEYCODE_DPAD_DOWN: return "DOWN";
            case KeyEvent.KEYCODE_DPAD_LEFT: return "LEFT";
            case KeyEvent.KEYCODE_DPAD_RIGHT: return "RIGHT";
            case KeyEvent.KEYCODE_DPAD_CENTER:
            case KeyEvent.KEYCODE_BUTTON_A: return "A";
            case KeyEvent.KEYCODE_BUTTON_B: return "B";
            case KeyEvent.KEYCODE_BUTTON_X: return "X";
            case KeyEvent.KEYCODE_BUTTON_Y: return "Y";
            case KeyEvent.KEYCODE_BUTTON_START: return "START";
            case KeyEvent.KEYCODE_BUTTON_SELECT: return "SELECT";
            case KeyEvent.KEYCODE_BUTTON_L1: return "L1";
            case KeyEvent.KEYCODE_BUTTON_R1: return "R1";
            case KeyEvent.KEYCODE_BUTTON_L2: return "L2";
            case KeyEvent.KEYCODE_BUTTON_R2: return "R2";
            default: return null;
        }
    }

    @Override
    public void onBackPressed() {
        if (remoteMode) {
            loadLocalShell();
            return;
        }
        evaluate("window.GameDeckNative&&window.GameDeckNative.back()");
    }

    @Override
    protected void onDestroy() {
        if (bridge != null) bridge.shutdown();
        if (qaReceiver != null) {
            try {
                unregisterReceiver(qaReceiver);
            } catch (IllegalArgumentException ignored) {}
            qaReceiver = null;
        }
        if (webView != null) {
            webView.loadUrl("about:blank");
            hideBridge();
            webView.destroy();
        }
        qaIo.shutdownNow();
        super.onDestroy();
    }
}
