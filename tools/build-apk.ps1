# 语音笔记 · 打包安卓 APK（不依赖 Gradle / Maven）
#
# 只用 Android SDK 的 build-tools 手工走完整条链路：
#   aapt2 compile → aapt2 link → javac → d8 → zipalign → apksigner
# 好处是完全离线、可复现，不需要联网拉任何依赖。
#
# 注意：aapt2 / d8 这类原生工具读不了含中文的路径（本项目目录叫「语音笔记」），
# 所以先把工程复制到一个纯 ASCII 的临时目录再构建，最后把 APK 拷回来。
#
# 用法： powershell -ExecutionPolicy Bypass -File tools/build-apk.ps1

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

$Project     = Split-Path -Parent $PSScriptRoot
$AndroidDir  = Join-Path $Project 'android'
$AppSrc      = Join-Path $AndroidDir 'app\src\main'
$Keystore    = Join-Path $AndroidDir 'keystore\voice-notes.jks'
$EnvFile     = Join-Path $PSScriptRoot 'android-env.ps1'
$ApkName     = '语音笔记-网页版.apk'

# 纯 ASCII 的工作目录（$env:TEMP 在本机是 C:\Users\...\Temp）
$Stage       = Join-Path $env:TEMP 'vn-android-build'
$StageRes    = Join-Path $Stage 'res'
$StageAssets = Join-Path $Stage 'assets'
$StageWww    = Join-Path $StageAssets 'www'
$StageJava   = Join-Path $Stage 'java'
$StageManifest = Join-Path $Stage 'AndroidManifest.xml'
$StageKs     = Join-Path $Stage 'voice-notes.jks'
$BuildDir    = Join-Path $Stage 'build'

function Write-Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Info($msg) { Write-Host "  $msg" -ForegroundColor Gray }
function Fail($msg)       { Write-Host "`n  [失败] $msg" -ForegroundColor Red; exit 1 }

# ---------------------------------------------------------------- 工具链
Write-Step '检查工具链'

# 返回第一个不可用的工具路径；全部可用时返回 $null
function Get-MissingTool {
    foreach ($tool in @($Javac, $Keytool, $AndroidJar, $Aapt2, $D8, $ZipAlign, $ApkSigner)) {
        if (-not $tool -or -not (Test-Path $tool)) { return "$tool" }
    }
    return $null
}

if (Test-Path $EnvFile) { . $EnvFile }
$missing = Get-MissingTool
# build-tools 34.0.0 自带的 d8 遇到内部类必崩，必须用 35.0.0，否则强制重装
if (-not $missing -and $D8 -match 'build-tools\\34\.') {
    $missing = "d8 来自已知有问题的 build-tools 34.0.0"
}

if ($missing) {
    Write-Info "工具链不可用（$missing），重新运行 setup-android.ps1"
    Remove-Item $EnvFile -Force -ErrorAction SilentlyContinue
    & (Join-Path $PSScriptRoot 'setup-android.ps1')
    if ($LASTEXITCODE -ne 0) { Fail '工具链准备失败' }
    . $EnvFile
    $missing = Get-MissingTool
    if ($missing) { Fail "工具链仍不完整：$missing" }
}
Write-Ok "JDK        = $JavaHome"
Write-Ok "build-tools= $BuildTools"

