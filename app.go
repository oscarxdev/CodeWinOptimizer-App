package main

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/shirou/gopsutil/v3/cpu"
	"github.com/shirou/gopsutil/v3/host"
	"github.com/shirou/gopsutil/v3/mem"
	"github.com/showwin/speedtest-go/speedtest"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

//go:embed tweaks.json
var tweaksJSON []byte

//go:embed assets/OOSU10.exe
var oosu10Bytes []byte

type Category struct {
	ID     string            `json:"id"`
	Icon   string            `json:"icon"`
	Name   map[string]string `json:"name"`
	Tweaks []Tweak           `json:"tweaks"`
}

type Tweak struct {
	ID          string              `json:"id"`
	Name        map[string]string   `json:"name"`
	Description map[string]string   `json:"description"`
	Benefit     map[string]string   `json:"benefit"`
	Impact      string              `json:"impact"`
	Commands    []string            `json:"commands"`
	Warnings    map[string][]string `json:"warnings"`
}

type App struct {
	ctx        context.Context
	categories []Category
	tweakMap   map[string]*Tweak
	tweaksErr  error
	opMu       sync.Mutex
	lastOp     time.Time
	cancelMu   sync.Mutex
	cancelFunc context.CancelFunc
}

const (
	appVersion    = "1.2.1"
	githubRepo    = "oscarcodedev/CodeWinOptimizer-App"
	minOpInterval = 2 * time.Second
)

func (a *App) startOp() context.Context {
	a.cancelMu.Lock()
	defer a.cancelMu.Unlock()
	if a.cancelFunc != nil {
		a.cancelFunc()
	}
	ctx, cancel := context.WithCancel(context.Background())
	a.cancelFunc = cancel
	return ctx
}

func (a *App) CancelOperation() {
	a.cancelMu.Lock()
	defer a.cancelMu.Unlock()
	if a.cancelFunc != nil {
		a.cancelFunc()
		a.cancelFunc = nil
		a.emitLog("[WARN] Operation cancelled by user")
	}
}

func (a *App) rateLimit(op string) error {
	a.opMu.Lock()
	defer a.opMu.Unlock()
	if time.Since(a.lastOp) < minOpInterval {
		return fmt.Errorf("rate limited: please wait before running %s again", op)
	}
	a.lastOp = time.Now()
	return nil
}

func NewApp() *App {
	a := &App{}
	a.tweaksErr = a.loadTweaks()
	return a
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	wailsRuntime.LogInfo(ctx, "CodeWinOptimizer started")
	if a.tweaksErr != nil {
		wailsRuntime.LogError(ctx, a.tweaksErr.Error())
		wailsRuntime.EventsEmit(ctx, "log", "[ERR] "+a.tweaksErr.Error()+" — tweaks will be unavailable")
	}
	a.ensureDefaultProfiles()
}

func (a *App) GetSystemLang() string {
	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-Command",
		`try{(Get-WinUserLanguageList)[0].LanguageTag.Substring(0,2)}catch{(Get-UICulture).TwoLetterISOLanguageName}`)
	cmd.SysProcAttr = getSysProcAttr()
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "en"
	}
	result := strings.TrimSpace(string(out))
	// Log for debugging
	if a.ctx != nil {
		wailsRuntime.LogInfo(a.ctx, fmt.Sprintf("Detected system language: %q", result))
	}
	if strings.HasPrefix(result, "es") {
		return "es"
	}
	return "en"
}

func (a *App) runPS(script string) string {
	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script)
	cmd.SysProcAttr = getSysProcAttr()
	output, err := cmd.CombinedOutput()
	out := strings.TrimSpace(string(output))
	if err != nil {
		if out != "" {
			a.emitLog(out)
		}
		a.emitLog(fmt.Sprintf("[ERR] %v", err))
	} else if out != "" {
		a.emitLog(out)
	} else {
		a.emitLog("[OK] Command completed")
	}
	return out
}

func (a *App) loadTweaks() error {
	if err := json.Unmarshal(tweaksJSON, &a.categories); err != nil {
		a.categories = []Category{}
		a.tweakMap = map[string]*Tweak{}
		return fmt.Errorf("failed to load tweaks.json: %w", err)
	}
	a.tweakMap = make(map[string]*Tweak, 256)
	for i := range a.categories {
		for j := range a.categories[i].Tweaks {
			a.tweakMap[a.categories[i].Tweaks[j].ID] = &a.categories[i].Tweaks[j]
		}
	}
	return nil
}

// sanitizeLog removes control characters and ANSI escape sequences from log output
// to prevent potential UI manipulation if log rendering ever changes from textContent.
func sanitizeLog(s string) string {
	// Strip ANSI escape sequences (colors, cursor movement, etc.)
	s = regexp.MustCompile(`\x1b\[[0-9;]*[a-zA-Z]`).ReplaceAllString(s, "")
	// Strip other control characters except newline, carriage return, tab
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		if r == '\n' || r == '\r' || r == '\t' || r >= 32 {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func (a *App) emitLog(msg string) {
	wailsRuntime.EventsEmit(a.ctx, "log", sanitizeLog(msg))
}

func (a *App) GetCategories() []Category {
	return a.categories
}

func (a *App) GetVersion() string {
	return appVersion
}

// RestartSystem schedules a Windows restart in 10 seconds.
// Returns an error string (empty on success).
func (a *App) RestartSystem() string {
	cmd := exec.Command("shutdown.exe", "/r", "/t", "10", "/c", "CodeWinOptimizer: restarting to apply tweaks")
	cmd.SysProcAttr = getSysProcAttr()
	if err := cmd.Run(); err != nil {
		return err.Error()
	}
	return ""
}

// CancelRestart cancels a pending restart scheduled by RestartSystem.
func (a *App) CancelRestart() string {
	cmd := exec.Command("shutdown.exe", "/a")
	cmd.SysProcAttr = getSysProcAttr()
	if err := cmd.Run(); err != nil {
		return err.Error()
	}
	return ""
}

func (a *App) CheckForUpdate() string {
	type assetInfo struct {
		Name               string `json:"name"`
		BrowserDownloadURL string `json:"browser_download_url"`
	}
	type releaseInfo struct {
		TagName string      `json:"tag_name"`
		HTMLURL string      `json:"html_url"`
		Assets  []assetInfo `json:"assets"`
	}
	type updateResult struct {
		Current     string `json:"current"`
		Latest      string `json:"latest"`
		UpdateURL   string `json:"updateUrl"`
		DownloadURL string `json:"downloadUrl"`
		HasUpdate   bool   `json:"hasUpdate"`
	}

	client := &http.Client{Timeout: 10 * time.Second}
	url := fmt.Sprintf("https://api.github.com/repos/%s/releases/latest", githubRepo)
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return "{}"
	}
	req.Header.Set("Accept", "application/vnd.github.v3+json")
	req.Header.Set("User-Agent", "CodeWinOptimizer/"+appVersion)

	resp, err := client.Do(req)
	if err != nil {
		return "{}"
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "{}"
	}

	var release releaseInfo
	if err := json.Unmarshal(body, &release); err != nil {
		return "{}"
	}

	latest := strings.TrimPrefix(release.TagName, "v")

	// Find .exe asset download URL
	var downloadURL string
	for _, asset := range release.Assets {
		if strings.HasSuffix(strings.ToLower(asset.Name), ".exe") {
			downloadURL = asset.BrowserDownloadURL
			break
		}
	}

	result := updateResult{
		Current:     appVersion,
		Latest:      latest,
		UpdateURL:   release.HTMLURL,
		DownloadURL: downloadURL,
		HasUpdate:   latest != appVersion && latest > appVersion,
	}

	b, _ := json.Marshal(result)
	return string(b)
}

func (a *App) DownloadUpdate(downloadURL string) string {
	if downloadURL == "" {
		return `{"ok":false,"error":"no download URL"}`
	}

	a.emitLog("[UPDATE] Downloading update...")

	// Get current executable path
	exePath, err := os.Executable()
	if err != nil {
		return fmt.Sprintf(`{"ok":false,"error":"%s"}`, err.Error())
	}
	exePath, _ = filepath.EvalSymlinks(exePath)

	// Download to temp file next to current exe
	tmpPath := exePath + ".update"
	client := &http.Client{Timeout: 5 * time.Minute}
	resp, err := client.Get(downloadURL)
	if err != nil {
		return fmt.Sprintf(`{"ok":false,"error":"download failed: %s"}`, err.Error())
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Sprintf(`{"ok":false,"error":"HTTP %d"}`, resp.StatusCode)
	}

	out, err := os.Create(tmpPath)
	if err != nil {
		return fmt.Sprintf(`{"ok":false,"error":"create temp: %s"}`, err.Error())
	}

	written, err := io.Copy(out, resp.Body)
	out.Close()
	if err != nil {
		os.Remove(tmpPath)
		return fmt.Sprintf(`{"ok":false,"error":"write failed: %s"}`, err.Error())
	}

	a.emitLog(fmt.Sprintf("[UPDATE] Downloaded %.2f MB", float64(written)/(1024*1024)))

	// Create PowerShell updater script
	scriptPath := filepath.Join(os.TempDir(), "cwo-updater.ps1")
	pid := os.Getpid()
	script := fmt.Sprintf(`
$ErrorActionPreference = 'Stop'
Start-Sleep -Milliseconds 500
$proc = Get-Process -Id %d -ErrorAction SilentlyContinue
if ($proc) {
    $proc.WaitForExit(10000) | Out-Null
}
Start-Sleep -Milliseconds 500
$old = '%s'
$tmp = '%s'
Remove-Item -Path $old -Force -ErrorAction SilentlyContinue
Move-Item -Path $tmp -Destination $old -Force
Start-Process -FilePath $old
Remove-Item -Path '%s' -Force -ErrorAction SilentlyContinue
`, pid, exePath, tmpPath, scriptPath)

	if err := os.WriteFile(scriptPath, []byte(script), 0644); err != nil {
		os.Remove(tmpPath)
		return fmt.Sprintf(`{"ok":false,"error":"script: %s"}`, err.Error())
	}

	// Launch updater and quit
	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive",
		"-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-File", scriptPath)
	cmd.SysProcAttr = getSysProcAttr()
	if err := cmd.Start(); err != nil {
		os.Remove(tmpPath)
		os.Remove(scriptPath)
		return fmt.Sprintf(`{"ok":false,"error":"launch updater: %s"}`, err.Error())
	}

	a.emitLog("[UPDATE] Restarting...")

	// Quit the app
	go func() {
		time.Sleep(300 * time.Millisecond)
		wailsRuntime.Quit(a.ctx)
	}()

	return `{"ok":true}`
}

