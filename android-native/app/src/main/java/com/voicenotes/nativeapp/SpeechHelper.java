package com.voicenotes.nativeapp;

import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;

import java.util.ArrayList;
import java.util.Locale;

/**
 * 系统语音识别封装（android.speech.SpeechRecognizer）。
 *
 * 为什么不做「边录音边转文字」：系统识别服务和 MediaRecorder 都要独占麦克风，
 * 同时开会让录音变成静音，这是 Android 的音频输入限制。
 * 所以这里用在「把说的话转成文字稿」这个独立动作上，此时不录音，稳定可靠。
 */
public class SpeechHelper {

    public interface Listener {
        void onSpeechPartial(String text);
        void onSpeechFinal(String text);
        void onSpeechError(String message);
        void onSpeechState(boolean listening);
    }

    private final Context context;
    private final Listener listener;
    private SpeechRecognizer recognizer;
    private boolean listening;

    public SpeechHelper(Context context, Listener listener) {
        this.context = context.getApplicationContext();
        this.listener = listener;
    }

    public static boolean isAvailable(Context context) {
        try {
            return SpeechRecognizer.isRecognitionAvailable(context);
        } catch (Exception e) {
            return false;
        }
    }

    public boolean isListening() {
        return listening;
    }

    public void start() {
        if (listening) return;
        if (!isAvailable(context)) {
            listener.onSpeechError("这台设备没有可用的语音识别服务");
            return;
        }
        try {
            if (recognizer == null) recognizer = create();
            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                    RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.CHINA.toString());
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, Locale.CHINA.toString());
            intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
            intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 1500);
            }
            recognizer.startListening(intent);
        } catch (Exception e) {
            listener.onSpeechError("无法启动语音识别：" + e.getMessage());
        }
    }

    public void stop() {
        if (recognizer != null) {
            try {
                recognizer.stopListening();
            } catch (Exception ignored) {
            }
        }
    }

    public void destroy() {
        listening = false;
        if (recognizer != null) {
            try {
                recognizer.destroy();
            } catch (Exception ignored) {
            }
            recognizer = null;
        }
    }

    private SpeechRecognizer create() {
        SpeechRecognizer r = SpeechRecognizer.createSpeechRecognizer(context);
        r.setRecognitionListener(new RecognitionListener() {
            @Override
            public void onReadyForSpeech(Bundle params) {
                listening = true;
                listener.onSpeechState(true);
            }

            @Override
            public void onBeginningOfSpeech() {
            }

            @Override
            public void onRmsChanged(float rmsdB) {
            }

            @Override
            public void onBufferReceived(byte[] buffer) {
            }

            @Override
            public void onEndOfSpeech() {
                listening = false;
                listener.onSpeechState(false);
            }

            @Override
            public void onError(int error) {
                listening = false;
                listener.onSpeechState(false);
                // 没听到声音属于正常情况，不弹错误
                if (error == SpeechRecognizer.ERROR_NO_MATCH
                        || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) {
                    listener.onSpeechError("没有听清，请再说一次");
                    return;
                }
                listener.onSpeechError(describe(error));
            }

            @Override
            public void onResults(Bundle results) {
                listening = false;
                listener.onSpeechState(false);
                String text = firstResult(results);
                if (text == null || text.trim().isEmpty()) {
                    listener.onSpeechError("没有识别到内容");
                } else {
                    listener.onSpeechFinal(text.trim());
                }
            }

            @Override
            public void onPartialResults(Bundle partialResults) {
                String text = firstResult(partialResults);
                if (text != null && !text.trim().isEmpty()) listener.onSpeechPartial(text.trim());
            }

            @Override
            public void onEvent(int eventType, Bundle params) {
            }
        });
        return r;
    }

    private static String firstResult(Bundle bundle) {
        if (bundle == null) return null;
        ArrayList<String> list = bundle.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (list == null || list.isEmpty()) return null;
        return list.get(0);
    }

    private static String describe(int error) {
        switch (error) {
            case SpeechRecognizer.ERROR_AUDIO:
                return "录音出错";
            case SpeechRecognizer.ERROR_CLIENT:
                return "识别客户端出错";
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS:
                return "没有麦克风权限";
            case SpeechRecognizer.ERROR_NETWORK:
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
                return "网络不可用，语音识别需要联网";
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY:
                return "识别服务正忙，请稍后再试";
            case SpeechRecognizer.ERROR_SERVER:
                return "识别服务返回了错误";
            default:
                return "语音识别失败（代码 " + error + "）";
        }
    }
}
