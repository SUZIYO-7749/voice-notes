# 🎙️ 语音笔记

一款**专门用来记录你的声音**的笔记软件。想到什么就说出来，它替你留住声音、顺手把话变成文字。

所有数据都保存在你自己的设备上，不需要注册、不需要联网、不上传任何服务器。

---

## 快速开始

双击 **`启动语音笔记.bat`**，浏览器会自动打开 <http://127.0.0.1:5173/>。

启动窗口里还会打印一条局域网地址（形如 `http://192.168.1.7:5173/`），那是给**手机**用的，详见 [在安卓手机上使用](#-在安卓手机上使用)。

首次使用请点击地址栏的权限提示，**允许访问麦克风**。然后点一下底部那个红色麦克风按钮，开始说话。

> 也可以在命令行里手动启动：
> ```bash
> node server.mjs          # 默认 5173 端口
> node server.mjs 8080     # 换端口
> ```

### 为什么需要一个本地服务？

浏览器只在 `https://` 或 `http://localhost` 这样的「安全上下文」里才肯交出麦克风权限。直接双击 `index.html` 用 `file://` 打开，录音功能会被浏览器禁用。`server.mjs` 是一个**零依赖**的本地静态服务器，只为满足这个要求。

---

## 功能

### 🎙️ 录音
- 一键开始 / 结束，**空格键**也能直接开关
- 录音浮层里有实时滚动的声波、大号计时器
- 支持**暂停 / 继续**，暂停期间不计入时长、也不转写
- 想反悔就点两次「取消」，录音直接丢弃不占空间

### ✍️ 语音转文字
- 录音时边说边转写，文字实时上屏
- 用 Chrome / Edge 效果最好（识别过程需要联网）
- 浏览器不支持转写时**录音功能完全不受影响**，文字稿可以事后手动补

### 🎧 回放与整理
- 每条笔记都保存了**波形图**，进度条上直接看到说到哪儿了
- 点波形任意位置**跳转播放**，支持 0.75× ~ 2× 变速
- 文字稿随时可编辑，还能一键在光标处**插入 `[00:12]` 时间戳**
- 标签、收藏、全文搜索（标题 / 文字稿 / 标签都能搜）

### 💾 数据与备份
- 音频存 IndexedDB，元数据在同一个库里，刷新、关浏览器都不丢
- 会主动申请**持久化存储**权限，降低被浏览器清理的风险
- 导出：单条导出 JSON、下载原始音频、全量备份（可选是否内嵌音频）
- 导入：备份文件、本地音频文件（自动解析时长与波形）

### 📱 装到桌面 / 手机
内置 PWA，用 Chrome / Edge 打开后点地址栏的「安装」图标，就能像原生应用一样独立窗口运行，断网也能打开。

---

## 快捷键

| 按键 | 作用 |
| --- | --- |
| `空格` | 开始 / 结束录音 |
| `Esc` | 关闭设置面板；录音中则结束并保存；移动端返回列表 |
| `Ctrl` / `⌘` + `F`（或 `K`） | 聚焦搜索框 |
| `Enter`（标签输入框内） | 添加标签 |

---

## 📱 在安卓手机上使用

界面已经按手机端做过了：单列布局、整屏滑入的详情页、底部抽屉式设置、底部大号录音按钮、刘海屏/手势条安全区适配、录音时自动保持屏幕常亮。手机上就是**竖屏打开即用**。

### 为什么手机上要多做一步设置

浏览器有一条硬性安全规定：**只有 `https://` 或 `localhost` 这类「安全上下文」才允许网页使用麦克风**。手机通过局域网访问电脑时地址是 `http://192.168.x.x:5173`，既不是 https 也不是 localhost，所以 Chrome 会直接拒绝录音。这不是本应用的限制，任何网页录音都绕不过去。

下面两条路任选一条。

---

#### 路线 A：局域网直连（最快，1 分钟）

1. 电脑上双击 `启动语音笔记.bat`，窗口里会打印出手机可用的地址，形如：
   ```
   手机上打开（需与电脑连同一个 Wi-Fi）：
     http://192.168.1.7:5173/
   ```
2. 手机连上**同一个 Wi-Fi**，在 Chrome 地址栏打开这个地址。
3. 在手机 Chrome 里打开 `chrome://flags/#unsafely-treat-insecure-origin-as-secure`：
   - 在输入框里填 `http://192.168.1.7:5173`（换成你上一步看到的地址）
   - 右侧下拉框选 **Enabled**
   - 点底部 **Relaunch** 重启浏览器
4. 重新打开该地址，允许麦克风权限，即可正常录音。

> 这一步相当于告诉 Chrome「这个地址我信任，按安全页面对待」。只用做一次。
> 之后可以点 Chrome 菜单里的「添加到主屏幕」，桌面上就会出现「语音笔记」图标，点开是全屏应用，不再有浏览器地址栏。

---

#### 路线 B：放到任意 HTTPS 静态托管（体验最好）

本项目是纯静态的，没有任何后端。把整个文件夹上传到任意支持 HTTPS 的静态托管（公司内网服务器、NAS、对象存储、GitHub Pages / Vercel / Netlify 等）即可：

- 手机上直接用 `https://` 地址打开，**不需要任何 flag 设置**，麦克风、离线缓存、安装到主屏幕全部正常。
- 录音和文字稿依然**只存在手机本地**（IndexedDB），托管端只提供静态文件，拿不到你的任何录音。

---

### 手机上会得到什么

- 点桌面图标直接进入全屏应用，没有浏览器地址栏
- 底部大号麦克风按钮，拇指可直接够到；录音浮层从底部升起，三个操作按钮都是 44px 以上的触控尺寸
- 录音时屏幕保持常亮，录长笔记不会中途黑屏
- 断网也能打开（Service Worker 缓存了应用外壳）
- 切到别的 App 再回来，识别会自动续上

---

### 安卓安装包（APK）

打好了两个版本，都在项目根目录，传到手机点击安装即可（需允许「安装未知来源应用」）：

| 安装包 | 大小 | 说明 |
| --- | --- | --- |
| **`语音笔记.apk`** | ~120 KB | ⭐ **纯原生版**：原生界面 + 原生 MediaRecorder 录音 + 原生 SQLite，完全不碰浏览器 |
| `语音笔记-网页版.apk` | ~165 KB | WebView 外壳，把网页界面装进 APK（保留作为备选） |

两个包包名不同，可以同时装在一台手机上，互不影响。

#### 纯原生版 vs 网页版

| | 纯原生版 | 网页版 |
| --- | --- | --- |
| 界面 | 原生 View / XML 布局 | HTML + CSS（WebView 渲染） |
| 录音 | 原生 `MediaRecorder` → AAC/.m4a | WebView 里的网页 `MediaRecorder` |
| 存储 | 原生 `SQLiteOpenHelper` + 私有目录音频 | IndexedDB |
| 播放 / 波形 | 原生 `MediaPlayer` + 自绘 `WaveView` | Web Audio + Canvas |
| 实时语音转文字 | ❌ 见下 | ❌ 见下 |
| 单独「语音输入文字稿」 | ✅ 用系统 `SpeechRecognizer` | ✅ 用浏览器语音识别 |
| 依赖 | 只有 `android.jar`，零第三方库 | androidx.webkit |

> **两个 APK 都没有「边录音边出字」。** 原因是 Android 的麦克风是独占的：系统语音识别服务和 `MediaRecorder` 同时开，会让录音变成静音。这不是实现偷懒，是平台限制。
> 所以纯原生版把语音转文字做成详情页里的**「语音输入」按钮**——此时不录音，把你说的话转成文字稿，稳定可靠。录音本身当然完全正常。

#### 纯原生版的界面与操作

- **列表页**：搜索框（标题/文字稿/标签）、全部↔收藏筛选、卡片显示标题、摘要、迷你波形、时长、日期、标签；长按卡片可收藏 / 重命名 / 删除；底部红色麦克风按钮开始录音。
- **录音页**：进入即开录，大号等宽计时器 + 实时滚动波形（每 50ms 采一次振幅），支持暂停/继续，取消会有二次确认；录音期间屏幕常亮。
- **详情页**：点波形任意位置定位播放、播放/暂停、编辑标题与文字稿、标签（逗号分隔自动去重）、语音输入文字、复制文字稿、导出音频到「下载」、删除。

#### 崩溃了怎么办

应用内置了崩溃自记日志（`CrashLogger`，装在 `Application` 里，所以**连 Activity 构造函数阶段、`onCreate` 之前的崩溃也能记下来**——那正是"一打开就闪退、什么提示都没有"的典型情况）。

崩溃后重新打开应用，会直接弹窗显示上次的堆栈，带「复制日志」按钮。同一份日志还会写到 **`下载/语音笔记-崩溃日志.txt`**，所以即使应用完全起不来，也能用文件管理器找到它。

#### 自己重新打包

```powershell
# 一次性准备工具链（下载 Android SDK 命令行工具、platform 34、build-tools 35）
powershell -ExecutionPolicy Bypass -File tools/setup-android.ps1

# 纯原生版
powershell -ExecutionPolicy Bypass -File tools/build-native-apk.ps1

# 网页版
powershell -ExecutionPolicy Bypass -File tools/build-apk.ps1
```

两个脚本**都不需要 Gradle，也不需要 Maven**，只用 SDK 的 build-tools 手工走完整条链路：

```
aapt2 compile → aapt2 link → javac → d8 → 写入 classes.dex（网页版还要写 assets）→ zipalign → apksigner
```

全部离线可复现。签名密钥首次打包时自动生成：

- 原生版：`android-native/keystore/voice-notes-native.jks`
- 网页版：`android/keystore/voice-notes.jks`

口令都是 `voicenotes`。**换机器打包前请备份密钥**，否则无法覆盖升级已安装的应用。

#### 打包过程中踩到的坑（脚本里都处理了）

1. **build-tools 34.0.0 的 d8 遇到任何内部类都会内部崩溃**，换 35.0.0 解决；打包脚本检测到 34 会强制重装。
2. **aapt2 / d8 读不了含中文的路径**（项目目录叫「语音笔记」），所以先复制到纯 ASCII 临时目录再构建。
3. **aapt2 在 Windows 上把 assets 条目名写成反斜杠**（`assets/www\app.js`），运行期 `getAssets().open()` 必然失败。网页版改成由脚本自己以正斜杠写入，打包后逐字节比对确认。
4. **aapt2 不会自动注入 `package` 属性**（那是 Gradle 干的活），必须写在 `AndroidManifest.xml` 里。
5. **PowerShell 5.1 会把无 BOM 的 .ps1 当 GBK 读**，中文注释会让语法崩掉，所以脚本统一存成带 BOM 的 UTF-8。
6. **Activity 的字段初始化器里不能用 Context**：`private final X x = new X(this);` 这种写法里，`X` 构造时若调用 `getColor()/getResources()`，会因为系统还没调用 `Activity.attach()`（设置 base Context）而 NPE —— 这是「一打开就闪退」的头号原因，且崩在 `onCreate` 之前，连日志都看不到。`tools/check-native.mjs` 现在会静态拦住它。
7. **`findViewById` 的 id 存在 ≠ 它在你这个布局里**：`javac` 只检查 `R.id.xxx` 符号是否存在，不看是哪个布局。`check-native.mjs` 会把「Activity ↔ 它 setContentView 的布局」对上，顺带校验赋值类型是否兼容（否则是 ClassCastException）。

#### 工程结构

```
android-native/                    # 纯原生版
├─ app/src/main/
│  ├─ AndroidManifest.xml
│  ├─ java/com/voicenotes/nativeapp/
│  │  ├─ MainActivity.java         # 列表：搜索 / 筛选 / 长按菜单
│  │  ├─ RecordActivity.java       # 录音：计时 + 实时波形 + 暂停
│  │  ├─ DetailActivity.java       # 详情：播放 / 编辑 / 语音输入 / 导出
│  │  ├─ Recorder.java             # MediaRecorder 封装 + 振幅采样
│  │  ├─ Player.java               # MediaPlayer 封装 + 进度回调
│  │  ├─ WaveView.java             # 自绘波形控件（可点击定位）
│  │  ├─ SpeechHelper.java         # 系统 SpeechRecognizer 封装
│  │  ├─ Db.java / Note.java       # SQLite 存储
│  │  ├─ NoteAdapter.java          # ListView 适配器
│  │  ├─ AudioStore.java           # 录音文件管理
│  │  ├─ ExportHelper.java         # 导出到「下载」目录
│  │  └─ Ui.java                   # 单位换算 / 时间大小格式化 / 波形重采样
│  └─ res/                         # 4 个布局 + 深色主题 + 矢量图标
└─ keystore/voice-notes-native.jks

android/                           # 网页版（WebView 外壳）
├─ app/src/main/
│  ├─ AndroidManifest.xml
│  ├─ java/com/voicenotes/app/
│  │  └─ MainActivity.java         # WebView 外壳 + 原生桥
│  ├─ res/                         # 图标、主题、字符串
│  └─ assets/www/                  # 打包时自动同步过去的网页应用
├─ keystore/voice-notes.jks
└─ build.gradle / settings.gradle  # 给 Android Studio 用户备用的 Gradle 配置
```

#### 网页版外壳做的原生适配

WebView 直接跑网页会踩几个坑，`android/.../MainActivity.java` 里都处理了：

1. **麦克风**：WebView 里 `file://` 不是安全上下文，`getUserMedia` 会被拒。所以自己拦截请求，把 assets 以 `https://appassets.androidplatform.net/assets/www/` 提供给 WebView，页面就成了安全上下文。
2. **权限**：`WebChromeClient.onPermissionRequest` 里先要系统 `RECORD_AUDIO` 权限，拿到后再答复 WebView。
3. **文件选择器**：WebView 默认不支持 `<input type="file">`，不实现 `onShowFileChooser` 的话「导入备份 / 导入音频」点了没反应。
4. **导出下载**：WebView 不支持 `<a download>` 配 `blob:` URL。所以网页里的 `downloadBlob()` 会检测到原生桥 `window.VoiceNotesNative`，改走原生写入「下载」目录（Android 10+ 用 MediaStore，免存储权限）。
5. **屏幕常亮**：WebView 里没有 Wake Lock API，录音时通过原生桥 `setRecording(true)` 加 `FLAG_KEEP_SCREEN_ON`。
6. **外部链接**：站外链接一律交给系统浏览器打开，避免 JS 桥暴露给任意页面。

> 用 Android Studio 打包也可以：直接打开 `android/` 或 `android-native/` 目录即可。注意包名写在 `AndroidManifest.xml` 的 `package` 属性里（`build.gradle` 不声明 `namespace`），这样手工打包和 Gradle 打包保持一致。

---

## 项目结构

```
语音笔记/
├─ index.html                 # 页面结构
├─ app.css                    # 设计系统（深/浅色、响应式）
├─ manifest.webmanifest       # PWA 清单
├─ sw.js                      # Service Worker（网络优先，离线可用）
├─ server.mjs                 # 零依赖本地静态服务器
├─ 启动语音笔记.bat            # 双击即用
├─ js/
│  ├─ app.js                  # 主逻辑：状态、渲染、播放器、导入导出
│  ├─ db.js                   # IndexedDB 数据层
│  ├─ audio.js                # 录音引擎（MediaRecorder + 波形分析）
│  ├─ speech.js               # 语音转写（Web Speech API 封装）
│  ├─ wave.js                 # 波形绘制（列表迷你波形 / 详情波形 / 实时波形）
│  └─ utils.js                # 时间格式化、转义、文件下载等
├─ icons/                     # PWA 图标
├─ android/                   # 网页版（WebView 外壳）安卓工程
├─ android-native/            # 纯原生版安卓工程
└─ tools/
   ├─ make-icons.py           # 图标生成脚本（PWA + 两套安卓工程一次生成）
   ├─ check-dom.mjs           # 网页版静态自检：DOM 引用是否都能对上
   ├─ check-native.mjs        # 原生版静态自检：findViewById 是否都在自己的布局里
   ├─ selftest.mjs            # 纯逻辑单元测试
   ├─ cdp.mjs                 # 无头 Chrome + CDP 的最小封装（下面两个测试共用）
   ├─ e2e.mjs                 # 桌面端端到端测试
   ├─ mobile.mjs              # 手机端（安卓）端到端测试：Pixel 视口 + 真实触摸事件
   ├─ setup-android.ps1       # 准备 JDK / Android SDK / build-tools
   ├─ build-native-apk.ps1    # 打包纯原生版 APK
   └─ build-apk.ps1           # 打包网页版 APK
```

---

## 开发与测试

```bash
node tools/check-dom.mjs    # 网页版：JS 里的 #id 与 el.xxx 引用是否都能找到
node tools/check-native.mjs # 原生版：findViewById 的 id 是否都在它自己的布局里
node tools/selftest.mjs     # 纯逻辑单元测试（格式化、波形重采样、转义等）
node server.mjs 5173        # 启动本地服务
node tools/e2e.mjs          # 桌面端端到端测试（需先启动服务，且本机能启动 Chrome）
node tools/mobile.mjs       # 手机端端到端测试（Pixel 视口 + 触摸事件 + 安卓 UA）
```

两个端到端测试都会启动一个无头 Chrome（带假的麦克风设备），把真实链路跑一遍并抓取页面里所有未捕获异常：

- **`e2e.mjs`**：录音 → 保存 → 播放 → 编辑文字稿 → 标签 → 收藏 → 搜索 → 刷新后仍在（IndexedDB 持久化）→ 删除到回收站 → 恢复。其中波形进度是**逐像素**核对的：点击波形 75% 处后，直接读画布像素确认高亮画到了 75%。
- **`mobile.mjs`**：以 Pixel 8 的 412×915 视口、`dpr 2.625`、安卓 UA 渲染，用 **CDP 派发真实触摸事件**（不是 `element.click()`）驱动录音按钮、列表项、返回键和设置抽屉；同时校验单列布局、无横向溢出、触控目标尺寸、底部安全区、抽屉是否真的贴着底边。

两个测试都会把截图写到 `.verify-note.png` / `.mobile-shots/`，方便人工核对排版。

**`check-native.mjs` 值得单独说一句**：`javac` 只能保证 `R.id.xxx` 这个符号存在，保证不了「某个 Activity 里 `findViewById` 的 id 就在它自己的布局里」——而这正是原生 Android 最常见、最难查的运行时崩溃（返回 null → NPE）。这个脚本把代码和布局对上，并且校验布局里用到的自定义 View 都有对应 Java 类。

想重新生成图标：

```bash
python tools/make-icons.py
```

---

## 浏览器支持

| 浏览器 | 录音 | 实时转写 |
| --- | --- | --- |
| Chrome / Edge（桌面） | ✅ | ✅ 推荐 |
| Safari（桌面 / iOS） | ✅ | ⚠️ 支持有限，识别断续 |
| Firefox | ✅ | ❌ 不支持，可手动输入文字稿 |
| 手机 Chrome / Edge | ✅ | ✅ |

> 未压缩的录音约 **每分钟 1 MB**（Opus 128 kbps）。

---

## 隐私

- 录音和文字稿只写进这台设备浏览器的 IndexedDB，**没有后端、没有账号、没有上传**。
- 唯一的例外：开启语音转写时，浏览器会把音频片段发给它自己的语音识别服务（Chrome 是 Google）。不想联网转写，就把设置里的「录音时自动转写文字」关掉即可，录音依旧完全在本地。
- 清空浏览器数据会连录音一起删掉，重要内容请用「导出全部备份」留一份。

---

## 发布到 GitHub

双击根目录的 **`上传到GitHub.bat`**，按提示走即可。它会先把提交作者改成你的 GitHub 用户名，再设好远端并推送（首次会弹出浏览器让你授权）。

推送前需要先在网页上建一个**完全空白**的仓库：

1. 打开 <https://github.com/new>
2. Repository name 填 `voice-notes`
3. Public / Private 都行
4. **Add a README file、Add .gitignore、Choose a license 这三个都不要勾**（勾了远端就不是空仓库，推送会被拒）
5. 点 Create repository

想手动敲命令的话：

```bash
git config user.name  "你的用户名"
git config user.email "你的用户名@users.noreply.github.com"
git commit --amend --reset-author --no-edit      # 让提交算到你账号名下
git remote add origin https://github.com/你的用户名/voice-notes.git
git push -u origin main
```

### ⚠️ 签名密钥不在仓库里

`.gitignore` 已经排除了 `android/keystore/*.jks` 和 `android-native/keystore/*.jks`。**这是故意的，别去掉**：

- **泄露** → 任何人都能签出冒充本应用的安装包，覆盖升级已安装的用户
- **丢失** → 以后打的新包无法覆盖升级，用户只能先卸载再装

密钥目前备份在 **`D:\语音笔记-密钥备份\`**（项目目录之外，不会被 git 跟踪）。建议再存一份到网盘或密码管理器。

