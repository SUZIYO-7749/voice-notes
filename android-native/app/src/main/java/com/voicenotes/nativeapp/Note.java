package com.voicenotes.nativeapp;

/** 一条语音笔记。 */
public class Note {

    public long id;
    public String title = "";
    public String transcript = "";
    /** 逗号分隔的标签，例如 "会议,想法" */
    public String tags = "";
    public boolean favorite;
    public long createdAt;
    public long updatedAt;
    /** 录音时长（毫秒） */
    public long durationMs;
    /** 音频文件名（位于应用私有目录 recordings/ 下），没有音频时为空 */
    public String audioFile = "";
    /** 音频字节数 */
    public long size;
    /**
     * 波形峰值：逗号分隔的 0~100 整数，录音时按 50ms 采一次。
     * 存字符串是为了避免再引入 Blob 读写。
     */
    public String peaks = "";

    public String[] tagArray() {
        if (tags == null || tags.trim().isEmpty()) return new String[0];
        String[] raw = tags.split(",");
        int count = 0;
        for (String s : raw) if (!s.trim().isEmpty()) count++;
        String[] out = new String[count];
        int i = 0;
        for (String s : raw) {
            String t = s.trim();
            if (!t.isEmpty()) out[i++] = t;
        }
        return out;
    }

    /** 列表里显示的一行摘要 */
    public String excerpt() {
        if (transcript == null) return "";
        String flat = transcript.replaceAll("\\s+", " ").trim();
        return flat;
    }

    public String displayTitle() {
        if (title != null && !title.trim().isEmpty()) return title.trim();
        return "未命名笔记";
    }
}
