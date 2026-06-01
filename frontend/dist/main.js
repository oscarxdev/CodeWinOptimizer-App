const APPS = window.APPS;
const FEATURES = window.FEATURES;
const FIXES = window.FIXES;
const L = window.L;
let lang = "en",
  busy = false,
  busyTimer = null,
  catData = [],
  pickedT = new Set(),
  pickedA = new Set(),
  curTab = "restore",
  pkgMgr = "winget",
  installedSet = new Set();
function setBusy(v, timeoutMs) {
  if (busyTimer) {
    clearTimeout(busyTimer);
    busyTimer = null;
  }
  busy = v;
  const cancelBtn = document.getElementById("btn-cancel");
  if (cancelBtn) cancelBtn.classList.toggle("hidden", !v);
  if (v && timeoutMs) {
    busyTimer = setTimeout(() => {
      console.warn("[Busy] Operation timed out, resetting busy flag");
      busy = false;
      busyTimer = null;
      refreshUI();
      setTerm(T("operationTimeout"), "err");
    }, timeoutMs);
  }
  refreshUI();
}

function T(k) {
  return L[lang]?.[k] || L.en?.[k] || k;
}
function LO(v) {
  return typeof v === "object" && v ? v[lang] || v["en"] || "" : v || "";
}
function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props)
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === "className") el.className = v;
      else if (k === "textContent") el.textContent = v;
      else if (k === "style") el.style.cssText = v;
      else if (k === "checked" || k === "disabled") el[k] = !!v;
      else el.setAttribute(k, v);
    }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return el;
}

function showConfirm(title, msg) {
  return new Promise((resolve) => {
    const el = document.getElementById("custom-confirm");
    const t = document.getElementById("confirm-title");
    const m = document.getElementById("confirm-msg");
    const ok = document.getElementById("confirm-ok");
    const cancel = document.getElementById("confirm-cancel");
    t.textContent = title || T("confirm");
    m.textContent = msg;
    ok.textContent = T("ok");
    cancel.textContent = T("cancel");
    el.classList.remove("hidden");
    const close = (val) => {
      el.classList.add("hidden");
      ok.removeEventListener("click", onOk);
      cancel.removeEventListener("click", onCancel);
      resolve(val);
    };
    const onOk = () => close(true);
    const onCancel = () => close(false);
    ok.addEventListener("click", onOk);
    cancel.addEventListener("click", onCancel);
  });
}

/* ========= THEME ========= */
let themeAccent = "#39ff14",
  themeFont = "'Segoe UI',system-ui,sans-serif";

function loadTheme() {
  try {
    const t = JSON.parse(localStorage.getItem("cwo-theme"));
    if (t) {
      themeAccent = t.accent || "#39ff14";
      themeFont = t.font || themeFont;
    }
  } catch (e) {
    console.warn("[Theme] Failed to load saved theme:", e);
  }
  applyTheme();
}

function applyTheme() {
  document.documentElement.style.setProperty("--gn", themeAccent);
  document.documentElement.style.setProperty("--gn2", themeAccent + "1A");
  document.body.style.fontFamily = themeFont;
  document
    .querySelectorAll(".color-btn")
    .forEach((b) =>
      b.classList.toggle("active", b.dataset.color === themeAccent),
    );
  const fs = document.getElementById("theme-font-select");
  if (fs) fs.value = themeFont;
}

function saveTheme() {
  localStorage.setItem(
    "cwo-theme",
    JSON.stringify({ accent: themeAccent, font: themeFont }),
  );
}

function drawTheme() {
  const cl = document.getElementById("settings-color-label");
  const fl = document.getElementById("settings-font-label");
  const ll = document.getElementById("settings-lang-label");
  const rt = document.getElementById("btn-theme-reset-text");
  const ut = document.getElementById("btn-check-update-text");
  if (cl) cl.textContent = T("themeColors");
  if (fl) fl.textContent = T("themeFonts");
  if (ll) ll.textContent = lang === "es" ? "Idioma" : "Language";
  if (rt) rt.textContent = T("themeReset");
  if (ut) ut.textContent = T("checkUpdates");
  document
    .querySelectorAll(".color-btn")
    .forEach((b) =>
      b.classList.toggle("active", b.dataset.color === themeAccent),
    );
  const fs = document.getElementById("theme-font-select");
  if (fs) fs.value = themeFont;
}

function drawMonitor() {
  document.getElementById("tab-monitor-label").textContent = T("tabMonitor");
  document.getElementById("mon-cpu-title").textContent = T("monCPU");
  document.getElementById("mon-ram-title").textContent = T("monRAM");
  document.getElementById("mon-gpu-title").textContent = T("monGPU");
  document.getElementById("mon-disk-title").textContent = T("monDisk");
  document.getElementById("mon-temp-title").textContent = T("monTemp");
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
    if (d.cpu) {
      const cp = Number(d.cpu.pct) || 0;
      document.getElementById("mon-cpu-val").textContent = cp + "%";
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
      document.getElementById("mon-gpu-val").textContent =
        gu > 0 ? gu + "%" : "--";
      const sub = [];
      if (g.name) sub.push(g.name);
      if (g.ramGB) sub.push(Number(g.ramGB) + " GB");
      if (g.temp || g.temp === 0) sub.push(Number(g.temp) + "°C");
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
    if (d.temps && d.temps.length > 0) {
      const tempEl = document.getElementById("mon-temp-val");
      tempEl.replaceChildren();
      d.temps.forEach((t, i) => {
        if (i > 0) tempEl.append(" ");
        const tmp = Number(t.temp) || 0;
        const cl =
          tmp > 80 ? "var(--rd)" : tmp > 60 ? "var(--yl)" : "var(--gn)";
        const sp = document.createElement("span");
        sp.style.color = cl;
        sp.textContent = tmp + "°C";
        tempEl.appendChild(sp);
      });
      document.getElementById("mon-temp-sub").textContent = d.temps
        .map((t) => t.name)
        .join(", ");
    } else {
      document.getElementById("mon-temp-val").textContent = "--";
      document.getElementById("mon-temp-sub").textContent = T("monTempNA");
    }
    if (d.uptime) {
      document.getElementById("mon-uptime-val").textContent = d.uptime;
    }
  } catch (e) {
    console.warn("[Monitor] Failed to fetch system info:", e);
  }
}