# ---------------------------------------------------------------- 签名密钥
Write-Step '准备签名密钥'
if (-not (Test-Path $Keystore)) {
    New-Item -ItemType Directory -Force -Path (Split-Path $Keystore) | Out-Null
    Write-Info '生成新的签名密钥（口令均为 voicenotes）'
    & $Keytool -genkeypair -v -keystore $Keystore -storetype PKCS12 `
        -alias voicenotes -keyalg RSA -keysize 2048 -validity 10950 `
        -storepass voicenotes -keypass voicenotes `
        -dname "CN=Voice Notes, OU=Personal, O=Voice Notes, L=Unknown, ST=Unknown, C=CN" 2>&1 |
        Select-String -Pattern 'Generating|storing' | ForEach-Object { Write-Info $_.Line }
    if (-not (Test-Path $Keystore)) { Fail '签名密钥生成失败' }
}
Write-Ok "密钥：$Keystore"

# ---------------------------------------------------------------- 准备 ASCII 工作区
Write-Step '准备构建工作区（复制到纯 ASCII 路径）'
if (Test-Path $Stage) { Remove-Item -Recurse -Force $Stage }
New-Item -ItemType Directory -Force -Path $Stage | Out-Null
Copy-Item (Join-Path $AppSrc 'AndroidManifest.xml') $Stage -Force
foreach ($d in @('res', 'java')) {
    Copy-Item (Join-Path $AppSrc $d) $Stage -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $StageWww | Out-Null
Copy-Item $Keystore $StageKs -Force
Write-Ok $Stage

# ---------------------------------------------------------------- 同步网页资源
Write-Step '同步 Web 应用到 assets'
foreach ($f in @('index.html', 'app.css', 'manifest.webmanifest')) {
    $src = Join-Path $Project $f
    if (-not (Test-Path $src)) { Fail "缺少文件：$f" }
    Copy-Item $src -Destination $StageWww -Force
}
foreach ($d in @('js', 'icons')) {
    $src = Join-Path $Project $d
    if (-not (Test-Path $src)) { Fail "缺少目录：$d" }
    Copy-Item $src -Destination $StageWww -Recurse -Force
}
# sw.js 故意不打包：本地 assets 域下 Service Worker 无意义，应用里也已跳过注册
Write-Ok ("已同步 {0} 个文件" -f (Get-ChildItem $StageWww -Recurse -File).Count)

# ---------------------------------------------------------------- 构建目录
New-Item -ItemType Directory -Force -Path $BuildDir | Out-Null
$CompiledZip = Join-Path $BuildDir 'compiled.zip'
$BaseApk     = Join-Path $BuildDir 'base.apk'
$GenDir      = Join-Path $BuildDir 'gen'
$ClassesDir  = Join-Path $BuildDir 'classes'
$DexDir      = Join-Path $BuildDir 'dex'
$UnsignedApk = Join-Path $BuildDir 'unsigned.apk'
$AlignedApk  = Join-Path $BuildDir 'aligned.apk'
foreach ($d in @($GenDir, $ClassesDir, $DexDir)) {
    New-Item -ItemType Directory -Force -Path $d | Out-Null
}

# ---------------------------------------------------------------- 1. 编译资源
Write-Step '1/6  aapt2 compile'
& $Aapt2 compile --dir $StageRes -o $CompiledZip 2>&1 | ForEach-Object { Write-Info $_ }
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $CompiledZip)) { Fail 'aapt2 compile 失败' }
Write-Ok ("资源已编译：{0} KB" -f [math]::Round((Get-Item $CompiledZip).Length / 1KB, 1))

# ---------------------------------------------------------------- 2. 链接资源
Write-Step '2/6  aapt2 link'
# 刻意不用 aapt2 的 -A 打包 assets：它在 Windows 上会把条目名写成反斜杠
# （assets/www\index.html），运行期 getAssets().open("assets/www/index.html") 就找不到。
# 所以 assets 在第 5 步由脚本自己以正斜杠条目名写入。
& $Aapt2 link -o $BaseApk -I $AndroidJar --manifest $StageManifest `
    --java $GenDir `
    --min-sdk-version 24 --target-sdk-version 34 `
    --version-code 1 --version-name '1.0' `
    $CompiledZip 2>&1 | ForEach-Object { Write-Info $_ }
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $BaseApk)) { Fail 'aapt2 link 失败' }
Write-Ok '已生成基础 APK（含资源与清单）'

# ---------------------------------------------------------------- 3. 编译 Java
Write-Step '3/6  javac'
$sources = @()
$sources += (Get-ChildItem -Path $StageJava -Recurse -Filter *.java | ForEach-Object { $_.FullName })
$sources += (Get-ChildItem -Path $GenDir -Recurse -Filter *.java -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })
if (-not $sources.Count) { Fail '没有找到任何 .java 源文件' }
Write-Info "源文件 $($sources.Count) 个"
# Java 8 字节码：最兼容的 d8 输入，也避免 Java 11 的 nest 属性触发 R8 内部错误
& $Javac -source 8 -target 8 -encoding UTF-8 -nowarn -classpath $AndroidJar -d $ClassesDir $sources 2>&1 |
    Where-Object { $_ -notmatch 'bootstrap class path|source value 8|target value 8|deprecat|过时' } |
    ForEach-Object { Write-Info $_ }
if ($LASTEXITCODE -ne 0) { Fail 'javac 编译失败' }
Write-Ok ("编译出 {0} 个 .class" -f (Get-ChildItem -Path $ClassesDir -Recurse -Filter *.class).Count)

# ---------------------------------------------------------------- 4. 转 DEX
Write-Step '4/6  d8'
$classFiles = Get-ChildItem -Path $ClassesDir -Recurse -Filter *.class | ForEach-Object { $_.FullName }
& $D8 --lib $AndroidJar --min-api 24 --output $DexDir $classFiles 2>&1 | ForEach-Object { Write-Info $_ }
$dexFile = Join-Path $DexDir 'classes.dex'
if (-not (Test-Path $dexFile)) { Fail 'd8 没有产出 classes.dex' }
Write-Ok ("classes.dex：{0} KB" -f [math]::Round((Get-Item $dexFile).Length / 1KB, 1))

# ---------------------------------------------------------------- 5. 合并 + 对齐
Write-Step '5/6  写入 classes.dex 与 assets，然后 zipalign'
Add-Type -AssemblyName System.IO.Compression.FileSystem
Copy-Item $BaseApk $UnsignedApk -Force
$zip = [System.IO.Compression.ZipFile]::Open($UnsignedApk, 'Update')

if ($zip.Entries | Where-Object { $_.FullName -eq 'classes.dex' }) {
    $zip.Entries | Where-Object { $_.FullName -eq 'classes.dex' } | ForEach-Object { $_.Delete() }
}
[System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $dexFile, 'classes.dex', 'Optimal') | Out-Null

# 以正斜杠条目名写入 assets/www/**，顺序保持稳定便于复现
$assetCount = 0
Get-ChildItem -Path $StageAssets -Recurse -File | Sort-Object FullName | ForEach-Object {
    $rel = $_.FullName.Substring($StageAssets.Length + 1) -replace '\\', '/'
    $entryName = 'assets/' + $rel
    if ($zip.Entries | Where-Object { $_.FullName -eq $entryName }) {
        $zip.Entries | Where-Object { $_.FullName -eq $entryName } | ForEach-Object { $_.Delete() }
    }
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $entryName, 'Optimal') | Out-Null
    $assetCount++
}
$zip.Dispose()
Write-Ok "已写入 classes.dex 和 $assetCount 个 assets 文件"

& $ZipAlign -f -p 4 $UnsignedApk $AlignedApk 2>&1 | ForEach-Object { Write-Info $_ }
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $AlignedApk)) { Fail 'zipalign 失败' }
Write-Ok '已按 4 字节对齐'

# ---------------------------------------------------------------- 6. 签名
Write-Step '6/6  apksigner 签名'
$target = Join-Path $Project $ApkName
if (Test-Path $target) { Remove-Item -Force $target }
& $ApkSigner sign --ks $StageKs --ks-type PKCS12 `
    --ks-pass pass:voicenotes --ks-key-alias voicenotes --key-pass pass:voicenotes `
    --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true `
    --out $target $AlignedApk 2>&1 | ForEach-Object { Write-Info $_ }
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $target)) { Fail 'apksigner 签名失败' }
Write-Ok "已签名：$target"