func (a *App) CreateRestorePoint(description string) string {
	if err := a.rateLimit("CreateRestorePoint"); err != nil {
		return err.Error()
	}
	// Sanitize description for PowerShell double-quoted string
	desc := strings.NewReplacer(
		"`", "``",
		"$", "`$",
		"\"", "\"\"",
	).Replace(description)

	psCmd := fmt.Sprintf(`[Console]::OutputEncoding = [Text.Encoding]::UTF8
$desc = "%s"

# Enable System Restore if needed
try { Enable-ComputerRestore -Drive "$env:SystemDrive\" -ErrorAction SilentlyContinue } catch {}

# Bypass the 24h limit — use reg.exe (works on all Windows versions)
$freqPath = "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\SystemRestore"
$freqName = "SystemRestorePointCreationFrequency"

# Save old value
$oldVal = (reg query $freqPath /v $freqName 2>$null | Select-String "0x" | ForEach-Object { $_.Line.Split()[2] }) -replace "0x",""

# Set to 0
reg add "$freqPath" /v $freqName /t REG_DWORD /d 0 /f 2>$null | Out-Null

try {
    Checkpoint-Computer -Description $desc -RestorePointType MODIFY_SETTINGS -ErrorAction Stop

    $created = Get-ComputerRestorePoint | Where-Object { $_.Description -eq $desc } | Select-Object -First 1
    if ($created) {
        Write-Host "OK - Restore point created: $desc"
    } else {
        Write-Host "ERR: created but not found in list"
        exit 1
    }
} catch {
    Write-Host "ERR: $($_.Exception.Message)"
    exit 1
} finally {
    # Restore old frequency
    if ($oldVal) {
        reg add "$freqPath" /v $freqName /t REG_DWORD /d $oldVal /f 2>$null | Out-Null
    } else {
        reg delete "$freqPath" /v $freqName /f 2>$null | Out-Null
    }
}`, desc)

	a.emitLog("[CMD] Creating restore point")
	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", psCmd)
	cmd.SysProcAttr = getSysProcAttr()
	output, err := cmd.CombinedOutput()

	if err != nil {
		msg := fmt.Sprintf("[ERR] Restore point failed: %v", err)
		a.emitLog(msg)
		if len(output) > 0 {
			a.emitLog(strings.TrimSpace(string(output)))
		}
		return string(output)
	}

	a.emitLog("[OK] Restore point created")
	return strings.TrimSpace(string(output))
}

func (a *App) RunCommands(tweakIDs []string, lang string) string {
	if err := a.rateLimit("RunCommands"); err != nil {
		return err.Error()
	}
	opCtx := a.startOp()
	total := len(tweakIDs)

	for i, tweakID := range tweakIDs {
		if opCtx.Err() != nil {
			a.emitLog("[WARN] Operation cancelled")
			return "cancelled"
		}

		tweak := a.findTweak(tweakID)
		if tweak == nil || len(tweak.Commands) == 0 {
			continue
		}

		name := tweak.Name["en"]
		if lang == "es" {
			name = tweak.Name["es"]
		}

		a.emitLog(fmt.Sprintf("--- [%d/%d] %s ---", i+1, total, name))

		joinedCmd := "[Console]::OutputEncoding = [Text.Encoding]::UTF8; " + strings.Join(tweak.Commands, "; ")
		cmd := exec.CommandContext(opCtx, "powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", joinedCmd)
		cmd.SysProcAttr = getSysProcAttr()
		output, err := cmd.CombinedOutput()

		if err != nil {
			a.emitLog(fmt.Sprintf("[ERR] %v", err))
			a.emitLog(strings.TrimSpace(string(output)))
		} else {
			out := strings.TrimSpace(string(output))
			if out != "" {
				a.emitLog(out)
			} else {
				a.emitLog("[OK] Applied successfully")
			}
		}
	}

	a.emitLog("=== Complete ===")
	return ""
}

func ensureChoco(a *App) {
	check := exec.Command("powershell", "-NoProfile", "-Command",
		`if (Get-Command choco -ErrorAction SilentlyContinue) { exit 0 }; if (Get-Command "C:\ProgramData\chocolatey\bin\choco.exe" -ErrorAction SilentlyContinue) { exit 0 }; exit 1`)
	check.SysProcAttr = getSysProcAttr()
	if check.Run() == nil {
		return
	}
	a.emitLog("[CMD] Chocolatey not found — installing...")
	install := exec.Command("powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
		`Write-Host "Downloading Chocolatey..."; Set-ExecutionPolicy Bypass -Scope Process -Force; [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072; iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))`)
	install.SysProcAttr = getSysProcAttr()
	out, err := install.CombinedOutput()
	if err != nil {
		a.emitLog(fmt.Sprintf("[ERR] Chocolatey install failed: %v", err))
	}
	outStr := strings.TrimSpace(string(out))
	if outStr != "" {
		for _, line := range strings.Split(outStr, "\n") {
			line = strings.TrimSpace(line)
			if line != "" {
				a.emitLog(line)
			}
		}
	} else {
		a.emitLog("[OK] Chocolatey installed")
	}
	verify := exec.Command("powershell", "-NoProfile", "-Command",
		`if (Get-Command choco -ErrorAction SilentlyContinue) { exit 0 }; if (Get-Command "C:\ProgramData\chocolatey\bin\choco.exe" -ErrorAction SilentlyContinue) { exit 0 }; exit 1`)
	verify.SysProcAttr = getSysProcAttr()
	if verify.Run() != nil {
		a.emitLog("[ERR] Chocolatey installation could not be verified — choco command not found after install")
	}
}

func (a *App) InstallApps(ids []string, lang string, pkgMgr string) string {
	if err := a.rateLimit("InstallApps"); err != nil {
		return err.Error()
	}
	opCtx := a.startOp()
	total := len(ids)

	if pkgMgr == "choco" {
		ensureChoco(a)
	}

	for i, id := range ids {
		if opCtx.Err() != nil {
			a.emitLog("[WARN] Operation cancelled")
			return "cancelled"
		}

		if !safePackageID.MatchString(id) {
			a.emitLog(fmt.Sprintf("[ERR] Invalid package ID: %s", id))
			continue
		}
		a.emitLog(fmt.Sprintf("--- [%d/%d] Installing: %s ---", i+1, total, id))

		var psCmd string
		if pkgMgr == "choco" {
			psCmd = fmt.Sprintf(`[Console]::OutputEncoding = [Text.Encoding]::UTF8
$choco = Get-Command choco -ErrorAction SilentlyContinue
if (-not $choco) { $choco = Get-Command "C:\ProgramData\chocolatey\bin\choco.exe" -ErrorAction SilentlyContinue }
if (-not $choco) { Write-Host "[ERR] Chocolatey not available — restart app and try again"; exit 1 }
& $choco install %s -y --no-progress`, id)
		} else {
			psCmd = fmt.Sprintf("[Console]::OutputEncoding = [Text.Encoding]::UTF8; winget install --id %s --silent --accept-package-agreements --accept-source-agreements", id)
		}

		cmd := exec.CommandContext(opCtx, "powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", psCmd)
		cmd.SysProcAttr = getSysProcAttr()
		output, err := cmd.CombinedOutput()

		if err != nil {
			a.emitLog(fmt.Sprintf("[ERR] %v", err))
			a.emitLog(strings.TrimSpace(string(output)))
		} else {
			out := strings.TrimSpace(string(output))
			if out != "" {
				a.emitLog(out)
			} else {
				a.emitLog("[OK] Installed successfully")
			}
		}
	}

	a.emitLog("=== Complete ===")
	return ""
}

