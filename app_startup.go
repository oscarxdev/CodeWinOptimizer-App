package main

import (
	"os"
	"os/exec"
	"strings"
)

// Startup Manager: enumerate and toggle Windows auto-start entries from
// Run keys (HKLM, HKCU, WOW6432Node) and the user/all-users Startup folders.
//
// Enable/disable uses the same mechanism Task Manager uses:
// HKLM/HKCU\...\Explorer\StartupApproved\{Run|StartupFolder} — a binary
// value whose first byte is 0x02 (enabled) or 0x03 (disabled). Bytes 4-11
// hold a FILETIME marking when the entry was last disabled. Existing
// entries left untouched in the real Run keys / Startup folders, so the
// change is fully reversible and visible in Task Manager too.

const psListStartupItems = `
$ErrorActionPreference = 'SilentlyContinue'
$items = New-Object System.Collections.ArrayList

function Read-Approved($key, $name) {
  if (-not (Test-Path $key)) { return $true }
  $v = (Get-ItemProperty -Path $key -Name $name -ErrorAction SilentlyContinue).$name
  if ($null -eq $v) { return $true }
  return -not ($v[0] -band 0x01)
}

$runLocations = @(
  @{ Scope = 'HKLM'; RegPath = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run';            Label = 'HKLM Run';        Approved = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run' },
  @{ Scope = 'HKCU'; RegPath = 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run';            Label = 'HKCU Run';        Approved = 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run' },
  @{ Scope = 'HKLM'; RegPath = 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Run'; Label = 'HKLM Run (x86)';  Approved = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run32' }
)

foreach ($loc in $runLocations) {
  if (-not (Test-Path $loc.RegPath)) { continue }
  $props = Get-ItemProperty -Path $loc.RegPath
  foreach ($p in $props.PSObject.Properties) {
    if ($p.Name -match '^PS(Path|ParentPath|ChildName|Provider|Drive)$') { continue }
    $cmd = [string]$p.Value
    $enabled = Read-Approved $loc.Approved $p.Name
    $type = 'exe'
    if ($cmd -match '\.bat\b|\.cmd\b|\.ps1\b') { $type = 'script' }
    elseif ($cmd -match '\.dll\b') { $type = 'dll' }
    $null = $items.Add([pscustomobject]@{
      id       = "$($loc.Scope)|Run|$($p.Name)"
      name     = $p.Name
      command  = $cmd
      location = $loc.Label
      source   = 'registry'
      enabled  = [bool]$enabled
      type     = $type
    })
  }
}

$folderLocations = @(
  @{ Scope = 'user';   Path = [Environment]::GetFolderPath('Startup');       Label = 'User Startup Folder';   Approved = 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\StartupFolder' },
  @{ Scope = 'common'; Path = [Environment]::GetFolderPath('CommonStartup'); Label = 'All Users Startup';     Approved = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\StartupFolder' }
)

foreach ($f in $folderLocations) {
  if (-not $f.Path -or -not (Test-Path $f.Path)) { continue }
  Get-ChildItem -Path $f.Path -File | ForEach-Object {
    $cmd = $_.FullName
    $type = 'other'
    if ($_.Extension -eq '.lnk') { $type = 'shortcut' }
    elseif ($_.Extension -in '.bat','.cmd','.ps1') { $type = 'script' }
    elseif ($_.Extension -eq '.exe') { $type = 'exe' }
    $enabled = Read-Approved $f.Approved $_.Name
    $null = $items.Add([pscustomobject]@{
      id       = "$($f.Scope)|Folder|$($_.Name)"
      name     = $_.BaseName
      command  = $cmd
      location = $f.Label
      source   = 'folder'
      enabled  = [bool]$enabled
      type     = $type
    })
  }
}

,$items | ConvertTo-Json -Compress -Depth 4
`

const psSetStartupItem = `
$ErrorActionPreference = 'Stop'
try {
  $id = $env:CWO_STARTUP_ID
  $enabled = ($env:CWO_STARTUP_ENABLED -eq '1')
  if (-not $id) { 'ERR: missing id'; exit }
  $parts = $id -split '\|', 3
  if ($parts.Count -lt 3) { 'ERR: bad id'; exit }
  $scope = $parts[0]; $kind = $parts[1]; $name = $parts[2]

  $approvedKey = $null
  if ($kind -eq 'Run') {
    if ($scope -eq 'HKLM') {
      $approvedKey = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run'
    } elseif ($scope -eq 'HKCU') {
      $approvedKey = 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run'
    }
  } elseif ($kind -eq 'Folder') {
    if ($scope -eq 'common') {
      $approvedKey = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\StartupFolder'
    } elseif ($scope -eq 'user') {
      $approvedKey = 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\StartupFolder'
    }
  }
  if (-not $approvedKey) { 'ERR: unknown scope/kind'; exit }
  if (-not (Test-Path $approvedKey)) { New-Item -Path $approvedKey -Force | Out-Null }

  $bytes = New-Object byte[] 12
  $bytes[0] = if ($enabled) { 0x02 } else { 0x03 }
  $ft = [BitConverter]::GetBytes((Get-Date).ToFileTime())
  [Array]::Copy($ft, 0, $bytes, 4, 8)
  Set-ItemProperty -Path $approvedKey -Name $name -Value $bytes -Type Binary -Force
  if ($enabled) { 'OK: enabled' } else { 'OK: disabled' }
} catch {
  'ERR: ' + $_.Exception.Message
}
`

// GetStartupItems returns the JSON array of detected startup entries.
func (a *App) GetStartupItems() string {
	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", psListStartupItems)
	cmd.SysProcAttr = getSysProcAttr()
	out, err := cmd.CombinedOutput()
	if err != nil {
		return `{"error":"` + strings.ReplaceAll(err.Error(), `"`, `'`) + `"}`
	}
	s := strings.TrimSpace(string(out))
	if s == "" {
		return "[]"
	}
	return s
}

// SetStartupItemEnabled toggles the StartupApproved entry for the given id.
// id format: "<scope>|<kind>|<name>"  e.g. "HKLM|Run|OneDrive" or "user|Folder|MyScript.lnk".
func (a *App) SetStartupItemEnabled(id string, enabled bool) string {
	if err := a.rateLimit("SetStartupItemEnabled"); err != nil {
		return "ERR: " + err.Error()
	}
	enabledStr := "0"
	if enabled {
		enabledStr = "1"
	}
	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", psSetStartupItem)
	cmd.SysProcAttr = getSysProcAttr()
	cmd.Env = append(os.Environ(),
		"CWO_STARTUP_ID="+id,
		"CWO_STARTUP_ENABLED="+enabledStr,
	)
	out, _ := cmd.CombinedOutput()
	res := strings.TrimSpace(string(out))
	a.emitLog(res)
	return res
}
