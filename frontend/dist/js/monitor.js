/* ========= TAB: MONITOR =========
 * Owns: system info polling, network latency, DNS, speed test, health score.
 * Globals expected from main.js: T, LO, h, esc, busy, setBusy, setTerm,
 * appendLog, lang, and window.go.main.App.* Wails bindings.
 */

function drawMonitor() {
  document.getElementById("tab-monitor-label").textContent = T("tabMonitor");
  document.getElementById("mon-cpu-title").textContent = T("monCPU");
  document.getElementById("mon-ram-title").textContent = T("monRAM");
  document.getElementById("mon-gpu-title").textContent = T("monGPU");
  document.getElementById("mon-disk-title").textContent = T("monDisk");
  document.getElementById("mon-uptime-title").textContent = T("monUptime");
  document.getElementById("mon-network-title").textContent = T("monNetwork");
  document.getElementById("btn-speedtest-text").textContent = T("runSpeedTest");
  document.getElementById("dns-title").textContent = T("dnsTitle");
  fetchMonitor();
  fetchNetworkLatency();
  fetchCurrentDNS();
}

async function fetchMonitor() {
  try {
    const raw = await window.go.main.App.GetSystemInfo();
    const d = JSON.parse(raw);
    if (d.error) return;
    let cpuTempC = null;
    let gpuTempC = null;
    if (Array.isArray(d.temps)) {
      for (const t of d.temps) {
        const v = Number(t.temp);
        if (!isFinite(v) || v <= 0) continue;
        if (t.name === "GPU" && gpuTempC === null) gpuTempC = v;
        else if (t.name !== "GPU" && cpuTempC === null) cpuTempC = v;
      }
    }
    const tempColor = (c) =>
      c > 80 ? "var(--rd)" : c > 65 ? "var(--yl)" : "var(--gn)";

    if (d.cpu) {
      const cp = Number(d.cpu.pct) || 0;
      const cpuValEl = document.getElementById("mon-cpu-val");
      cpuValEl.replaceChildren();
      const pctSpan = document.createElement("span");
      pctSpan.textContent = cp + "%";
      cpuValEl.appendChild(pctSpan);
      if (cpuTempC !== null) {
        const sep = document.createElement("span");
        sep.style.cssText =
          "color:var(--tx3);font-size:.65em;margin:0 8px;font-weight:400";
        sep.textContent = "·";
        const tempSpan = document.createElement("span");
        tempSpan.style.cssText =
          "color:" + tempColor(cpuTempC) + ";font-size:.75em";
        tempSpan.textContent = cpuTempC + "°C";
        cpuValEl.append(sep, tempSpan);
      }
      document.getElementById("mon-cpu-bar").style.width = cp + "%";
      document.getElementById("mon-cpu-sub").textContent =
        (d.cpu.name || "") +
        (d.cpu.cores ? " · " + d.cpu.cores + "C/" + d.cpu.threads + "T" : "");
    }
    if (d.ram) {
      document.getElementById("mon-ram-val").textContent =
        d.ram.usedGB + " / " + d.ram.totalGB + " GB";
      document.getElementById("mon-ram-bar").style.width =
        (Number(d.ram.pct) || 0) + "%";
      document.getElementById("mon-ram-sub").textContent =
        d.ram.freeGB + " GB free";
    }
    if (d.gpus && d.gpus.length > 0) {
      const g = d.gpus[0];
      const gu = Number(g.usage) || 0;
      const gpuTemp = gpuTempC !== null ? gpuTempC : Number(g.temp) || null;
      document.getElementById("mon-gpu-bar").style.width = gu + "%";
      const gpuValEl = document.getElementById("mon-gpu-val");
      gpuValEl.replaceChildren();
      const pctSpan = document.createElement("span");
      pctSpan.textContent = gu > 0 ? gu + "%" : "--";
      gpuValEl.appendChild(pctSpan);
      if (gpuTemp !== null && gpuTemp > 0) {
        const sep = document.createElement("span");
        sep.style.cssText =
          "color:var(--tx3);font-size:.65em;margin:0 8px;font-weight:400";
        sep.textContent = "·";
        const tempSpan = document.createElement("span");
        tempSpan.style.cssText =
          "color:" + tempColor(gpuTemp) + ";font-size:.75em";
        tempSpan.textContent = gpuTemp + "°C";
        gpuValEl.append(sep, tempSpan);
      }
      const sub = [];
      if (g.name) sub.push(g.name);
      if (g.ramGB) sub.push(Number(g.ramGB) + " GB");
      document.getElementById("mon-gpu-sub").textContent =
        sub.join(" · ") || "--";
    }
    if (d.disks && d.disks.length > 0) {
      document.getElementById("mon-disk-val").textContent =
        d.disks[0].pct + "% used";
      const diskEl = document.getElementById("mon-disk-detail");
      diskEl.replaceChildren();
      d.disks.forEach((dk) => {
        const pct = Math.min(Math.max(Number(dk.pct) || 0, 0), 100);
        const cl =
          pct > 90 ? "var(--rd)" : pct > 70 ? "var(--yl)" : "var(--gn)";
        const row = document.createElement("div");
        row.style.cssText =
          "display:flex;align-items:center;gap:6px;margin-top:3px";
        const lbl = document.createElement("span");
        lbl.textContent = dk.drive;
        const bar = document.createElement("div");
        bar.style.cssText =
          "flex:1;height:4px;background:#1a1a1a;border-radius:2px";
        const fill = document.createElement("div");
        fill.style.cssText = `width:${pct}%;height:100%;background:${cl};border-radius:2px`;
        bar.appendChild(fill);
        const val = document.createElement("span");
        val.style.cssText = `font-size:.85em;color:${cl}`;
        val.textContent = pct + "%";
        row.append(lbl, bar, val);
        diskEl.appendChild(row);
      });
    }
    if (d.uptime) {
      document.getElementById("mon-uptime-val").textContent = d.uptime;
      const m = String(d.uptime).match(/(\d+)d\s+(\d+)h\s+(\d+)m/);
      if (m) {
        const secs =
          parseInt(m[1]) * 86400 + parseInt(m[2]) * 3600 + parseInt(m[3]) * 60;
        const bootMs = Date.now() - secs * 1000;
        const boot = new Date(bootMs);
        const fmt = boot.toLocaleString(lang === "es" ? "es-ES" : "en-US", {
          weekday: "short",
          hour: "2-digit",
          minute: "2-digit",
          day: "numeric",
          month: "short",
        });
        document.getElementById("mon-uptime-sub").textContent =
          (lang === "es" ? "Iniciado " : "Booted ") + fmt;
      }
    }
  } catch (e) {
    console.warn("[Monitor] Failed to fetch system info:", e);
  }
}

