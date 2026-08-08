package io.gamedeck.mobile;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.GameManager;
import android.app.GameState;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ActivityInfo;
import android.content.pm.ApplicationInfo;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.RectF;
import android.graphics.drawable.GradientDrawable;
import android.content.res.Configuration;
import android.hardware.input.InputManager;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.InputDevice;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.PixelCopy;
import android.view.Surface;
import android.view.SurfaceHolder;
import android.view.SurfaceView;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import com.armsx2.BiosInfo;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.io.FileOutputStream;
import java.io.FileWriter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;

import io.gamedeck.ps2engine.GameDeckPs2Engine;

/** GameDeck-owned, same-APK PCSX2-derived play surface. */
public final class GameDeckPs2BootstrapActivity extends Activity implements SurfaceHolder.Callback,
        InputManager.InputDeviceListener, GameDeckPlayersView.Listener {
    private static final AtomicLong CREATED_SEQUENCE = new AtomicLong();
    private static final String QA_ACTION = "io.gamedeck.mobile.PS2_QA";

    static long creationSequence() { return CREATED_SEQUENCE.get(); }
    static final String EXTRA_BOOTABLE_PATH = "io.gamedeck.mobile.PS2_BOOTABLE_PATH";
    static final String EXTRA_BIOS_PATH = "io.gamedeck.mobile.PS2_BIOS_PATH";
    static final String EXTRA_TITLE = "io.gamedeck.mobile.PS2_TITLE";

    private final Handler main = new Handler(Looper.getMainLooper());
    private final AtomicBoolean startRequested = new AtomicBoolean(false);
    private final AtomicBoolean closing = new AtomicBoolean(false);
    private final AtomicBoolean frameAuditRequested = new AtomicBoolean(false);
    private final AtomicBoolean firstFrameReported = new AtomicBoolean(false);
    private FrameLayout rootView;
    private GameDeckAmbientView ambientView;
    private SurfaceView surfaceView;
    private GameDeckPs2GamepadView gamepadView;
    private GameDeckPlayerRouter playerRouter;
    private GameDeckPlayersView playersView;
    private TextView playersButton;
    private TextView exitButton;
    private final RectF gameBounds = new RectF();
    private InputManager inputManager;
    private BroadcastReceiver qaReceiver;
    private long ambientGeneration;
    private FrameLayout loadingCard;
    private TextView phaseView;
    private TextView detailView;
    private ProgressBar progressBar;
    private Thread emulationThread;
    private volatile boolean engineReady;
    private volatile boolean surfaceReady;
    private volatile Surface surface;
    private volatile int surfaceWidth;
    private volatile int surfaceHeight;
    private volatile int viewWidth;
    private volatile int viewHeight;
    private volatile boolean windowFocused;
    private volatile String lifecycleState = "created";
    private volatile int lastPresentedFrames;
    private long heartbeatSequence;
    private GameManager gameManager;
    private PowerManager powerManager;
    private final Map<Integer, Long> previousThreadTicks = new HashMap<>();
    private long previousThreadSampleNanos;
    private String contentPath;
    private String biosPath;
    private String title;
    private long startedAt;
    private String lastControlLayoutDiagnostics = "";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        CREATED_SEQUENCE.incrementAndGet();
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        contentPath = value(getIntent() == null ? null : getIntent().getStringExtra(EXTRA_BOOTABLE_PATH));
        biosPath = value(getIntent() == null ? null : getIntent().getStringExtra(EXTRA_BIOS_PATH));
        title = value(getIntent() == null ? null : getIntent().getStringExtra(EXTRA_TITLE));
        if (title.isEmpty()) title = new File(contentPath).getName();
        startedAt = System.currentTimeMillis();
        playerRouter = new GameDeckPlayerRouter(this, "ps2");
        try { inputManager = getSystemService(InputManager.class); } catch (Throwable ignored) {}
        buildUi();
        registerQaReceiver();
        configureAndroidGamePerformance();
        checkpoint("lifecycle", "onCreate;pid=" + android.os.Process.myPid() + ";process=" + currentProcessName());
        applyFullscreenAfterContentView();

        File content = new File(contentPath);
        File bios = new File(biosPath);
        if (!content.isFile() || !content.canRead() || content.length() <= 0) {
            showFatal("GameDeck could not read the prepared PS2 disc.");
            return;
        }
        if (!bios.isFile() || !bios.canRead() || bios.length() <= 0) {
            showFatal("GameDeck could not verify the required PS2 firmware.");
            return;
        }

        checkpoint("bootstrap", "content-ready;firmware-ready");
        Thread prepare = new Thread(() -> {
            try {
                GameDeckPs2Engine.initialize(this, (phase, progress, message) ->
                    runOnUiThread(() -> updateLoading(phase, progress, message)));
                checkpoint("renderer-selected", GameDeckPs2Engine.selectedRenderer());
                checkpoint("presentation-profile", GameDeckPs2Engine.presentationProfile());
                BiosInfo info = GameDeckPs2Engine.configureBios(this, bios);
                checkpoint("firmware-validated", info.getVersionString() + ";region=" + info.getRegionFlag());
                GameDeckPs2Engine.configurePlayerSlotsForBoot(playerRouter.highestAssignedSlot());
                checkpoint("players-boot", playerRouter.summary() + ";multitap=" + playerRouter.needsMultitap());
                engineReady = true;
                runOnUiThread(() -> {
                    updateLoading("renderer-warmup", 72, "Warming up the PlayStation 2 renderer.");
                    maybeStartVm();
                });
            } catch (Throwable error) {
                runOnUiThread(() -> showFatal("GameDeck could not initialize the PS2 engine: " + describe(error)));
            }
        }, "GameDeck-PS2-Prepare");
        prepare.setDaemon(true);
        prepare.start();
        main.postDelayed(this::watchFrames, 1_000L);
    }

    private String currentProcessName() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) return android.app.Application.getProcessName();
        return getPackageName() + ":ps2";
    }

    private boolean isDebugBuild() {
        return (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
    }

    private void registerQaReceiver() {
        if (!isDebugBuild()) return;
        qaReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                String command = intent == null ? "" : value(intent.getStringExtra("command"));
                if ("orientation:portrait".equals(command)) {
                    setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
                } else if ("orientation:landscape".equals(command)) {
                    setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE);
                } else if ("orientation:sensor".equals(command)) {
                    setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR);
                } else if (command.startsWith("screenshot:")) {
                    auditVisibleSurface(command.substring("screenshot:".length()));
                } else if ("players:open".equals(command)) {
                    openPlayersPanel();
                } else if ("players:close".equals(command) && playersView != null) {
                    playersView.hidePanel();
                }
            }
        };
        IntentFilter filter = new IntentFilter(QA_ACTION);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(qaReceiver, filter, Context.RECEIVER_EXPORTED);
        } else {
            registerLegacyQaReceiver(filter);
        }
    }

    @SuppressLint("UnspecifiedRegisterReceiverFlag")
    private void registerLegacyQaReceiver(IntentFilter filter) {
        // Android 8-12 do not expose RECEIVER_EXPORTED; Android 13+ never executes this branch.
        registerReceiver(qaReceiver, filter);
    }

    private void configureAndroidGamePerformance() {
        try {
            WindowManager.LayoutParams params = getWindow().getAttributes();
            params.preferredRefreshRate = 60f;
            getWindow().setAttributes(params);
        } catch (Throwable error) {
            checkpoint("display-rate-warning", describe(error));
        }
        try { powerManager = getSystemService(PowerManager.class); } catch (Throwable ignored) {}
        if (Build.VERSION.SDK_INT >= 31) {
            try { gameManager = getSystemService(GameManager.class); } catch (Throwable ignored) {}
        }
        reportGameState(true, Build.VERSION.SDK_INT >= 33 ? GameState.MODE_NONE : 0);
        checkpoint("android-performance", "gameMode=" + currentGameMode()
            + ";preferredRefreshHz=60;thermal=" + thermalSummary());
    }

    private void reportGameState(boolean loading, int mode) {
        if (Build.VERSION.SDK_INT < 33 || gameManager == null) return;
        try { gameManager.setGameState(new GameState(loading, mode)); }
        catch (Throwable error) { checkpoint("game-state-warning", describe(error)); }
    }

    private String currentGameMode() {
        if (Build.VERSION.SDK_INT < 31 || gameManager == null) return "unsupported";
        try {
            switch (gameManager.getGameMode()) {
                case GameManager.GAME_MODE_PERFORMANCE: return "performance";
                case GameManager.GAME_MODE_BATTERY: return "battery";
                case GameManager.GAME_MODE_STANDARD: return "standard";
                case GameManager.GAME_MODE_CUSTOM: return "custom";
                default: return "unsupported";
            }
        } catch (Throwable ignored) { return "unavailable"; }
    }

    private String thermalSummary() {
        if (powerManager == null || Build.VERSION.SDK_INT < 29) return "unknown";
        try {
            int status = powerManager.getCurrentThermalStatus();
            float headroom = Build.VERSION.SDK_INT >= 30 ? powerManager.getThermalHeadroom(10) : Float.NaN;
            return status + ":" + (Float.isFinite(headroom) ? Math.round(headroom * 100f) : -1);
        } catch (Throwable ignored) { return "unavailable"; }
    }

    private void applyFullscreenAfterContentView() {
        if (android.os.Build.VERSION.SDK_INT < 30) return;
        final View decor = getWindow().getDecorView();
        decor.post(() -> {
            try {
                WindowInsetsController controller = decor.getWindowInsetsController();
                if (controller == null) return;
                controller.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            } catch (Throwable error) {
                checkpoint("fullscreen-warning", describe(error));
            }
        });
    }

    private void buildUi() {
        rootView = new FrameLayout(this);
        rootView.setBackgroundColor(0xFF04070C);
        rootView.setMotionEventSplittingEnabled(true);

        ambientView = new GameDeckAmbientView(this);
        rootView.addView(ambientView, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        // Keep PCSX2 on a zero-copy 4:3 SurfaceView. The side space belongs to the
        // frame-derived ambient layer rather than being baked as black pixels into the surface.
        surfaceView = new SurfaceView(this);
        surfaceView.setSecure(false);
        surfaceView.setZOrderMediaOverlay(true);
        surfaceView.setAlpha(0.999f);
        surfaceView.getHolder().setFormat(PixelFormat.OPAQUE);
        surfaceView.getHolder().addCallback(this);
        FrameLayout.LayoutParams surfaceParams = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT, Gravity.CENTER);
        rootView.addView(surfaceView, surfaceParams);
        rootView.addOnLayoutChangeListener((view, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom) ->
            layoutGameSurface(right - left, bottom - top));
        surfaceView.post(() -> layoutGameSurface(rootView.getWidth(), rootView.getHeight()));

        gamepadView = new GameDeckPs2GamepadView(this);
        gamepadView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        gamepadView.setAlpha(0f);
        gamepadView.setVisibility(View.INVISIBLE);
        rootView.addView(gamepadView, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        ));

        loadingCard = new FrameLayout(this);
        GradientDrawable cardBackground = new GradientDrawable(
            GradientDrawable.Orientation.TL_BR,
            new int[]{0xF2181D28, 0xF20B0E15}
        );
        cardBackground.setCornerRadius(dp(24));
        cardBackground.setStroke(dp(1), 0x5572E7FF);
        loadingCard.setBackground(cardBackground);
        loadingCard.setPadding(dp(24), dp(22), dp(24), dp(22));
        FrameLayout.LayoutParams cardParams = new FrameLayout.LayoutParams(
            Math.min(getResources().getDisplayMetrics().widthPixels - dp(40), dp(520)),
            dp(190),
            Gravity.CENTER
        );
        rootView.addView(loadingCard, cardParams);

        TextView kicker = text("PREPARING YOUR GAME", 11, 0xFF72E7FF, true);
        FrameLayout.LayoutParams kickerParams = new FrameLayout.LayoutParams(-1, dp(20));
        loadingCard.addView(kicker, kickerParams);

        phaseView = text(title, 22, Color.WHITE, true);
        FrameLayout.LayoutParams phaseParams = new FrameLayout.LayoutParams(-1, dp(56));
        phaseParams.topMargin = dp(24);
        loadingCard.addView(phaseView, phaseParams);

        detailView = text("Resolving the PlayStation 2 runtime and required assets.", 14, 0xFFC7D0DC, false);
        FrameLayout.LayoutParams detailParams = new FrameLayout.LayoutParams(-1, dp(48));
        detailParams.topMargin = dp(80);
        loadingCard.addView(detailView, detailParams);

        progressBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progressBar.setMax(100);
        progressBar.setProgress(4);
        FrameLayout.LayoutParams progressParams = new FrameLayout.LayoutParams(-1, dp(5));
        progressParams.gravity = Gravity.BOTTOM;
        loadingCard.addView(progressBar, progressParams);

        exitButton = topAction("EXIT");
        exitButton.setContentDescription("Exit game");
        exitButton.setElevation(dp(24));
        exitButton.setOnClickListener(view -> exitGame());
        rootView.addView(exitButton, new FrameLayout.LayoutParams(dp(92), dp(34), Gravity.TOP | Gravity.START));

        playersButton = topAction("PLAYERS");
        playersButton.setElevation(dp(24));
        playersButton.setOnClickListener(view -> openPlayersPanel());
        playersButton.setOnTouchListener((view, event) -> {
            if (event.getActionMasked() == MotionEvent.ACTION_UP) view.performClick();
            return true;
        });
        playersButton.setContentDescription("Player controller assignments");
        rootView.addView(playersButton, new FrameLayout.LayoutParams(dp(104), dp(34), Gravity.TOP | Gravity.START));

        playersView = new GameDeckPlayersView(this, playerRouter, this);
        playersView.setElevation(dp(32));
        playersView.setVisibility(View.GONE);
        rootView.addView(playersView, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        setContentView(rootView);
        applyPlayerAssignments(false);
    }

    private void openPlayersPanel() {
        if (playersView == null) return;
        playersView.bringToFront();
        playersView.showPanel();
        checkpoint("players-panel", "opened;" + playerRouter.summary());
        main.postDelayed(() -> auditVisibleSurface("players-ui"), 420L);
    }

    private TextView topAction(String label) {
        TextView view = text(label, 11, Color.WHITE, true);
        view.setGravity(Gravity.CENTER);
        view.setAllCaps(false);
        view.setLetterSpacing(0.08f);
        view.setPadding(dp(12), 0, dp(12), 0);
        GradientDrawable background = new GradientDrawable(
            GradientDrawable.Orientation.TL_BR,
            new int[]{0xE61A2533, 0xE6080D15}
        );
        background.setCornerRadius(dp(18));
        background.setStroke(dp(1), 0x8872E7FF);
        view.setBackground(background);
        view.setHapticFeedbackEnabled(true);
        return view;
    }

    private void layoutChrome(int rootWidth, int rootHeight) {
        if (exitButton == null || playersButton == null || gameBounds.width() <= 0f) return;
        float leftGutter = gameBounds.left;
        float rightGutter = rootWidth - gameBounds.right;
        int buttonH = dp(34);
        if (leftGutter >= dp(76) && rightGutter >= dp(76)) {
            int leftW = Math.max(dp(76), Math.min(dp(96), Math.round(leftGutter * 0.42f)));
            int rightW = Math.max(dp(88), Math.min(dp(112), Math.round(rightGutter * 0.48f)));
            FrameLayout.LayoutParams exitParams = new FrameLayout.LayoutParams(leftW, buttonH,
                Gravity.TOP | Gravity.START);
            exitParams.leftMargin = Math.max(dp(10), Math.round((leftGutter - leftW) * 0.5f));
            exitParams.topMargin = dp(10);
            applyChromeLayout(exitButton, exitParams);

            FrameLayout.LayoutParams playerParams = new FrameLayout.LayoutParams(rightW, buttonH,
                Gravity.TOP | Gravity.START);
            playerParams.leftMargin = Math.round(gameBounds.right + (rightGutter - rightW) * 0.5f);
            playerParams.topMargin = dp(10);
            applyChromeLayout(playersButton, playerParams);
        } else {
            // Portrait: small utility chips occupy the deck header, never the game image.
            int y = Math.round(gameBounds.bottom) + dp(18);
            int portraitH = dp(28);
            FrameLayout.LayoutParams exitParams = new FrameLayout.LayoutParams(dp(72), portraitH,
                Gravity.TOP | Gravity.START);
            exitParams.leftMargin = dp(18);
            exitParams.topMargin = y;
            applyChromeLayout(exitButton, exitParams);
            FrameLayout.LayoutParams playerParams = new FrameLayout.LayoutParams(dp(100), portraitH,
                Gravity.TOP | Gravity.END);
            playerParams.rightMargin = dp(18);
            playerParams.topMargin = y;
            applyChromeLayout(playersButton, playerParams);
        }
        exitButton.bringToFront();
        playersButton.bringToFront();
    }

    private void applyChromeLayout(View view, FrameLayout.LayoutParams next) {
        FrameLayout.LayoutParams current = (FrameLayout.LayoutParams) view.getLayoutParams();
        if (current != null && current.width == next.width && current.height == next.height
            && current.gravity == next.gravity && current.leftMargin == next.leftMargin
            && current.topMargin == next.topMargin && current.rightMargin == next.rightMargin
            && current.bottomMargin == next.bottomMargin) return;
        view.setLayoutParams(next);
    }

    private void layoutGameSurface(int rootWidth, int rootHeight) {
        if (surfaceView == null || rootWidth <= 0 || rootHeight <= 0) return;
        final boolean landscape = rootWidth >= rootHeight;
        final int width;
        final int height;
        final int left;
        final int top;
        if (landscape) {
            width = Math.min(rootWidth, Math.round(rootHeight * 4f / 3f));
            height = Math.min(rootHeight, Math.round(rootWidth * 3f / 4f));
            left = (rootWidth - width) / 2;
            top = (rootHeight - height) / 2;
        } else {
            width = rootWidth;
            height = Math.min(Math.round(rootWidth * 3f / 4f), Math.round(rootHeight * 0.46f));
            left = 0;
            top = 0;
        }
        if (width <= 0 || height <= 0) return;
        gameBounds.set(left, top, left + width, top + height);
        FrameLayout.LayoutParams params = (FrameLayout.LayoutParams) surfaceView.getLayoutParams();
        if (params.width != width || params.height != height) {
            params.width = width;
            params.height = height;
            params.gravity = landscape ? Gravity.CENTER : Gravity.TOP | Gravity.CENTER_HORIZONTAL;
            surfaceView.setLayoutParams(params);
        }
        viewWidth = width;
        viewHeight = height;
        if (gamepadView != null) gamepadView.setGameBounds(gameBounds.left, gameBounds.top,
            gameBounds.right, gameBounds.bottom);
        if (playersView != null) playersView.setGameBounds(gameBounds.left, gameBounds.top,
            gameBounds.right, gameBounds.bottom);
        layoutChrome(rootWidth, rootHeight);
        if (gamepadView != null) {
            String diagnostics = gamepadView.layoutDiagnostics();
            if (!diagnostics.equals(lastControlLayoutDiagnostics)) {
                lastControlLayoutDiagnostics = diagnostics;
                checkpoint("control-layout", diagnostics);
            }
        }
        try {
            surfaceView.getHolder().setFixedSize(compositorBufferWidth(width), compositorBufferHeight(height));
        } catch (Throwable ignored) {}
    }

    private void applyPlayerAssignments(boolean live) {
        if (playerRouter == null) return;
        if (live && safeHasActiveVm()) {
            for (int slot = 0; slot < GameDeckPlayerRouter.MAX_PLAYERS; slot++) {
                try { GameDeckPs2Engine.releasePlayerSlot(slot); } catch (Throwable ignored) {}
            }
            GameDeckPs2Engine.ensurePlayerSlotsAsync(playerRouter.highestAssignedSlot());
        }
        int phoneSlot = playerRouter.phoneSlot();
        boolean showPhone = firstFrameReported.get() && phoneSlot >= 0;
        if (gamepadView != null) gamepadView.setPhoneControlsEnabled(showPhone, Math.max(0, phoneSlot));
        if (playersButton != null) playersButton.setText("PLAYERS · " + playerRouter.activePlayerCount());
        if (playersView != null) playersView.invalidate();
        checkpoint("players", playerRouter.summary() + ";phoneSlot=" + phoneSlot
            + ";multitap=" + playerRouter.needsMultitap() + ";live=" + live);
    }

    private void startAmbientSampler() {
        long generation = ++ambientGeneration;
        sampleAmbientFrame(generation);
    }

    private void sampleAmbientFrame(long generation) {
        if (closing.get() || generation != ambientGeneration) return;
        if (!surfaceReady || surfaceView == null || ambientView == null || !firstFrameReported.get()) {
            main.postDelayed(() -> sampleAmbientFrame(generation), 500L);
            return;
        }
        Bitmap frame;
        try { frame = Bitmap.createBitmap(96, 72, Bitmap.Config.ARGB_8888); }
        catch (Throwable error) {
            main.postDelayed(() -> sampleAmbientFrame(generation), 700L);
            return;
        }
        try {
            PixelCopy.request(surfaceView, frame, result -> {
                if (closing.get() || generation != ambientGeneration) {
                    if (!frame.isRecycled()) frame.recycle();
                    return;
                }
                if (result == PixelCopy.SUCCESS) ambientView.setFrame(frame);
                else if (!frame.isRecycled()) frame.recycle();
                main.postDelayed(() -> sampleAmbientFrame(generation), 500L);
            }, main);
        } catch (Throwable error) {
            if (!frame.isRecycled()) frame.recycle();
            main.postDelayed(() -> sampleAmbientFrame(generation), 700L);
        }
    }

    private void routeHardwareMotion(MotionEvent event, int slot) {
        GameDeckPs2Engine.notePhysicalController(event.getDeviceId());
        GameDeckPs2Engine.touchAnalog(slot, true,
            GameDeckHardwareInput.leftX(event), GameDeckHardwareInput.leftY(event));
        GameDeckPs2Engine.touchAnalog(slot, false,
            GameDeckHardwareInput.rightX(event), GameDeckHardwareInput.rightY(event));
        GameDeckPs2Engine.touchPressure(slot, 104, GameDeckHardwareInput.leftTrigger(event));
        GameDeckPs2Engine.touchPressure(slot, 105, GameDeckHardwareInput.rightTrigger(event));
        int hatX = GameDeckHardwareInput.hatX(event);
        int hatY = GameDeckHardwareInput.hatY(event);
        GameDeckPs2Engine.touchButton(slot, 21, hatX < 0);
        GameDeckPs2Engine.touchButton(slot, 22, hatX > 0);
        GameDeckPs2Engine.touchButton(slot, 19, hatY < 0);
        GameDeckPs2Engine.touchButton(slot, 20, hatY > 0);
    }

    private TextView text(String text, int size, int color, boolean bold) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextSize(size);
        view.setTextColor(color);
        view.setGravity(Gravity.START | Gravity.CENTER_VERTICAL);
        if (bold) view.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        return view;
    }

    private void updateLoading(String phase, int progress, String message) {
        if (closing.get()) return;
        phaseView.setText(title);
        detailView.setText(message == null || message.isEmpty() ? "Preparing the game automatically." : message);
        progressBar.setProgress(Math.max(0, Math.min(100, progress)));
        checkpoint(phase, "progress=" + progress);
    }

    private void maybeStartVm() {
        if (!engineReady || !surfaceReady || !startRequested.compareAndSet(false, true) || closing.get()) return;
        Surface active = surface;
        if (active == null || !active.isValid()) {
            startRequested.set(false);
            return;
        }
        GameDeckPs2Engine.surfaceChanged(active, surfaceWidth, surfaceHeight);
        updateLoading("booting", 88, "Booting " + title + ".");
        emulationThread = new Thread(() -> {
            boolean result = false;
            try {
                result = GameDeckPs2Engine.runVm(contentPath);
                checkpoint("vm-returned", "result=" + result + ";frames=" + GameDeckPs2Engine.presentedFrames());
            } catch (Throwable error) {
                checkpoint("vm-error", describe(error));
            }
            final boolean vmResult = result;
            if (!closing.get()) runOnUiThread(() -> {
                int frames = Math.max(lastPresentedFrames, safePresentedFrames());
                checkpoint("engine-stopped", "result=" + vmResult + ";frames=" + frames + ";activity-retained=true");
                if (frames <= 0) {
                    showFatal("The PS2 engine stopped before rendering the game.");
                } else {
                    showFatal("The PS2 engine stopped unexpectedly after rendering " + frames
                        + " frames. GameDeck kept this screen open for diagnosis.");
                }
            });
        }, "GameDeck-PCSX2-VM");
        emulationThread.start();
    }

    private void watchFrames() {
        if (closing.get()) return;
        int frames = safePresentedFrames();
        boolean active = safeHasActiveVm();
        if (frames > lastPresentedFrames) lastPresentedFrames = frames;
        if (frames > 0) {
            if (firstFrameReported.compareAndSet(false, true)) {
                loadingCard.animate().alpha(0f).setDuration(220)
                    .withEndAction(() -> loadingCard.setVisibility(View.GONE)).start();
                applyPlayerAssignments(false);
                startAmbientSampler();
                main.postDelayed(() -> auditVisibleSurface("controls-ui"), 1_200L);
                checkpoint("touch-gamepad", "profile=dualshock2-premium;dualAnalog=true;pressureAxes=true;haptics=true;playerSlot="
                    + playerRouter.phoneSlot());
                reportGameState(false, Build.VERSION.SDK_INT >= 33 ? GameState.MODE_GAMEPLAY_UNINTERRUPTIBLE : 0);
                checkpoint("first-frame", "frames=" + frames + ";renderer=" + GameDeckPs2Engine.selectedRenderer()
                    + ";gameMode=" + currentGameMode());
            }
            if (frameAuditRequested.compareAndSet(false, true)) {
                main.postDelayed(() -> auditVisibleSurface("03s"), 3_000L);
                main.postDelayed(() -> auditVisibleSurface("08s"), 8_000L);
                main.postDelayed(() -> auditVisibleSurface("15s"), 15_000L);
                main.postDelayed(() -> auditVisibleSurface("30s"), 30_000L);
                main.postDelayed(() -> auditVisibleSurface("60s"), 60_000L);
            }
        }
        heartbeatSequence++;
        if (heartbeatSequence == 1 || heartbeatSequence % 2 == 0) {
            writeHeartbeat(frames, active);
        }
        long elapsed = System.currentTimeMillis() - startedAt;
        if (elapsed > 25_000L && startRequested.get() && !active && lastPresentedFrames <= 0) {
            showFatal("The PS2 engine did not produce a playable frame.");
            return;
        }
        main.postDelayed(this::watchFrames, 1_000L);
    }

    private int safePresentedFrames() {
        try { return Math.max(0, GameDeckPs2Engine.presentedFrames()); }
        catch (Throwable ignored) { return 0; }
    }

    private boolean safeHasActiveVm() {
        try { return GameDeckPs2Engine.hasActiveVm(); }
        catch (Throwable ignored) { return false; }
    }

    private void writeHeartbeat(int frames, boolean active) {
        Runtime runtime = Runtime.getRuntime();
        long usedMb = (runtime.totalMemory() - runtime.freeMemory()) / (1024L * 1024L);
        long totalMb = runtime.totalMemory() / (1024L * 1024L);
        long maxMb = runtime.maxMemory() / (1024L * 1024L);
        float fps = 0f;
        float nominalFps = 0f;
        float speedPercent = 0f;
        try {
            fps = GameDeckPs2Engine.fps();
            nominalFps = GameDeckPs2Engine.nominalFrameRate();
            speedPercent = nominalFps > 0.1f ? (fps / nominalFps) * 100f : 0f;
        } catch (Throwable ignored) {}
        checkpoint("heartbeat", "frames=" + frames + ";lastFrames=" + lastPresentedFrames
            + ";active=" + active + ";fps=" + Math.round(fps)
            + ";nativeFps=" + Math.round(fps) + ";nominalFps=" + Math.round(nominalFps)
            + ";speedPercent=" + Math.round(speedPercent)
            + ";focus=" + windowFocused + ";lifecycle=" + lifecycleState
            + ";surface=" + surfaceReady + ";surfaceSize=" + surfaceWidth + "x" + surfaceHeight
            + ";viewSize=" + viewWidth + "x" + viewHeight
            + ";gameMode=" + currentGameMode() + ";thermal=" + thermalSummary()
            + ";threads=" + sampleThreadLoads()
            + ";heapMb=" + usedMb + "/" + totalMb + "/" + maxMb
            + ";pid=" + android.os.Process.myPid());
    }

    private String sampleThreadLoads() {
        long now = System.nanoTime();
        double elapsedSeconds = previousThreadSampleNanos == 0L ? 0d
            : (now - previousThreadSampleNanos) / 1_000_000_000d;
        Map<Integer, Long> current = new HashMap<>();
        List<ThreadLoad> loads = new ArrayList<>();
        File[] tasks = new File("/proc/self/task").listFiles();
        if (tasks != null) {
            for (File task : tasks) {
                try {
                    int tid = Integer.parseInt(task.getName());
                    String name = readFirstLine(new File(task, "comm"));
                    String stat = readFirstLine(new File(task, "stat"));
                    int close = stat.lastIndexOf(')');
                    if (close < 0 || close + 2 >= stat.length()) continue;
                    String[] fields = stat.substring(close + 2).trim().split("\\s+");
                    if (fields.length <= 36) continue;
                    long ticks = Long.parseLong(fields[11]) + Long.parseLong(fields[12]);
                    int cpu = Integer.parseInt(fields[36]);
                    current.put(tid, ticks);
                    Long previous = previousThreadTicks.get(tid);
                    double percent = previous == null || elapsedSeconds <= 0d ? 0d
                        : Math.max(0d, (ticks - previous) / elapsedSeconds);
                    loads.add(new ThreadLoad(name, cpu, percent));
                } catch (Throwable ignored) {}
            }
        }
        previousThreadTicks.clear();
        previousThreadTicks.putAll(current);
        previousThreadSampleNanos = now;
        loads.sort(Comparator.comparingDouble((ThreadLoad load) -> load.percent).reversed());
        StringBuilder out = new StringBuilder();
        int count = 0;
        for (ThreadLoad load : loads) {
            if (load.percent < 1d && count > 0) break;
            if (count++ >= 6) break;
            if (out.length() > 0) out.append(',');
            out.append(load.name.replace(';', '_').replace(',', '_'))
                .append(':').append(Math.round(load.percent)).append('@').append(load.cpu);
        }
        return out.length() == 0 ? "warming" : out.toString();
    }

    private static String readFirstLine(File file) throws Exception {
        try (BufferedReader reader = new BufferedReader(new FileReader(file))) {
            String line = reader.readLine();
            return line == null ? "" : line;
        }
    }

    private static final class ThreadLoad {
        final String name;
        final int cpu;
        final double percent;
        ThreadLoad(String name, int cpu, double percent) {
            this.name = name;
            this.cpu = cpu;
            this.percent = percent;
        }
    }

    private void auditVisibleSurface(String label) {
        if (closing.get() || rootView == null || rootView.getWidth() <= 0
            || rootView.getHeight() <= 0) return;
        int width = Math.min(rootView.getWidth(), 960);
        int height = Math.max(1, Math.round((float) rootView.getHeight() * width
            / Math.max(1, rootView.getWidth())));
        Bitmap bitmap;
        try { bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888); }
        catch (Throwable error) {
            checkpoint("visible-frame-audit-" + label, "source=window-pixelcopy;error=" + describe(error));
            return;
        }
        try {
            PixelCopy.request(getWindow(), bitmap, result -> {
                if (result != PixelCopy.SUCCESS) {
                    checkpoint("visible-frame-audit-" + label,
                        "source=window-pixelcopy;result=" + result
                            + ";renderer=" + GameDeckPs2Engine.selectedRenderer());
                    if (!bitmap.isRecycled()) bitmap.recycle();
                    return;
                }
                analyzeVisibleBitmap(label, bitmap);
            }, main);
        } catch (Throwable error) {
            checkpoint("visible-frame-audit-" + label, "source=window-pixelcopy;error=" + describe(error));
            if (!bitmap.isRecycled()) bitmap.recycle();
        }
    }

    private void analyzeVisibleBitmap(String label, Bitmap bitmap) {
        try {
            int width = bitmap.getWidth();
            int height = bitmap.getHeight();
            long luminance = 0L;
            int nonBlack = 0;
            int chromatic = 0;
            int samples = 0;
            int stepX = Math.max(1, width / 96);
            int stepY = Math.max(1, height / 54);
            for (int y = stepY / 2; y < height; y += stepY) {
                for (int x = stepX / 2; x < width; x += stepX) {
                    int pixel = bitmap.getPixel(x, y);
                    int r = (pixel >> 16) & 0xFF;
                    int g = (pixel >> 8) & 0xFF;
                    int b = pixel & 0xFF;
                    int luma = (r * 54 + g * 183 + b * 19) >> 8;
                    luminance += luma;
                    if (luma > 8) nonBlack++;
                    int max = Math.max(r, Math.max(g, b));
                    int min = Math.min(r, Math.min(g, b));
                    if (max - min > 10 && max > 16) chromatic++;
                    samples++;
                }
            }
            int average = samples == 0 ? 0 : (int) (luminance / samples);
            int ratioPermille = samples == 0 ? 0 : (nonBlack * 1000 / samples);
            int chromaPermille = samples == 0 ? 0 : (chromatic * 1000 / samples);
            File capture = qaFile("embedded-ps2-window-frame-" + label + ".png");
            if (capture != null) {
                try (FileOutputStream output = new FileOutputStream(capture, false)) {
                    bitmap.compress(Bitmap.CompressFormat.PNG, 92, output);
                } catch (Throwable ignored) {}
            }
            checkpoint("visible-frame-audit-" + label, "source=window-pixelcopy;avg=" + average
                + ";nonBlackPermille=" + ratioPermille
                + ";chromaPermille=" + chromaPermille
                + ";renderer=" + GameDeckPs2Engine.selectedRenderer());
        } catch (Throwable error) {
            checkpoint("visible-frame-audit-" + label, "source=window-pixelcopy;error=" + describe(error));
        } finally {
            if (!bitmap.isRecycled()) bitmap.recycle();
        }
    }

    private void showFatal(String message) {
        checkpoint("error", message);
        loadingCard.setVisibility(View.VISIBLE);
        loadingCard.setAlpha(1f);
        phaseView.setText("Couldn’t start " + title);
        detailView.setText(message + " Press Back or Exit Game to return to GameDeck.");
        progressBar.setProgress(0);
    }

    private int compositorBufferWidth(int viewWidth) {
        return Math.max(640, (viewWidth + 1) / 2);
    }

    private int compositorBufferHeight(int viewHeight) {
        return Math.max(360, (viewHeight + 1) / 2);
    }

    @Override
    public void surfaceCreated(SurfaceHolder holder) {
        Surface created = holder.getSurface();
        surface = created;
        checkpoint("surface", "surfaceview-created;valid=" + (created != null && created.isValid())
            + ";alpha=" + surfaceView.getAlpha() + ";zeroCopy=true;blended=true");
    }

    @Override
    public void surfaceChanged(SurfaceHolder holder, int format, int width, int height) {
        Surface active = holder.getSurface();
        surface = active;
        surfaceWidth = width;
        surfaceHeight = height;
        viewWidth = surfaceView == null ? width : surfaceView.getWidth();
        viewHeight = surfaceView == null ? height : surfaceView.getHeight();
        surfaceReady = active != null && active.isValid() && width > 0 && height > 0;
        if (surfaceReady && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    active.setFrameRate(60f, Surface.FRAME_RATE_COMPATIBILITY_FIXED_SOURCE,
                        Surface.CHANGE_FRAME_RATE_ALWAYS);
                } else {
                    active.setFrameRate(60f, Surface.FRAME_RATE_COMPATIBILITY_FIXED_SOURCE);
                }
            } catch (Throwable error) {
                checkpoint("surface-rate-warning", describe(error));
            }
        }
        checkpoint("surface", "surfaceview-changed;view=" + viewWidth + "x" + viewHeight
            + ";buffer=" + width + "x" + height + ";format=" + format
            + ";ready=" + surfaceReady + ";zeroCopy=true;blended=true");
        if (engineReady && surfaceReady) GameDeckPs2Engine.surfaceChanged(active, width, height);
        maybeStartVm();
    }

    @Override
    public void surfaceDestroyed(SurfaceHolder holder) {
        checkpoint("surface", "surfaceview-destroyed;focus=" + windowFocused
            + ";lifecycle=" + lifecycleState + ";zeroCopy=true");
        surfaceReady = false;
        surface = null;
        try { GameDeckPs2Engine.surfaceDestroyed(); } catch (Throwable ignored) {}
    }

    @Override
    public boolean dispatchGenericMotionEvent(MotionEvent event) {
        if (playersView != null && playersView.isShowing()) return true;
        if (GameDeckHardwareInput.isGamepadSource(event.getSource())
            && event.getAction() == MotionEvent.ACTION_MOVE) {
            int slot = playerRouter == null ? -1 : playerRouter.slotForDevice(event.getDeviceId());
            if (slot >= 0) {
                try { routeHardwareMotion(event, slot); } catch (Throwable ignored) {}
            }
            return true;
        }
        return super.dispatchGenericMotionEvent(event);
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (playersView != null && playersView.isShowing()) {
            playersView.handleKeyEvent(event);
            return true;
        }
        boolean gamepad = GameDeckHardwareInput.isGamepadSource(event.getSource());
        if (event.getKeyCode() == KeyEvent.KEYCODE_BACK && !gamepad) {
            if (event.getAction() == KeyEvent.ACTION_UP) exitGame();
            return true;
        }
        if (gamepad && event.getRepeatCount() == 0) {
            int slot = playerRouter == null ? -1 : playerRouter.slotForDevice(event.getDeviceId());
            int code = GameDeckHardwareInput.ps2ButtonForKey(event.getKeyCode());
            if (slot >= 0 && code >= 0) {
                try {
                    GameDeckPs2Engine.notePhysicalController(event.getDeviceId());
                    GameDeckPs2Engine.touchButton(slot, code, event.getAction() == KeyEvent.ACTION_DOWN);
                } catch (Throwable ignored) {}
                return true;
            }
            // An unassigned hardware controller must never fall through and control P1.
            if (code >= 0) return true;
        }
        return super.dispatchKeyEvent(event);
    }

    @Override
    public void onInputDeviceAdded(int deviceId) {
        if (playerRouter != null) playerRouter.refreshDevices();
        applyPlayerAssignments(true);
    }

    @Override
    public void onInputDeviceRemoved(int deviceId) {
        if (playerRouter != null) playerRouter.refreshDevices();
        applyPlayerAssignments(true);
    }

    @Override
    public void onInputDeviceChanged(int deviceId) {
        if (playerRouter != null) playerRouter.refreshDevices();
        applyPlayerAssignments(true);
    }

    @Override
    public void onAssignmentsChanged() {
        applyPlayerAssignments(true);
    }

    @Override
    public void onDismissed() {
        applyFullscreenAfterContentView();
    }

    @Override
    protected void onStart() {
        super.onStart();
        lifecycleState = "started";
        checkpoint("lifecycle", "onStart;pid=" + android.os.Process.myPid());
    }

    @Override
    protected void onPause() {
        lifecycleState = "paused";
        try { if (inputManager != null) inputManager.unregisterInputDeviceListener(this); } catch (Throwable ignored) {}
        try { if (qaReceiver != null) unregisterReceiver(qaReceiver); } catch (Throwable ignored) {}
        checkpoint("lifecycle", "onPause;focus=" + windowFocused + ";frames=" + lastPresentedFrames);
        if (gamepadView != null) gamepadView.releaseAllTouches();
        reportGameState(false, Build.VERSION.SDK_INT >= 33 ? GameState.MODE_NONE : 0);
        super.onPause();
        if (!closing.get()) try { GameDeckPs2Engine.pause(); } catch (Throwable ignored) {}
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        if (gamepadView != null) gamepadView.releaseAllTouches();
        lastControlLayoutDiagnostics = "";
        rootView.post(() -> {
            layoutGameSurface(rootView.getWidth(), rootView.getHeight());
            applyFullscreenAfterContentView();
            checkpoint("orientation", rootView.getWidth() >= rootView.getHeight()
                ? "landscape" : "portrait");
            main.postDelayed(() -> auditVisibleSurface(rootView.getWidth() >= rootView.getHeight()
                ? "landscape-ui" : "portrait-ui"), 700L);
        });
    }

    @Override
    protected void onResume() {
        super.onResume();
        lifecycleState = "resumed";
        try { if (inputManager != null) inputManager.registerInputDeviceListener(this, main); } catch (Throwable ignored) {}
        if (playerRouter != null) playerRouter.refreshDevices();
        applyPlayerAssignments(false);
        checkpoint("lifecycle", "onResume;pid=" + android.os.Process.myPid());
        reportGameState(!firstFrameReported.get(), Build.VERSION.SDK_INT >= 33
            ? (firstFrameReported.get() ? GameState.MODE_GAMEPLAY_UNINTERRUPTIBLE : GameState.MODE_NONE) : 0);
        if (!closing.get()) try { GameDeckPs2Engine.resume(); } catch (Throwable ignored) {}
    }

    @Override
    protected void onStop() {
        lifecycleState = "stopped";
        checkpoint("lifecycle", "onStop;frames=" + lastPresentedFrames);
        super.onStop();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        windowFocused = hasFocus;
        checkpoint("window-focus", "focused=" + hasFocus + ";lifecycle=" + lifecycleState
            + ";frames=" + lastPresentedFrames);
    }

    @Override
    protected void onDestroy() {
        lifecycleState = "destroyed";
        checkpoint("lifecycle", "onDestroy;closing=" + closing.get() + ";frames=" + lastPresentedFrames);
        reportGameState(false, Build.VERSION.SDK_INT >= 33 ? GameState.MODE_NONE : 0);
        ambientGeneration++;
        main.removeCallbacksAndMessages(null);
        try { if (inputManager != null) inputManager.unregisterInputDeviceListener(this); } catch (Throwable ignored) {}
        try { if (qaReceiver != null) unregisterReceiver(qaReceiver); } catch (Throwable ignored) {}
        if (ambientView != null) ambientView.release();
        if (gamepadView != null) gamepadView.releaseAllTouches();
        if (closing.compareAndSet(false, true)) {
            try { GameDeckPs2Engine.shutdown(); } catch (Throwable ignored) {}
        }
        super.onDestroy();
    }

    private void exitGame() {
        if (!closing.compareAndSet(false, true)) return;
        checkpoint("exit", "user-or-runtime");
        try { GameDeckPs2Engine.shutdown(); } catch (Throwable ignored) {}
        finish();
    }

    private File qaFile(String name) {
        try {
            File[] mediaDirs = getExternalMediaDirs();
            File base = mediaDirs != null && mediaDirs.length > 0 && mediaDirs[0] != null ? mediaDirs[0] : getFilesDir();
            File directory = new File(base, "GameDeck-Console/qa");
            if (!directory.isDirectory() && !directory.mkdirs()) return null;
            return new File(directory, name);
        } catch (Throwable ignored) {
            return null;
        }
    }

    private void checkpoint(String phase, String detail) {
        try {
            File target = qaFile("embedded-ps2-runtime.json");
            if (target == null) return;
            File directory = target.getParentFile();
            String safe = (detail == null ? "" : detail).replace("\\", "_").replace("\"", "'")
                .replace('\n', ' ').replace('\r', ' ');
            String record = "{\"at\":" + System.currentTimeMillis()
                + ",\"phase\":\"" + phase + "\""
                + ",\"engine\":\"" + GameDeckPs2Engine.ENGINE_VERSION + "\""
                + ",\"detail\":\"" + safe + "\"}";
            try (FileWriter writer = new FileWriter(target, false)) {
                writer.write(record);
            }
            File history = new File(directory, "embedded-ps2-runtime-history.jsonl");
            try (FileWriter writer = new FileWriter(history, true)) {
                writer.write(record);
                writer.write('\n');
            }
        } catch (Throwable ignored) {}
    }

    private String describe(Throwable error) {
        String message = error == null ? "" : error.getMessage();
        if (message == null || message.trim().isEmpty()) message = error == null ? "Unknown error" : error.getClass().getSimpleName();
        return message.replace('\n', ' ').replace('\r', ' ');
    }

    private String value(String input) { return input == null ? "" : input.trim(); }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
}
