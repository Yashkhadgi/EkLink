<#
.SYNOPSIS
  EkLink setup + run script for Windows 10/11.

.DESCRIPTION
  1. checks / installs Git and Node.js LTS (winget)
  2. pulls the branch (default: main)
  3. installs npm dependencies
  4. prepares .env (defaults, JWT signing key) and validates it
  5. opens `next dev` in a new PowerShell window -> http://localhost:3000

  Run from the repository root:
    powershell -ExecutionPolicy Bypass -File scripts\setup-windows.ps1

  Log file: <repo>\logs\eklink-setup-windows-<time>.log (or $env:PBL_LOG_DIR).
  On failure it prints the step, the script line and the failing command.

.PARAMETER Branch     Branch to pull (default: main).
.PARAMETER SkipPull   Do not fetch/checkout/pull.
.PARAMETER Reinstall  Force a clean `npm ci`.
.PARAMETER NoRun      Set everything up but do not start the server.
.PARAMETER RunOnly    Skip setup, only start the server (needs a previous setup).
.PARAMETER Check      Diagnose only (tools, .env keys, port); changes nothing.
.PARAMETER Trace      Print every script line as it runs (the log may then contain secrets).
.PARAMETER Yes        Answer yes to every prompt.
#>
[CmdletBinding()]
param(
  [string]$Branch = 'main',
  [switch]$SkipPull,
  [switch]$Reinstall,
  [switch]$NoRun,
  [switch]$RunOnly,
  [switch]$Check,
  [switch]$Trace,
  [switch]$Yes
)

# Works in Windows PowerShell 5.1 and PowerShell 7.
$ErrorActionPreference = 'Stop'
$Project = 'EkLink'; $Service = 'eklink'
$RepoUrl = 'https://github.com/Yashkhadgi/EkLink.git'
$AppPort = 3000
$RequiredKeys = @('NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY',
                  'EKLINK_ISSUER_URL', 'EKLINK_JWT_PRIVATE_KEY', 'EKLINK_JWT_KEY_ID')

# ---------- logging ----------
$LogDir = if ($env:PBL_LOG_DIR) { $env:PBL_LOG_DIR } else { Join-Path $PSScriptRoot '..\logs' }
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$LogDir = (Resolve-Path $LogDir).Path
$LogFile = Join-Path $LogDir ("{0}-setup-windows-{1}.log" -f $Service, (Get-Date -Format 'yyyyMMdd-HHmmss'))
try { Start-Transcript -Path $LogFile -Append | Out-Null } catch { Write-Host "[!] Could not start the log file: $_" -ForegroundColor Yellow }

$script:StepNo = 0; $script:CurrentStep = '0. start'
function Step($msg) { $script:StepNo++; $script:CurrentStep = "$($script:StepNo). $msg"; Write-Host ''; Write-Host "==> [$($script:StepNo)] $msg" -ForegroundColor Cyan }
function Info($msg) { Write-Host "    $msg" }
function Ok($msg) { Write-Host "    [ok] $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "[!] $msg" -ForegroundColor Yellow }
function Fail($msg) { throw $msg }
function Have($name) { [bool](Get-Command $name -ErrorAction SilentlyContinue) }
function Confirm-Step($question) {
  if ($Yes) { return $true }
  if ([Console]::IsInputRedirected) { return $false }
  $reply = Read-Host "    $question [Y/n]"
  return -not ($reply -match '^[nN]')
}
# Runs a native command (output goes to the console and the log); throws on a non-zero exit.
function Run {
  param([Parameter(Mandatory)][string]$Exe, [string[]]$Arguments = @())
  $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { & $Exe @Arguments 2>&1 | ForEach-Object { "$_" } | Out-Host; $code = $LASTEXITCODE } finally { $ErrorActionPreference = $old }
  if ($code -ne 0) { throw "'$Exe $($Arguments -join ' ')' failed with exit code $code" }
}
function Test-Run {
  param([Parameter(Mandatory)][string]$Exe, [string[]]$Arguments = @())
  $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { & $Exe @Arguments *> $null; return ($LASTEXITCODE -eq 0) } catch { return $false } finally { $ErrorActionPreference = $old }
}
function Get-Output {
  param([Parameter(Mandatory)][string]$Exe, [string[]]$Arguments = @())
  $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { $out = & $Exe @Arguments 2> $null; if ($LASTEXITCODE -ne 0) { return '' }; return (($out | Out-String).Trim()) }
  catch { return '' } finally { $ErrorActionPreference = $old }
}
# Retries a script block (network steps).
function Retry([int]$Times, [scriptblock]$Block) {
  for ($i = 1; ; $i++) {
    try { & $Block; return } catch {
      if ($i -ge $Times) { throw }
      Warn "Attempt $i/$Times failed: $($_.Exception.Message) (retrying in $($i * 5)s)"; Start-Sleep -Seconds ($i * 5)
    }
  }
}
function Update-PathFromRegistry {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}
function Install-WithWinget($id, $label) {
  if (-not (Have winget)) { Fail "winget is not available. Install $label manually (see README.md), then re-run." }
  Info "Installing $label with winget ($id)..."
  Run winget @('install', '-e', '--id', $id, '--accept-source-agreements', '--accept-package-agreements')
  Update-PathFromRegistry
}
function Test-Node {
  if (-not (Have node)) { return $false }
  return (Test-Run node @('-e', 'const v=process.versions.node.split(''.'').map(Number);process.exit(v[0]>22||(v[0]===22&&v[1]>=18)?0:1)'))
}
function Test-PortBusy([int]$Port) {
  return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}
function Show-PortOwner([int]$Port) {
  Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
    $p = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
    Info ("port {0} used by {1} (PID {2})" -f $Port, $p.ProcessName, $_.OwningProcess)
  }
}