async function fetchNetworkLatency() {
  try {
    const raw = await window.go.main.App.GetNetworkLatency();
    const d = JSON.parse(raw);
    if (!Array.isArray(d)) return;
    const lines = d
      .map((r) => `${r.host}: ${r.ms >= 0 ? r.ms + " ms" : "--"}`)
      .join(" · ");
    document.getElementById("mon-network-val").textContent = lines;
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

    // Server info
    const serverInfo = d.serverName
      ? `${d.serverName} — ${d.serverSponsor || ""}`
      : "";

    // Build ping display
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

    // Format speeds: UI builds DOM nodes, log returns plain text
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

    // Show result section
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

const CLEANUP_TASKS = [
  {
    id: "temp",
    icon: "📁",
    n: { en: "Temporary files", es: "Archivos temporales" },
    d: {
      en: "%TEMP% and Windows\\Temp folders",
      es: "Carpetas %TEMP% y Windows\\Temp",
    },
  },
  {
    id: "recycle",
    icon: "🗑",
    n: { en: "Recycle Bin", es: "Papelera de reciclaje" },
    d: {
      en: "Empty all drives recycle bins",
      es: "Vaciar papelera de todas las unidades",
    },
  },
  {
    id: "prefetch",
    icon: "⚡",
    n: { en: "Prefetch files", es: "Archivos Prefetch" },
    d: {
      en: "Windows\\Prefetch — safe to delete",
      es: "Windows\\Prefetch — seguro de borrar",
    },
  },
  {
    id: "winupdate",
    icon: "🔽",
    n: { en: "Windows Update cache", es: "Caché de Windows Update" },
    d: {
      en: "SoftwareDistribution\\Download folder",
      es: "Carpeta SoftwareDistribution\\Download",
    },
  },
  {
    id: "thumbnails",
    icon: "🖼",
    n: { en: "Thumbnail cache", es: "Caché de miniaturas" },
    d: {
      en: "Explorer thumbnail cache files",
      es: "Archivos de caché de miniaturas",
    },
  },
  {
    id: "dnscache",
    icon: "🌐",
    n: { en: "DNS cache", es: "Caché DNS" },
    d: { en: "Flush DNS resolver cache", es: "Limpiar caché del resolver DNS" },
  },
  {
    id: "memorydump",
    icon: "💥",
    n: { en: "Memory dumps", es: "Volcados de memoria" },
    d: {
      en: "MEMORY.DMP + Minidump folder",
      es: "MEMORY.DMP + carpeta Minidump",
    },
  },
];
let cleanPicked = new Set();

function drawCleanup() {
  document.getElementById("tab-cleanup-label").textContent = T("tabCleanup");
  document.getElementById("cleanup-desc").textContent = T("cleanupDesc");
  document.getElementById("btn-cleanup-text").textContent =
    cleanPicked.size > 0
      ? T("cleanupBtnCount").replace("{n}", cleanPicked.size)
      : T("cleanupBtn");
  const g = document.getElementById("cleanup-grid");
  g.replaceChildren(
    ...CLEANUP_TASKS.map((t) => {
      const sel = cleanPicked.has(t.id);
      return h(
        "label",
        { className: "cleanup-item" + (sel ? " selected" : "") },
        h(
          "label",
          { className: "toggle" },
          h("input", {
            type: "checkbox",
            "data-cid": t.id,
            checked: sel,
          }),
          h("span", { className: "toggle-slider" }),
        ),
        h("span", { style: "font-size:1.2em", textContent: t.icon }),
        h(
          "div",
          { className: "cleanup-item-body" },
          h("div", { className: "cleanup-item-name", textContent: LO(t.n) }),
          h("div", { className: "cleanup-item-desc", textContent: LO(t.d) }),
        ),
      );
    }),
  );
  g.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener("change", function () {
      if (this.checked) cleanPicked.add(this.dataset.cid);
      else cleanPicked.delete(this.dataset.cid);
      this.closest(".cleanup-item").classList.toggle("selected", this.checked);
      const has = cleanPicked.size > 0;
      document.getElementById("btn-cleanup-text").textContent = has
        ? T("cleanupBtnCount").replace("{n}", cleanPicked.size)
        : T("cleanupBtn");
      document.getElementById("btn-run-cleanup").disabled = busy || !has;
    });
  });
  document.getElementById("btn-run-cleanup").disabled = true;
}

async function doCleanup() {
  appendLog("[CMD] Cleanup triggered, selected: " + cleanPicked.size);
  if (busy) {
    appendLog("[WARN] Busy");
    return;
  }
  if (cleanPicked.size === 0) {
    appendLog("[WARN] No items selected");
    return;
  }
  setBusy(true, 300000);
  try {
    setTerm("Cleaning...", "running");
    const r = await window.go.main.App.CleanupRun([...cleanPicked], lang);
    if (r) appendLog(r);
    setTerm(T("idle"), "");
  } catch (e) {
    appendLog("[ERR] Cleanup failed: " + e);
    setTerm("Error", "err");
  }
  setBusy(false);
  cleanPicked.clear();
  drawCleanup();
}

function initTheme() {
  loadTheme();
  document.querySelectorAll(".color-btn").forEach((b) =>
    b.addEventListener("click", function () {
      themeAccent = this.dataset.color;
      applyTheme();
      saveTheme();
    }),
  );
  document
    .getElementById("theme-font-select")
    ?.addEventListener("change", function () {
      themeFont = this.value;
      applyTheme();
      saveTheme();
    });
  document.getElementById("btn-theme-reset")?.addEventListener("click", () => {
    themeAccent = "#39ff14";
    themeFont = "'Segoe UI',system-ui,sans-serif";
    applyTheme();
    saveTheme();
    drawTheme();
    setTerm("Theme reset", "ok");
  });

  // Settings gear toggle
  const settingsBtn = document.getElementById("btn-settings");
  const settingsPanel = document.getElementById("settings-panel");
  if (settingsBtn && settingsPanel) {
    settingsBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      const open = !settingsPanel.classList.contains("hidden");
      settingsPanel.classList.toggle("hidden");
      settingsBtn.classList.toggle("active", !open);
    });
    document.addEventListener("click", function (e) {
      if (!settingsPanel.contains(e.target) && e.target !== settingsBtn) {
        settingsPanel.classList.add("hidden");
        settingsBtn.classList.remove("active");
      }
    });
  }

  // Check for updates button
  document.getElementById("btn-check-update")?.addEventListener("click", () => {
    setTerm(lang === "es" ? "Buscando actualizaciones..." : "Checking for updates...", "running");
    checkForUpdate(true);
  });
}

