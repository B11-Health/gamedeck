package io.gamedeck.mobile;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.CornerPathEffect;
import android.graphics.LinearGradient;
import android.graphics.RadialGradient;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.Shader;
import android.graphics.Typeface;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.SparseArray;
import android.view.HapticFeedbackConstants;
import android.view.MotionEvent;
import android.view.View;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import io.gamedeck.ps2engine.GameDeckPs2Engine;

/**
 * GameDeck-owned premium DualShock 2 touch surface.
 *
 * The view intentionally owns the whole touch plane so two sticks, a D-pad direction,
 * and face/shoulder buttons can all be held at the same time. It draws into the normal
 * Android composition layer above the PCSX2 TextureView and sends native pressure values
 * directly to the embedded engine.
 */
final class GameDeckPs2GamepadView extends View {
    private static final int CYAN = 0xFF5EE7FF;
    private static final int VIOLET = 0xFF9B7BFF;
    private static final int MAGENTA = 0xFFFF5CB8;
    private static final int LIME = 0xFFB5EF68;
    private static final int GRAPHITE = 0xFF090E16;
    private static final int SURFACE = 0xFF151D29;
    private static final int SURFACE_HIGH = 0xFF253246;
    private static final int WHITE = 0xFFF5F8FF;
    private static final float DEAD_ZONE = 0.12f;
    private static final long PHYSICAL_CONTROLLER_HIDE_MS = 12_000L;
    private static final long RIPPLE_DURATION_MS = 520L;

    private static final int PAD_UP = 19;
    private static final int PAD_RIGHT = 22;
    private static final int PAD_DOWN = 20;
    private static final int PAD_LEFT = 21;
    private static final int PAD_TRIANGLE = 100;
    private static final int PAD_CIRCLE = 97;
    private static final int PAD_CROSS = 96;
    private static final int PAD_SQUARE = 99;
    private static final int PAD_SELECT = 109;
    private static final int PAD_START = 108;
    private static final int PAD_L1 = 102;
    private static final int PAD_L2 = 104;
    private static final int PAD_R1 = 103;
    private static final int PAD_R2 = 105;
    private static final int PAD_L3 = 106;
    private static final int PAD_R3 = 107;

