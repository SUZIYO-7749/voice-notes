package com.voicenotes.nativeapp;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.util.AttributeSet;
import android.view.MotionEvent;
import android.view.View;

/**
 * 波形控件：把峰值序列画成一条条竖柱，已播放部分高亮。
 * 既可当只读缩略图（列表里），也可开启点击定位（详情页）。
 */
public class WaveView extends View {

    public interface OnSeekListener {
        /** @param ratio 0~1 的点击位置 */
        void onSeek(float ratio);
    }

    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private int[] peaks = new int[0];
    private float progress;
    private int activeColor = 0xFF8B7CFF;
    private int idleColor = 0xFF2D3546;
    private boolean seekable;
    private OnSeekListener seekListener;

    public WaveView(Context context) {
        super(context);
        init();
    }

    public WaveView(Context context, AttributeSet attrs) {
        super(context, attrs);
        init();
    }

    public WaveView(Context context, AttributeSet attrs, int defStyle) {
        super(context, attrs, defStyle);
        init();
    }

    private void init() {
        paint.setStyle(Paint.Style.FILL);
    }

    public void setColors(int active, int idle) {
        this.activeColor = active;
        this.idleColor = idle;
        invalidate();
    }

    public void setPeaks(int[] value) {
        this.peaks = value == null ? new int[0] : value;
        invalidate();
    }

    public void setProgress(float value) {
        float clamped = value < 0f ? 0f : (value > 1f ? 1f : value);
        if (Math.abs(clamped - progress) < 0.001f) return;
        progress = clamped;
        invalidate();
    }

    public void setSeekable(boolean value) {
        seekable = value;
    }

    public void setOnSeekListener(OnSeekListener listener) {
        this.seekListener = listener;
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        int w = getWidth();
        int h = getHeight();
        if (w <= 0 || h <= 0) return;

        Context ctx = getContext();
        int gap = Math.max(1, Ui.dp(ctx, 1.5f));
        int barW = Math.max(2, Ui.dp(ctx, 2.5f));
        int count = Math.max(1, (w + gap) / (barW + gap));
        int[] bars = Ui.resample(peaks, count);
        // 用整段录音的最大值归一化，波形不会随窗口变化而跳动
        int peak = Ui.peakOf(peaks);
        float minAmp = Math.max(2f, Ui.dp(ctx, 2f));
        float mid = h / 2f;
        float cut = w * progress;

        for (int i = 0; i < bars.length; i++) {
            float x = i * (float) (barW + gap);
            float amp = Math.max(minAmp, bars[i] / (float) peak * (h * 0.92f));
            paint.setColor(x + barW <= cut ? activeColor : idleColor);
            canvas.drawRect(x, mid - amp / 2f, x + barW, mid + amp / 2f, paint);
        }

        if (progress > 0f && progress < 1f) {
            paint.setColor(activeColor);
            canvas.drawRect(cut - 1f, 0f, cut + 1f, h, paint);
        }
    }

    @Override
    public boolean onTouchEvent(MotionEvent event) {
        if (!seekable || seekListener == null || getWidth() <= 0) {
            return super.onTouchEvent(event);
        }
        switch (event.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
            case MotionEvent.ACTION_MOVE:
                if (getParent() != null) getParent().requestDisallowInterceptTouchEvent(true);
                float ratio = event.getX() / getWidth();
                seekListener.onSeek(Math.max(0f, Math.min(1f, ratio)));
                return true;
            case MotionEvent.ACTION_UP:
            case MotionEvent.ACTION_CANCEL:
                if (getParent() != null) getParent().requestDisallowInterceptTouchEvent(false);
                return true;
            default:
                return super.onTouchEvent(event);
        }
    }
}
