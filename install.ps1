# CodeWinOptimizer launcher
# Usage: irm "https://codewinoptimizer.com/win" | iex
# Mirror of winoptimizer-web/public/install.ps1 (served at codewinoptimizer.com/win).

$ErrorActionPreference = 'Stop'

$repo = 'oscarxdev/CodeWinOptimizer-App'
$dest = Join-Path $env:TEMP 'CodeWinOptimizer.exe'
$api  = "https://api.github.com/repos/$repo/releases/latest"

Write-Host ''
Write-Host '  CodeWinOptimizer' -ForegroundColor Cyan
Write-Host '  https://codewinoptimizer.com' -ForegroundColor DarkGray
Write-Host ''

function Get-ExpectedHash {
    param($Release, $AssetName)
    $perAsset = $Release.assets | Where-Object { $_.name -ieq "$AssetName.sha256" } | Select-Object -First 1
    if ($perAsset) {
        $raw = (Invoke-WebRequest -Uri $perAsset.browser_download_url -UseBasicParsing).Content
        return ($raw -split '\s+')[0].Trim().ToLowerInvariant()
    }
    $sums = $Release.assets | Where-Object { $_.name -ieq 'SHA256SUMS' -or $_.name -ieq 'sha256sums.txt' } | Select-Object -First 1
    if ($sums) {
        $raw = (Invoke-WebRequest -Uri $sums.browser_download_url -UseBasicParsing).Content
        foreach ($line in $raw -split "`n") {
            $parts = $line.Trim() -split '\s+'
            if ($parts.Length -ge 2 -and ($parts[-1].TrimStart('*')) -ieq $AssetName) {
                return $parts[0].ToLowerInvariant()
            }
        }
    }
    return $null
}

try {
    Write-Host '> Resolviendo ultima version...' -ForegroundColor DarkCyan
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $release = Invoke-RestMethod -Uri $api -Headers @{ 'User-Agent' = 'CodeWinOptimizer-Installer' }
    $asset = $release.assets | Where-Object { $_.name -like '*.exe' } | Select-Object -First 1
    if (-not $asset) { throw 'No se encontro un .exe en la ultima release.' }

    Write-Host "> Version: $($release.tag_name)" -ForegroundColor DarkCyan
    Write-Host "> Descargando $($asset.name)..." -ForegroundColor DarkCyan
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $dest -UseBasicParsing

    $expected = Get-ExpectedHash -Release $release -AssetName $asset.name
    if ($expected) {
        Write-Host '> Verificando SHA256...' -ForegroundColor DarkCyan
        $actual = (Get-FileHash -Path $dest -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actual -ne $expected) {
            Remove-Item $dest -Force -ErrorAction SilentlyContinue
            throw "Checksum mismatch. Expected $expected, got $actual. Aborting."
        }
        Write-Host '> Checksum OK' -ForegroundColor Green
    } else {
        Write-Host '> Checksum: no publicado (unverified)' -ForegroundColor DarkGray
    }

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