    private final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint stroke = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint text = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.SUBPIXEL_TEXT_FLAG);
    private final Paint accent = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint glow = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint detail = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Path arrow = new Path();
    private final Path cross = new Path();
    private final Path clipPath = new Path();
    private final RectF scratchRect = new RectF();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final SparseArray<PointerCapture> pointers = new SparseArray<>();
    private final Map<Integer, Integer> heldButtonCounts = new HashMap<>();
    private final Map<Integer, Float> pressEnergy = new HashMap<>();
    private final Map<Integer, ButtonSpec> buttonByCode = new HashMap<>();
    private final List<ButtonSpec> buttons = new ArrayList<>();
    private final List<Ripple> ripples = new ArrayList<>();
    private final Set<Integer> heldDpadCodes = new HashSet<>();

    private final RectF leftGlass = new RectF();
    private final RectF rightGlass = new RectF();
    private final RectF dpadBounds = new RectF();
    private final RectF leftStickBounds = new RectF();
    private final RectF rightStickBounds = new RectF();
    private final RectF gameBounds = new RectF();
    private final RectF leftGutter = new RectF();
    private final RectF rightGutter = new RectF();
    private final RectF unifiedDeck = new RectF();
    private boolean portraitLayout;

    private float density;
    private float dpadCx;
    private float dpadCy;
    private float dpadRadius;
    private float leftStickCx;
    private float leftStickCy;
    private float rightStickCx;
    private float rightStickCy;
    private float stickRadius;
    private float stickKnobRadius;
    private float leftStickX;
    private float leftStickY;
    private float rightStickX;
    private float rightStickY;
    private int leftStickPointer = -1;
    private int rightStickPointer = -1;
    private int dpadPointer = -1;
    private int leftStickHapticSector = -2;
    private int rightStickHapticSector = -2;
    private long lastLeftStickHapticAt;
    private long lastRightStickHapticAt;
    private long lastDpadHapticAt;
    private long physicalControllerGeneration;
    private long lastAnimationTime;
    private boolean controlsVisible = true;
    private int playerSlot;
    private CornerPathEffect crossCorners;

    GameDeckPs2GamepadView(Context context) {
        super(context);
        density = getResources().getDisplayMetrics().density;
        setFocusable(false);
        setClickable(true);
        setHapticFeedbackEnabled(true);
        setWillNotDraw(false);
        setLayerType(View.LAYER_TYPE_HARDWARE, null);

        stroke.setStyle(Paint.Style.STROKE);
        stroke.setStrokeWidth(dp(1.25f));
        stroke.setStrokeCap(Paint.Cap.ROUND);
        stroke.setStrokeJoin(Paint.Join.ROUND);
        stroke.setColor(0x99CDEEFF);
        text.setTextAlign(Paint.Align.CENTER);
        text.setTypeface(Typeface.create("sans-serif", Typeface.BOLD));
        text.setLetterSpacing(0.02f);
        accent.setStyle(Paint.Style.FILL);
        glow.setStyle(Paint.Style.FILL);
        detail.setStyle(Paint.Style.STROKE);
        detail.setStrokeCap(Paint.Cap.ROUND);
        detail.setStrokeJoin(Paint.Join.ROUND);
        crossCorners = new CornerPathEffect(dp(9));
        setContentDescription("GameDeck premium DualShock 2 touch controls");
        setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_YES);
    }

    @Override
    protected void onSizeChanged(int width, int height, int oldWidth, int oldHeight) {
        super.onSizeChanged(width, height, oldWidth, oldHeight);
        buildLayout(width, height);
    }

    void setGameBounds(float left, float top, float right, float bottom) {
        if (Math.abs(gameBounds.left - left) < 0.5f && Math.abs(gameBounds.top - top) < 0.5f
            && Math.abs(gameBounds.right - right) < 0.5f && Math.abs(gameBounds.bottom - bottom) < 0.5f) return;
        gameBounds.set(left, top, right, bottom);
        if (getWidth() > 0 && getHeight() > 0) buildLayout(getWidth(), getHeight());
    }

    private void buildLayout(int width, int height) {
        buttons.clear();
        buttonByCode.clear();
        float h = Math.max(1f, height);
        float w = Math.max(1f, width);
        if (gameBounds.width() <= 1f || gameBounds.height() <= 1f) {
            if (w >= h) {
                float gameW = Math.min(w, h * 4f / 3f);
                float gameH = Math.min(h, w * 3f / 4f);
                gameBounds.set((w - gameW) * 0.5f, (h - gameH) * 0.5f,
                    (w + gameW) * 0.5f, (h + gameH) * 0.5f);
            } else {
                float gameH = Math.min(h * 0.46f, w * 3f / 4f);
                float gameW = gameH * 4f / 3f;
                gameBounds.set((w - gameW) * 0.5f, 0f, (w + gameW) * 0.5f, gameH);
            }
        }
        if (w >= h) buildLandscapeLayout(w, h);
        else buildPortraitLayout(w, h);
        invalidate();
    }

    private void buildLandscapeLayout(float w, float h) {
        portraitLayout = false;
        unifiedDeck.setEmpty();
        float sideGutter = Math.max(0f, gameBounds.left);
        float rightGutterWidth = Math.max(0f, w - gameBounds.right);
        float gutter = Math.min(sideGutter, rightGutterWidth);
        float edge = Math.max(dp(12), gutter * 0.045f);
        leftGutter.set(0f, 0f, gameBounds.left, h);
        rightGutter.set(gameBounds.right, 0f, w, h);

        // Shoulder row follows the physical top edge: outer trigger, inner bumper.
        // This shortens index-finger travel and visually reads like a real controller.
        float shoulderGap = dp(9);
        float shoulderTop = Math.max(dp(58), h * 0.105f);
        float shoulderH = Math.min(dp(38), h * 0.072f);
        float shoulderW = Math.min(dp(92), (gutter - edge * 2f - shoulderGap) * 0.5f);
        float leftOuter = edge;
        float leftInner = gameBounds.left - edge - shoulderW;
        float rightInner = gameBounds.right + edge;
        float rightOuter = w - edge - shoulderW;
        addPill(PAD_L2, "L2", leftOuter, shoulderTop, shoulderW, shoulderH, CYAN);
        addPill(PAD_L1, "L1", leftInner, shoulderTop, shoulderW, shoulderH, VIOLET);
        addPill(PAD_R1, "R1", rightInner, shoulderTop, shoulderW, shoulderH, VIOLET);
        addPill(PAD_R2, "R2", rightOuter, shoulderTop, shoulderW, shoulderH, CYAN);

        // Primary controls follow diagonal thumb arcs from the lower corners.
        dpadRadius = Math.min(h * 0.096f, gutter * 0.245f);
        dpadCx = edge + dpadRadius * 1.10f;
        dpadCy = h * 0.610f;
        dpadBounds.set(dpadCx - dpadRadius * 1.30f, dpadCy - dpadRadius * 1.30f,
            dpadCx + dpadRadius * 1.30f, dpadCy + dpadRadius * 1.30f);

        float faceRadius = Math.min(h * 0.047f, gutter * 0.112f);
        float faceOffset = Math.min(h * 0.076f, gutter * 0.185f);
        float faceCx = w - edge - faceOffset - faceRadius * 0.35f;
        float faceCy = h * 0.610f;
        addFaceButtons(faceCx, faceCy, faceOffset, faceRadius);

        // DualShock geometry: sticks are inward and lower than D-pad/face buttons,
        // but not buried at the absolute bottom edge.
        stickRadius = Math.min(h * 0.092f, gutter * 0.225f);
        stickKnobRadius = stickRadius * 0.43f;
        leftStickCx = gameBounds.left - edge - stickRadius * 1.10f;
        rightStickCx = gameBounds.right + edge + stickRadius * 1.10f;
        leftStickCy = rightStickCy = h * 0.825f;
        updateStickBounds();

        // Rarely used utility buttons sit between the primary and secondary thumb zones.
        float menuW = Math.min(dp(48), gutter * 0.23f);
        float menuH = dp(20);
        float menuY = h * 0.700f;
        addPill(PAD_SELECT, "SELECT", gameBounds.left - edge - menuW, menuY,
            menuW, menuH, CYAN);
        addPill(PAD_START, "START", gameBounds.right + edge, menuY,
            menuW, menuH, CYAN);

        leftGlass.set(edge * 0.28f, edge * 0.28f,
            Math.max(edge * 0.28f, gameBounds.left - edge * 0.28f), h - edge * 0.28f);
        rightGlass.set(Math.min(w - edge * 0.28f, gameBounds.right + edge * 0.28f), edge * 0.28f,
            w - edge * 0.28f, h - edge * 0.28f);
        applyGestureExclusions((int) w, (int) h, true);
    }

    private void buildPortraitLayout(float w, float h) {
        portraitLayout = true;
        float edge = dp(12);
        float deckTop = gameBounds.bottom + dp(10);
        float desiredBottom = deckTop + dp(430);
        float deckBottom = Math.min(h - dp(18), desiredBottom);
        if (deckBottom - deckTop < dp(360)) deckBottom = h - dp(12);
        unifiedDeck.set(edge, deckTop, w - edge, deckBottom);
        leftGutter.set(unifiedDeck.left, unifiedDeck.top, unifiedDeck.centerX(), unifiedDeck.bottom);
        rightGutter.set(unifiedDeck.centerX(), unifiedDeck.top, unifiedDeck.right, unifiedDeck.bottom);

        // One compact top-edge shoulder rail. Visual controls stay slim while hit slop is larger.
        float shoulderTop = deckTop + dp(48);
        float shoulderGap = dp(7);
        float shoulderH = dp(29);
        float shoulderW = (w - edge * 4f - shoulderGap * 3f) * 0.25f;
        float x = edge * 1.5f;
        addPill(PAD_L2, "L2", x, shoulderTop, shoulderW, shoulderH, CYAN);
        x += shoulderW + shoulderGap;
        addPill(PAD_L1, "L1", x, shoulderTop, shoulderW, shoulderH, VIOLET);
        x += shoulderW + shoulderGap;
        addPill(PAD_R1, "R1", x, shoulderTop, shoulderW, shoulderH, VIOLET);
        x += shoulderW + shoulderGap;
        addPill(PAD_R2, "R2", x, shoulderTop, shoulderW, shoulderH, CYAN);

        // Compact performance layout: the continuously used left stick and face cluster share
        // the primary thumb line. Secondary controls are one short roll below.
        float primaryY = deckTop + dp(178);
        float secondaryY = deckTop + dp(300);
        float leftX = w * 0.275f;
        float rightX = w * 0.725f;

        stickRadius = Math.min(dp(49), w * 0.112f);
        stickKnobRadius = stickRadius * 0.43f;
        leftStickCx = leftX;
        leftStickCy = primaryY;
        rightStickCx = rightX;
        rightStickCy = secondaryY;
        updateStickBounds();

        float faceRadius = Math.min(dp(28), w * 0.061f);
        float faceOffset = Math.min(dp(44), w * 0.095f);
        addFaceButtons(rightX, primaryY, faceOffset, faceRadius);

        dpadRadius = Math.min(dp(47), w * 0.108f);
        dpadCx = leftX;
        dpadCy = secondaryY;
        dpadBounds.set(dpadCx - dpadRadius * 1.34f, dpadCy - dpadRadius * 1.34f,
            dpadCx + dpadRadius * 1.34f, dpadCy + dpadRadius * 1.34f);

        // Quiet system controls sit between the two thumb lines.
        float menuW = dp(44);
        float menuH = dp(19);
        float menuGap = dp(10);
        float menuY = deckTop + dp(237);
        addPill(PAD_SELECT, "SELECT", w * 0.5f - menuGap * 0.5f - menuW,
            menuY, menuW, menuH, CYAN);
        addPill(PAD_START, "START", w * 0.5f + menuGap * 0.5f,
            menuY, menuW, menuH, CYAN);

        // These halves are only ripple-clip regions in portrait; the visible background is unified.
        leftGlass.set(unifiedDeck.left, unifiedDeck.top, unifiedDeck.centerX(), unifiedDeck.bottom);
        rightGlass.set(unifiedDeck.centerX(), unifiedDeck.top, unifiedDeck.right, unifiedDeck.bottom);
        applyGestureExclusions((int) w, (int) h, false);
    }

    private void addFaceButtons(float cx, float cy, float offset, float radius) {
        addRound(PAD_TRIANGLE, "△", cx, cy - offset, radius, LIME);
        addRound(PAD_CIRCLE, "○", cx + offset, cy, radius, MAGENTA);
        addRound(PAD_CROSS, "×", cx, cy + offset, radius, CYAN);
        addRound(PAD_SQUARE, "□", cx - offset, cy, radius, VIOLET);
    }

    private void updateStickBounds() {
        leftStickBounds.set(leftStickCx - stickRadius * 1.18f, leftStickCy - stickRadius * 1.18f,
            leftStickCx + stickRadius * 1.18f, leftStickCy + stickRadius * 1.18f);
        rightStickBounds.set(rightStickCx - stickRadius * 1.18f, rightStickCy - stickRadius * 1.18f,
            rightStickCx + stickRadius * 1.18f, rightStickCy + stickRadius * 1.18f);
    }

    private void applyGestureExclusions(int width, int height, boolean landscape) {
        if (Build.VERSION.SDK_INT < 29) return;
        List<Rect> exclusions = new ArrayList<>();
        if (landscape) {
            if (leftGutter.width() > 0f) exclusions.add(new Rect(0, 0, Math.round(leftGutter.right), height));
            if (rightGutter.width() > 0f) exclusions.add(new Rect(Math.round(rightGutter.left), 0, width, height));
        } else {
            exclusions.add(new Rect(0, Math.round(gameBounds.bottom), width, height));
        }
        setSystemGestureExclusionRects(exclusions);
    }

    String layoutDiagnostics() {
        int overlaps = 0;
        for (ButtonSpec button : buttons) if (button.intersects(gameBounds)) overlaps++;
        if (RectF.intersects(dpadBounds, gameBounds)) overlaps++;
        if (RectF.intersects(leftStickBounds, gameBounds)) overlaps++;
        if (RectF.intersects(rightStickBounds, gameBounds)) overlaps++;
        return "game=" + Math.round(gameBounds.left) + "," + Math.round(gameBounds.top) + ","
            + Math.round(gameBounds.right) + "," + Math.round(gameBounds.bottom)
            + ";orientation=" + (getWidth() >= getHeight() ? "landscape" : "portrait")
            + ";controls=" + buttons.size() + ";gameOverlapCount=" + overlaps
            + ";layout=" + (portraitLayout ? "compact-performance" : "adaptive-grips")
            + ";multiPointer=true;contactChords=true;stickyButtons=true;stickHaptics=directional";
    }

    private void addRound(int code, String label, float cx, float cy, float radius, int color) {
        ButtonSpec spec = ButtonSpec.round(code, label, cx, cy, radius, color);
        buttons.add(spec);
        buttonByCode.put(code, spec);
    }

    private void addPill(int code, String label, float left, float top, float width, float height, int color) {
        ButtonSpec spec = ButtonSpec.pill(code, label, new RectF(left, top, left + width, top + height), color);
        buttons.add(spec);
        buttonByCode.put(code, spec);
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        if (!controlsVisible) return;

        if (portraitLayout) {
            drawUnifiedDeck(canvas);
        } else {
            drawGlass(canvas, leftGlass, false);
            drawGlass(canvas, rightGlass, true);
        }
        drawRipples(canvas);
        drawAmbientWell(canvas, dpadCx, dpadCy, dpadRadius * 1.48f, CYAN);
        drawAmbientWell(canvas, leftStickCx, leftStickCy, stickRadius * 1.48f, CYAN);
        drawAmbientWell(canvas, rightStickCx, rightStickCy, stickRadius * 1.48f, VIOLET);
        drawDpad(canvas);
        drawStick(canvas, true);
        drawStick(canvas, false);
        for (ButtonSpec button : buttons) drawButton(canvas, button);
        advanceAnimation();
    }

    private void drawUnifiedDeck(Canvas canvas) {
        float radius = dp(30);
        fill.setShader(new LinearGradient(unifiedDeck.left, unifiedDeck.top,
            unifiedDeck.right, unifiedDeck.bottom,
            new int[] {0xE5162231, 0xEE0B111B, 0xF205080D},
            new float[] {0f, 0.56f, 1f}, Shader.TileMode.CLAMP));
        canvas.drawRoundRect(unifiedDeck, radius, radius, fill);
        fill.setShader(null);

        stroke.setStrokeWidth(dp(1));
        stroke.setShader(new LinearGradient(unifiedDeck.left, unifiedDeck.top,
            unifiedDeck.right, unifiedDeck.top,
            new int[] {withAlpha(CYAN, 0x74), 0x24FFFFFF, withAlpha(VIOLET, 0x74)},
            null, Shader.TileMode.CLAMP));
        canvas.drawRoundRect(unifiedDeck, radius, radius, stroke);
        stroke.setShader(null);

        scratchRect.set(unifiedDeck);
        scratchRect.inset(dp(7), dp(7));
        stroke.setColor(0x1FFFFFFF);
        canvas.drawRoundRect(scratchRect, radius - dp(7), radius - dp(7), stroke);

        // Low-contrast grip lighting gives left/right ownership without creating two columns.
        glow.setShader(new RadialGradient(unifiedDeck.left + unifiedDeck.width() * 0.23f,
            unifiedDeck.top + unifiedDeck.height() * 0.58f, unifiedDeck.width() * 0.46f,
            new int[] {withAlpha(CYAN, 0x16), 0x00000000}, null, Shader.TileMode.CLAMP));
        canvas.drawRoundRect(unifiedDeck, radius, radius, glow);
        glow.setShader(new RadialGradient(unifiedDeck.right - unifiedDeck.width() * 0.23f,
            unifiedDeck.top + unifiedDeck.height() * 0.58f, unifiedDeck.width() * 0.46f,
            new int[] {withAlpha(VIOLET, 0x16), 0x00000000}, null, Shader.TileMode.CLAMP));
        canvas.drawRoundRect(unifiedDeck, radius, radius, glow);
        glow.setShader(null);
    }

    private void drawGlass(Canvas canvas, RectF rect, boolean reverse) {
        float radius = Math.min(dp(38), rect.height() * 0.16f);
        fill.setShader(new LinearGradient(
            reverse ? rect.right : rect.left, rect.top,
            reverse ? rect.left : rect.right, rect.bottom,
            new int[] {0x99101A28, 0x70121A27, 0x260A1019},
            new float[] {0f, 0.56f, 1f}, Shader.TileMode.CLAMP));
        canvas.drawRoundRect(rect, radius, radius, fill);
        fill.setShader(null);
        int railAccent = reverse ? VIOLET : CYAN;
        stroke.setColor(withAlpha(railAccent, 0x52));
        stroke.setStrokeWidth(dp(1));
        canvas.drawRoundRect(rect, radius, radius, stroke);
        scratchRect.set(rect);
        scratchRect.inset(dp(7), dp(7));
        stroke.setColor(0x18FFFFFF);
        canvas.drawRoundRect(scratchRect, Math.max(0f, radius - dp(7)), Math.max(0f, radius - dp(7)), stroke);
        float innerX = reverse ? rect.right - dp(10) : rect.left + dp(10);
        stroke.setShader(new LinearGradient(innerX, rect.top + radius, innerX, rect.bottom - radius,
            new int[] {0x00FFFFFF, withAlpha(railAccent, 0x78), 0x00FFFFFF}, null, Shader.TileMode.CLAMP));
        canvas.drawLine(innerX, rect.top + radius, innerX, rect.bottom - radius, stroke);
        stroke.setShader(null);
    }

    private void drawAmbientWell(Canvas canvas, float cx, float cy, float radius, int color) {
        glow.setShader(new RadialGradient(cx, cy, radius,
            new int[] {withAlpha(color, 0x22), 0x45121B28, 0x17101824, 0x00000000},
            new float[] {0f, 0.48f, 0.76f, 1f}, Shader.TileMode.CLAMP));
        canvas.drawCircle(cx, cy, radius, glow);
        glow.setShader(null);
        stroke.setColor(withAlpha(color, 0x28));
        stroke.setStrokeWidth(dp(1));
        canvas.drawCircle(cx, cy, radius * 0.76f, stroke);
    }

    private void drawRipples(Canvas canvas) {
        long now = SystemClock.uptimeMillis();
        for (int i = ripples.size() - 1; i >= 0; i--) {
            Ripple ripple = ripples.get(i);
            float progress = (now - ripple.startedAt) / (float) RIPPLE_DURATION_MS;
            if (progress >= 1f) {
                ripples.remove(i);
                continue;
            }
            float eased = 1f - (1f - progress) * (1f - progress);
            float radius = ripple.baseRadius * (0.55f + eased * 2.8f);
            float alpha = (1f - progress) * (1f - progress);
            RectF clip = portraitLayout
                ? unifiedDeck
                : (ripple.x < getWidth() * 0.5f ? leftGlass : rightGlass);
            canvas.save();
            clipPath.reset();
            clipPath.addRoundRect(clip, dp(32), dp(32), Path.Direction.CW);
            canvas.clipPath(clipPath);
            glow.setShader(new RadialGradient(ripple.x, ripple.y, radius,
                new int[] {withAlpha(ripple.color, Math.round(0x38 * alpha)),
                    withAlpha(ripple.color, Math.round(0x14 * alpha)), 0x00000000},
                new float[] {0f, 0.62f, 1f}, Shader.TileMode.CLAMP));
            canvas.drawCircle(ripple.x, ripple.y, radius, glow);
            glow.setShader(null);
            stroke.setColor(withAlpha(ripple.color, Math.round(0xC8 * alpha)));
            stroke.setStrokeWidth(dp(1.2f + 1.4f * (1f - progress)));
            canvas.drawCircle(ripple.x, ripple.y, radius * 0.76f, stroke);
            canvas.restore();
        }
    }

    private void addRipple(float x, float y, float radius, int color) {
        if (ripples.size() >= 10) ripples.remove(0);
        ripples.add(new Ripple(x, y, Math.max(radius, dp(18)), color, SystemClock.uptimeMillis()));
        postInvalidateOnAnimation();
    }

    private void drawDpad(Canvas canvas) {
        float reach = dpadRadius * 0.92f;
        float arm = dpadRadius * 0.39f;
        buildCrossPath(reach, arm);
        boolean active = dpadPointer >= 0;

        canvas.save();
        canvas.translate(dpadCx, dpadCy + dp(4));
        fill.setShader(null);
        fill.setColor(0xA8000000);
        fill.setPathEffect(crossCorners);
        canvas.drawPath(cross, fill);
        fill.setPathEffect(null);
        canvas.restore();

        canvas.save();
        canvas.translate(dpadCx, dpadCy + (active ? dp(2) : 0));
        fill.setShader(new LinearGradient(-reach, -reach, reach, reach,
            new int[] {0xF2263346, 0xED121A28, 0xF0080D15},
            new float[] {0f, 0.52f, 1f}, Shader.TileMode.CLAMP));
        fill.setPathEffect(crossCorners);
        canvas.drawPath(cross, fill);
        fill.setPathEffect(null);
        fill.setShader(null);
        stroke.setPathEffect(crossCorners);
        stroke.setColor(active ? withAlpha(CYAN, 0xD8) : 0xA6788CAA);
        stroke.setStrokeWidth(dp(active ? 1.7f : 1f));
        canvas.drawPath(cross, stroke);
        stroke.setPathEffect(null);
        canvas.restore();

        float distance = dpadRadius * 0.62f;
        float size = dpadRadius * 0.14f;
        drawArrow(canvas, dpadCx, dpadCy - distance, size, 0, heldDpadCodes.contains(PAD_UP));
        drawArrow(canvas, dpadCx + distance, dpadCy, size, 90, heldDpadCodes.contains(PAD_RIGHT));
        drawArrow(canvas, dpadCx, dpadCy + distance, size, 180, heldDpadCodes.contains(PAD_DOWN));
        drawArrow(canvas, dpadCx - distance, dpadCy, size, 270, heldDpadCodes.contains(PAD_LEFT));

        float center = dpadRadius * 0.285f;
        glow.setShader(new RadialGradient(dpadCx - center * 0.28f, dpadCy - center * 0.34f, center * 1.45f,
            new int[] {0xA32A3A50, 0xF00C121D, 0xFF070B12},
            new float[] {0f, 0.55f, 1f}, Shader.TileMode.CLAMP));
        canvas.drawCircle(dpadCx, dpadCy, center, glow);
        glow.setShader(null);
        stroke.setColor(0x6A7D94B5);
        stroke.setStrokeWidth(dp(1));
        canvas.drawCircle(dpadCx, dpadCy, center, stroke);
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

    private void drawArrow(Canvas canvas, float cx, float cy, float size, float degrees, boolean active) {
        canvas.save();
        canvas.rotate(degrees, cx, cy);
        arrow.reset();
        arrow.moveTo(cx, cy - size);
        arrow.lineTo(cx + size * 0.78f, cy + size * 0.58f);
        arrow.lineTo(cx - size * 0.78f, cy + size * 0.58f);
        arrow.close();
        if (active) {
            glow.setShader(new RadialGradient(cx, cy, size * 2.7f,
                new int[] {withAlpha(CYAN, 0xA0), withAlpha(CYAN, 0x28), 0x00000000},
                new float[] {0f, 0.56f, 1f}, Shader.TileMode.CLAMP));
            canvas.drawCircle(cx, cy, size * 2.7f, glow);
            glow.setShader(null);
        }
        accent.setColor(active ? WHITE : 0xDDE8F0FF);
        canvas.drawPath(arrow, accent);
        canvas.restore();
    }

    private void drawStick(Canvas canvas, boolean left) {
        float cx = left ? leftStickCx : rightStickCx;
        float cy = left ? leftStickCy : rightStickCy;
        float nx = left ? leftStickX : rightStickX;
        float ny = left ? leftStickY : rightStickY;
        boolean active = left ? leftStickPointer >= 0 : rightStickPointer >= 0;
        int color = left ? CYAN : VIOLET;
        float magnitude = Math.min(1f, (float)Math.sqrt(nx * nx + ny * ny));
        float knobX = cx + nx * stickRadius * 0.43f;
        float knobY = cy + ny * stickRadius * 0.43f;

        fill.setShader(new RadialGradient(cx - stickRadius * 0.25f, cy - stickRadius * 0.28f,
            stickRadius * 1.45f, new int[] {0xF22C3A50, 0xF1121A27, 0xFF070B12},
            new float[] {0f, 0.58f, 1f}, Shader.TileMode.CLAMP));
        canvas.drawCircle(cx, cy, stickRadius, fill);
        fill.setShader(null);
        stroke.setColor(withAlpha(color, active ? 0xD0 : 0x76));
        stroke.setStrokeWidth(dp(active ? 1.8f : 1.1f));
        canvas.drawCircle(cx, cy, stickRadius, stroke);
        stroke.setColor(0x237F94B5);
        canvas.drawCircle(cx, cy, stickRadius * 0.72f, stroke);
        stroke.setColor(withAlpha(color, 0x28));
        canvas.drawCircle(cx, cy, stickRadius * DEAD_ZONE, stroke);

        if (magnitude > 0.02f) {
            glow.setShader(new RadialGradient(knobX, knobY, stickKnobRadius * 1.8f,
                new int[] {withAlpha(color, Math.round(0x88 * magnitude)), withAlpha(color, 0x22), 0x00000000},
                new float[] {0f, 0.58f, 1f}, Shader.TileMode.CLAMP));
            canvas.drawCircle(knobX, knobY, stickKnobRadius * 1.8f, glow);
            glow.setShader(null);
        }
        fill.setShader(new RadialGradient(knobX - stickKnobRadius * 0.28f,
            knobY - stickKnobRadius * 0.32f, stickKnobRadius * 1.35f,
            new int[] {blend(0xFF3C4D68, color, magnitude * 0.42f),
                blend(0xFF172130, color, magnitude * 0.30f), 0xFF080D15},
            new float[] {0f, 0.60f, 1f}, Shader.TileMode.CLAMP));
        canvas.drawCircle(knobX, knobY, stickKnobRadius, fill);
        fill.setShader(null);
        stroke.setColor(blend(0x8A8FA6C6, color, magnitude * 0.62f));
        stroke.setStrokeWidth(dp(1));
        canvas.drawCircle(knobX, knobY, stickKnobRadius, stroke);
        detail.setColor(0x28FFFFFF);
        detail.setStrokeWidth(dp(1));
        for (int i = 0; i < 3; i++) {
            canvas.drawCircle(knobX, knobY, stickKnobRadius * (0.36f + i * 0.18f), detail);
        }
        text.setColor(0xBFEAF2FF);
        text.setTextSize(stickRadius * 0.20f);
        drawCenteredText(canvas, left ? "L3" : "R3", knobX, knobY, text);
    }

    private void drawButton(Canvas canvas, ButtonSpec button) {
        float activation = activation(button.code);
        float shift = dp(2.4f) * activation;
        if (button.round) {
            float radius = button.radius * (1f - activation * 0.065f);
            float drawY = button.cy + shift;
            fill.setShader(null);
            fill.setColor(0xB5000000);
            canvas.drawCircle(button.cx, drawY + dp(4), radius * 1.02f, fill);
            if (activation > 0f) {
                glow.setShader(new RadialGradient(button.cx, drawY, radius * 1.65f,
                    new int[] {withAlpha(button.color, Math.round(0xA8 * activation)),
                        withAlpha(button.color, Math.round(0x42 * activation)), 0x00000000},
                    new float[] {0f, 0.56f, 1f}, Shader.TileMode.CLAMP));
                canvas.drawCircle(button.cx, drawY, radius * 1.65f, glow);
                glow.setShader(null);
            }
            fill.setShader(new RadialGradient(button.cx - radius * 0.28f, drawY - radius * 0.34f,
                radius * 1.55f,
                new int[] {blend(0xFF33445D, button.color, activation * 0.68f),
                    blend(SURFACE, button.color, activation * 0.80f),
                    blend(GRAPHITE, button.color, activation * 0.58f)},
                new float[] {0f, 0.58f, 1f}, Shader.TileMode.CLAMP));
            canvas.drawCircle(button.cx, drawY, radius, fill);
            fill.setShader(null);
            stroke.setColor(blend(withAlpha(button.color, 0xC2), WHITE, activation * 0.80f));
            stroke.setStrokeWidth(dp(activation > 0.01f ? 1.6f : 1f));
            canvas.drawCircle(button.cx, drawY, radius, stroke);
            stroke.setColor(0x24FFFFFF);
            canvas.drawCircle(button.cx, drawY, radius * 0.78f, stroke);
            text.setTextSize(button.radius * 0.88f);
            text.setColor(blend(WHITE, 0xFF071019, activation * 0.88f));
            drawCenteredText(canvas, button.label, button.cx, drawY, text);
        } else {
            scratchRect.set(button.rect);
            scratchRect.offset(0f, shift);
            float radius = scratchRect.height() * 0.5f;
            RectF shadow = new RectF(scratchRect);
            shadow.offset(0f, dp(3));
            fill.setShader(null);
            fill.setColor(0xA0000000);
            canvas.drawRoundRect(shadow, radius, radius, fill);
            if (activation > 0f) {
                RectF halo = new RectF(scratchRect);
                halo.inset(-dp(6), -dp(5));
                glow.setShader(new LinearGradient(halo.left, halo.centerY(), halo.right, halo.centerY(),
                    new int[] {0x00000000, withAlpha(button.color, Math.round(0x92 * activation)), 0x00000000},
                    null, Shader.TileMode.CLAMP));
                canvas.drawRoundRect(halo, halo.height() * 0.5f, halo.height() * 0.5f, glow);
                glow.setShader(null);
            }
            fill.setShader(new LinearGradient(scratchRect.left, scratchRect.top,
                scratchRect.right, scratchRect.bottom,
                new int[] {blend(SURFACE_HIGH, button.color, activation * 0.58f),
                    blend(GRAPHITE, button.color, activation * 0.75f)},
                null, Shader.TileMode.CLAMP));
            canvas.drawRoundRect(scratchRect, radius, radius, fill);
            fill.setShader(null);
            stroke.setColor(blend(withAlpha(button.color, 0xA4), WHITE, activation * 0.72f));
            stroke.setStrokeWidth(dp(activation > 0.01f ? 1.5f : 1f));
            canvas.drawRoundRect(scratchRect, radius, radius, stroke);
            detail.setColor(0x33FFFFFF);
            detail.setStrokeWidth(dp(1));
            canvas.drawLine(scratchRect.left + radius * 0.8f, scratchRect.top + dp(4),
                scratchRect.right - radius * 0.8f, scratchRect.top + dp(4), detail);
            text.setTextSize(button.rect.height() * 0.39f);
            text.setColor(blend(0xFFF0F5FF, 0xFF071019, activation * 0.82f));
            drawCenteredText(canvas, button.label, scratchRect.centerX(), scratchRect.centerY(), text);
        }
    }

    private float activation(int code) {
        if (heldButtonCounts.getOrDefault(code, 0) > 0) return 1f;
        return pressEnergy.getOrDefault(code, 0f);
    }

    private void advanceAnimation() {
        long now = SystemClock.uptimeMillis();
        if (lastAnimationTime == 0L) lastAnimationTime = now;
        float elapsed = Math.min(34f, now - lastAnimationTime);
        lastAnimationTime = now;
        boolean animate = !ripples.isEmpty();
        for (Integer code : new HashSet<>(pressEnergy.keySet())) {
            if (heldButtonCounts.getOrDefault(code, 0) > 0) {
                pressEnergy.put(code, 1f);
            } else {
                float next = Math.max(0f, pressEnergy.getOrDefault(code, 0f) - elapsed / 125f);
                if (next <= 0f) pressEnergy.remove(code); else pressEnergy.put(code, next);
                animate |= next > 0f;
            }
        }
        if (animate) postInvalidateOnAnimation();
    }

    private void drawCenteredText(Canvas canvas, String value, float cx, float cy, Paint paint) {
        canvas.drawText(value, cx, cy - (paint.ascent() + paint.descent()) * 0.5f, paint);
    }

    private int blend(int from, int to, float amount) {
        float t = Math.max(0f, Math.min(1f, amount));
        return Color.argb(
            Math.round(Color.alpha(from) + (Color.alpha(to) - Color.alpha(from)) * t),
            Math.round(Color.red(from) + (Color.red(to) - Color.red(from)) * t),
            Math.round(Color.green(from) + (Color.green(to) - Color.green(from)) * t),
            Math.round(Color.blue(from) + (Color.blue(to) - Color.blue(from)) * t));
    }

    @Override
    public boolean onTouchEvent(MotionEvent event) {
        if (!controlsVisible) return false;
        int action = event.getActionMasked();
        int index = event.getActionIndex();
        switch (action) {
            case MotionEvent.ACTION_DOWN:
            case MotionEvent.ACTION_POINTER_DOWN:
                if (getParent() != null) getParent().requestDisallowInterceptTouchEvent(true);
                capturePointer(event.getPointerId(index), event.getX(index), event.getY(index),
                    event.getTouchMajor(index));
                break;
            case MotionEvent.ACTION_MOVE:
                for (int i = 0; i < event.getPointerCount(); i++) {
                    updatePointer(event.getPointerId(i), event.getX(i), event.getY(i),
                        event.getTouchMajor(i));
                }
                break;
            case MotionEvent.ACTION_UP:
            case MotionEvent.ACTION_POINTER_UP:
                releasePointer(event.getPointerId(index));
                if (action == MotionEvent.ACTION_UP && getParent() != null)
                    getParent().requestDisallowInterceptTouchEvent(false);
                break;
            case MotionEvent.ACTION_CANCEL:
                releaseAllTouches();
                if (getParent() != null) getParent().requestDisallowInterceptTouchEvent(false);
                break;
            default:
                break;
        }
        return true;
    }

    private void capturePointer(int pointerId, float x, float y, float touchMajor) {
        if (leftStickPointer < 0 && leftStickBounds.contains(x, y)) {
            leftStickPointer = pointerId;
            pointers.put(pointerId, PointerCapture.leftStick(x, y));
            updateAnalog(true, x, y);
            addRipple(x, y, stickRadius, CYAN);
            haptic();
            invalidate();
            return;
        }
        if (rightStickPointer < 0 && rightStickBounds.contains(x, y)) {
            rightStickPointer = pointerId;
            pointers.put(pointerId, PointerCapture.rightStick(x, y));
            updateAnalog(false, x, y);
            addRipple(x, y, stickRadius, VIOLET);
            haptic();
            invalidate();
            return;
        }
        if (dpadPointer < 0 && dpadBounds.contains(x, y)) {
            dpadPointer = pointerId;
            pointers.put(pointerId, PointerCapture.dpad());
            updateDpad(x, y);
            addRipple(x, y, dpadRadius, CYAN);
            haptic();
            invalidate();
            return;
        }
        Set<Integer> codes = hitButtonCodes(x, y, touchMajor);
        pointers.put(pointerId, PointerCapture.buttons(codes));
        for (Integer code : codes) pressButton(code);
        if (!codes.isEmpty()) {
            ButtonSpec visual = buttonByCode.get(codes.iterator().next());
            addRipple(x, y, visual != null && visual.round ? visual.radius : dp(28),
                visual == null ? CYAN : visual.color);
            haptic();
            invalidate();
        }
    }

    private void updatePointer(int pointerId, float x, float y, float touchMajor) {
        PointerCapture capture = pointers.get(pointerId);
        if (capture == null) return;
        if (capture.kind == CaptureKind.LEFT_STICK) {
            capture.noteMovement(x, y, stickRadius * 0.22f);
            updateAnalog(true, x, y);
        } else if (capture.kind == CaptureKind.RIGHT_STICK) {
            capture.noteMovement(x, y, stickRadius * 0.22f);
            updateAnalog(false, x, y);
        } else if (capture.kind == CaptureKind.DPAD) {
            updateDpad(x, y);
        } else if (capture.kind == CaptureKind.BUTTON) {
            updateButtonHover(capture, x, y, touchMajor);
        }
    }

    private void updateButtonHover(PointerCapture capture, float x, float y, float touchMajor) {
        Set<Integer> desired = hitButtonCodes(x, y, touchMajor);
        // Sticky release zones prevent a held chord from flickering as fingers roll.
        for (Integer code : new HashSet<>(capture.codes)) {
            ButtonSpec button = buttonByCode.get(code);
            if (button != null && button.containsRelease(x, y, touchMajor)) desired.add(code);
        }
        if (desired.equals(capture.codes)) return;
        for (Integer code : new HashSet<>(capture.codes)) {
            if (!desired.contains(code)) releaseButton(code);
        }
        boolean added = false;
        for (Integer code : desired) {
            if (!capture.codes.contains(code)) {
                pressButton(code);
                added = true;
            }
        }
        capture.codes.clear();
        capture.codes.addAll(desired);
        if (added && !desired.isEmpty()) {
            ButtonSpec visual = buttonByCode.get(desired.iterator().next());
            addRipple(x, y, visual != null && visual.round ? visual.radius : dp(28),
                visual == null ? CYAN : visual.color);
            haptic();
        }
        postInvalidateOnAnimation();
    }

    private void releasePointer(int pointerId) {
        PointerCapture capture = pointers.get(pointerId);
        pointers.remove(pointerId);
        if (capture == null) return;
        switch (capture.kind) {
            case LEFT_STICK:
                leftStickPointer = -1;
                leftStickX = 0f;
                leftStickY = 0f;
                leftStickHapticSector = -2;
                GameDeckPs2Engine.touchAnalog(playerSlot, true, 0f, 0f);
                if (!capture.moved) tapStickClick(PAD_L3);
                break;
            case RIGHT_STICK:
                rightStickPointer = -1;
                rightStickX = 0f;
                rightStickY = 0f;
                rightStickHapticSector = -2;
                GameDeckPs2Engine.touchAnalog(playerSlot, false, 0f, 0f);
                if (!capture.moved) tapStickClick(PAD_R3);
                break;
            case DPAD:
                dpadPointer = -1;
                setDpadCodes(new HashSet<>());
                break;
            case BUTTON:
                for (Integer code : new HashSet<>(capture.codes)) releaseButton(code);
                capture.codes.clear();
                break;
            default:
                break;
        }
        invalidate();
    }


    private void tapStickClick(int code) {
        final int slot = playerSlot;
        GameDeckPs2Engine.touchButton(slot, code, true);
        haptic();
        main.postDelayed(() -> GameDeckPs2Engine.touchButton(slot, code, false), 72L);
    }

    private void updateAnalog(boolean left, float x, float y) {
        float cx = left ? leftStickCx : rightStickCx;
        float cy = left ? leftStickCy : rightStickCy;
        float dx = (x - cx) / Math.max(1f, stickRadius);
        float dy = (y - cy) / Math.max(1f, stickRadius);
        float length = (float) Math.sqrt(dx * dx + dy * dy);
        if (length > 1f) {
            dx /= length;
            dy /= length;
            length = 1f;
        }
        if (length < DEAD_ZONE) {
            dx = 0f;
            dy = 0f;
        } else {
            float scaled = (length - DEAD_ZONE) / (1f - DEAD_ZONE);
            dx = dx / length * scaled;
            dy = dy / length * scaled;
        }
        updateStickHaptics(left, dx, dy);
        if (left) {
            leftStickX = dx;
            leftStickY = dy;
        } else {
            rightStickX = dx;
            rightStickY = dy;
        }
        GameDeckPs2Engine.touchAnalog(playerSlot, left, dx, dy);
        invalidate();
    }

    private void updateStickHaptics(boolean left, float x, float y) {
        float magnitude = (float) Math.sqrt(x * x + y * y);
        int sector;
        if (magnitude < 0.08f) {
            sector = 0;
        } else {
            double angle = Math.atan2(y, x) + Math.PI * 2.0;
            sector = 1 + ((int) Math.floor((angle + Math.PI / 8.0) / (Math.PI / 4.0)) & 7);
        }
        int previous = left ? leftStickHapticSector : rightStickHapticSector;
        long lastAt = left ? lastLeftStickHapticAt : lastRightStickHapticAt;
        long now = SystemClock.uptimeMillis();
        if (previous == -2) {
            if (left) leftStickHapticSector = sector;
            else rightStickHapticSector = sector;
            return;
        }
        if (sector == previous || now - lastAt < 48L) return;
        int feedback = sector == 0
            ? HapticFeedbackConstants.KEYBOARD_TAP
            : HapticFeedbackConstants.CLOCK_TICK;
        performHapticFeedback(feedback, HapticFeedbackConstants.FLAG_IGNORE_GLOBAL_SETTING);
        if (left) {
            leftStickHapticSector = sector;
            lastLeftStickHapticAt = now;
        } else {
            rightStickHapticSector = sector;
            lastRightStickHapticAt = now;
        }
    }

    private void updateDpad(float x, float y) {
        float dx = x - dpadCx;
        float dy = y - dpadCy;
        float threshold = dpadRadius * 0.18f;
        Set<Integer> next = new HashSet<>();
        if (dy < -threshold) next.add(PAD_UP);
        if (dy > threshold) next.add(PAD_DOWN);
        if (dx < -threshold) next.add(PAD_LEFT);
        if (dx > threshold) next.add(PAD_RIGHT);
        setDpadCodes(next);
    }

    private void setDpadCodes(Set<Integer> next) {
        if (!next.equals(heldDpadCodes)) {
            long now = SystemClock.uptimeMillis();
            if (now - lastDpadHapticAt >= 48L) {
                performHapticFeedback(next.isEmpty()
                    ? HapticFeedbackConstants.KEYBOARD_TAP
                    : HapticFeedbackConstants.CLOCK_TICK,
                    HapticFeedbackConstants.FLAG_IGNORE_GLOBAL_SETTING);
                lastDpadHapticAt = now;
            }
        }
        for (Integer code : new HashSet<>(heldDpadCodes)) {
            if (!next.contains(code)) {
                GameDeckPs2Engine.touchButton(playerSlot, code, false);
                heldDpadCodes.remove(code);
            }
        }
        for (Integer code : next) {
            if (!heldDpadCodes.contains(code)) {
                GameDeckPs2Engine.touchButton(playerSlot, code, true);
                heldDpadCodes.add(code);
            }
        }
        invalidate();
    }

    private Set<Integer> hitButtonCodes(float x, float y, float touchMajor) {
        Set<Integer> result = new HashSet<>();
        float contact = Math.min(dp(18), Math.max(dp(2), touchMajor * 0.22f));
        for (ButtonSpec button : buttons) {
            if (button.containsContact(x, y, contact + buttonHitSlop(button.code))) result.add(button.code);
        }
        return result;
    }

    private float buttonHitSlop(int code) {
        if (code == PAD_START || code == PAD_SELECT) return dp(8);
        if (code == PAD_L1 || code == PAD_L2 || code == PAD_R1 || code == PAD_R2) return dp(7);
        return dp(3);
    }

    private void pressButton(int code) {
        int count = heldButtonCounts.getOrDefault(code, 0) + 1;
        heldButtonCounts.put(code, count);
        pressEnergy.put(code, 1f);
        if (count == 1) GameDeckPs2Engine.touchButton(playerSlot, code, true);
        postInvalidateOnAnimation();
    }

    private void releaseButton(int code) {
        int count = Math.max(0, heldButtonCounts.getOrDefault(code, 0) - 1);
        if (count == 0) {
            heldButtonCounts.remove(code);
            GameDeckPs2Engine.touchButton(playerSlot, code, false);
            pressEnergy.put(code, 1f);
        } else {
            heldButtonCounts.put(code, count);
        }
    }

    void releaseAllTouches() {
        for (Integer code : new HashSet<>(heldButtonCounts.keySet())) {
            GameDeckPs2Engine.touchButton(playerSlot, code, false);
        }
        heldButtonCounts.clear();
        pressEnergy.clear();
        ripples.clear();
        setDpadCodes(new HashSet<>());
        GameDeckPs2Engine.touchAnalog(playerSlot, true, 0f, 0f);
        GameDeckPs2Engine.touchAnalog(playerSlot, false, 0f, 0f);
        leftStickPointer = -1;
        rightStickPointer = -1;
        dpadPointer = -1;
        leftStickX = leftStickY = rightStickX = rightStickY = 0f;
        leftStickHapticSector = rightStickHapticSector = -2;
        pointers.clear();
        invalidate();
    }

    void notePhysicalControllerInput() {
        physicalControllerGeneration++;
        long generation = physicalControllerGeneration;
        if (controlsVisible) {
            controlsVisible = false;
            animate().cancel();
            animate().alpha(0f).setDuration(160).withEndAction(() -> setVisibility(INVISIBLE)).start();
        }
        main.postDelayed(() -> {
            if (physicalControllerGeneration != generation) return;
            controlsVisible = true;
            setAlpha(0f);
            setVisibility(VISIBLE);
            animate().alpha(1f).setDuration(220).start();
            invalidate();
        }, PHYSICAL_CONTROLLER_HIDE_MS);
    }

    void showTouchControls() {
        setPhoneControlsEnabled(true, playerSlot);
    }

    void setPhoneControlsEnabled(boolean enabled, int slot) {
        int nextSlot = Math.max(0, Math.min(7, slot));
        if (playerSlot != nextSlot) releaseAllTouches();
        playerSlot = nextSlot;
        physicalControllerGeneration++;
        controlsVisible = enabled;
        animate().cancel();
        if (enabled) {
            setVisibility(VISIBLE);
            animate().alpha(1f).setDuration(180).start();
        } else {
            releaseAllTouches();
            animate().alpha(0f).setDuration(140).withEndAction(() -> setVisibility(INVISIBLE)).start();
        }
        invalidate();
    }

    private void haptic() {
        int constant = Build.VERSION.SDK_INT >= 27
            ? HapticFeedbackConstants.KEYBOARD_TAP
            : HapticFeedbackConstants.VIRTUAL_KEY;
        performHapticFeedback(constant, HapticFeedbackConstants.FLAG_IGNORE_GLOBAL_SETTING);
    }

    private int withAlpha(int color, int alpha) {
        return Color.argb(alpha, Color.red(color), Color.green(color), Color.blue(color));
    }

    private float dp(float value) { return value * density; }

    private static final class Ripple {
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

    private enum CaptureKind { UNBOUND, BUTTON, DPAD, LEFT_STICK, RIGHT_STICK }

    private static final class PointerCapture {
        final CaptureKind kind;
        final Set<Integer> codes = new HashSet<>();
        final float startX;
        final float startY;
        boolean moved;

        private PointerCapture(CaptureKind kind, Set<Integer> codes, float startX, float startY) {
            this.kind = kind;
            if (codes != null) this.codes.addAll(codes);
            this.startX = startX;
            this.startY = startY;
        }

        void noteMovement(float x, float y, float threshold) {
            float dx = x - startX;
            float dy = y - startY;
            if (dx * dx + dy * dy > threshold * threshold) moved = true;
        }

        static PointerCapture unbound() { return new PointerCapture(CaptureKind.UNBOUND, null, 0f, 0f); }
        static PointerCapture buttons(Set<Integer> codes) { return new PointerCapture(CaptureKind.BUTTON, codes, 0f, 0f); }
        static PointerCapture dpad() { return new PointerCapture(CaptureKind.DPAD, null, 0f, 0f); }
        static PointerCapture leftStick(float x, float y) { return new PointerCapture(CaptureKind.LEFT_STICK, null, x, y); }
        static PointerCapture rightStick(float x, float y) { return new PointerCapture(CaptureKind.RIGHT_STICK, null, x, y); }
    }

    private static final class ButtonSpec {
        final int code;
        final String label;
        final boolean round;
        final float cx;
        final float cy;
        final float radius;
        final RectF rect;
        final int color;

        private ButtonSpec(int code, String label, boolean round, float cx, float cy,
                           float radius, RectF rect, int color) {
            this.code = code;
            this.label = label;
            this.round = round;
            this.cx = cx;
            this.cy = cy;
            this.radius = radius;
            this.rect = rect;
            this.color = color;
        }

        static ButtonSpec round(int code, String label, float cx, float cy, float radius, int color) {
            return new ButtonSpec(code, label, true, cx, cy, radius, null, color);
        }

        static ButtonSpec pill(int code, String label, RectF rect, int color) {
            return new ButtonSpec(code, label, false, 0f, 0f, 0f, rect, color);
        }

        boolean containsContact(float x, float y, float contact) {
            if (!round) {
                RectF hit = new RectF(rect);
                hit.inset(-contact * 0.55f, -contact * 0.55f);
                return hit.contains(x, y);
            }
            float dx = x - cx;
            float dy = y - cy;
            float hitRadius = radius * 1.18f + contact;
            return dx * dx + dy * dy <= hitRadius * hitRadius;
        }

        boolean containsRelease(float x, float y, float touchMajor) {
            float slop = Math.max(radius * 0.20f, touchMajor * 0.28f);
            if (!round) {
                RectF release = new RectF(rect);
                release.inset(-slop, -slop);
                return release.contains(x, y);
            }
            float dx = x - cx;
            float dy = y - cy;
            float releaseRadius = radius * 1.42f + slop;
            return dx * dx + dy * dy <= releaseRadius * releaseRadius;
        }

        boolean intersects(RectF other) {
            if (!round) return RectF.intersects(rect, other);
            float nearestX = Math.max(other.left, Math.min(cx, other.right));
            float nearestY = Math.max(other.top, Math.min(cy, other.bottom));
            float dx = cx - nearestX;
            float dy = cy - nearestY;
            float hitRadius = radius * 1.22f;
            return dx * dx + dy * dy < hitRadius * hitRadius;
        }
    }
}
