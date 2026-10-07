package com.voicenotes.nativeapp;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.View;
import android.widget.EditText;
import android.widget.ImageButton;
import android.widget.ListView;
import android.widget.TextView;

import java.util.List;

/** 笔记列表：搜索、筛选、进入详情、发起录音。 */
public class MainActivity extends Activity {

    private static final int REQ_MIC = 2001;

    private final Handler handler = new Handler(Looper.getMainLooper());

    /*
     * 注意：adapter 必须在 onCreate 里创建，不能写成字段初始化器。
     * Activity 的字段初始化器在构造函数中执行，而系统的 Activity.attach()
     * （设置 base Context）在那之后才调用；此时 getResources()/getColor() 会 NPE。
     */
    private NoteAdapter adapter;

    private Db db;
    private ListView listView;
    private EditText search;
    private TextView chipAll;
    private TextView chipFav;
    private TextView stats;
    private TextView emptyTitle;
    private TextView emptyHint;
    private View emptyView;

    private boolean onlyFavorite;
    private String query = "";

    private final Runnable reloadTask = new Runnable() {
        @Override
        public void run() {
            reload();
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 放在最前面：即使后面的初始化还会出问题，上次的崩溃原因也能先摆出来
        showLastCrashIfAny();

        setContentView(R.layout.activity_main);

        db = Db.get(this);
        adapter = new NoteAdapter(this);

        listView = findViewById(R.id.list_notes);
        search = findViewById(R.id.edit_search);
        chipAll = findViewById(R.id.chip_all);
        chipFav = findViewById(R.id.chip_fav);
        stats = findViewById(R.id.text_stats);
        emptyView = findViewById(R.id.empty_view);
        emptyTitle = findViewById(R.id.empty_title);
        emptyHint = findViewById(R.id.empty_hint);
        ImageButton record = findViewById(R.id.btn_record);

        listView.setAdapter(adapter);
        listView.setOnItemClickListener((parent, view, position, id) -> {
            Note note = adapter.getNote(position);
            Intent intent = new Intent(MainActivity.this, DetailActivity.class);
            intent.putExtra(DetailActivity.EXTRA_ID, note.id);
            startActivity(intent);
        });
        listView.setOnItemLongClickListener((parent, view, position, id) -> {
            showItemMenu(adapter.getNote(position));
            return true;
        });

        chipAll.setOnClickListener(v -> setFilter(false));
        chipFav.setOnClickListener(v -> setFilter(true));

        search.addTextChangedListener(new TextWatcher() {
            @Override
            public void beforeTextChanged(CharSequence s, int start, int count, int after) {
            }

            @Override
            public void onTextChanged(CharSequence s, int start, int before, int count) {
            }

            @Override
            public void afterTextChanged(Editable s) {
                query = s == null ? "" : s.toString();
                handler.removeCallbacks(reloadTask);
                handler.postDelayed(reloadTask, 180);
            }
        });

        record.setOnClickListener(v -> requestRecord());
    }

    @Override
    protected void onResume() {
        super.onResume();
        reload();
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacks(reloadTask);
        super.onDestroy();
    }

    private void setFilter(boolean favoriteOnly) {
        onlyFavorite = favoriteOnly;
        chipAll.setBackgroundResource(favoriteOnly ? R.drawable.bg_chip : R.drawable.bg_chip_active);
        chipAll.setTextColor(favoriteOnly ? getColor(R.color.text2) : 0xFFFFFFFF);
        chipFav.setBackgroundResource(favoriteOnly ? R.drawable.bg_chip_active : R.drawable.bg_chip);
        chipFav.setTextColor(favoriteOnly ? 0xFFFFFFFF : getColor(R.color.text2));
        reload();
    }

    private void reload() {
        List<Note> notes = db.list(onlyFavorite, query);
        adapter.setNotes(notes);

        boolean empty = notes.isEmpty();
        emptyView.setVisibility(empty ? View.VISIBLE : View.GONE);
        listView.setVisibility(empty ? View.GONE : View.VISIBLE);
        if (empty) {
            if (!query.trim().isEmpty()) {
                emptyTitle.setText(R.string.empty_search);
                emptyHint.setText("换个关键词试试");
            } else if (onlyFavorite) {
                emptyTitle.setText("还没有收藏的笔记");
                emptyHint.setText("长按任意笔记即可收藏");
            } else {
                emptyTitle.setText(R.string.empty_title);
                emptyHint.setText(R.string.empty_hint);
            }
        }

        int total = db.count();
        long totalDuration = 0;
        long totalSize = 0;
        for (Note n : notes) {
            totalDuration += n.durationMs;
            totalSize += n.size;
        }
        if (total == 0) {
            stats.setText("");
        } else if (notes.size() == total) {
            stats.setText(notes.size() + " 条 · " + Ui.formatDuration(totalDuration));
        } else {
            stats.setText(notes.size() + " / " + total + " 条");
        }
    }

    /* ------------------------------------------------------------------ */
    /*  上次崩溃的提示                                                      */
    /* ------------------------------------------------------------------ */

    private void showLastCrashIfAny() {
        final String trace = CrashLogger.read(this);
        if (trace == null || trace.trim().isEmpty()) return;

        final String shown = trace.length() > 3000 ? trace.substring(0, 3000) + "\n…（已截断）" : trace;

        try {
            new AlertDialog.Builder(this)
                    .setTitle("上次运行时崩溃了")
                    .setMessage(shown + "\n\n同一份日志也写到了「下载/" + "语音笔记-崩溃日志.txt」")
                    .setPositiveButton("复制日志", (dialog, which) -> copyCrash(trace))
                    .setNegativeButton("删除日志", (dialog, which) -> CrashLogger.clear(this))
                    .setNeutralButton("稍后", null)
                    .show();
        } catch (Throwable ignored) {
            // 弹窗失败也不能影响应用启动
        }
    }

    private void copyCrash(String text) {
        try {
            ClipboardManager cm = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
            if (cm != null) {
                cm.setPrimaryClip(ClipData.newPlainText("语音笔记崩溃日志", text));
                Ui.toastLong(this, "日志已复制，粘贴出来就能定位问题");
                return;
            }
        } catch (Throwable ignored) {
        }
        Ui.toast(this, "复制失败");
    }

    /* ------------------------------------------------------------------ */
    /*  长按菜单                                                            */
    /* ------------------------------------------------------------------ */

    private void showItemMenu(final Note note) {
        final String favLabel = note.favorite ? getString(R.string.fav_remove) : getString(R.string.fav_add);
        String[] items = new String[]{favLabel, "重命名", getString(R.string.menu_delete)};
        new AlertDialog.Builder(this)
                .setTitle(note.displayTitle())
                .setItems(items, (dialog, which) -> {
                    if (which == 0) {
                        note.favorite = !note.favorite;
                        db.update(note);
                        reload();
                    } else if (which == 1) {
                        renameNote(note);
                    } else {
                        confirmDelete(note);
                    }
                })
                .show();
    }

    private void renameNote(final Note note) {
        final EditText input = new EditText(this);
        input.setText(note.title);
        input.setSelection(input.getText().length());
        input.setTextColor(getColor(R.color.text));
        input.setHint(R.string.detail_title_hint);
        input.setSingleLine(true);
        int pad = Ui.dp(this, 16);
        input.setPadding(pad, pad, pad, pad);

        new AlertDialog.Builder(this)
                .setTitle("重命名")
                .setView(input)
                .setPositiveButton("保存", (dialog, which) -> {
                    note.title = input.getText().toString().trim();
                    db.update(note);
                    reload();
                })
                .setNegativeButton(R.string.record_cancel, null)
                .show();
    }

    private void confirmDelete(final Note note) {
        new AlertDialog.Builder(this)
                .setTitle("删除笔记")
                .setMessage("「" + note.displayTitle() + "」及其录音将被永久删除，无法恢复。")
                .setPositiveButton(R.string.detail_delete, (dialog, which) -> {
                    AudioStore.delete(this, note.audioFile);
                    db.delete(note.id);
                    reload();
                    Ui.toast(this, "已删除");
                })
                .setNegativeButton(R.string.record_cancel, null)
                .show();
    }

    /* ------------------------------------------------------------------ */
    /*  录音入口（先要权限）                                                 */
    /* ------------------------------------------------------------------ */

    private void requestRecord() {
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            startActivity(new Intent(this, RecordActivity.class));
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_MIC);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        if (requestCode == REQ_MIC) {
            boolean granted = grantResults.length > 0
                    && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            if (granted) {
                startActivity(new Intent(this, RecordActivity.class));
            } else {
                Ui.toastLong(this, getString(R.string.no_mic_permission));
            }
        }
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
    }
}
