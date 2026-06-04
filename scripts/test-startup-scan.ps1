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
    $null = $items.Add([pscustomobject]@{ source='registry'; loc=$loc.Label; name=$p.Name; enabled=(Read-Approved $loc.Approved $p.Name) })
  }
}

# --- 2. Startup folders ---
$folderLocations = @(
  @{ Scope='user'; Path=[Environment]::GetFolderPath('Startup'); Label='User Startup Folder'; Approved='HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\StartupFolder' },
  @{ Scope='common'; Path=[Environment]::GetFolderPath('CommonStartup'); Label='All Users Startup'; Approved='HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\StartupFolder' }
)
foreach ($f in $folderLocations) {
  if (-not $f.Path -or -not (Test-Path $f.Path)) { continue }
  Get-ChildItem -Path $f.Path -File | ForEach-Object {
    $null = $items.Add([pscustomobject]@{ source='folder'; loc=$f.Label; name=$_.BaseName; enabled=(Read-Approved $f.Approved $_.Name) })
  }
}

# --- 3. AppX / UWP startup tasks (manifest scan) ---
$appxApprovedKey = 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\StartupTask'
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
      if ($v -is [byte[]] -and $v.Length -gt 0) { $enabled = -not ($v[0] -band 0x01) }
    }
    $null = $items.Add([pscustomobject]@{ source='appx'; loc='Modern App'; name=$display; enabled=$enabled })
  }
}

# --- 4. Scheduled tasks ---
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
    $null = $items.Add([pscustomobject]@{ source='task'; loc=$t.TaskPath; name=$t.TaskName; enabled=($t.State -ne 'Disabled') })
  }
} catch { }

"== Total: $($items.Count) =="
$items | Group-Object source | ForEach-Object { "{0,-10}: {1}" -f $_.Name, $_.Count }
"--"
$items | Sort-Object source, name | Format-Table source, name, enabled, loc -AutoSize | Out-String
