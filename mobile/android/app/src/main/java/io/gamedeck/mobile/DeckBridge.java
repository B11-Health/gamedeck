package io.gamedeck.mobile;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.net.Uri;
import android.webkit.JavascriptInterface;

import org.json.JSONObject;

final class DeckBridge {
    private final MainActivity activity;
    private final AndroidRuntimeManager runtime;
    private final LibraryRepository library;
    private final RgsxProvider rgsx;

    DeckBridge(MainActivity activity) {
        this.activity = activity;
        this.runtime = new AndroidRuntimeManager(activity);
        this.library = new LibraryRepository(activity, runtime);
        this.rgsx = new RgsxProvider(activity);
    }

    @JavascriptInterface
    public String appInfo() {
        JSONObject value = new JSONObject();
        try {
            value.put("platform", "android");
            value.put("platformKey", AndroidRuntimeManager.PLATFORM_KEY);
            value.put("version", "0.2.0-alpha");
            value.put("localFirst", true);
            value.put("accountRequired", false);
            value.put("embeddedRuntimeReady", false);
        } catch (Exception ignored) {}
        return value.toString();
    }

    @JavascriptInterface
    public String library() {
        return library.scan();
    }

    @JavascriptInterface
    public String rescan() {
        return library.scan();
    }

    @JavascriptInterface
    public void chooseLibrary() {
        activity.chooseTree(MainActivity.REQUEST_LIBRARY);
    }

    @JavascriptInterface
    public String favorite(String contentUri) {
        return library.toggleFavorite(contentUri == null ? "" : contentUri);
    }

    @JavascriptInterface
    public String launch(String contentUri, String mimeType) {
        try {
            Uri uri = Uri.parse(contentUri);
            AndroidRuntimeManager.LaunchResult result = runtime.launch(uri, mimeType);
            if (result.ok) library.markPlayed(contentUri);
            return result.toJson().toString();
        } catch (Exception error) {
            JSONObject value = new JSONObject();
            try {
                value.put("ok", false);
                value.put("route", "blocked");
                value.put("reasonCode", "android_invalid_content_uri");
                value.put("message", "The selected game file is no longer available.");
            } catch (Exception ignored) {}
            return value.toString();
        }
    }

    @JavascriptInterface
    public String runtimeStatus() {
        return runtime.status().toString();
    }

    @JavascriptInterface
    public String rgsxStatus() {
        return rgsx.status();
    }

    @JavascriptInterface
    public void chooseRgsxRoot() {
        activity.chooseTree(MainActivity.REQUEST_RGSX);
    }

    @JavascriptInterface
    public void openRemoteReceiver(String url) {
        activity.openRemoteReceiver(url);
    }

    @JavascriptInterface
    public void openExternal(String url) {
        activity.openExternal(url);
    }

    @JavascriptInterface
    public void finishApp() {
        activity.runOnUiThread(activity::finish);
    }

    @JavascriptInterface
    public String copyText(String value) {
        ClipboardManager clipboard = (ClipboardManager) activity.getSystemService(Context.CLIPBOARD_SERVICE);
        if (clipboard != null) clipboard.setPrimaryClip(ClipData.newPlainText("GameDeck", value == null ? "" : value));
        return "{\"ok\":true}";
    }

    void setLibraryRoot(Uri uri) {
        library.setRoot(uri);
    }

    void setRgsxRoot(Uri uri) {
        rgsx.setRoot(uri);
    }
}
