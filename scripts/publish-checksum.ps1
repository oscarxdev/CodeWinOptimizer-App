# Generates SHA256 of build/bin/CodeWinOptimizer.exe and uploads it
# to the matching GitHub release as <asset>.sha256.
#
# Usage:
#   .\scripts\publish-checksum.ps1 -Tag v1.2.2
#   (assumes the exe asset is already attached to the release as CodeWinOptimizer-<Tag>.exe)

param(
    [Parameter(Mandatory = $true)] [string] $Tag,
    [string] $Exe       = 'build/bin/CodeWinOptimizer.exe',
    [string] $AssetName = "CodeWinOptimizer-$Tag.exe"
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $Exe)) {
    throw "Binary not found at $Exe. Build with 'wails build' first."
}

$hash = (Get-FileHash -Path $Exe -Algorithm SHA256).Hash.ToLowerInvariant()
$sumFile = "$AssetName.sha256"

"$hash  $AssetName" | Set-Content -Path $sumFile -Encoding ascii -NoNewline
Write-Host "Wrote $sumFile" -ForegroundColor Green
Write-Host "  $hash" -ForegroundColor DarkGray

gh release upload $Tag $sumFile --clobber
Write-Host "Uploaded to release $Tag" -ForegroundColor Green

Remove-Item $sumFile -Force