/* ========= INIT ========= */
async function boot() {
  window.addEventListener("wails:ready", () => {});

  try {
    catData = await window.go.main.App.GetCategories();
  } catch (e) {
    document
      .getElementById("tweaks-grid")
      .replaceChildren(
        h(
          "div",
          { style: "padding:20px;color:var(--rd)", textContent: T("connectionFailed") },
        ),
      );
    return;
  }

  document.querySelectorAll(".tab").forEach((t) =>
    t.addEventListener("click", function () {
      switchTab(this.dataset.tab);
    }),
  );
  initRestoreListeners();
  initUpdateListeners();
  document
    .getElementById("btn-install-apps")
    .addEventListener("click", doInstall);
  document
    .getElementById("btn-apply-tweaks")
    .addEventListener("click", doApply);
  document
    .getElementById("btn-run-features")
    .addEventListener("click", doRunFeatures);
  document
    .getElementById("btn-run-cleanup")
    .addEventListener("click", doCleanup);
  document
    .getElementById("btn-speedtest")
    ?.addEventListener("click", runSpeedTest);
  document
    .getElementById("btn-refresh-health")
    ?.addEventListener("click", loadHealthScore);
  document.getElementById("dns-select")?.addEventListener("change", applyDNS);
  document
    .getElementById("btn-profile-save")
    ?.addEventListener("click", showSaveProfileModal);
  document
    .getElementById("btn-profile-load")
    ?.addEventListener("click", toggleProfileMenu);
  document
    .getElementById("btn-tweaks-clear")
    ?.addEventListener("click", clearTweaksSelection);
  document
    .getElementById("btn-tweaks-select-all")
    ?.addEventListener("click", selectAllTweaks);
  document
    .getElementById("btn-open-shutup10")
    ?.addEventListener("click", openShutUp10);
  document.querySelectorAll(".profile-quick-btn").forEach((btn) => {
    btn.addEventListener("click", function () {
      doLoadProfile(this.dataset.profile);
    });
  });
  let searchTimer = null;
  document.getElementById("apps-search").addEventListener("input", function () {
    appsSearch = this.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(drawApps, 200);
  });
  document
    .getElementById("btn-clear-selection")
    .addEventListener("click", function () {
      pickedA.clear();
      drawApps();
      refreshUI();
    });
  document
    .getElementById("btn-collapse-all")
    .addEventListener("click", function () {
      const cats = [...new Set(APPS.map((a) => a.cat))];
      cats.forEach((c) => collapsedCats.add(c));
      drawApps();
    });
  document
    .getElementById("btn-show-installed")
    .addEventListener("click", function () {
      showInstalledOnly = !showInstalledOnly;
      checkInstalled();
    });

  initTheme();
  initLayoutSplit();
  initTerminalResize();
  initFooterVersion();
  document.getElementById("btn-clear").addEventListener("click", clearTerm);
  document.getElementById("btn-copy").addEventListener("click", copyTerm);
  document
    .querySelector(".term-header")
    .addEventListener("click", function (e) {
      if (e.target.closest("button")) return;
      if (e.target.closest(".term-resize")) return;
      document.getElementById("terminal").classList.toggle("collapsed");
    });
  document.querySelectorAll(".pkg-btn").forEach((b) =>
    b.addEventListener("click", function () {
      pkgMgr = this.dataset.pkg;
      document
        .querySelectorAll(".pkg-btn")
        .forEach((x) => x.classList.toggle("active", x === this));
      drawApps();
    }),
  );
  document.querySelectorAll(".lang-btn").forEach((b) =>
    b.addEventListener("click", function () {
      switchLang(this.dataset.lang);
      document
        .querySelectorAll(".lang-btn")
        .forEach((x) => x.classList.toggle("active", x === this));
    }),
  );
  document
    .getElementById("link-docs")
    ?.addEventListener("click", function (e) {
      e.preventDefault();
      window.go?.main?.App?.OpenURL("https://codewinoptimizer.com/docs");
    });
  document
    .getElementById("link-patreon")
    ?.addEventListener("click", function (e) {
      e.preventDefault();
      window.go?.main?.App?.OpenURL(
        "https://www.patreon.com/c/oscar_dev/membership",
      );
    });
  document
    .getElementById("link-paypal")
    ?.addEventListener("click", function (e) {
      e.preventDefault();
      window.go?.main?.App?.OpenURL("https://paypal.me/botarctic");
    });
  document
    .querySelector(".win-min")
    ?.addEventListener("click", () => window.runtime.WindowMinimise());
  document.querySelector(".win-max")?.addEventListener("click", async () => {
    const m = await window.runtime.WindowIsMaximised();
    m ? window.runtime.WindowUnmaximise() : window.runtime.WindowMaximise();
  });
  document.querySelector(".win-close")?.addEventListener("click", () => {
    try {
      window.runtime.Quit();
    } catch {
      try {
        window.runtime.WindowClose();
      } catch {
        window.go.main.App.Quit();
      }
    }
  });

  document.getElementById("btn-cancel")?.addEventListener("click", async function () {
    try {
      await window.go.main.App.CancelOperation();
      setBusy(false);
      setTerm(T("operationCancelled") || "Cancelled", "err");
    } catch (e) {
      console.warn("[Cancel]", e);
    }
  });

  if (window.runtime?.EventsOn) {
    window.runtime.EventsOn("log", function (d) {
      appendLog(d);
    });
  }
  checkAdmin();
  checkInstalled();
  try {
    const sysLang = (await window.go.main.App.GetSystemLang()).trim();
    console.log("[Lang] Detected system language:", JSON.stringify(sysLang));
    if (sysLang.startsWith("es")) lang = "es";
  } catch (e) {
    console.warn("[Lang] Detection failed:", e);
  }
  switchLang(lang);
  setTerm(T("idle"), "");
  checkForUpdate();
}

let pendingUpdateUrl = "";
async function checkForUpdate(manual) {
  try {
    const raw = await window.go.main.App.CheckForUpdate();
    const data = JSON.parse(raw);
    if (!data.hasUpdate) {
      if (manual) setTerm(T("updateCurrent"), "ok");
      return;
    }
    pendingUpdateUrl = data.downloadUrl || "";
    const banner = document.getElementById("update-banner");
    const text = document.getElementById("update-text");
    const link = document.getElementById("update-link");
    if (!banner || !text || !link) return;
    text.textContent = T("updateAvailable");
    link.textContent = T("updateDownload").replace("{v}", "v" + data.latest);
    link.onclick = async function (e) {
      e.preventDefault();
      if (!pendingUpdateUrl) {
        window.go.main.App.OpenURL(data.updateUrl);
        return;
      }
      link.textContent = T("updating");
      link.style.pointerEvents = "none";
      try {
        const r = await window.go.main.App.DownloadUpdate(pendingUpdateUrl);
        const res = JSON.parse(r);
        if (!res.ok) {
          appendLog("[ERR] Update failed: " + (res.error || "unknown"));
          setTerm(T("updateFailed"), "err");
          link.textContent = T("updateDownload").replace("{v}", "v" + data.latest);
          link.style.pointerEvents = "";
        }
      } catch (err) {
        appendLog("[ERR] Update error: " + err);
        setTerm(T("updateFailed"), "err");
        link.textContent = T("updateDownload").replace("{v}", "v" + data.latest);
        link.style.pointerEvents = "";
      }
    };
    document.getElementById("update-dismiss").onclick = function () {
      banner.classList.add("hidden");
    };
    banner.classList.remove("hidden");
    if (manual) setTerm(T("updateAvailable") + " v" + data.latest, "ok");
  } catch (e) {
    console.warn("[Update] Check failed:", e);
    if (manual) setTerm(T("connectionFailed"), "err");
  }
}

