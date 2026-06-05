package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
)

// Impact snapshot persistence layer.
//
// Snapshots live in %LOCALAPPDATA%\CodeWinOptimizer\impact.json as an
// array sorted oldest → newest. Capped at maxSnapshots; older entries
// roll off. Save is best-effort and never propagates an error to the
// UI — losing one snapshot is preferable to disrupting Monitor refresh.

const (
	metricsFileName = "impact.json"
	maxSnapshots    = 60
)

// ImpactSnapshot captures one point-in-time reading of system metrics.
type ImpactSnapshot struct {
	TimestampUnix    int64   `json:"ts"`
	UptimeSec        int64   `json:"uptimeSec"`
	LastBootUnix     int64   `json:"lastBootTs"`
	FreeRamMB        int64   `json:"freeRamMB"`
	TotalRamMB       int64   `json:"totalRamMB"`
	FreeDiskGB       float64 `json:"freeDiskGB"`
	TotalDiskGB      float64 `json:"totalDiskGB"`
	ServicesRunning  int     `json:"servicesRunning"`
	ProcessCount     int     `json:"processCount"`
	StartupTotal     int     `json:"startupTotal"`
	StartupEnabled   int     `json:"startupEnabled"`
}

func metricsDir() (string, error) {
	base := os.Getenv("LOCALAPPDATA")
	if base == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		base = filepath.Join(home, "AppData", "Local")
	}
	dir := filepath.Join(base, "CodeWinOptimizer")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return dir, nil
}

func metricsPath() (string, error) {
	d, err := metricsDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(d, metricsFileName), nil
}

// loadSnapshots returns the persisted snapshots sorted oldest → newest.
// A missing or corrupt file is treated as "no history".
func loadSnapshots() []ImpactSnapshot {
	p, err := metricsPath()
	if err != nil {
		return nil
	}
	data, err := os.ReadFile(p)
	if err != nil {
		return nil
	}
	var out []ImpactSnapshot
	if err := json.Unmarshal(data, &out); err != nil {
		return nil
	}
	sort.Slice(out, func(i, j int) bool { return out[i].TimestampUnix < out[j].TimestampUnix })
	return out
}

// saveSnapshot appends to history, trims to maxSnapshots, and writes back.
// Errors are swallowed by design — see file header.
func saveSnapshot(snap ImpactSnapshot) {
	hist := loadSnapshots()
	hist = append(hist, snap)
	if len(hist) > maxSnapshots {
		hist = hist[len(hist)-maxSnapshots:]
	}
	p, err := metricsPath()
	if err != nil {
		return
	}
	data, err := json.Marshal(hist)
	if err != nil {
		return
	}
	tmp := p + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return
	}
	_ = os.Rename(tmp, p)
}
