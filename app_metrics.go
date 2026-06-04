package main

import (
	"encoding/json"
	"os/exec"
	"strings"
	"time"
)

// Impact Dashboard backend.
//
// Captures point-in-time snapshots of metrics that change when the user
// optimizes their system (free RAM, free disk, startup item count,
// running services, processes) plus boot diagnostics when the Windows
// Diagnostics-Performance log exposes them.
//
// One snapshot is auto-captured per UI fetch, but persisted at most
// once per ~12h to keep the trend file from filling with near-identical
// rows. The history powers the "this week vs last week" deltas.

const psCaptureSnapshot = `
$ErrorActionPreference = 'SilentlyContinue'

$os = Get-CimInstance Win32_OperatingSystem
$now = Get-Date
$uptime = $now - $os.LastBootUpTime
$mem = $os
$sysDrive = Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3 AND DeviceID='$($env:SystemDrive)'"
$svcRunning = 0
try { $svcRunning = (Get-Service | Where-Object Status -eq 'Running').Count } catch { }
$procs = 0
try { $procs = (Get-Process).Count } catch { }

$bootMs = 0
$bootMainMs = 0
try {
  $ev = Get-WinEvent -LogName 'Microsoft-Windows-Diagnostics-Performance/Operational' -MaxEvents 5 -ErrorAction Stop | Where-Object Id -eq 100 | Select-Object -First 1
  if ($ev) {
    $xml = [xml]$ev.ToXml()
    foreach ($d in $xml.Event.EventData.Data) {
      if ($d.Name -eq 'BootTime')         { $bootMs = [int]$d.'#text' }
      if ($d.Name -eq 'MainPathBootTime') { $bootMainMs = [int]$d.'#text' }
    }
  }
} catch { }

[pscustomobject]@{
  ts              = [int][double]::Parse(([DateTimeOffset]$now).ToUnixTimeSeconds())
  uptimeSec       = [int]$uptime.TotalSeconds
  lastBootTs      = [int][double]::Parse(([DateTimeOffset]$os.LastBootUpTime).ToUnixTimeSeconds())
  freeRamMB       = [int]($mem.FreePhysicalMemory / 1024)
  totalRamMB      = [int]($mem.TotalVisibleMemorySize / 1024)
  freeDiskGB      = [math]::Round($sysDrive.FreeSpace / 1GB, 2)
  totalDiskGB     = [math]::Round($sysDrive.Size / 1GB, 2)
  servicesRunning = [int]$svcRunning
  processCount    = [int]$procs
  bootDurationMs  = [int]$bootMs
  bootMainPathMs  = [int]$bootMainMs
} | ConvertTo-Json -Compress
`

// captureLive runs the PowerShell snapshot script and parses it into an
// ImpactSnapshot. StartupTotal/StartupEnabled are filled in later by the
// caller because we already pay for that PowerShell call elsewhere.
func captureLive() (ImpactSnapshot, error) {
	var snap ImpactSnapshot
	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", psCaptureSnapshot)
	cmd.SysProcAttr = getSysProcAttr()
	out, err := cmd.CombinedOutput()
	if err != nil {
		return snap, err
	}
	if err := json.Unmarshal([]byte(strings.TrimSpace(string(out))), &snap); err != nil {
		return snap, err
	}
	return snap, nil
}