async function loadHealthScore() {
  const panel = document.getElementById("health-score-panel");
  if (!panel) return;
  try {
    const raw = await window.go.main.App.GetHealthScore();
    const d = JSON.parse(raw);
    if (!d.score && d.score !== 0) return;

    const color = d.score >= 80 ? "var(--gn)" : d.score >= 55 ? "var(--yl)" : "var(--rd)";
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
      ram: "RAM", cpu: "CPU", disk: lang === "es" ? "Disco" : "Disk",
      temp: "Temp", uptime: lang === "es" ? "Activo" : "Uptime",
    };
    const bars = document.getElementById("health-bars");
    bars.replaceChildren();
    for (const [key, max] of Object.entries(maxMap)) {
      const val = d.breakdown[key] || 0;
      const pct = Math.round((val / max) * 100);
      const cl = pct >= 80 ? "var(--gn)" : pct >= 50 ? "var(--yl)" : "var(--rd)";
      bars.appendChild(
        h("div", { className: "health-bar-row" },
          h("span", { className: "health-bar-label", textContent: labels[key] || key }),
          h("div", { className: "health-bar-track" },
            h("div", { className: "health-bar-fill", style: "width:" + pct + "%;background:" + cl }),
          ),
          h("span", { className: "health-bar-val", textContent: val + "/" + max }),
        ),
      );
    }

    const tips = document.getElementById("health-tips");
    tips.replaceChildren();
    if (d.tips && d.tips.length > 0) {
      d.tips.forEach(function (t) {
        tips.appendChild(h("div", { className: "health-tip", textContent: t }));
      });
    }

    panel.classList.remove("hidden");
  } catch (e) {
    console.warn("[Health] Failed:", e);
  }
}

function switchLang(l) {
  lang = l;
  document
    .querySelectorAll(".lang-btn")
    .forEach((b) => b.classList.toggle("active", b.dataset.lang === l));
  drawAll();
  switchTab(curTab);
}

/* ========= TABS ========= */
function switchTab(tab) {
  curTab = tab;
  document.querySelectorAll(".tab").forEach((t) => {
    const a = t.dataset.tab === tab;
    t.classList.toggle("active", a);
    t.setAttribute("aria-selected", a);
  });
  document
    .querySelectorAll(".tab-content")
    .forEach((c) => c.classList.toggle("active", c.id === "tab-" + tab));
  if (tab === "tweaks") {
    drawTweaks();
    drawProfileMenu();
  }
  if (tab === "apps") drawApps();
  if (tab === "restore") {
    drawRestore();
  }
  if (tab === "features") drawFeatures();
  if (tab === "monitor") {
    drawMonitor();
    startMonitorPoll();
    loadHealthScore();
  } else {
    stopMonitorPoll();
  }
  if (tab === "cleanup") drawCleanup();
  if (tab === "updates") drawUpdates();
  refreshUI();
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

function drawAll() {
  drawRestore();
  drawApps();
  drawTweaks();
  drawFeatures();
  drawTheme();
  drawMonitor();
  drawCleanup();
  drawUpdates();
  refreshUI();
  drawProfileMenu();
}

/* ========= TAB: APPS ========= */
let collapsedCats = new Set(),
  appsSearch = "",
  showInstalledOnly = false;
function drawApps() {
  document.getElementById("tab-apps-label").textContent = T("tabApps");
  document.getElementById("selected-count-label").textContent =
    pickedA.size > 0 ? T("selectedCount").replace("{n}", pickedA.size) : "";
  document
    .getElementById("btn-show-installed")
    .classList.toggle("active", showInstalledOnly);
  const q = appsSearch.toLowerCase();
  const catOrder = [
    "Navegadores",
    "Multimedia",
    "Desarrollo",
    "Juegos",
    "Comunicacion",
    "AI",
    "Utilidades",
  ];
  const allCats = [...new Set(APPS.map((a) => a.cat))].sort((a, b) => {
    const ai = catOrder.indexOf(a),
      bi = catOrder.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
  const grid = document.getElementById("apps-grid");
  grid.replaceChildren(
    ...allCats
      .map((c, ci) => {
        const apps = APPS.filter(
          (a) =>
            a.cat === c &&
            (!q ||
              LO(a.n).toLowerCase().includes(q) ||
              (a.id && a.id.includes(q))) &&
            (!showInstalledOnly || installedSet.has(a.id)),
        );
        if (apps.length === 0) return null;
        const collapsed = collapsedCats.has(c);
        return h(
          "div",
          { className: "app-cat-section" + (collapsed ? " collapsed" : ""), "data-cat": c },
          h("div", { className: "app-cat-title" },
            h("span", { className: "app-cat-arrow", textContent: "▼" }),
            T("cat" + c),
            h("span", { className: "app-cat-sel-all", "data-ci": String(ci), textContent: T("selectAll") }),
            h("span", { style: "font-weight:400;color:var(--tx3);margin-left:auto", textContent: apps.length + " apps" }),
          ),
          h("div", { className: "app-cat-grid" },
            apps.map((a) => {
              const pkg = pkgMgr === "winget" ? a.w : a.c;
              const noPkg = !pkg;
              const isInst = installedSet.has(a.id);
              return h(
                "div",
                { className: "app-card" + (pickedA.has(a.id) ? " selected" : "") + (isInst ? " installed" : ""), "data-aid": a.id },
                h("label", { className: "toggle" },
                  h("input", { type: "checkbox", "data-aid": a.id, checked: pickedA.has(a.id), disabled: noPkg || isInst }),
                  h("span", { className: "toggle-slider" }),
                ),
                a.img
                  ? h("img", { className: "app-icon", src: a.img, alt: "" })
                  : h("span", { className: "app-icon", textContent: a.icon }),
                h("div", { className: "app-info" },
                  h("div", { className: "app-name" },
                    LO(a.n),
                    isInst ? h("span", { className: "app-inst-badge", textContent: T("installed") }) : null,
                  ),
                  h("div", { className: "app-desc", textContent: LO(a.d) }),
                  h("div", { className: "app-actions" },
                    h("button", { className: "app-btn app-btn-uninstall", "data-aid": a.id, "data-action": "uninstall", disabled: noPkg && !isInst, textContent: T("uninstall") }),
                    h("button", { className: "app-btn app-btn-web", "data-aid": a.id, "data-action": "web", textContent: T("website") }),
                  ),
                ),
              );
            }),
          ),
        );
      })
      .filter(Boolean),
  );

  grid.querySelectorAll(".app-card").forEach((card) => {
    card.addEventListener("click", function (e) {
      if (
        e.target.tagName === "INPUT" ||
        e.target.closest("button") ||
        e.target.closest("label")
      )
        return;
      const cb = this.querySelector('input[type="checkbox"]');
      cb.checked = !cb.checked;
      cb.dispatchEvent(new Event("change"));
    });
  });
  grid.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener("change", function (e) {
      e.stopPropagation();
      const id = this.dataset.aid;
      if (this.checked) pickedA.add(id);
      else pickedA.delete(id);
      this.closest(".app-card").classList.toggle("selected", this.checked);
      refreshUI();
    });
  });
  grid.querySelectorAll(".app-cat-title").forEach((title) => {
    title.addEventListener("click", function (e) {
      if (e.target.closest(".app-cat-sel-all")) return;
      const cat = this.parentElement.dataset.cat;
      collapsedCats.has(cat)
        ? collapsedCats.delete(cat)
        : collapsedCats.add(cat);
      drawApps();
    });
  });
  grid.querySelectorAll(".app-cat-sel-all").forEach((el) => {
    el.addEventListener("click", function (e) {
      e.stopPropagation();
      const ci = parseInt(this.dataset.ci);
      const c = allCats[ci];
      if (!c) return;
      const apps = APPS.filter(
        (a) => a.cat === c && (!q || LO(a.n).toLowerCase().includes(q)),
      );
      const all = apps.every((a) => pickedA.has(a.id));
      apps.forEach((a) => (all ? pickedA.delete(a.id) : pickedA.add(a.id)));
      drawApps();
      refreshUI();
    });
  });
  grid.querySelectorAll(".app-btn-uninstall").forEach((btn) => {
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      doUninstall(this.dataset.aid);
    });
  });
  grid.querySelectorAll(".app-btn-web").forEach((btn) => {
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      const app = APPS.find((a) => a.id === this.dataset.aid);
      if (app && app.u) window.go.main.App.OpenURL(app.u);
    });
  });
}

