package com.voicenotes.nativeapp;

import android.content.Context;
import android.util.TypedValue;
import android.widget.Toast;

import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;

/** 小工具合集：单位换算、时间/大小格式化、波形重采样。 */
public final class Ui {

    private Ui() {
    }

    public static int dp(Context context, float value) {
        return Math.round(TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP, value, context.getResources().getDisplayMetrics()));
    }

    public static void toast(Context context, String message) {
        if (context == null || message == null) return;
        Toast.makeText(context, message, Toast.LENGTH_SHORT).show();
    }

    public static void toastLong(Context context, String message) {
        if (context == null || message == null) return;
        Toast.makeText(context, message, Toast.LENGTH_LONG).show();
    }

    /** 0:07 / 3:42 / 1:02:03 */
    public static String formatDuration(long ms) {
        long total = Math.max(0, ms) / 1000;
        long h = total / 3600;
        long m = (total % 3600) / 60;
        long s = total % 60;
        if (h > 0) return String.format(Locale.US, "%d:%02d:%02d", h, m, s);
        return String.format(Locale.US, "%d:%02d", m, s);
    }

    /** 今天 14:30 / 昨天 09:12 / 3月5日 20:01 */
    public static String formatDate(long ts) {
        if (ts <= 0) return "";
        Calendar now = Calendar.getInstance();
        Calendar then = Calendar.getInstance();
        then.setTimeInMillis(ts);

        String hm = new SimpleDateFormat("HH:mm", Locale.US).format(new Date(ts));
        if (sameDay(now, then)) return "今天 " + hm;

        Calendar yesterday = Calendar.getInstance();
        yesterday.add(Calendar.DAY_OF_YEAR, -1);
        if (sameDay(yesterday, then)) return "昨天 " + hm;

        long diffDays = (now.getTimeInMillis() - ts) / 86400000L;
        if (diffDays >= 0 && diffDays < 7) {
            String[] week = {"周日", "周一", "周二", "周三", "周四", "周五", "周六"};
            return week[then.get(Calendar.DAY_OF_WEEK) - 1] + " " + hm;
        }

        if (now.get(Calendar.YEAR) == then.get(Calendar.YEAR)) {
            return (then.get(Calendar.MONTH) + 1) + "月" + then.get(Calendar.DAY_OF_MONTH) + "日 " + hm;
        }
        return then.get(Calendar.YEAR) + "年" + (then.get(Calendar.MONTH) + 1) + "月"
                + then.get(Calendar.DAY_OF_MONTH) + "日";
    }

    public static String formatSize(long bytes) {
        if (bytes < 1024) return bytes + " B";
        if (bytes < 1024 * 1024) return String.format(Locale.US, "%.1f KB", bytes / 1024.0);
        if (bytes < 1024L * 1024 * 1024) return String.format(Locale.US, "%.1f MB", bytes / 1024.0 / 1024.0);
        return String.format(Locale.US, "%.2f GB", bytes / 1024.0 / 1024.0 / 1024.0);
    }

    private static boolean sameDay(Calendar a, Calendar b) {
        return a.get(Calendar.YEAR) == b.get(Calendar.YEAR)
                && a.get(Calendar.DAY_OF_YEAR) == b.get(Calendar.DAY_OF_YEAR);
    }

    /** 把任意长度的峰值序列重采样成 count 个点，取每段最大值 */
    public static int[] resample(int[] src, int count) {
        if (count <= 0) return new int[0];
        if (src == null || src.length == 0) return new int[count];
        if (src.length == count) return src.clone();

        int[] out = new int[count];
        double block = src.length / (double) count;
        for (int i = 0; i < count; i++) {
            int start = (int) Math.floor(i * block);
            int end = Math.max(start + 1, (int) Math.floor((i + 1) * block));
            int max = 0;
            for (int j = start; j < end && j < src.length; j++) {
                if (src[j] > max) max = src[j];
            }
            out[i] = max;
        }
        return out;
    }

    /** 峰值序列的峰值，用于归一化显示；返回至少为 1，避免除零 */
    public static int peakOf(int[] peaks) {
        int max = 0;
        if (peaks != null) {
            for (int p : peaks) if (p > max) max = p;
        }
        return Math.max(1, max);
    }

    /** "1,2,3" → int[]，容忍空串和脏数据 */
    public static int[] parsePeaks(String raw) {
        if (raw == null || raw.trim().isEmpty()) return new int[0];
        String[] parts = raw.split(",");
        int[] out = new int[parts.length];
        int n = 0;
        for (String part : parts) {
            try {
                out[n++] = Integer.parseInt(part.trim());
            } catch (NumberFormatException e) {
                // 跳过坏值
            }
        }
        if (n == out.length) return out;
        int[] trimmed = new int[n];
        System.arraycopy(out, 0, trimmed, 0, n);
        return trimmed;
    }

    public static String joinPeaks(int[] peaks) {
        if (peaks == null || peaks.length == 0) return "";
        StringBuilder sb = new StringBuilder(peaks.length * 3);
        for (int i = 0; i < peaks.length; i++) {
            if (i > 0) sb.append(',');
            sb.append(peaks[i]);
        }
        return sb.toString();
    }
}
