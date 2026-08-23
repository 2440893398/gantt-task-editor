<#
.SYNOPSIS
    feedback-executor 守护进程的启动 / 停止 / 观察脚本（Windows）。

.DESCRIPTION
    执行器是拉取式的常驻进程：起来之后自己去控制面领 Run 和 Release，没活儿就每
    15 秒问一次。所以它必须能在后台无感长跑，而不是占着一个终端窗口。

    本脚本负责三件在真机上反复踩过坑的事：

    1) 后台化。用 Start-Process 直接拉起 node 本身（不套 npm、不套 cmd）——套一层
       包装器的话，停止时杀掉的是包装器，node 会变成还在认领任务的孤儿进程。
    2) 日志落盘。日志由执行器进程自己 append（FEEDBACK_EXECUTOR_LOG_FILE），这里不做
       流重定向——带重定向的 Start-Process 会让守护进程继承调用方的管道句柄，把
       `npm run executor:start` 吊住不返回。读日志一律 -Encoding UTF8（PowerShell 5.1
       默认按 ANSI 读，中文会花屏）。
    3) 优雅停止。Windows 没有可投递的 SIGTERM，后台进程只能被硬杀，而硬杀会把正在
       跑的写入回合拦腰截断（留下要等 120s 租约超时才回收的 Run + 脏工作区）。
       stop 默认走哨兵文件，让执行器「跑完当前这轮再退」；急停用 -Force。

    密钥不进仓库：配置读 %USERPROFILE%\.gantt-executor\executor.env，首次运行会
    生成模板并告诉你填什么。

.PARAMETER Action
    start / stop / restart / status / logs，默认 status。

.EXAMPLE
    .\scripts\executor\executor.ps1 start

.EXAMPLE
    .\scripts\executor\executor.ps1 logs -Follow

.EXAMPLE
    .\scripts\executor\executor.ps1 stop
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet('start', 'stop', 'restart', 'status', 'logs')]
    [string]$Action = 'status',

    [int]$Tail = 40,
    [switch]$Follow,
    [switch]$Force,
    [int]$TimeoutSeconds = 1800
)

$ErrorActionPreference = 'Stop'

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$MainJs = Join-Path $RepoRoot 'packages\feedback-platform\executor\main.js'
$StateDir = Join-Path $env:USERPROFILE '.gantt-executor'
$LogDir = Join-Path $StateDir 'logs'
$ConfigFile = Join-Path $StateDir 'executor.env'
$StopFile = Join-Path $StateDir 'executor.stop'
$KeepLogs = 10

# 缺一个都起不来。TOKEN/PAT 是密钥，脚本只判空、从不回显。
$RequiredKeys = @(
    'FEEDBACK_EXECUTOR_ORIGIN',
    'FEEDBACK_EXECUTOR_TOKEN',
    'FEEDBACK_EXECUTOR_WORKSPACE',
    'FEEDBACK_EXECUTOR_REMOTE',
    'FEEDBACK_EXECUTOR_GIT_PAT'
)

$ConfigTemplate = @'
# feedback-executor 配置。此文件含密钥，刻意放在仓库之外——不要拷进项目目录。
# 格式 KEY=VALUE，# 开头是注释。改完重启执行器生效。

# 控制面 Worker origin
FEEDBACK_EXECUTOR_ORIGIN=https://gantt-share.ch451314.workers.dev

# 控制面 bearer，必须与 Worker 的 FEEDBACK_EXECUTOR_TOKEN secret 一致
FEEDBACK_EXECUTOR_TOKEN=

# S1：独立 checkout 目录，绝不能是主工作区（准入会直接拒绝）
FEEDBACK_EXECUTOR_WORKSPACE=C:\Users\24408\IdeaProjects\executor-ws

# S2：HTTPS remote + 专用 fine-grained PAT（仓库只勾目标仓库，Contents: Read and write）
FEEDBACK_EXECUTOR_REMOTE=https://github.com/2440893398/gantt-task-editor.git
FEEDBACK_EXECUTOR_GIT_PAT=

# 执行器标识，出现在控制面的租约记录里
FEEDBACK_EXECUTOR_ID=executor-desktop

# 可选：provider（claude-code 默认 / codex）、模型降档、单轮预算
# FEEDBACK_EXECUTOR_PROVIDER=claude-code
# FEEDBACK_EXECUTOR_MODEL=
# FEEDBACK_EXECUTOR_MAX_USD=
'@

function Write-Info { param([string]$Message) Write-Host $Message }
function Write-Ok { param([string]$Message) Write-Host $Message -ForegroundColor Green }
function Write-Note { param([string]$Message) Write-Host $Message -ForegroundColor Yellow }
function Write-Bad { param([string]$Message) Write-Host $Message -ForegroundColor Red }

function Initialize-StateDir {
    foreach ($dir in @($StateDir, $LogDir)) {
        if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    }
}