async function doInstall() {
  if (busy || pickedA.size === 0) return;
  setBusy(true, 300000);
  setTerm(T("installRunning"), "running");
  const ids = Array.from(pickedA)
    .map((id) => {
      const a = APPS.find((x) => x.id === id);
      return a ? (pkgMgr === "winget" ? a.w : a.c) : id;
    })
    .filter((id) => id);
  if (ids.length === 0) {
    appendLog("[WARN] No installable apps selected for " + pkgMgr);
    setBusy(false);
    return;
  }
  appendLog(
    "--- " +
      T("installRunning") +
      " (" +
      ids.length +
      " apps via " +
      (pkgMgr === "winget" ? "WinGet" : "Chocolatey") +
      ") ---",
  );
  try {
    const r = await window.go.main.App.InstallApps(ids, lang, pkgMgr);
    if (r) appendLog(r);
    appendLog("[OK] " + T("installOk"));
    setTerm(T("installOk"), "ok");
  } catch (e) {
    appendLog("[ERR] " + T("installFail") + ": " + e);
    setTerm(T("installFail"), "err");
  }
  setBusy(false);
  checkInstalled();
}

async function doUninstall(appId) {
  const app = APPS.find((a) => a.id === appId);
  if (!app) return;
  const name = LO(app.n);
  const pkg = pkgMgr === "winget" ? app.w : app.c;
  if (
    !(await showConfirm(
      T("confirm"),
      `Uninstall ${name} via ${pkgMgr === "winget" ? "WinGet" : "Chocolatey"}?`,
    ))
  )
    return;
  if (busy) return;
  setBusy(true, 300000);
  appendLog("--- Uninstalling: " + name + " (" + pkg + ") ---");
  setTerm("Uninstalling...", "running");
  try {
    await window.go.main.App.UninstallApp(pkg, pkgMgr);
    appendLog("[OK] " + name + " uninstalled");
    setTerm("Uninstall complete", "ok");
  } catch (e) {
    appendLog("[ERR] Uninstall failed: " + e);
    setTerm("Uninstall failed", "err");
  }
  setBusy(false);
  checkInstalled();
}

/* ========= TAB: TWEAKS ========= */
function drawTweaks() {
  document.getElementById("tab-tweaks-label").textContent = T("tabTweaks");
  const grid = document.getElementById("tweaks-grid");
  grid.replaceChildren(...catData.map((c, ci) => catCard(c, ci)));
  bindTweakEv();
}

function catCard(c, ci) {
  const n = LO(c.name);
  const w = c.tweaks.filter((t) => t.commands && t.commands.length > 0);
  const sel = w.filter((t) => pickedT.has(t.id)).length;
  const allSel = sel > 0 && sel === w.length;
  return h("div", { className: "cat-card", "data-ci": String(ci) },
    h("div", { className: "cat-head" },
      h("div", { className: "cat-head-left" },
        h("span", { className: "cat-name", textContent: n }),
      ),
      h("div", { style: "display:flex;align-items:center;gap:10px" },
        h("span", {
          className: "cat-badge" + (allSel ? " cat-badge-full" : sel > 0 ? " cat-badge-partial" : ""),
          "data-ci": String(ci),
          textContent: `${sel} / ${w.length}`,
        }),
        h("span", { className: "cat-arrow", textContent: "▼" }),
      ),
    ),
    h("div", { className: "cat-body" },
      h("div", { className: "cat-sel-all", "data-ci": String(ci) },
        h("button", { className: "cat-sel-all-btn", type: "button" },
          h("span", { className: "sel-ico", textContent: "☐" }),
          h("span", { className: "sel-lbl", textContent: T("selectAll") }),
        ),
      ),
      c.tweaks.map((t) => tweakRow(t)),
    ),
  );
}

function tweakRow(t) {
  const n = LO(t.name);
  const d = LO(t.description);
  const cmds = (t.commands || []).length;
  const hasW = (t.warnings?.[lang] || t.warnings?.["en"] || []).length > 0;
  const uid = "tcb-" + t.id;
  const isInfo = cmds === 0;
  return h("div", { className: "tweak-row" + (isInfo ? " tweak-row-info" : ""), "data-tid": t.id },
    h("div", { className: "tweak-left" },
      isInfo
        ? h("span", { className: "tweak-info-ico", textContent: "ℹ" })
        : h("label", { className: "toggle" },
            h("input", { type: "checkbox", id: uid, "data-tid": t.id, checked: pickedT.has(t.id) }),
            h("span", { className: "toggle-slider" }),
          ),
      isInfo
        ? null
        : h("button", { className: "tweak-more-btn", "data-tid": t.id, type: "button", title: T("tweakMoreInfo"), textContent: "ℹ️" }),
    ),
    h("label", { className: "tweak-row-main", for: isInfo ? null : uid },
      h("div", { className: "tweak-inf" },
        h("div", { className: "tweak-inf-name" },
          h("span", { textContent: n }),
          hasW ? h("span", { className: "warn-dot", textContent: "●" }) : null,
        ),
        h("div", { className: "tweak-inf-desc", textContent: d }),
        h("div", { className: "tweak-inf-meta" },
          h("span", { className: "badge badge-" + t.impact, textContent: t.impact }),
          isInfo
            ? h("span", null, "info")
            : h("span", null, cmds + " " + T("cmds")),
        ),
      ),
    ),
  );
}

