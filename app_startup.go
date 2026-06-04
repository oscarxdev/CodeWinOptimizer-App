package main

import (
	"os"
	"os/exec"
	"strings"
)

// Startup Manager: enumerate and toggle Windows auto-start entries.
//
// Sources covered:
//   1. Run keys      — HKLM, HKCU, WOW6432Node \...\CurrentVersion\Run
//   2. Startup folders — user + all-users
//   3. AppX/UWP tasks  — Modern apps with windows.startupTask manifest,
//                        tracked under StartupApproved\StartupTask
//   4. Scheduled tasks — non-system tasks with LogonTrigger / BootTrigger
//
// Enable/disable strategy:
//   - Run keys + folders + AppX tasks → write StartupApproved binary
//     (byte 0 = 0x02 enabled / 0x03 disabled, bytes 4-11 = FILETIME).
//     Same mechanism Task Manager uses — fully reversible, no entries
//     are moved or deleted from their source location.
//   - Scheduled tasks → Enable-ScheduledTask / Disable-ScheduledTask.
//
// ID schema: pipe-delimited "<scope>|<kind>|<...>".
//   HKLM|Run|<ValueName>
//   HKCU|Run|<ValueName>
//   user|Folder|<FileName>
//   common|Folder|<FileName>
//   HKCU|AppxTask|<PackageFamilyName>|<TaskId>
//   HKLM|AppxTask|<PackageFamilyName>|<TaskId>
//   -|Task|<TaskPath>|<TaskName>

const psListStartupItems = `
$ErrorActionPreference = 'SilentlyContinue'
$items = New-Object System.Collections.ArrayList

function Read-Approved($key, $name) {
  if (-not (Test-Path $key)) { return $true }
  $v = (Get-ItemProperty -Path $key -Name $name -ErrorAction SilentlyContinue).$name
  if ($null -eq $v) { return $true }
  return -not ($v[0] -band 0x01)
}

# --- 1. Run keys ---
$runLocations = @(
  @{ Scope = 'HKLM'; RegPath = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run';            Label = 'HKLM Run';       Approved = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run' },
  @{ Scope = 'HKCU'; RegPath = 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run';            Label = 'HKCU Run';       Approved = 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run' },
  @{ Scope = 'HKLM'; RegPath = 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Run'; Label = 'HKLM Run (x86)'; Approved = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run32' }
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

# --- 2. Startup folders ---
$folderLocations = @(
  @{ Scope = 'user';   Path = [Environment]::GetFolderPath('Startup');       Label = 'User Startup Folder'; Approved = 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\StartupFolder' },
  @{ Scope = 'common'; Path = [Environment]::GetFolderPath('CommonStartup'); Label = 'All Users Startup';   Approved = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\StartupFolder' }
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

# --- 3. AppX / UWP startup tasks ---
# Canonical source is the AppxManifest of every installed package: any
# <Extension Category="windows.startupTask"> declaration (uap5: or
# desktop: namespace) registers a startup task. The default enabled
# state comes from the manifest; a binary override may live in
# HKCU\...\StartupApproved\StartupTask\<PackageFamilyName>\<TaskId>.
$appxApprovedKey = 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\StartupTask'
try {
  $packages = Get-AppxPackage -ErrorAction Stop
} catch {
  $packages = @()
}
foreach ($pkg in $packages) {
  if (-not $pkg.InstallLocation) { continue }
  $manifest = Join-Path $pkg.InstallLocation 'AppxManifest.xml'
  if (-not (Test-Path $manifest)) { continue }
  try {
    $xml = [xml](Get-Content -LiteralPath $manifest -Raw)
  } catch { continue }
  $nodes = $xml.SelectNodes("//*[local-name()='Extension' and @Category='windows.startupTask']")
  if ($null -eq $nodes -or $nodes.Count -eq 0) { continue }
  foreach ($n in $nodes) {
    $stNode = $null
    foreach ($c in $n.ChildNodes) {
      if ($c.LocalName -eq 'StartupTask') { $stNode = $c; break }
    }
    if ($null -eq $stNode) { continue }
    $taskId = $stNode.TaskId
    if (-not $taskId) { continue }
    $manifestDefault = ($stNode.Enabled -eq 'true')
    $display = $stNode.DisplayName
    if (-not $display -or $display -like 'ms-resource:*') {
      $display = ($pkg.Name -split '\.')[-1]
      if (-not $display) { $display = $pkg.Name }
    }
    $enabled = $manifestDefault
    $pkgApprovedKey = Join-Path $appxApprovedKey $pkg.PackageFamilyName
    if (Test-Path $pkgApprovedKey) {
      $v = (Get-ItemProperty -Path $pkgApprovedKey -Name $taskId -ErrorAction SilentlyContinue).$taskId
      if ($v -is [byte[]] -and $v.Length -gt 0) {
        $enabled = -not ($v[0] -band 0x01)
      }
    }
    $null = $items.Add([pscustomobject]@{
      id       = "HKCU|AppxTask|$($pkg.PackageFamilyName)|$taskId"
      name     = $display
      command  = "AppX: $($pkg.PackageFamilyName)"
      location = 'Modern App'
      source   = 'appx'
      enabled  = [bool]$enabled
      type     = 'appx'
    })
  }
}

# --- 4. Scheduled tasks with LogonTrigger / BootTrigger ---
# Skip Windows internals (\Microsoft\Windows\*) — they are system maintenance
# and not what the user thinks of as "startup programs". Third-party tasks
# (Edge updaters, OneDrive, NVIDIA, etc.) live outside that namespace or in
# a sibling vendor folder and ARE shown.
try {
  $tasks = Get-ScheduledTask -ErrorAction Stop
  foreach ($t in $tasks) {
    if ($t.TaskPath -like '\Microsoft\Windows\*') { continue }
    $relevant = $false
    foreach ($trig in $t.Triggers) {
      $tn = $trig.CimClass.CimClassName
      if ($tn -eq 'MSFT_TaskLogonTrigger' -or $tn -eq 'MSFT_TaskBootTrigger') {
        $relevant = $true; break
      }
    }
    if (-not $relevant) { continue }
    $cmd = ''
    if ($t.Actions -and $t.Actions.Count -gt 0) {
      $a = $t.Actions[0]
      if ($a.PSObject.Properties['Execute']) {
        $cmd = [string]$a.Execute
        if ($a.PSObject.Properties['Arguments'] -and $a.Arguments) {
          $cmd += ' ' + [string]$a.Arguments
        }
      }
    }
    $enabled = ($t.State -ne 'Disabled')
    $taskPath = $t.TaskPath
    $taskName = $t.TaskName
    $folderLabel = $taskPath.Trim('\')
    $locLabel = if ($folderLabel) { "Scheduled Task ($folderLabel)" } else { 'Scheduled Task' }
    $null = $items.Add([pscustomobject]@{
      id       = "-|Task|$taskPath|$taskName"
      name     = $taskName
      command  = $cmd
      location = $locLabel
      source   = 'task'
      enabled  = [bool]$enabled
      type     = 'task'
    })
  }
} catch { }

,$items | ConvertTo-Json -Compress -Depth 5
`

