[CmdletBinding()]
param(
  [switch]$RemoveAppData,
  [switch]$Silent
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Write-Step {
  param([string]$Message)
  Write-Host "[Open Cowork Cleanup] $Message"
}

function Add-UniquePath {
  param(
    [System.Collections.Generic.List[string]]$List,
    [string]$PathValue
  )

  if ([string]::IsNullOrWhiteSpace($PathValue)) {
    return
  }

  $expanded = [Environment]::ExpandEnvironmentVariables($PathValue.Trim().Trim('"'))
  if ([string]::IsNullOrWhiteSpace($expanded)) {
    return
  }

  if (-not $List.Contains($expanded)) {
    [void]$List.Add($expanded)
  }
}

function Get-ExecutablePathFromCommand {
  param([string]$CommandValue)

  if ([string]::IsNullOrWhiteSpace($CommandValue)) {
    return $null
  }

  $trimmed = $CommandValue.Trim()
  if ($trimmed -match '^"([^"]+)"') {
    return $Matches[1]
  }

  if ($trimmed -match '^([^ ]+?\.exe)') {
    return $Matches[1]
  }

  return $null
}

function Get-OpenCoworkRegistryEntries {
  $registryGlobs = @(
    "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
  )

  $entries = @()
  foreach ($glob in $registryGlobs) {
    if (-not (Test-Path $glob)) {
      continue
    }

    $items = Get-ItemProperty -Path $glob -ErrorAction SilentlyContinue | Where-Object {
      $_.DisplayName -like "Open Cowork*" -or $_.Publisher -eq "Open Cowork Team"
    }

    if ($items) {
      $entries += $items
    }
  }

  return $entries
}

function Stop-OpenCoworkProcesses {
  $processes = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -ieq "Open Cowork.exe" -or $_.ExecutablePath -like "*\Open Cowork.exe"
  })

  if ($processes.Count -eq 0) {
    Write-Step "No running Open Cowork processes found."
    return
  }

  foreach ($process in $processes) {
    try {
      Write-Step "Stopping process $($process.ProcessId) ($($process.Name))"
      Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
    } catch {
      Write-Warning "Failed to stop process $($process.ProcessId): $($_.Exception.Message)"
    }
  }
}

$registryEntries = @(Get-OpenCoworkRegistryEntries)
$installPaths = [System.Collections.Generic.List[string]]::new()

foreach ($entry in $registryEntries) {
  Add-UniquePath -List $installPaths -PathValue $entry.InstallLocation

  $displayIconPath = Get-ExecutablePathFromCommand -CommandValue $entry.DisplayIcon
  if ($displayIconPath) {
    Add-UniquePath -List $installPaths -PathValue (Split-Path -Path $displayIconPath -Parent)
  }

  $uninstallPath = Get-ExecutablePathFromCommand -CommandValue $entry.UninstallString
  if ($uninstallPath) {
    Add-UniquePath -List $installPaths -PathValue (Split-Path -Path $uninstallPath -Parent)
  }
}

Add-UniquePath -List $installPaths -PathValue (Join-Path $env:LOCALAPPDATA "Programs\Open Cowork")

$appDataPaths = [System.Collections.Generic.List[string]]::new()
Add-UniquePath -List $appDataPaths -PathValue (Join-Path $env:APPDATA "Open Cowork")
Add-UniquePath -List $appDataPaths -PathValue (Join-Path $env:APPDATA "open-cowork")
Add-UniquePath -List $appDataPaths -PathValue (Join-Path $env:LOCALAPPDATA "Open Cowork")
Add-UniquePath -List $appDataPaths -PathValue (Join-Path $env:LOCALAPPDATA "open-cowork")

Write-Host ""
Write-Step "This tool removes broken Open Cowork Windows install leftovers."
Write-Step "Install directories and uninstall registry entries will be removed."
if ($RemoveAppData) {
  Write-Step "AppData cleanup is enabled. Local settings and cached data will also be removed."
} else {
  Write-Step "AppData cleanup is disabled. Local settings will be kept."
}
Write-Host ""

if (-not $Silent) {
  $answer = Read-Host "Continue? [y/N]"
  if ($answer -notmatch '^(?i)y(es)?$') {
    Write-Step "Cancelled."
    exit 1
  }
}

$failures = @()

Stop-OpenCoworkProcesses

foreach ($pathValue in $installPaths) {
  if (-not (Test-Path -LiteralPath $pathValue)) {
    continue
  }

  try {
    Write-Step "Removing install path: $pathValue"
    Remove-Item -LiteralPath $pathValue -Recurse -Force -ErrorAction Stop
  } catch {
    $failures += "install path: $pathValue"
    Write-Warning "Failed to remove install path $pathValue: $($_.Exception.Message)"
  }
}

foreach ($entry in $registryEntries) {
  if ([string]::IsNullOrWhiteSpace($entry.PSPath)) {
    continue
  }

  try {
    Write-Step "Removing uninstall registry entry: $($entry.PSPath)"
    Remove-Item -LiteralPath $entry.PSPath -Recurse -Force -ErrorAction Stop
  } catch {
    $failures += "registry entry: $($entry.PSPath)"
    Write-Warning "Failed to remove uninstall registry entry $($entry.PSPath): $($_.Exception.Message)"
  }
}

if ($RemoveAppData) {
  foreach ($pathValue in $appDataPaths) {
    if (-not (Test-Path -LiteralPath $pathValue)) {
      continue
    }

    try {
      Write-Step "Removing AppData path: $pathValue"
      Remove-Item -LiteralPath $pathValue -Recurse -Force -ErrorAction Stop
    } catch {
      $failures += "AppData path: $pathValue"
      Write-Warning "Failed to remove AppData path $pathValue: $($_.Exception.Message)"
    }
  }
}

Write-Host ""
if ($failures.Count -eq 0) {
  Write-Step "Cleanup finished. You can rerun the Open Cowork installer now."
  if (-not $RemoveAppData) {
    Write-Step "If you also want to reset local settings, rerun this tool with -RemoveAppData."
  }
  exit 0
}

Write-Warning "Cleanup finished with errors. Manual review may still be required."
$failures | ForEach-Object { Write-Warning "Remaining item: $_" }
exit 2