function bindTweakEv() {
  document.querySelectorAll(".cat-card").forEach((card) => {
    card.querySelector(".cat-head").addEventListener("click", function (e) {
      if (e.target.tagName === "INPUT") return;
      const w = card.classList.contains("expanded");
      document
        .querySelectorAll(".cat-card")
        .forEach((c) => c.classList.remove("expanded"));
      if (!w) {
        card.classList.add("expanded");
        setTimeout(
          () => card.scrollIntoView({ behavior: "smooth", block: "start" }),
          50,
        );
      }
    });
  });
  document.querySelectorAll(".cat-sel-all").forEach((el) => {
    el.addEventListener("click", function (e) {
      e.stopPropagation();
      const ci = parseInt(this.dataset.ci);
      const cat = catData[ci];
      if (!cat) return;
      const tw = cat.tweaks.filter((t) => t.commands && t.commands.length > 0);
      const all = tw.length > 0 && tw.every((t) => pickedT.has(t.id));
      tw.forEach((t) => (all ? pickedT.delete(t.id) : pickedT.add(t.id)));
      syncTweakCb(ci);
      refreshUI();
    });
  });
  document
    .querySelectorAll('.tweak-row input[type="checkbox"]')
    .forEach((cb) => {
      cb.addEventListener("change", function (e) {
        e.stopPropagation();
        const id = this.dataset.tid;
        if (this.checked) pickedT.add(id);
        else pickedT.delete(id);
        const card = this.closest(".cat-card");
        if (card) updateCatBadge(parseInt(card.dataset.ci));
        refreshUI();
      });
    });
  document.querySelectorAll(".tweak-row-main").forEach((row) => {
    row.addEventListener("click", function (e) {
      if (e.target.tagName === "INPUT" || e.target.closest(".toggle")) return;
      const cb = this.closest(".tweak-row").querySelector(
        '.tweak-left input[type="checkbox"]',
      );
      if (cb && !cb.disabled) {
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event("change"));
      }
    });
  });
  document.querySelectorAll(".tweak-more-btn").forEach((btn) => {
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      e.preventDefault();
      const tid = this.dataset.tid;
      const href = `https://codewinoptimizer.com/docs/tweaks/${tid}`;
      window.go.main.App.OpenURL(href);
      appendLog(`[DOCS] Opening: ${href}`);
    });
  });
}

function syncTweakCb(ci) {
  const card = document.querySelector(`.cat-card[data-ci="${ci}"]`);
  if (!card) return;
  const cat = catData[ci];
  if (!cat) return;
  const tw = cat.tweaks.filter((t) => t.commands && t.commands.length > 0);
  const all = tw.length > 0 && tw.every((t) => pickedT.has(t.id));
  const lbl = card.querySelector(".sel-lbl");
  const ico = card.querySelector(".sel-ico");
  const btn = card.querySelector(".cat-sel-all-btn");
  if (lbl) lbl.textContent = all ? T("deselectAll") : T("selectAll");
  if (ico) ico.textContent = all ? "☑" : "☐";
  if (btn) btn.classList.toggle("all-selected", all);
  card.querySelectorAll('.tweak-row input[type="checkbox"]').forEach((cb) => {
    if (cb.disabled) return;
    cb.checked = pickedT.has(cb.dataset.tid);
  });
  updateCatBadge(ci);
}

function updateCatBadge(ci) {
  const card = document.querySelector(`.cat-card[data-ci="${ci}"]`);
  if (!card) return;
  const cat = catData[ci];
  if (!cat) return;
  const tw = cat.tweaks.filter((t) => t.commands && t.commands.length > 0);
  const sel = tw.filter((t) => pickedT.has(t.id)).length;
  const badge = card.querySelector(".cat-badge");
  if (!badge) return;
  badge.textContent = `${sel} / ${tw.length}`;
  badge.classList.toggle("cat-badge-full", sel > 0 && sel === tw.length);
  badge.classList.toggle("cat-badge-partial", sel > 0 && sel < tw.length);
}

async function doApply() {
  if (busy || pickedT.size === 0) return;
  setBusy(true, 300000);
  setTerm(T("tweaksRunning"), "running");
  const ids = Array.from(pickedT);
  appendLog("--- " + T("tweaksRunning") + " (" + ids.length + " tweaks) ---");
  let ok = false;
  try {
    const r = await window.go.main.App.RunCommands(ids, lang);
    if (r) appendLog(r);
    appendLog("[OK] " + T("tweaksDone"));
    setTerm(T("tweaksDone"), "ok");
    ok = true;
  } catch (e) {
    appendLog("[ERR] " + e);
    setTerm("Error", "err");
  }
  setBusy(false);
  if (ok) await promptRestart();
}

async function openShutUp10() {
  try {
    const result = await window.go.main.App.LaunchShutUp10();
    if (result) appendLog("[ERR] " + result);
  } catch (e) {
    appendLog("[ERR] " + e);
  }
}

async function promptRestart() {
  const yes = await showConfirm(T("restartTitle"), T("restartMsg"));
  if (!yes) {
    appendLog("[INFO] " + T("restartLater"));
    return;
  }
  try {
    const err = await window.go.main.App.RestartSystem();
    if (err) {
      appendLog("[ERR] Restart failed: " + err);
    } else {
      appendLog("[OK] " + T("restartScheduled"));
      setTerm(T("restartScheduled"), "ok");
    }
  } catch (e) {
    appendLog("[ERR] " + e);
  }
}

/* ========= TAB: FEATURES ========= */
const pickedF = new Set();
function drawFeatures() {
  document.getElementById("tab-features-label").textContent = T("tabFeatures");
  document.getElementById("ft-features-title").textContent =
    T("ftFeaturesTitle");
  document.getElementById("ft-fixes-title").textContent = T("ftFixesTitle");
  document.getElementById("btn-features-text").textContent =
    pickedF.size > 0
      ? T("runFeatures") + " (" + pickedF.size + ")"
      : T("runFeatures");

  document.getElementById("ft-features-grid").replaceChildren(
    ...FEATURES.map((f) =>
      h(
        "label",
        { className: "ft-row" },
        h(
          "label",
          { className: "toggle" },
          h("input", {
            type: "checkbox",
            "data-fid": f.id,
            checked: pickedF.has(f.id),
          }),
          h("span", { className: "toggle-slider" }),
        ),
        h("span", { textContent: LO(f.n) }),
      ),
    ),
  );

  document.getElementById("ft-fixes-grid").replaceChildren(
    ...FIXES.map((f) =>
      h("button", {
        className: "ft-fix-btn",
        "data-fix": f.id,
        textContent: LO(f.n),
      }),
    ),
  );

  document
    .querySelectorAll('#ft-features-grid input[type="checkbox"]')
    .forEach((cb) => {
      cb.addEventListener("change", function () {
        const id = this.dataset.fid;
        if (this.checked) pickedF.add(id);
        else pickedF.delete(id);
        drawFeatures();
      });
    });
  document.querySelectorAll(".ft-fix-btn").forEach((btn) => {
    btn.addEventListener("click", function () {
      doRunFix(this.dataset.fix);
    });
  });
}

