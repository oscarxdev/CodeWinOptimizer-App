# CodeWinOptimizer Build Script
# Reads version from app.go, builds with Wails, and renames the output

$version = (Select-String -Path "app.go" -Pattern 'appVersion\s*=\s*"([^"]+)"').Matches[0].Groups[1].Value

if (-not $version) {
    Write-Host "ERROR: Could not read appVersion from app.go" -ForegroundColor Red
    exit 1
}

Write-Host "Building CodeWinOptimizer v$version ..." -ForegroundColor Cyan

# Verify bundled assets are present (go:embed will fail otherwise)
$oosu10 = "assets\OOSU10.exe"
if (-not (Test-Path $oosu10)) {
    Write-Host "ERROR: $oosu10 not found." -ForegroundColor Red
    Write-Host "Download O&O ShutUp10++ portable from https://www.oo-software.com/en/shutup10" -ForegroundColor Yellow
    Write-Host "and place it at $oosu10 before building." -ForegroundColor Yellow
    exit 1
}

wails build
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Build failed" -ForegroundColor Red
    exit 1
}

$src = "build\bin\CodeWinOptimizer.exe"
$dst = "build\bin\CodeWinOptimizer-v$version.exe"

if (Test-Path $dst) { Remove-Item $dst -Force }
Copy-Item $src $dst

$hash = (Get-FileHash $dst -Algorithm SHA256).Hash.ToLower()
$size = [math]::Round((Get-Item $dst).Length / 1MB, 2)

Write-Host ""
Write-Host "Build complete!" -ForegroundColor Green
Write-Host "  File:   $dst" -ForegroundColor White
Write-Host "  Size:   $size MB" -ForegroundColor White
Write-Host "  SHA256: $hash" -ForegroundColor White
