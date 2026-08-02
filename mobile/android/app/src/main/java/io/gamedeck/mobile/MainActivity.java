package io.gamedeck.mobile;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

public class MainActivity extends Activity {
    private static final String PREFS = "gamedeck_mobile";
    private static final String URL_KEY = "deck_url";
    private WebView webView;
    private EditText address;
    private LinearLayout connectBar;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.rgb(9, 11, 16));
        getWindow().setNavigationBarColor(Color.rgb(9, 11, 16));
        buildInterface();
        String saved = getSharedPreferences(PREFS, MODE_PRIVATE).getString(URL_KEY, "");
        address.setText(saved);
        if (!saved.isEmpty()) connect(saved);
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
        address.setHint("http://192.168.1.20:41783/?code=123456");
        address.setTextColor(Color.WHITE);
        address.setHintTextColor(Color.rgb(103, 115, 133));
        address.setBackgroundColor(Color.rgb(20, 27, 38));
        address.setPadding(14, 0, 14, 0);
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
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        webView.setBackgroundColor(Color.BLACK);
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override public void onPageFinished(WebView view, String url) {
                connectBar.setVisibility(View.GONE);
                view.requestFocus();
            }
        });
        root.addView(webView, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        setContentView(root);
    }

    private void connect(String raw) {
        String value = raw == null ? "" : raw.trim();
        if (value.isEmpty()) return;
        if (!value.startsWith("http://") && !value.startsWith("https://")) value = "http://" + value;
        address.setText(value);
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(URL_KEY, value).apply();
        webView.loadUrl(value);
    }

    @Override public void onBackPressed() {
        if (connectBar.getVisibility() == View.GONE) {
            connectBar.setVisibility(View.VISIBLE);
            return;
        }
        if (webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override protected void onDestroy() {
        if (webView != null) {
            webView.loadUrl("about:blank");
            webView.destroy();
        }
        super.onDestroy();
    }
}
