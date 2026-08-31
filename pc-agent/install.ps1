# YALA PC Agent - installer
# If not elevated, this script asks for Administrator permission automatically.
param(
    [Parameter(Mandatory=$false)] [string]$MachineId = "",
    [Parameter(Mandatory=$false)] [int]$MachineNumber = 0,
    [switch]$Diagnose,
    [switch]$Elevated,
    [string]$MachineToken = "",
    [string]$InstallDir = "C:\YALA",
    [string]$SupabaseUrl = "https://teyvwnnrchjnffyjtljl.supabase.co",
    [string]$SupabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRleXZ3bm5yY2hqbmZmeWp0bGpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExODMzOTQsImV4cCI6MjA5Njc1OTM5NH0.rykYOT9NS4LLgvbjqpoAMuBqMEeX9_aivlfCa_77xo8"
)

$ErrorActionPreference = "Stop"
$InstallerVersion = "2.4.0"

# always log everything to a file, so a window that closes too fast is still debuggable
$LogFile = Join-Path $env:TEMP "yala-install.log"
try { Start-Transcript -Path $LogFile -Append -Force | Out-Null } catch {}
Write-Host "==> YALA installer v$InstallerVersion  (log: $LogFile)" -ForegroundColor Cyan

# keep the elevated window open when something fails, so the error is readable
trap {
    Write-Host ""
    Write-Host "ERROR: $_" -ForegroundColor Red
    Write-Host "Full log: $LogFile" -ForegroundColor Yellow
    try { Stop-Transcript | Out-Null } catch {}
    if ($Elevated) { Read-Host "Press Enter to close this window" }
    exit 1
}



function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Quote-Arg([string]$Value) {
    return '"' + ($Value -replace '"', '\"') + '"'
}

