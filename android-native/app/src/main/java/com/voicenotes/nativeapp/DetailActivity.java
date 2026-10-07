package com.voicenotes.nativeapp;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.os.Bundle;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageButton;
import android.widget.TextView;

import java.io.File;

/** 笔记详情：播放、点波形定位、编辑标题/文字稿/标签、语音输入文字、导出、删除。 */
public class DetailActivity extends Activity implements Player.Listener, SpeechHelper.Listener {

    public static final String EXTRA_ID = "note_id";

    private Db db;
    private Note note;
    private Player player;
    private SpeechHelper speech;

    private EditText editTitle;
    private EditText editTranscript;
    private EditText editTags;
    private TextView textMeta;
    private TextView textTime;
    private TextView dictateStatus;
    private WaveView wave;
    private ImageButton btnPlay;
    private ImageButton btnFav;
    private Button btnDictate;

    private boolean dirty;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_detail);

        long id = getIntent().getLongExtra(EXTRA_ID, -1L);
        db = Db.get(this);
        note = id > 0 ? db.get(id) : null;
        if (note == null) {
            Ui.toast(this, "这条笔记不存在了");
            finish();
            return;
        }

        editTitle = findViewById(R.id.edit_title);
        editTranscript = findViewById(R.id.edit_transcript);
        editTags = findViewById(R.id.edit_tags);
        textMeta = findViewById(R.id.text_meta);
        textTime = findViewById(R.id.text_time);
        dictateStatus = findViewById(R.id.text_dictate_status);
        wave = findViewById(R.id.wave_detail);
        btnPlay = findViewById(R.id.btn_play);
        btnFav = findViewById(R.id.btn_fav);
        btnDictate = findViewById(R.id.btn_dictate);

        ImageButton btnBack = findViewById(R.id.btn_back);
        Button btnCopy = findViewById(R.id.btn_copy);
        Button btnClear = findViewById(R.id.btn_clear);
        Button btnExport = findViewById(R.id.btn_export);
        Button btnDelete = findViewById(R.id.btn_delete);

        // 填入内容
        editTitle.setText(note.title);
        editTranscript.setText(note.transcript);
        editTags.setText(joinTagsForEdit(note.tags));
        updateMeta();
        updateFavIcon();

        wave.setColors(getColor(R.color.wave_active), getColor(R.color.wave_idle));
        wave.setPeaks(Ui.parsePeaks(note.peaks));
        wave.setProgress(0f);
        wave.setSeekable(true);
        wave.setOnSeekListener(ratio -> {
            if (player != null && player.isReady()) {
                player.seekTo((int) (ratio * player.duration()));
            }
        });

        TextWatcher watcher = new TextWatcher() {
            @Override
            public void beforeTextChanged(CharSequence s, int start, int count, int after) {
            }

            @Override
            public void onTextChanged(CharSequence s, int start, int before, int count) {
            }

            @Override
            public void afterTextChanged(Editable s) {
                dirty = true;
            }
        };
        editTitle.addTextChangedListener(watcher);
        editTranscript.addTextChangedListener(watcher);
        editTags.addTextChangedListener(watcher);

        btnBack.setOnClickListener(v -> finish());

        player = new Player(this);
        File audio = AudioStore.file(this, note.audioFile);
        if (audio != null && audio.exists() && audio.length() > 0) {
            player.load(audio.getAbsolutePath());
        } else {
            btnPlay.setEnabled(false);
            btnPlay.setAlpha(0.4f);
            textTime.setText("音频丢失");
        }

        btnPlay.setOnClickListener(v -> {
            if (player != null && player.isReady()) player.toggle();
            else Ui.toast(this, "音频文件已丢失");
        });

        btnFav.setOnClickListener(v -> {
            note.favorite = !note.favorite;
            db.update(note);
            updateFavIcon();
            Ui.toast(this, note.favorite ? "已收藏" : "已取消收藏");
        });

        speech = new SpeechHelper(this, this);
        btnDictate.setOnClickListener(v -> {
            if (speech.isListening()) {
                speech.stop();
            } else if (!SpeechHelper.isAvailable(this)) {
                Ui.toastLong(this, "这台设备没有可用的语音识别服务");
            } else {
                dictateStatus.setVisibility(View.VISIBLE);
                dictateStatus.setText("正在聆听…");
                speech.start();
            }
        });

        btnCopy.setOnClickListener(v -> copyTranscript());
        btnClear.setOnClickListener(v -> confirmClearTranscript());
        btnExport.setOnClickListener(v -> ExportHelper.exportAudio(this, note));
        btnDelete.setOnClickListener(v -> confirmDelete());
    }

    /* ------------------------------------------------------------------ */
    /*  界面状态                                                            */
    /* ------------------------------------------------------------------ */

    private void updateMeta() {
        StringBuilder sb = new StringBuilder();
        sb.append("创建于 ").append(Ui.formatDate(note.createdAt));
        sb.append("   ·   时长 ").append(Ui.formatDuration(note.durationMs));
        if (note.size > 0) sb.append("   ·   ").append(Ui.formatSize(note.size));
        textMeta.setText(sb.toString());
    }

    private void updateFavIcon() {
        btnFav.setColorFilter(getColor(note.favorite ? R.color.warn : R.color.muted));
    }

    private void updatePlayIcon(boolean playing) {
        btnPlay.setImageResource(playing ? R.drawable.ic_pause : R.drawable.ic_play);
    }

    /* ------------------------------------------------------------------ */
    /*  Player.Listener                                                     */
    /* ------------------------------------------------------------------ */

    @Override
    public void onProgress(int positionMs, int durationMs) {
        float ratio = durationMs > 0 ? positionMs / (float) durationMs : 0f;
        wave.setProgress(ratio);
        textTime.setText(Ui.formatDuration(positionMs) + " / " + Ui.formatDuration(durationMs));
    }

    @Override
    public void onState(boolean playing) {
        updatePlayIcon(playing);
    }

    @Override
    public void onComplete() {
        updatePlayIcon(false);
        wave.setProgress(0f);
    }

    @Override
    public void onError(String message) {
        Ui.toast(this, message);
    }

    /* ------------------------------------------------------------------ */
    /*  SpeechHelper.Listener                                               */
    /* ------------------------------------------------------------------ */

    @Override
    public void onSpeechPartial(String text) {
        dictateStatus.setVisibility(View.VISIBLE);
        dictateStatus.setText("识别中：" + text);
    }

    @Override
    public void onSpeechFinal(String text) {
        dictateStatus.setVisibility(View.GONE);
        if (text == null || text.isEmpty()) return;

        String current = editTranscript.getText().toString();
        StringBuilder sb = new StringBuilder(current);
        if (sb.length() > 0 && !current.endsWith("\n")) sb.append('\n');
        sb.append(text);

        editTranscript.setText(sb.toString());
        editTranscript.setSelection(editTranscript.getText().length());
        dirty = true;
        save();
        Ui.toast(this, "已写入文字稿");
    }

    @Override
    public void onSpeechError(String message) {
        dictateStatus.setVisibility(View.GONE);
        Ui.toastLong(this, message);
    }

    @Override
    public void onSpeechState(boolean listening) {
        btnDictate.setText(listening ? R.string.detail_dictate_stop : R.string.detail_dictate);
        if (!listening && dictateStatus.getVisibility() == View.VISIBLE) {
            dictateStatus.setVisibility(View.GONE);
        }
    }

    /* ------------------------------------------------------------------ */
    /*  文字稿操作                                                          */
    /* ------------------------------------------------------------------ */

    private void copyTranscript() {
        String text = editTranscript.getText().toString().trim();
        if (text.isEmpty()) {
            Ui.toast(this, "还没有文字稿");
            return;
        }
        try {
            ClipboardManager cm = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
            if (cm != null) {
                cm.setPrimaryClip(ClipData.newPlainText("语音笔记", text));
                Ui.toast(this, "文字稿已复制");
                return;
            }
        } catch (Exception ignored) {
        }
        Ui.toast(this, "复制失败");
    }

    private void confirmClearTranscript() {
        if (editTranscript.getText().toString().trim().isEmpty()) return;
        new AlertDialog.Builder(this)
                .setTitle("清空文字稿？")
                .setPositiveButton("清空", (dialog, which) -> {
                    editTranscript.setText("");
                    dirty = true;
                    save();
                })
                .setNegativeButton(R.string.record_cancel, null)
                .show();
    }

    /* ------------------------------------------------------------------ */
    /*  删除                                                               */
    /* ------------------------------------------------------------------ */

    private void confirmDelete() {
        new AlertDialog.Builder(this)
                .setTitle("删除这条笔记？")
                .setMessage("录音和文字稿都会被永久删除，无法恢复。")
                .setPositiveButton(R.string.detail_delete, (dialog, which) -> {
                    AudioStore.delete(this, note.audioFile);
                    db.delete(note.id);
                    Ui.toast(this, "已删除");
                    note = null;
                    finish();
                })
                .setNegativeButton(R.string.record_cancel, null)
                .show();
    }

    /* ------------------------------------------------------------------ */
    /*  保存与生命周期                                                      */
    /* ------------------------------------------------------------------ */

    private void save() {
        if (note == null) return;
        note.title = editTitle.getText().toString().trim();
        note.transcript = editTranscript.getText().toString();
        note.tags = normalizeTags(editTags.getText().toString());
        try {
            db.update(note);
            dirty = false;
        } catch (Exception e) {
            Ui.toast(this, "保存失败：" + e.getMessage());
        }
    }

    @Override
    protected void onPause() {
        if (dirty) save();
        if (player != null) player.pauseIfPlaying();
        if (speech != null && speech.isListening()) speech.stop();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (player != null) player.release();
        if (speech != null) speech.destroy();
        super.onDestroy();
    }

    /* ------------------------------------------------------------------ */
    /*  标签字符串处理                                                      */
    /* ------------------------------------------------------------------ */

    /** 展示用：逗号分隔 → 顿号分隔，读起来顺一点 */
    private static String joinTagsForEdit(String tags) {
        if (tags == null) return "";
        String[] arr = tags.split(",");
        StringBuilder sb = new StringBuilder();
        for (String t : arr) {
            String v = t.trim();
            if (v.isEmpty()) continue;
            if (sb.length() > 0) sb.append("，");
            sb.append(v);
        }
        return sb.toString();
    }

    /** 输入用：把逗号/顿号/空格分隔的内容规整成去重后的逗号串 */
    static String normalizeTags(String raw) {
        if (raw == null) return "";
        String[] parts = raw.split("[,，、;；\\s]+");
        StringBuilder sb = new StringBuilder();
        for (String part : parts) {
            String tag = part.trim().replace("#", "");
            if (tag.isEmpty()) continue;
            if (tag.length() > 16) tag = tag.substring(0, 16);
            if (("," + sb + ",").contains("," + tag + ",")) continue;
            if (sb.length() >= 12) break;
            if (sb.length() > 0) sb.append(',');
            sb.append(tag);
        }
        return sb.toString();
    }
}