async function doRunFeatures() {
  if (busy || pickedF.size === 0) return;
  setBusy(true, 300000);
  setTerm(T("ftRunning"), "running");
  const fts = FEATURES.filter((f) => pickedF.has(f.id));
  appendLog("--- " + T("ftRunning") + " (" + fts.length + " features) ---");
  try {
    for (const f of fts) {
      try {
        appendLog("[CMD] " + LO(f.n));
        await window.go.main.App.RunFeature(f.id);
      } catch (e) {
        appendLog("[ERR] " + LO(f.n) + ": " + e);
      }
    }
    appendLog("[OK] " + T("ftDone"));
    setTerm(T("ftDone"), "ok");
  } finally {
    setBusy(false);
  }
}

async function doRunFix(fixId) {
  if (busy) return;
  const f = FIXES.find((x) => x.id === fixId);
  if (!f) return;
  setBusy(true, 300000);
  setTerm(T("ftRunning"), "running");
  appendLog("--- " + LO(f.n) + " ---");
  try {
    await window.go.main.App.RunFix(f.id);
    appendLog("[OK] " + T("ftDone"));
    setTerm(T("ftDone"), "ok");
  } catch (e) {
    appendLog("[ERR] " + e);
    setTerm("Error", "err");
  } finally {
    setBusy(false);
  }
}

/* ========= UI ========= */
function refreshUI() {
  document.getElementById("term-title").textContent = T("terminal");
  const ab = document.getElementById("btn-apply-tweaks"),
    at = document.getElementById("btn-apply-text");
  const ib = document.getElementById("btn-install-apps"),
    it = document.getElementById("btn-install-text");
  refreshRestoreUI();
  refreshUpdateUI();

  const tc = pickedT.size;
  ab.disabled = busy || tc === 0;
  at.textContent = busy
    ? "..."
    : tc > 0
      ? T("applyCount").replace("{n}", tc)
      : T("selectFirst");
  document.getElementById("tweaks-count-label").textContent =
    tc > 0 ? T("applyCount").replace("{n}", tc) : "";

  const ac = pickedA.size;
  ib.disabled = busy || ac === 0;
  it.textContent = busy
    ? "..."
    : ac > 0
      ? T("installCount").replace("{n}", ac)
      : T("installBtn");
  document.getElementById("apps-count-label").textContent =
    ac > 0 ? T("installCount").replace("{n}", ac) : "";

  document.querySelectorAll(".cat-card").forEach((c) => {
    const ci = parseInt(c.dataset.ci);
    if (!isNaN(ci)) syncTweakCb(ci);
  });
}

/* ========= TERMINAL ========= */

async function checkAdmin() {
  try {
    const ok = await window.go.main.App.CheckAdmin();
    if (!ok) {
      document.getElementById("warning-text").textContent = T("adminWarn");
      document.getElementById("admin-warning").classList.remove("hidden");
    }
  } catch (e) {
    console.warn("[Admin] Failed to check admin status:", e);
  }
}

async function checkInstalled() {
  try {
    const raw = await window.go.main.App.GetInstalledPackages();
    const ids = JSON.parse(raw);
    if (Array.isArray(ids)) {
      installedSet = new Set(ids);
      APPS.forEach((a) => {
        if (a.w && ids.includes(a.w)) installedSet.add(a.id);
      });
    }
  } catch (e) {
    console.warn("[Apps] Failed to check installed packages:", e);
  }
  drawApps();
}

/* ========= TWEAK PROFILES ========= */

function drawProfileMenu() {
  const btnLoad = document.getElementById("btn-profile-load-text");
  const btnSave = document.getElementById("btn-profile-save-text");
  const btnClear = document.getElementById("btn-tweaks-clear-text");
  const btnSelAll = document.getElementById("btn-tweaks-select-all-text");
  if (btnLoad) btnLoad.textContent = T("profileLoad");
  if (btnSave) btnSave.textContent = T("profileSave");
  if (btnClear) btnClear.textContent = T("tweaksClear");
  if (btnSelAll) btnSelAll.textContent = T("tweaksSelectAllGlobal");
}

async function toggleProfileMenu() {
  const menu = document.getElementById("profile-menu");
  if (!menu) return;
  if (!menu.classList.contains("hidden")) {
    menu.classList.add("hidden");
    return;
  }

  let profiles = [];
  try {
    const raw = await window.go.main.App.ListProfiles();
    profiles = JSON.parse(raw);
  } catch (e) {
    console.warn("[Profiles] Failed to list profiles:", e);
  }

  menu.replaceChildren();
  if (profiles.length === 0) {
    const empty = document.createElement("div");
    empty.className = "profile-dropdown-item disabled";
    empty.textContent = T("profileEmpty");
    menu.appendChild(empty);
  } else {
    profiles.forEach((p) => {
      const item = document.createElement("div");
      item.className = "profile-dropdown-item";
      const name = document.createElement("span");
      name.className = "profile-name";
      name.dataset.name = p;
      name.textContent = p;
      const acts = document.createElement("span");
      acts.className = "profile-actions";
      const loadBtn = document.createElement("button");
      loadBtn.className = "profile-btn-load";
      loadBtn.dataset.name = p;
      loadBtn.title = T("profileLoad");
      loadBtn.textContent = "▶";
      const delBtn = document.createElement("button");
      delBtn.className = "profile-btn-del";
      delBtn.dataset.name = p;
      delBtn.title = T("profileDelete");
      delBtn.textContent = "✕";
      acts.append(loadBtn, delBtn);
      item.append(name, acts);
      menu.appendChild(item);
    });
  }
  menu.classList.remove("hidden");

  // Close on outside click
  setTimeout(() => {
    const close = (e) => {
      if (!menu.contains(e.target) && e.target.id !== "btn-profile-load") {
        menu.classList.add("hidden");
        document.removeEventListener("click", close);
      }
    };
    document.addEventListener("click", close);
  }, 0);

  menu.querySelectorAll(".profile-btn-load").forEach((b) => {
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      doLoadProfile(b.dataset.name);
      document.getElementById("profile-menu").classList.add("hidden");
    });
  });
  menu.querySelectorAll(".profile-btn-del").forEach((b) => {
    b.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (
        await showConfirm(
          T("confirm"),
          `${T("profileDeleteConfirm")} "${b.dataset.name}"?`,
        )
      )
        doDeleteProfile(b.dataset.name);
    });
  });
}