async function fetchNetworkLatency() {
  try {
    const raw = await window.go.main.App.GetNetworkLatency();
    const d = JSON.parse(raw);
    const grid = document.getElementById("mon-network-val");
    if (!grid) return;
    if (!Array.isArray(d) || d.length === 0) {
      grid.replaceChildren(
        Object.assign(document.createElement("div"), {
          className: "latency-empty",
          textContent: "--",
        }),
      );
      return;
    }
    const rows = d.map((r) => {
      const ms = Number(r.ms);
      const ok = ms >= 0;
      let cls = "latency-dot";
      let badgeCls = "latency-badge";
      if (!ok) {
        cls += " latency-dot-err";
        badgeCls += " latency-badge-err";
      } else if (ms < 30) {
        cls += " latency-dot-good";
        badgeCls += " latency-badge-good";
      } else if (ms < 100) {
        cls += " latency-dot-mid";
        badgeCls += " latency-badge-mid";
      } else {
        cls += " latency-dot-bad";
        badgeCls += " latency-badge-bad";
      }
      const row = h(
        "div",
        { className: "latency-row" },
        h("span", { className: cls }),
        h("span", { className: "latency-host", textContent: r.host }),
        h("span", {
          className: badgeCls,
          textContent: ok ? ms + " ms" : "timeout",
        }),
      );
      return row;
    });
    grid.replaceChildren(...rows);
  } catch (e) {
    console.warn("[Network] Failed to fetch latency:", e);
  }
}

