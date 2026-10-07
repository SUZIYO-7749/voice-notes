package com.voicenotes.nativeapp;

import android.content.ContentValues;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Log;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * 崩溃自记日志。
 *
 * 装在 Application 里，所以连 Activity 构造函数阶段（onCreate 之前）的崩溃也能捕获——
 * 这正是「一打开就闪退、什么提示都没有」的典型场景。
 *
 * 崩溃内容会写两份：
 *   1. 应用私有目录 last_crash.txt（一定能写成）；
 *   2. 尽力再写一份到公共「下载」目录，这样即使应用根本起不来，
 *      用户也能用文件管理器找到并发给开发者。
 */
public final class CrashLogger implements Thread.UncaughtExceptionHandler {

    private static final String TAG = "VoiceNotesCrash";
    private static final String FILE_NAME = "last_crash.txt";
    private static final String EXPORT_NAME = "语音笔记-崩溃日志.txt";

    private final Context context;
    private final Thread.UncaughtExceptionHandler previous;

    private CrashLogger(Context context, Thread.UncaughtExceptionHandler previous) {
        this.context = context;
        this.previous = previous;
    }

    public static void install(Context context) {
        try {
            Thread.UncaughtExceptionHandler previous = Thread.getDefaultUncaughtExceptionHandler();
            Thread.setDefaultUncaughtExceptionHandler(
                    new CrashLogger(context.getApplicationContext(), previous));
        } catch (Throwable t) {
            Log.w(TAG, "安装崩溃处理器失败", t);
        }
    }

    @Override
    public void uncaughtException(Thread thread, Throwable error) {
        try {
            write(error);
        } catch (Throwable ignored) {
            // 记日志本身绝不能再抛异常
        }
        if (previous != null) previous.uncaughtException(thread, error);
    }

    private void write(Throwable error) {
        StringWriter sw = new StringWriter();
        PrintWriter pw = new PrintWriter(sw);
        error.printStackTrace(pw);
        pw.flush();

        String text = "时间: " + new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(new Date())
                + "\n设备: " + Build.MANUFACTURER + " " + Build.MODEL
                + "\n系统: Android " + Build.VERSION.RELEASE + " (API " + Build.VERSION.SDK_INT + ")"
                + "\n线程: " + Thread.currentThread().getName()
                + "\n\n" + sw;

        // 1) 私有目录：一定能写成，启动时用来弹提示
        try (FileOutputStream out = new FileOutputStream(internalFile(context))) {
            out.write(text.getBytes("UTF-8"));
            out.flush();
        } catch (Throwable t) {
            Log.w(TAG, "写崩溃日志失败", t);
        }

        // 2) 尽力写一份到「下载」，方便用户在应用起不来时也能取到
        try {
            saveToDownloads(text);
        } catch (Throwable t) {
            Log.w(TAG, "导出崩溃日志失败", t);
        }

        Log.e(TAG, text);
    }

    private void saveToDownloads(String text) throws Exception {
        byte[] data = text.getBytes("UTF-8");

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentValues values = new ContentValues();
            values.put(MediaStore.Downloads.DISPLAY_NAME, EXPORT_NAME);
            values.put(MediaStore.Downloads.MIME_TYPE, "text/plain");
            values.put(MediaStore.Downloads.IS_PENDING, 1);

            Uri item = context.getContentResolver()
                    .insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (item == null) return;

            OutputStream out = null;
            try {
                out = context.getContentResolver().openOutputStream(item);
                if (out == null) return;
                out.write(data);
                out.flush();
            } finally {
                if (out != null) {
                    try {
                        out.close();
                    } catch (Exception ignored) {
                    }
                }
            }
            values.clear();
            values.put(MediaStore.Downloads.IS_PENDING, 0);
            context.getContentResolver().update(item, values, null, null);
            return;
        }

        File dir = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if (dir == null) dir = context.getFilesDir();
        if (dir == null) return;
        if (!dir.exists()) {
            //noinspection ResultOfMethodCallIgnored
            dir.mkdirs();
        }
        try (FileOutputStream out = new FileOutputStream(new File(dir, EXPORT_NAME))) {
            out.write(data);
            out.flush();
        }
    }

    /* ------------------------------------------------------------------ */

    public static File internalFile(Context context) {
        return new File(context.getFilesDir(), FILE_NAME);
    }

    /** 读取上次崩溃记录；没有则返回 null */
    public static String read(Context context) {
        File file = internalFile(context);
        if (!file.exists() || file.length() == 0) return null;
        try (FileInputStream in = new FileInputStream(file)) {
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            int n;
            while ((n = in.read(chunk)) > 0) buffer.write(chunk, 0, n);
            return buffer.toString("UTF-8");
        } catch (Throwable t) {
            return null;
        }
    }

    public static void clear(Context context) {
        try {
            File file = internalFile(context);
            if (file.exists()) {
                //noinspection ResultOfMethodCallIgnored
                file.delete();
            }
        } catch (Throwable ignored) {
        }
    }
}
