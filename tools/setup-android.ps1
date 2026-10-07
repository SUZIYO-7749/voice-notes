# 语音笔记 · 安卓工具链引导脚本
# 负责准备：JDK、Android SDK（cmdline-tools + platform 34 + build-tools 34）、Gradle 8.7
# 用法： powershell -ExecutionPolicy Bypass -File tools/setup-android.ps1
#
# 注意：原生命令（java/sdkmanager）会把信息写到 stderr，若 ErrorActionPreference=Stop
# 会直接终止脚本，所以这里统一用 Continue + 显式检查 $LASTEXITCODE。

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

$SdkRoot    = if ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
$CmdlineDir = Join-Path $SdkRoot 'cmdline-tools\latest'
$GradleHome = Join-Path $env:USERPROFILE 'gradle-8.7'
$Downloads  = Join-Path $env:TEMP 'vn-android-dl'
$EnvFile    = Join-Path $PSScriptRoot 'android-env.ps1'

$CmdlineUrl = 'https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip'
# services.gradle.org 在国内经常连接被重置，按顺序回退到官方 CDN 和国内镜像
$GradleUrls = @(
    'https://services.gradle.org/distributions/gradle-8.7-bin.zip',
    'https://downloads.gradle.org/distributions/gradle-8.7-bin.zip',
    'https://mirrors.cloud.tencent.com/gradle/gradle-8.7-bin.zip',
    'https://mirrors.aliyun.com/gradle/gradle-8.7-bin.zip'
)

function Write-Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Info($msg) { Write-Host "  $msg" -ForegroundColor Gray }