function Show-Diagnostics([string]$InstallDir) {
    Write-Host ""
    Write-Host "===== YALA PC Agent diagnostics =====" -ForegroundColor Cyan
    $exePath = Join-Path $InstallDir "YalaPcAgent.exe"
    if (Test-Path $exePath) {
        $fi = Get-Item $exePath
        Write-Host ("exe        : {0}  ({1:N0} bytes, modified {2})" -f $exePath, $fi.Length, $fi.LastWriteTime)
    } else {
        Write-Host "exe        : NOT FOUND at $exePath" -ForegroundColor Red
    }

    $key = "HKLM:\SOFTWARE\YALA\Agent"
    if (Test-Path $key) {
        $cfg = Get-ItemProperty -Path $key
        Write-Host ("MachineId  : {0}" -f $cfg.MachineId)
        Write-Host ("MachineNo  : {0}" -f $cfg.MachineNumber)
        Write-Host ("SupabaseUrl: {0}" -f $cfg.SupabaseUrl)
        $keyLen = 0; if ($cfg.SupabaseAnonKey) { $keyLen = $cfg.SupabaseAnonKey.Length }
        Write-Host ("AnonKey len: {0}" -f $keyLen)
    } else {
        Write-Host "registry   : NOT FOUND ($key)" -ForegroundColor Red
    }

    foreach ($t in @("YalaPcAgent","YalaPcAgentWatchdog")) {
        $task = Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue
        if ($task) {
            $info = Get-ScheduledTaskInfo -TaskName $t -ErrorAction SilentlyContinue
            Write-Host ("task {0,-20}: {1} (last run {2}, result {3})" -f $t, $task.State, $info.LastRunTime, $info.LastTaskResult)
        } else {
            Write-Host ("task {0,-20}: MISSING" -f $t) -ForegroundColor Red
        }
    }

    # The watchdog must NOT run powershell.exe - it flashes a console window
    # every minute, which knocks fullscreen games out of exclusive fullscreen.
    $wd = Get-ScheduledTask -TaskName "YalaPcAgentWatchdog" -ErrorAction SilentlyContinue
    if ($wd) {
        $wdExec = ($wd.Actions | ForEach-Object { $_.Execute }) -join ", "
        if ($wdExec -match "powershell") {
            Write-Host ("watchdog   : {0}  <-- OLD, flashes a console window every minute" -f $wdExec) -ForegroundColor Red
            Write-Host "             re-run install.ps1 (v2.4.0+) to replace it with the silent wscript watchdog" -ForegroundColor Yellow
        } else {
            Write-Host ("watchdog   : {0}  (silent)" -f $wdExec) -ForegroundColor Green
        }
    }

    $runVal = (Get-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run" -Name "YalaPcAgent" -ErrorAction SilentlyContinue).YalaPcAgent
    if ($runVal) { Write-Host "run key    : $runVal" } else { Write-Host "run key    : MISSING" -ForegroundColor Red }

    $proc = Get-Process "YalaPcAgent" -ErrorAction SilentlyContinue
    if ($proc) {
        Write-Host ("process    : RUNNING (pid {0}, started {1})" -f $proc.Id, $proc.StartTime) -ForegroundColor Green
    } else {
        Write-Host "process    : NOT RUNNING" -ForegroundColor Red
    }

    $log = Join-Path $InstallDir "agent.log"
    if (Test-Path $log) {
        Write-Host ""
        Write-Host "----- last 30 lines of agent.log -----" -ForegroundColor Cyan
        Get-Content $log -Tail 30
    } else {
        Write-Host "log        : no agent.log yet at $log" -ForegroundColor Yellow
    }
    Write-Host "=====================================" -ForegroundColor Cyan
}

if ($Diagnose) {
    Show-Diagnostics -InstallDir $InstallDir
    exit 0
}

if (-not $MachineId -or $MachineNumber -le 0) {
    throw "Usage: install.ps1 -MachineId <uuid> -MachineNumber <n>   (or -Diagnose to check an existing install)"
}

# validate the UUID early - a truncated id silently breaks heartbeat/commands
$guidRef = [Guid]::Empty
if (-not [Guid]::TryParse($MachineId, [ref]$guidRef)) {
    Write-Host ""
    Write-Host "ERROR: MachineId is not a valid UUID: '$MachineId' (length $($MachineId.Length), expected 36)" -ForegroundColor Red
    Write-Host "       Copy the full id from the Web Admin PC Zone Panel, e.g." -ForegroundColor Yellow
    Write-Host "       c3b47ff8-e2cb-423b-9ec8-59848f4bc17c" -ForegroundColor Yellow
    if ($Elevated) { Read-Host "Press Enter to close" }
    exit 1
}
$MachineId = $guidRef.ToString()

if (-not (Test-IsAdministrator)) {
    Write-Host "==> Administrator permission is required. Opening UAC prompt..." -ForegroundColor Yellow
    Write-Host "    A new elevated window will open - watch that window for the result." -ForegroundColor Yellow

    $argsList = @(
        "-NoProfile",
        "-NoExit",
        "-ExecutionPolicy", "Bypass",
        "-File", (Quote-Arg $PSCommandPath),
        "-MachineId", (Quote-Arg $MachineId),
        "-MachineNumber", $MachineNumber.ToString(),
        "-MachineToken", (Quote-Arg $MachineToken),
        "-InstallDir", (Quote-Arg $InstallDir),
        "-SupabaseUrl", (Quote-Arg $SupabaseUrl),
        "-SupabaseAnonKey", (Quote-Arg $SupabaseAnonKey),
        "-Elevated"
    )

    try {
        $p = Start-Process -FilePath "powershell.exe" -ArgumentList $argsList -Verb RunAs -Wait -PassThru
    } catch {
        Write-Host "==> UAC was cancelled or elevation failed: $_" -ForegroundColor Red
        exit 1
    }
    if ($p.ExitCode -eq 0) {
        Write-Host "==> Elevated installer finished successfully." -ForegroundColor Green
    } else {
        Write-Host "==> Elevated installer exited with code $($p.ExitCode)." -ForegroundColor Red
    }
    if (Test-Path $LogFile) {
        Write-Host ""
        Write-Host "----- last 40 lines of $LogFile -----" -ForegroundColor Cyan
        Get-Content $LogFile -Tail 40
    }
    exit $p.ExitCode
}



Write-Host "==> Installing YALA PC Agent for machine #$MachineNumber ($MachineId)" -ForegroundColor Cyan

# 1) stop existing agent before update, then create install dir & copy exe
$existingProc = Get-Process "YalaPcAgent" -ErrorAction SilentlyContinue
if ($existingProc) {
    Stop-Process -Name "YalaPcAgent" -Force
    Start-Sleep -Seconds 1
}

if (-not (Test-Path $InstallDir)) { New-Item -ItemType Directory -Path $InstallDir | Out-Null }
$src = Join-Path $PSScriptRoot "YalaPcAgent.exe"
if (-not (Test-Path $src)) {
    $src = Join-Path $PSScriptRoot "YalaPcAgent\bin\Release\net8.0-windows\win-x64\publish\YalaPcAgent.exe"
}
if (-not (Test-Path $src)) { throw "YalaPcAgent.exe not found. Please build first (see README)." }
Copy-Item $src (Join-Path $InstallDir "YalaPcAgent.exe") -Force
# remove Mark-of-the-Web (downloaded/USB files get blocked by SmartScreen / App Control)
try { Unblock-File -Path (Join-Path $InstallDir "YalaPcAgent.exe") -ErrorAction SilentlyContinue } catch {}
try { Remove-Item -Path ((Join-Path $InstallDir "YalaPcAgent.exe") + ":Zone.Identifier") -Force -ErrorAction SilentlyContinue } catch {}

# warn if Windows Smart App Control is enforcing (it blocks unsigned exes outright)
$sacState = (Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy" -Name "VerifiedAndReputablePolicyState" -ErrorAction SilentlyContinue).VerifiedAndReputablePolicyState
if ($sacState -eq 1) {
    Write-Host ""
    Write-Host "WARNING: Smart App Control is ON - it will block C:\YALA\YalaPcAgent.exe." -ForegroundColor Red
    Write-Host "         Turn it off: Windows Security > App & browser control > Smart App Control > Off, then reboot." -ForegroundColor Yellow
    Write-Host ""
}

# 2) config -> HKLM
$key = "HKLM:\SOFTWARE\YALA\Agent"
New-Item -Path $key -Force | Out-Null
Set-ItemProperty -Path $key -Name "SupabaseUrl"     -Value $SupabaseUrl
Set-ItemProperty -Path $key -Name "SupabaseAnonKey" -Value $SupabaseAnonKey
Set-ItemProperty -Path $key -Name "MachineId"       -Value $MachineId
Set-ItemProperty -Path $key -Name "MachineNumber"   -Value ([string]$MachineNumber)
Set-ItemProperty -Path $key -Name "MachineToken"    -Value $MachineToken

# 3) scheduled task - auto-start at logon (any user) + auto-restart on crash
$taskName = "YalaPcAgent"
$exe = Join-Path $InstallDir "YalaPcAgent.exe"
$existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existingTask) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

$action = New-ScheduledTaskAction -Execute $exe
$triggerLogon = New-ScheduledTaskTrigger -AtLogOn
$triggerBoot = New-ScheduledTaskTrigger -AtStartup
$triggerBoot.Delay = "PT30S"
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit (New-TimeSpan -Days 3650) -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -GroupId "BUILTIN\Users" -RunLevel Highest
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($triggerLogon, $triggerBoot) `
    -Settings $settings -Principal $principal -Force | Out-Null

# 3b) HKLM Run key - belt & suspenders autostart for every interactive user
$runKey = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run"
if (-not (Test-Path $runKey)) { New-Item -Path $runKey -Force | Out-Null }
Set-ItemProperty -Path $runKey -Name "YalaPcAgent" -Value ('"' + $exe + '"')

# 4) watchdog task - check every 1 minute, restart if not running
#
#    IMPORTANT: this MUST NOT run powershell.exe.
#    powershell.exe always allocates a console window before it processes
#    -WindowStyle Hidden, so every single run flashed a blue console window
#    in the interactive session. A new foreground window appearing once a
#    minute is exactly what kicks a game out of exclusive fullscreen - and on
#    a windowed game the operator just sees the blue window blink.
#    wscript.exe is a GUI-subsystem host: it never allocates a console at all.
$watchdog = "YalaPcAgentWatchdog"
$existingWatchdog = Get-ScheduledTask -TaskName $watchdog -ErrorAction SilentlyContinue
if ($existingWatchdog) {
    Unregister-ScheduledTask -TaskName $watchdog -Confirm:$false
}

$wdVbsPath = Join-Path $InstallDir "watchdog.vbs"
$wdVbs = @'
' YALA PC Agent watchdog - relaunch the agent if it is not running.
' Runs under wscript.exe so no console window is ever created.
Option Explicit
Dim wmi, procs, shell
Set wmi = GetObject("winmgmts:")
Set procs = wmi.ExecQuery("SELECT ProcessId FROM Win32_Process WHERE Name = 'YalaPcAgent.exe'")
If procs.Count = 0 Then
  Set shell = CreateObject("WScript.Shell")
  shell.Run """__AGENT_EXE__""", 1, False
End If
'@
$wdVbs = $wdVbs.Replace("__AGENT_EXE__", $exe)
Set-Content -Path $wdVbsPath -Value $wdVbs -Encoding ASCII

$wdAction = New-ScheduledTaskAction -Execute "wscript.exe" -Argument ('//B //Nologo "' + $wdVbsPath + '"')
$wdTrigger = New-ScheduledTaskTrigger -Daily -At (Get-Date).Date.AddMinutes(1)
$wdTrigger.Repetition = (New-ScheduledTaskTrigger -Once -At (Get-Date) `
    -RepetitionInterval (New-TimeSpan -Minutes 1) `
    -RepetitionDuration (New-TimeSpan -Days 1)).Repetition
Register-ScheduledTask -TaskName $watchdog -Action $wdAction -Trigger $wdTrigger `
    -Settings $settings -Principal $principal -Force | Out-Null

# 5) start immediately (no reboot needed) - launch in current interactive session
$alreadyRunning = Get-Process "YalaPcAgent" -ErrorAction SilentlyContinue
if (-not $alreadyRunning) {
    try {
        Start-Process -FilePath $exe -WorkingDirectory $InstallDir
        Write-Host "==> Agent started." -ForegroundColor Green
    } catch {
        Write-Host "==> Could not start agent automatically: $_" -ForegroundColor Yellow
    }
}

Write-Host "" 
Write-Host "==> Installation completed." -ForegroundColor Green
Write-Host "    IMPORTANT: for the LockScreen to appear right after boot, Windows must" -ForegroundColor Yellow
Write-Host "    auto-login to a user (agent is a WPF app - cannot render at the login screen)." -ForegroundColor Yellow
Write-Host "    Enable auto-login:  control userpasswords2  (uncheck 'Users must enter a user name...')" -ForegroundColor Yellow
Write-Host "    Test now: `"$exe`"" -ForegroundColor Yellow

Start-Sleep -Seconds 3
Show-Diagnostics -InstallDir $InstallDir
Write-Host ""
Write-Host "    Re-check anytime:  powershell -ExecutionPolicy Bypass -File install.ps1 -Diagnose" -ForegroundColor Yellow
Write-Host "    Full log: $LogFile" -ForegroundColor Yellow
try { Stop-Transcript | Out-Null } catch {}

if ($Elevated) {
    Write-Host ""
    Read-Host "Press Enter to close this window"
}

