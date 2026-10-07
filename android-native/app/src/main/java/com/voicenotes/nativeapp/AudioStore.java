package com.voicenotes.nativeapp;

import android.content.Context;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

/** 录音文件都放在应用私有目录 recordings/ 下，卸载应用即彻底清除，不需要任何存储权限。 */
public final class AudioStore {

    private static final String DIR = "recordings";

    private AudioStore() {
    }

    public static File dir(Context context) {
        File d = new File(context.getFilesDir(), DIR);
        if (!d.exists()) {
            //noinspection ResultOfMethodCallIgnored
            d.mkdirs();
        }
        return d;
    }

    /** 生成一个新的录音文件（文件名带时间戳，不重复） */
    public static File newRecordingFile(Context context) {
        String name = "n" + System.currentTimeMillis() + ".m4a";
        return new File(dir(context), name);
    }

    public static File file(Context context, String name) {
        if (name == null || name.isEmpty()) return null;
        return new File(dir(context), name);
    }

    public static boolean exists(Context context, String name) {
        File f = file(context, name);
        return f != null && f.exists() && f.length() > 0;
    }

    public static long size(Context context, String name) {
        File f = file(context, name);
        return f != null && f.exists() ? f.length() : 0;
    }

    public static void delete(Context context, String name) {
        File f = file(context, name);
        try {
            if (f != null && f.exists()) f.delete();
        } catch (Exception ignored) {
        }
    }

    /** 把录音复制到指定输出流（用于导出到「下载」目录） */
    public static boolean copyTo(Context context, String name, OutputStream out) {
        File f = file(context, name);
        if (f == null || !f.exists()) return false;
        try (InputStream in = new FileInputStream(f)) {
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = in.read(buffer)) > 0) out.write(buffer, 0, read);
            out.flush();
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /** 复制到另一个文件（用于 Android 9 及以下的导出回退路径） */
    public static boolean copyToFile(Context context, String name, File target) {
        try (FileOutputStream out = new FileOutputStream(target)) {
            return copyTo(context, name, out);
        } catch (Exception e) {
            return false;
        }
    }
}