# ---------- .env helpers ----------
$script:EnvPath = $null; $script:EnvBackedUp = $false
function Get-EnvValue($key) {
  if (-not (Test-Path $script:EnvPath)) { return '' }
  foreach ($line in [IO.File]::ReadAllLines($script:EnvPath)) {
    if ($line -match ('^\s*(?:export\s+)?' + [regex]::Escape($key) + '\s*=(.*)$')) {
      $v = $Matches[1].Trim()
      if ($v.Length -gt 1 -and (($v.StartsWith('"') -and $v.EndsWith('"')) -or ($v.StartsWith("'") -and $v.EndsWith("'")))) { $v = $v.Substring(1, $v.Length - 2) }
      return $v
    }
  }
  return ''
}
function Set-EnvValue($key, $value) {
  if (-not $script:EnvBackedUp -and (Test-Path $script:EnvPath)) {
    $bak = Join-Path $LogDir ("{0}.env.{1}.bak" -f $Service, (Get-Date -Format 'yyyyMMdd-HHmmss'))
    Copy-Item $script:EnvPath $bak; Info "Backed up .env -> $bak"; $script:EnvBackedUp = $true
  }
  $lines = New-Object System.Collections.Generic.List[string]
  if (Test-Path $script:EnvPath) { $lines.AddRange([IO.File]::ReadAllLines($script:EnvPath)) }
  $pattern = '^\s*(?:export\s+)?' + [regex]::Escape($key) + '\s*='
  $done = $false
  for ($i = 0; $i -lt $lines.Count; $i++) { if ($lines[$i] -match $pattern) { $lines[$i] = "$key=$value"; $done = $true; break } }
  if (-not $done) { $lines.Add("$key=$value") }
  [IO.File]::WriteAllLines($script:EnvPath, $lines, (New-Object Text.UTF8Encoding $false))
}
function Get-MissingKeys { $RequiredKeys | Where-Object { -not (Get-EnvValue $_) } }