const psSetStartupItem = `
$ErrorActionPreference = 'Stop'
try {
  $id = $env:CWO_STARTUP_ID
  $enabled = ($env:CWO_STARTUP_ENABLED -eq '1')
  if (-not $id) { 'ERR: missing id'; exit }
  $parts = $id -split '\|'
  if ($parts.Count -lt 3) { 'ERR: bad id'; exit }
  $scope = $parts[0]; $kind = $parts[1]

  function Write-Approved($key, $name, $enabled) {
    if (-not (Test-Path $key)) { New-Item -Path $key -Force | Out-Null }
    $bytes = New-Object byte[] 12
    $bytes[0] = if ($enabled) { 0x02 } else { 0x03 }
    $ft = [BitConverter]::GetBytes((Get-Date).ToFileTime())
    [Array]::Copy($ft, 0, $bytes, 4, 8)
    Set-ItemProperty -Path $key -Name $name -Value $bytes -Type Binary -Force
  }

  if ($kind -eq 'Run') {
    $name = ($parts[2..($parts.Count - 1)] -join '|')
    $approvedKey = if ($scope -eq 'HKLM') {
      'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run'
    } else {
      'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run'
    }
    Write-Approved $approvedKey $name $enabled
  }
  elseif ($kind -eq 'Folder') {
    $name = ($parts[2..($parts.Count - 1)] -join '|')
    $approvedKey = if ($scope -eq 'common') {
      'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\StartupFolder'
    } else {
      'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\StartupFolder'
    }
    Write-Approved $approvedKey $name $enabled
  }
  elseif ($kind -eq 'AppxTask') {
    if ($parts.Count -lt 4) { 'ERR: bad appx id'; exit }
    $pkg = $parts[2]; $taskId = $parts[3]
    $rootKey = if ($scope -eq 'HKLM') {
      'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\StartupTask'
    } else {
      'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\StartupTask'
    }
    $pkgKey = Join-Path $rootKey $pkg
    Write-Approved $pkgKey $taskId $enabled
  }
  elseif ($kind -eq 'Task') {
    if ($parts.Count -lt 4) { 'ERR: bad task id'; exit }
    $taskPath = $parts[2]; $taskName = $parts[3]
    $task = Get-ScheduledTask -TaskPath $taskPath -TaskName $taskName -ErrorAction Stop
    if ($enabled) { $task | Enable-ScheduledTask | Out-Null }
    else          { $task | Disable-ScheduledTask | Out-Null }
  }
  else {
    'ERR: unknown kind ' + $kind; exit
  }

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

// SetStartupItemEnabled toggles the given startup entry.
// id format: "<scope>|<kind>|<...>" — see psSetStartupItem.
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
