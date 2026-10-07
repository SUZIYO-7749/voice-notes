package com.voicenotes.nativeapp;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

import java.util.ArrayList;
import java.util.List;

/** 笔记的 SQLite 存储。音频文件单独放在应用私有目录，这里只存文件名。 */
public class Db extends SQLiteOpenHelper {

    private static final String NAME = "voice_notes.db";
    private static final int VERSION = 1;
    private static final String TABLE = "notes";

    private static Db instance;

    public static synchronized Db get(Context context) {
        if (instance == null) instance = new Db(context.getApplicationContext());
        return instance;
    }

    private Db(Context context) {
        super(context, NAME, null, VERSION);
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE " + TABLE + " ("
                + "id INTEGER PRIMARY KEY AUTOINCREMENT,"
                + "title TEXT NOT NULL DEFAULT '',"
                + "transcript TEXT NOT NULL DEFAULT '',"
                + "tags TEXT NOT NULL DEFAULT '',"
                + "favorite INTEGER NOT NULL DEFAULT 0,"
                + "created_at INTEGER NOT NULL DEFAULT 0,"
                + "updated_at INTEGER NOT NULL DEFAULT 0,"
                + "duration_ms INTEGER NOT NULL DEFAULT 0,"
                + "audio_file TEXT NOT NULL DEFAULT '',"
                + "size INTEGER NOT NULL DEFAULT 0,"
                + "peaks TEXT NOT NULL DEFAULT '')");
        db.execSQL("CREATE INDEX idx_created ON " + TABLE + "(created_at DESC)");
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        // 只有版本 1，暂时不需要迁移
    }

    private static Note fromCursor(Cursor c) {
        Note n = new Note();
        n.id = c.getLong(c.getColumnIndexOrThrow("id"));
        n.title = c.getString(c.getColumnIndexOrThrow("title"));
        n.transcript = c.getString(c.getColumnIndexOrThrow("transcript"));
        n.tags = c.getString(c.getColumnIndexOrThrow("tags"));
        n.favorite = c.getInt(c.getColumnIndexOrThrow("favorite")) == 1;
        n.createdAt = c.getLong(c.getColumnIndexOrThrow("created_at"));
        n.updatedAt = c.getLong(c.getColumnIndexOrThrow("updated_at"));
        n.durationMs = c.getLong(c.getColumnIndexOrThrow("duration_ms"));
        n.audioFile = c.getString(c.getColumnIndexOrThrow("audio_file"));
        n.size = c.getLong(c.getColumnIndexOrThrow("size"));
        n.peaks = c.getString(c.getColumnIndexOrThrow("peaks"));
        return n;
    }

    private static ContentValues toValues(Note n) {
        ContentValues v = new ContentValues();
        v.put("title", n.title == null ? "" : n.title);
        v.put("transcript", n.transcript == null ? "" : n.transcript);
        v.put("tags", n.tags == null ? "" : n.tags);
        v.put("favorite", n.favorite ? 1 : 0);
        v.put("created_at", n.createdAt);
        v.put("updated_at", n.updatedAt);
        v.put("duration_ms", n.durationMs);
        v.put("audio_file", n.audioFile == null ? "" : n.audioFile);
        v.put("size", n.size);
        v.put("peaks", n.peaks == null ? "" : n.peaks);
        return v;
    }

    /**
     * @param onlyFavorite 只看收藏
     * @param query        关键词，匹配标题/文字稿/标签；为空表示不过滤
     */
    public List<Note> list(boolean onlyFavorite, String query) {
        StringBuilder where = new StringBuilder();
        List<String> args = new ArrayList<>();
        if (onlyFavorite) where.append("favorite = 1");
        if (query != null && !query.trim().isEmpty()) {
            if (where.length() > 0) where.append(" AND ");
            where.append("(title LIKE ? OR transcript LIKE ? OR tags LIKE ?)");
            String like = "%" + query.trim() + "%";
            args.add(like);
            args.add(like);
            args.add(like);
        }

        List<Note> out = new ArrayList<>();
        Cursor c = null;
        try {
            c = getReadableDatabase().query(TABLE, null,
                    where.length() == 0 ? null : where.toString(),
                    args.isEmpty() ? null : args.toArray(new String[0]),
                    null, null, "created_at DESC");
            while (c.moveToNext()) out.add(fromCursor(c));
        } finally {
            if (c != null) c.close();
        }
        return out;
    }

    public Note get(long id) {
        Cursor c = null;
        try {
            c = getReadableDatabase().query(TABLE, null, "id = ?",
                    new String[]{String.valueOf(id)}, null, null, null);
            return c.moveToFirst() ? fromCursor(c) : null;
        } finally {
            if (c != null) c.close();
        }
    }

    public long insert(Note n) {
        long now = System.currentTimeMillis();
        if (n.createdAt == 0) n.createdAt = now;
        n.updatedAt = now;
        long id = getWritableDatabase().insert(TABLE, null, toValues(n));
        n.id = id;
        return id;
    }

    public void update(Note n) {
        n.updatedAt = System.currentTimeMillis();
        getWritableDatabase().update(TABLE, toValues(n), "id = ?",
                new String[]{String.valueOf(n.id)});
    }

    public void delete(long id) {
        getWritableDatabase().delete(TABLE, "id = ?", new String[]{String.valueOf(id)});
    }

    public int count() {
        Cursor c = null;
        try {
            c = getReadableDatabase().rawQuery("SELECT COUNT(*) FROM " + TABLE, null);
            return c.moveToFirst() ? c.getInt(0) : 0;
        } finally {
            if (c != null) c.close();
        }
    }
}
