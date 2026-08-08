package io.gamedeck.mobile;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.RectF;
import android.hardware.input.InputManager;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioTrack;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.Process;
import android.view.HapticFeedbackConstants;
import android.view.PixelCopy;
import android.view.InputDevice;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.Surface;
import android.view.SurfaceHolder;
import android.view.SurfaceView;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.provider.MediaStore;
import android.net.Uri;
import android.content.pm.ActivityInfo;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicBoolean;

/** GameDeck-owned Android frontend for the MIT-licensed libretro API. */
public final class GameDeckPlayActivity extends Activity
        implements SurfaceHolder.Callback, InputManager.InputDeviceListener, GameDeckPlayersView.Listener {
    static final String EXTRA_CORE = "io.gamedeck.mobile.extra.CORE";
    static final String EXTRA_CONTENT = "io.gamedeck.mobile.extra.CONTENT";
    static final String EXTRA_SYSTEM_DIR = "io.gamedeck.mobile.extra.SYSTEM_DIR";
    static final String EXTRA_SAVE_DIR = "io.gamedeck.mobile.extra.SAVE_DIR";
    static final String EXTRA_TITLE = "io.gamedeck.mobile.extra.TITLE";
    static final String EXTRA_SYSTEM_ID = "io.gamedeck.mobile.extra.SYSTEM_ID";
    private static final String CORE_OPTION_PREFS = "gamedeck-core-options";
    private static final String QA_ACTION = "io.gamedeck.mobile.PLAY_QA";
    // Pointer, keyboard cabinet actions, descriptors, and live core options are
    // part of the verified embedded frontend contract for console-aware input.
    private static final boolean ADVANCED_NATIVE_INPUT_ENABLED = true;

    private static final int RETRO_B = 0;
    private static final int RETRO_Y = 1;
    private static final int RETRO_SELECT = 2;
    private static final int RETRO_START = 3;
    private static final int RETRO_UP = 4;
    private static final int RETRO_DOWN = 5;
    private static final int RETRO_LEFT = 6;
    private static final int RETRO_RIGHT = 7;
    private static final int RETRO_A = 8;
    private static final int RETRO_X = 9;
    private static final int RETRO_L = 10;
    private static final int RETRO_R = 11;
    private static final int RETRO_L2 = 12;
    private static final int RETRO_R2 = 13;
    private static final int RETRO_L3 = 14;
    private static final int RETRO_R3 = 15;

    // libretro keyboard constants used by MAME-family cabinet actions.
    private static final int RETROK_TAB = 9;
    private static final int RETROK_F2 = 283;
    private static final long CABINET_PULSE_MS = 90L;
    private static final long FBNEO_DIAGNOSTIC_HOLD_MS = 2000L;

    private static final boolean NATIVE_AVAILABLE;
    static {
        boolean loaded = false;
        try {
            System.loadLibrary("gamedeck_libretro");
            loaded = true;
        } catch (Throwable ignored) {}
        NATIVE_AVAILABLE = loaded;
    }

    private FrameLayout rootView;
    private SurfaceView surfaceView;
    private TouchOverlay touchOverlay;
    private GameDeckPlayerRouter playerRouter;
    private GameDeckPlayersView playersView;
    private TextView playersButton;
    private TextView statusView;
    private FrameLayout cabinetDrawer;
    private LinearLayout cabinetOptions;
    private InputManager inputManager;
    private volatile boolean surfaceReady;
    private volatile boolean bootstrapped;
    private final AtomicBoolean started = new AtomicBoolean(false);
    private final AtomicBoolean stopping = new AtomicBoolean(false);
    private final AtomicBoolean qaScreenshotInProgress = new AtomicBoolean(false);
    private Thread bootstrapThread;
    private Thread emulationThread;
    private Thread audioThread;
    private AudioTrack audioTrack;
    private boolean leftTriggerPressed;
    private boolean rightTriggerPressed;
    private File diagnosticFile;
    private File nativeDiagnosticFile;
    private File controllerContractFile;
    private File qaCommandFile;
    private String systemId = "";
    private String contentPreferenceScope = "";
    private ConsoleInputProfile.Profile inputProfile;
    private boolean advancedTouchProfile;
    private BroadcastReceiver qaReceiver;

    static boolean isNativeHostAvailable() {
        return NATIVE_AVAILABLE;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prepareDiagnostics();
        checkpoint("activity-create", "entered");
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setVolumeControlStream(AudioManager.STREAM_MUSIC);
        systemId = String.valueOf(getIntent().getStringExtra(EXTRA_SYSTEM_ID));
        if ("null".equals(systemId)) systemId = "";
        inputProfile = ConsoleInputProfile.forSystemId(systemId);
        advancedTouchProfile = inputProfile.hasAnalog();
        playerRouter = new GameDeckPlayerRouter(this, "libretro-" + systemId);

        rootView = new FrameLayout(this);
        rootView.setBackgroundColor(0xFF05080E);
        surfaceView = new SurfaceView(this);
        surfaceView.getHolder().addCallback(this);
        rootView.addView(surfaceView, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        ));

        touchOverlay = new TouchOverlay(this);
        rootView.addView(touchOverlay, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        ));

        statusView = new TextView(this);
        statusView.setTextColor(Color.WHITE);
        statusView.setTextSize(15f);
        statusView.setGravity(android.view.Gravity.CENTER);
        statusView.setPadding(dp(28), dp(28), dp(28), dp(28));
        statusView.setBackgroundColor(0xCC090B10);
        statusView.setText("Starting GameDeck native play…");
        rootView.addView(statusView, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        ));

        TextView exit = new TextView(this);
        exit.setText("‹");
        exit.setContentDescription("Return to GameDeck");
        exit.setTextColor(0xEFFFFFFF);
        exit.setTextSize(28f);
        exit.setGravity(android.view.Gravity.CENTER);
        exit.setPadding(0, 0, 0, dp(2));
        GradientDrawable exitBackground = new GradientDrawable();
        exitBackground.setShape(GradientDrawable.OVAL);
        exitBackground.setColor(0xB30A1019);
        exitBackground.setStroke(dp(1), 0x8A5EE7FF);
        exit.setBackground(exitBackground);
        exit.setElevation(dp(6));
        exit.setHapticFeedbackEnabled(true);
        exit.setOnClickListener(view -> {
            view.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK);
            finish();
        });
        FrameLayout.LayoutParams exitParams = new FrameLayout.LayoutParams(
            dp(48),
            dp(48),
            android.view.Gravity.TOP | android.view.Gravity.START
        );
        exitParams.setMargins(dp(12), dp(12), 0, 0);
        rootView.addView(exit, exitParams);

        playersButton = new TextView(this);
        playersButton.setTextColor(0xF2FFFFFF);
        playersButton.setTextSize(11f);
        playersButton.setTypeface(Typeface.DEFAULT_BOLD);
        playersButton.setGravity(android.view.Gravity.CENTER);
        playersButton.setContentDescription("Choose player controllers");
        GradientDrawable playersBackground = new GradientDrawable();
        playersBackground.setColor(0xCC111722);
        playersBackground.setCornerRadius(dp(20));
        playersBackground.setStroke(dp(1), 0x665EE7FF);
        playersButton.setBackground(playersBackground);
        playersButton.setElevation(dp(24));
        playersButton.setOnClickListener(view -> openPlayersPanel());
        playersButton.setOnTouchListener((view, event) -> {
            if (event.getActionMasked() == MotionEvent.ACTION_UP) view.performClick();
            return true;
        });
        FrameLayout.LayoutParams playersParams = new FrameLayout.LayoutParams(
            dp(104), dp(38), android.view.Gravity.TOP | android.view.Gravity.END);
        playersParams.setMargins(0, dp(14), dp(14), 0);
        rootView.addView(playersButton, playersParams);

        playersView = new GameDeckPlayersView(this, playerRouter, this);
        playersView.setElevation(dp(32));
        playersView.setVisibility(View.GONE);
        rootView.addView(playersView, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        if (inputProfile.cabinetMenu) buildCabinetDrawer();

        setContentView(rootView);
        checkpoint("activity-create", "content-view-ready");
        registerQaReceiver();
        rootView.post(this::hideSystemUi);

        inputManager = (InputManager) getSystemService(Context.INPUT_SERVICE);
        applyPlayerAssignments();
        bootstrapNativeHost();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (intent == null) return;
        setIntent(intent);
        checkpoint("new-intent", "recreating-gameplay-session");
        // This activity is singleTop so CLEAR_TOP launches can deliver a new game into the
        // existing instance. Recreate it so core/content/system extras are never stale.
        rootView.post(this::recreate);
    }

    private void openPlayersPanel() {
        if (playersView == null) return;
        playersView.bringToFront();
        playersView.showPanel();
        checkpoint("players-panel", "opened;" + playerRouter.summary());
    }

    private void buildCabinetDrawer() {
        cabinetDrawer = new FrameLayout(this);
        cabinetDrawer.setVisibility(View.GONE);
        cabinetDrawer.setElevation(dp(36));
        cabinetDrawer.setClickable(true);

        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setPadding(dp(16), dp(14), dp(16), dp(16));
        GradientDrawable background = new GradientDrawable(
            GradientDrawable.Orientation.TL_BR,
            new int[]{0xF21A2533, 0xF0080D15});
        background.setCornerRadius(dp(26));
        background.setStroke(dp(1), 0x8A5EE7FF);
        panel.setBackground(background);
        panel.setElevation(dp(38));
        cabinetDrawer.addView(panel, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        LinearLayout header = new LinearLayout(this);
        header.setGravity(android.view.Gravity.CENTER_VERTICAL);
        TextView title = cabinetText("ARCADE CABINET", 15, 0xFFFFFFFF, true);
        header.addView(title, new LinearLayout.LayoutParams(0, dp(38), 1f));
        TextView close = cabinetChip("CLOSE");
        close.setOnClickListener(view -> closeCabinetPanel());
        header.addView(close, new LinearLayout.LayoutParams(dp(74), dp(34)));
        panel.addView(header, new LinearLayout.LayoutParams(-1, dp(42)));

        TextView subtitle = cabinetText(
            "Coin, service controls, and live core/DIP configuration for this game.",
            11, 0xFFB8C5D6, false);
        panel.addView(subtitle, new LinearLayout.LayoutParams(-1, dp(44)));

        LinearLayout quick = new LinearLayout(this);
        quick.setOrientation(LinearLayout.HORIZONTAL);
        quick.setGravity(android.view.Gravity.CENTER);
        addCabinetQuickAction(quick, "COIN", () -> pulseNativeButton(RETRO_SELECT));
        addCabinetQuickAction(quick, "START", () -> pulseNativeButton(RETRO_START));
        addCabinetQuickAction(quick, "SERVICE", () -> runArcadeDiagnosticAction("service"));
        addCabinetQuickAction(quick, "TEST", () -> runArcadeDiagnosticAction("test"));
        panel.addView(quick, new LinearLayout.LayoutParams(-1, dp(52)));

        LinearLayout cabinetTools = new LinearLayout(this);
        cabinetTools.setOrientation(LinearLayout.HORIZONTAL);
        cabinetTools.setGravity(android.view.Gravity.CENTER);
        addCabinetQuickAction(cabinetTools, "DIP / MENU", this::runArcadeMenuAction);
        addCabinetQuickAction(cabinetTools, "DEFAULTS", this::resetCabinetOptions);
        addCabinetQuickAction(cabinetTools, "REFRESH", this::refreshCabinetOptions);
        panel.addView(cabinetTools, new LinearLayout.LayoutParams(-1, dp(48)));

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        cabinetOptions = new LinearLayout(this);
        cabinetOptions.setOrientation(LinearLayout.VERTICAL);
        cabinetOptions.setPadding(0, dp(8), 0, dp(10));
        scroll.addView(cabinetOptions, new ScrollView.LayoutParams(-1, -2));
        panel.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1f));

        rootView.addView(cabinetDrawer, new FrameLayout.LayoutParams(dp(330), dp(520)));
    }

    private void addCabinetQuickAction(LinearLayout parent, String label, Runnable action) {
        TextView button = cabinetChip(label);
        button.setOnClickListener(view -> {
            view.performHapticFeedback(HapticFeedbackConstants.CONTEXT_CLICK);
            action.run();
        });
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, dp(40), 1f);
        params.setMargins(dp(3), dp(4), dp(3), dp(4));
        parent.addView(button, params);
    }

    private TextView cabinetChip(String value) {
        TextView view = cabinetText(value, 10, 0xFFF4F8FF, true);
        view.setGravity(android.view.Gravity.CENTER);
        view.setHapticFeedbackEnabled(true);
        GradientDrawable background = new GradientDrawable(
            GradientDrawable.Orientation.TL_BR,
            new int[]{0xEE26364B, 0xEE0A1019});
        background.setCornerRadius(dp(18));
        background.setStroke(dp(1), 0x705EE7FF);
        view.setBackground(background);
        return view;
    }

    private TextView cabinetText(String value, int size, int color, boolean bold) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextColor(color);
        view.setTextSize(size);
        view.setGravity(android.view.Gravity.CENTER_VERTICAL);
        view.setTypeface(bold ? Typeface.DEFAULT_BOLD : Typeface.DEFAULT);
        view.setMaxLines(2);
        return view;
    }

    private void openCabinetPanel() {
        if (cabinetDrawer == null) return;
        boolean landscape = rootView != null && rootView.getWidth() >= rootView.getHeight();
        int reserve = landscape ? cabinetPanelWidth(rootView.getWidth()) + dp(18) : 0;
        touchOverlay.setSystemPanelRightInset(reserve);
        touchOverlay.releaseAll();
        touchOverlay.setVisibility(View.INVISIBLE);
        refreshCabinetOptions();
        layoutCabinetDrawer();
        cabinetDrawer.setAlpha(0f);
        cabinetDrawer.setVisibility(View.VISIBLE);
        cabinetDrawer.bringToFront();
        cabinetDrawer.animate().alpha(1f).setDuration(180).start();
        checkpoint("cabinet-panel", "opened;profile=" + inputProfile.key);
    }

    private void closeCabinetPanel() {
        if (cabinetDrawer == null || cabinetDrawer.getVisibility() != View.VISIBLE) return;
        cabinetDrawer.animate().alpha(0f).setDuration(140).withEndAction(() -> {
            cabinetDrawer.setVisibility(View.GONE);
            touchOverlay.setSystemPanelRightInset(0);
            if (playerRouter == null || playerRouter.phoneSlot() >= 0) touchOverlay.setVisibility(View.VISIBLE);
        }).start();
        hideSystemUi();
    }

    private int cabinetPanelWidth(int rootWidth) {
        return Math.max(dp(220), Math.min(dp(340), Math.round(rootWidth * 0.30f)));
    }

    private void layoutCabinetDrawer() {
        if (cabinetDrawer == null || touchOverlay == null || rootView == null) return;
        RectF game = touchOverlay.gameRect;
        int rootWidth = rootView.getWidth();
        int rootHeight = rootView.getHeight();
        if (rootWidth <= 0 || rootHeight <= 0) return;
        FrameLayout.LayoutParams params;
        if (rootWidth >= rootHeight) {
            int width = cabinetPanelWidth(rootWidth);
            int height = Math.max(dp(300), rootHeight - dp(24));
            params = new FrameLayout.LayoutParams(width, height,
                android.view.Gravity.TOP | android.view.Gravity.END);
            params.topMargin = dp(12);
            params.rightMargin = dp(10);
        } else {
            int top = Math.round(game.bottom) + dp(10);
            int height = Math.max(dp(300), rootHeight - top - dp(12));
            params = new FrameLayout.LayoutParams(rootWidth - dp(20), height,
                android.view.Gravity.TOP | android.view.Gravity.CENTER_HORIZONTAL);
            params.topMargin = top;
        }
        cabinetDrawer.setLayoutParams(params);
    }

    private void refreshCabinetOptions() {
        if (cabinetOptions == null) return;
        cabinetOptions.removeAllViews();
        List<CoreOption> options = parseCoreOptions(NATIVE_AVAILABLE && ADVANCED_NATIVE_INPUT_ENABLED ? nativeCoreOptions() : "");
        if (options.isEmpty()) {
            TextView empty = cabinetText(
                "This core did not expose configurable DIP or core options for the current game.",
                12, 0xFFB8C5D6, false);
            empty.setPadding(dp(8), dp(18), dp(8), dp(18));
            cabinetOptions.addView(empty, new LinearLayout.LayoutParams(-1, -2));
            return;
        }
        options.sort((left, right) -> Boolean.compare(!left.isCabinetOption(), !right.isCabinetOption()));
        for (CoreOption option : options) cabinetOptions.addView(coreOptionRow(option));
    }

    private View coreOptionRow(CoreOption option) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(android.view.Gravity.CENTER_VERTICAL);
        row.setPadding(dp(10), dp(7), dp(7), dp(7));
        GradientDrawable background = new GradientDrawable();
        background.setColor(option.isCabinetOption() ? 0xA01E2A3A : 0x70121924);
        background.setCornerRadius(dp(17));
        background.setStroke(dp(1), option.isCabinetOption() ? 0x665EE7FF : 0x283D4D63);
        row.setBackground(background);

        LinearLayout copy = new LinearLayout(this);
        copy.setOrientation(LinearLayout.VERTICAL);
        TextView name = cabinetText(option.title, 11, 0xFFF5F8FF, true);
        TextView key = cabinetText(option.key, 9, 0xFF7F91A9, false);
        copy.addView(name, new LinearLayout.LayoutParams(-1, dp(24)));
        copy.addView(key, new LinearLayout.LayoutParams(-1, dp(18)));
        row.addView(copy, new LinearLayout.LayoutParams(0, dp(44), 1f));

        TextView value = cabinetChip(option.value.toUpperCase(Locale.ROOT));
        value.setContentDescription(option.title + ", current value " + option.value + ". Tap for next option.");
        value.setOnClickListener(view -> {
            String next = option.nextValue();
            if (NATIVE_AVAILABLE && ADVANCED_NATIVE_INPUT_ENABLED && nativeSetCoreOption(option.key, next)) {
                option.value = next;
                persistCoreOption(option);
                value.setText(next.toUpperCase(Locale.ROOT));
                value.setContentDescription(option.title + ", current value " + next + ". Tap for next option.");
                value.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK);
                checkpoint("core-option", option.key + "=" + next + ";persisted=true");
            }
        });
        row.addView(value, new LinearLayout.LayoutParams(dp(112), dp(36)));
        LinearLayout.LayoutParams outer = new LinearLayout.LayoutParams(-1, dp(58));
        outer.setMargins(0, dp(4), 0, dp(4));
        row.setLayoutParams(outer);
        return row;
    }

    private List<CoreOption> parseCoreOptions(String raw) {
        List<CoreOption> result = new ArrayList<>();
        if (raw == null || raw.isEmpty()) return result;
        for (String line : raw.split("\n")) {
            String[] parts = line.split("\t", 4);
            if (parts.length < 3) continue;
            int separator = parts[2].indexOf(';');
            String title = separator >= 0 ? parts[2].substring(0, separator).trim() : parts[0];
            String choices = separator >= 0 ? parts[2].substring(separator + 1).trim() : parts[1];
            List<String> values = new ArrayList<>();
            for (String choice : choices.split("\\|")) {
                String cleaned = choice.trim();
                if (!cleaned.isEmpty()) values.add(cleaned);
            }
            if (values.isEmpty()) values.add(parts[1]);
            String defaultValue = parts.length >= 4 && values.contains(parts[3]) ? parts[3] : values.get(0);
            result.add(new CoreOption(parts[0], title, parts[1], defaultValue, values));
        }
        return result;
    }

    private SharedPreferences coreOptionPreferences() {
        return getSharedPreferences(CORE_OPTION_PREFS, Context.MODE_PRIVATE);
    }

    private String coreOptionPreferenceKey(CoreOption option) {
        return systemId + "|" + contentPreferenceScope + "|" + option.key;
    }

    private void persistCoreOption(CoreOption option) {
        coreOptionPreferences().edit()
            .putString(coreOptionPreferenceKey(option), option.value)
            .apply();
    }

    private String restorePersistedCoreOptions(String raw) {
        List<CoreOption> options = parseCoreOptions(raw);
        if (options.isEmpty()) return raw == null ? "" : raw;
        SharedPreferences preferences = coreOptionPreferences();
        SharedPreferences.Editor cleanup = null;
        int restored = 0;
        for (CoreOption option : options) {
            String key = coreOptionPreferenceKey(option);
            String saved = preferences.getString(key, null);
            if (saved == null) continue;
            if (!option.values.contains(saved)) {
                if (cleanup == null) cleanup = preferences.edit();
                cleanup.remove(key);
                continue;
            }
            if (!saved.equals(option.value) && NATIVE_AVAILABLE && ADVANCED_NATIVE_INPUT_ENABLED && nativeSetCoreOption(option.key, saved)) {
                restored++;
            }
        }
        if (cleanup != null) cleanup.apply();
        if (restored > 0) checkpoint("core-options-restore", "restored=" + restored);
        return restored > 0 && NATIVE_AVAILABLE && ADVANCED_NATIVE_INPUT_ENABLED ? nativeCoreOptions() : raw;
    }

    private void resetCabinetOptions() {
        if (!NATIVE_AVAILABLE || !ADVANCED_NATIVE_INPUT_ENABLED) return;
        List<CoreOption> options = parseCoreOptions(nativeCoreOptions());
        SharedPreferences.Editor editor = coreOptionPreferences().edit();
        int reset = 0;
        for (CoreOption option : options) {
            editor.remove(coreOptionPreferenceKey(option));
            if (!option.defaultValue.equals(option.value)
                && option.values.contains(option.defaultValue)
                && nativeSetCoreOption(option.key, option.defaultValue)) {
                reset++;
            }
        }
        editor.apply();
        refreshCabinetOptions();
        if (cabinetDrawer != null) cabinetDrawer.performHapticFeedback(HapticFeedbackConstants.CONTEXT_CLICK);
        checkpoint("core-options-reset", "reset=" + reset + ";cleared=" + options.size());
    }

    private boolean isMameCabinet() {
        return "mame".equalsIgnoreCase(systemId);
    }

    private CoreOption activeCoreOption(String key) {
        if (!NATIVE_AVAILABLE || !ADVANCED_NATIVE_INPUT_ENABLED || key == null) return null;
        for (CoreOption option : parseCoreOptions(nativeCoreOptions())) {
            if (key.equalsIgnoreCase(option.key)) return option;
        }
        return null;
    }

    private void runArcadeDiagnosticAction(String source) {
        if (!NATIVE_AVAILABLE || !ADVANCED_NATIVE_INPUT_ENABLED) return;
        if (isMameCabinet()) {
            pulseNativeKey(RETROK_F2);
            checkpoint("cabinet-diagnostic", "core=mame;action=" + source + ";key=F2");
            return;
        }

        CoreOption diagnostic = activeCoreOption("fbneo-diagnostic-input");
        String configured = diagnostic == null ? "Hold Start" : diagnostic.value;
        String normalized = configured.toLowerCase(Locale.ROOT);
        List<Integer> buttons = new ArrayList<>();
        buttons.add(normalized.contains("select") ? RETRO_SELECT : RETRO_START);
        if (normalized.contains("+ l + r")) {
            buttons.add(RETRO_L);
            buttons.add(RETRO_R);
        } else if (normalized.contains("+ a + b")) {
            // FBNeo names its first two arcade actions A/B; these are libretro B/A.
            buttons.add(RETRO_B);
            buttons.add(RETRO_A);
        }
        int[] ids = new int[buttons.size()];
        for (int i = 0; i < buttons.size(); i++) ids[i] = buttons.get(i);
        holdNativeButtons(FBNEO_DIAGNOSTIC_HOLD_MS, ids);
        checkpoint("cabinet-diagnostic", "core=fbneo;action=" + source + ";input=" + configured);
    }

    private void runArcadeMenuAction() {
        if (!NATIVE_AVAILABLE || !ADVANCED_NATIVE_INPUT_ENABLED) return;
        if (isMameCabinet()) {
            pulseNativeKey(RETROK_TAB);
            checkpoint("cabinet-menu", "core=mame;key=TAB");
            return;
        }
        refreshCabinetOptions();
        if (cabinetOptions != null) cabinetOptions.requestFocus();
        checkpoint("cabinet-menu", "core=fbneo;surface=live-core-options");
    }

    private void pulseNativeButton(int id) {
        holdNativeButtons(CABINET_PULSE_MS, id);
    }

    private void holdNativeButtons(long durationMs, int... ids) {
        if (!NATIVE_AVAILABLE || ids == null || ids.length == 0) return;
        int slot = playerRouter == null ? 0 : Math.max(0, playerRouter.phoneSlot());
        for (int id : ids) nativeSetButtonForPort(slot, id, true);
        rootView.postDelayed(() -> {
            for (int id : ids) nativeSetButtonForPort(slot, id, false);
        }, Math.max(CABINET_PULSE_MS, durationMs));
    }

    private void pulseNativeKey(int key) {
        if (!NATIVE_AVAILABLE || !ADVANCED_NATIVE_INPUT_ENABLED) return;
        nativeSetKey(key, true);
        rootView.postDelayed(() -> nativeSetKey(key, false), CABINET_PULSE_MS);
    }

    private static final class CoreOption {
        final String key;
        final String title;
        final String defaultValue;
        final List<String> values;
        String value;

        CoreOption(String key, String title, String value, String defaultValue, List<String> values) {
            this.key = key;
            this.title = title;
            this.value = value;
            this.defaultValue = defaultValue;
            this.values = values;
        }

        String nextValue() {
            int index = values.indexOf(value);
            return values.get((index < 0 ? 0 : index + 1) % values.size());
        }

        boolean isCabinetOption() {
            String search = (key + " " + title).toLowerCase(Locale.ROOT);
            return search.contains("dip") || search.contains("service") || search.contains("test")
                || search.contains("diagnostic") || search.contains("setting mode")
                || search.contains("coin") || search.contains("free play") || search.contains("difficulty")
                || search.contains("lives") || search.contains("cabinet");
        }
    }

    private void bootstrapNativeHost() {
        if (!NATIVE_AVAILABLE) {
            checkpoint("native-library", "unavailable");
            showFatal("The GameDeck native runtime is not packaged in this build.");
            return;
        }
        String core = getIntent().getStringExtra(EXTRA_CORE);
        String content = getIntent().getStringExtra(EXTRA_CONTENT);
        String systemDir = getIntent().getStringExtra(EXTRA_SYSTEM_DIR);
        String saveDir = getIntent().getStringExtra(EXTRA_SAVE_DIR);
        String title = getIntent().getStringExtra(EXTRA_TITLE);
        if (!isReadableFile(core) || !isReadableFile(content)) {
            checkpoint("bootstrap-validation", "core-or-content-unreadable core=" + core + " content=" + content);
            showFatal("GameDeck could not read the selected game or console core.");
            return;
        }
        if (!ensureDirectory(systemDir) || !ensureDirectory(saveDir)) {
            checkpoint("bootstrap-validation", "runtime-directories-unavailable");
            showFatal("GameDeck could not create the native runtime directories.");
            return;
        }
        contentPreferenceScope = new File(content).getName();
        if (title != null && !title.trim().isEmpty()) statusView.setText("Starting " + title.trim() + "…");
        checkpoint("bootstrap-validation", "ready core=" + core + " content=" + content);
        bootstrapThread = new Thread(() -> {
            Process.setThreadPriority(Process.THREAD_PRIORITY_DISPLAY);
            checkpoint("native-bootstrap", "enter");
            boolean ok = nativeBootstrap(core, content, systemDir, saveDir,
                nativeDiagnosticFile == null ? "" : nativeDiagnosticFile.getAbsolutePath());
            checkpoint("native-bootstrap", ok ? "success" : "failed: " + nativeLastError());
            if (!ok) {
                runOnUiThread(() -> showFatal(nativeLastError()));
                return;
            }
            String inputDescriptors = "";
            String coreOptions = "";
            if (ADVANCED_NATIVE_INPUT_ENABLED) {
                inputDescriptors = nativeInputDescriptors();
                coreOptions = restorePersistedCoreOptions(nativeCoreOptions());
            }
            int descriptorCount = countMetadataRows(inputDescriptors);
            int optionCount = countMetadataRows(coreOptions);
            final String resolvedInputDescriptors = inputDescriptors;
            writeControllerContract(title, optionCount, descriptorCount, resolvedInputDescriptors);
            checkpoint("native-input-map", "profile=" + inputProfile.key
                + ";options=" + optionCount + ";descriptors=" + descriptorCount);
            bootstrapped = true;
            runOnUiThread(() -> {
                touchOverlay.setCoreInputDescriptors(resolvedInputDescriptors);
                touchOverlay.refreshVideoGeometry();
                statusView.animate().alpha(0f).setDuration(220).withEndAction(() -> statusView.setVisibility(View.GONE)).start();
                rebindGameSurfaceAfterGeometry();
            });
        }, "GameDeck-Native-Bootstrap");
        bootstrapThread.start();
    }

    private int countMetadataRows(String raw) {
        if (raw == null || raw.trim().isEmpty()) return 0;
        int count = 0;
        for (String line : raw.split("\n")) if (!line.trim().isEmpty()) count++;
        return count;
    }

    private void writeControllerContract(
            String title, int optionCount, int descriptorCount, String descriptors) {
        if (controllerContractFile == null) return;
        try (OutputStream output = new FileOutputStream(controllerContractFile, false)) {
            StringBuilder value = new StringBuilder();
            value.append("time=").append(Instant.now()).append('\n')
                .append("system=").append(systemId).append('\n')
                .append("title=").append(title == null ? "" : title).append('\n')
                .append("profile=").append(inputProfile.key).append('\n')
                .append("layout=").append(inputProfile.layout.name()).append('\n')
                .append("faceButtons=").append(inputProfile.faceButtons.length).append('\n')
                .append("sticks=").append(inputProfile.stickCount).append('\n')
                .append("shoulderPairs=").append(inputProfile.shoulderPairs).append('\n')
                .append("triggers=").append(inputProfile.triggerCount).append('\n')
                .append("touchscreen=").append(inputProfile.touchscreen).append('\n')
                .append("arcade=").append(inputProfile.arcade).append('\n')
                .append("cabinetMenu=").append(inputProfile.cabinetMenu).append('\n')
                .append("coreOptions=").append(optionCount).append('\n')
                .append("inputDescriptors=").append(descriptorCount).append('\n');
            if (descriptors != null && !descriptors.isEmpty()) {
                value.append("\n[descriptors]\n");
                value.append(descriptors, 0, Math.min(descriptors.length(), 16384));
            }
            output.write(value.toString().getBytes(StandardCharsets.UTF_8));
            output.flush();
        } catch (Throwable ignored) {}
    }

    private synchronized void startRuntimeIfReady() {
        if (!surfaceReady || !bootstrapped || stopping.get() || !started.compareAndSet(false, true)) return;
        checkpoint("runtime", "starting-emulation-and-audio");
        emulationThread = new Thread(GameDeckPlayActivity::nativeRun, "GameDeck-Libretro");
        emulationThread.setPriority(Thread.MAX_PRIORITY);
        emulationThread.start();
        audioThread = new Thread(this::runAudio, "GameDeck-Libretro-Audio");
        audioThread.setPriority(Thread.MAX_PRIORITY);
        audioThread.start();
    }

    private void runAudio() {
        checkpoint("audio", "thread-enter");
        Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO);
        int sampleRate = Math.max(8000, Math.min(192000, nativeSampleRate()));
        int minimum = AudioTrack.getMinBufferSize(
            sampleRate,
            AudioFormat.CHANNEL_OUT_STEREO,
            AudioFormat.ENCODING_PCM_16BIT
        );
        int bufferBytes = Math.max(minimum > 0 ? minimum * 2 : 0, 32768);
        try {
            AudioTrack.Builder builder = new AudioTrack.Builder()
                .setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_GAME)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .build())
                .setAudioFormat(new AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setSampleRate(sampleRate)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_STEREO)
                    .build())
                .setTransferMode(AudioTrack.MODE_STREAM)
                .setBufferSizeInBytes(bufferBytes);
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                builder.setPerformanceMode(AudioTrack.PERFORMANCE_MODE_LOW_LATENCY);
            }
            audioTrack = builder.build();
            short[] samples = new short[2048];
            int primed = 0;
            long primeDeadline = android.os.SystemClock.uptimeMillis() + 180L;
            while (!stopping.get() && primed < samples.length
                    && android.os.SystemClock.uptimeMillis() < primeDeadline) {
                int count = nativeReadAudio(samples, samples.length);
                if (count > 0) {
                    writeAudioFully(audioTrack, samples, count);
                    primed += count;
                } else {
                    try { Thread.sleep(2); } catch (InterruptedException ignored) { return; }
                }
            }
            audioTrack.play();
            checkpoint("audio", "playing sample-rate=" + sampleRate
                + " buffer=" + bufferBytes + " primed-shorts=" + primed);
            while (!stopping.get()) {
                int count = nativeReadAudio(samples, samples.length);
                if (count > 0) {
                    if (!writeAudioFully(audioTrack, samples, count)) break;
                } else {
                    try { Thread.sleep(2); } catch (InterruptedException ignored) { break; }
                }
            }
        } catch (Throwable error) {
            checkpoint("audio", "error=" + error);
            android.util.Log.w("GameDeckPlay", "Audio output stopped", error);
        } finally {
            if (audioTrack != null) {
                try { audioTrack.pause(); } catch (Throwable ignored) {}
                try { audioTrack.flush(); } catch (Throwable ignored) {}
                try { audioTrack.release(); } catch (Throwable ignored) {}
                audioTrack = null;
            }
        }
    }

    private boolean writeAudioFully(AudioTrack track, short[] samples, int count) {
        int offset = 0;
        while (offset < count && !stopping.get()) {
            int written = track.write(samples, offset, count - offset, AudioTrack.WRITE_BLOCKING);
            if (written < 0) {
                checkpoint("audio", "write-error=" + written + " offset=" + offset + " count=" + count);
                return false;
            }
            if (written == 0) {
                try { Thread.sleep(1); } catch (InterruptedException ignored) { return false; }
                continue;
            }
            offset += written;
        }
        return offset == count;
    }

    private void showFatal(String message) {
        checkpoint("fatal", message == null ? "unknown" : message);
        statusView.setAlpha(1f);
        statusView.setVisibility(View.VISIBLE);
        statusView.setText((message == null || message.trim().isEmpty())
            ? "GameDeck native play could not start."
            : message.trim() + "\n\nTap ‹ GameDeck to return.");
    }

    private boolean isReadableFile(String path) {
        return path != null && new File(path).isFile() && new File(path).canRead();
    }

    private boolean ensureDirectory(String path) {
        if (path == null || path.trim().isEmpty()) return false;
        File directory = new File(path);
        return directory.isDirectory() || directory.mkdirs();
    }

    private void applyGameSurfaceBounds(android.graphics.RectF rect) {
        if (surfaceView == null || rect == null || rect.width() < 1f || rect.height() < 1f) return;
        int left = Math.max(0, Math.round(rect.left));
        int top = Math.max(0, Math.round(rect.top));
        int width = Math.max(1, Math.round(rect.width()));
        int height = Math.max(1, Math.round(rect.height()));
        FrameLayout.LayoutParams params = (FrameLayout.LayoutParams) surfaceView.getLayoutParams();
        if (params.width == width && params.height == height
                && params.leftMargin == left && params.topMargin == top) return;
        params.width = width;
        params.height = height;
        params.gravity = android.view.Gravity.TOP | android.view.Gravity.START;
        params.leftMargin = left;
        params.topMargin = top;
        params.rightMargin = 0;
        params.bottomMargin = 0;
        surfaceView.setLayoutParams(params);
        checkpoint("surface-bounds", left + "," + top + " " + width + "x" + height
            + " profile=" + (inputProfile == null ? "" : inputProfile.key));
    }

    private void rebindGameSurfaceAfterGeometry() {
        if (surfaceView == null) {
            startRuntimeIfReady();
            return;
        }
        surfaceView.post(() -> {
            Surface surface = surfaceView.getHolder().getSurface();
            if (surface != null && surface.isValid()) {
                checkpoint("surface-rebind", surfaceView.getWidth() + "x" + surfaceView.getHeight());
                if (NATIVE_AVAILABLE) nativeSetSurface(surface);
                surfaceReady = true;
                startRuntimeIfReady();
            } else {
                checkpoint("surface-rebind", "waiting-for-valid-surface");
                startRuntimeIfReady();
            }
        });
    }

    private void resetGameSurfaceBounds() {
        if (surfaceView == null) return;
        FrameLayout.LayoutParams params = (FrameLayout.LayoutParams) surfaceView.getLayoutParams();
        if (params.width == FrameLayout.LayoutParams.MATCH_PARENT
                && params.height == FrameLayout.LayoutParams.MATCH_PARENT
                && params.leftMargin == 0 && params.topMargin == 0) return;
        params.width = FrameLayout.LayoutParams.MATCH_PARENT;
        params.height = FrameLayout.LayoutParams.MATCH_PARENT;
        params.gravity = android.view.Gravity.TOP | android.view.Gravity.START;
        params.leftMargin = 0;
        params.topMargin = 0;
        params.rightMargin = 0;
        params.bottomMargin = 0;
        surfaceView.setLayoutParams(params);
    }

    private void hideSystemUi() {
        View decorView = getWindow().getDecorView();
        if (android.os.Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController controller = decorView.getWindowInsetsController();
            if (controller == null) {
                decorView.postDelayed(this::hideSystemUi, 80L);
                return;
            }
            controller.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
            controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        } else {
            decorView.setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            );
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemUi();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (inputManager != null) inputManager.registerInputDeviceListener(this, null);
        if (playerRouter != null) playerRouter.refreshDevices();
        applyPlayerAssignments();
        if (NATIVE_AVAILABLE) nativePause(false);
    }

    @Override
    protected void onPause() {
        if (NATIVE_AVAILABLE) nativePause(true);
        if (inputManager != null) inputManager.unregisterInputDeviceListener(this);
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        checkpoint("activity-destroy", "entered");
        if (qaReceiver != null) {
            try { unregisterReceiver(qaReceiver); } catch (Throwable ignored) {}
            qaReceiver = null;
        }
        stopping.set(true);
        if (touchOverlay != null) touchOverlay.releaseAll();
        if (NATIVE_AVAILABLE) {
            nativeStop();
            nativeSetViewportInsets(0, 0, 0, 0);
            nativeSetSurface(null);
        }
        interruptAndJoin(audioThread);
        interruptAndJoin(emulationThread);
        interruptAndJoin(bootstrapThread);
        if (NATIVE_AVAILABLE) nativeRelease();
        super.onDestroy();
    }

    private void interruptAndJoin(Thread thread) {
        if (thread == null || thread == Thread.currentThread()) return;
        thread.interrupt();
        try { thread.join(1200); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }
    }

    @Override
    public void surfaceCreated(SurfaceHolder holder) {
        checkpoint("surface", "created");
        Surface surface = holder.getSurface();
        if (NATIVE_AVAILABLE) nativeSetSurface(surface != null && surface.isValid() ? surface : null);
        surfaceReady = true;
        startRuntimeIfReady();
    }

    @Override
    public void surfaceChanged(SurfaceHolder holder, int format, int width, int height) {
        checkpoint("surface", "changed " + width + "x" + height + " format=" + format);
        Surface surface = holder.getSurface();
        if (NATIVE_AVAILABLE) nativeSetSurface(surface != null && surface.isValid() ? surface : null);
    }

    @Override
    public void surfaceDestroyed(SurfaceHolder holder) {
        checkpoint("surface", "destroyed");
        surfaceReady = false;
        if (NATIVE_AVAILABLE) nativeSetSurface(null);
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (playersView != null && playersView.isShowing()) {
            playersView.handleKeyEvent(event);
            return true;
        }
        if (!NATIVE_AVAILABLE) return super.dispatchKeyEvent(event);
        boolean gamepad = GameDeckHardwareInput.isGamepadSource(event.getSource());
        if (event.getKeyCode() == KeyEvent.KEYCODE_BACK && !gamepad) {
            if (event.getAction() == KeyEvent.ACTION_UP) finish();
            return true;
        }
        if (gamepad && event.getRepeatCount() == 0) {
            int slot = playerRouter == null ? -1 : playerRouter.slotForDevice(event.getDeviceId());
            int button = retroButton(event.getKeyCode());
            if (slot >= 0 && button >= 0) {
                nativeSetButtonForPort(slot, button, event.getAction() == KeyEvent.ACTION_DOWN);
                return true;
            }
            if (button >= 0) return true;
        }
        return super.dispatchKeyEvent(event);
    }

    @Override
    public boolean dispatchGenericMotionEvent(MotionEvent event) {
        if (playersView != null && playersView.isShowing()) return true;
        if (!NATIVE_AVAILABLE) return super.dispatchGenericMotionEvent(event);
        if (GameDeckHardwareInput.isGamepadSource(event.getSource())
            && event.getAction() == MotionEvent.ACTION_MOVE) {
            int slot = playerRouter == null ? -1 : playerRouter.slotForDevice(event.getDeviceId());
            if (slot >= 0) {
                nativeSetAxisForPort(slot, 0, GameDeckHardwareInput.leftX(event));
                nativeSetAxisForPort(slot, 1, GameDeckHardwareInput.leftY(event));
                nativeSetAxisForPort(slot, 2, GameDeckHardwareInput.rightX(event));
                nativeSetAxisForPort(slot, 3, GameDeckHardwareInput.rightY(event));
                int hatX = GameDeckHardwareInput.hatX(event);
                int hatY = GameDeckHardwareInput.hatY(event);
                nativeSetButtonForPort(slot, RETRO_LEFT, hatX < 0);
                nativeSetButtonForPort(slot, RETRO_RIGHT, hatX > 0);
                nativeSetButtonForPort(slot, RETRO_UP, hatY < 0);
                nativeSetButtonForPort(slot, RETRO_DOWN, hatY > 0);
                applyHardwareTriggers(slot, event);
            }
            return true;
        }
        return super.dispatchGenericMotionEvent(event);
    }

    private void applyHardwareTriggers(int slot, MotionEvent event) {
        boolean hasLeft = GameDeckHardwareInput.hasLeftTriggerAxis(event);
        boolean hasRight = GameDeckHardwareInput.hasRightTriggerAxis(event);
        float left = hasLeft ? GameDeckHardwareInput.leftTrigger(event) : 0f;
        float right = hasRight ? GameDeckHardwareInput.rightTrigger(event) : 0f;

        if (inputProfile == ConsoleInputProfile.Profile.N64) {
            if (hasLeft || hasRight) nativeSetButtonForPort(slot, RETRO_L2, Math.max(left, right) > 0.35f);
            return;
        }
        if (inputProfile == ConsoleInputProfile.Profile.GAMECUBE) {
            if (hasLeft) {
                nativeSetButtonForPort(slot, RETRO_L2, left > 0.72f);
                nativeSetButtonForPort(slot, RETRO_L3, left > 0.16f && left <= 0.72f);
            }
            if (hasRight) {
                nativeSetButtonForPort(slot, RETRO_R2, right > 0.72f);
                nativeSetButtonForPort(slot, RETRO_R3, right > 0.16f && right <= 0.72f);
            }
            return;
        }
        if (inputProfile == ConsoleInputProfile.Profile.DREAMCAST) {
            if (hasLeft) {
                nativeSetButtonForPort(slot, RETRO_L, left > 0.72f);
                nativeSetButtonForPort(slot, RETRO_L2, left > 0.16f && left <= 0.72f);
            }
            if (hasRight) {
                nativeSetButtonForPort(slot, RETRO_R, right > 0.72f);
                nativeSetButtonForPort(slot, RETRO_R2, right > 0.16f && right <= 0.72f);
            }
            return;
        }
        if (hasLeft) nativeSetButtonForPort(slot, RETRO_L2, left > 0.45f);
        if (hasRight) nativeSetButtonForPort(slot, RETRO_R2, right > 0.45f);
    }

    private int retroButton(int keyCode) {
        int mapped = ConsoleInputProfile.mapHardwareKey(systemId, keyCode);
        if (inputProfile == ConsoleInputProfile.Profile.N64) {
            switch (keyCode) {
                case KeyEvent.KEYCODE_BUTTON_A: return RETRO_B;
                case KeyEvent.KEYCODE_BUTTON_B: return RETRO_Y;
                case KeyEvent.KEYCODE_BUTTON_X: return RETRO_A;
                case KeyEvent.KEYCODE_BUTTON_Y: return RETRO_X;
                case KeyEvent.KEYCODE_BUTTON_L1: return RETRO_L;
                case KeyEvent.KEYCODE_BUTTON_R1: return RETRO_R;
                case KeyEvent.KEYCODE_BUTTON_L2:
                case KeyEvent.KEYCODE_BUTTON_R2: return RETRO_L2;
                case KeyEvent.KEYCODE_BUTTON_SELECT: return RETRO_R2;
                default: return mapped;
            }
        }
        if (inputProfile == ConsoleInputProfile.Profile.GAMECUBE) {
            switch (keyCode) {
                case KeyEvent.KEYCODE_BUTTON_L1: return RETRO_L3;
                case KeyEvent.KEYCODE_BUTTON_R1: return RETRO_R3;
                case KeyEvent.KEYCODE_BUTTON_Z:
                case KeyEvent.KEYCODE_BUTTON_SELECT: return RETRO_R;
                default: return mapped;
            }
        }
        return mapped;
    }

    private void applyPlayerAssignments() {
        if (playerRouter == null || touchOverlay == null) return;
        int phoneSlot = playerRouter.phoneSlot();
        touchOverlay.setPlayerSlot(Math.max(0, phoneSlot));
        touchOverlay.setVisibility(phoneSlot >= 0 ? View.VISIBLE : View.GONE);
        if (phoneSlot < 0) touchOverlay.releaseAll();
        if (playersButton != null) playersButton.setText("PLAYERS · " + playerRouter.activePlayerCount());
        if (playersView != null) playersView.invalidate();
        checkpoint("players", playerRouter.summary());
    }

    private void releaseNativePort(int slot) {
        if (!NATIVE_AVAILABLE) return;
        for (int button = 0; button < 16; button++) nativeSetButtonForPort(slot, button, false);
        for (int axis = 0; axis < 6; axis++) nativeSetAxisForPort(slot, axis, 0f);
    }

    @Override public void onInputDeviceAdded(int deviceId) {
        playerRouter.refreshDevices();
        applyPlayerAssignments();
    }

    @Override public void onInputDeviceRemoved(int deviceId) {
        for (int slot = 0; slot < GameDeckPlayerRouter.MAX_PLAYERS; slot++) releaseNativePort(slot);
        playerRouter.refreshDevices();
        applyPlayerAssignments();
    }

    @Override public void onInputDeviceChanged(int deviceId) {
        playerRouter.refreshDevices();
        applyPlayerAssignments();
    }

    @Override public void onAssignmentsChanged() {
        for (int slot = 0; slot < GameDeckPlayerRouter.MAX_PLAYERS; slot++) releaseNativePort(slot);
        applyPlayerAssignments();
    }

    @Override public void onDismissed() { hideSystemUi(); }

    private boolean isDebugBuild() {
        return (getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0;
    }

    private void registerQaReceiver() {
        if (!isDebugBuild()) return;
        qaReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                String command = intent == null ? "" : String.valueOf(intent.getStringExtra("command"));
                writeQaCommandReceipt(command);
                if (command.startsWith("screenshot:")) {
                    captureQaScreenshot(command.substring("screenshot:".length()));
                } else if ("orientation:portrait".equals(command)) {
                    setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
                } else if ("orientation:landscape".equals(command)) {
                    setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE);
                } else if ("controls:pulse".equals(command) && touchOverlay != null) {
                    touchOverlay.qaPulseControls();
                } else if ("exit:back".equals(command)) {
                    runOnUiThread(GameDeckPlayActivity.this::finish);
                }
            }
        };
        IntentFilter filter = new IntentFilter(QA_ACTION);
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(qaReceiver, filter, Context.RECEIVER_EXPORTED);
        } else {
            registerLegacyQaReceiver(filter);
        }
    }

    @android.annotation.SuppressLint("UnspecifiedRegisterReceiverFlag")
    private void registerLegacyQaReceiver(IntentFilter filter) {
        // Android 12L and older do not expose the receiver-export flag overload used on T+.
        // This path exists only in debuggable builds so shell-driven QA remains available.
        registerReceiver(qaReceiver, filter);
    }

    private void captureQaScreenshot(String rawName) {
        if (!isDebugBuild() || rootView == null) return;
        String name = sanitizeQaName(rawName, "runtime") + ".png";
        if (!qaScreenshotInProgress.compareAndSet(false, true)) {
            writeQaCommandReceipt("screenshot-busy:" + name);
            return;
        }
        runOnUiThread(() -> {
            android.view.Window window = getWindow();
            View decor = window == null ? null : window.getDecorView();
            int width = decor == null ? 0 : decor.getWidth();
            int height = decor == null ? 0 : decor.getHeight();
            if (decor == null || !decor.isAttachedToWindow() || !decor.isShown() || width <= 0 || height <= 0) {
                qaScreenshotInProgress.set(false);
                writeQaCommandReceipt("screenshot-unavailable:" + name);
                return;
            }
            Bitmap bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
            AtomicBoolean completed = new AtomicBoolean(false);
            Runnable timeout = () -> {
                if (!completed.compareAndSet(false, true)) return;
                if (!bitmap.isRecycled()) bitmap.recycle();
                qaScreenshotInProgress.set(false);
                writeQaCommandReceipt("screenshot-window-timeout:" + name);
            };
            rootView.postDelayed(timeout, 1600L);
            try {
                PixelCopy.request(window, bitmap, result -> {
                    if (!completed.compareAndSet(false, true)) return;
                    rootView.removeCallbacks(timeout);
                    if (result != PixelCopy.SUCCESS) {
                        checkpoint("qa-screenshot", "failed name=" + name + " result=" + result);
                        writeQaCommandReceipt("screenshot-failed:" + name + ":" + result);
                        bitmap.recycle();
                        qaScreenshotInProgress.set(false);
                        return;
                    }
                    compositeSurfaceIntoQaBitmap(name, bitmap, width, height);
                }, new Handler(Looper.getMainLooper()));
            } catch (IllegalArgumentException | IllegalStateException error) {
                rootView.removeCallbacks(timeout);
                completed.set(true);
                bitmap.recycle();
                qaScreenshotInProgress.set(false);
                writeQaCommandReceipt("screenshot-unavailable:" + name);
            }
        });
    }

    private void compositeSurfaceIntoQaBitmap(String name, Bitmap windowBitmap, int width, int height) {
        Surface surface = surfaceView == null ? null : surfaceView.getHolder().getSurface();
        int surfaceWidth = surfaceView == null ? 0 : surfaceView.getWidth();
        int surfaceHeight = surfaceView == null ? 0 : surfaceView.getHeight();
        if (surfaceView == null || surface == null || !surface.isValid()
                || surfaceWidth <= 0 || surfaceHeight <= 0 || !surfaceView.isShown()) {
            finishQaScreenshot(name, windowBitmap, width, height, "window-only");
            return;
        }
        int captureWidth = inputProfile == ConsoleInputProfile.Profile.PSP ? 480 : surfaceWidth;
        int captureHeight = inputProfile == ConsoleInputProfile.Profile.PSP ? 272 : surfaceHeight;
        Bitmap surfaceBitmap = Bitmap.createBitmap(
            Math.max(1, captureWidth), Math.max(1, captureHeight), Bitmap.Config.ARGB_8888);
        AtomicBoolean completed = new AtomicBoolean(false);
        Runnable timeout = () -> {
            if (!completed.compareAndSet(false, true)) return;
            if (!surfaceBitmap.isRecycled()) surfaceBitmap.recycle();
            finishQaScreenshot(name, windowBitmap, width, height, "surface-copy-timeout");
        };
        rootView.postDelayed(timeout, 1200L);
        try {
            PixelCopy.request(surface, surfaceBitmap, result -> {
                if (!completed.compareAndSet(false, true)) return;
                rootView.removeCallbacks(timeout);
                if (result == PixelCopy.SUCCESS) {
                    int[] location = new int[2];
                    surfaceView.getLocationInWindow(location);
                    Canvas composite = new Canvas(windowBitmap);
                    android.graphics.Rect destination = new android.graphics.Rect(location[0], location[1],
                        location[0] + surfaceWidth, location[1] + surfaceHeight);
                    composite.drawBitmap(surfaceBitmap, null, destination, null);
                    finishQaScreenshot(name, windowBitmap, width, height,
                        "composited-surface@" + location[0] + "," + location[1]
                            + " " + surfaceWidth + "x" + surfaceHeight
                            + " source=" + captureWidth + "x" + captureHeight);
                } else {
                    finishQaScreenshot(name, windowBitmap, width, height,
                        "surface-copy-failed=" + result);
                }
                surfaceBitmap.recycle();
            }, new Handler(Looper.getMainLooper()));
        } catch (IllegalArgumentException | IllegalStateException error) {
            rootView.removeCallbacks(timeout);
            completed.set(true);
            surfaceBitmap.recycle();
            finishQaScreenshot(name, windowBitmap, width, height,
                "surface-copy-unavailable=" + error.getClass().getSimpleName());
        }
    }

    private void finishQaScreenshot(String name, Bitmap bitmap, int width, int height, String detail) {
        new Thread(() -> {
            boolean saved = writeQaBitmap(name, bitmap);
            bitmap.recycle();
            qaScreenshotInProgress.set(false);
            checkpoint("qa-screenshot", (saved ? "saved " : "failed ") + name
                + " " + width + "x" + height + " " + detail);
            writeQaCommandReceipt((saved ? "screenshot-saved:" : "screenshot-write-failed:")
                + name + ":" + detail);
        }, "GameDeck-QA-Screenshot").start();
    }

    private boolean writeQaBitmap(String name, Bitmap bitmap) {
        try {
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
                ContentResolver resolver = getContentResolver();
                String relativePath = Environment.DIRECTORY_DOWNLOADS + "/GameDeck-QA/";
                resolver.delete(MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                    MediaStore.MediaColumns.DISPLAY_NAME + "=? AND " + MediaStore.MediaColumns.RELATIVE_PATH + "=?",
                    new String[]{name, relativePath});
                ContentValues values = new ContentValues();
                values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                values.put(MediaStore.MediaColumns.MIME_TYPE, "image/png");
                values.put(MediaStore.MediaColumns.RELATIVE_PATH, relativePath);
                values.put(MediaStore.MediaColumns.IS_PENDING, 1);
                Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (uri == null) return false;
                try (OutputStream output = resolver.openOutputStream(uri, "w")) {
                    if (output == null || !bitmap.compress(Bitmap.CompressFormat.PNG, 100, output)) return false;
                }
                values.clear();
                values.put(MediaStore.MediaColumns.IS_PENDING, 0);
                resolver.update(uri, values, null, null);
                return true;
            }
            return false;
        } catch (Throwable error) {
            checkpoint("qa-screenshot", "write-error=" + error.getClass().getSimpleName());
            return false;
        }
    }

    private String sanitizeQaName(String raw, String fallback) {
        String value = raw == null ? "" : raw.trim().replaceAll("[^A-Za-z0-9._-]+", "-");
        value = value.replaceAll("^-+|-+$", "");
        if (value.isEmpty()) value = fallback;
        return value.length() > 80 ? value.substring(0, 80) : value;
    }

    private void prepareDiagnostics() {
        try {
            File[] roots = getExternalMediaDirs();
            if (roots == null || roots.length == 0 || roots[0] == null) return;
            File directory = new File(roots[0], "GameDeck-Console/diagnostics");
            if (!directory.isDirectory() && !directory.mkdirs()) return;
            diagnosticFile = new File(directory, "native-play-state.txt");
            nativeDiagnosticFile = new File(directory, "native-runtime-state.txt");
            controllerContractFile = new File(directory, "controller-contract.txt");
            qaCommandFile = new File(directory, "play-qa-command.txt");
        } catch (Throwable ignored) {}
    }

    private synchronized void writeQaCommandReceipt(String command) {
        if (qaCommandFile == null) return;
        try (OutputStream output = new FileOutputStream(qaCommandFile, false)) {
            String value = "time=" + Instant.now() + "\n"
                + "process=" + android.os.Process.myPid() + "\n"
                + "command=" + String.valueOf(command) + "\n";
            output.write(value.getBytes(StandardCharsets.UTF_8));
            output.flush();
        } catch (Throwable ignored) {}
    }

    private synchronized void checkpoint(String phase, String detail) {
        if (diagnosticFile == null) return;
        try (OutputStream output = new FileOutputStream(diagnosticFile, false)) {
            String value = "time=" + Instant.now() + "\n"
                + "process=" + android.os.Process.myPid() + "\n"
                + "phase=" + String.valueOf(phase) + "\n"
                + "detail=" + String.valueOf(detail) + "\n";
            output.write(value.getBytes(StandardCharsets.UTF_8));
            output.flush();
        } catch (Throwable ignored) {}
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private final class TouchOverlay extends View {
        private static final int CYAN = 0xFF5EE7FF;
        private static final int VIOLET = 0xFF9B7BFF;
        private static final int MAGENTA = 0xFFFF5CB8;
        private static final int LIME = 0xFFB5EF68;
        private static final int AMBER = 0xFFFFC857;
        private static final int GRAPHITE = 0xFF090E16;
        private static final int SURFACE = 0xFF151D29;
        private static final int SURFACE_HIGH = 0xFF253246;
        private static final int WHITE = 0xFFF5F8FF;
        private static final long RIPPLE_DURATION_MS = 520L;
        private static final long TURBO_HALF_PERIOD_MS = 42L;
        private static final int EDIT_NONE = 0;
        private static final int EDIT_DPAD = 1;
        private static final int EDIT_FACE = 2;
        private static final int EDIT_LEFT_STICK = 3;
        private static final int EDIT_RIGHT_STICK = 4;
        private static final int EDIT_LEFT_SHOULDER = 5;
        private static final int EDIT_RIGHT_SHOULDER = 6;
        private static final int EDIT_LEFT_TRIGGER = 7;
        private static final int EDIT_RIGHT_TRIGGER = 8;
        private static final int EDIT_SELECT = 9;
        private static final int EDIT_START = 10;
        private static final int EDIT_TURBO = 11;
        private static final int EDIT_CABINET = 12;
        private static final int EDIT_COUNT = 13;

        private final ConsoleInputProfile.Profile profile = inputProfile;
        private final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint stroke = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint glow = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint label = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.SUBPIXEL_TEXT_FLAG);
        private final Paint smallLabel = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.SUBPIXEL_TEXT_FLAG);
        private final Paint glyph = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint detail = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final boolean[] pressed = new boolean[ConsoleInputProfile.CONTROL_COUNT];
        private final boolean[] outputPressed = new boolean[16];
        private final boolean[] turboEnabled = new boolean[ConsoleInputProfile.CONTROL_COUNT];
        private final float[] pressEnergy = new float[ConsoleInputProfile.CONTROL_COUNT];
        private final float[] axes = new float[4];
        private final float[] outputAxes = new float[4];
        private final String[] coreButtonLabels = new String[16];
        private int playerSlot;
        private final RectF selectRect = new RectF();
        private final RectF startRect = new RectF();
        private final RectF turboRect = new RectF();
        private final RectF cabinetRect = new RectF();
        private final RectF leftShoulderRect = new RectF();
        private final RectF rightShoulderRect = new RectF();
        private final RectF leftTriggerRect = new RectF();
        private final RectF rightTriggerRect = new RectF();
        private final RectF gameRect = new RectF();
        private final RectF deckRect = new RectF();
        private final RectF leftZone = new RectF();
        private final RectF rightZone = new RectF();
        private final RectF layoutLockRect = new RectF();
        private final RectF scratchRect = new RectF();
        private final Path cross = new Path();
        private final Path arrow = new Path();
        private final Path bolt = new Path();
        private final Path clipPath = new Path();
        private final java.util.ArrayList<Ripple> ripples = new java.util.ArrayList<>();
        private final android.util.SparseBooleanArray ignoredPointers = new android.util.SparseBooleanArray();
        private android.graphics.CornerPathEffect crossCorners;

        private float dpadX;
        private float dpadY;
        private float dpadRadius;
        private float actionX;
        private float actionY;
        private float actionRadius;
        private float actionOffset;
        private float leftStickX;
        private float leftStickY;
        private float rightStickX;
        private float rightStickY;
        private float stickRadius;
        private float layoutAspect = 4f / 3f;
        private boolean sideRails;
        private boolean portrait;
        private boolean geometryReady;
        private int systemPanelRightInset;
        private boolean turboArmed;
        private boolean turboPhase = true;
        private boolean turboLoopRunning;
        private long lastAnimationTime;
        private android.content.SharedPreferences layoutPreferences;
        private final float[] customLayoutX = new float[EDIT_COUNT];
        private final float[] customLayoutY = new float[EDIT_COUNT];
        private String customLayoutKey = "";
        private boolean layoutUnlocked;
        private int dragTarget = EDIT_NONE;
        private int dragPointerId = -1;
        private float dragLastX;
        private float dragLastY;
        private boolean ambientSamplePending;
        private long lastAmbientSampleMs;
        private int ambientLeftColor = 0xFF123247;
        private int ambientRightColor = 0xFF2A2148;
        private int ambientTopColor = 0xFF172638;

        private final Runnable turboRunner = new Runnable() {
            @Override
            public void run() {
                turboLoopRunning = false;
                boolean active = false;
                for (int i = 0; i < pressed.length; i++) {
                    if (pressed[i] && turboEnabled[i]) {
                        active = true;
                        break;
                    }
                }
                if (!active || getVisibility() != View.VISIBLE) {
                    turboPhase = true;
                    syncOutputs();
                    return;
                }
                turboPhase = !turboPhase;
                syncOutputs();
                turboLoopRunning = true;
                postDelayed(this, TURBO_HALF_PERIOD_MS);
                postInvalidateOnAnimation();
            }
        };

        private final class Ripple {
            final float x;
            final float y;
            final float baseRadius;
            final int color;
            final long startedAt;

            Ripple(float x, float y, float baseRadius, int color, long startedAt) {
                this.x = x;
                this.y = y;
                this.baseRadius = baseRadius;
                this.color = color;
                this.startedAt = startedAt;
            }
        }

        TouchOverlay(Context context) {
            super(context);
            setWillNotDraw(false);
            setFocusable(false);
            setClickable(true);
            setSoundEffectsEnabled(false);
            setHapticFeedbackEnabled(true);
            layoutPreferences = context.getSharedPreferences("gamedeck-touch-layout-v1", Context.MODE_PRIVATE);
            setContentDescription("GameDeck premium "
                + ConsoleInputProfile.profileLabel(systemId).toLowerCase(java.util.Locale.ROOT));
            setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_YES);

            fill.setStyle(Paint.Style.FILL);
            stroke.setStyle(Paint.Style.STROKE);
            stroke.setStrokeWidth(dp(1));
            stroke.setStrokeCap(Paint.Cap.ROUND);
            stroke.setStrokeJoin(Paint.Join.ROUND);
            glow.setStyle(Paint.Style.FILL);
            detail.setStyle(Paint.Style.STROKE);
            detail.setStrokeCap(Paint.Cap.ROUND);
            detail.setStrokeJoin(Paint.Join.ROUND);

            label.setColor(WHITE);
            label.setTextAlign(Paint.Align.CENTER);
            label.setTypeface(Typeface.create("sans-serif", Typeface.BOLD));
            label.setLetterSpacing(0.02f);

            smallLabel.setColor(0xE8E7EEFA);
            smallLabel.setTextAlign(Paint.Align.CENTER);
            smallLabel.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
            smallLabel.setLetterSpacing(0.08f);

            glyph.setColor(0xE8F2F7FF);
            glyph.setStyle(Paint.Style.FILL);
            crossCorners = new android.graphics.CornerPathEffect(dp(9));
        }

        @Override
        protected void onSizeChanged(int width, int height, int oldWidth, int oldHeight) {
            super.onSizeChanged(width, height, oldWidth, oldHeight);
            geometryReady = false;
            updateGeometry(width, height, currentVideoAspect());
        }

        void refreshVideoGeometry() {
            if (getWidth() <= 0 || getHeight() <= 0) return;
            geometryReady = false;
            updateGeometry(getWidth(), getHeight(), currentVideoAspect());
            invalidate();
        }

        private float currentVideoAspect() {
            float fallback = profile == ConsoleInputProfile.Profile.PSP ? 16f / 9f : 4f / 3f;
            if (!NATIVE_AVAILABLE) return fallback;
            try {
                float aspect = nativeVideoAspect();
                return aspect > 0.5f && aspect < 8f ? aspect : fallback;
            } catch (Throwable ignored) {
                return fallback;
            }
        }

        private void updateGeometry(float width, float height, float aspect) {
            if (width <= 0f || height <= 0f) return;
            layoutAspect = aspect;
            portrait = height > width;

            WindowInsets insets = getRootWindowInsets();
            float safeBottom = insets == null ? 0f : insets.getStableInsetBottom();
            float safeLeft = insets == null ? 0f : insets.getStableInsetLeft();
            float safeRight = insets == null ? 0f : insets.getStableInsetRight();
            float safeTop = insets == null ? 0f : insets.getStableInsetTop();
            float edgeLeft = Math.max(dp(10), safeLeft + dp(8));
            float edgeRight = Math.max(dp(10), safeRight + dp(8));
            float controlBottom = height - Math.max(dp(10), safeBottom + dp(7));

            if (portrait) {
                float deckHeight;
                float deckTop;
                float gameTop;
                float gameBottom;
                if (profile == ConsoleInputProfile.Profile.PSP) {
                    // Portrait PSP is a handheld-first composition: a slim utility strip, then
                    // a full-width 16:9 game surface, then the controller deck. Do not float
                    // the game inside a padded rectangle; the physical screen edges are the
                    // left/right video edges.
                    gameTop = Math.max(safeTop + dp(64), dp(64));
                    float fullWidthGameHeight = width / Math.max(0.5f, aspect);
                    gameBottom = Math.min(controlBottom - dp(300), gameTop + fullWidthGameHeight);
                    if (gameBottom <= gameTop + dp(120)) gameBottom = gameTop + dp(120);
                    gameRect.set(0f, gameTop, width, gameBottom);
                    deckTop = Math.min(controlBottom - dp(280), gameBottom + dp(8));
                    deckTop = Math.max(gameBottom, deckTop);
                    deckHeight = Math.max(dp(280), controlBottom - deckTop);
                } else {
                    deckHeight = profile.hasAnalog()
                        ? clamp(height * 0.405f, dp(315), height * 0.47f)
                        : clamp(height * 0.325f, dp(245), height * 0.39f);
                    deckTop = controlBottom - deckHeight;
                    gameTop = Math.max(safeTop + dp(18), dp(18));
                    gameBottom = Math.max(gameTop + dp(120), deckTop - dp(14));
                    fitGameRect(edgeLeft, gameTop, width - edgeRight, gameBottom, aspect);
                }
                sideRails = false;
                deckRect.set(edgeLeft, deckTop, width - edgeRight, controlBottom);
                leftZone.set(edgeLeft, deckTop, width * 0.49f, controlBottom);
                rightZone.set(width * 0.51f, deckTop, width - edgeRight, controlBottom);
                if (NATIVE_AVAILABLE) {
                    nativeSetViewportInsets(
                        profile == ConsoleInputProfile.Profile.PSP ? 0 : Math.round(edgeLeft * 0.35f),
                        Math.round(gameTop),
                        profile == ConsoleInputProfile.Profile.PSP ? 0 : Math.round(edgeRight * 0.35f),
                        Math.round(height - gameBottom)
                    );
                }
                layoutPortraitControls(width, deckTop, deckHeight, controlBottom, edgeLeft, edgeRight);
            } else {
                float contentRight = Math.max(1f, width - systemPanelRightInset);
                fitGameRect(0f, 0f, contentRight, height, aspect);
                float sideGutter = Math.max(0f, Math.min(gameRect.left, width - gameRect.right));
                sideRails = systemPanelRightInset == 0 && sideGutter >= dp(92);
                if (NATIVE_AVAILABLE) nativeSetViewportInsets(0, 0, systemPanelRightInset, 0);
                if (sideRails) {
                    layoutRailControls(width, height, sideGutter, safeTop, controlBottom, edgeLeft, edgeRight);
                } else {
                    float deckHeight = clamp(height * 0.39f, dp(205), height * 0.48f);
                    float deckTop = controlBottom - deckHeight;
                    deckRect.set(edgeLeft, deckTop, width - edgeRight, controlBottom);
                    leftZone.set(edgeLeft, deckTop, width * 0.49f, controlBottom);
                    rightZone.set(width * 0.51f, deckTop, width - edgeRight, controlBottom);
                    layoutWideBottomControls(width, deckTop, deckHeight, controlBottom, edgeLeft, edgeRight);
                }
            }

            if (!hasSelectControl()) selectRect.setEmpty();
            loadCustomLayoutIfNeeded();
            applyCustomLayoutOffsets(width, height);
            updateLayoutLockRect(width, height, safeTop, safeBottom, controlBottom);
            label.setTextSize(clamp(actionRadius * 0.83f, dp(15), dp(23)));
            smallLabel.setTextSize(clamp(Math.min(width, height) * 0.018f, dp(9), dp(12)));
            crossCorners = new android.graphics.CornerPathEffect(clamp(dpadRadius * 0.12f, dp(7), dp(11)));
            if (profile == ConsoleInputProfile.Profile.PSP) {
                applyGameSurfaceBounds(gameRect);
            } else {
                resetGameSurfaceBounds();
            }
            geometryReady = true;
        }

        private void fitGameRect(float left, float top, float right, float bottom, float aspect) {
            float availableWidth = Math.max(1f, right - left);
            float availableHeight = Math.max(1f, bottom - top);
            float availableAspect = availableWidth / availableHeight;
            float gameWidth;
            float gameHeight;
            if (availableAspect > aspect) {
                gameHeight = availableHeight;
                gameWidth = gameHeight * aspect;
            } else {
                gameWidth = availableWidth;
                gameHeight = gameWidth / aspect;
            }
            gameRect.set(
                left + (availableWidth - gameWidth) * 0.5f,
                top + (availableHeight - gameHeight) * 0.5f,
                left + (availableWidth + gameWidth) * 0.5f,
                top + (availableHeight + gameHeight) * 0.5f
            );
        }

        private void layoutPortraitControls(
                float width, float deckTop, float deckHeight, float controlBottom,
                float edgeLeft, float edgeRight) {
            if (profile == ConsoleInputProfile.Profile.PSP) {
                layoutPspPortraitControls(width, deckTop, deckHeight, controlBottom, edgeLeft, edgeRight);
                return;
            }
            dpadRadius = clamp(Math.min(width * 0.115f, deckHeight * (profile.hasAnalog() ? 0.145f : 0.22f)),
                dp(38), dp(64));
            actionRadius = clamp(dpadRadius * 0.43f, dp(20), dp(31));
            actionOffset = actionRadius * 1.76f;
            dpadX = Math.max(edgeLeft + dpadRadius + dp(7), width * 0.205f);
            actionX = Math.min(width - edgeRight - actionOffset - actionRadius - dp(7), width * 0.795f);
            dpadY = deckTop + deckHeight * (profile.hasAnalog() ? 0.34f : 0.50f);
            actionY = dpadY;

            float shoulderHalfWidth = clamp(width * 0.112f, dp(40), dp(66));
            float shoulderHalfHeight = clamp(deckHeight * 0.035f, dp(9), dp(15));
            float l1Y = deckTop + deckHeight * (profile.hasAnalog() ? 0.155f : 0.145f);
            if (profile.hasShoulders()) {
                setCenteredRect(leftShoulderRect, dpadX, l1Y, shoulderHalfWidth, shoulderHalfHeight);
                setCenteredRect(rightShoulderRect, actionX, l1Y, shoulderHalfWidth, shoulderHalfHeight);
            } else {
                leftShoulderRect.setEmpty();
                rightShoulderRect.setEmpty();
            }

            if (profile.hasTriggers()) {
                float l2Y = deckTop + deckHeight * 0.065f;
                setCenteredRect(leftTriggerRect, dpadX, l2Y, shoulderHalfWidth * 0.92f, shoulderHalfHeight);
                setCenteredRect(rightTriggerRect, actionX, l2Y, shoulderHalfWidth * 0.92f, shoulderHalfHeight);
            } else {
                leftTriggerRect.setEmpty();
                rightTriggerRect.setEmpty();
            }
            if (profile.hasAnalog()) {
                stickRadius = clamp(Math.min(width * 0.093f, deckHeight * 0.105f), dp(31), dp(49));
                leftStickX = width * 0.30f;
                rightStickX = width * 0.70f;
                leftStickY = rightStickY = deckTop + deckHeight * 0.705f;
            } else {
                stickRadius = 0f;
            }

            float pillY = controlBottom - clamp(deckHeight * 0.055f, dp(18), dp(25));
            float pillHalfHeight = clamp(deckHeight * 0.031f, dp(9), dp(13));
            float pillHalfWidth = clamp(width * 0.086f, dp(34), dp(52));
            setCenteredRect(selectRect, width * 0.25f, pillY, pillHalfWidth, pillHalfHeight);
            setCenteredRect(startRect, width * 0.75f, pillY, pillHalfWidth, pillHalfHeight);
            setCenteredRect(turboRect, width * 0.50f, pillY, pillHalfWidth * 1.05f, pillHalfHeight);
            if (profile.cabinetMenu) setCenteredRect(cabinetRect, width * 0.50f,
                pillY - pillHalfHeight * 2.8f, pillHalfWidth * 1.22f, pillHalfHeight);
            else cabinetRect.setEmpty();
        }

        private void layoutPspPortraitControls(
                float width, float deckTop, float deckHeight, float controlBottom,
                float edgeLeft, float edgeRight) {
            dpadRadius = clamp(Math.min(width * 0.135f, deckHeight * 0.165f), dp(43), dp(68));
            actionRadius = clamp(dpadRadius * 0.45f, dp(23), dp(34));
            actionOffset = actionRadius * 1.76f;
            dpadX = Math.max(edgeLeft + dpadRadius + dp(8), width * 0.235f);
            actionX = Math.min(width - edgeRight - actionOffset - actionRadius - dp(8), width * 0.765f);
            dpadY = deckTop + deckHeight * 0.375f;
            actionY = dpadY;

            float shoulderTop = deckTop + deckHeight * 0.060f;
            float shoulderBottom = shoulderTop + clamp(deckHeight * 0.095f, dp(38), dp(54));
            float centerGap = clamp(width * 0.050f, dp(22), dp(34));
            leftShoulderRect.set(edgeLeft + dp(8), shoulderTop, width * 0.50f - centerGap, shoulderBottom);
            rightShoulderRect.set(width * 0.50f + centerGap, shoulderTop, width - edgeRight - dp(8), shoulderBottom);
            leftTriggerRect.setEmpty();
            rightTriggerRect.setEmpty();

            stickRadius = clamp(Math.min(width * 0.100f, deckHeight * 0.115f), dp(34), dp(51));
            leftStickX = Math.max(edgeLeft + stickRadius + dp(8), width * 0.285f);
            leftStickY = deckTop + deckHeight * 0.715f;
            rightStickX = actionX;
            rightStickY = leftStickY;

            float pillHalfWidth = clamp(width * 0.070f, dp(31), dp(47));
            float pillHalfHeight = clamp(deckHeight * 0.032f, dp(9), dp(14));
            float pillY = controlBottom - pillHalfHeight - dp(6);
            float spread = Math.max(dp(54), width * 0.120f);
            setCenteredRect(selectRect, width * 0.50f - spread, pillY, pillHalfWidth, pillHalfHeight);
            setCenteredRect(startRect, width * 0.50f + spread, pillY, pillHalfWidth, pillHalfHeight);
            turboRect.setEmpty();
            cabinetRect.setEmpty();
        }

        private void layoutRailControls(
                float width, float height, float sideGutter, float safeTop, float controlBottom,
                float edgeLeft, float edgeRight) {
            if (profile == ConsoleInputProfile.Profile.PSP) {
                layoutPspRailControls(width, height, sideGutter, safeTop, controlBottom, edgeLeft, edgeRight);
                return;
            }
            float zoneTop = Math.max(safeTop + dp(66), height * 0.18f);
            leftZone.set(edgeLeft, zoneTop, Math.max(edgeLeft + dp(80), sideGutter - dp(10)), controlBottom);
            rightZone.set(Math.min(width - edgeRight - dp(80), width - sideGutter + dp(10)),
                zoneTop, width - edgeRight, controlBottom);
            deckRect.setEmpty();

            dpadRadius = clamp(Math.min(sideGutter * (profile.hasAnalog() ? 0.285f : 0.33f),
                height * (profile.hasAnalog() ? 0.098f : 0.122f)), dp(37), dp(62));
            actionRadius = clamp(Math.min(sideGutter * 0.145f, height * 0.052f), dp(20), dp(31));
            actionOffset = actionRadius * 1.76f;
            dpadX = sideGutter * 0.50f;
            actionX = width - sideGutter * 0.50f;
            dpadY = height * (profile.hasAnalog() ? 0.57f : 0.665f);
            actionY = dpadY;

            float shoulderHalfWidth = clamp(sideGutter * 0.255f, dp(39), dp(69));
            float shoulderHalfHeight = clamp(height * 0.022f, dp(9), dp(15));
            float l1Y = height * (profile.hasAnalog() ? 0.36f : 0.345f);
            if (profile.hasShoulders()) {
                setCenteredRect(leftShoulderRect, dpadX, l1Y, shoulderHalfWidth, shoulderHalfHeight);
                setCenteredRect(rightShoulderRect, actionX, l1Y, shoulderHalfWidth, shoulderHalfHeight);
            } else {
                leftShoulderRect.setEmpty();
                rightShoulderRect.setEmpty();
            }
            if (profile.hasTriggers()) {
                float l2Y = height * 0.285f;
                setCenteredRect(leftTriggerRect, dpadX, l2Y, shoulderHalfWidth * 0.92f, shoulderHalfHeight);
                setCenteredRect(rightTriggerRect, actionX, l2Y, shoulderHalfWidth * 0.92f, shoulderHalfHeight);
            } else {
                leftTriggerRect.setEmpty();
                rightTriggerRect.setEmpty();
            }
            if (profile.hasAnalog()) {
                stickRadius = clamp(Math.min(sideGutter * 0.245f, height * 0.077f), dp(29), dp(44));
                leftStickX = dpadX;
                rightStickX = actionX;
                leftStickY = rightStickY = height * 0.805f;
            } else {
                stickRadius = 0f;
            }

            float pillHalfWidth = clamp(sideGutter * 0.225f, dp(35), dp(58));
            float pillHalfHeight = clamp(height * 0.019f, dp(8), dp(13));
            float pillY = Math.min(controlBottom - pillHalfHeight, height * 0.925f);
            setCenteredRect(selectRect, dpadX, pillY, pillHalfWidth, pillHalfHeight);
            setCenteredRect(startRect, actionX, pillY, pillHalfWidth, pillHalfHeight);
            float turboY = profile.hasAnalog() ? height * 0.455f : height * 0.505f;
            setCenteredRect(turboRect, actionX, turboY, pillHalfWidth * 0.90f, pillHalfHeight);
            if (profile.cabinetMenu) setCenteredRect(cabinetRect, actionX,
                turboY - pillHalfHeight * 2.8f, pillHalfWidth * 1.18f, pillHalfHeight);
            else cabinetRect.setEmpty();
        }


        private void layoutPspRailControls(
                float width, float height, float sideGutter, float safeTop, float controlBottom,
                float edgeLeft, float edgeRight) {
            // PSP is physically asymmetric: D-pad above/right of the nub, face diamond on the
            // opposite rail, and one wide shoulder on each top edge. Preserve that silhouette
            // instead of reusing the generic stacked analog-console rail.
            float zoneTop = Math.max(safeTop + dp(18), height * 0.085f);
            leftZone.set(edgeLeft, zoneTop, Math.max(edgeLeft + dp(92), sideGutter - dp(8)), controlBottom);
            rightZone.set(Math.min(width - edgeRight - dp(92), width - sideGutter + dp(8)),
                zoneTop, width - edgeRight, controlBottom);
            deckRect.setEmpty();

            dpadRadius = clamp(Math.min(sideGutter * 0.34f, height * 0.108f), dp(42), dp(64));
            actionRadius = clamp(Math.min(sideGutter * 0.175f, height * 0.060f), dp(23), dp(34));
            actionOffset = actionRadius * 1.76f;

            dpadX = Math.max(edgeLeft + dpadRadius + dp(6), sideGutter * 0.68f);
            actionX = Math.min(width - edgeRight - actionOffset - actionRadius - dp(6),
                width - sideGutter * 0.50f);
            dpadY = height * 0.765f;
            actionY = height * 0.765f;

            float shoulderHalfWidth = clamp(sideGutter * 0.40f, dp(54), dp(94));
            float shoulderHalfHeight = clamp(height * 0.034f, dp(14), dp(20));
            float shoulderY = Math.max(safeTop + shoulderHalfHeight + dp(7), height * 0.105f);
            float shoulderX = sideGutter * 0.50f;
            setCenteredRect(leftShoulderRect, shoulderX, shoulderY, shoulderHalfWidth, shoulderHalfHeight);
            setCenteredRect(rightShoulderRect, width - shoulderX, shoulderY, shoulderHalfWidth, shoulderHalfHeight);
            leftTriggerRect.setEmpty();
            rightTriggerRect.setEmpty();

            stickRadius = clamp(Math.min(sideGutter * 0.255f, height * 0.082f), dp(31), dp(48));
            leftStickX = Math.max(edgeLeft + stickRadius + dp(4), sideGutter * 0.285f);
            leftStickY = height * 0.855f;
            rightStickX = actionX;
            rightStickY = leftStickY;

            float pillHalfWidth = clamp(sideGutter * 0.145f, dp(25), dp(38));
            float pillHalfHeight = clamp(height * 0.020f, dp(9), dp(13));
            float pillY = Math.min(controlBottom - pillHalfHeight - dp(2), height * 0.935f);
            float pillSpread = Math.max(dp(38), width * 0.035f);
            setCenteredRect(selectRect, width * 0.50f - pillSpread, pillY, pillHalfWidth, pillHalfHeight);
            setCenteredRect(startRect, width * 0.50f + pillSpread, pillY, pillHalfWidth, pillHalfHeight);
            turboRect.setEmpty();
            cabinetRect.setEmpty();
        }

        private void layoutWideBottomControls(
                float width, float deckTop, float deckHeight, float controlBottom,
                float edgeLeft, float edgeRight) {
            dpadRadius = clamp(Math.min(width * 0.075f, deckHeight * 0.205f), dp(36), dp(58));
            actionRadius = clamp(dpadRadius * 0.43f, dp(19), dp(29));
            actionOffset = actionRadius * 1.76f;
            dpadX = Math.max(edgeLeft + dpadRadius + dp(6), width * 0.15f);
            actionX = Math.min(width - edgeRight - actionOffset - actionRadius - dp(6), width * 0.85f);
            dpadY = deckTop + deckHeight * (profile.hasAnalog() ? 0.40f : 0.51f);
            actionY = dpadY;

            float shoulderHalfWidth = clamp(width * 0.075f, dp(38), dp(65));
            float shoulderHalfHeight = clamp(deckHeight * 0.037f, dp(9), dp(14));
            float l1Y = deckTop + deckHeight * 0.14f;
            if (profile.hasShoulders()) {
                setCenteredRect(leftShoulderRect, dpadX, l1Y, shoulderHalfWidth, shoulderHalfHeight);
                setCenteredRect(rightShoulderRect, actionX, l1Y, shoulderHalfWidth, shoulderHalfHeight);
            } else {
                leftShoulderRect.setEmpty();
                rightShoulderRect.setEmpty();
            }
            if (profile.hasTriggers()) {
                setCenteredRect(leftTriggerRect, dpadX, deckTop + deckHeight * 0.055f,
                    shoulderHalfWidth * 0.90f, shoulderHalfHeight);
                setCenteredRect(rightTriggerRect, actionX, deckTop + deckHeight * 0.055f,
                    shoulderHalfWidth * 0.90f, shoulderHalfHeight);
            } else {
                leftTriggerRect.setEmpty();
                rightTriggerRect.setEmpty();
            }
            if (profile.hasAnalog()) {
                stickRadius = clamp(Math.min(width * 0.052f, deckHeight * 0.11f), dp(27), dp(42));
                leftStickX = width * 0.34f;
                rightStickX = width * 0.66f;
                leftStickY = rightStickY = deckTop + deckHeight * 0.69f;
            } else {
                stickRadius = 0f;
            }
            float pillHalfWidth = clamp(width * 0.065f, dp(34), dp(53));
            float pillHalfHeight = clamp(deckHeight * 0.032f, dp(8), dp(12));
            float pillY = controlBottom - pillHalfHeight - dp(4);
            setCenteredRect(selectRect, width * 0.37f, pillY, pillHalfWidth, pillHalfHeight);
            setCenteredRect(startRect, width * 0.63f, pillY, pillHalfWidth, pillHalfHeight);
            setCenteredRect(turboRect, width * 0.50f, pillY, pillHalfWidth * 0.92f, pillHalfHeight);
            if (profile.cabinetMenu) setCenteredRect(cabinetRect, width * 0.50f,
                pillY - pillHalfHeight * 2.8f, pillHalfWidth * 1.18f, pillHalfHeight);
            else cabinetRect.setEmpty();
        }

        private String layoutModeKey() {
            return profile.key + ":" + (portrait ? "portrait" : sideRails ? "rail" : "landscape");
        }

        private String editTargetKey(int target) {
            switch (target) {
                case EDIT_DPAD: return "dpad";
                case EDIT_FACE: return "face";
                case EDIT_LEFT_STICK: return "left-stick";
                case EDIT_RIGHT_STICK: return "right-stick";
                case EDIT_LEFT_SHOULDER: return "left-shoulder";
                case EDIT_RIGHT_SHOULDER: return "right-shoulder";
                case EDIT_LEFT_TRIGGER: return "left-trigger";
                case EDIT_RIGHT_TRIGGER: return "right-trigger";
                case EDIT_SELECT: return "select";
                case EDIT_START: return "start";
                case EDIT_TURBO: return "turbo";
                case EDIT_CABINET: return "cabinet";
                default: return "none";
            }
        }

        private void loadCustomLayoutIfNeeded() {
            String key = layoutModeKey();
            if (key.equals(customLayoutKey)) return;
            customLayoutKey = key;
            java.util.Arrays.fill(customLayoutX, 0f);
            java.util.Arrays.fill(customLayoutY, 0f);
            if (layoutPreferences == null) return;
            for (int target = 1; target < EDIT_COUNT; target++) {
                String base = key + ":" + editTargetKey(target);
                customLayoutX[target] = clamp(layoutPreferences.getFloat(base + ":x", 0f), -maxEditX(target), maxEditX(target));
                customLayoutY[target] = clamp(layoutPreferences.getFloat(base + ":y", 0f), -maxEditY(target), maxEditY(target));
            }
        }

        private void saveCustomLayout(int target) {
            if (layoutPreferences == null || target <= EDIT_NONE || target >= EDIT_COUNT || customLayoutKey.isEmpty()) return;
            String base = customLayoutKey + ":" + editTargetKey(target);
            layoutPreferences.edit()
                .putFloat(base + ":x", customLayoutX[target])
                .putFloat(base + ":y", customLayoutY[target])
                .apply();
        }

        private float maxEditX(int target) {
            if (target == EDIT_LEFT_SHOULDER || target == EDIT_RIGHT_SHOULDER
                    || target == EDIT_LEFT_TRIGGER || target == EDIT_RIGHT_TRIGGER) return 0.18f;
            if (target == EDIT_SELECT || target == EDIT_START || target == EDIT_TURBO || target == EDIT_CABINET) return 0.22f;
            return 0.24f;
        }

        private float maxEditY(int target) {
            if (target == EDIT_LEFT_SHOULDER || target == EDIT_RIGHT_SHOULDER
                    || target == EDIT_LEFT_TRIGGER || target == EDIT_RIGHT_TRIGGER) return 0.14f;
            if (target == EDIT_SELECT || target == EDIT_START || target == EDIT_TURBO || target == EDIT_CABINET) return 0.15f;
            return 0.20f;
        }

        private void applyCustomLayoutOffsets(float width, float height) {
            for (int target = 1; target < EDIT_COUNT; target++) {
                float dx = customLayoutX[target] * width;
                float dy = customLayoutY[target] * height;
                if (Math.abs(dx) > 0.5f || Math.abs(dy) > 0.5f) translateEditGroup(target, dx, dy, false);
            }
        }

        private RectF editGroupBounds(int target) {
            RectF bounds = new RectF();
            switch (target) {
                case EDIT_DPAD: {
                    float radius = dpadRadius * 1.18f;
                    bounds.set(dpadX - radius, dpadY - radius, dpadX + radius, dpadY + radius);
                    break;
                }
                case EDIT_FACE: {
                    float horizontalReach = profile.sixButton() ? actionOffset * 1.35f : actionOffset;
                    float rx = horizontalReach + actionRadius * 1.12f;
                    float ry = actionOffset + actionRadius * 1.12f;
                    bounds.set(actionX - rx, actionY - ry, actionX + rx, actionY + ry);
                    break;
                }
                case EDIT_LEFT_STICK:
                    if (profile.hasAnalog()) bounds.set(leftStickX - stickRadius * 1.28f, leftStickY - stickRadius * 1.28f,
                        leftStickX + stickRadius * 1.28f, leftStickY + stickRadius * 1.28f);
                    break;
                case EDIT_RIGHT_STICK:
                    if (profile.hasRightStick()) bounds.set(rightStickX - stickRadius * 1.28f, rightStickY - stickRadius * 1.28f,
                        rightStickX + stickRadius * 1.28f, rightStickY + stickRadius * 1.28f);
                    break;
                case EDIT_LEFT_SHOULDER: bounds.set(leftShoulderRect); break;
                case EDIT_RIGHT_SHOULDER: bounds.set(rightShoulderRect); break;
                case EDIT_LEFT_TRIGGER: bounds.set(leftTriggerRect); break;
                case EDIT_RIGHT_TRIGGER: bounds.set(rightTriggerRect); break;
                case EDIT_SELECT: bounds.set(selectRect); break;
                case EDIT_START: bounds.set(startRect); break;
                case EDIT_TURBO: bounds.set(turboRect); break;
                case EDIT_CABINET: bounds.set(cabinetRect); break;
                default: break;
            }
            return bounds;
        }

        private float[] translateEditGroup(int target, float requestedDx, float requestedDy, boolean updateOffset) {
            RectF bounds = editGroupBounds(target);
            if (bounds.isEmpty()) return new float[] {0f, 0f};
            float width = Math.max(1f, getWidth());
            float height = Math.max(1f, getHeight());
            float dx = requestedDx;
            float dy = requestedDy;
            if (updateOffset) {
                dx = clamp(dx,
                    (-maxEditX(target) - customLayoutX[target]) * width,
                    ( maxEditX(target) - customLayoutX[target]) * width);
                dy = clamp(dy,
                    (-maxEditY(target) - customLayoutY[target]) * height,
                    ( maxEditY(target) - customLayoutY[target]) * height);
            }
            WindowInsets insets = getRootWindowInsets();
            float safeLeft = (insets == null ? 0f : insets.getStableInsetLeft()) + dp(7);
            float safeRight = width - (insets == null ? 0f : insets.getStableInsetRight()) - dp(7);
            float safeTop = (insets == null ? 0f : insets.getStableInsetTop()) + dp(7);
            float safeBottom = height - (insets == null ? 0f : insets.getStableInsetBottom()) - dp(7);
            dx = clamp(dx, safeLeft - bounds.left, safeRight - bounds.right);
            dy = clamp(dy, safeTop - bounds.top, safeBottom - bounds.bottom);
            if (Math.abs(dx) < 0.01f && Math.abs(dy) < 0.01f) return new float[] {0f, 0f};
            switch (target) {
                case EDIT_DPAD: dpadX += dx; dpadY += dy; break;
                case EDIT_FACE: actionX += dx; actionY += dy; break;
                case EDIT_LEFT_STICK: leftStickX += dx; leftStickY += dy; break;
                case EDIT_RIGHT_STICK: rightStickX += dx; rightStickY += dy; break;
                case EDIT_LEFT_SHOULDER: leftShoulderRect.offset(dx, dy); break;
                case EDIT_RIGHT_SHOULDER: rightShoulderRect.offset(dx, dy); break;
                case EDIT_LEFT_TRIGGER: leftTriggerRect.offset(dx, dy); break;
                case EDIT_RIGHT_TRIGGER: rightTriggerRect.offset(dx, dy); break;
                case EDIT_SELECT: selectRect.offset(dx, dy); break;
                case EDIT_START: startRect.offset(dx, dy); break;
                case EDIT_TURBO: turboRect.offset(dx, dy); break;
                case EDIT_CABINET: cabinetRect.offset(dx, dy); break;
                default: return new float[] {0f, 0f};
            }
            if (updateOffset) {
                customLayoutX[target] = clamp(customLayoutX[target] + dx / width, -maxEditX(target), maxEditX(target));
                customLayoutY[target] = clamp(customLayoutY[target] + dy / height, -maxEditY(target), maxEditY(target));
            }
            return new float[] {dx, dy};
        }

        private int hitEditableGroup(float x, float y) {
            int[] priority = {
                EDIT_LEFT_SHOULDER, EDIT_RIGHT_SHOULDER, EDIT_LEFT_TRIGGER, EDIT_RIGHT_TRIGGER,
                EDIT_SELECT, EDIT_START, EDIT_TURBO, EDIT_CABINET,
                EDIT_LEFT_STICK, EDIT_RIGHT_STICK, EDIT_DPAD, EDIT_FACE
            };
            float expansion = dp(11);
            for (int target : priority) {
                RectF bounds = editGroupBounds(target);
                if (!bounds.isEmpty() && x >= bounds.left - expansion && x <= bounds.right + expansion
                        && y >= bounds.top - expansion && y <= bounds.bottom + expansion) return target;
            }
            return EDIT_NONE;
        }

        private void updateLayoutLockRect(float width, float height, float safeTop, float safeBottom, float controlBottom) {
            float radius = dp(10.5f);
            float cx = width * 0.50f;
            float cy;
            if (profile == ConsoleInputProfile.Profile.PSP && !selectRect.isEmpty() && !startRect.isEmpty()) {
                cy = (selectRect.centerY() + startRect.centerY()) * 0.5f;
            } else if (portrait && !deckRect.isEmpty()) {
                cy = Math.max(safeTop + radius + dp(4), deckRect.top + dp(22));
            } else {
                cy = Math.min(controlBottom - radius - dp(4), height - safeBottom - radius - dp(5));
                if (cy < safeTop + radius + dp(4)) cy = safeTop + radius + dp(4);
            }
            setCenteredRect(layoutLockRect, cx, cy, radius, radius);
        }

        private void drawLayoutLock(Canvas canvas) {
            if (layoutLockRect.isEmpty()) return;
            float cx = layoutLockRect.centerX();
            float cy = layoutLockRect.centerY();
            float radius = layoutLockRect.width() * 0.5f;
            float pulse = layoutUnlocked
                ? 0.5f + 0.5f * (float)Math.sin(android.os.SystemClock.uptimeMillis() / 230.0)
                : 0f;
            int accent = layoutUnlocked ? LIME : CYAN;
            if (layoutUnlocked) {
                glow.setShader(new android.graphics.RadialGradient(cx, cy, radius * 1.85f,
                    new int[] {withAlpha(accent, Math.round(0x52 + 0x28 * pulse)), 0x00000000},
                    null, android.graphics.Shader.TileMode.CLAMP));
                canvas.drawCircle(cx, cy, radius * 1.85f, glow);
                glow.setShader(null);
            }
            fill.setShader(new android.graphics.LinearGradient(layoutLockRect.left, layoutLockRect.top,
                layoutLockRect.right, layoutLockRect.bottom,
                new int[] {0xE4212D3E, 0xE4070C13}, null, android.graphics.Shader.TileMode.CLAMP));
            canvas.drawCircle(cx, cy, radius, fill);
            fill.setShader(null);
            stroke.setColor(withAlpha(accent, layoutUnlocked ? 0xE8 : 0x92));
            stroke.setStrokeWidth(dp(layoutUnlocked ? 1.6f : 1.1f));
            canvas.drawCircle(cx, cy, radius, stroke);

            float bodyW = radius * 0.75f;
            float bodyH = radius * 0.58f;
            scratchRect.set(cx - bodyW * 0.5f, cy - bodyH * 0.05f,
                cx + bodyW * 0.5f, cy + bodyH * 0.80f);
            detail.setStyle(Paint.Style.STROKE);
            detail.setStrokeWidth(dp(1.5f));
            detail.setStrokeCap(Paint.Cap.ROUND);
            detail.setColor(withAlpha(WHITE, 0xE8));
            canvas.drawRoundRect(scratchRect, dp(3), dp(3), detail);
            Path shackle = clipPath;
            shackle.reset();
            float sx = layoutUnlocked ? cx + radius * 0.18f : cx;
            shackle.moveTo(sx - bodyW * 0.30f, cy - bodyH * 0.05f);
            shackle.cubicTo(sx - bodyW * 0.30f, cy - bodyH * 0.72f,
                sx + bodyW * 0.30f, cy - bodyH * 0.72f,
                sx + bodyW * 0.30f, layoutUnlocked ? cy - bodyH * 0.40f : cy - bodyH * 0.05f);
            canvas.drawPath(shackle, detail);
            fill.setShader(null);
            fill.setColor(withAlpha(accent, 0xE8));
            canvas.drawCircle(cx, cy + bodyH * 0.30f, dp(1.5f), fill);
        }

        private void drawEditGuides(Canvas canvas) {
            if (!layoutUnlocked) return;
            detail.setStyle(Paint.Style.STROKE);
            detail.setStrokeWidth(dp(1));
            detail.setPathEffect(new android.graphics.DashPathEffect(new float[] {dp(5), dp(5)}, 0f));
            int alpha = 0x38 + Math.round(0x18 * (0.5f + 0.5f * (float)Math.sin(android.os.SystemClock.uptimeMillis() / 260.0)));
            detail.setColor(withAlpha(CYAN, alpha));
            for (int target = 1; target < EDIT_COUNT; target++) {
                RectF bounds = editGroupBounds(target);
                if (bounds.isEmpty()) continue;
                bounds.inset(-dp(4), -dp(4));
                canvas.drawRoundRect(bounds, dp(9), dp(9), detail);
            }
            detail.setPathEffect(null);
            postInvalidateOnAnimation();
        }

        private void setCenteredRect(RectF target, float cx, float cy, float halfWidth, float halfHeight) {
            target.set(cx - halfWidth, cy - halfHeight, cx + halfWidth, cy + halfHeight);
        }

        @Override
        protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            float aspect = currentVideoAspect();
            if (!geometryReady || Math.abs(aspect - layoutAspect) > 0.015f) {
                updateGeometry(getWidth(), getHeight(), aspect);
            }
            if (!geometryReady) return;

            drawGameAmbient(canvas);
            drawControllerSurface(canvas);
            drawRipples(canvas);
            if (profile.hasTriggers()) {
                drawShoulder(canvas, leftTriggerRect, leftTriggerLabel(), RETRO_L2, CYAN, false);
                drawShoulder(canvas, rightTriggerRect, rightTriggerLabel(), RETRO_R2, VIOLET, true);
            }
            if (profile.hasShoulders()) {
                drawShoulder(canvas, leftShoulderRect, leftShoulderLabel(), leftShoulderButtonId(), CYAN, false);
                drawShoulder(canvas, rightShoulderRect, rightShoulderLabel(), rightShoulderButtonId(), VIOLET, true);
            }
            drawDpad(canvas);
            drawActionCluster(canvas);
            if (profile.hasAnalog()) {
                drawStick(canvas, leftStickX, leftStickY, stickRadius, axes[0], axes[1],
                    profile == ConsoleInputProfile.Profile.PSP ? "" : "L", CYAN,
                    profile == ConsoleInputProfile.Profile.PSP ? -1 : RETRO_L3);
                if (profile.hasRightStick()) {
                    drawStick(canvas, rightStickX, rightStickY, stickRadius, axes[2], axes[3], "R", VIOLET, RETRO_R3);
                }
            }
            if (hasSelectControl()) drawPill(canvas, selectRect, profile.selectLabel, selectControlId(), CYAN);
            drawPill(canvas, startRect, profile.startLabel, RETRO_START, VIOLET);
            drawTurboSwitch(canvas);
            if (profile.cabinetMenu) drawSystemPill(canvas, cabinetRect, "CABINET", AMBER);
            drawEditGuides(canvas);
            drawLayoutLock(canvas);
            advanceAnimation();
        }

        private void drawGameAmbient(Canvas canvas) {
            if (profile != ConsoleInputProfile.Profile.PSP || gameRect.isEmpty()) return;
            requestGameAmbientSample();
            int saved = canvas.save();
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                canvas.clipOutRect(gameRect);
            }
            float glowRadius = Math.max(getWidth(), getHeight()) * 0.72f;
            glow.setShader(new android.graphics.RadialGradient(
                gameRect.left, gameRect.centerY(), glowRadius,
                new int[] {withAlpha(ambientLeftColor, 0x58), withAlpha(ambientLeftColor, 0x18), 0x00000000},
                new float[] {0f, 0.46f, 1f}, android.graphics.Shader.TileMode.CLAMP));
            canvas.drawRect(0, 0, getWidth(), getHeight(), glow);
            glow.setShader(new android.graphics.RadialGradient(
                gameRect.right, gameRect.centerY(), glowRadius,
                new int[] {withAlpha(ambientRightColor, 0x52), withAlpha(ambientRightColor, 0x16), 0x00000000},
                new float[] {0f, 0.46f, 1f}, android.graphics.Shader.TileMode.CLAMP));
            canvas.drawRect(0, 0, getWidth(), getHeight(), glow);
            glow.setShader(new android.graphics.RadialGradient(
                gameRect.centerX(), gameRect.top, glowRadius * 0.72f,
                new int[] {withAlpha(ambientTopColor, 0x36), 0x00000000},
                null, android.graphics.Shader.TileMode.CLAMP));
            canvas.drawRect(0, 0, getWidth(), getHeight(), glow);
            glow.setShader(null);
            canvas.restoreToCount(saved);
        }

        private void requestGameAmbientSample() {
            long now = android.os.SystemClock.uptimeMillis();
            if (ambientSamplePending || qaScreenshotInProgress.get()
                    || now - lastAmbientSampleMs < 720L || surfaceView == null) return;
            Surface surface = surfaceView.getHolder().getSurface();
            if (surface == null || !surface.isValid() || !surfaceView.isShown()) return;
            ambientSamplePending = true;
            lastAmbientSampleMs = now;
            Bitmap sample = Bitmap.createBitmap(12, 8, Bitmap.Config.ARGB_8888);
            AtomicBoolean completed = new AtomicBoolean(false);
            Runnable timeout = () -> {
                if (!completed.compareAndSet(false, true)) return;
                ambientSamplePending = false;
                if (!sample.isRecycled()) sample.recycle();
            };
            postDelayed(timeout, 520L);
            try {
                PixelCopy.request(surface, sample, result -> {
                    if (!completed.compareAndSet(false, true)) return;
                    removeCallbacks(timeout);
                    ambientSamplePending = false;
                    if (result == PixelCopy.SUCCESS) {
                        ambientLeftColor = sampleAmbientColor(sample, 0, 0, 6, 8, ambientLeftColor);
                        ambientRightColor = sampleAmbientColor(sample, 6, 0, 12, 8, ambientRightColor);
                        ambientTopColor = sampleAmbientColor(sample, 2, 0, 10, 4, ambientTopColor);
                        postInvalidateOnAnimation();
                    }
                    sample.recycle();
                }, new Handler(Looper.getMainLooper()));
            } catch (Throwable error) {
                removeCallbacks(timeout);
                completed.set(true);
                ambientSamplePending = false;
                sample.recycle();
            }
        }

        private int sampleAmbientColor(Bitmap sample, int left, int top, int right, int bottom, int fallback) {
            long red = 0, green = 0, blue = 0, weight = 0;
            for (int y = top; y < bottom; y++) {
                for (int x = left; x < right; x++) {
                    int color = sample.getPixel(x, y);
                    int r = Color.red(color);
                    int g = Color.green(color);
                    int b = Color.blue(color);
                    int brightness = Math.max(r, Math.max(g, b));
                    if (brightness < 10) continue;
                    int w = 1 + brightness / 48;
                    red += (long)r * w;
                    green += (long)g * w;
                    blue += (long)b * w;
                    weight += w;
                }
            }
            if (weight <= 0) return fallback;
            int r = (int)(red / weight);
            int g = (int)(green / weight);
            int b = (int)(blue / weight);
            int max = Math.max(r, Math.max(g, b));
            if (max < 54) {
                float scale = 54f / Math.max(1, max);
                r = Math.min(150, Math.round(r * scale));
                g = Math.min(150, Math.round(g * scale));
                b = Math.min(150, Math.round(b * scale));
            }
            int luma = (r * 54 + g * 183 + b * 19) >> 8;
            r = clampColor(luma + Math.round((r - luma) * 1.22f));
            g = clampColor(luma + Math.round((g - luma) * 1.22f));
            b = clampColor(luma + Math.round((b - luma) * 1.22f));
            return Color.rgb(r, g, b);
        }

        private int clampColor(int value) {
            return Math.max(0, Math.min(255, value));
        }

        private void drawControllerSurface(Canvas canvas) {
            if (sideRails) {
                drawGlassPanel(canvas, leftZone, CYAN, false);
                drawGlassPanel(canvas, rightZone, VIOLET, true);
                drawAmbientWell(canvas, dpadX, dpadY, dpadRadius * 1.42f, CYAN);
                drawAmbientWell(canvas, actionX, actionY, actionOffset + actionRadius + dp(18), VIOLET);
                if (profile.hasAnalog()) {
                    drawAmbientWell(canvas, leftStickX, leftStickY, stickRadius * 1.42f, CYAN);
                    if (profile.hasRightStick()) drawAmbientWell(canvas, rightStickX, rightStickY, stickRadius * 1.42f, VIOLET);
                }
            } else {
                float radius = clamp(deckRect.height() * 0.12f, dp(24), dp(42));
                fill.setShader(new android.graphics.LinearGradient(
                    deckRect.left, deckRect.top, deckRect.left, deckRect.bottom,
                    new int[] { 0x16101B28, 0xA10A1019, 0xE3090D14 },
                    new float[] { 0f, 0.28f, 1f }, android.graphics.Shader.TileMode.CLAMP));
                canvas.drawRoundRect(deckRect, radius, radius, fill);
                fill.setShader(null);

                stroke.setShader(new android.graphics.LinearGradient(
                    deckRect.left, deckRect.top, deckRect.right, deckRect.top,
                    new int[] { 0x005EE7FF, 0xA85EE7FF, 0x809B7BFF, 0x009B7BFF },
                    null, android.graphics.Shader.TileMode.CLAMP));
                stroke.setStrokeWidth(dp(1));
                canvas.drawLine(deckRect.left + radius, deckRect.top, deckRect.right - radius, deckRect.top, stroke);
                stroke.setShader(null);

                drawAmbientWell(canvas, dpadX, dpadY, dpadRadius * 1.44f, CYAN);
                drawAmbientWell(canvas, actionX, actionY, actionOffset + actionRadius + dp(20), VIOLET);
                if (profile.hasAnalog()) {
                    drawAmbientWell(canvas, leftStickX, leftStickY, stickRadius * 1.44f, CYAN);
                    if (profile.hasRightStick()) drawAmbientWell(canvas, rightStickX, rightStickY, stickRadius * 1.44f, VIOLET);
                }
            }
        }

        private void drawGlassPanel(Canvas canvas, RectF rect, int accent, boolean mirror) {
            float radius = clamp(rect.width() * 0.16f, dp(22), dp(36));
            fill.setShader(new android.graphics.LinearGradient(
                mirror ? rect.right : rect.left, rect.top,
                mirror ? rect.left : rect.right, rect.bottom,
                new int[] { 0xB50A1019, 0x77121A27, 0x32101A28 },
                new float[] { 0f, 0.55f, 1f }, android.graphics.Shader.TileMode.CLAMP));
            canvas.drawRoundRect(rect, radius, radius, fill);
            fill.setShader(null);

            stroke.setColor(withAlpha(accent, 0x46));
            stroke.setStrokeWidth(dp(1));
            canvas.drawRoundRect(rect, radius, radius, stroke);
            scratchRect.set(rect);
            scratchRect.inset(dp(7), dp(7));
            stroke.setColor(0x18FFFFFF);
            canvas.drawRoundRect(scratchRect, Math.max(0f, radius - dp(7)), Math.max(0f, radius - dp(7)), stroke);

            float innerX = mirror ? rect.right - dp(10) : rect.left + dp(10);
            stroke.setShader(new android.graphics.LinearGradient(
                innerX, rect.top + radius, innerX, rect.bottom - radius,
                new int[] { 0x00FFFFFF, withAlpha(accent, 0x72), 0x00FFFFFF },
                null, android.graphics.Shader.TileMode.CLAMP));
            stroke.setStrokeWidth(dp(1));
            canvas.drawLine(innerX, rect.top + radius, innerX, rect.bottom - radius, stroke);
            stroke.setShader(null);
        }

        private void drawAmbientWell(Canvas canvas, float cx, float cy, float radius, int accent) {
            glow.setShader(new android.graphics.RadialGradient(
                cx, cy, radius,
                new int[] { withAlpha(accent, 0x1C), 0x48121B28, 0x17101824, 0x00000000 },
                new float[] { 0f, 0.48f, 0.76f, 1f }, android.graphics.Shader.TileMode.CLAMP));
            canvas.drawCircle(cx, cy, radius, glow);
            glow.setShader(null);
            stroke.setColor(withAlpha(accent, 0x22));
            stroke.setStrokeWidth(dp(1));
            canvas.drawCircle(cx, cy, radius * 0.76f, stroke);
        }

        private void drawRipples(Canvas canvas) {
            long now = android.os.SystemClock.uptimeMillis();
            for (int i = ripples.size() - 1; i >= 0; i--) {
                Ripple ripple = ripples.get(i);
                float progress = (now - ripple.startedAt) / (float)RIPPLE_DURATION_MS;
                if (progress >= 1f) {
                    ripples.remove(i);
                    continue;
                }
                float eased = 1f - (1f - progress) * (1f - progress);
                float radius = ripple.baseRadius * (0.55f + eased * 2.85f);
                float alpha = (1f - progress) * (1f - progress);
                canvas.save();
                if (!sideRails && !deckRect.isEmpty()) {
                    clipPath.reset();
                    clipPath.addRoundRect(deckRect, dp(28), dp(28), Path.Direction.CW);
                    canvas.clipPath(clipPath);
                } else if (sideRails) {
                    RectF zone = ripple.x < getWidth() * 0.5f ? leftZone : rightZone;
                    clipPath.reset();
                    clipPath.addRoundRect(zone, dp(28), dp(28), Path.Direction.CW);
                    canvas.clipPath(clipPath);
                }
                glow.setShader(new android.graphics.RadialGradient(
                    ripple.x, ripple.y, radius,
                    new int[] { withAlpha(ripple.color, Math.round(0x32 * alpha)),
                        withAlpha(ripple.color, Math.round(0x12 * alpha)), 0x00000000 },
                    new float[] { 0f, 0.62f, 1f }, android.graphics.Shader.TileMode.CLAMP));
                canvas.drawCircle(ripple.x, ripple.y, radius, glow);
                glow.setShader(null);
                stroke.setColor(withAlpha(ripple.color, Math.round(0xD0 * alpha)));
                stroke.setStrokeWidth(dp(1.4f + 1.4f * (1f - progress)));
                canvas.drawCircle(ripple.x, ripple.y, radius * 0.78f, stroke);
                stroke.setColor(withAlpha(WHITE, Math.round(0x62 * alpha)));
                stroke.setStrokeWidth(dp(0.8f));
                canvas.drawCircle(ripple.x, ripple.y, radius * 0.54f, stroke);
                canvas.restore();
            }
        }

        void qaPulseControls() {
            if (!isDebugBuild() || !geometryReady) return;
            for (ConsoleInputProfile.FaceButton button : profile.faceButtons) {
                float[] center = faceCenter(button);
                pressEnergy[button.id] = 1f;
                addRipple(center[0], center[1], actionRadius * button.scale, controlAccent(button.id));
            }
            if (profile.hasShoulders()) {
                pressEnergy[leftShoulderButtonId()] = 1f;
                pressEnergy[rightShoulderButtonId()] = 1f;
                addRipple(leftShoulderRect.centerX(), leftShoulderRect.centerY(), shoulderPulseRadius(leftShoulderRect), CYAN);
                addRipple(rightShoulderRect.centerX(), rightShoulderRect.centerY(), shoulderPulseRadius(rightShoulderRect), VIOLET);
            }
            postInvalidateOnAnimation();
        }

        private float shoulderPulseRadius(RectF rect) {
            if (rect == null || rect.isEmpty()) return dp(18);
            return Math.max(rect.height() * 1.15f, rect.width() * 0.26f);
        }

        private void addRipple(float x, float y, float baseRadius, int color) {
            if (ripples.size() >= 10) ripples.remove(0);
            ripples.add(new Ripple(x, y, Math.max(baseRadius, dp(18)), color,
                android.os.SystemClock.uptimeMillis()));
            postInvalidateOnAnimation();
        }

        private void drawDpad(Canvas canvas) {
            float reach = dpadRadius * 0.91f;
            float arm = dpadRadius * 0.39f;
            float plateRadius = dpadRadius * 1.10f;

            glow.setShader(new android.graphics.RadialGradient(
                dpadX, dpadY, plateRadius,
                new int[] { 0x33192435, 0x63101825, 0x22070B12, 0x00000000 },
                new float[] { 0f, 0.55f, 0.84f, 1f }, android.graphics.Shader.TileMode.CLAMP));
            canvas.drawCircle(dpadX, dpadY, plateRadius, glow);
            glow.setShader(null);
            stroke.setColor(0x3D8FA7C8);
            stroke.setStrokeWidth(dp(1));
            canvas.drawCircle(dpadX, dpadY, plateRadius * 0.89f, stroke);

            buildCrossPath(reach, arm);
            canvas.save();
            canvas.translate(dpadX, dpadY + dp(4));
            fill.setShader(null);
            fill.setColor(0xA8000000);
            fill.setPathEffect(crossCorners);
            canvas.drawPath(cross, fill);
            fill.setPathEffect(null);
            canvas.restore();

            canvas.save();
            canvas.translate(dpadX, dpadY);
            fill.setShader(new android.graphics.LinearGradient(
                -reach, -reach, reach, reach,
                new int[] { 0xF2263346, 0xED121A28, 0xF0080D15 },
                new float[] { 0f, 0.52f, 1f }, android.graphics.Shader.TileMode.CLAMP));
            fill.setPathEffect(crossCorners);
            canvas.drawPath(cross, fill);
            fill.setPathEffect(null);
            fill.setShader(null);
            stroke.setPathEffect(crossCorners);
            stroke.setColor(0xA6788CAA);
            stroke.setStrokeWidth(dp(1));
            canvas.drawPath(cross, stroke);
            stroke.setPathEffect(null);
            canvas.restore();

            drawDirection(canvas, RETRO_UP, dpadX, dpadY - dpadRadius * 0.62f, 0f);
            drawDirection(canvas, RETRO_RIGHT, dpadX + dpadRadius * 0.62f, dpadY, 90f);
            drawDirection(canvas, RETRO_DOWN, dpadX, dpadY + dpadRadius * 0.62f, 180f);
            drawDirection(canvas, RETRO_LEFT, dpadX - dpadRadius * 0.62f, dpadY, 270f);

            float centerRadius = dpadRadius * 0.285f;
            glow.setShader(new android.graphics.RadialGradient(
                dpadX - centerRadius * 0.28f, dpadY - centerRadius * 0.34f, centerRadius * 1.45f,
                new int[] { 0xA32A3A50, 0xF00C121D, 0xFF070B12 },
                new float[] { 0f, 0.55f, 1f }, android.graphics.Shader.TileMode.CLAMP));
            canvas.drawCircle(dpadX, dpadY, centerRadius, glow);
            glow.setShader(null);
            stroke.setColor(0x6A7D94B5);
            canvas.drawCircle(dpadX, dpadY, centerRadius, stroke);

            for (int id : new int[] {RETRO_UP, RETRO_RIGHT, RETRO_DOWN, RETRO_LEFT}) {
                if (turboEnabled[id]) {
                    float[] center = controlCenter(id);
                    drawTurboOrbit(canvas, center[0], center[1], dpadRadius * 0.29f, CYAN);
                }
            }
        }

        private void buildCrossPath(float reach, float arm) {
            cross.reset();
            cross.moveTo(-arm, -reach);
            cross.lineTo(arm, -reach);
            cross.lineTo(arm, -arm);
            cross.lineTo(reach, -arm);
            cross.lineTo(reach, arm);
            cross.lineTo(arm, arm);
            cross.lineTo(arm, reach);
            cross.lineTo(-arm, reach);
            cross.lineTo(-arm, arm);
            cross.lineTo(-reach, arm);
            cross.lineTo(-reach, -arm);
            cross.lineTo(-arm, -arm);
            cross.close();
        }

        private void drawDirection(Canvas canvas, int id, float cx, float cy, float rotation) {
            float activation = activation(id);
            if (activation > 0f) {
                float haloRadius = dpadRadius * (0.29f + activation * 0.05f);
                glow.setShader(new android.graphics.RadialGradient(
                    cx, cy, haloRadius * 1.55f,
                    new int[] { withAlpha(CYAN, Math.round(0x9A * activation)),
                        withAlpha(CYAN, Math.round(0x32 * activation)), 0x00000000 },
                    new float[] { 0f, 0.55f, 1f }, android.graphics.Shader.TileMode.CLAMP));
                canvas.drawCircle(cx, cy, haloRadius * 1.55f, glow);
                glow.setShader(null);
            }
            float size = dpadRadius * 0.145f;
            arrow.reset();
            arrow.moveTo(0f, -size);
            arrow.lineTo(size * 0.82f, size * 0.68f);
            arrow.lineTo(-size * 0.82f, size * 0.68f);
            arrow.close();
            canvas.save();
            canvas.translate(cx, cy + dp(1) * activation);
            canvas.rotate(rotation);
            glyph.setColor(blend(0xDDE8F0FF, WHITE, activation));
            canvas.drawPath(arrow, glyph);
            canvas.restore();
        }

        private void drawActionCluster(Canvas canvas) {
            float horizontalReach = profile.sixButton() ? actionOffset * 1.35f : actionOffset;
            float clusterRadius = horizontalReach + actionRadius + dp(12);
            glow.setShader(new android.graphics.RadialGradient(
                actionX, actionY, clusterRadius,
                new int[] { 0x4D172033, 0x54101825, 0x16070B12, 0x00000000 },
                new float[] { 0f, 0.56f, 0.84f, 1f }, android.graphics.Shader.TileMode.CLAMP));
            canvas.drawCircle(actionX, actionY, clusterRadius, glow);
            glow.setShader(null);
            stroke.setColor(0x309B7BFF);
            stroke.setStrokeWidth(dp(1));
            canvas.drawCircle(actionX, actionY, clusterRadius * 0.80f, stroke);

            int index = 0;
            for (ConsoleInputProfile.FaceButton button : profile.faceButtons) {
                float[] center = faceCenter(button);
                drawActionButton(canvas, center[0], center[1], effectiveFaceLabel(button), button.id,
                    faceAccent(index++, button.id), actionRadius * button.scale);
            }
        }

        void setCoreInputDescriptors(String raw) {
            java.util.Arrays.fill(coreButtonLabels, null);
            if (raw != null && !raw.isEmpty()) {
                for (String line : raw.split("\n")) {
                    String[] parts = line.split("\t", 5);
                    if (parts.length < 5) continue;
                    try {
                        int port = Integer.parseInt(parts[0]);
                        int device = Integer.parseInt(parts[1]);
                        int index = Integer.parseInt(parts[2]);
                        int id = Integer.parseInt(parts[3]);
                        if (port == 0 && device == 1 && index == 0 && id >= 0 && id < coreButtonLabels.length) {
                            coreButtonLabels[id] = compactCoreLabel(parts[4]);
                        }
                    } catch (NumberFormatException ignored) {}
                }
            }
            if (profile.arcade) {
                int named = 0;
                for (String label : coreButtonLabels) if (label != null && !label.isEmpty()) named++;
                setContentDescription("GameDeck premium " + profile.label.toLowerCase(Locale.ROOT)
                    + ", " + named + " game-specific controls mapped");
            }
            invalidate();
        }

        private String effectiveFaceLabel(ConsoleInputProfile.FaceButton button) {
            if (profile.arcade && button.id >= 0 && button.id < coreButtonLabels.length) {
                String mapped = coreButtonLabels[button.id];
                if (mapped != null && !mapped.isEmpty()) return mapped;
            }
            return button.label;
        }

        private String compactCoreLabel(String value) {
            if (value == null) return null;
            String cleaned = value.trim()
                .replaceFirst("(?i)^player\s*1\s*", "")
                .replaceFirst("(?i)^p1\s*", "")
                .replaceFirst("(?i)^button\s*", "");
            if (cleaned.isEmpty()) return null;
            if (cleaned.length() <= 6) return cleaned.toUpperCase(Locale.ROOT);
            String[] words = cleaned.split("[^A-Za-z0-9]+", -1);
            StringBuilder acronym = new StringBuilder();
            for (String word : words) {
                if (!word.isEmpty()) acronym.append(Character.toUpperCase(word.charAt(0)));
            }
            if (acronym.length() >= 2 && acronym.length() <= 5) return acronym.toString();
            return cleaned.substring(0, Math.min(6, cleaned.length())).toUpperCase(Locale.ROOT);
        }

        private float[] faceCenter(ConsoleInputProfile.FaceButton button) {
            float xScale = profile.sixButton() ? actionOffset * 1.15f : actionOffset;
            return new float[] { actionX + button.x * xScale, actionY + button.y * actionOffset };
        }

        private int faceAccent(int index, int id) {
            int[] colors = {VIOLET, CYAN, MAGENTA, LIME, CYAN, VIOLET};
            if (profile == ConsoleInputProfile.Profile.PLAYSTATION || profile == ConsoleInputProfile.Profile.PSP) {
                if (id == RETRO_X) return LIME;
                if (id == RETRO_A) return MAGENTA;
                if (id == RETRO_B) return CYAN;
                if (id == RETRO_Y) return VIOLET;
            }
            return colors[index % colors.length];
        }

        private void drawActionButton(Canvas canvas, float cx, float cy, String text, int id, int accent,
                                      float visualRadius) {
            float activation = activation(id);
            float shift = dp(2.4f) * activation;
            float radius = visualRadius * (1f - activation * 0.065f);
            float drawY = cy + shift;

            fill.setShader(null);
            fill.setColor(0xB5000000);
            canvas.drawCircle(cx, drawY + dp(4), radius * 1.02f, fill);

            if (activation > 0f) {
                glow.setShader(new android.graphics.RadialGradient(
                    cx, drawY, radius * 1.65f,
                    new int[] { withAlpha(accent, Math.round(0xA8 * activation)),
                        withAlpha(accent, Math.round(0x42 * activation)), 0x00000000 },
                    new float[] { 0f, 0.56f, 1f }, android.graphics.Shader.TileMode.CLAMP));
                canvas.drawCircle(cx, drawY, radius * 1.65f, glow);
                glow.setShader(null);
            }

            fill.setShader(new android.graphics.RadialGradient(
                cx - radius * 0.28f, drawY - radius * 0.34f, radius * 1.55f,
                new int[] {
                    blend(0xFF33445D, accent, activation * 0.68f),
                    blend(SURFACE, accent, activation * 0.80f),
                    blend(GRAPHITE, accent, activation * 0.58f)
                },
                new float[] { 0f, 0.58f, 1f }, android.graphics.Shader.TileMode.CLAMP));
            canvas.drawCircle(cx, drawY, radius, fill);
            fill.setShader(null);

            stroke.setColor(blend(withAlpha(accent, 0xC2), WHITE, activation * 0.80f));
            stroke.setStrokeWidth(dp(activation > 0.01f ? 1.6f : 1f));
            canvas.drawCircle(cx, drawY, radius, stroke);
            stroke.setColor(0x24FFFFFF);
            stroke.setStrokeWidth(dp(1));
            canvas.drawCircle(cx, drawY, radius * 0.78f, stroke);

            detail.setColor(0x38FFFFFF);
            detail.setStrokeWidth(dp(1));
            scratchRect.set(cx - radius * 0.62f, drawY - radius * 0.62f,
                cx + radius * 0.62f, drawY + radius * 0.62f);
            canvas.drawArc(scratchRect, 207f, 126f, false, detail);

            label.setTextSize(clamp(radius * (text.length() > 2 ? 0.48f : 0.83f), dp(9), dp(23)));
            label.setColor(blend(WHITE, 0xFF071019, activation * 0.88f));
            drawCenteredText(canvas, text, cx, drawY, label);
            if (turboEnabled[id]) drawTurboOrbit(canvas, cx, cy, radius * 1.19f, accent);
        }

        private boolean hasSelectControl() {
            return profile.selectLabel != null && !profile.selectLabel.trim().isEmpty();
        }

        private int selectControlId() {
            if (profile == ConsoleInputProfile.Profile.N64) return RETRO_L2;
            if (profile == ConsoleInputProfile.Profile.GAMECUBE) return RETRO_R;
            return RETRO_SELECT;
        }

        private boolean shouldersUseSecondPair() {
            return profile == ConsoleInputProfile.Profile.SATURN;
        }

        private int leftShoulderButtonId() {
            if (profile == ConsoleInputProfile.Profile.GAMECUBE) return RETRO_L3;
            return shouldersUseSecondPair() ? RETRO_L2 : RETRO_L;
        }

        private int rightShoulderButtonId() {
            if (profile == ConsoleInputProfile.Profile.GAMECUBE) return RETRO_R3;
            return shouldersUseSecondPair() ? RETRO_R2 : RETRO_R;
        }

        private String leftShoulderLabel() {
            if (profile == ConsoleInputProfile.Profile.SATURN || profile == ConsoleInputProfile.Profile.N64
                    || profile == ConsoleInputProfile.Profile.PSP) return "L";
            if (profile == ConsoleInputProfile.Profile.GAMECUBE) return "L½";
            if (profile == ConsoleInputProfile.Profile.DREAMCAST) return "L FULL";
            if (profile == ConsoleInputProfile.Profile.WII) return "ZL";
            return "L1";
        }

        private String rightShoulderLabel() {
            if (profile == ConsoleInputProfile.Profile.SATURN || profile == ConsoleInputProfile.Profile.N64
                    || profile == ConsoleInputProfile.Profile.PSP) return "R";
            if (profile == ConsoleInputProfile.Profile.GAMECUBE) return "R½";
            if (profile == ConsoleInputProfile.Profile.DREAMCAST) return "R FULL";
            if (profile == ConsoleInputProfile.Profile.WII) return "ZR";
            return "R1";
        }

        private String leftTriggerLabel() {
            if (profile == ConsoleInputProfile.Profile.GAMECUBE || profile == ConsoleInputProfile.Profile.WII) return "L";
            if (profile == ConsoleInputProfile.Profile.DREAMCAST) return "L HALF";
            return "L2";
        }

        private String rightTriggerLabel() {
            if (profile == ConsoleInputProfile.Profile.GAMECUBE || profile == ConsoleInputProfile.Profile.WII) return "R";
            if (profile == ConsoleInputProfile.Profile.DREAMCAST) return "R HALF";
            return "R2";
        }

        private boolean isN64CControl(int id) {
            return id >= ConsoleInputProfile.N64_C_UP && id <= ConsoleInputProfile.N64_C_LEFT;
        }

        private void applyN64CControl(int id, float[] nextAxes) {
            switch (id) {
                case ConsoleInputProfile.N64_C_UP: nextAxes[3] = -1f; break;
                case ConsoleInputProfile.N64_C_RIGHT: nextAxes[2] = 1f; break;
                case ConsoleInputProfile.N64_C_DOWN: nextAxes[3] = 1f; break;
                case ConsoleInputProfile.N64_C_LEFT: nextAxes[2] = -1f; break;
                default: break;
            }
        }

        private void drawShoulder(Canvas canvas, RectF rect, String text, int id, int accent, boolean mirror) {
            if (rect.isEmpty()) return;
            float activation = activation(id);
            float shift = dp(2) * activation;
            scratchRect.set(rect);
            scratchRect.offset(0f, shift);
            float radius = scratchRect.height() * 0.50f;

            RectF shadowRect = new RectF(scratchRect);
            shadowRect.offset(0f, dp(3));
            fill.setShader(null);
            fill.setColor(0xA8000000);
            canvas.drawRoundRect(shadowRect, radius, radius, fill);

            if (activation > 0f) {
                RectF halo = new RectF(scratchRect);
                halo.inset(-dp(7), -dp(6));
                glow.setShader(new android.graphics.LinearGradient(
                    halo.left, halo.centerY(), halo.right, halo.centerY(),
                    new int[] { 0x00000000, withAlpha(accent, Math.round(0x92 * activation)), 0x00000000 },
                    null, android.graphics.Shader.TileMode.CLAMP));
                canvas.drawRoundRect(halo, halo.height() * 0.5f, halo.height() * 0.5f, glow);
                glow.setShader(null);
            }

            fill.setShader(new android.graphics.LinearGradient(
                scratchRect.left, scratchRect.top, scratchRect.right, scratchRect.bottom,
                mirror
                    ? new int[] { blend(SURFACE_HIGH, accent, activation * 0.58f), blend(GRAPHITE, accent, activation * 0.75f) }
                    : new int[] { blend(GRAPHITE, accent, activation * 0.75f), blend(SURFACE_HIGH, accent, activation * 0.58f) },
                null, android.graphics.Shader.TileMode.CLAMP));
            canvas.drawRoundRect(scratchRect, radius, radius, fill);
            fill.setShader(null);
            stroke.setColor(blend(withAlpha(accent, 0xA4), WHITE, activation * 0.72f));
            stroke.setStrokeWidth(dp(activation > 0.01f ? 1.5f : 1f));
            canvas.drawRoundRect(scratchRect, radius, radius, stroke);

            detail.setColor(0x33FFFFFF);
            detail.setStrokeWidth(dp(1));
            canvas.drawLine(scratchRect.left + radius * 0.8f, scratchRect.top + dp(4),
                scratchRect.right - radius * 0.8f, scratchRect.top + dp(4), detail);

            smallLabel.setColor(blend(0xFFF0F5FF, 0xFF071019, activation * 0.82f));
            drawCenteredText(canvas, text, scratchRect.centerX(), scratchRect.centerY(), smallLabel);
            if (turboEnabled[id]) drawTurboOrbit(canvas, rect.centerX(), rect.centerY(), rect.height() * 0.72f, accent);
        }

        private void drawStick(
                Canvas canvas, float cx, float cy, float radius, float axisX, float axisY,
                String text, int accent, int clickId) {
            float distance = (float)Math.sqrt(axisX * axisX + axisY * axisY);
            float shiftX = axisX * radius * 0.42f;
            float shiftY = axisY * radius * 0.42f;

            glow.setShader(new android.graphics.RadialGradient(
                cx, cy, radius * 1.42f,
                new int[] { withAlpha(accent, distance > 0.02f ? 0x38 : 0x18), 0x35121B28, 0x00000000 },
                new float[] { 0f, 0.60f, 1f }, android.graphics.Shader.TileMode.CLAMP));
            canvas.drawCircle(cx, cy, radius * 1.42f, glow);
            glow.setShader(null);

            fill.setShader(new android.graphics.RadialGradient(
                cx - radius * 0.25f, cy - radius * 0.28f, radius * 1.45f,
                new int[] { 0xF22C3A50, 0xF1121A27, 0xFF070B12 },
                new float[] { 0f, 0.58f, 1f }, android.graphics.Shader.TileMode.CLAMP));
            canvas.drawCircle(cx, cy, radius, fill);
            fill.setShader(null);
            stroke.setColor(withAlpha(accent, 0x76));
            stroke.setStrokeWidth(dp(1.1f));
            canvas.drawCircle(cx, cy, radius, stroke);
            stroke.setColor(0x237F94B5);
            canvas.drawCircle(cx, cy, radius * 0.72f, stroke);

            float knobRadius = radius * 0.54f;
            float knobX = cx + shiftX;
            float knobY = cy + shiftY;
            fill.setShader(new android.graphics.RadialGradient(
                knobX - knobRadius * 0.28f, knobY - knobRadius * 0.32f, knobRadius * 1.35f,
                new int[] { blend(0xFF3C4D68, accent, distance * 0.40f),
                    blend(0xFF172130, accent, distance * 0.28f), 0xFF080D15 },
                new float[] { 0f, 0.60f, 1f }, android.graphics.Shader.TileMode.CLAMP));
            canvas.drawCircle(knobX, knobY, knobRadius, fill);
            fill.setShader(null);
            stroke.setColor(blend(0x8A8FA6C6, accent, distance * 0.60f));
            stroke.setStrokeWidth(dp(1));
            canvas.drawCircle(knobX, knobY, knobRadius, stroke);

            detail.setColor(0x28FFFFFF);
            detail.setStrokeWidth(dp(1));
            for (int i = 0; i < 3; i++) {
                float ring = knobRadius * (0.36f + i * 0.18f);
                canvas.drawCircle(knobX, knobY, ring, detail);
            }
            smallLabel.setColor(0xAEEAF2FF);
            if (clickId >= 0) {
                drawCenteredText(canvas, text + "3", knobX, knobY, smallLabel);
                if (clickId < turboEnabled.length && turboEnabled[clickId])
                    drawTurboOrbit(canvas, cx, cy, radius * 1.12f, accent);
            } else {
                detail.setStyle(Paint.Style.STROKE);
                detail.setStrokeWidth(dp(1));
                detail.setColor(withAlpha(accent, 0x72));
                canvas.drawCircle(knobX, knobY, knobRadius * 0.18f, detail);
            }
        }

        private void drawPill(Canvas canvas, RectF rect, String text, int id, int accent) {
            float activation = activation(id);
            float shift = dp(1.8f) * activation;
            scratchRect.set(rect);
            scratchRect.offset(0f, shift);
            float radius = scratchRect.height() * 0.50f;

            RectF shadowRect = new RectF(scratchRect);
            shadowRect.offset(0f, dp(3));
            fill.setShader(null);
            fill.setColor(0x9C000000);
            canvas.drawRoundRect(shadowRect, radius, radius, fill);

            if (activation > 0f) {
                RectF halo = new RectF(scratchRect);
                halo.inset(-dp(5), -dp(4));
                glow.setShader(new android.graphics.LinearGradient(
                    halo.left, halo.centerY(), halo.right, halo.centerY(),
                    new int[] { 0x00000000, withAlpha(accent, Math.round(0x88 * activation)), 0x00000000 },
                    null, android.graphics.Shader.TileMode.CLAMP));
                canvas.drawRoundRect(halo, halo.height() * 0.5f, halo.height() * 0.5f, glow);
                glow.setShader(null);
            }

            fill.setShader(new android.graphics.LinearGradient(
                scratchRect.left, scratchRect.top, scratchRect.left, scratchRect.bottom,
                new int[] { blend(0xF1263449, accent, activation * 0.62f),
                    blend(0xF00A1019, accent, activation * 0.82f) },
                null, android.graphics.Shader.TileMode.CLAMP));
            canvas.drawRoundRect(scratchRect, radius, radius, fill);
            fill.setShader(null);
            stroke.setColor(blend(withAlpha(accent, 0x8C), WHITE, activation * 0.68f));
            stroke.setStrokeWidth(dp(activation > 0.01f ? 1.5f : 1f));
            canvas.drawRoundRect(scratchRect, radius, radius, stroke);

            smallLabel.setColor(blend(0xFFEAF1FF, 0xFF071019, activation * 0.84f));
            drawCenteredText(canvas, text, scratchRect.centerX(), scratchRect.centerY(), smallLabel);
        }

        private void drawSystemPill(Canvas canvas, RectF rect, String value, int accent) {
            if (rect.isEmpty()) return;
            float radius = rect.height() * 0.5f;
            fill.setShader(new android.graphics.LinearGradient(rect.left, rect.top, rect.right, rect.bottom,
                new int[]{0xF23A2E18, 0xF00D1017}, null, android.graphics.Shader.TileMode.CLAMP));
            canvas.drawRoundRect(rect, radius, radius, fill);
            fill.setShader(null);
            stroke.setColor(withAlpha(accent, 0xA8));
            stroke.setStrokeWidth(dp(1));
            canvas.drawRoundRect(rect, radius, radius, stroke);
            smallLabel.setColor(0xFFFFE4A8);
            drawCenteredText(canvas, value, rect.centerX(), rect.centerY(), smallLabel);
        }

        private void drawTurboSwitch(Canvas canvas) {
            int enabledCount = 0;
            for (boolean enabled : turboEnabled) if (enabled) enabledCount++;
            float radius = turboRect.height() * 0.5f;
            RectF shadow = new RectF(turboRect);
            shadow.offset(0f, dp(3));
            fill.setShader(null);
            fill.setColor(0xA0000000);
            canvas.drawRoundRect(shadow, radius, radius, fill);

            if (turboArmed || enabledCount > 0) {
                RectF halo = new RectF(turboRect);
                halo.inset(-dp(6), -dp(5));
                glow.setShader(new android.graphics.LinearGradient(
                    halo.left, halo.centerY(), halo.right, halo.centerY(),
                    new int[] { 0x00000000, withAlpha(AMBER, turboArmed ? 0xB8 : 0x68), 0x00000000 },
                    null, android.graphics.Shader.TileMode.CLAMP));
                canvas.drawRoundRect(halo, halo.height() * 0.5f, halo.height() * 0.5f, glow);
                glow.setShader(null);
            }

            fill.setShader(new android.graphics.LinearGradient(
                turboRect.left, turboRect.top, turboRect.right, turboRect.bottom,
                new int[] {
                    turboArmed ? 0xFFF0B83C : enabledCount > 0 ? 0xDD4A3821 : 0xEE243247,
                    turboArmed ? 0xFFC77A18 : enabledCount > 0 ? 0xDD251A12 : 0xEE090F18
                }, null, android.graphics.Shader.TileMode.CLAMP));
            canvas.drawRoundRect(turboRect, radius, radius, fill);
            fill.setShader(null);
            stroke.setColor(turboArmed ? 0xFFFFE3A6 : enabledCount > 0 ? withAlpha(AMBER, 0xC8) : 0x706F83A1);
            stroke.setStrokeWidth(dp(turboArmed ? 1.6f : 1f));
            canvas.drawRoundRect(turboRect, radius, radius, stroke);

            float iconX = turboRect.left + turboRect.height() * 0.58f;
            float iconY = turboRect.centerY();
            float size = turboRect.height() * 0.27f;
            bolt.reset();
            bolt.moveTo(iconX + size * 0.15f, iconY - size);
            bolt.lineTo(iconX - size * 0.42f, iconY + size * 0.08f);
            bolt.lineTo(iconX - size * 0.02f, iconY + size * 0.08f);
            bolt.lineTo(iconX - size * 0.20f, iconY + size);
            bolt.lineTo(iconX + size * 0.48f, iconY - size * 0.18f);
            bolt.lineTo(iconX + size * 0.08f, iconY - size * 0.18f);
            bolt.close();
            glyph.setColor(turboArmed ? 0xFF15100A : enabledCount > 0 ? AMBER : 0xCCDDE6F5);
            canvas.drawPath(bolt, glyph);

            String text = enabledCount > 0 ? "TURBO " + enabledCount : "TURBO";
            smallLabel.setColor(turboArmed ? 0xFF15100A : 0xFFEAF1FF);
            float textX = turboRect.centerX() + turboRect.height() * 0.16f;
            drawCenteredText(canvas, text, textX, turboRect.centerY(), smallLabel);
        }

        private void drawTurboOrbit(Canvas canvas, float cx, float cy, float radius, int accent) {
            float rotation = (android.os.SystemClock.uptimeMillis() % 1200L) / 1200f * 360f;
            scratchRect.set(cx - radius, cy - radius, cx + radius, cy + radius);
            detail.setStyle(Paint.Style.STROKE);
            detail.setStrokeWidth(dp(1.5f));
            detail.setColor(withAlpha(accent, 0xD8));
            for (int i = 0; i < 3; i++) {
                canvas.drawArc(scratchRect, rotation + i * 120f, 48f, false, detail);
            }
            detail.setStrokeWidth(dp(0.8f));
            detail.setColor(withAlpha(WHITE, 0x70));
            canvas.drawArc(scratchRect, -rotation * 0.65f, 76f, false, detail);
        }

        private void drawCenteredText(Canvas canvas, String text, float cx, float cy, Paint paint) {
            canvas.drawText(text, cx, cy - (paint.ascent() + paint.descent()) * 0.5f, paint);
        }

        private float activation(int id) {
            return pressed[id] ? 1f : pressEnergy[id];
        }

        private void advanceAnimation() {
            long now = android.os.SystemClock.uptimeMillis();
            if (lastAnimationTime == 0L) lastAnimationTime = now;
            float elapsed = Math.min(34f, now - lastAnimationTime);
            lastAnimationTime = now;
            boolean animate = !ripples.isEmpty() || turboArmed;
            for (int i = 0; i < pressEnergy.length; i++) {
                if (pressed[i]) {
                    pressEnergy[i] = 1f;
                } else if (pressEnergy[i] > 0f) {
                    pressEnergy[i] = Math.max(0f, pressEnergy[i] - elapsed / 125f);
                    animate |= pressEnergy[i] > 0f;
                }
                animate |= turboEnabled[i];
            }
            if (animate) postInvalidateOnAnimation();
        }

        @Override
        public boolean onTouchEvent(MotionEvent event) {
            getParent().requestDisallowInterceptTouchEvent(true);
            int action = event.getActionMasked();
            if (action == MotionEvent.ACTION_CANCEL || action == MotionEvent.ACTION_OUTSIDE) {
                ignoredPointers.clear();
                releaseAll();
                return true;
            }

            if (action == MotionEvent.ACTION_DOWN || action == MotionEvent.ACTION_POINTER_DOWN) {
                int index = event.getActionIndex();
                int pointerId = event.getPointerId(index);
                float x = event.getX(index);
                float y = event.getY(index);
                if (expandedContains(layoutLockRect, x, y, dp(8))) {
                    ignoredPointers.put(pointerId, true);
                    layoutUnlocked = !layoutUnlocked;
                    dragTarget = EDIT_NONE;
                    dragPointerId = -1;
                    releaseAll();
                    addRipple(layoutLockRect.centerX(), layoutLockRect.centerY(), layoutLockRect.width() * 0.65f,
                        layoutUnlocked ? LIME : CYAN);
                    performHapticFeedback(layoutUnlocked
                        ? HapticFeedbackConstants.CONTEXT_CLICK
                        : HapticFeedbackConstants.CONFIRM);
                    postInvalidateOnAnimation();
                    return true;
                }
                if (layoutUnlocked && dragPointerId < 0) {
                    int target = hitEditableGroup(x, y);
                    if (target != EDIT_NONE) {
                        dragTarget = target;
                        dragPointerId = pointerId;
                        dragLastX = x;
                        dragLastY = y;
                        ignoredPointers.put(pointerId, true);
                        performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK);
                        postInvalidateOnAnimation();
                    }
                    return true;
                }
                if (profile.cabinetMenu && expandedContains(cabinetRect, x, y, dp(8))) {
                    ignoredPointers.put(pointerId, true);
                    addRipple(cabinetRect.centerX(), cabinetRect.centerY(), cabinetRect.height(), AMBER);
                    performHapticFeedback(HapticFeedbackConstants.CONTEXT_CLICK);
                    openCabinetPanel();
                } else if (expandedContains(turboRect, x, y, dp(8))) {
                    ignoredPointers.put(pointerId, true);
                    turboArmed = !turboArmed;
                    addRipple(turboRect.centerX(), turboRect.centerY(), turboRect.height(), AMBER);
                    performHapticFeedback(turboArmed
                        ? HapticFeedbackConstants.CONTEXT_CLICK
                        : HapticFeedbackConstants.CLOCK_TICK);
                    postInvalidateOnAnimation();
                } else if (turboArmed) {
                    int id = hitDigitalControl(x, y);
                    if (isTurboCapable(id)) {
                        ignoredPointers.put(pointerId, true);
                        turboEnabled[id] = !turboEnabled[id];
                        float[] center = controlCenter(id);
                        addRipple(center[0], center[1], controlRadius(id), controlAccent(id));
                        performHapticFeedback(HapticFeedbackConstants.CONTEXT_CLICK);
                        syncOutputs();
                        postInvalidateOnAnimation();
                    }
                }
            }

            if (layoutUnlocked) {
                if (action == MotionEvent.ACTION_MOVE && dragPointerId >= 0 && dragTarget != EDIT_NONE) {
                    int pointerIndex = event.findPointerIndex(dragPointerId);
                    if (pointerIndex >= 0) {
                        float x = event.getX(pointerIndex);
                        float y = event.getY(pointerIndex);
                        float[] moved = translateEditGroup(dragTarget, x - dragLastX, y - dragLastY, true);
                        dragLastX += moved[0];
                        dragLastY += moved[1];
                        postInvalidateOnAnimation();
                    }
                }
                if ((action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_POINTER_UP)
                        && event.getPointerId(event.getActionIndex()) == dragPointerId) {
                    saveCustomLayout(dragTarget);
                    ignoredPointers.delete(dragPointerId);
                    dragTarget = EDIT_NONE;
                    dragPointerId = -1;
                    performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK);
                    postInvalidateOnAnimation();
                }
                return true;
            }

            if (profile.touchscreen && ADVANCED_NATIVE_INPUT_ENABLED) syncPointerInput(event);
            boolean[] next = new boolean[pressed.length];
            float[] nextAxes = new float[4];
            for (int i = 0; i < event.getPointerCount(); i++) {
                int pointerId = event.getPointerId(i);
                boolean pointerReleased = (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_POINTER_UP)
                    && i == event.getActionIndex();
                if (pointerReleased || ignoredPointers.get(pointerId)) continue;
                if (profile.touchscreen && ADVANCED_NATIVE_INPUT_ENABLED && gameRect.contains(event.getX(i), event.getY(i))) continue;
                classify(event.getX(i), event.getY(i), next, nextAxes);
            }
            apply(next, nextAxes);

            if (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_POINTER_UP) {
                ignoredPointers.delete(event.getPointerId(event.getActionIndex()));
            }
            return true;
        }

        private void syncPointerInput(MotionEvent event) {
            if (!NATIVE_AVAILABLE) return;
            int action = event.getActionMasked();
            int releaseIndex = (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_POINTER_UP)
                ? event.getActionIndex() : -1;
            for (int i = 0; i < event.getPointerCount(); i++) {
                if (i == releaseIndex) continue;
                float x = event.getX(i);
                float y = event.getY(i);
                if (!gameRect.contains(x, y)) continue;
                float nx = ((x - gameRect.left) / Math.max(1f, gameRect.width())) * 2f - 1f;
                float ny = ((y - gameRect.top) / Math.max(1f, gameRect.height())) * 2f - 1f;
                if (ADVANCED_NATIVE_INPUT_ENABLED) nativeSetPointerForPort(playerSlot, nx, ny, true);
                return;
            }
            if (ADVANCED_NATIVE_INPUT_ENABLED) nativeSetPointerForPort(playerSlot, 0f, 0f, false);
        }

        private void classify(float x, float y, boolean[] next, float[] nextAxes) {
            if (!geometryReady) updateGeometry(getWidth(), getHeight(), currentVideoAspect());
            if (!geometryReady) return;

            if (profile.hasTriggers() && expandedContains(leftTriggerRect, x, y, dp(10))) {
                next[RETRO_L2] = true;
                return;
            }
            if (profile.hasTriggers() && expandedContains(rightTriggerRect, x, y, dp(10))) {
                next[RETRO_R2] = true;
                return;
            }
            if (profile.hasShoulders() && expandedContains(leftShoulderRect, x, y, dp(12))) {
                next[leftShoulderButtonId()] = true;
                return;
            }
            if (profile.hasShoulders() && expandedContains(rightShoulderRect, x, y, dp(12))) {
                next[rightShoulderButtonId()] = true;
                return;
            }
            if (hasSelectControl() && expandedContains(selectRect, x, y, dp(10))) {
                next[selectControlId()] = true;
                return;
            }
            if (expandedContains(startRect, x, y, dp(10))) {
                next[RETRO_START] = true;
                return;
            }

            if (profile.hasAnalog() && classifyStick(x, y, leftStickX, leftStickY, 0, nextAxes)) return;
            if (profile.hasRightStick() && classifyStick(x, y, rightStickX, rightStickY, 2, nextAxes)) return;

            float dx = x - dpadX;
            float dy = y - dpadY;
            float dpadHit = dpadRadius * 1.14f;
            if (dx * dx + dy * dy <= dpadHit * dpadHit) {
                float deadZone = dpadRadius * 0.18f;
                if (dx < -deadZone) next[RETRO_LEFT] = true;
                else if (dx > deadZone) next[RETRO_RIGHT] = true;
                if (dy < -deadZone) next[RETRO_UP] = true;
                else if (dy > deadZone) next[RETRO_DOWN] = true;
                return;
            }

            int id = hitActionButton(x, y);
            if (id >= 0) {
                next[id] = true;
                if (isN64CControl(id)) applyN64CControl(id, nextAxes);
            }
        }

        private boolean classifyStick(
                float x, float y, float cx, float cy, int axisOffset, float[] nextAxes) {
            float dx = x - cx;
            float dy = y - cy;
            float hit = stickRadius * 1.30f;
            float distanceSquared = dx * dx + dy * dy;
            if (distanceSquared > hit * hit) return false;
            float nx = dx / stickRadius;
            float ny = dy / stickRadius;
            float magnitude = (float)Math.sqrt(nx * nx + ny * ny);
            if (magnitude > 1f) {
                nx /= magnitude;
                ny /= magnitude;
                magnitude = 1f;
            }
            if (magnitude < 0.10f) {
                nx = 0f;
                ny = 0f;
            } else {
                float scaled = (magnitude - 0.10f) / 0.90f;
                nx = nx / magnitude * scaled;
                ny = ny / magnitude * scaled;
            }
            nextAxes[axisOffset] = nx;
            nextAxes[axisOffset + 1] = ny;
            return true;
        }

        private int hitActionButton(float x, float y) {
            float bestDistance = Float.MAX_VALUE;
            int best = -1;
            for (ConsoleInputProfile.FaceButton button : profile.faceButtons) {
                float[] center = faceCenter(button);
                float hitRadius = actionRadius * button.scale * 1.46f;
                float dx = x - center[0];
                float dy = y - center[1];
                float distance = dx * dx + dy * dy;
                if (distance <= hitRadius * hitRadius && distance < bestDistance) {
                    bestDistance = distance;
                    best = button.id;
                }
            }
            return best;
        }

        private int hitDigitalControl(float x, float y) {
            if (profile.hasTriggers() && expandedContains(leftTriggerRect, x, y, dp(10))) return RETRO_L2;
            if (profile.hasTriggers() && expandedContains(rightTriggerRect, x, y, dp(10))) return RETRO_R2;
            if (profile.hasShoulders() && expandedContains(leftShoulderRect, x, y, dp(12))) return leftShoulderButtonId();
            if (profile.hasShoulders() && expandedContains(rightShoulderRect, x, y, dp(12))) return rightShoulderButtonId();
            int action = hitActionButton(x, y);
            if (action >= 0) return action;
            float dx = x - dpadX;
            float dy = y - dpadY;
            float hit = dpadRadius * 1.14f;
            if (dx * dx + dy * dy <= hit * hit) {
                if (Math.abs(dx) > Math.abs(dy)) return dx < 0f ? RETRO_LEFT : RETRO_RIGHT;
                return dy < 0f ? RETRO_UP : RETRO_DOWN;
            }
            return -1;
        }

        private boolean isTurboCapable(int id) {
            return id >= 0 && id < 16 && id != RETRO_START && id != selectControlId()
                && id != RETRO_L3 && id != RETRO_R3;
        }

        private boolean expandedContains(RectF rect, float x, float y, float expansion) {
            return !rect.isEmpty() && x >= rect.left - expansion && x <= rect.right + expansion
                && y >= rect.top - expansion && y <= rect.bottom + expansion;
        }

        private void apply(boolean[] next, float[] nextAxes) {
            boolean changed = false;
            int hapticButton = -1;
            for (int i = 0; i < pressed.length; i++) {
                if (pressed[i] == next[i]) continue;
                if (!pressed[i] && next[i]) {
                    pressEnergy[i] = 1f;
                    float[] center = controlCenter(i);
                    addRipple(center[0], center[1], controlRadius(i), controlAccent(i));
                    if (hapticButton < 0 || hapticPriority(i) > hapticPriority(hapticButton)) hapticButton = i;
                }
                pressed[i] = next[i];
                changed = true;
            }

            for (int i = 0; i < axes.length; i++) {
                if (Math.abs(axes[i] - nextAxes[i]) < 0.004f) continue;
                boolean startedMoving = Math.abs(axes[i]) < 0.05f && Math.abs(nextAxes[i]) >= 0.05f;
                axes[i] = nextAxes[i];
                changed = true;
                if (startedMoving) {
                    boolean left = i < 2;
                    addRipple(left ? leftStickX : rightStickX, left ? leftStickY : rightStickY,
                        stickRadius, left ? CYAN : VIOLET);
                    performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK);
                }
            }

            syncOutputs();
            syncAxes();
            ensureTurboLoop();
            if (hapticButton >= 0) performControlHaptic(hapticButton);
            if (changed) postInvalidateOnAnimation();
        }

        private void syncOutputs() {
            for (int i = 0; i < outputPressed.length; i++) {
                boolean desired = pressed[i] && (!turboEnabled[i] || turboPhase);
                if (outputPressed[i] == desired) continue;
                outputPressed[i] = desired;
                if (NATIVE_AVAILABLE) nativeSetButtonForPort(playerSlot, i, desired);
            }
        }

        private void syncAxes() {
            for (int i = 0; i < outputAxes.length; i++) {
                if (Math.abs(outputAxes[i] - axes[i]) < 0.003f) continue;
                outputAxes[i] = axes[i];
                if (NATIVE_AVAILABLE) nativeSetAxisForPort(playerSlot, i, axes[i]);
            }
        }

        private void ensureTurboLoop() {
            if (turboLoopRunning) return;
            for (int i = 0; i < pressed.length; i++) {
                if (!pressed[i] || !turboEnabled[i]) continue;
                turboLoopRunning = true;
                postDelayed(turboRunner, TURBO_HALF_PERIOD_MS);
                return;
            }
        }

        private int hapticPriority(int id) {
            if (id == RETRO_START || id == selectControlId()) return 4;
            if (id == RETRO_L2 || id == RETRO_R2) return 3;
            if (id == RETRO_L || id == RETRO_R
                    || id == RETRO_A || id == RETRO_B || id == RETRO_X || id == RETRO_Y) return 2;
            return 1;
        }

        private void performControlHaptic(int id) {
            int feedback;
            if (id == RETRO_START || id == selectControlId()) {
                feedback = HapticFeedbackConstants.CONFIRM;
            } else if (id == RETRO_L2 || id == RETRO_R2) {
                feedback = HapticFeedbackConstants.CONTEXT_CLICK;
            } else if (id == RETRO_L || id == RETRO_R) {
                feedback = HapticFeedbackConstants.KEYBOARD_PRESS;
            } else if (id == RETRO_UP || id == RETRO_DOWN || id == RETRO_LEFT || id == RETRO_RIGHT) {
                feedback = HapticFeedbackConstants.CLOCK_TICK;
            } else {
                feedback = HapticFeedbackConstants.VIRTUAL_KEY;
            }
            performHapticFeedback(feedback);
        }

        private float[] controlCenter(int id) {
            if (hasSelectControl() && id == selectControlId()) {
                return new float[] { selectRect.centerX(), selectRect.centerY() };
            }
            for (ConsoleInputProfile.FaceButton button : profile.faceButtons) {
                if (button.id == id) return faceCenter(button);
            }
            switch (id) {
                case RETRO_UP: return new float[] { dpadX, dpadY - dpadRadius * 0.62f };
                case RETRO_RIGHT: return new float[] { dpadX + dpadRadius * 0.62f, dpadY };
                case RETRO_DOWN: return new float[] { dpadX, dpadY + dpadRadius * 0.62f };
                case RETRO_LEFT: return new float[] { dpadX - dpadRadius * 0.62f, dpadY };
                case RETRO_X: return new float[] { actionX, actionY - actionOffset };
                case RETRO_A: return new float[] { actionX + actionOffset, actionY };
                case RETRO_B: return new float[] { actionX, actionY + actionOffset };
                case RETRO_Y: return new float[] { actionX - actionOffset, actionY };
                case RETRO_L: return new float[] { leftShoulderRect.centerX(), leftShoulderRect.centerY() };
                case RETRO_R: return new float[] { rightShoulderRect.centerX(), rightShoulderRect.centerY() };
                case RETRO_L2: return new float[] { leftTriggerRect.centerX(), leftTriggerRect.centerY() };
                case RETRO_R2: return new float[] { rightTriggerRect.centerX(), rightTriggerRect.centerY() };
                case RETRO_SELECT: return new float[] { selectRect.centerX(), selectRect.centerY() };
                case RETRO_START: return new float[] { startRect.centerX(), startRect.centerY() };
                case RETRO_L3: return new float[] { leftStickX, leftStickY };
                case RETRO_R3: return new float[] { rightStickX, rightStickY };
                default: return new float[] { getWidth() * 0.5f, getHeight() * 0.8f };
            }
        }

        private float controlRadius(int id) {
            if (hasSelectControl() && id == selectControlId()) return selectRect.height();
            for (ConsoleInputProfile.FaceButton button : profile.faceButtons) {
                if (button.id == id) return actionRadius * button.scale;
            }
            if (id == RETRO_UP || id == RETRO_DOWN || id == RETRO_LEFT || id == RETRO_RIGHT) return dpadRadius * 0.38f;
            if (id == RETRO_L3 || id == RETRO_R3) return stickRadius;
            if (id == RETRO_SELECT || id == RETRO_START) return selectRect.height();
            if (id == RETRO_L || id == RETRO_L2) return shoulderPulseRadius(id == RETRO_L2 ? leftTriggerRect : leftShoulderRect);
            if (id == RETRO_R || id == RETRO_R2) return shoulderPulseRadius(id == RETRO_R2 ? rightTriggerRect : rightShoulderRect);
            return dp(18);
        }

        private int controlAccent(int id) {
            if (hasSelectControl() && id == selectControlId()) return CYAN;
            switch (id) {
                case RETRO_A: return CYAN;
                case RETRO_B: return MAGENTA;
                case RETRO_X: return VIOLET;
                case RETRO_Y: return LIME;
                case RETRO_R:
                case RETRO_R2:
                case RETRO_R3:
                case RETRO_START: return VIOLET;
                case RETRO_L:
                case RETRO_L2:
                case RETRO_L3:
                case RETRO_SELECT:
                case RETRO_UP:
                case RETRO_DOWN:
                case RETRO_LEFT:
                case RETRO_RIGHT: return CYAN;
                default: return WHITE;
            }
        }

        void setSystemPanelRightInset(int inset) {
            int safe = Math.max(0, inset);
            if (safe == systemPanelRightInset) return;
            systemPanelRightInset = safe;
            geometryReady = false;
            updateGeometry(getWidth(), getHeight(), currentVideoAspect());
            invalidate();
        }

        void setPlayerSlot(int slot) {
            int safe = Math.max(0, Math.min(GameDeckPlayerRouter.MAX_PLAYERS - 1, slot));
            if (safe == playerSlot) return;
            releaseAll();
            playerSlot = safe;
        }

        void releaseAll() {
            removeCallbacks(turboRunner);
            turboLoopRunning = false;
            turboPhase = true;
            ignoredPointers.clear();
            boolean changed = false;
            for (int i = 0; i < pressed.length; i++) {
                boolean wasOutputPressed = i < outputPressed.length && outputPressed[i];
                if (pressed[i] || wasOutputPressed) changed = true;
                pressed[i] = false;
                pressEnergy[i] = Math.max(pressEnergy[i], wasOutputPressed ? 1f : 0f);
                if (i < outputPressed.length) {
                    outputPressed[i] = false;
                    if (NATIVE_AVAILABLE) nativeSetButtonForPort(playerSlot, i, false);
                }
            }
            if (profile.touchscreen && NATIVE_AVAILABLE && ADVANCED_NATIVE_INPUT_ENABLED) {
                if (ADVANCED_NATIVE_INPUT_ENABLED) nativeSetPointerForPort(playerSlot, 0f, 0f, false);
            }
            for (int i = 0; i < axes.length; i++) {
                if (Math.abs(axes[i]) > 0.001f || Math.abs(outputAxes[i]) > 0.001f) changed = true;
                axes[i] = 0f;
                outputAxes[i] = 0f;
                if (NATIVE_AVAILABLE) nativeSetAxisForPort(playerSlot, i, 0f);
            }
            if (changed) postInvalidateOnAnimation();
        }

        private float dp(float value) {
            return value * getResources().getDisplayMetrics().density;
        }

        private int withAlpha(int color, int alpha) {
            return (color & 0x00FFFFFF) | ((alpha & 0xFF) << 24);
        }

        private int blend(int from, int to, float amount) {
            float t = clamp(amount, 0f, 1f);
            int a = Math.round(Color.alpha(from) + (Color.alpha(to) - Color.alpha(from)) * t);
            int r = Math.round(Color.red(from) + (Color.red(to) - Color.red(from)) * t);
            int g = Math.round(Color.green(from) + (Color.green(to) - Color.green(from)) * t);
            int b = Math.round(Color.blue(from) + (Color.blue(to) - Color.blue(from)) * t);
            return Color.argb(a, r, g, b);
        }

        private float clamp(float value, float minimum, float maximum) {
            return Math.max(minimum, Math.min(maximum, value));
        }
    }

    private static native boolean nativeBootstrap(
        String core, String content, String systemDir, String saveDir, String diagnosticPath);
    private static native void nativeSetSurface(Surface surface);
    private static native void nativeRun();
    private static native void nativePause(boolean paused);
    private static native void nativeStop();
    private static native void nativeRelease();
    private static native void nativeSetButton(int id, boolean pressed);
    private static native void nativeSetAxis(int axis, float value);
    private static native void nativeSetButtonForPort(int port, int id, boolean pressed);
    private static native void nativeSetAxisForPort(int port, int axis, float value);
    private static native void nativeSetPointerForPort(int port, float x, float y, boolean pressed);
    private static native void nativeSetKey(int key, boolean pressed);
    private static native String nativeCoreOptions();
    private static native String nativeInputDescriptors();
    private static native boolean nativeSetCoreOption(String key, String value);
    private static native int nativeReadAudio(short[] target, int maxShorts);
    private static native int nativeSampleRate();
    private static native float nativeVideoAspect();
    private static native void nativeSetViewportInsets(int left, int top, int right, int bottom);
    private static native String nativeLastError();
}