async function fetchCurrentDNS() {
  try {
    const raw = await window.go.main.App.GetCurrentDNS();
    const sel = document.getElementById("dns-select");
    const currentDiv = document.getElementById("dns-current");
    if (!sel || !currentDiv) return;
    const current = raw.trim();
    const map = {
      "8.8.8.8,8.8.4.4": "google",
      "1.1.1.1,1.0.0.1": "cloudflare",
      "1.1.1.2,1.0.0.2": "cloudflare_malware",
      "1.1.1.3,1.0.0.3": "cloudflare_malware_adult",
      "208.67.222.222,208.67.220.220": "opendns",
      "9.9.9.9,149.112.112.112": "quad9",
      "94.140.14.14,94.140.15.15": "adguard",
      "94.140.14.15,94.140.15.16": "adguard_full",
    };
    if (map[current]) {
      sel.value = map[current];
      currentDiv.textContent =
        (lang === "es" ? "Actual: " : "Current: ") + current;
    } else if (current === "DHCP" || current === "") {
      sel.value = "dhcp";
      currentDiv.textContent =
        (lang === "es" ? "Actual: " : "Current: ") + "DHCP / Default";
    } else {
      sel.value = "dhcp";
      currentDiv.textContent =
        (lang === "es" ? "Actual: " : "Current: ") + current;
    }
  } catch (e) {
    console.warn("[DNS] Failed to fetch current DNS:", e);
  }
}

async function applyDNS() {
  if (busy) return;
  const sel = document.getElementById("dns-select");
  if (!sel) return;
  const provider = sel.value;
  busy = true;
  setTerm(T("changingDns"), "running");
  appendLog("[CMD] Setting DNS to " + provider + "...");
  try {
    const r = await window.go.main.App.SetDNS(provider);
    appendLog(r);
    if (r.startsWith("OK")) {
      setTerm("DNS updated", "ok");
    } else {
      setTerm("DNS error", "err");
    }
    await fetchCurrentDNS();
  } catch (e) {
    appendLog("[ERR] " + e);
    setTerm("DNS error", "err");
  }
  busy = false;
}

async function runSpeedTest() {
  if (busy) return;
  busy = true;
  document.getElementById("btn-speedtest").disabled = true;
  document.getElementById("btn-speedtest-text").textContent = T("testing");
  document.getElementById("speedtest-result").style.display = "none";
  setTerm(T("speedTestRunning"), "running");
  appendLog("[CMD] Starting Speedtest.net measurement...");
  try {
    const raw = await window.go.main.App.RunSpeedTest();
    const d = JSON.parse(raw);

    const serverInfo = d.serverName
      ? `${d.serverName} — ${d.serverSponsor || ""}`
      : "";

    const pingVal =
      d.pingMs != null && d.pingMs > 0 ? d.pingMs.toFixed(0) + " ms" : "--";

    const pingEl = document.getElementById("speedtest-ping");
    pingEl.replaceChildren();
    const pingItem = document.createElement("div");
    pingItem.className = "speedtest-ping-item";
    const pingLbl = document.createElement("span");
    pingLbl.className = "speedtest-ping-label";
    pingLbl.textContent = "Ping:";
    const pingV = document.createElement("span");
    pingV.className = "speedtest-ping-value";
    pingV.textContent = pingVal;
    pingItem.append(pingLbl, pingV);
    pingEl.appendChild(pingItem);
    if (serverInfo) {
      const srvItem = document.createElement("div");
      srvItem.className = "speedtest-ping-item";
      srvItem.style.marginLeft = "auto";
      const srvLbl = document.createElement("span");
      srvLbl.className = "speedtest-ping-label";
      srvLbl.textContent = "Server:";
      const srvV = document.createElement("span");
      srvV.className = "speedtest-ping-value";
      srvV.style.cssText = "color:var(--tx2);font-size:.8em";
      srvV.textContent = serverInfo;
      srvItem.append(srvLbl, srvV);
      pingEl.appendChild(srvItem);
    }

    function fmtSpeedNode(val) {
      if (!val || val <= 0) return document.createTextNode("--");
      const num =
        val >= 1000
          ? (val / 1000).toFixed(2)
          : val.toLocaleString("en-US", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            });
      const unit = val >= 1000 ? "Gbps" : "Mbps";
      const frag = document.createDocumentFragment();
      frag.appendChild(document.createTextNode(num + " "));
      frag.appendChild(
        h(
          "span",
          { style: "font-size:.7em;font-weight:500;color:var(--tx3)" },
          unit,
        ),
      );
      return frag;
    }
    function fmtSpeedLog(val) {
      if (!val || val <= 0) return "--";
      if (val >= 1000) return (val / 1000).toFixed(2) + " Gbps";
      return (
        val.toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }) + " Mbps"
      );
    }

    const downLog = fmtSpeedLog(d.downloadMbps);
    const upLog = fmtSpeedLog(d.uploadMbps);

    document.getElementById("speedtest-speeds").replaceChildren(
      h(
        "div",
        { className: "speedtest-down" },
        h("span", { className: "speedtest-arrow", textContent: "↓" }),
        fmtSpeedNode(d.downloadMbps),
      ),
      h(
        "div",
        { className: "speedtest-up" },
        h("span", { className: "speedtest-arrow", textContent: "↑" }),
        fmtSpeedNode(d.uploadMbps),
      ),
    );

    document.getElementById("speedtest-result").style.display = "block";

    appendLog(`[OK] Ping ${pingVal} · Download ${downLog} · Upload ${upLog}`);
    setTerm(T("speedTestComplete"), "ok");
  } catch (e) {
    appendLog("[ERR] Speed test failed: " + e);
    setTerm(T("speedTestFailed"), "err");
  }
  busy = false;
  document.getElementById("btn-speedtest").disabled = false;
  document.getElementById("btn-speedtest-text").textContent = T("runSpeedTest");
}