# All steps live in Main so `return` ends the run cleanly and the catch below reports any failure.
function Main {
  Info "$Project setup (windows) | branch=$Branch | log: $LogFile"
  $Root = Get-Output git @('-C', $PSScriptRoot, 'rev-parse', '--show-toplevel')
  if ($Root) { $Root = [IO.Path]::GetFullPath($Root) }

  # ---------- -Check ----------
  if ($Check) {
    Step 'Diagnosis (nothing is changed)'
    $script:problems = 0
    function Bad($m) { Write-Host "    [problem] $m" -ForegroundColor Red; $script:problems++ }
    Info ("Windows {0}, PowerShell {1}" -f [Environment]::OSVersion.Version, $PSVersionTable.PSVersion)
    if (Have git) { Ok (Get-Output git @('--version')) } else { Bad 'git is not installed' }
    if (Test-Node) { Ok "node $(Get-Output node @('--version')), npm $(Get-Output npm @('--version'))" } else { Bad 'Node.js 22.18+ not found' }
    if ($Root) {
      Set-Location $Root; Ok "repository: $Root (branch $(Get-Output git @('rev-parse', '--abbrev-ref', 'HEAD')))"
      if (Test-Path 'node_modules') { Ok 'node_modules present' } else { Bad 'node_modules missing' }
      $script:EnvPath = Join-Path $Root '.env'
      if (-not (Test-Path $script:EnvPath) -and (Test-Path (Join-Path $Root '.env.local'))) { $script:EnvPath = Join-Path $Root '.env.local' }
      if (Test-Path $script:EnvPath) {
        $miss = @(Get-MissingKeys)
        if ($miss.Count -eq 0) { Ok 'all required keys set' } else { Bad ("empty keys: " + ($miss -join ', ')) }
        Info "EKLINK_ISSUER_URL=$(Get-EnvValue 'EKLINK_ISSUER_URL')"
      } else { Bad 'no .env file (copy .env.example to .env)' }
    } else { Bad "not inside the $Project git repository" }
    if (Test-PortBusy $AppPort) { Show-PortOwner $AppPort } else { Info "port $AppPort free" }
    if ($script:problems -eq 0) { Write-Host "`nNo problems found." -ForegroundColor Green } else { Write-Host "`n$($script:problems) problem(s) found." -ForegroundColor Red; $script:ExitCode = 1 }
    return
  }

  # ---------- 1. tools ----------
  if (-not $RunOnly) {
    Step 'Checking required software'
    Info ("Windows {0}, PowerShell {1}" -f [Environment]::OSVersion.Version, $PSVersionTable.PSVersion)
    if (-not (Have git)) {
      if (-not (Confirm-Step 'Git not found. Install it with winget?')) { Fail 'Git is required.' }
      Install-WithWinget 'Git.Git' 'Git'
      if (-not (Have git)) { Fail 'Git installed; open a NEW PowerShell window and re-run this script.' }
    }
    if (-not (Test-Node)) {
      if (-not (Confirm-Step 'Node.js 22.18+ not found. Install Node.js LTS with winget?')) { Fail 'Node.js 22.18+ is required.' }
      Install-WithWinget 'OpenJS.NodeJS.LTS' 'Node.js LTS'
      if (-not (Test-Node)) { Fail 'Node.js installed; open a NEW PowerShell window and re-run this script.' }
    }
    Ok "$(Get-Output git @('--version')), node $(Get-Output node @('--version')), npm $(Get-Output npm @('--version'))"
  } elseif (-not (Test-Node)) { Fail 'Node.js 22.18+ not found; run the full setup first.' }

  # ---------- 2. repository ----------
  if (-not $Root) {
    $Root = Join-Path (Get-Location) $Project
    if (Test-Path (Join-Path $Root '.git')) { Info "Using existing clone: $Root" }
    elseif ($RunOnly) { Fail "Repository not found at $Root." }
    else { Retry 3 { Run git @('clone', '--branch', $Branch, $RepoUrl, $Root) } }
  }
  Set-Location $Root
  $exclude = Join-Path $Root '.git\info\exclude'
  if ((Test-Path (Split-Path $exclude)) -and -not (Select-String -Path $exclude -Pattern '^logs/$' -Quiet -ErrorAction SilentlyContinue)) { Add-Content $exclude 'logs/' }

  if (-not $RunOnly) {
    Step "Getting the code (branch: $Branch)"
    Info "Repository: $Root"
    if (-not $SkipPull) {
      $dirty = Get-Output git @('status', '--porcelain', '--untracked-files=no')
      if ($dirty) { $dirty -split "`n" | ForEach-Object { Info "  $_" }; Fail 'Uncommitted changes (listed above). Commit or stash them, or re-run with -SkipPull.' }
      Retry 3 { Run git @('fetch', 'origin', $Branch) }
      if ((Get-Output git @('rev-parse', '--abbrev-ref', 'HEAD')) -ne $Branch) {
        if (Test-Run git @('show-ref', '--verify', '--quiet', "refs/heads/$Branch")) { Run git @('checkout', $Branch) }
        else { Run git @('checkout', '-b', $Branch, '--track', "origin/$Branch") }
      }
      try { Run git @('pull', '--ff-only', 'origin', $Branch) } catch { Fail "git pull --ff-only failed: local branch has diverged from origin/$Branch." }
      Ok "at $(Get-Output git @('log', '-1', '--format=%h %s'))"
    } else { Info "Skipping git pull (-SkipPull). Current: $(Get-Output git @('rev-parse', '--abbrev-ref', 'HEAD'))" }

    # ---------- 3. dependencies ----------
    Step 'Installing npm dependencies'
    $marker = Join-Path $Root 'node_modules\.package-lock.json'
    if (-not $Reinstall -and (Test-Path $marker) -and ((Get-Item $marker).LastWriteTime -gt (Get-Item (Join-Path $Root 'package-lock.json')).LastWriteTime)) {
      Ok 'node_modules is up to date (use -Reinstall to force)'
    } else {
      try { Retry 2 { Run npm @('ci', '--no-audit', '--no-fund') } }
      catch {
        Warn "npm ci failed ($($_.Exception.Message)); trying npm install. (Close editors/servers that lock node_modules if this keeps failing.)"
        Retry 2 { Run npm @('install', '--no-audit', '--no-fund') }
      }
    }
  }

  # ---------- 4. .env ----------
  $script:EnvPath = Join-Path $Root '.env'
  if (-not (Test-Path $script:EnvPath) -and (Test-Path (Join-Path $Root '.env.local'))) { $script:EnvPath = Join-Path $Root '.env.local' }
  if (-not $RunOnly) {
    Step "Configuring $(Split-Path $script:EnvPath -Leaf)"
    if (-not (Test-Path $script:EnvPath)) { Copy-Item (Join-Path $Root '.env.example') $script:EnvPath; Info 'Created .env from .env.example' }
    if (-not (Get-EnvValue 'EKLINK_ISSUER_URL')) { Set-EnvValue 'EKLINK_ISSUER_URL' "http://localhost:$AppPort"; Info "EKLINK_ISSUER_URL -> http://localhost:$AppPort" }
    if (-not (Get-EnvValue 'EKLINK_JWT_PRIVATE_KEY') -or -not (Get-EnvValue 'EKLINK_JWT_KEY_ID')) {
      Info 'Generating the ES256 token signing key (scripts\generate-jwt-keys.mjs)'
      $keys = Get-Output node @('scripts/generate-jwt-keys.mjs')
      $kid = ($keys -split "`r?`n" | Where-Object { $_ -like 'EKLINK_JWT_KEY_ID=*' } | Select-Object -First 1) -replace '^EKLINK_JWT_KEY_ID=', ''
      $pem = ($keys -split "`r?`n" | Where-Object { $_ -like 'EKLINK_JWT_PRIVATE_KEY=*' } | Select-Object -First 1) -replace '^EKLINK_JWT_PRIVATE_KEY=', ''
      if (-not $kid -or -not $pem) { Fail 'Key generation failed (are the npm dependencies installed?).' }
      Set-EnvValue 'EKLINK_JWT_KEY_ID' $kid; Set-EnvValue 'EKLINK_JWT_PRIVATE_KEY' $pem; Ok 'signing key written'
    }
  }
  $miss = @(Get-MissingKeys)
  if ($miss.Count -gt 0) {
    Fail ("These keys are empty in {0}: {1}`n    Fill them in and re-run. Supabase values: Supabase dashboard -> Project Settings -> API." -f $script:EnvPath, ($miss -join ', '))
  }
  Ok 'all required keys are set'

  if ($NoRun) { Step 'Setup complete'; Info 'Start it with: powershell -ExecutionPolicy Bypass -File scripts\setup-windows.ps1 -RunOnly   (or: npm run dev)'; return }

  # ---------- 5. run ----------
  Step "Starting the dev server (http://localhost:$AppPort) in a new window"
  if (Test-PortBusy $AppPort) { Show-PortOwner $AppPort; Fail "Port $AppPort is already in use (see above). Close that program and re-run with -RunOnly." }
  $shell = if (Have pwsh) { 'pwsh' } else { 'powershell' }
  $cmd = "Set-Location '$($Root -replace "'", "''")'; `$Host.UI.RawUI.WindowTitle = '$Project dev server :$AppPort'; npm run dev -- --port $AppPort"
  Start-Process $shell -ArgumentList @('-NoExit', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $cmd) | Out-Null
  $waited = 0
  while (-not (Test-PortBusy $AppPort) -and $waited -lt 90) { Start-Sleep -Seconds 3; $waited += 3 }
  if (Test-PortBusy $AppPort) { Ok "$Project is up: http://localhost:$AppPort (close its window to stop it)" }
  else { Warn "Nothing listening on $AppPort after 90s: look at the '$Project dev server' window for the error." }
}

$script:ExitCode = 0
try {
  if ($Trace) { Set-PSDebug -Trace 1 }
  Main
}
catch {
  $inv = $_.InvocationInfo
  Write-Host ''
  Write-Host "[x] $Project failed in step '$($script:CurrentStep)'" -ForegroundColor Red
  Write-Host "    error: $($_.Exception.Message)" -ForegroundColor Red
  if ($inv -and $inv.ScriptLineNumber -and $inv.Line -notmatch 'function Fail') { Write-Host "    at line $($inv.ScriptLineNumber): $($inv.Line.Trim())" }
  if ($_.ScriptStackTrace) { Write-Host '    call stack (innermost first):'; ($_.ScriptStackTrace -split "`r?`n") | Where-Object { $_ -notmatch 'at Fail,' } | ForEach-Object { Write-Host "      $_" } }
  Write-Host "    full log: $LogFile"
  Write-Host '    next: re-run with -Trace to print every line, or -Check to diagnose.'
  $script:ExitCode = 1
}
finally {
  Set-PSDebug -Off
  try { Stop-Transcript | Out-Null } catch { }
}
exit $script:ExitCode
