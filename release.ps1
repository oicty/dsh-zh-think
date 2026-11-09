# release.ps1 —— dsh-zh-think 一键发版
#
# 用法：
#   .\release.ps1              # patch 版本 0.2.0 -> 0.2.1
#   .\release.ps1 minor        # minor 版本 0.2.0 -> 0.3.0
#   .\release.ps1 major        # major 版本 0.2.0 -> 1.0.0
#
# 脚本会：检查工作区 → 升版本 → 提交 → 打 tag → 推送 → 提示手动 npm publish
# npm publish 需要浏览器 2FA 确认，无法自动化，所以最后一步留给你。

param(
    [ValidateSet('patch', 'minor', 'major')]
    [string]$Type = 'patch'
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

Write-Host "=== dsh-zh-think 发版 ===" -ForegroundColor Cyan

# 1. 工作区必须干净
$dirty = git status --porcelain
if ($dirty) {
    Write-Host "`n✗ 有未提交的改动，请先提交或撤销：" -ForegroundColor Red
    $dirty | ForEach-Object { Write-Host "  $_" }
    exit 1
}

# 2. 升版本
Write-Host "`n[1/4] 升版本（$Type）..."
npm version $Type --no-git-tag-version | Out-Null
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
Write-Host "      -> $version" -ForegroundColor Green

# 3. 提交 + tag
Write-Host "`n[2/4] 提交并打 tag..."
git add -A
git commit -m "chore: release v$version" | Out-Null
git tag "v$version"
Write-Host "      -> commit 与 tag v$version 已创建" -ForegroundColor Green

# 4. 推送
Write-Host "`n[3/4] 推送到 GitHub..."
git push origin main
if ($LASTEXITCODE -ne 0) {
    Write-Host "`n✗ 推送失败。若提示需要认证，先在终端执行一次：" -ForegroundColor Red
    Write-Host "    git config --global credential.helper manager"
    Write-Host "  然后再跑一次本脚本。"
    exit 1
}
git push origin "v$version"
Write-Host "      -> 已推送" -ForegroundColor Green

# 5. 提示发布
Write-Host "`n[4/4] 发布到 npm —— 需要你手动执行（浏览器 2FA）：" -ForegroundColor Yellow
Write-Host ""
Write-Host "    npm publish" -ForegroundColor White
Write-Host ""
Write-Host "发布完成后可用这条确认："
Write-Host "    npm view dsh-zh-think version" -ForegroundColor Gray