function showSaveProfileModal() {
  const existing = document.getElementById("profile-save-modal");
  if (existing) existing.remove();

  const html = `<div class="startup-modal-overlay" id="profile-save-modal">
    <div class="startup-modal" style="min-width:340px;max-width:400px">
      <h3 style="margin:0 0 14px;font-size:1.1em">${T("profileSaveTitle")}</h3>
      <div style="margin-bottom:16px">
        <label style="font-size:.8em;color:var(--tx2);display:block;margin-bottom:4px">${T("profileName")}</label>
        <input type="text" id="profile-save-name" class="rp-name-input" style="width:100%;text-align:left;max-width:100%" placeholder="Gaming, Work, Minimal..." maxlength="32">
      </div>
      <div style="font-size:.78em;color:var(--tx3);margin-bottom:16px">${pickedT.size} ${T("profileTweaksSelected")}</div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button id="profile-save-cancel" class="btn-secondary" style="padding:8px 18px;font-size:.82em">${T("profileCancel")}</button>
        <button id="profile-save-ok" class="btn-primary" style="padding:8px 18px;font-size:.82em">${T("profileSave")}</button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML("beforeend", html);

  document
    .getElementById("profile-save-cancel")
    .addEventListener("click", () =>
      document.getElementById("profile-save-modal").remove(),
    );
  document.getElementById("profile-save-ok").addEventListener("click", () => {
    const name = document.getElementById("profile-save-name").value.trim();
    if (!name) {
      appendLog("[WARN] Profile name required");
      return;
    }
    if (pickedT.size === 0) {
      appendLog("[WARN] No tweaks selected");
      return;
    }
    doSaveProfile(name);
    document.getElementById("profile-save-modal").remove();
  });
  document
    .getElementById("profile-save-modal")
    .addEventListener("click", function (e) {
      if (e.target === this) this.remove();
    });
}

async function doSaveProfile(name) {
  try {
    const ids = Array.from(pickedT);
    const r = await window.go.main.App.SaveProfile(name, ids);
    appendLog(r);
  } catch (e) {
    appendLog("[ERR] Save profile failed: " + e);
  }
}

async function doLoadProfile(name) {
  try {
    const raw = await window.go.main.App.LoadProfile(name);
    if (raw.startsWith("[ERR]")) {
      appendLog(raw);
      return;
    }
    const ids = JSON.parse(raw);
    if (!Array.isArray(ids)) {
      appendLog("[ERR] Invalid profile data");
      return;
    }
    pickedT = new Set(ids);
    drawTweaks();
    refreshUI();
    appendLog(`[OK] Profile loaded: ${name} (${ids.length} tweaks)`);
  } catch (e) {
    appendLog("[ERR] Load profile failed: " + e);
  }
}

async function doDeleteProfile(name) {
  try {
    const r = await window.go.main.App.DeleteProfile(name);
    appendLog(r);
    toggleProfileMenu();
  } catch (e) {
    appendLog("[ERR] Delete profile failed: " + e);
  }
}

function clearTweaksSelection() {
  const count = pickedT.size;
  if (count === 0) return;
  pickedT.clear();
  drawTweaks();
  refreshUI();
  appendLog(`[OK] Cleared ${count} selected tweak(s)`);
}

function selectAllTweaks() {
  let added = 0;
  catData.forEach((c) => {
    c.tweaks.forEach((t) => {
      if (t.commands && t.commands.length > 0 && !pickedT.has(t.id)) {
        pickedT.add(t.id);
        added++;
      }
    });
  });
  if (added === 0) return;
  drawTweaks();
  refreshUI();
  appendLog(`[OK] Selected ${added} additional tweak(s) (total: ${pickedT.size})`);
}

async function initFooterVersion() {
  const el = document.getElementById("footer-version");
  if (!el) return;
  try {
    const v = await window.go.main.App.GetVersion();
    if (v) el.textContent = "v" + v;
  } catch (e) {
    // Keep hardcoded fallback
  }
}

/* ========= LAYOUT: HORIZONTAL SPLIT + RESIZABLE TERMINAL ========= */
function initLayoutSplit() {
  const app = document.getElementById("app");
  if (!app) return;
  if (app.querySelector(".main-split")) return;
  const nav = app.querySelector("nav.tabs");
  const terminal = document.getElementById("terminal");
  if (!nav || !terminal) return;
  const split = document.createElement("div");
  split.className = "main-split";
  const tabArea = document.createElement("div");
  tabArea.className = "tab-area";
  app.querySelectorAll(".tab-content").forEach((tc) => tabArea.appendChild(tc));
  split.appendChild(tabArea);
  split.appendChild(terminal);
  nav.insertAdjacentElement("afterend", split);
}

function initTerminalResize() {
  const term = document.getElementById("terminal");
  if (!term) return;
  if (term.querySelector(".term-resize")) return;
  const handle = document.createElement("div");
  handle.className = "term-resize";
  handle.title = "Drag to resize terminal";
  term.insertBefore(handle, term.firstChild);
  try {
    const saved = parseInt(localStorage.getItem("cwo-term-width"), 10);
    if (saved && saved >= 280 && saved <= window.innerWidth * 0.7) {
      term.style.setProperty("--term-width", saved + "px");
    }
  } catch (e) {}
  let dragging = false;
  let startX = 0;
  let startW = 0;
  handle.addEventListener("mousedown", function (e) {
    if (term.classList.contains("collapsed")) return;
    e.preventDefault();
    e.stopPropagation();
    dragging = true;
    startX = e.clientX;
    startW = term.getBoundingClientRect().width;
    handle.classList.add("dragging");
    document.body.style.userSelect = "none";
    document.body.style.cursor = "ew-resize";
  });
  document.addEventListener("mousemove", function (e) {
    if (!dragging) return;
    const dx = startX - e.clientX;
    const newW = Math.max(
      280,
      Math.min(Math.floor(window.innerWidth * 0.7), startW + dx),
    );
    term.style.setProperty("--term-width", newW + "px");
  });
  document.addEventListener("mouseup", function () {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove("dragging");
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
    try {
      const w = parseInt(
        term.style.getPropertyValue("--term-width") || "380",
        10,
      );
      if (w) localStorage.setItem("cwo-term-width", String(w));
    } catch (e) {}
  });
}

document.addEventListener("DOMContentLoaded", boot);
window.addEventListener("beforeunload", () => {
  stopMonitorPoll();
  if (busyTimer) {
    clearTimeout(busyTimer);
    busyTimer = null;
  }
});