func (a *App) UninstallApp(id string, pkgMgr string) string {
	if !safePackageID.MatchString(id) {
		a.emitLog(fmt.Sprintf("[ERR] Invalid package ID: %s", id))
		return "[ERR] Invalid package ID"
	}
	var psCmd string
	if pkgMgr == "choco" {
		ensureChoco(a)
		psCmd = fmt.Sprintf(`[Console]::OutputEncoding = [Text.Encoding]::UTF8
$choco = Get-Command choco -ErrorAction SilentlyContinue
if (-not $choco) { $choco = Get-Command "C:\ProgramData\chocolatey\bin\choco.exe" -ErrorAction SilentlyContinue }
if (-not $choco) { Write-Host "[ERR] Chocolatey not available — restart app and try again"; exit 1 }
& $choco uninstall %s -y --no-progress`, id)
	} else {
		psCmd = fmt.Sprintf("[Console]::OutputEncoding = [Text.Encoding]::UTF8; winget uninstall --id %s --silent --accept-source-agreements", id)
	}

	a.emitLog(fmt.Sprintf("[CMD] Uninstalling: %s via %s", id, pkgMgr))
	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", psCmd)
	cmd.SysProcAttr = getSysProcAttr()
	output, err := cmd.CombinedOutput()

	if err != nil {
		a.emitLog(fmt.Sprintf("[ERR] %v", err))
		a.emitLog(strings.TrimSpace(string(output)))
	} else {
		out := strings.TrimSpace(string(output))
		if out != "" {
			a.emitLog(out)
		} else {
			a.emitLog("[OK] Uninstalled successfully")
		}
	}
	return ""
}

func (a *App) OpenURL(url string) {
	if !strings.HasPrefix(url, "https://") && !strings.HasPrefix(url, "http://") {
		a.emitLog(fmt.Sprintf("[ERR] Blocked URL with unsafe scheme: %s", url))
		return
	}
	wailsRuntime.BrowserOpenURL(a.ctx, url)
}

// LaunchShutUp10 extracts the embedded O&O ShutUp10++ portable binary
// (cached under %LOCALAPPDATA%\CodeWinOptimizer\OOSU10.exe) and launches it.
// Returns "" on success or an error string.
func (a *App) LaunchShutUp10() string {
	cacheDir := os.Getenv("LOCALAPPDATA")
	if cacheDir == "" {
		home, _ := os.UserHomeDir()
		cacheDir = filepath.Join(home, "AppData", "Local")
	}
	cacheDir = filepath.Join(cacheDir, "CodeWinOptimizer")
	if err := os.MkdirAll(cacheDir, 0755); err != nil {
		a.emitLog(fmt.Sprintf("[ERR] Cannot create cache dir: %s", err.Error()))
		return err.Error()
	}
	target := filepath.Join(cacheDir, "OOSU10.exe")

	// Extract only if missing or size differs from embedded
	needsExtract := true
	if st, err := os.Stat(target); err == nil {
		if st.Size() == int64(len(oosu10Bytes)) {
			needsExtract = false
		}
	}
	if needsExtract {
		a.emitLog(fmt.Sprintf("[INFO] Extracting bundled ShutUp10++ (%d MB) to cache...", len(oosu10Bytes)/(1024*1024)))
		if err := os.WriteFile(target, oosu10Bytes, 0755); err != nil {
			a.emitLog(fmt.Sprintf("[ERR] Failed to write ShutUp10++: %s", err.Error()))
			return err.Error()
		}
		a.emitLog(fmt.Sprintf("[OK] Cached at %s", target))
	}

	a.emitLog(fmt.Sprintf("[OK] Launching O&O ShutUp10++: %s", target))
	cmd := exec.Command(target)
	cmd.SysProcAttr = getSysProcAttr()
	if err := cmd.Start(); err != nil {
		a.emitLog(fmt.Sprintf("[ERR] Failed to launch ShutUp10++: %s", err.Error()))
		return err.Error()
	}
	return ""
}

func openExplorerAt(dir string) {
	os.MkdirAll(dir, 0755)
	cmd := exec.Command("explorer", dir)
	if err := cmd.Start(); err == nil {
		cmd.Process.Release()
	}
}

func (a *App) OpenFolder() {
	openExplorerAt(filepath.Join(os.Getenv("USERPROFILE"), "CodeWinOptimizer", "registry-backups"))
}

func (a *App) OpenDriverFolder() {
	openExplorerAt(filepath.Join(os.Getenv("USERPROFILE"), "CodeWinOptimizer", "driver-backups"))
}

var featureCommands = map[string]string{
	"netfx":          `dism /online /enable-feature /featurename:NetFx3 /all /quiet /norestart; Write-Host "[OK] .NET Framework enabled"`,
	"hyperv":         `dism /online /enable-feature /featurename:Microsoft-Hyper-V-All /all /quiet /norestart; Write-Host "[OK] Hyper-V enabled"`,
	"f8disable":      `bcdedit /set {default} bootmenupolicy standard; Write-Host "[OK] F8 legacy disabled"`,
	"f8enable":       `bcdedit /set {default} bootmenupolicy legacy; Write-Host "[OK] F8 legacy enabled"`,
	"legacymedia":    `dism /online /enable-feature /featurename:WindowsMediaPlayer /all /quiet /norestart; dism /online /enable-feature /featurename:DirectPlay /all /quiet /norestart; Write-Host "[OK] Legacy media enabled"`,
	"nfs":            `dism /online /enable-feature /featurename:ServicesForNFS-ClientOnly /all /quiet /norestart; dism /online /enable-feature /featurename:ClientForNFS-Infrastructure /all /quiet /norestart; Write-Host "[OK] NFS enabled"`,
	"regbackupsched": `$dir = "$env:SystemDrive\RegistryBackup"; New-Item -ItemType Directory -Path $dir -Force -ErrorAction SilentlyContinue | Out-Null; $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-Command reg export HKLM '$dir\HKLM_$(Get-Date -Format yyyyMMdd_HHmmss).reg' /y"; $trigger = New-ScheduledTaskTrigger -Daily -At 00:30; Register-ScheduledTask -TaskName "CodeWinOptimizer_RegistryBackup" -Action $action -Trigger $trigger -Force -ErrorAction Stop | Out-Null; Write-Host "[OK] Daily registry backup scheduled at 00:30"`,
	"sandbox":        `dism /online /enable-feature /featurename:Containers-DisposableClientVM /all /quiet /norestart; Write-Host "[OK] Windows Sandbox enabled"`,
	"wsl":            `dism /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /quiet /norestart; dism /online /enable-feature /featurename:VirtualMachinePlatform /all /quiet /norestart; Write-Host "[OK] WSL enabled"`,
}

var fixCommands = map[string]string{
	"autologin": `$regPath = "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon"; $user = (Get-CimInstance -Class Win32_ComputerSystem | Select-Object -ExpandProperty Username); Set-ItemProperty -Path $regPath -Name "AutoAdminLogon" -Value "1" -Force; Set-ItemProperty -Path $regPath -Name "DefaultUserName" -Value $user -Force; Set-ItemProperty -Path $regPath -Name "DefaultPassword" -Value "" -Force; Write-Host "Autologin enabled for $user"`,
	"netreset":  `netsh int ip reset; netsh winsock reset; ipconfig /flushdns; Write-Host "Network stack reset complete"`,
	"ntp":       `w32tm /config /syncfromflags:manual /manualpeerlist:"time.windows.com" /reliable:YES /update; net stop w32time; net start w32time; w32tm /resync /force; Write-Host "NTP sync enabled"`,
	"sfc":       `DISM /Online /Cleanup-Image /RestoreHealth; sfc /scannow; Write-Host "System scan complete"`,
	"wureset":   `net stop wuauserv; net stop cryptSvc; net stop bits; net stop msiserver; Remove-Item -Recurse -Force "$env:windir\SoftwareDistribution" -ErrorAction SilentlyContinue; net start wuauserv; net start cryptSvc; net start bits; net start msiserver; Write-Host "Windows Update cache reset"`,
	"wingetre":  `Write-Host "Reinstalling WinGet..."; try{Add-AppxPackage -RegisterByFamilyName -MainPackage Microsoft.DesktopAppInstaller_8wekyb3d8bbwe -ErrorAction Stop; Write-Host "WinGet reinstalled successfully"}catch{Write-Host "ERR: WinGet reinstall failed -- $($_.Exception.Message)"}`,
}

