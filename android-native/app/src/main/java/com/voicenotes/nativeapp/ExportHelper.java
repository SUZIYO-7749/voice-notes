package com.voicenotes.nativeapp;

import android.content.ContentValues;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;

import java.io.File;
import java.io.OutputStream;

/** 把录音导出到用户能找到的地方：Android 10+ 写公共「下载」目录，更早版本写应用外部目录。 */
public final class ExportHelper {

    private ExportHelper() {
    }

    public static void exportAudio(Context context, Note note) {
        if (note == null) return;
        if (note.audioFile == null || note.audioFile.isEmpty() || !AudioStore.exists(context, note.audioFile)) {
            Ui.toast(context, "音频文件已丢失，无法导出");
            return;
        }

        String fileName = safeName(note.displayTitle()) + ".m4a";
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                exportViaMediaStore(context, note, fileName);
            } else {
                exportToAppDir(context, note, fileName);
            }
        } catch (Exception e) {
            Ui.toast(context, "导出失败：" + e.getMessage());
        }
    }

    private static void exportViaMediaStore(Context context, Note note, String fileName) {
        ContentValues values = new ContentValues();
        values.put(MediaStore.Downloads.DISPLAY_NAME, fileName);
        values.put(MediaStore.Downloads.MIME_TYPE, "audio/mp4");
        values.put(MediaStore.Downloads.IS_PENDING, 1);

        Uri item = context.getContentResolver()
                .insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
        if (item == null) {
            Ui.toast(context, "导出失败：无法在「下载」目录创建文件");
            return;
        }

        boolean ok = false;
        OutputStream out = null;
        try {
            out = context.getContentResolver().openOutputStream(item);
            if (out != null) ok = AudioStore.copyTo(context, note.audioFile, out);
        } catch (Exception e) {
            ok = false;
        } finally {
            if (out != null) {
                try {
                    out.close();
                } catch (Exception ignored) {
                }
            }
        }

        if (!ok) {
            try {
                context.getContentResolver().delete(item, null, null);
            } catch (Exception ignored) {
            }
            Ui.toast(context, "导出失败");
            return;
        }

        values.clear();
        values.put(MediaStore.Downloads.IS_PENDING, 0);
        context.getContentResolver().update(item, values, null, null);
        Ui.toast(context, "已保存到「下载」：" + fileName);
    }

    private static void exportToAppDir(Context context, Note note, String fileName) {
        File dir = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if (dir == null) dir = context.getFilesDir();
        if (dir != null && !dir.exists()) {
            //noinspection ResultOfMethodCallIgnored
            dir.mkdirs();
        }
        if (dir == null) {
            Ui.toast(context, "导出失败：没有可写目录");
            return;
        }
        File target = new File(dir, fileName);
        boolean ok = AudioStore.copyToFile(context, note.audioFile, target);
        Ui.toast(context, ok ? "已保存到：" + target.getAbsolutePath() : "导出失败");
    }

    /** 去掉文件名里不能用的字符 */
    private static String safeName(String raw) {
        String name = raw == null ? "" : raw.trim();
        name = name.replaceAll("[\\\\/:*?\"<>|\r\n\t]", "_").replaceAll("\\s+", " ");
        if (name.isEmpty()) name = "语音笔记";
        return name.length() > 50 ? name.substring(0, 50) : name;
    }
}