# ---------------------------------------------------------------- 校验
Write-Step '校验 APK'
Write-Info '--- 签名 ---'
# 先把输出收进变量再截取：Select-Object -First 会提前掐断管道，
# 导致 apksigner 收到断管而以非零码退出，被误判成校验失败
$signOut = & $ApkSigner verify --verbose --print-certs $target 2>&1
$verifyExit = $LASTEXITCODE
$signOut | Select-Object -First 14 | ForEach-Object { Write-Info $_ }

Write-Info '--- 清单 ---'
$badging = & $Aapt2 dump badging $target 2>&1
$badging |
    Select-String -Pattern '^package|launchable-activity|uses-permission|application-label|sdkVersion|targetSdkVersion' |
    Select-Object -First 12 | ForEach-Object { Write-Info $_.Line }

Write-Info '--- 关键文件 ---'
$zip = [System.IO.Compression.ZipFile]::OpenRead($target)
$names = $zip.Entries | ForEach-Object { $_.FullName }
$zip.Dispose()
foreach ($need in @('classes.dex', 'AndroidManifest.xml', 'resources.arsc',
                    'assets/www/index.html', 'assets/www/app.css', 'assets/www/js/app.js',
                    'assets/www/js/audio.js', 'assets/www/js/db.js', 'assets/www/icons/icon-192.png')) {
    if ($names -contains $need) { Write-Ok $need } else { Write-Host "  [缺失] $need" -ForegroundColor Red }
}
Write-Info ("APK 内共 {0} 个条目" -f $names.Count)

Write-Info '--- 对齐 ---'
& $ZipAlign -c -v 4 $target 2>&1 | Select-Object -Last 2 | ForEach-Object { Write-Info $_ }

if ($verifyExit -ne 0) { Fail '签名校验未通过' }

Write-Host "`n打包完成 🎉" -ForegroundColor Green
Write-Host ("  {0}   {1} MB" -f $target, [math]::Round((Get-Item $target).Length / 1MB, 2)) -ForegroundColor Green
Write-Host '  传到手机点击安装即可（需允许「安装未知来源应用」）。' -ForegroundColor Gray






