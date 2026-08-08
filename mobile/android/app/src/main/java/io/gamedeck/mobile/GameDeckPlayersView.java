package io.gamedeck.mobile;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RadialGradient;
import android.graphics.RectF;
import android.graphics.Shader;
import android.graphics.Typeface;
import android.view.HapticFeedbackConstants;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;

/** Premium in-game source-to-player assignment panel shared by every emulator frontend. */
final class GameDeckPlayersView extends View {
    interface Listener {
        void onAssignmentsChanged();
        void onDismissed();
    }

    private static final int CYAN = 0xFF5EE7FF;
    private static final int VIOLET = 0xFF9B7BFF;
    private static final int WHITE = 0xFFF5F8FF;
    private static final int MUTED = 0xFFAAB7C8;

    private final GameDeckPlayerRouter router;
    private final Listener listener;
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint text = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.SUBPIXEL_TEXT_FLAG);
    private final Paint stroke = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final RectF panel = new RectF();
    private final RectF gameBounds = new RectF();
    private final RectF leftRail = new RectF();
    private final RectF rightRail = new RectF();
    private final RectF autoButton = new RectF();
    private final RectF doneButton = new RectF();
    private final RectF[] playerCards = new RectF[GameDeckPlayerRouter.MAX_PLAYERS];
    private final Path glowPath = new Path();
    private float density;
    private int selectedPlayer;
    private boolean sideRailLayout;

    GameDeckPlayersView(Context context, GameDeckPlayerRouter router, Listener listener) {
        super(context);
        this.router = router;
        this.listener = listener;
        density = getResources().getDisplayMetrics().density;
        for (int i = 0; i < playerCards.length; i++) playerCards[i] = new RectF();
        text.setTypeface(Typeface.create("sans-serif", Typeface.NORMAL));
        stroke.setStyle(Paint.Style.STROKE);
        setFocusable(true);
        setFocusableInTouchMode(true);
        setClickable(true);
        setBackgroundColor(Color.TRANSPARENT);
        setContentDescription("GameDeck player controller assignments");
    }

    void showPanel() {
        router.refreshDevices();
        layoutRegions(getWidth(), getHeight());
        setVisibility(VISIBLE);
        setAlpha(0f);
        requestFocus();
        animate().alpha(1f).setDuration(180).start();
        invalidate();
    }

    void hidePanel() {
        animate().alpha(0f).setDuration(140).withEndAction(() -> {
            setVisibility(GONE);
            if (listener != null) listener.onDismissed();
        }).start();
    }

    boolean isShowing() { return getVisibility() == VISIBLE; }

    void setGameBounds(float left, float top, float right, float bottom) {
        if (Math.abs(gameBounds.left - left) < 0.5f && Math.abs(gameBounds.top - top) < 0.5f
            && Math.abs(gameBounds.right - right) < 0.5f && Math.abs(gameBounds.bottom - bottom) < 0.5f) return;
        gameBounds.set(left, top, right, bottom);
        if (getWidth() > 0 && getHeight() > 0) layoutRegions(getWidth(), getHeight());
        invalidate();
    }

    @Override
    protected void onSizeChanged(int width, int height, int oldWidth, int oldHeight) {
        layoutRegions(width, height);
    }

    private void layoutRegions(int width, int height) {
        if (width <= 0 || height <= 0) return;
        if (gameBounds.width() <= 1f || gameBounds.height() <= 1f) {
            float gameW = Math.min(width, height * 4f / 3f);
            float gameH = Math.min(height, width * 3f / 4f);
            gameBounds.set((width - gameW) * 0.5f, (height - gameH) * 0.5f,
                (width + gameW) * 0.5f, (height + gameH) * 0.5f);
        }
        float margin = dp(10);
        float leftSpace = gameBounds.left;
        float rightSpace = width - gameBounds.right;
        sideRailLayout = leftSpace >= dp(112) && rightSpace >= dp(112);
        float gap = dp(10);
        if (sideRailLayout) {
            leftRail.set(margin, margin, Math.max(margin, gameBounds.left - margin), height - margin);
            rightRail.set(Math.min(width - margin, gameBounds.right + margin), margin, width - margin, height - margin);
            panel.set(0, 0, width, height);
            float cardTop = margin + dp(76);
            float actionTop = height - margin - dp(50);
            float cardGap = dp(10);
            float cardHeight = (actionTop - dp(14) - cardTop - cardGap) / 2f;
            playerCards[0].set(leftRail.left + dp(10), cardTop, leftRail.right - dp(10), cardTop + cardHeight);
            playerCards[1].set(leftRail.left + dp(10), cardTop + cardHeight + cardGap,
                leftRail.right - dp(10), actionTop - dp(14));
            playerCards[2].set(rightRail.left + dp(10), cardTop, rightRail.right - dp(10), cardTop + cardHeight);
            playerCards[3].set(rightRail.left + dp(10), cardTop + cardHeight + cardGap,
                rightRail.right - dp(10), actionTop - dp(14));
            autoButton.set(leftRail.left + dp(10), actionTop, leftRail.right - dp(10), height - margin - dp(8));
            doneButton.set(rightRail.left + dp(10), actionTop, rightRail.right - dp(10), height - margin - dp(8));
        } else {
            // Portrait uses one lower control dock; the top-aligned game remains untouched.
            leftRail.set(margin, Math.min(height - margin, gameBounds.bottom + margin), width - margin, height - margin);
            rightRail.setEmpty();
            panel.set(0, 0, width, height);
            float header = dp(58);
            float footer = dp(58);
            float cardGap = dp(10);
            float horizontalInset = dp(12);
            float cardWidth = (leftRail.width() - horizontalInset * 2f - cardGap) * 0.5f;
            float cardsTop = leftRail.top + header;
            float cardsBottom = leftRail.bottom - footer;
            float cardHeight = (cardsBottom - cardsTop - cardGap) * 0.5f;
            playerCards[0].set(leftRail.left + horizontalInset, cardsTop,
                leftRail.left + horizontalInset + cardWidth, cardsTop + cardHeight);
            playerCards[1].set(playerCards[0].right + cardGap, cardsTop,
                leftRail.right - horizontalInset, cardsTop + cardHeight);
            playerCards[2].set(leftRail.left + horizontalInset, playerCards[0].bottom + cardGap,
                leftRail.left + horizontalInset + cardWidth, cardsBottom);
            playerCards[3].set(playerCards[2].right + cardGap, playerCards[1].bottom + cardGap,
                leftRail.right - horizontalInset, cardsBottom);
            autoButton.set(leftRail.left + horizontalInset, leftRail.bottom - dp(48),
                leftRail.centerX() - dp(6), leftRail.bottom - dp(8));
            doneButton.set(leftRail.centerX() + dp(6), leftRail.bottom - dp(48),
                leftRail.right - horizontalInset, leftRail.bottom - dp(8));
        }
    }

    private void layoutHorizontalPair(RectF first, RectF second, RectF rail, boolean reserveHeader) {
        float top = rail.top + (reserveHeader ? dp(64) : dp(14));
        float bottom = rail.bottom - dp(58);
        float gap = dp(10);
        float width = (rail.width() - dp(24) - gap) * 0.5f;
        first.set(rail.left + dp(12), top, rail.left + dp(12) + width, bottom);
        second.set(first.right + gap, top, rail.right - dp(12), bottom);
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        // The game rectangle remains completely transparent and unobstructed.
        drawRail(canvas, leftRail, false);
        drawRail(canvas, rightRail, true);

        if (sideRailLayout) {
            drawText(canvas, "PLAYERS", leftRail.left + dp(16), leftRail.top + dp(30), dp(18), WHITE, true, Paint.Align.LEFT);
            drawText(canvas, router.isManualLayout() ? "CUSTOM" : "AUTO",
                rightRail.right - dp(16), rightRail.top + dp(28), dp(10), CYAN, true, Paint.Align.RIGHT);
            drawText(canvas, "P1 · P2", leftRail.left + dp(16), leftRail.top + dp(52), dp(10), MUTED, false, Paint.Align.LEFT);
            drawText(canvas, "P3 · P4", rightRail.left + dp(16), rightRail.top + dp(52), dp(10), MUTED, false, Paint.Align.LEFT);
        } else {
            drawText(canvas, "PLAYERS", leftRail.left + dp(16), leftRail.top + dp(30), dp(18), WHITE, true, Paint.Align.LEFT);
            drawText(canvas, router.isManualLayout() ? "CUSTOM ASSIGNMENT" : "AUTO ASSIGNMENT",
                leftRail.right - dp(16), leftRail.top + dp(28), dp(10), CYAN, true, Paint.Align.RIGHT);
        }

        for (int i = 0; i < playerCards.length; i++) drawPlayerCard(canvas, i, playerCards[i]);
        drawActionButton(canvas, autoButton, "AUTO", false);
        drawActionButton(canvas, doneButton, "DONE", true);
    }

    private void drawRail(Canvas canvas, RectF rail, boolean reverse) {
        if (rail.width() <= 0f || rail.height() <= 0f) return;
        paint.setShader(new LinearGradient(reverse ? rail.right : rail.left, rail.top,
            reverse ? rail.left : rail.right, rail.bottom,
            new int[]{0xF0182433, 0xEC0A1019, 0xE8151222}, null, Shader.TileMode.CLAMP));
        canvas.drawRoundRect(rail, dp(24), dp(24), paint);
        paint.setShader(null);
        stroke.setStrokeWidth(dp(1.1f));
        stroke.setColor(reverse ? 0x667F6FFF : 0x665EE7FF);
        canvas.drawRoundRect(rail, dp(24), dp(24), stroke);
        paint.setShader(new RadialGradient(reverse ? rail.right : rail.left, rail.top,
            Math.max(rail.width(), dp(110)),
            new int[]{reverse ? 0x229B7BFF : 0x225EE7FF, 0x00000000}, null, Shader.TileMode.CLAMP));
        canvas.drawRoundRect(rail, dp(24), dp(24), paint);
        paint.setShader(null);
    }

    private void drawPlayerCard(Canvas canvas, int index, RectF card) {
        if (card.width() <= 0f || card.height() <= 0f) return;
        boolean selected = selectedPlayer == index;
        GameDeckPlayerRouter.Source source = router.sourceAt(index);
        paint.setShader(new LinearGradient(card.left, card.top, card.right, card.bottom,
            selected ? new int[]{0xF02A3850, 0xED121A25} : new int[]{0xE51B2635, 0xE50E151F},
            null, Shader.TileMode.CLAMP));
        canvas.drawRoundRect(card, dp(16), dp(16), paint);
        paint.setShader(null);
        stroke.setStrokeWidth(selected ? dp(2) : dp(1));
        stroke.setColor(selected ? CYAN : 0x445EE7FF);
        canvas.drawRoundRect(card, dp(16), dp(16), stroke);

        float badge = Math.min(dp(38), card.height() * 0.28f);
        float badgeCx = card.left + dp(12) + badge * 0.5f;
        float badgeCy = card.top + dp(12) + badge * 0.5f;
        paint.setColor(source.phone ? 0x335EE7FF : source.deviceId >= 0 ? 0x339B7BFF : 0x221E2A38);
        canvas.drawCircle(badgeCx, badgeCy, badge * 0.5f, paint);
        stroke.setStrokeWidth(dp(1));
        stroke.setColor(source.phone ? CYAN : source.deviceId >= 0 ? VIOLET : 0x55798A9D);
        canvas.drawCircle(badgeCx, badgeCy, badge * 0.5f, stroke);
        drawText(canvas, "P" + (index + 1), badgeCx, badgeCy + dp(4), dp(12), WHITE, true, Paint.Align.CENTER);

        float textLeft = badgeCx + badge * 0.72f;
        float titleSize = card.width() < dp(150) ? dp(10.5f) : dp(12);
        drawText(canvas, source.label, textLeft, badgeCy + dp(1), titleSize, WHITE, true, Paint.Align.LEFT);
        drawText(canvas, source.detail, textLeft, badgeCy + dp(20), dp(8.5f), MUTED, false, Paint.Align.LEFT);
        drawText(canvas, "TAP TO CHANGE", card.centerX(), card.bottom - dp(12), dp(8),
            selected ? CYAN : 0xFF718198, true, Paint.Align.CENTER);
    }

    private void drawActionButton(Canvas canvas, RectF bounds, String label, boolean primary) {
        paint.setColor(primary ? 0xE65EE7FF : 0xCC172230);
        canvas.drawRoundRect(bounds, dp(18), dp(18), paint);
        stroke.setStrokeWidth(dp(1));
        stroke.setColor(primary ? 0xFFBDF7FF : 0x667BEAFF);
        canvas.drawRoundRect(bounds, dp(18), dp(18), stroke);
        drawText(canvas, label, bounds.centerX(), bounds.centerY() + dp(5), dp(12),
            primary ? 0xFF071019 : WHITE, true, Paint.Align.CENTER);
    }

    private void drawText(Canvas canvas, String value, float x, float y, float size, int color,
                          boolean bold, Paint.Align align) {
        text.setTextSize(size);
        text.setColor(color);
        text.setTextAlign(align);
        text.setTypeface(Typeface.create("sans-serif", bold ? Typeface.BOLD : Typeface.NORMAL));
        canvas.drawText(value, x, y, text);
    }

    @Override
    public boolean onTouchEvent(MotionEvent event) {
        if (event.getActionMasked() != MotionEvent.ACTION_UP) return true;
        float x = event.getX();
        float y = event.getY();
        for (int i = 0; i < playerCards.length; i++) {
            if (playerCards[i].contains(x, y)) {
                selectedPlayer = i;
                router.cycleSource(i);
                performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP);
                if (listener != null) listener.onAssignmentsChanged();
                invalidate();
                return true;
            }
        }
        if (autoButton.contains(x, y)) {
            router.applyAuto();
            performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP);
            if (listener != null) listener.onAssignmentsChanged();
            invalidate();
            return true;
        }
        if (doneButton.contains(x, y) || gameBounds.contains(x, y)
            || (!leftRail.contains(x, y) && !rightRail.contains(x, y))) {
            hidePanel();
            return true;
        }
        return true;
    }

    boolean handleKeyEvent(KeyEvent event) {
        if (!isShowing() || event.getAction() != KeyEvent.ACTION_DOWN || event.getRepeatCount() > 0) return false;
        switch (event.getKeyCode()) {
            case KeyEvent.KEYCODE_DPAD_LEFT:
                selectedPlayer = (selectedPlayer + 3) % 4;
                invalidate();
                return true;
            case KeyEvent.KEYCODE_DPAD_RIGHT:
                selectedPlayer = (selectedPlayer + 1) % 4;
                invalidate();
                return true;
            case KeyEvent.KEYCODE_BUTTON_A:
            case KeyEvent.KEYCODE_DPAD_CENTER:
                router.cycleSource(selectedPlayer);
                if (listener != null) listener.onAssignmentsChanged();
                invalidate();
                return true;
            case KeyEvent.KEYCODE_BUTTON_Y:
                router.applyAuto();
                if (listener != null) listener.onAssignmentsChanged();
                invalidate();
                return true;
            case KeyEvent.KEYCODE_BUTTON_B:
            case KeyEvent.KEYCODE_BACK:
            case KeyEvent.KEYCODE_BUTTON_START:
                hidePanel();
                return true;
            default:
                return false;
        }
    }

    private float dp(float value) { return value * density; }
}