func (a *App) RunFeature(id string) string {
	script, ok := featureCommands[id]
	if !ok {
		a.emitLog(fmt.Sprintf("[ERR] Unknown feature: %s", id))
		return "[ERR] Unknown feature"
	}
	return a.runPS(script)
}

func (a *App) RunFix(id string) string {
	script, ok := fixCommands[id]
	if !ok {
		a.emitLog(fmt.Sprintf("[ERR] Unknown fix: %s", id))
		return "[ERR] Unknown fix"
	}
	return a.runPS(script)
}

func (a *App) Quit() {
	wailsRuntime.Quit(a.ctx)
}

func (a *App) BackupRegistry() string {
	if err := a.rateLimit("BackupRegistry"); err != nil {
		return err.Error()
	}
	backupDir := fmt.Sprintf("%s\\CodeWinOptimizer\\registry-backups", os.Getenv("USERPROFILE"))
	ts := time.Now().Format("2006-01-02_150405")
	dir := fmt.Sprintf("%s\\%s", backupDir, ts)

	psCmd := fmt.Sprintf(`[Console]::OutputEncoding = [Text.Encoding]::UTF8
$dir = "%s"
New-Item -ItemType Directory -Path $dir -Force | Out-Null
$hives = @("HKLM","HKCU","HKCR","HKU","HKCC")
$total = $hives.Count; $ok = 0
foreach ($h in $hives) {
    try {
        $out = Join-Path $dir "$h.reg"
        reg export $h $out /y 2>$null
        if ($LASTEXITCODE -eq 0) { $ok++; Write-Host "OK: $h exported" }
        else { Write-Host "WARN: $h had warnings (partial export)" }
    } catch {
        Write-Host "ERR: $h - $($_.Exception.Message)"
    }
}
Write-Host "--- Full registry backup: $ok/$total hives -> $dir ---"
# Open folder in Explorer
Start-Process explorer.exe -ArgumentList $dir`, dir)

	a.emitLog("[CMD] Backing up full registry (5 hives: HKLM, HKCU, HKCR, HKU, HKCC)...")
	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", psCmd)
	cmd.SysProcAttr = getSysProcAttr()
	output, err := cmd.CombinedOutput()

	if err != nil {
		a.emitLog(fmt.Sprintf("[ERR] Registry backup failed: %v", err))
	} else {
		a.emitLog(fmt.Sprintf("[OK] Full registry backup saved to: %s", dir))
	}

	return strings.TrimSpace(string(output))
}

func (a *App) findTweak(id string) *Tweak {
	return a.tweakMap[id]
}

func (a *App) CheckAdmin() bool {
	cmd := exec.Command("powershell", "-NoProfile", "-Command",
		"(New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)")
	output, err := cmd.Output()
	if err != nil {
		return false
	}
	return strings.TrimSpace(string(output)) == "True"
}

func (a *App) GetInstalledPackages() string {
	psCmd := `$out = winget list --accept-source-agreements 2>$null | Out-String -Width 4096; $lines = $out -split '\r?\n' | Where-Object { $_ -match '\S' }; $collect = $false; $ids = @(); foreach ($l in $lines) { if ($l -match '^-{2,}') { $collect = $true; continue }; if (-not $collect) { continue }; $p = @($l -split '\s{2,}'); if ($p.Count -ge 2 -and $p[1] -match '\.') { $ids += $p[1].Trim() } }; $ids | ConvertTo-Json -Compress; if (-not $?) { '[]' }`
	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", psCmd)
	cmd.SysProcAttr = getSysProcAttr()
	output, err := cmd.Output()
	if err != nil {
		return "[]"
	}
	result := strings.TrimSpace(string(output))
	if result == "" || result == "null" {
		return "[]"
	}
	return result
}

func (a *App) GetSystemInfo() string {
	// --- CPU % (gopsutil — native, reliable) ---
	cpuPercent := 0.0
	if percents, err := cpu.Percent(0, false); err == nil && len(percents) > 0 {
		cpuPercent = math.Round(percents[0]*10) / 10
	}

	// CPU info via CIM (one-shot, no polling needed)
	cpuInfo, _ := cpu.Info()
	cpuName := ""
	cpuCores := 0
	cpuThreads := 0
	if len(cpuInfo) > 0 {
		cpuName = cpuInfo[0].ModelName
		cpuCores = int(cpuInfo[0].Cores)
	}
	// Logical (thread) count
	if n, err := cpu.Counts(true); err == nil {
		cpuThreads = n
	}

	// --- RAM (gopsutil) ---
	ramTotal := 0.0
	ramFree := 0.0
	ramUsed := 0.0
	ramPct := 0.0
	if vmem, err := mem.VirtualMemory(); err == nil {
		ramTotal = math.Round(float64(vmem.Total)/bytesPerGiB*10) / 10
		ramFree = math.Round(float64(vmem.Available)/bytesPerGiB*10) / 10
		ramUsed = math.Round(float64(vmem.Used)/bytesPerGiB*10) / 10
		ramPct = math.Round(vmem.UsedPercent*10) / 10
	}

	// --- Uptime (gopsutil) ---
	uptimeStr := ""
	if up, err := host.Uptime(); err == nil {
		uptimeSec := uint64(up)
		days := uptimeSec / secondsPerDay
		hours := (uptimeSec % secondsPerDay) / secondsPerHour
		minutes := (uptimeSec % secondsPerHour) / secondsPerMinute
		uptimeStr = fmt.Sprintf("%dd %dh %dm", days, hours, minutes)
	}

	// --- GPU, Disks, Temps via PowerShell ---
	psCmd := `[Console]::OutputEncoding = [Text.Encoding]::UTF8

$gpuList = @()
$gpus = Get-CimInstance Win32_VideoController
foreach ($g in $gpus) {
	$name = $g.Name; if (-not $name) { $name = 'Unknown' }
	if ($name.Length -gt 50) { $name = $name.Substring(0,47)+'...' }
	$vram = 0
	if ($g.AdapterRAM -and $g.AdapterRAM -gt 0) { $vram = [math]::Round($g.AdapterRAM/1GB, 1) }
	$gpuList += [PSCustomObject]@{ name = $name; driver = $g.DriverVersion; ramGB = $vram; usage = 0; temp = 0 }
}

$nvidiaIdx = -1
for ($i=0; $i -lt $gpuList.Count; $i++) {
	if ($gpuList[$i].name -match '(?i)nvidia|geforce|rtx|quadro|tesla') { $nvidiaIdx = $i; break }
}
if ($nvidiaIdx -ge 0) {
	try {
		$smi = & nvidia-smi --query-gpu=utilization.gpu,temperature.gpu,memory.total --format=csv,noheader,nounits 2>$null
		if ($smi) {
			$parts = $smi.Trim() -split ',\s*'
			if ($parts.Count -ge 2) {
				$gpuList[$nvidiaIdx].usage = [double]$parts[0]
				$gpuList[$nvidiaIdx].temp = [double]$parts[1]
				if ($parts.Count -ge 3 -and [double]$parts[2] -gt 0) {
					$gpuList[$nvidiaIdx].ramGB = [math]::Round([double]$parts[2]/1024, 1)
				}
			}
		}
	} catch {}
}

$diskList = @()
$disks = Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3"
foreach ($d in $disks) {
	$t = [math]::Round($d.Size/1GB, 1)
	$f = [math]::Round($d.FreeSpace/1GB, 1)
	$u = [math]::Round($t - $f, 1)
	$p = if($t -gt 0){[math]::Round(($t-$f)/$t*100,1)}else{0}
	$diskList += [PSCustomObject]@{ drive = $d.DeviceID; total = $t; free = $f; used = $u; pct = $p }
}

$tempList = @()
if ($nvidiaIdx -ge 0 -and $gpuList[$nvidiaIdx].temp -gt 0) {
	$tempList += [PSCustomObject]@{ name = 'GPU'; temp = $gpuList[$nvidiaIdx].temp }
}

# CPU temp: try multiple sources, prefer the one that returns a sensible value.
# AMD Ryzen rarely exposes via MSAcpi; LibreHardwareMonitor/OpenHardwareMonitor
# expose it if running. Perf counter sometimes works on AMD.
$cpuTemp = -1
# 1. OpenHardwareMonitor / LibreHardwareMonitor WMI namespaces (if their service is running)
foreach ($ns in @('root/OpenHardwareMonitor', 'root/LibreHardwareMonitor')) {
	if ($cpuTemp -ge 0) { break }
	try {
		$sensors = Get-CimInstance -Namespace $ns -ClassName Sensor -ErrorAction Stop
		$cpuSensor = $sensors | Where-Object { $_.SensorType -eq 'Temperature' -and ($_.Name -match 'CPU Package|CPU Core|Core \(Tctl|Tdie' -or $_.Parent -match 'cpu') } | Select-Object -First 1
		if ($cpuSensor -and $cpuSensor.Value -gt 0 -and $cpuSensor.Value -le 125) {
			$cpuTemp = [math]::Round($cpuSensor.Value, 1)
		}
	} catch {}
}
# 2. Perf counter (works on some AMD systems)
if ($cpuTemp -lt 0) {
	try {
		$counters = (Get-Counter '\Thermal Zone Information(*)\High Precision Temperature' -ErrorAction Stop).CounterSamples
		foreach ($c in $counters) {
			$t = [math]::Round(($c.CookedValue / 10.0) - 273.15, 1)
			if ($t -gt 20 -and $t -lt 125 -and ($cpuTemp -lt 0 -or $t -gt $cpuTemp)) { $cpuTemp = $t }
		}
	} catch {}
}
# 3. MSAcpi thermal zones (Intel-friendly fallback)
try {
	$wmiTemps = Get-CimInstance -Namespace root/wmi MSAcpi_ThermalZoneTemperature -ErrorAction Stop
	foreach ($tz in $wmiTemps) {
		$t = [math]::Round(($tz.CurrentTemperature - 2732) / 10.0, 1)
		if ($t -ge 20 -and $t -le 125 -and ($cpuTemp -lt 0 -or $t -gt $cpuTemp)) { $cpuTemp = $t }
	}
} catch {}
if ($cpuTemp -gt 0) {
	$tempList += [PSCustomObject]@{ name = 'CPU'; temp = $cpuTemp }
}

[PSCustomObject]@{
	gpus = @($gpuList);
	disks = @($diskList);
	temps = @($tempList);
} | ConvertTo-Json -Compress -Depth 4
`
	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", psCmd)
	cmd.SysProcAttr = getSysProcAttr()
	psOutput, psErr := cmd.Output()

	// Build final JSON
	psJSON := `{"gpus":[],"disks":[],"temps":[]}`
	if psErr == nil && len(psOutput) > 0 {
		psJSON = strings.TrimSpace(string(psOutput))
	}

	// Parse PS output and inject Go-computed values
	type CPUOut struct {
		Pct     float64 `json:"pct"`
		Name    string  `json:"name"`
		Cores   int     `json:"cores"`
		Threads int     `json:"threads"`
	}
	type RAMOut struct {
		TotalGB float64 `json:"totalGB"`
		FreeGB  float64 `json:"freeGB"`
		UsedGB  float64 `json:"usedGB"`
		Pct     float64 `json:"pct"`
	}
	type FullOut struct {
		CPU    CPUOut `json:"cpu"`
		RAM    RAMOut `json:"ram"`
		Uptime string `json:"uptime"`
	}

	fo := FullOut{
		CPU:    CPUOut{Pct: cpuPercent, Name: cpuName, Cores: cpuCores, Threads: cpuThreads},
		RAM:    RAMOut{TotalGB: ramTotal, FreeGB: ramFree, UsedGB: ramUsed, Pct: ramPct},
		Uptime: uptimeStr,
	}

	merged := map[string]interface{}{
		"cpu":    fo.CPU,
		"ram":    fo.RAM,
		"uptime": fo.Uptime,
	}
	var psData map[string]interface{}
	if err := json.Unmarshal([]byte(psJSON), &psData); err == nil {
		for k, v := range psData {
			merged[k] = v
		}
	}
	result, _ := json.Marshal(merged)
	return string(result)
}