# 认「命令行里是不是我们这个 main.js」，不认 pid 文件。pid 文件会因为硬杀、
# 重启、pid 复用而说谎，命令行不会。
function Get-ExecutorProcess {
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine -match 'executor[\\/]main\.js' } |
        Select-Object -First 1
}

function Get-LatestLog {
    if (-not (Test-Path $LogDir)) { return $null }
    Get-ChildItem -Path $LogDir -Filter 'executor-*.log' -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
}

function Import-ExecutorConfig {
    if (-not (Test-Path $ConfigFile)) {
        Initialize-StateDir
        Set-Content -Path $ConfigFile -Value $ConfigTemplate -Encoding UTF8
        Write-Note "已生成配置模板：$ConfigFile"
        Write-Note '请填好 FEEDBACK_EXECUTOR_TOKEN 与 FEEDBACK_EXECUTOR_GIT_PAT 后重新执行 start。'
        throw '配置尚未填写'
    }

    foreach ($line in (Get-Content -Path $ConfigFile -Encoding UTF8)) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
        $split = $trimmed.IndexOf('=')
        if ($split -lt 1) { continue }
        $key = $trimmed.Substring(0, $split).Trim()
        $value = $trimmed.Substring($split + 1).Trim().Trim('"')
        [Environment]::SetEnvironmentVariable($key, $value, 'Process')
    }

    $missing = @()
    foreach ($key in $RequiredKeys) {
        if (-not [Environment]::GetEnvironmentVariable($key, 'Process')) { $missing += $key }
    }
    if ($missing.Count -gt 0) {
        Write-Bad "配置缺项：$($missing -join ', ')"
        Write-Bad "编辑 $ConfigFile 后重试。"
        throw '配置缺项'
    }
}