// fillStartupCounts asks PowerShell for the cheap subset of GetStartupItems
// (just counts, not the full list). Faster than re-running the full scan.
const psStartupCounts = `
$ErrorActionPreference = 'SilentlyContinue'
$total = 0; $enabled = 0
function Tally($isOn) { $script:total++; if ($isOn) { $script:enabled++ } }
function Read-Approved($key, $name) {
  if (-not (Test-Path $key)) { return $true }
  $v = (Get-ItemProperty -Path $key -Name $name -ErrorAction SilentlyContinue).$name
  if ($null -eq $v) { return $true }
  return -not ($v[0] -band 0x01)
}

$runLocs = @(
  @{ RegPath='HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run';             Approved='HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run' },
  @{ RegPath='HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run';             Approved='HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run' },
  @{ RegPath='HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Run'; Approved='HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run32' }
)
foreach ($loc in $runLocs) {
  if (-not (Test-Path $loc.RegPath)) { continue }
  $props = Get-ItemProperty -Path $loc.RegPath
  foreach ($p in $props.PSObject.Properties) {
    if ($p.Name -match '^PS(Path|ParentPath|ChildName|Provider|Drive)$') { continue }
    Tally (Read-Approved $loc.Approved $p.Name)
  }
}

$folders = @(
  @{ Path=[Environment]::GetFolderPath('Startup');       Approved='HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\StartupFolder' },
  @{ Path=[Environment]::GetFolderPath('CommonStartup'); Approved='HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\StartupFolder' }
)
foreach ($f in $folders) {
  if (-not $f.Path -or -not (Test-Path $f.Path)) { continue }
  Get-ChildItem -Path $f.Path -File | ForEach-Object { Tally (Read-Approved $f.Approved $_.Name) }
}

$appxKey = 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\StartupTask'
try { $packages = Get-AppxPackage -ErrorAction Stop } catch { $packages = @() }
foreach ($pkg in $packages) {
  if (-not $pkg.InstallLocation) { continue }
  $manifest = Join-Path $pkg.InstallLocation 'AppxManifest.xml'
  if (-not (Test-Path $manifest)) { continue }
  try { $xml = [xml](Get-Content -LiteralPath $manifest -Raw) } catch { continue }
  $nodes = $xml.SelectNodes("//*[local-name()='Extension' and @Category='windows.startupTask']")
  if ($null -eq $nodes -or $nodes.Count -eq 0) { continue }
  foreach ($n in $nodes) {
    $stNode = $null
    foreach ($c in $n.ChildNodes) { if ($c.LocalName -eq 'StartupTask') { $stNode = $c; break } }
    if ($null -eq $stNode -or -not $stNode.TaskId) { continue }
    $enabled = ($stNode.Enabled -eq 'true')
    $pkgApprovedKey = Join-Path $appxKey $pkg.PackageFamilyName
    if (Test-Path $pkgApprovedKey) {
      $v = (Get-ItemProperty -Path $pkgApprovedKey -Name $stNode.TaskId -ErrorAction SilentlyContinue).($stNode.TaskId)
      if ($v -is [byte[]] -and $v.Length -gt 0) { $enabled = -not ($v[0] -band 0x01) }
    }
    Tally $enabled
  }
}

try {
  $tasks = Get-ScheduledTask -ErrorAction Stop
  foreach ($t in $tasks) {
    if ($t.TaskPath -like '\Microsoft\Windows\*') { continue }
    $relevant = $false
    foreach ($trig in $t.Triggers) {
      $tn = $trig.CimClass.CimClassName
      if ($tn -eq 'MSFT_TaskLogonTrigger' -or $tn -eq 'MSFT_TaskBootTrigger') { $relevant = $true; break }
    }
    if (-not $relevant) { continue }
    Tally ($t.State -ne 'Disabled')
  }
} catch { }

[pscustomobject]@{ total=$total; enabled=$enabled } | ConvertTo-Json -Compress
`

type startupCounts struct {
	Total   int `json:"total"`
	Enabled int `json:"enabled"`
}

func captureStartupCounts() startupCounts {
	var c startupCounts
	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", psStartupCounts)
	cmd.SysProcAttr = getSysProcAttr()
	out, err := cmd.CombinedOutput()
	if err != nil {
		return c
	}
	_ = json.Unmarshal([]byte(strings.TrimSpace(string(out))), &c)
	return c
}

// shouldPersist returns true if the newest snapshot is older than 12h
// or doesn't exist. Avoids spamming the history with near-duplicate rows
// every time the Monitor tab is opened.
func shouldPersist(history []ImpactSnapshot, now time.Time) bool {
	if len(history) == 0 {
		return true
	}
	last := time.Unix(history[len(history)-1].TimestampUnix, 0)
	return now.Sub(last) >= 12*time.Hour
}

// GetImpactDashboard returns the live snapshot plus the persisted history,
// JSON-encoded, ready for the UI to render.
func (a *App) GetImpactDashboard() string {
	snap, err := captureLive()
	if err != nil {
		return `{"error":"` + strings.ReplaceAll(err.Error(), `"`, `'`) + `"}`
	}
	counts := captureStartupCounts()
	snap.StartupTotal = counts.Total
	snap.StartupEnabled = counts.Enabled

	history := loadSnapshots()
	if shouldPersist(history, time.Now()) {
		saveSnapshot(snap)
		history = append(history, snap)
	}

	payload := struct {
		Current ImpactSnapshot   `json:"current"`
		History []ImpactSnapshot `json:"history"`
	}{snap, history}
	data, err := json.Marshal(payload)
	if err != nil {
		return `{"error":"marshal failed"}`
	}
	return string(data)
}
