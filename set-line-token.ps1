# ============================================================
# Set LINE Channel access token into .env
#
# NOTE: ASCII-only on purpose. Windows PowerShell 5.1 reads .ps1 with the
# system ANSI codepage (874 on Thai Windows), so Thai text here would be
# mangled and break string quoting.
#
# Usage:
#   1. In LINE Developers Console > Messaging API, click the copy icon
#      next to "Channel access token (long-lived)"
#   2. powershell -ExecutionPolicy Bypass -File .\set-line-token.ps1
#   3. Restart: npm run dev
# ============================================================
$ErrorActionPreference = "Stop"

$envPath = Join-Path $PSScriptRoot ".env"
if (-not (Test-Path $envPath)) {
    Write-Host "ERROR: .env not found at $envPath" -ForegroundColor Red
    exit 1
}

function Test-LineToken([string]$value) {
    # A LINE long-lived channel access token is base64-ish: 150-300 chars,
    # only A-Z a-z 0-9 + / = _ - and no whitespace at all.
    if ([string]::IsNullOrWhiteSpace($value)) { return "empty" }
    if ($value -match '\s')                   { return "has spaces or line breaks" }
    if ($value -match '\.ps1|powershell|Bypass|^cd ') { return "this looks like a command line, not a token" }
    if ($value.Length -lt 100)                { return "too short ($($value.Length) chars) - a real token is 150-300" }
    if ($value.Length -gt 400)                { return "too long ($($value.Length) chars)" }
    if ($value -notmatch '^[A-Za-z0-9+/=_\-\.]+$') { return "contains characters a token never has" }
    return $null   # ok
}

function Get-TokenFromUser {
    $clip = ""
    try { $clip = (Get-Clipboard -Raw) } catch {}
    if ($clip) { $clip = ($clip -replace "`r", "" -replace "`n", "").Trim() }

    $problem = Test-LineToken $clip
    if (-not $problem) {
        Write-Host "Found a valid-looking token in the clipboard." -ForegroundColor Green
        return $clip
    }

    if ($clip) {
        $show = if ($clip.Length -gt 24) { $clip.Substring(0,20) + "..." } else { $clip }
        Write-Host ""
        Write-Host "Clipboard does NOT contain a LINE token." -ForegroundColor Yellow
        Write-Host "  found  : $show"
        Write-Host "  reason : $problem"
    } else {
        Write-Host "Clipboard is empty." -ForegroundColor Yellow
    }

    Write-Host ""
    Write-Host "Go to LINE Developers Console > your Messaging API channel," -ForegroundColor Cyan
    Write-Host "click the COPY icon next to 'Channel access token (long-lived)'," -ForegroundColor Cyan
    Write-Host "then paste it below (right-click pastes in PowerShell)." -ForegroundColor Cyan
    Write-Host ""

    for ($i = 1; $i -le 3; $i++) {
        $typed = (Read-Host "Paste token (attempt $i of 3)").Trim()
        $p = Test-LineToken $typed
        if (-not $p) { return $typed }
        Write-Host "  rejected: $p" -ForegroundColor Red
    }
    return $null
}

$token = Get-TokenFromUser
if (-not $token) {
    Write-Host ""
    Write-Host "No valid token entered - nothing was changed." -ForegroundColor Red
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
