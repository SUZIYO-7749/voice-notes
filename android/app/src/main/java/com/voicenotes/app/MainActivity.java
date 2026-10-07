package com.voicenotes.app;

import android.Manifest;
import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.AssetManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Log;
import android.view.KeyEvent;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Locale;

/**
 * 语音笔记的安卓外壳。
 *
 * 关键点：WebView 里的 file:// 页面不是「安全上下文」，浏览器会直接拒绝麦克风。
 * 所以这里自己拦截请求，把 assets 以 https://appassets.androidplatform.net/ 提供，
 * 这样 getUserMedia 才可用。
 *
 * 刻意不使用 androidx.webkit 的 WebViewAssetLoader：整包只依赖 android.jar，
 * 于是可以用 build-tools 直接出包，不需要 Gradle 联网拉依赖。
 */
public class MainActivity extends Activity {

    private static final String TAG = "VoiceNotes";
    private static final String DOMAIN = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + DOMAIN + "/assets/www/index.html";
    private static final int REQ_MIC = 1001;
    private static final int REQ_FILE = 1002;

    private WebView webView;
    private PermissionRequest pendingPermission;
    private ValueCallback<Uri[]> pendingFileCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#0D1016"));
        setContentView(webView);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);   // 允许脚本触发音频播放
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setUseWideViewPort(false);
        s.setLoadWithOverviewMode(false);
        s.setTextZoom(100);                             // 不跟随系统字体缩放，避免布局被撑坏
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        }

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return serveAsset(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                String scheme = url.getScheme() == null ? "" : url.getScheme();
                // 站内（资源域）跳转放行，其余一律交给系统浏览器，避免把 JS 桥暴露给外部页面
                if (DOMAIN.equals(url.getHost())) return false;
                if (scheme.startsWith("http")) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, url));
                    } catch (Exception e) {
                        Log.w(TAG, "无法打开外部链接", e);
                    }
                }
                return true;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> {
                    boolean wantsAudio = false;
                    for (String res : request.getResources()) {
                        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(res)) wantsAudio = true;
                    }
                    if (!wantsAudio) {
                        request.deny();
                        return;
                    }
                    if (hasMicPermission()) {
                        request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                    } else {
                        // 先把 WebView 的请求挂起，等系统权限结果回来再答复
                        pendingPermission = request;
                        requestMicPermission();
                    }
                });
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                // WebView 默认不支持 <input type="file">，不实现的话「导入备份」点了没反应
                if (pendingFileCallback != null) {
                    pendingFileCallback.onReceiveValue(null);
                }
                pendingFileCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), REQ_FILE);
                    return true;
                } catch (Exception e) {
                    Log.w(TAG, "打不开文件选择器", e);
                    pendingFileCallback = null;
                    return false;
                }
            }

            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                Log.d(TAG, m.message() + " (第 " + m.lineNumber() + " 行)");
                return true;
            }
        });

        webView.addJavascriptInterface(new NativeBridge(), "VoiceNotesNative");

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        if (hasMicPermission()) {
            webView.loadUrl(START_URL);
        } else {
            requestMicPermission();   // 授权结果回来后再加载页面
        }
    }

    /* ------------------------------------------------------------------ */
    /*  把 assets 以 https 资源域提供给 WebView                              */
    /* ------------------------------------------------------------------ */

    /**
     * 拦截 https://appassets.androidplatform.net/assets/... 的请求，改从 APK 内的 assets 读取。
     * URL 保持 https 不变，所以页面处于安全上下文，getUserMedia 才被允许。
     * 此方法在后台线程执行。
     */
    private WebResourceResponse serveAsset(Uri url) {
        if (url == null || !DOMAIN.equals(url.getHost())) return null;

        String path = url.getPath();                 // 形如 /assets/www/index.html
        if (path == null || !path.startsWith("/assets/")) {
            if (path == null || path.equals("/") || path.isEmpty()) {
                path = "/assets/www/index.html";     // 根路径也指向首页
            } else {
                return null;
            }
        }

        String assetPath = path.substring(1);        // 去掉开头的 '/' → assets/www/index.html
        try {
            AssetManager assets = getAssets();
            InputStream in = assets.open(assetPath);
            String mime = guessMime(assetPath);
            String encoding = mime.startsWith("text/") || mime.contains("javascript")
                    || mime.contains("json") ? "UTF-8" : null;
            WebResourceResponse response = new WebResourceResponse(mime, encoding, in);
            // 本地资源，禁用缓存以免更新应用后仍读到旧文件
            java.util.Map<String, String> headers = new java.util.HashMap<>();
            headers.put("Cache-Control", "no-cache");
            response.setResponseHeaders(headers);
            return response;
        } catch (IOException e) {
            Log.w(TAG, "assets 里找不到 " + assetPath);
            return null;
        }
    }

    private static String guessMime(String path) {
        String p = path.toLowerCase(Locale.US);
        if (p.endsWith(".html") || p.endsWith(".htm")) return "text/html";
        if (p.endsWith(".js") || p.endsWith(".mjs")) return "application/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".json") || p.endsWith(".webmanifest")) return "application/json";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".webp")) return "image/webp";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".ico")) return "image/x-icon";
        if (p.endsWith(".woff2")) return "font/woff2";
        if (p.endsWith(".webm")) return "audio/webm";
        if (p.endsWith(".ogg")) return "audio/ogg";
        if (p.endsWith(".mp3")) return "audio/mpeg";
        if (p.endsWith(".m4a")) return "audio/mp4";
        if (p.endsWith(".wav")) return "audio/wav";
        return "application/octet-stream";
    }

    /* ------------------------------------------------------------------ */
    /*  暴露给网页的原生能力                                                */
    /* ------------------------------------------------------------------ */

    private class NativeBridge {

        /** 录音期间保持屏幕常亮（网页里的 Wake Lock API 在 WebView 里不可用） */
        @JavascriptInterface
        public void setRecording(final boolean recording) {
            runOnUiThread(() -> {
                if (recording) {
                    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                } else {
                    getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                }
            });
        }

        /**
         * 保存文件到「下载」目录。
         * WebView 不支持 <a download> 配合 blob: URL，所以导出必须走原生。
         */
        @JavascriptInterface
        public void saveBase64File(final String name, final String base64, final String mime) {
            final String safeName = (name == null || name.trim().isEmpty()) ? "语音笔记" : name.trim();
            final String type = (mime == null || mime.isEmpty()) ? "application/octet-stream" : mime;
            String result;
            try {
                byte[] data = Base64.decode(base64, Base64.DEFAULT);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    result = writeViaMediaStore(safeName, type, data);
                } else {
                    result = writeToAppDownloads(safeName, data);
                }
            } catch (Exception e) {
                Log.e(TAG, "保存文件失败", e);
                result = "保存失败：" + e.getMessage();
            }
            final String message = result;
            runOnUiThread(() -> Toast.makeText(MainActivity.this, message, Toast.LENGTH_LONG).show());
        }

        @JavascriptInterface
        public void toast(final String message) {
            if (message == null) return;
            runOnUiThread(() -> Toast.makeText(MainActivity.this, message, Toast.LENGTH_SHORT).show());
        }
    }

    /** Android 10+ ：写入公共「下载」目录，不需要任何存储权限 */
    private String writeViaMediaStore(String name, String mime, byte[] data) throws Exception {
        ContentValues values = new ContentValues();
        values.put(MediaStore.Downloads.DISPLAY_NAME, name);
        values.put(MediaStore.Downloads.MIME_TYPE, mime);
        values.put(MediaStore.Downloads.IS_PENDING, 1);

        Uri item = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
        if (item == null) return "保存失败：无法创建文件";

        try (OutputStream out = getContentResolver().openOutputStream(item)) {
            if (out == null) return "保存失败：无法写入";
            out.write(data);
            out.flush();
        }

        values.clear();
        values.put(MediaStore.Downloads.IS_PENDING, 0);
        getContentResolver().update(item, values, null, null);
        return "已保存到「下载」：" + name;
    }

    /** Android 9 及以下：写到应用自己的下载目录（同样免权限），并告知路径 */
    private String writeToAppDownloads(String name, byte[] data) throws Exception {
        File dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if (dir == null) dir = getFilesDir();
        if (!dir.exists() && !dir.mkdirs()) return "保存失败：无法创建目录";
        File target = new File(dir, name);
        try (FileOutputStream out = new FileOutputStream(target)) {
            out.write(data);
            out.flush();
        }
        return "已保存到：" + target.getAbsolutePath();
    }

    /* ------------------------------------------------------------------ */
    /*  权限与生命周期                                                      */
    /* ------------------------------------------------------------------ */

    private boolean hasMicPermission() {
        return checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
    }

    private void requestMicPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_MIC);
        }
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        if (code == REQ_MIC) {
            boolean granted = results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED;
            if (pendingPermission != null) {
                if (granted) {
                    pendingPermission.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                } else {
                    pendingPermission.deny();
                }
                pendingPermission = null;
            }
            if (webView.getUrl() == null) {
                // 无论是否授权都进入应用；没有权限时页面会提示，仍可查看已有笔记
                webView.loadUrl(START_URL);
            }
            if (!granted) {
                Toast.makeText(this, "没有麦克风权限，录音功能不可用", Toast.LENGTH_LONG).show();
            }
        }
        super.onRequestPermissionsResult(code, permissions, results);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE) {
            if (pendingFileCallback != null) {
                pendingFileCallback.onReceiveValue(
                        WebChromeClient.FileChooserParams.parseResult(resultCode, data));
                pendingFileCallback = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && webView != null && webView.canGoBack()) {
            webView.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.removeJavascriptInterface("VoiceNotesNative");
            webView.loadUrl("about:blank");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
