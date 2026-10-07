package com.voicenotes.nativeapp;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.TextView;

import java.io.File;
import java.util.ArrayList;
import java.util.List;

/**
 * 录音界面：进入即开始录，实时显示计时与滚动波形。
 * 用原生 MediaRecorder 直接录成 .m4a，不经过任何浏览器。
 */
public class RecordActivity extends Activity implements Recorder.Listener {

    /** 波形存进数据库前统一压到这么多点，避免单行过大 */
    private static final int STORED_PEAK_POINTS = 400;
    /** 实时波形窗口：保留最近这么多个采样点（每个 50ms，约 12 秒） */
    private static final int LIVE_WINDOW = 240;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final List<Integer> liveWindow = new ArrayList<>();

    private Recorder recorder;
    private WaveView wave;
    private TextView status;
    private TextView timer;
    private Button btnCancel;
    private Button btnPause;
    private Button btnFinish;

    private boolean finishing;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_record);

        if (checkSelfPermission(android.Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            Ui.toastLong(this, getString(R.string.no_mic_permission));
            finish();
            return;
        }

        wave = findViewById(R.id.wave_live);
        status = findViewById(R.id.text_status);
        timer = findViewById(R.id.text_timer);
        btnCancel = findViewById(R.id.btn_cancel);
        btnPause = findViewById(R.id.btn_pause);
        btnFinish = findViewById(R.id.btn_finish);

        wave.setColors(getColor(R.color.wave_active), getColor(R.color.wave_idle));

        btnCancel.setOnClickListener(v -> confirmCancel());
        btnPause.setOnClickListener(v -> togglePause());
        btnFinish.setOnClickListener(v -> finishAndSave());

        // 录音期间屏幕常亮
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        startRecording();
    }

    private void startRecording() {
        try {
            File target = AudioStore.newRecordingFile(this);
            recorder = new Recorder(this, this);
            recorder.start(target);
            status.setText(R.string.record_recording);
            timer.setText("00:00");
        } catch (Exception e) {
            Ui.toastLong(this, "无法开始录音：" + e.getMessage());
            finish();
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Recorder.Listener                                                   */
    /* ------------------------------------------------------------------ */

    @Override
    public void onTick(long elapsedMs, int level) {
        timer.setText(Ui.formatDuration(elapsedMs));
        liveWindow.add(level);
        while (liveWindow.size() > LIVE_WINDOW) liveWindow.remove(0);

        int[] peaks = new int[liveWindow.size()];
        for (int i = 0; i < peaks.length; i++) peaks[i] = liveWindow.get(i);
        // 实时视图整条都已"播放"，用 progress=1 让所有柱子都是高亮色
        wave.setPeaks(peaks);
        wave.setProgress(1f);
    }

    @Override
    public void onError(String message) {
        Ui.toastLong(this, message);
    }

    /* ------------------------------------------------------------------ */
    /*  操作                                                                */
    /* ------------------------------------------------------------------ */

    private void togglePause() {
        if (recorder == null || !recorder.isActive()) return;
        if (recorder.isPaused()) {
            recorder.resume();
            status.setText(R.string.record_recording);
            btnPause.setText(R.string.record_pause);
        } else {
            recorder.pause();
            status.setText(R.string.record_paused);
            btnPause.setText(R.string.record_resume);
        }
    }

    private void confirmCancel() {
        new AlertDialog.Builder(this)
                .setTitle("放弃这段录音？")
                .setMessage("已经录下的内容会被丢弃。")
                .setPositiveButton("放弃", (dialog, which) -> {
                    if (recorder != null) recorder.cancel();
                    recorder = null;
                    finish();
                })
                .setNegativeButton("继续录音", null)
                .show();
    }

    private void finishAndSave() {
        if (finishing || recorder == null) return;
        finishing = true;
        btnFinish.setEnabled(false);
        btnPause.setEnabled(false);
        btnCancel.setEnabled(false);
        status.setText("正在保存…");

        Recorder.Result result = recorder.stop();
        recorder = null;

        if (!result.ok) {
            Ui.toastLong(this, result.error == null ? "没有录到声音" : result.error);
            finish();
            return;
        }

        Note note = new Note();
        note.createdAt = System.currentTimeMillis();
        note.title = "语音笔记 " + Ui.formatDate(note.createdAt);
        note.audioFile = result.file.getName();
        note.size = result.file.length();
        note.durationMs = result.durationMs;
        note.peaks = Ui.joinPeaks(Ui.resample(result.peaks, STORED_PEAK_POINTS));

        try {
            Db.get(this).insert(note);
        } catch (Exception e) {
            AudioStore.delete(this, note.audioFile);
            Ui.toastLong(this, "保存失败：" + e.getMessage());
            finish();
            return;
        }

        Ui.toast(this, "已保存");
        finish();
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        if (recorder != null) {
            // 进程被回收或异常退出时，别留下半截文件
            recorder.cancel();
            recorder = null;
        }
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        super.onDestroy();
    }
}
