# YALA PC Agent - uninstaller
# If not elevated, this script asks for Administrator permission automatically.
$ErrorActionPreference = "Stop"

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-IsAdministrator)) {
    Write-Host "==> Administrator permission is required. Opening UAC prompt..." -ForegroundColor Yellow
    Start-Process -FilePath "powershell.exe" -ArgumentList @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", ('"' + ($PSCommandPath -replace '"', '\"') + '"')
    ) -Verb RunAs -Wait
    exit $LASTEXITCODE
}

Write-Host "==> Uninstalling YALA PC Agent" -ForegroundColor Cyan

# 1) stop process
$proc = Get-Process "YalaPcAgent" -ErrorAction SilentlyContinue
if ($proc) {
    Stop-Process -Name "YalaPcAgent" -Force
    Write-Host "  stopped YalaPcAgent process" -ForegroundColor Yellow
}
Start-Sleep -Seconds 1

# 2) remove scheduled tasks
$tasks = @("YalaPcAgent", "YalaPcAgentWatchdog")
foreach ($t in $tasks) {
    schtasks /Delete /TN $t /F 2>$null | Out-Null
    Write-Host "  removed scheduled task $t" -ForegroundColor Yellow
}

# 3) remove registry
$regPath = "HKLM:\SOFTWARE\YALA"
if (Test-Path $regPath) {
    Remove-Item -Path $regPath -Recurse -Force
    Write-Host "  removed registry $regPath" -ForegroundColor Yellow
}

# 3b) remove HKLM Run entry
$runKey = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run"
if (Get-ItemProperty -Path $runKey -Name "YalaPcAgent" -ErrorAction SilentlyContinue) {
    Remove-ItemProperty -Path $runKey -Name "YalaPcAgent" -Force
    Write-Host "  removed Run key YalaPcAgent" -ForegroundColor Yellow
}

# 4) remove install dir
$installDir = "C:\YALA"
if (Test-Path $installDir) {
    Remove-Item -Path $installDir -Recurse -Force
    Write-Host "  removed folder $installDir" -ForegroundColor Yellow
}

Write-Host "==> Uninstallation completed." -ForegroundColor Green
