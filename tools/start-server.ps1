# 语音笔记 · 启动本地服务
# 由根目录的「启动语音笔记.bat」调用（那个 .bat 是纯 ASCII 外壳）

$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

Write-Host ''
Write-Host '  语音笔记' -ForegroundColor Magenta
Write-Host '  --------------------------------------------------' -ForegroundColor DarkGray

# 找 node：优先 PATH，其次 DSH 自带的运行时
$node = $null
$onPath = Get-Command node -ErrorAction SilentlyContinue
if ($onPath) {
    $node = $onPath.Source
} else {
    $candidate = Join-Path $env:USERPROFILE '.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
    if (Test-Path $candidate) { $node = $candidate }
}
if (-not $node) {
    Write-Host ''
    Write-Host '  没有找到 Node.js，无法启动本地服务。' -ForegroundColor Red
    Write-Host '  请先安装： https://nodejs.org' -ForegroundColor Gray
    Write-Host ''
    Read-Host '按回车退出'
    exit 1
}

$port = 5173
$server = Join-Path $Root 'server.mjs'
if (-not (Test-Path $server)) {
    Write-Host '  找不到 server.mjs，目录不对？' -ForegroundColor Red
    Read-Host '按回车退出'
    exit 1
}

Write-Host "  正在启动服务（端口 $port），就绪后会自动打开浏览器…" -ForegroundColor Gray
Write-Host ''

# node 作为子进程跑在同一个窗口里，输出直接可见
$proc = Start-Process -FilePath $node -ArgumentList @($server, "$port") -PassThru -NoNewWindow

# 给它两秒起监听，再开浏览器，免得页面比服务先到
Start-Sleep -Seconds 2
if (-not $proc.HasExited) {
    try { Start-Process "http://127.0.0.1:$port/" } catch { }
    Write-Host "  已在浏览器打开 http://127.0.0.1:$port/" -ForegroundColor Green
    Write-Host '  关掉本窗口或按 Ctrl+C 即可停止服务。' -ForegroundColor Gray
} else {
    Write-Host '  服务没能启动，请看看上面的报错。' -ForegroundColor Red
    Read-Host '按回车退出'
    exit 1
}

Wait-Process -Id $proc.Id
Write-Host ''
Write-Host '  服务已停止。' -ForegroundColor Gray
Read-Host '按回车退出'

