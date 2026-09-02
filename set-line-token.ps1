# ============================================================
# Set LINE Channel access token into .env
#
# NOTE: this file is intentionally ASCII-only. Windows PowerShell 5.1
# reads .ps1 files using the system ANSI codepage (874 on Thai Windows),
# so any Thai text here would be mangled and break string quoting.
#
# Usage:
#   1. Copy the Channel access token from LINE Developers Console
#   2. powershell -ExecutionPolicy Bypass -File .\set-line-token.ps1
#   3. Restart: npm run dev
# ============================================================
$ErrorActionPreference = "Stop"

$envPath = Join-Path $PSScriptRoot ".env"
if (-not (Test-Path $envPath)) {
    Write-Host "ERROR: .env not found at $envPath" -ForegroundColor Red
    exit 1
}

$token = ""
try { $token = (Get-Clipboard -Raw) } catch {}
if ($token) { $token = ($token -replace "`r", "" -replace "`n", "").Trim() }

if ([string]::IsNullOrWhiteSpace($token) -or $token.Length -lt 50) {
    Write-Host "Could not read a token from the clipboard." -ForegroundColor Yellow
    $token = (Read-Host "Paste the token here and press Enter").Trim()
}

if ([string]::IsNullOrWhiteSpace($token)) {
    Write-Host "ERROR: no token entered - cancelled." -ForegroundColor Red
    exit 1
}

$token = $token -replace '\s', ''

if ($token.Length -lt 50) {
    Write-Host "ERROR: token looks too short ($($token.Length) chars)." -ForegroundColor Red
    Write-Host "A Channel access token is 150+ chars. Channel SECRET is ~32 chars - wrong one." -ForegroundColor Yellow
    exit 1
}

# Replace only the LINE line, leave everything else untouched
$lines = @(Get-Content $envPath -Encoding UTF8)
$found = $false
$out = foreach ($line in $lines) {
    if ($line -match '^\s*LINE_CHANNEL_ACCESS_TOKEN\s*=') {
        $found = $true
        "LINE_CHANNEL_ACCESS_TOKEN=$token"
    } else {
        $line
    }
}
if (-not $found) { $out = $out + "LINE_CHANNEL_ACCESS_TOKEN=$token" }

# UTF-8 without BOM - some .env readers choke on a BOM
[System.IO.File]::WriteAllLines($envPath, $out, (New-Object System.Text.UTF8Encoding($false)))

$masked = $token.Substring(0, 6) + "..." + $token.Substring($token.Length - 4)
Write-Host ""
Write-Host "DONE - token written to .env" -ForegroundColor Green
Write-Host "  length : $($token.Length) chars"
Write-Host "  value  : $masked"
Write-Host ""
Write-Host "NEXT: press Ctrl+C in the 'npm run dev' window, then run 'npm run dev' again." -ForegroundColor Yellow
