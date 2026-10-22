# ═══════════════════════════════════════════════════════════════════
#  BeautyPOS print bridge — install on a till PC
#
#  Run this ONCE per laptop, from the bridge folder:
#
#      powershell -ExecutionPolicy Bypass -File .\install-windows.ps1
#
#  It installs to C:\BeautyPOS\bridge, registers a Scheduled Task so
#  the bridge starts hidden at every logon and restarts itself if it
#  dies, then prints a test slip and opens the drawer.
#
#  No administrator rights needed: the task is registered for the
#  current user and runs in that user's session. That is deliberate —
#  a task running as SYSTEM has no printer connections, and
#  \\localhost\POS80 is a per-user resource.
# ═══════════════════════════════════════════════════════════════════

$ErrorActionPreference = 'Stop'
$TaskName = 'BeautyPOS Print Bridge'
$Target   = 'C:\BeautyPOS\bridge'
$Source   = $PSScriptRoot

function Step($n, $msg) { Write-Host "`n[$n] $msg" -ForegroundColor Cyan }
function Ok($msg)       { Write-Host "    OK  $msg" -ForegroundColor Green }
function Warn($msg)     { Write-Host "    !!  $msg" -ForegroundColor Yellow }
function Die($msg)      { Write-Host "`nFAILED: $msg" -ForegroundColor Red; exit 1 }

Write-Host "BeautyPOS print bridge installer" -ForegroundColor White

# ── 1. Node ───────────────────────────────────────────────────────
Step 1 'Checking Node.js'
try {
  $v = (& node --version) 2>$null
  if (-not $v) { throw }
  Ok "Node $v"
} catch {
  Die @"
Node.js is not installed, or not on PATH.

The bridge is a Node program. Install Node.js LTS first
(https://nodejs.org, or the installer on the setup USB stick),
accept the defaults, then open a NEW PowerShell window and run
this script again.
"@
}

# ── 2. Copy to a stable location ──────────────────────────────────
Step 2 "Installing to $Target"
if ($Source -ieq $Target) {
  Ok 'Already running from the install location'
} else {
  New-Item -ItemType Directory -Force -Path $Target | Out-Null
  # bridge.config.json is per-machine. Never clobber one that is
  # already configured and working.
  foreach ($f in @('print-bridge.mjs','escpos.mjs','test-print.mjs','start-bridge.bat','start-bridge-hidden.vbs','package.json','README.md')) {
    if (Test-Path (Join-Path $Source $f)) {
      Copy-Item (Join-Path $Source $f) $Target -Force
    }
  }
  $cfgTarget = Join-Path $Target 'bridge.config.json'
  if (Test-Path $cfgTarget) {
    Warn 'bridge.config.json already exists here — kept as is'
  } else {
    Copy-Item (Join-Path $Source 'bridge.config.json') $cfgTarget -Force
    Ok 'Copied bridge.config.json'
  }
  # The receipt policy is shared with the app. Without it the bridge
  # falls back to built-in wording, which then silently disagrees
  # with what the screen receipt shows.
  $policySrc = Join-Path (Split-Path $Source -Parent) 'lib\receipt-policy.json'
  if (Test-Path $policySrc) {
    New-Item -ItemType Directory -Force -Path (Join-Path (Split-Path $Target -Parent) 'lib') | Out-Null
    Copy-Item $policySrc (Join-Path (Split-Path $Target -Parent) 'lib\receipt-policy.json') -Force
    Ok 'Copied shared receipt policy'
  } else {
    Warn 'lib\receipt-policy.json not found — bridge will use its built-in wording'
  }
  Ok "Installed to $Target"
}

# ── 3. Sanity-check the config ────────────────────────────────────
Step 3 'Checking bridge.config.json'
$cfgPath = Join-Path $Target 'bridge.config.json'
try { $cfg = Get-Content $cfgPath -Raw | ConvertFrom-Json } catch { Die "bridge.config.json is not valid JSON: $_" }

if (-not $cfg.transport) { Die 'No "transport" set in bridge.config.json.' }
Ok "transport: $($cfg.transport)"

if ($cfg.transport -eq 'share') {
  if (-not $cfg.share) { Die 'transport is "share" but no "share" name is set.' }
  Ok "share: $($cfg.share)"
  # Confirm the printer is actually shared under that name, because
  # "Could not write to \\localhost\POS80" at 9am is a bad time to
  # discover the Sharing tick never got applied.
  $want = ($cfg.share -split '\\')[-1]
  $shared = Get-Printer | Where-Object { $_.Shared -and $_.ShareName -eq $want }
  if ($shared) {
    Ok "Printer '$($shared.Name)' is shared as '$want'"
  } else {
    Warn "No printer is shared as '$want'."
    Warn 'Fix: Win+R -> control printers -> right-click the printer ->'
    Warn 'Printer properties -> Sharing -> Share this printer -> name it exactly:'
    Warn "    $want"
    Warn 'Then run this script again. Continuing so the task still gets installed.'
  }
}

if (-not $cfg.token) { Warn 'No token set — anything running locally can open the cash drawer.' }
if (-not $cfg.origins -or $cfg.origins.Count -eq 0) {
  Warn 'No origins set — the app will be refused with 403 Origin not allowed.'
} else {
  Ok "origins: $($cfg.origins -join ', ')"
  foreach ($o in $cfg.origins) {
    if ($o -match '/$') { Warn "origin '$o' has a trailing slash and will never match. Remove it." }
  }
}
Ok "columns: $($cfg.columns)  (42 for TM-T88V)"

# ── 4. Scheduled Task ─────────────────────────────────────────────
Step 4 'Registering the startup task'
$vbs = Join-Path $Target 'start-bridge-hidden.vbs'
if (-not (Test-Path $vbs)) { Die "Missing $vbs" }

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Ok 'Removed the previous task'
}

