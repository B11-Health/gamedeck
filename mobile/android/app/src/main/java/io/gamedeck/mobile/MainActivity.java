package io.gamedeck.mobile;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.InputDevice;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {
    static final int REQUEST_LIBRARY = 4101;
    static final int REQUEST_RGSX = 4102;
    private static final String LOCAL_URL = "file:///android_asset/index.html";

    private WebView webView;
    private DeckBridge bridge;
    private boolean remoteMode = false;
    private boolean bridgeExposed = false;
    private Uri remoteOrigin;
    private int horizontalDirection = 0;
    private int verticalDirection = 0;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.rgb(9, 11, 16));
        getWindow().setNavigationBarColor(Color.rgb(9, 11, 16));
        buildWebView();
        loadLocalShell();
    }

    private void buildWebView() {
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(9, 11, 16));
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
        settings.setUserAgentString(settings.getUserAgentString() + " GameDeckAndroid/0.2.0-alpha");
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
                view.requestFocus(View.FOCUS_DOWN);
            }
        });
        setContentView(webView);
    }

    private void loadLocalShell() {
        remoteMode = false;
        remoteOrigin = null;
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
            int nextHorizontal = x < -0.55f ? -1 : x > 0.55f ? 1 : 0;
            int nextVertical = y < -0.55f ? -1 : y > 0.55f ? 1 : 0;
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
            return true;
        }
        return super.dispatchGenericMotionEvent(event);
    }

    private float strongest(float first, float second) {
        return Math.abs(first) >= Math.abs(second) ? first : second;
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
        if (webView != null) {
            webView.loadUrl("about:blank");
            hideBridge();
            webView.destroy();
        }
        super.onDestroy();
    }
}