func (a *App) GetHealthScore() string {
	type HealthResult struct {
		Score       int               `json:"score"`
		Grade       string            `json:"grade"`
		Breakdown   map[string]int    `json:"breakdown"`
		Tips        []string          `json:"tips"`
	}

	score := 100
	breakdown := map[string]int{}
	var tips []string

	// RAM usage (30 points max) — finer granularity so 100/A+ is genuinely rare
	ramScore := 30
	if vmem, err := mem.VirtualMemory(); err == nil {
		pct := vmem.UsedPercent
		switch {
		case pct > 90:
			ramScore = 5
			tips = append(tips, "RAM usage critical (>90%)")
		case pct > 80:
			ramScore = 15
			tips = append(tips, "RAM usage high (>80%)")
		case pct > 70:
			ramScore = 22
		case pct > 50:
			ramScore = 27
		case pct > 30:
			ramScore = 29
		}
	} else {
		ramScore = 15
	}
	breakdown["ram"] = ramScore

	// CPU usage (20 points max)
	cpuScore := 20
	if percents, err := cpu.Percent(time.Second, false); err == nil && len(percents) > 0 {
		pct := percents[0]
		switch {
		case pct > 90:
			cpuScore = 2
			tips = append(tips, "CPU usage very high (>90%)")
		case pct > 70:
			cpuScore = 8
			tips = append(tips, "CPU usage elevated (>70%)")
		case pct > 50:
			cpuScore = 14
		case pct > 25:
			cpuScore = 18
		}
	} else {
		cpuScore = 10
	}
	breakdown["cpu"] = cpuScore

	// Disk (30 points max) — checks BOTH free GB and used % on system drive
	diskScore := 30
	psCmd := `$d = Get-PSDrive C -ErrorAction SilentlyContinue; if ($d) { $total = $d.Used + $d.Free; $pct = if ($total -gt 0) { [math]::Round(($d.Used / $total) * 100, 1) } else { 0 }; ('{0},{1}' -f [math]::Round($d.Free / 1GB, 1), $pct) } else { '-1,0' }`
	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-Command", psCmd)
	cmd.SysProcAttr = getSysProcAttr()
	if out, err := cmd.CombinedOutput(); err == nil {
		s := strings.TrimSpace(string(out))
		parts := strings.SplitN(s, ",", 2)
		if len(parts) == 2 {
			var freeGB, usedPct float64
			fmt.Sscanf(parts[0], "%f", &freeGB)
			fmt.Sscanf(parts[1], "%f", &usedPct)
			// Penalize based on free GB
			gbPenalty := 0
			if freeGB < 5 {
				gbPenalty = 28
				tips = append(tips, "System drive critically low (<5 GB free)")
			} else if freeGB < 15 {
				gbPenalty = 18
				tips = append(tips, "System drive low on space (<15 GB free)")
			} else if freeGB < 30 {
				gbPenalty = 10
				tips = append(tips, "Consider freeing disk space (<30 GB free)")
			}
			// Penalize based on % used (independent signal: a 2TB drive at 90% has plenty of GB but is still concerning)
			pctPenalty := 0
			switch {
			case usedPct > 90:
				pctPenalty = 18
				tips = append(tips, fmt.Sprintf("System drive %g%% full — consider cleanup", usedPct))
			case usedPct > 80:
				pctPenalty = 10
				tips = append(tips, fmt.Sprintf("System drive %g%% full", usedPct))
			case usedPct > 65:
				pctPenalty = 4
			case usedPct > 50:
				pctPenalty = 2
			}
			// Apply the larger of the two penalties (don't double-penalize same issue)
			penalty := gbPenalty
			if pctPenalty > penalty {
				penalty = pctPenalty
			}
			diskScore = 30 - penalty
			if diskScore < 0 {
				diskScore = 0
			}
		}
	} else {
		diskScore = 15
	}
	breakdown["disk"] = diskScore

	// Temperature (10 points max) — takes worst of CPU thermal zone + GPU temp
	tempScore := 10
	maxTemp := 0.0
	tempLabel := ""
	// CPU thermal zone
	psTemp := `try { $t = (Get-CimInstance -Namespace root/wmi MSAcpi_ThermalZoneTemperature -ErrorAction Stop | Select-Object -First 1).CurrentTemperature; [math]::Round(($t - 2732) / 10.0, 1) } catch { -1 }`
	cmd2 := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-Command", psTemp)
	cmd2.SysProcAttr = getSysProcAttr()
	if out, err := cmd2.CombinedOutput(); err == nil {
		var t float64
		if _, err := fmt.Sscanf(strings.TrimSpace(string(out)), "%f", &t); err == nil && t > 0 && t > maxTemp {
			maxTemp = t
			tempLabel = "CPU"
		}
	}
	// GPU temp (nvidia-smi)
	psGpu := `try { $out = & nvidia-smi --query-gpu=temperature.gpu --format=csv,noheader,nounits 2>$null; if ($LASTEXITCODE -eq 0 -and $out) { ($out -split [char]10 | Where-Object { $_.Trim() } | ForEach-Object { [int]$_.Trim() } | Measure-Object -Maximum).Maximum } else { -1 } } catch { -1 }`
	cmd3 := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-Command", psGpu)
	cmd3.SysProcAttr = getSysProcAttr()
	if out, err := cmd3.CombinedOutput(); err == nil {
		var t float64
		if _, err := fmt.Sscanf(strings.TrimSpace(string(out)), "%f", &t); err == nil && t > 0 && t > maxTemp {
			maxTemp = t
			tempLabel = "GPU"
		}
	}
	if maxTemp > 0 {
		switch {
		case maxTemp > 85:
			tempScore = 0
			tips = append(tips, fmt.Sprintf("%s temperature critical (>85°C)", tempLabel))
		case maxTemp > 75:
			tempScore = 4
			tips = append(tips, fmt.Sprintf("%s temperature high (>75°C)", tempLabel))
		case maxTemp > 65:
			tempScore = 7
		case maxTemp > 55:
			tempScore = 9
		}
	}
	breakdown["temp"] = tempScore

	// Uptime (10 points max)
	uptimeScore := 10
	if up, err := host.Uptime(); err == nil {
		days := up / secondsPerDay
		if days > 14 {
			uptimeScore = 3
			tips = append(tips, "System hasn't rebooted in 14+ days")
		} else if days > 7 {
			uptimeScore = 6
			tips = append(tips, "Consider rebooting (7+ days uptime)")
		}
	}
	breakdown["uptime"] = uptimeScore

	score = ramScore + cpuScore + diskScore + tempScore + uptimeScore

	grade := "A+"
	switch {
	case score >= 90:
		grade = "A+"
	case score >= 80:
		grade = "A"
	case score >= 70:
		grade = "B"
	case score >= 55:
		grade = "C"
	case score >= 40:
		grade = "D"
	default:
		grade = "F"
	}

	result := HealthResult{
		Score:     score,
		Grade:     grade,
		Breakdown: breakdown,
		Tips:      tips,
	}
	b, _ := json.Marshal(result)
	return string(b)
}

