# 语音笔记 · 上传到 GitHub
# 由根目录的「上传到GitHub.bat」调用（那个 .bat 是纯 ASCII 外壳，避免批处理中文编码问题）

$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Rule { Write-Host ('  ' + ('-' * 58)) -ForegroundColor DarkGray }
function Step($t) { Write-Host ''; Write-Host "  $t" -ForegroundColor Cyan }
function Ok($t)   { Write-Host "  [OK] $t" -ForegroundColor Green }
function Bad($t)  { Write-Host "  [x]  $t" -ForegroundColor Red }
function Gray($t) { Write-Host "  $t" -ForegroundColor Gray }

Clear-Host
Write-Host ''
Write-Host '   把「语音笔记」上传到你的 GitHub' -ForegroundColor Magenta
Rule
Write-Host ''

# ---------------------------------------------------------------- 环境检查
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Bad '没有找到 git，请先安装：https://git-scm.com/download/win'
    Read-Host '按回车退出'
    exit 1
}
if (-not (Test-Path (Join-Path $Root '.git'))) {
    Bad '当前目录不是 git 仓库（缺少 .git），无法上传。'
    Read-Host '按回车退出'
    exit 1
}
$hasCommit = (git rev-list --count HEAD 2>$null)
if (-not $hasCommit -or [int]$hasCommit -lt 1) {
    Bad '还没有任何提交，无法上传。'
    Read-Host '按回车退出'
    exit 1
}

# 安全检查：公开仓库里绝不能有签名密钥
$tracked = git ls-files
$leak = $tracked | Where-Object { $_ -match '\.jks$|\.keystore$|android-env\.ps1' }
if ($leak) {
    Bad '仓库里有不该提交的文件，已中止：'
    $leak | ForEach-Object { Gray "  $_" }
    Gray '（签名密钥泄露会让别人能签出冒充本应用的安装包）'
    Read-Host '按回车退出'
    exit 1
}
Ok "本地仓库正常，共 $($tracked.Count) 个文件，没有签名密钥"

# ---------------------------------------------------------------- 建仓库指引
Step '第 1 步：先在浏览器里建一个【空的】仓库'
Rule
Gray '1. 打开   https://github.com/new'
Gray '2. Repository name 填： voice-notes'
Gray '3. 选 Public 或 Private 都可以'
Gray '4. 下面这三个【都不要勾】：'
Gray '      Add a README file'
Gray '      Add .gitignore'
Gray '      Choose a license'
Gray '   （勾了远端就不是空仓库，推送会被拒）'
Gray '5. 点绿色的 Create repository'
Rule
Write-Host ''
Read-Host '  建好了就按回车继续'

# ---------------------------------------------------------------- 收集信息
Step '第 2 步：填写你的信息'
Write-Host ''
$user = (Read-Host '  你的 GitHub 用户名（例如 zhangsan）').Trim()
if ([string]::IsNullOrWhiteSpace($user)) {
    Bad '没有输入用户名，已取消。'
    Read-Host '按回车退出'
    exit 1
}
$repoInput = (Read-Host '  仓库名（直接回车就用 voice-notes）').Trim()
$repo = if ([string]::IsNullOrWhiteSpace($repoInput)) { 'voice-notes' } else { $repoInput }

$url = "https://github.com/$user/$repo.git"
Write-Host ''
Rule
Gray "  用户名 : $user"
Gray "  仓库名 : $repo"
Gray "  地址   : $url"
Rule

# 把提交作者改成你自己的名字，GitHub 才会把提交算到你账号上
git config user.name $user
git config user.email "$user@users.noreply.github.com"
git commit --amend --reset-author --no-edit 2>&1 | Out-Null
Ok '提交作者已改成你'

git remote remove origin 2>&1 | Out-Null
git remote add origin $url
Ok "远端已设为 $url"

# ---------------------------------------------------------------- 推送
Step '第 3 步：推送'
Write-Host ''
Gray '接下来可能弹出 GitHub 登录窗口，在浏览器里点授权即可。'
Gray '（如果提示要输密码，GitHub 现在不接受账号密码，走浏览器的 Authorize 就行）'
Write-Host ''
Read-Host '  准备好了就按回车开始推送'

Write-Host ''
git push -u origin main
$code = $LASTEXITCODE

Write-Host ''
Rule
if ($code -eq 0) {
    Write-Host '  上传成功！' -ForegroundColor Green
    Write-Host ''
    Gray "  仓库地址： https://github.com/$user/$repo"
    Gray "  直接下载 APK："
    Gray "    https://github.com/$user/$repo/raw/main/语音笔记.apk"
    Gray ''
    Gray '  注意：中文文件名的下载链接浏览器会自动转义，直接点仓库里的文件名更省事。'
} else {
    Bad '推送失败，常见原因：'
    Gray '  * 仓库还没建，或者用户名 / 仓库名填错了'
    Gray '  * 浏览器里的授权没完成'
    Gray '  * 建仓库时勾了 README / .gitignore（远端不是空的）'
    Gray ''
    Gray '  解决办法：删掉那个仓库，重新建一个完全空白的，再运行一次本脚本。'
    Gray "  也可以打开 https://github.com/$user/$repo 确认仓库是否存在。"
}
Write-Host ''
Read-Host '按回车退出'