async function loadHealthScore() {
  const panel = document.getElementById("health-score-panel");
  if (!panel) return;
  try {
    const raw = await window.go.main.App.GetHealthScore();
    const d = JSON.parse(raw);
    if (!d.score && d.score !== 0) return;

    const color =
      d.score >= 80 ? "var(--gn)" : d.score >= 55 ? "var(--yl)" : "var(--rd)";
    const ring = document.getElementById("health-ring-fill");
    const circ = 2 * Math.PI * 52;
    const offset = circ - (d.score / 100) * circ;
    ring.style.stroke = color;
    ring.style.strokeDashoffset = String(offset);
    ring.style.transition = "stroke-dashoffset 1s ease";

    document.getElementById("health-number").textContent = d.score;
    document.getElementById("health-number").style.color = color;
    document.getElementById("health-grade").textContent = d.grade;
    document.getElementById("health-title").textContent =
      lang === "es" ? "Salud del PC" : "PC Health Score";

    const maxMap = { ram: 30, cpu: 20, disk: 30, temp: 10, uptime: 10 };
    const labels = {
      ram: "RAM",
      cpu: "CPU",
      disk: lang === "es" ? "Disco" : "Disk",
      temp: "Temp",
      uptime: lang === "es" ? "Activo" : "Uptime",
    };
    const bars = document.getElementById("health-bars");
    bars.replaceChildren();
    for (const [key, max] of Object.entries(maxMap)) {
      const val = d.breakdown[key] || 0;
      const pct = Math.round((val / max) * 100);
      const cl =
        pct >= 80 ? "var(--gn)" : pct >= 50 ? "var(--yl)" : "var(--rd)";
      bars.appendChild(
        h(
          "div",
          { className: "health-bar-row" },
          h("span", {
            className: "health-bar-label",
            textContent: labels[key] || key,
          }),
          h(
            "div",
            { className: "health-bar-track" },
            h("div", {
              className: "health-bar-fill",
              style: "width:" + pct + "%;background:" + cl,
            }),
          ),
          h("span", {
            className: "health-bar-val",
            textContent: val + "/" + max,
          }),
        ),
      );
    }

    const tips = document.getElementById("health-tips");
    tips.replaceChildren();
    if (d.tips && d.tips.length > 0) {
      d.tips.forEach(function (t) {
        tips.appendChild(
          h("div", { className: "health-tip", textContent: t }),
        );
      });
    }

    panel.classList.remove("hidden");
  } catch (e) {
    console.warn("[Health] Failed:", e);
  }
}

let monTimer = null;
function startMonitorPoll() {
  stopMonitorPoll();
  drawMonitor();
  monTimer = setInterval(() => {
    fetchMonitor();
    fetchNetworkLatency();
  }, 3000);
}
function stopMonitorPoll() {
  if (monTimer) {
    clearInterval(monTimer);
    monTimer = null;
  }
}

function initMonitorListeners() {
  document
    .getElementById("btn-speedtest")
    ?.addEventListener("click", runSpeedTest);
  document
    .getElementById("btn-refresh-health")
    ?.addEventListener("click", loadHealthScore);
  document.getElementById("dns-select")?.addEventListener("change", applyDNS);
}