// Helper PS function injected into every cleanup script.
// Sums file sizes safely (handles empty dirs) and removes them.
const cleanupHelper = `function _CleanDir($path,[switch]$Recurse){if(-not(Test-Path -LiteralPath $path)){return 0};$gci=@{Path=$path;Force=$true;File=$true;ErrorAction='SilentlyContinue'};if($Recurse){$gci.Recurse=$true};$files=@(Get-ChildItem @gci);$bytes=0;if($files.Count -gt 0){$bytes=($files|Measure-Object -Property Length -Sum).Sum};Remove-Item -Recurse -Force -LiteralPath (Join-Path $path '*') -ErrorAction SilentlyContinue;return [int64]$bytes};`

var cleanupScripts = map[string]string{
	"temp":       cleanupHelper + "try{$c=0;$c+=_CleanDir $env:TEMP -Recurse;$c+=_CleanDir \"$env:WINDIR\\Temp\" -Recurse;Write-Host (\"[OK] \"+[math]::Round($c/1MB,1)+\" MB cleaned\")}catch{Write-Host (\"[ERR] \"+$_.Exception.Message)}",
	"recycle":    "try{$drives=@(Get-PSDrive -PSProvider FileSystem|Where-Object{$_.Name.Length -eq 1}|Select-Object -ExpandProperty Name);$cleared=0;$errors=@();foreach($d in $drives){try{Clear-RecycleBin -DriveLetter $d -Force -ErrorAction Stop;$cleared++}catch{if($_.Exception.Message -notmatch 'empty|vac' -and $_.Exception.HResult -ne -2147418113){$errors+=$d+': '+$_.Exception.Message}}};if($errors.Count -gt 0){Write-Host (\"[WARN] Some drives skipped: \"+($errors -join '; '))};Write-Host (\"[OK] Recycle bin processed on \"+$cleared+\" drive(s)\")}catch{Write-Host (\"[ERR] \"+$_.Exception.Message)}",
	"prefetch":   cleanupHelper + "try{$c=_CleanDir \"$env:WINDIR\\Prefetch\";Write-Host (\"[OK] \"+[math]::Round($c/1MB,1)+\" MB cleaned\")}catch{Write-Host (\"[ERR] \"+$_.Exception.Message)}",
	"winupdate":  cleanupHelper + "try{Stop-Service -Name wuauserv,bits -Force -ErrorAction SilentlyContinue;$c=_CleanDir \"$env:WINDIR\\SoftwareDistribution\\Download\" -Recurse;Start-Service -Name wuauserv,bits -ErrorAction SilentlyContinue;Write-Host (\"[OK] \"+[math]::Round($c/1MB,1)+\" MB cleaned\")}catch{Write-Host (\"[ERR] \"+$_.Exception.Message)}",
	"thumbnails": "try{$c=0;$u=$env:LOCALAPPDATA;if($u){$d=\"$u\\Microsoft\\Windows\\Explorer\";if(Test-Path -LiteralPath $d){$files=@(Get-ChildItem -Force -Path \"$d\\thumbcache_*\" -ErrorAction SilentlyContinue);if($files.Count -gt 0){$c=($files|Measure-Object -Property Length -Sum).Sum};Remove-Item -Force -Path \"$d\\thumbcache_*\" -ErrorAction SilentlyContinue}};Write-Host (\"[OK] \"+[math]::Round($c/1MB,1)+\" MB cleaned\")}catch{Write-Host (\"[ERR] \"+$_.Exception.Message)}",
	"dnscache":   "try{ipconfig /flushdns 2>$null|Out-Null;Write-Host \"[OK] DNS cache flushed\"}catch{Write-Host (\"[ERR] \"+$_.Exception.Message)}",
	"memorydump": cleanupHelper + "try{$c=0;$dmp=\"$env:WINDIR\\MEMORY.DMP\";if(Test-Path -LiteralPath $dmp){$c+=(Get-Item -LiteralPath $dmp).Length;Remove-Item -Force -LiteralPath $dmp -ErrorAction SilentlyContinue};$c+=_CleanDir \"$env:WINDIR\\Minidump\";Write-Host (\"[OK] \"+[math]::Round($c/1MB,1)+\" MB cleaned\")}catch{Write-Host (\"[ERR] \"+$_.Exception.Message)}",
}
var cleanupNamesES = map[string]string{"temp": "Archivos temporales", "recycle": "Papelera", "prefetch": "Archivos Prefetch", "winupdate": "Cache Windows Update", "thumbnails": "Cache miniaturas", "dnscache": "Cache DNS", "memorydump": "Volcados de memoria"}

func (a *App) CleanupRun(tasks []string, lang string) string {
	if err := a.rateLimit("CleanupRun"); err != nil {
		return err.Error()
	}
	for _, id := range tasks {
		ps, ok := cleanupScripts[id]
		if !ok {
			continue
		}
		name := id
		if lang == "es" {
			if n, ok := cleanupNamesES[id]; ok {
				name = n
			}
		}
		a.emitLog(fmt.Sprintf("--- %s ---", name))
		cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", "[Console]::OutputEncoding = [Text.Encoding]::UTF8; "+ps)
		cmd.SysProcAttr = getSysProcAttr()
		out, err := cmd.CombinedOutput()
		if err != nil {
			a.emitLog(fmt.Sprintf("[ERR] %v", err))
		}
		if len(out) > 0 {
			a.emitLog(strings.TrimSpace(string(out)))
		}
	}
	a.emitLog("=== Complete ===")
	return ""
}

func measureTCPLatency(host, port string) float64 {
	start := time.Now()
	conn, err := net.DialTimeout("tcp", host+":"+port, 2*time.Second)
	if err != nil {
		return -1
	}
	conn.Close()
	return float64(time.Since(start).Milliseconds())
}

func (a *App) GetNetworkLatency() string {
	type LatencyResult struct {
		Host string  `json:"host"`
		MS   float64 `json:"ms"`
	}
	results := []LatencyResult{}
	hosts := []struct{ host, port string }{
		{"1.1.1.1", "53"},
		{"8.8.8.8", "53"},
		{"google.com", "443"},
	}
	for _, h := range hosts {
		ms := measureTCPLatency(h.host, h.port)
		results = append(results, LatencyResult{Host: h.host, MS: ms})
	}
	b, _ := json.Marshal(results)
	return string(b)
}

