package com.voicenotes.nativeapp;

import android.content.Context;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

/**
 * 纯原生的录音引擎：直接调 MediaRecorder 录成 AAC/.m4a。
 * 波形不靠解码，而是每 50ms 采一次 getMaxAmplitude()，和录音同步攒出峰值序列。
 */
public class Recorder {

    public interface Listener {
        /** @param level 0~100 的即时音量 */
        void onTick(long elapsedMs, int level);
        void onError(String message);
    }

    /** 太短的录音 MediaRecorder 会写出损坏文件，直接丢弃 */
    private static final long MIN_DURATION_MS = 700;
    private static final int SAMPLE_INTERVAL_MS = 50;

    public static class Result {
        public File file;
        public long durationMs;
        public int[] peaks = new int[0];
        public boolean ok;
        public String error;
    }

    private final Context context;
    private final Listener listener;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final List<Integer> peaks = new ArrayList<>();

    private MediaRecorder recorder;
    private File outputFile;
    private long elapsedMs;
    private long lastSampleAt;
    private boolean active;      // 已经开始、尚未 stop
    private boolean paused;

    public Recorder(Context context, Listener listener) {
        this.context = context.getApplicationContext();
        this.listener = listener;
    }

    public boolean isActive() { return active; }

    public boolean isPaused() { return paused; }

    public long elapsedMs() { return elapsedMs; }

    public int[] peaks() { return toArray(peaks); }

    /** @param out 录音写入的目标文件，调用方负责建目录 */
    public void start(File out) throws IOException {
        if (active) return;
        outputFile = out;

        MediaRecorder r;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            r = new MediaRecorder(context);
        } else {
            r = new MediaRecorder();
        }

        r.setAudioSource(MediaRecorder.AudioSource.MIC);
        r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
        r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
        r.setAudioSamplingRate(44100);
        r.setAudioEncodingBitRate(96000);
        r.setAudioChannels(1);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            r.setOutputFile(out);
        } else {
            r.setOutputFile(out.getAbsolutePath());
        }

        r.prepare();
        r.start();

        recorder = r;
        peaks.clear();
        elapsedMs = 0;
        paused = false;
        active = true;
        lastSampleAt = SystemClock.elapsedRealtime();
        handler.postDelayed(sampler, SAMPLE_INTERVAL_MS);
    }

    public void pause() {
        if (!active || paused || recorder == null) return;
        try {
            // pause() 需要 API 24+
            recorder.pause();
            paused = true;
        } catch (Exception e) {
            listener.onError("暂停失败：" + e.getMessage());
        }
    }

    public void resume() {
        if (!active || !paused || recorder == null) return;
        try {
            recorder.resume();
            paused = false;
            lastSampleAt = SystemClock.elapsedRealtime();
        } catch (Exception e) {
            listener.onError("继续失败：" + e.getMessage());
        }
    }

    private final Runnable sampler = new Runnable() {
        @Override
        public void run() {
            if (!active) return;
            long now = SystemClock.elapsedRealtime();

            if (!paused) {
                elapsedMs += now - lastSampleAt;
                int level = 0;
                try {
                    if (recorder != null) {
                        // getMaxAmplitude 返回 0~32767
                        level = Math.min(100, recorder.getMaxAmplitude() * 100 / 32767);
                    }
                } catch (Exception ignored) {
                    // 采样失败不影响录音本身
                }
                peaks.add(level);
                listener.onTick(elapsedMs, level);
            }
            lastSampleAt = now;
            handler.postDelayed(this, SAMPLE_INTERVAL_MS);
        }
    };

    /** 结束录音并交出结果；文件是否有效由 ok 字段说明 */
    public Result stop() {
        Result result = new Result();
        result.file = outputFile;
        result.durationMs = elapsedMs;
        result.peaks = toArray(peaks);

        if (!active) {
            result.error = "没有正在进行的录音";
            return result;
        }

        active = false;
        paused = false;
        handler.removeCallbacks(sampler);

        MediaRecorder r = recorder;
        recorder = null;

        boolean threw = false;
        if (r != null) {
            try {
                r.stop();
            } catch (Exception e) {
                // 录音过短时 stop() 会抛异常，此时文件是坏的
                threw = true;
                result.error = "录音太短，没有保存";
            }
            try {
                r.release();
            } catch (Exception ignored) {
            }
        }

        boolean hasData = outputFile != null && outputFile.exists() && outputFile.length() > 0;
        if (threw || !hasData) {
            deleteQuietly(outputFile);
            result.ok = false;
            if (result.error == null) result.error = "没有录到声音";
            return result;
        }
        if (elapsedMs < MIN_DURATION_MS) {
            deleteQuietly(outputFile);
            result.ok = false;
            result.error = "录音太短（不足 1 秒），已丢弃";
            return result;
        }

        result.ok = true;
        return result;
    }

    /** 放弃这次录音并删掉临时文件 */
    public void cancel() {
        Result r = stop();
        deleteQuietly(r.file);
    }

    private static void deleteQuietly(File f) {
        try {
            if (f != null && f.exists()) f.delete();
        } catch (Exception ignored) {
        }
    }

    private static int[] toArray(List<Integer> list) {
        int[] out = new int[list.size()];
        for (int i = 0; i < out.length; i++) out[i] = list.get(i);
        return out;
    }
}
