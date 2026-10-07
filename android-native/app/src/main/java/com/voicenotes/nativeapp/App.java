package com.voicenotes.nativeapp;

import android.app.Application;

/**
 * 只为尽早装上崩溃处理器：Application.onCreate 早于任何 Activity 的构造，
 * 所以连「MainActivity 构造函数里就崩」这种情况也能被记录下来。
 */
public class App extends Application {

    @Override
    public void onCreate() {
        super.onCreate();
        CrashLogger.install(this);
    }
}