func (a *App) RunSpeedTest() string {
	if err := a.rateLimit("RunSpeedTest"); err != nil {
		return "{}"
	}
	type Result struct {
		PingMs        float64 `json:"pingMs"`
		DownloadMbps  float64 `json:"downloadMbps"`
		UploadMbps    float64 `json:"uploadMbps"`
		ServerName    string  `json:"serverName"`
		ServerSponsor string  `json:"serverSponsor"`
		ServerCountry string  `json:"serverCountry"`
	}
	res := Result{}

	importSpeedtest := func() {
		// Dynamic import to avoid compile issues if library changes
		// Using direct import in the package instead
	}
	_ = importSpeedtest

	a.emitLog("[NET] Finding best Speedtest.net server...")

	// Use speedtest-go library for professional measurements
	client := speedtest.New()

	serverList, err := client.FetchServers()
	if err != nil {
		a.emitLog(fmt.Sprintf("[ERR] Failed to fetch servers: %v", err))
		b, _ := json.Marshal(res)
		return string(b)
	}

	targets, err := serverList.FindServer([]int{})
	if err != nil || len(targets) == 0 {
		a.emitLog(fmt.Sprintf("[ERR] No servers found: %v", err))
		b, _ := json.Marshal(res)
		return string(b)
	}

	s := targets[0]
	res.ServerName = s.Name
	res.ServerSponsor = s.Sponsor
	res.ServerCountry = s.Country

	a.emitLog(fmt.Sprintf("[NET] Server: %s (%s) — %s", s.Name, s.Country, s.Sponsor))

	// Ping test
	a.emitLog("[NET] Running ping test...")
	s.PingTest(nil)
	res.PingMs = float64(s.Latency.Milliseconds())
	a.emitLog(fmt.Sprintf("[NET] Ping: %.0f ms", res.PingMs))

	// Download test
	a.emitLog("[NET] Running download test...")
	s.DownloadTest()
	// speedtest-go returns bytes/sec. Convert to Mbps: *8 / 1000 / 1000
	res.DownloadMbps = math.Round(float64(s.DLSpeed)*bitsPerByte/bitsPerMegabit*100) / 100
	a.emitLog(fmt.Sprintf("[NET] Download: %.2f Mbps", res.DownloadMbps))

	// Upload test
	a.emitLog("[NET] Running upload test...")
	s.UploadTest()
	res.UploadMbps = math.Round(float64(s.ULSpeed)*bitsPerByte/bitsPerMegabit*100) / 100
	a.emitLog(fmt.Sprintf("[NET] Upload: %.2f Mbps", res.UploadMbps))

	b, _ := json.Marshal(res)
	return string(b)
}

func (a *App) BackupDrivers() string {
	if err := a.rateLimit("BackupDrivers"); err != nil {
		return err.Error()
	}
	backupDir := fmt.Sprintf("%s\\CodeWinOptimizer\\driver-backups", os.Getenv("USERPROFILE"))
	ts := time.Now().Format("2006-01-02_150405")
	dir := fmt.Sprintf("%s\\%s", backupDir, ts)

	psCmd := fmt.Sprintf(`[Console]::OutputEncoding = [Text.Encoding]::UTF8
$dir = "%s"
New-Item -ItemType Directory -Path $dir -Force | Out-Null
Write-Host "[CMD] Exporting all third-party drivers to $dir ..."
dism /Online /Export-Driver /Destination:$dir 2>$null | Out-Null
if ($LASTEXITCODE -eq 0 -or $LASTEXITCODE -eq 3010) {
    $count = (Get-ChildItem -Recurse -Filter '*.inf' $dir -ErrorAction SilentlyContinue).Count
    Write-Host "[OK] Driver backup complete: $count driver(s) exported -> $dir"
} else {
    Write-Host "[WARN] DISM exited with code $LASTEXITCODE — drivers may be partially exported"
}`, dir)

	a.emitLog("[CMD] Backing up all installed drivers...")
	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", psCmd)
	cmd.SysProcAttr = getSysProcAttr()
	output, err := cmd.CombinedOutput()

	if err != nil {
		a.emitLog(fmt.Sprintf("[ERR] Driver backup failed: %v", err))
	} else {
		a.emitLog(fmt.Sprintf("[OK] Drivers backed up to: %s", dir))
	}

	return strings.TrimSpace(string(output))
}

func (a *App) RestoreDrivers(folderPath string) string {
	if err := a.rateLimit("RestoreDrivers"); err != nil {
		return err.Error()
	}
	expectedBase := filepath.Join(os.Getenv("USERPROFILE"), "CodeWinOptimizer", "driver-backups")
	absPath, err := filepath.Abs(folderPath)
	if err != nil || !strings.HasPrefix(absPath, expectedBase) {
		a.emitLog(fmt.Sprintf("[ERR] Invalid driver folder path: %s", folderPath))
		return "[ERR] Invalid folder path — must be inside driver-backups directory"
	}
	psCmd := fmt.Sprintf(`[Console]::OutputEncoding = [Text.Encoding]::UTF8
$dir = "%s"
if (-not (Test-Path $dir)) { Write-Host "[ERR] Folder not found: $dir"; exit 1 }
$infFiles = Get-ChildItem -Recurse -Filter '*.inf' $dir -ErrorAction SilentlyContinue
if (-not $infFiles) { Write-Host "[ERR] No .inf files found in $dir"; exit 1 }
Write-Host "[CMD] Installing $($infFiles.Count) driver(s) from $dir ..."
$ok = 0; $fail = 0
foreach ($inf in $infFiles) {
    try {
        $result = pnputil /add-driver $inf.FullName /install 2>$null
        if ($LASTEXITCODE -eq 0) { $ok++ } else { $fail++ }
    } catch { $fail++ }
}
Write-Host "[OK] Drivers installed: $ok success, $fail failed"`, folderPath)

	a.emitLog(fmt.Sprintf("[CMD] Restoring drivers from: %s", folderPath))
	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", psCmd)
	cmd.SysProcAttr = getSysProcAttr()
	output, err := cmd.CombinedOutput()

	if err != nil {
		a.emitLog(fmt.Sprintf("[ERR] Driver restore failed: %v", err))
	} else {
		a.emitLog("[OK] Driver restore complete")
	}

	return strings.TrimSpace(string(output))
}

/* ========= TWEAK PROFILES ========= */

type TweakProfile struct {
	Name      string   `json:"name"`
	Tweaks    []string `json:"tweaks"`
	CreatedAt string   `json:"createdAt"`
}

func profilesDir() string {
	return fmt.Sprintf("%s\\CodeWinOptimizer\\profiles", os.Getenv("USERPROFILE"))
}

func (a *App) ensureDefaultProfiles() {
	dir := profilesDir()
	os.MkdirAll(dir, 0755)

	defaults := map[string][]string{
		"Standard": {
			"disable-consumerfeatures",
			"disable-activity-history",
			"disable-hibernation",
			"disable-telemetry",
			"disable-widgets",
			"disable-background-apps",
			"disable-onedrive",
			"optimize-visual-effects",
			"disable-news-interests",
			"disable-advertising-id",
			"disable-startup-delay",
			"disable-cortana",
			"remove-temporary-files",
			"set-services-manual",
			"enable-endtask-rightclick",
		},
		"Gaming": {
			"disable-consumerfeatures",
			"disable-activity-history",
			"disable-hibernation",
			"disable-telemetry",
			"disable-widgets",
			"disable-background-apps",
			"disable-onedrive",
			"optimize-visual-effects",
			"disable-xbox-gamebar",
			"fullscreen-optimizations",
			"disable-hpet",
			"disable-dynamic-tick",
			"disable-network-throttling",
			"set-system-responsiveness-zero",
			"large-system-cache",
			"gpu-scheduling",
			"ultimate-power-plan",
			"disable-ipv6",
			"congestion-provider",
			"disable-compression",
			"disable-paging-executive",
			"nvidia-performance",
		},
		"Minimal": {
			"disable-consumerfeatures",
			"disable-activity-history",
			"disable-hibernation",
			"disable-telemetry",
			"disable-widgets",
			"disable-background-apps",
			"disable-onedrive",
			"optimize-visual-effects",
			"disable-cortana",
			"disable-news-interests",
			"disable-advertising-id",
			"disable-lockscreen",
			"disable-startup-delay",
			"disable-location-tracking",
			"disable-store-search-results",
			"disable-notifications",
			"disable-copilot",
			"disable-gallery",
			"disable-home",
			"remove-bloatware",
		},
	}

	for name, tweaks := range defaults {
		filename := strings.ReplaceAll(name, " ", "_")
		path := fmt.Sprintf("%s\\%s.json", dir, filename)
		if _, err := os.Stat(path); os.IsNotExist(err) {
			profile := TweakProfile{
				Name:      name,
				Tweaks:    tweaks,
				CreatedAt: time.Now().Format(time.RFC3339),
			}
			data, _ := json.MarshalIndent(profile, "", "  ")
			os.WriteFile(path, data, 0644)
			a.emitLog(fmt.Sprintf("[OK] Default profile created: %s (%d tweaks)", name, len(tweaks)))
		}
	}
}

const (
	bytesPerGiB      = 1024 * 1024 * 1024
	secondsPerDay    = 86400
	secondsPerHour   = 3600
	secondsPerMinute = 60
	bitsPerByte      = 8
	bitsPerMegabit   = 1_000_000
)