function Get-File($Urls, $Dest) {
    if ($Urls -is [string]) { $Urls = @($Urls) }
    if (Test-Path $Dest) {
        $size = (Get-Item $Dest).Length
        if ($size -gt 1MB) {
            Write-Info ("已存在，跳过下载：{0} ({1} MB)" -f (Split-Path -Leaf $Dest), [math]::Round($size / 1MB, 1))
            return
        }
    }
    $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
    foreach ($Url in $Urls) {
        Write-Info "下载 $Url"
        if (Test-Path $Dest) { Remove-Item -Force $Dest }
        if ($curl) {
            # 大文件网络不稳，curl 自己重试三次
            & curl.exe -L --fail --silent --show-error --retry 3 --retry-delay 2 `
                --connect-timeout 20 -o $Dest $Url
            $ok = ($LASTEXITCODE -eq 0)
        } else {
            try {
                Invoke-WebRequest -Uri $Url -OutFile $Dest -UseBasicParsing -TimeoutSec 900
                $ok = $true
            } catch {
                $ok = $false
            }
        }
        if ($ok -and (Test-Path $Dest) -and (Get-Item $Dest).Length -gt 1MB) {
            Write-Ok ("已下载 {0} MB" -f [math]::Round((Get-Item $Dest).Length / 1MB, 1))
            return
        }
        Write-Host "  该地址不可用，换下一个镜像" -ForegroundColor Yellow
    }
    throw "所有下载地址都失败了：$($Urls -join ' , ')"
}

# ---------------------------------------------------------------- JDK
Write-Step '查找 JDK'
$javaHome = $env:JAVA_HOME
if (-not $javaHome -or -not (Test-Path (Join-Path $javaHome 'bin\javac.exe'))) {
    $javaHome = $null
    $candidates = @(
        (Join-Path $env:APPDATA '.minecraft\runtime\java-runtime-delta'),
        (Join-Path $env:APPDATA '.minecraft\runtime\java-runtime-gamma-snapshot'),
        (Join-Path $env:LOCALAPPDATA 'Programs\Android Studio\jbr')
    )
    foreach ($c in $candidates) {
        if (Test-Path (Join-Path $c 'bin\javac.exe')) { $javaHome = $c; break }
    }
}
if (-not $javaHome) { throw '找不到可用的 JDK（需要 javac）。请安装 JDK 17+ 后重试。' }

$javaExe = Join-Path $javaHome 'bin\java.exe'
$keytool = Join-Path $javaHome 'bin\keytool.exe'
$javaVersion = (& $javaExe -version 2>&1 | Out-String).Trim() -split "`n" | Select-Object -First 1
Write-Ok "JDK: $javaHome"
Write-Info $javaVersion
Write-Info "keytool 存在: $(Test-Path $keytool)"
if (-not (Test-Path $keytool)) { throw "JDK 里没有 keytool，无法生成签名密钥：$keytool" }

# ---------------------------------------------------------------- Android SDK
Write-Step '准备 Android SDK'
if (-not (Test-Path $Downloads)) { New-Item -ItemType Directory -Force -Path $Downloads | Out-Null }

if (-not (Test-Path (Join-Path $CmdlineDir 'bin\sdkmanager.bat'))) {
    $zip = Join-Path $Downloads 'commandlinetools.zip'
    Get-File $CmdlineUrl $zip
    $tmp = Join-Path $Downloads 'cmdline-tools-extract'
    if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
    Expand-Archive -Path $zip -DestinationPath $tmp -Force
    New-Item -ItemType Directory -Force -Path (Split-Path $CmdlineDir) | Out-Null
    if (Test-Path $CmdlineDir) { Remove-Item -Recurse -Force $CmdlineDir }
    Move-Item (Join-Path $tmp 'cmdline-tools') $CmdlineDir
    Write-Ok "cmdline-tools 安装到 $CmdlineDir"
} else {
    Write-Info 'cmdline-tools 已存在'
}

$sdkManager = Join-Path $CmdlineDir 'bin\sdkmanager.bat'
$env:JAVA_HOME = $javaHome
$env:ANDROID_SDK_ROOT = $SdkRoot
$env:ANDROID_HOME = $SdkRoot

Write-Step '接受 SDK 许可协议'
1..40 | ForEach-Object { 'y' } | & $sdkManager "--sdk_root=$SdkRoot" --licenses 2>&1 |
    Select-String -Pattern 'accept|Accept|already' | Select-Object -First 4 |
    ForEach-Object { Write-Info $_.Line }
Write-Ok '许可协议处理完成'

Write-Step '安装 platform 34 与 build-tools 35.0.0'
# 必须用 35.0.0：34.0.0 自带的 d8 遇到任何内部类（含匿名内部类）都会内部崩溃，
# 报 NullPointerException，是内部类处理路径上取到了 null 字符串导致的。
& $sdkManager "--sdk_root=$SdkRoot" 'platforms;android-34' 'build-tools;35.0.0' 'platform-tools' 2>&1 |
    Where-Object { $_ -match 'done|Done|Install|Warning|Error|error|%' } |
    Select-Object -Last 10 | ForEach-Object { Write-Info $_ }
if ($LASTEXITCODE -ne 0) { throw "sdkmanager 安装失败，退出码 $LASTEXITCODE" }
Write-Ok 'SDK 组件安装完成'

$androidJar = Join-Path $SdkRoot 'platforms\android-34\android.jar'
$aapt2      = Join-Path $SdkRoot 'build-tools\35.0.0\aapt2.exe'
$apksigner  = Join-Path $SdkRoot 'build-tools\35.0.0\apksigner.bat'
foreach ($p in @($androidJar, $aapt2, $apksigner)) {
    if (-not (Test-Path $p)) { throw "缺少组件：$p" }
    Write-Ok "找到 $(Split-Path -Leaf $p)"
}

# ---------------------------------------------------------------- 其余构建工具
Write-Step '检查其余构建工具'
$buildTools = Join-Path $SdkRoot 'build-tools\35.0.0'
$tools = @{
    'd8.exe'        = Join-Path $buildTools 'd8.bat'
    'zipalign.exe'  = Join-Path $buildTools 'zipalign.exe'
    'aapt2.exe'     = $aapt2
    'apksigner.bat' = $apksigner
}
foreach ($name in $tools.Keys) {
    if (Test-Path $tools[$name]) { Write-Ok $name } else { throw "缺少 $name（$($tools[$name])）" }
}
$javacExe = Join-Path $javaHome 'bin\javac.exe'
$jarExe   = Join-Path $javaHome 'bin\jar.exe'
foreach ($t in @($javacExe, $jarExe)) {
    if (Test-Path $t) { Write-Ok (Split-Path -Leaf $t) } else { throw "JDK 里缺少 $(Split-Path -Leaf $t)" }
}

# ---------------------------------------------------------------- 导出环境
Write-Step '写出环境文件'
$envContent = @"
# 由 tools/setup-android.ps1 生成，供 build-apk.ps1 使用
`$env:JAVA_HOME = '$javaHome'
`$env:ANDROID_SDK_ROOT = '$SdkRoot'
`$env:ANDROID_HOME = '$SdkRoot'
`$JavaHome  = '$javaHome'
`$Javac     = '$javacExe'
`$Jar       = '$jarExe'
`$Keytool   = '$keytool'
`$AndroidJar = '$androidJar'
`$BuildTools = '$buildTools'
`$Aapt2     = '$aapt2'
`$D8        = '$(Join-Path $buildTools 'd8.bat')'
`$ZipAlign  = '$(Join-Path $buildTools 'zipalign.exe')'
`$ApkSigner = '$apksigner'
"@
Set-Content -Path $EnvFile -Value $envContent -Encoding UTF8
Write-Ok "环境已写入 $EnvFile"

Write-Host "`n工具链准备完成（无需 Gradle，直接用 build-tools 出包）。" -ForegroundColor Green
Write-Host "  JAVA_HOME        = $javaHome"
Write-Host "  ANDROID_SDK_ROOT = $SdkRoot"
Write-Host "  build-tools      = $buildTools"