# 准入（admission.js）本来就会拦，但那是在后台进程里抛的——错误会落进日志文件，
# 而你看到的只是「起了又没了」。这里在前台先把同样的条件判一遍，报错当场可见。
function Test-Preflight {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw '找不到 node，请先安装或加进 PATH' }
    if (-not (Test-Path $MainJs)) { throw "找不到执行器入口：$MainJs" }

    $workspace = [Environment]::GetEnvironmentVariable('FEEDBACK_EXECUTOR_WORKSPACE', 'Process')
    if (-not (Test-Path $workspace)) { throw "工作区不存在：$workspace" }
    if (-not (Test-Path (Join-Path $workspace '.git'))) { throw "工作区不是 git 检出：$workspace" }

    $wsFull = (Resolve-Path $workspace).Path.TrimEnd('\')
    if ($wsFull -ieq $RepoRoot.TrimEnd('\')) {
        throw "工作区不能是主工作区（$RepoRoot）——S1 准入会拒绝，且 Agent 会改到你正在编辑的代码"
    }

    $remote = [Environment]::GetEnvironmentVariable('FEEDBACK_EXECUTOR_REMOTE', 'Process')
    if ($remote -notmatch '^https://') { throw "FEEDBACK_EXECUTOR_REMOTE 必须是 HTTPS：$remote" }
}

function Remove-OldLogs {
    $logs = Get-ChildItem -Path $LogDir -Filter 'executor-*.log' -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending
    if ($logs -and $logs.Count -gt $KeepLogs) {
        $logs | Select-Object -Skip $KeepLogs | ForEach-Object {
            try { Remove-Item $_.FullName -Force -ErrorAction Stop } catch {}
        }
    }
}

function Start-Executor {
    $existing = Get-ExecutorProcess
    if ($existing) {
        Write-Note "执行器已在运行：pid=$($existing.ProcessId)，未重复启动。"
        Show-Status
        return
    }

    Initialize-StateDir
    Import-ExecutorConfig
    Test-Preflight

    # 上一轮遗留的哨兵会让新进程刚起来就退出——起之前必须清掉。
    if (Test-Path $StopFile) { Remove-Item $StopFile -Force }
    $env:FEEDBACK_EXECUTOR_STOP_FILE = $StopFile

    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $log = Join-Path $LogDir "executor-$stamp.log"
    $env:FEEDBACK_EXECUTOR_LOG_FILE = $log

    # 刻意**不**用 -RedirectStandardOutput/-RedirectStandardError：带流重定向的
    # Start-Process 会以 bInheritHandles=true 建进程，守护进程于是拿到调用方所有可
    # 继承句柄的副本——包括 npm 那层的 stdout 管道。它一个字节都不往那个管道写，却
    # 让管道永不关闭：`npm run executor:start` 起完后挂着不返回提示符，直到守护进程
    # 退出才结束（2026-08-22 实测三次复现）。不带重定向时走 ShellExecute 路径、零句柄
    # 继承，进程真正脱离调用方；日志由执行器自己 append 到 FEEDBACK_EXECUTOR_LOG_FILE。
    Start-Process -FilePath 'node' -ArgumentList @($MainJs) -WorkingDirectory $RepoRoot -WindowStyle Hidden | Out-Null

    Start-Sleep -Seconds 3
    $running = Get-ExecutorProcess
    if (-not $running) {
        Write-Bad '执行器启动后立刻退出了。日志尾部：'
        if (Test-Path $log) { Get-Content -Path $log -Tail 30 -Encoding UTF8 | ForEach-Object { Write-Host "  $_" } }
        throw '启动失败'
    }

    Remove-OldLogs
    Write-Ok "执行器已在后台启动：pid=$($running.ProcessId)"
    Write-Info "日志：$log"
    Write-Info '跟看：.\scripts\executor\executor.ps1 logs -Follow'
    Write-Info '停止：.\scripts\executor\executor.ps1 stop'
}

function Stop-Executor {
    $proc = Get-ExecutorProcess
    if (-not $proc) {
        Write-Info '执行器未在运行。'
        if (Test-Path $StopFile) { Remove-Item $StopFile -Force }
        return
    }

    if ($Force) {
        Write-Note "强制停止 pid=$($proc.ProcessId)（会截断正在跑的回合）..."
        & taskkill /pid $proc.ProcessId /T /F | Out-Null
        Start-Sleep -Seconds 2
        if (Get-ExecutorProcess) { Write-Bad '进程仍在，请手动检查。' } else { Write-Ok '已强制停止。' }
        if (Test-Path $StopFile) { Remove-Item $StopFile -Force }
        return
    }

    Initialize-StateDir
    New-Item -ItemType File -Path $StopFile -Force | Out-Null
    Write-Info "已请求优雅停止（pid=$($proc.ProcessId)）。它会跑完当前这轮再退出——"
    Write-Info '空闲时几秒内结束，正在跑写入回合则可能要十几分钟。急停用 -Force。'

    $startedWaiting = Get-Date
    $lastNotice = Get-Date
    while (((Get-Date) - $startedWaiting).TotalSeconds -lt $TimeoutSeconds) {
        Start-Sleep -Seconds 3
        if (-not (Get-ExecutorProcess)) {
            Remove-Item $StopFile -Force -ErrorAction SilentlyContinue
            Write-Ok '执行器已优雅退出。'
            return
        }
        if (((Get-Date) - $lastNotice).TotalSeconds -ge 60) {
            $lastNotice = Get-Date
            $waited = [int]((Get-Date) - $startedWaiting).TotalSeconds
            Write-Info "  仍在收尾...（已等 $waited 秒）"
        }
    }

    Write-Note "等待超过 $TimeoutSeconds 秒仍未退出。哨兵文件保留着，它跑完这轮就会退；"
    Write-Note '不想等就执行：.\scripts\executor\executor.ps1 stop -Force'
}

function Show-Status {
    $proc = Get-ExecutorProcess
    $log = Get-LatestLog

    if ($proc) {
        $started = $proc.CreationDate
        $uptime = (Get-Date) - $started
        Write-Ok "运行中  pid=$($proc.ProcessId)"
        Write-Info ("  启动于  {0}（已运行 {1:hh\:mm\:ss}）" -f $started, $uptime)
    }
    else {
        Write-Note '未运行'
    }

    if (Test-Path $StopFile) { Write-Note "  停止哨兵存在：$StopFile（下一轮结束后会退出）" }

    if ($log) {
        Write-Info "  日志    $($log.FullName)"
        Write-Info ''
        Write-Info "  最近 $Tail 行："
        Get-Content -Path $log.FullName -Tail $Tail -Encoding UTF8 | ForEach-Object { Write-Host "    $_" }
    }
    else {
        Write-Info '  还没有日志文件。'
    }
}

function Show-Logs {
    $log = Get-LatestLog
    if (-not $log) {
        Write-Note "还没有日志文件（$LogDir）。"
        return
    }
    Write-Info $log.FullName
    Write-Info ''
    if ($Follow) {
        Get-Content -Path $log.FullName -Tail $Tail -Encoding UTF8 -Wait
    }
    else {
        Get-Content -Path $log.FullName -Tail $Tail -Encoding UTF8
    }
}

# 顶层兜底：配置缺项、准入不过这类事是「用户要改点什么」，不是需要看堆栈的崩溃。
# 直接抛的话 PowerShell 会打一整屏 CategoryInfo/FullyQualifiedErrorId，把真正那句
# 中文提示埋掉。
try {
    switch ($Action) {
        'start' { Start-Executor }
        'stop' { Stop-Executor }
        'restart' { Stop-Executor; Start-Executor }
        'status' { Show-Status }
        'logs' { Show-Logs }
    }
}
catch {
    Write-Bad ("失败：" + $_.Exception.Message)
    exit 1
}
