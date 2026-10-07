package com.voicenotes.nativeapp;

import android.media.MediaPlayer;
import android.os.Handler;
import android.os.Looper;

/** 原生播放器封装，带进度回调。 */
public class Player {

    public interface Listener {
        void onProgress(int positionMs, int durationMs);
        void onState(boolean playing);
        void onComplete();
        void onError(String message);
    }

    private static final int TICK_MS = 200;

    private final Listener listener;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private MediaPlayer player;
    private boolean prepared;

    public Player(Listener listener) {
        this.listener = listener;
    }

    private final Runnable ticker = new Runnable() {
        @Override
        public void run() {
            if (player == null || !prepared) return;
            try {
                if (player.isPlaying()) {
                    listener.onProgress(player.getCurrentPosition(), player.getDuration());
                }
            } catch (Exception ignored) {
            }
            handler.postDelayed(this, TICK_MS);
        }
    };

    public void load(String path) {
        release();
        try {
            MediaPlayer p = new MediaPlayer();
            p.setDataSource(path);
            p.prepare();
            p.setOnCompletionListener(mp -> {
                listener.onState(false);
                listener.onProgress(0, duration());
                listener.onComplete();
            });
            p.setOnErrorListener((mp, what, extra) -> {
                listener.onError("音频播放失败");
                listener.onState(false);
                return true;
            });
            player = p;
            prepared = true;
            listener.onProgress(0, p.getDuration());
            handler.postDelayed(ticker, TICK_MS);
        } catch (Exception e) {
            prepared = false;
            player = null;
            listener.onError("无法打开音频：" + e.getMessage());
        }
    }

    public boolean isReady() { return prepared && player != null; }

    public boolean isPlaying() {
        try {
            return prepared && player != null && player.isPlaying();
        } catch (Exception e) {
            return false;
        }
    }

    public int duration() {
        try {
            return prepared && player != null ? player.getDuration() : 0;
        } catch (Exception e) {
            return 0;
        }
    }

    public int position() {
        try {
            return prepared && player != null ? player.getCurrentPosition() : 0;
        } catch (Exception e) {
            return 0;
        }
    }

    public void toggle() {
        if (!isReady()) return;
        try {
            if (player.isPlaying()) {
                player.pause();
                listener.onState(false);
            } else {
                player.start();
                listener.onState(true);
            }
        } catch (Exception e) {
            listener.onError("播放操作失败");
        }
    }

    public void pauseIfPlaying() {
        try {
            if (isReady() && player.isPlaying()) {
                player.pause();
                listener.onState(false);
            }
        } catch (Exception ignored) {
        }
    }

    public void seekTo(int ms) {
        if (!isReady()) return;
        try {
            player.seekTo(Math.max(0, Math.min(ms, duration())));
            listener.onProgress(player.getCurrentPosition(), duration());
        } catch (Exception ignored) {
        }
    }

    public void release() {
        handler.removeCallbacks(ticker);
        prepared = false;
        MediaPlayer p = player;
        player = null;
        if (p != null) {
            try {
                if (p.isPlaying()) p.stop();
            } catch (Exception ignored) {
            }
            try {
                p.release();
            } catch (Exception ignored) {
            }
        }
    }
}
