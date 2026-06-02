# CodeWinOptimizer launcher
# Usage: irm "https://codewinoptimizer.com/win" | iex

$ErrorActionPreference = 'Stop'

$repo  = 'kirii86/CodeWinOptimizer-App'
$dest  = Join-Path $env:TEMP 'CodeWinOptimizer.exe'
$api   = "https://api.github.com/repos/$repo/releases/latest"

Write-Host ''
Write-Host '  CodeWinOptimizer' -ForegroundColor Cyan
Write-Host '  https://codewinoptimizer.com' -ForegroundColor DarkGray
Write-Host ''

try {
    Write-Host '> Resolviendo ultima version...' -ForegroundColor DarkCyan
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $release = Invoke-RestMethod -Uri $api -Headers @{ 'User-Agent' = 'CodeWinOptimizer-Installer' }
    $asset = $release.assets | Where-Object { $_.name -like '*.exe' } | Select-Object -First 1
    if (-not $asset) { throw 'No se encontro un .exe en la ultima release.' }

    Write-Host "> Version: $($release.tag_name)" -ForegroundColor DarkCyan
    Write-Host "> Descargando $($asset.name)..." -ForegroundColor DarkCyan
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $dest -UseBasicParsing

    Write-Host '> Lanzando (se solicitara elevacion)...' -ForegroundColor Green
    Start-Process -FilePath $dest -Verb RunAs
    Write-Host ''
}
catch {
    Write-Host ''
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host 'Si el problema persiste, descarga manualmente desde:' -ForegroundColor Yellow
    Write-Host "  https://github.com/$repo/releases/latest" -ForegroundColor Yellow
    Write-Host ''
    exit 1
}