var safeProfileName = regexp.MustCompile(`[^a-zA-Z0-9_-]`)
var safePackageID = regexp.MustCompile(`^[a-zA-Z0-9._-]+$`)

func sanitizeProfileName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", fmt.Errorf("profile name cannot be empty")
	}
	safe := safeProfileName.ReplaceAllString(name, "_")
	safe = filepath.Base(safe)
	if safe == "." || safe == ".." || safe == "" {
		return "", fmt.Errorf("invalid profile name: %s", name)
	}
	if len(safe) > 64 {
		safe = safe[:64]
	}
	return safe, nil
}

func (a *App) SaveProfile(name string, tweakIDs []string) string {
	dir := profilesDir()
	os.MkdirAll(dir, 0755)

	filename, err := sanitizeProfileName(name)
	if err != nil {
		return fmt.Sprintf("[ERR] %v", err)
	}
	path := filepath.Join(dir, filename+".json")

	profile := TweakProfile{
		Name:      name,
		Tweaks:    tweakIDs,
		CreatedAt: time.Now().Format(time.RFC3339),
	}

	data, err := json.MarshalIndent(profile, "", "  ")
	if err != nil {
		return fmt.Sprintf("[ERR] Failed to marshal profile: %v", err)
	}

	if err := os.WriteFile(path, data, 0644); err != nil {
		return fmt.Sprintf("[ERR] Failed to write profile: %v", err)
	}

	a.emitLog(fmt.Sprintf("[OK] Profile saved: %s (%d tweaks)", name, len(tweakIDs)))
	return fmt.Sprintf("[OK] Profile saved: %s", name)
}

func (a *App) LoadProfile(name string) string {
	dir := profilesDir()
	filename, err := sanitizeProfileName(name)
	if err != nil {
		return fmt.Sprintf("[ERR] %v", err)
	}
	path := filepath.Join(dir, filename+".json")

	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Sprintf("[ERR] Profile not found: %s", name)
	}

	var profile TweakProfile
	if err := json.Unmarshal(data, &profile); err != nil {
		return fmt.Sprintf("[ERR] Failed to parse profile: %v", err)
	}

	result, _ := json.Marshal(profile.Tweaks)
	a.emitLog(fmt.Sprintf("[OK] Profile loaded: %s (%d tweaks)", name, len(profile.Tweaks)))
	return string(result)
}

func (a *App) DeleteProfile(name string) string {
	dir := profilesDir()
	filename, err := sanitizeProfileName(name)
	if err != nil {
		return fmt.Sprintf("[ERR] %v", err)
	}
	path := filepath.Join(dir, filename+".json")

	if err := os.Remove(path); err != nil {
		return fmt.Sprintf("[ERR] Failed to delete profile: %v", err)
	}

	a.emitLog(fmt.Sprintf("[OK] Profile deleted: %s", name))
	return fmt.Sprintf("[OK] Profile deleted: %s", name)
}

func (a *App) ListProfiles() string {
	dir := profilesDir()
	os.MkdirAll(dir, 0755)

	entries, err := os.ReadDir(dir)
	if err != nil {
		return "[]"
	}

	names := []string{}
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".json") {
			name := strings.TrimSuffix(entry.Name(), ".json")
			name = strings.ReplaceAll(name, "_", " ")
			names = append(names, name)
		}
	}

	result, _ := json.Marshal(names)
	return string(result)
}

func (a *App) GetCurrentDNS() string {
	script := `try {
		$adapter = Get-NetAdapter | Where-Object {$_.Status -eq 'Up'} | Select-Object -First 1
		if (-not $adapter) { return 'DHCP' }
		$dns = (Get-DnsClientServerAddress -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4).ServerAddresses
		if ($dns) { $dns -join ',' } else { 'DHCP' }
	} catch { 'DHCP' }`
	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script)
	cmd.SysProcAttr = getSysProcAttr()
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "DHCP"
	}
	return strings.TrimSpace(string(out))
}

func (a *App) SetDNS(provider string) string {
	var servers string
	switch provider {
	case "google":
		servers = "8.8.8.8,8.8.4.4"
	case "cloudflare":
		servers = "1.1.1.1,1.0.0.1"
	case "cloudflare_malware":
		servers = "1.1.1.2,1.0.0.2"
	case "cloudflare_malware_adult":
		servers = "1.1.1.3,1.0.0.3"
	case "opendns":
		servers = "208.67.222.222,208.67.220.220"
	case "quad9":
		servers = "9.9.9.9,149.112.112.112"
	case "adguard":
		servers = "94.140.14.14,94.140.15.15"
	case "adguard_full":
		servers = "94.140.14.15,94.140.15.16"
	default:
		script := `try {
			$adapter = Get-NetAdapter | Where-Object {$_.Status -eq 'Up'} | Select-Object -First 1
			if (-not $adapter) { return 'No active adapter found' }
			Set-DnsClientServerAddress -InterfaceIndex $adapter.ifIndex -ResetServerAddresses
			'OK: DHCP'
		} catch { 'ERR: ' + $_.Exception.Message }`
		cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script)
		cmd.SysProcAttr = getSysProcAttr()
		out, _ := cmd.CombinedOutput()
		res := strings.TrimSpace(string(out))
		a.emitLog(res)
		return res
	}

	script := fmt.Sprintf(`try {
		$adapter = Get-NetAdapter | Where-Object {$_.Status -eq 'Up'} | Select-Object -First 1
		if (-not $adapter) { return 'No active adapter found' }
		Set-DnsClientServerAddress -InterfaceIndex $adapter.ifIndex -ServerAddresses @("%s")
		'OK: DNS set to %s'
	} catch { 'ERR: ' + $_.Exception.Message }`, strings.ReplaceAll(servers, ",", `","`), provider)

	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script)
	cmd.SysProcAttr = getSysProcAttr()
	out, _ := cmd.CombinedOutput()
	res := strings.TrimSpace(string(out))
	a.emitLog(res)
	return res
}

func (a *App) SetWindowsUpdate(mode string) string {
	if err := a.rateLimit("SetWindowsUpdate"); err != nil {
		return err.Error()
	}
	var script string
	switch mode {
	case "default":
		script = `try {
			$policies = @(
				'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU',
				'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate',
				'HKLM:\SOFTWARE\Microsoft\WindowsUpdate\UpdatePolicy\PolicyState',
				'HKLM:\SOFTWARE\Microsoft\WindowsUpdate\UX\Settings'
			)
			foreach ($p in $policies) { if (Test-Path $p) { Remove-Item -Path $p -Recurse -Force -ErrorAction SilentlyContinue } }
			Set-Service -Name wuauserv -StartupType Automatic -ErrorAction SilentlyContinue
			Start-Service -Name wuauserv -ErrorAction SilentlyContinue
			'OK: Windows Update reset to default'
		} catch { 'ERR: ' + $_.Exception.Message }`
	case "security":
		script = `try {
			$au = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU'
			$wu = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate'
			if (-not (Test-Path $au)) { New-Item -Path $au -Force | Out-Null }
			if (-not (Test-Path $wu)) { New-Item -Path $wu -Force | Out-Null }
			Set-ItemProperty -Path $au -Name 'NoAutoUpdate' -Value 0 -Type DWord -Force
			Set-ItemProperty -Path $au -Name 'AUOptions' -Value 4 -Type DWord -Force
			Set-ItemProperty -Path $wu -Name 'DeferFeatureUpdatesPeriodInDays' -Value 365 -Type DWord -Force
			Set-ItemProperty -Path $wu -Name 'DeferQualityUpdatesPeriodInDays' -Value 4 -Type DWord -Force
			Set-ItemProperty -Path $wu -Name 'ExcludeWUDriversInQualityUpdate' -Value 1 -Type DWord -Force
			Set-Service -Name wuauserv -StartupType Automatic -ErrorAction SilentlyContinue
			Start-Service -Name wuauserv -ErrorAction SilentlyContinue
			'OK: Security settings applied'
		} catch { 'ERR: ' + $_.Exception.Message }`
	case "disable":
		script = `try {
			$au = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU'
			if (-not (Test-Path $au)) { New-Item -Path $au -Force | Out-Null }
			Set-ItemProperty -Path $au -Name 'NoAutoUpdate' -Value 1 -Type DWord -Force
			Stop-Service -Name wuauserv -Force -ErrorAction SilentlyContinue
			Set-Service -Name wuauserv -StartupType Disabled -ErrorAction SilentlyContinue
			'OK: Windows Update disabled'
		} catch { 'ERR: ' + $_.Exception.Message }`
	default:
		return "ERR: Unknown mode"
	}
	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script)
	cmd.SysProcAttr = getSysProcAttr()
	out, _ := cmd.CombinedOutput()
	res := strings.TrimSpace(string(out))
	a.emitLog(res)
	return res
}