$action  = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$vbs`"" -WorkingDirectory $Target
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
# RestartCount/Interval are the whole point: a bridge that crashes at
# 11am must come back without anybody noticing it went.
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Settings $settings -Description 'Prints receipts and opens the cash drawer for BeautyPOS.' | Out-Null
Ok "Task '$TaskName' registered (starts at logon, restarts on failure)"

# ── 5. Start it now ───────────────────────────────────────────────
Step 5 'Starting the bridge'
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like '*print-bridge.mjs*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Start-ScheduledTask -TaskName $TaskName
$port = if ($cfg.port) { $cfg.port } else { 8080 }

$health = $null
foreach ($i in 1..15) {
  Start-Sleep -Milliseconds 700
  try { $health = Invoke-RestMethod "http://localhost:$port/health" -TimeoutSec 2; break } catch { }
}
if (-not $health) {
  Die @"
The bridge did not answer on port $port.

Check $Target\bridge.log for the reason. Common causes:
  - another program already using port $port
  - Node installed but not on PATH for this user
"@
}
Ok "Answering on http://localhost:$port  ->  $($health.target)"

# ── 6. Prove the hardware ─────────────────────────────────────────
Step 6 'Test print'
$headers = @{ 'Content-Type' = 'application/json' }
if ($cfg.token) { $headers['X-Bridge-Token'] = $cfg.token }
try {
  Invoke-RestMethod "http://localhost:$port/print" -Method Post -Headers $headers `
    -Body '{"type":"test"}' -TimeoutSec 20 | Out-Null
  Ok 'Test slip sent'
} catch {
  Warn "Test print failed: $($_.Exception.Message)"
  Warn 'The task is installed. Fix the printer, then run: npm run test-print'
}

Write-Host @"

─────────────────────────────────────────────
 Done. Now check the slip:

   1. the #### bar should touch BOTH paper edges
      (if it wraps, set "columns": 42 in bridge.config.json)
   2. the cash drawer should have opened
      (if not, the drawer cable goes in the printer's DK port)

 The bridge now starts hidden at every logon and restarts
 itself if it dies. Logs: $Target\bridge.log

 To check on it later:
   Get-ScheduledTask '$TaskName'
   Invoke-RestMethod http://localhost:$port/health
─────────────────────────────────────────────
"@ -ForegroundColor White
