package io.gamedeck.mobile;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.ColorMatrix;
import android.graphics.ColorMatrixColorFilter;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.Shader;
import android.os.Build;
import android.graphics.RenderEffect;
import android.view.View;

/** Low-frequency frame-derived ambience behind a zero-copy game SurfaceView. */
final class GameDeckAmbientView extends View {
    private final Paint bitmapPaint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG | Paint.DITHER_FLAG);
    private final Paint scrimPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Rect source = new Rect();
    private final RectF destination = new RectF();
    private Bitmap frame;

    GameDeckAmbientView(Context context) {
        super(context);
        setWillNotDraw(false);
        setBackgroundColor(0xFF04070C);
        ColorMatrix saturation = new ColorMatrix();
        saturation.setSaturation(1.32f);
        ColorMatrix brightness = new ColorMatrix(new float[]{
            0.82f, 0, 0, 0, 0,
            0, 0.82f, 0, 0, 0,
            0, 0, 0.82f, 0, 0,
            0, 0, 0, 1, 0
        });
        saturation.postConcat(brightness);
        bitmapPaint.setColorFilter(new ColorMatrixColorFilter(saturation));
        if (Build.VERSION.SDK_INT >= 31) {
            setRenderEffect(RenderEffect.createBlurEffect(dp(34), dp(34), Shader.TileMode.CLAMP));
        }
    }

    void setFrame(Bitmap next) {
        Bitmap old = frame;
        frame = next;
        if (old != null && old != next && !old.isRecycled()) old.recycle();
        postInvalidateOnAnimation();
    }

    void release() {
        Bitmap old = frame;
        frame = null;
        if (old != null && !old.isRecycled()) old.recycle();
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        Bitmap bitmap = frame;
        if (bitmap == null || bitmap.isRecycled() || bitmap.getWidth() <= 0 || bitmap.getHeight() <= 0) {
            scrimPaint.setShader(new LinearGradient(0, 0, getWidth(), getHeight(),
                new int[]{0xFF07111D, 0xFF100B1A, 0xFF050810}, null, Shader.TileMode.CLAMP));
            canvas.drawRect(0, 0, getWidth(), getHeight(), scrimPaint);
            scrimPaint.setShader(null);
            return;
        }
        source.set(0, 0, bitmap.getWidth(), bitmap.getHeight());
        float scale = Math.max((float) getWidth() / bitmap.getWidth(), (float) getHeight() / bitmap.getHeight()) * 1.16f;
        float width = bitmap.getWidth() * scale;
        float height = bitmap.getHeight() * scale;
        destination.set((getWidth() - width) * 0.5f, (getHeight() - height) * 0.5f,
            (getWidth() + width) * 0.5f, (getHeight() + height) * 0.5f);
        canvas.drawBitmap(bitmap, source, destination, bitmapPaint);
        scrimPaint.setShader(new LinearGradient(0, 0, 0, getHeight(),
            new int[]{0x50000000, 0x28000000, 0x6A000000}, null, Shader.TileMode.CLAMP));
        canvas.drawRect(0, 0, getWidth(), getHeight(), scrimPaint);
        scrimPaint.setShader(null);
    }

    private float dp(float value) { return value * getResources().getDisplayMetrics().density; }
}
