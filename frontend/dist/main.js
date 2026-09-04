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

/* Monitor tab logic lives in js/monitor.js (drawMonitor, fetchMonitor,
 * fetchNetworkLatency, fetchCurrentDNS, applyDNS, runSpeedTest,
 * loadHealthScore, start/stopMonitorPoll, initMonitorListeners). */


// SVG paths (Lucide-style) for cleanup icons. Wrapped in <svg> at render time.
function makeSvgIcon(paths) {
  const el = document.createElement("span");
  el.className = "cleanup-icon";
  el.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    paths +
    "</svg>";
  return el;
}
const CLEANUP_TASKS = [
  {
    id: "temp",
    svg: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
    n: { en: "Temporary files", es: "Archivos temporales" },
    d: {
      en: "%TEMP% and Windows\\Temp folders",
      es: "Carpetas %TEMP% y Windows\\Temp",
    },
  },
  {
    id: "recycle",
    svg: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
    n: { en: "Recycle Bin", es: "Papelera de reciclaje" },
    d: {
      en: "Empty all drives recycle bins",
      es: "Vaciar papelera de todas las unidades",
    },
  },
  {
    id: "prefetch",
    svg: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
    n: { en: "Prefetch files", es: "Archivos Prefetch" },
    d: {
      en: "Windows\\Prefetch — safe to delete",
      es: "Windows\\Prefetch — seguro de borrar",
    },
  },
  {
    id: "winupdate",
    svg: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    n: { en: "Windows Update cache", es: "Caché de Windows Update" },
    d: {
      en: "SoftwareDistribution\\Download folder",
      es: "Carpeta SoftwareDistribution\\Download",
    },
  },
  {
    id: "thumbnails",
    svg: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
    n: { en: "Thumbnail cache", es: "Caché de miniaturas" },
    d: {
      en: "Explorer thumbnail cache files",
      es: "Archivos de caché de miniaturas",
    },
  },
  {
    id: "dnscache",
    svg: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
    n: { en: "DNS cache", es: "Caché DNS" },
    d: { en: "Flush DNS resolver cache", es: "Limpiar caché del resolver DNS" },
  },
  {
    id: "memorydump",
    svg: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="12" y1="9" x2="12.01" y2="9"/>',
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
        makeSvgIcon(t.svg),
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
  initMonitorListeners();
  initStartupListeners();
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
  let tweakSearchTimer = null;
  document.getElementById("tweak-search").addEventListener("input", function () {
    tweakQuery = this.value;
    const hint = document.getElementById("tweaks-filter-hint");
    if (hint) {
      const q = tweakQuery.trim();
      if (!q) hint.textContent = "";
      else {
        let n = 0;
        catData.forEach((c) =>
          c.tweaks.forEach((t) => {
            if (tweakMatch(t, q.toLowerCase())) n++;
          }),
        );
        hint.textContent = n === 0 ? T("tweakNoResults") : T("tweakResults").replace("{n}", String(n));
      }
    }
    clearTimeout(tweakSearchTimer);
    tweakSearchTimer = setTimeout(drawTweaks, 150);
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

  // Double-click on header (titlebar) to toggle maximize.
  // Wails' --wails-draggable: drag only handles dragging; dblclick must be wired manually
  // since the window is frameless.
  document.querySelector("header")?.addEventListener("dblclick", async (e) => {
    // Ignore dblclicks that land on interactive controls
    if (e.target.closest("button, a, .win-controls, .support-links, .settings-wrapper")) return;
    if (!window.runtime) return;
    const m = await window.runtime.WindowIsMaximised();
    m ? window.runtime.WindowUnmaximise() : window.runtime.WindowMaximise();
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
  // Make sure the active tab is visible in the scrollable nav
  const activeTab = document.querySelector(".tab.active");
  if (activeTab && typeof activeTab.scrollIntoView === "function") {
    activeTab.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  if (tab === "tweaks") {
    drawTweaks();
    drawTweakActionLabels();
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
  if (tab === "startup") drawStartup();
  refreshUI();
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
  drawStartup();
  refreshUI();
  drawTweakActionLabels();
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
    "MicrosoftTools",
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
                    isInst
                      ? h("button", { className: "app-btn app-btn-uninstall", "data-aid": a.id, "data-action": "uninstall", disabled: noPkg, textContent: T("uninstall") })
                      : h("button", { className: "app-btn app-btn-install", "data-aid": a.id, "data-action": "install", disabled: noPkg, textContent: T("install") }),
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
  grid.querySelectorAll(".app-btn-install").forEach((btn) => {
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      doInstallSingle(this.dataset.aid);
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

async function doInstallSingle(appId) {
  const app = APPS.find((a) => a.id === appId);
  if (!app) return;
  const pkg = pkgMgr === "winget" ? app.w : app.c;
  if (!pkg) {
    appendLog(
      "[WARN] " +
        LO(app.n) +
        " has no " +
        (pkgMgr === "winget" ? "WinGet" : "Chocolatey") +
        " ID — open the website to download manually",
    );
    return;
  }
  if (busy) return;
  setBusy(true, 300000);
  setTerm(T("installRunning"), "running");
  appendLog(
    "--- Installing " +
      LO(app.n) +
      " via " +
      (pkgMgr === "winget" ? "WinGet" : "Chocolatey") +
      " ---",
  );
  try {
    const r = await window.go.main.App.InstallApps([pkg], lang, pkgMgr);
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

/* ========= TAB: TWEAKS (master-detail + búsqueda) ========= */
let curTweakCat = -1, // -1 = "All"
  tweakQuery = "";

function stripTweakEmoji(s) {
  return String(s || "")
    .replace(
      /[\u{1F000}-\u{1FAFF}\u{1F1E6}-\u{1F1FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{2190}-\u{21FF}\u{2B05}-\u{2B07}\u{25A0}-\u{25FF}]/gu,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
}

function tweakSearchable(t) {
  const parts = [t.id || ""];
  for (const k of ["en", "es"]) {
    const n = t.name && t.name[k];
    const d = t.description && t.description[k];
    if (n) parts.push(stripTweakEmoji(n));
    if (d) parts.push(d);
  }
  return parts.join(" ").toLowerCase();
}

function tweakMatch(t, q) {
  return tweakSearchable(t).includes(q);
}

function drawTweaks() {
  document.getElementById("tab-tweaks-label").textContent = T("tabTweaks");
  const pane = document.getElementById("tweak-pane");
  const nav = document.getElementById("tweaks-nav");
  if (!pane || !nav) return;

  const input = document.getElementById("tweak-search");
  if (input) input.placeholder = T("tweakSearch");

  if (curTweakCat == null || curTweakCat >= catData.length) curTweakCat = -1;
  const q = tweakQuery.trim().toLowerCase();

  nav.replaceChildren(tweakNavItem(null, -1, q), ...catData.map((c, ci) => tweakNavItem(c, ci, q)));
  nav.setAttribute("aria-label", T("tweakCategories"));

  if (q) renderTweakResults(q, pane);
  else renderTweakCategory(curTweakCat, pane);

  bindTweakEv();
}

function tweakNavItem(c, ci, q) {
  const isAll = ci === -1;
  let name, w, sel;
  if (isAll) {
    name = T("tweakAll");
    w = [];
    sel = 0;
    catData.forEach((cat) => {
      const tw = cat.tweaks.filter((t) => t.commands && t.commands.length > 0);
      w.push(...tw);
    });
    sel = w.filter((t) => pickedT.has(t.id)).length;
  } else {
    name = stripTweakEmoji(LO(c.name));
    w = c.tweaks.filter((t) => t.commands && t.commands.length > 0);
    sel = w.filter((t) => pickedT.has(t.id)).length;
  }
  const active = !q && curTweakCat === ci;
  return h(
    "button",
    {
      className: "tweak-cat" + (isAll ? " tweak-cat-all" : "") + (active ? " active" : ""),
      "data-ci": String(ci),
      type: "button",
      role: "tab",
      "aria-selected": active ? "true" : "false",
    },
    h("span", { className: "tweak-cat-name", textContent: name }),
    h("span", {
      className:
        "cat-badge" +
        (sel > 0 && sel === w.length ? " cat-badge-full" : sel > 0 ? " cat-badge-partial" : ""),
      textContent: `${sel} / ${w.length}`,
    }),
  );
}

function allTweakStats() {
  let w = 0,
    sel = 0,
    total = 0,
    nInfo = 0;
  catData.forEach((cat) => {
    cat.tweaks.forEach((t) => {
      total++;
      if (t.commands && t.commands.length > 0) {
        w++;
        if (pickedT.has(t.id)) sel++;
      } else nInfo++;
    });
  });
  return { w, sel, total, nInfo };
}

function tweakPaneHead(title, sub, ci) {
  return h(
    "div",
    { className: "tweak-pane-head" },
    h(
      "div",
      { className: "tweak-pane-title" },
      h("h2", { className: "page-title", textContent: title }),
      h("p", { className: "page-sub", textContent: sub }),
    ),
    ci != null
      ? h(
          "div",
          { className: "cat-sel-all", "data-ci": String(ci) },
          h(
            "button",
            { className: "cat-sel-all-btn", type: "button" },
            h("span", { className: "sel-ico", textContent: "☐" }),
            h("span", { className: "sel-lbl", textContent: T("selectAll") }),
          ),
        )
      : null,
  );
}

function renderTweakCategory(ci, pane) {
  if (ci === -1) return renderAllTweaks(pane);
  const c = catData[ci];
  if (!c) return;
  const title = stripTweakEmoji(LO(c.name));
  const nInfo = c.tweaks.filter((t) => !(t.commands && t.commands.length > 0)).length;
  const sub =
    c.tweaks.length +
    " " +
    T("tweaksTotal") +
    (nInfo ? " · " + nInfo + " " + T("tweaksInfoOnly") : "");
  pane.replaceChildren(
    tweakPaneHead(title, sub, ci),
    h("div", { className: "tweak-list" }, ...c.tweaks.map((t) => tweakRow(t))),
  );
  pane.scrollTop = 0;
}

function renderAllTweaks(pane) {
  const st = allTweakStats();
  const sub =
    st.total +
    " " +
    T("tweaksTotal") +
    " · " +
    catData.length +
    " " +
    T("tweakCats");
  const sections = catData
    .map((c, ci) => {
      if (!c.tweaks || c.tweaks.length === 0) return null;
      return h(
        "section",
        { className: "tweak-group", "data-ci": String(ci) },
        h(
          "div",
          { className: "tweak-group-head" },
          h("h3", { className: "tweak-group-title", textContent: stripTweakEmoji(LO(c.name)) }),
          h(
            "div",
            { className: "cat-sel-all", "data-ci": String(ci) },
            h(
              "button",
              { className: "cat-sel-all-btn cat-sel-all-btn-sm", type: "button" },
              h("span", { className: "sel-ico", textContent: "☐" }),
              h("span", { className: "sel-lbl", textContent: T("selectAll") }),
            ),
          ),
        ),
        h("div", { className: "tweak-list" }, ...c.tweaks.map((t) => tweakRow(t))),
      );
    })
    .filter(Boolean);
  pane.replaceChildren(
    tweakPaneHead(T("tweakAllTitle"), sub, null),
    h("div", { className: "tweak-groups" }, ...sections),
  );
  pane.scrollTop = 0;
}

function renderTweakResults(q, pane) {
  const rows = [];
  let n = 0;
  catData.forEach((c) =>
    c.tweaks.forEach((t) => {
      if (tweakMatch(t, q)) {
        rows.push(tweakRow(t));
        n++;
      }
    }),
  );
  if (n === 0) {
    pane.replaceChildren(
      tweakPaneHead(T("tweakNoResults"), T("tweakNoResultsSub")),
      h(
        "div",
        { className: "list-empty tweak-nores" },
        h("svg", { className: "list-empty-icon", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" },
          h("circle", { cx: "11", cy: "11", r: "8" }),
          h("line", { x1: "21", y1: "21", x2: "16.65", y2: "16.65" })),
        h("p", { textContent: '"' + tweakQuery + '"' }),
      ),
    );
    return;
  }
  pane.replaceChildren(
    tweakPaneHead(T("tweakResults").replace("{n}", String(n)), T("tweakResultsSub")),
    h("div", { className: "tweak-list" }, ...rows),
  );
  pane.scrollTop = 0;
}

function tweakRow(t) {
  const n = stripTweakEmoji(LO(t.name));
  const d = LO(t.description);
  const cmds = (t.commands || []).length;
  const hasW = (t.warnings?.[lang] || t.warnings?.["en"] || []).length > 0;
  const uid = "tcb-" + t.id;
  const isInfo = cmds === 0;
  return h(
    "div",
    { className: "tweak-row" + (isInfo ? " tweak-row-info" : ""), "data-tid": t.id },
    isInfo ? h("span", { className: "tweak-info-ico" }) : null,
    h(
      "div",
      { className: "tweak-row-main" },
      h(
        "div",
        { className: "tweak-inf" },
        h(
          "div",
          { className: "tweak-inf-name" },
          h("span", { textContent: n }),
          hasW
            ? h("span", { className: "warn-dot", title: T("tweakHasWarn"), textContent: "●" })
            : null,
        ),
        h("div", { className: "tweak-inf-desc", textContent: d }),
        h(
          "div",
          { className: "tweak-inf-meta" },
          h("span", { className: "badge badge-" + t.impact, textContent: t.impact }),
          isInfo ? h("span", null, "info") : h("span", null, cmds + " " + T("cmds")),
        ),
      ),
    ),
    isInfo
      ? null
      : h(
          "div",
          { className: "tweak-side" },
          h("button", {
            className: "tweak-more-btn",
            "data-tid": t.id,
            type: "button",
            title: T("tweakMoreInfo"),
            "aria-label": T("tweakMoreInfo"),
          }),
          h(
            "label",
            { className: "toggle" },
            h("input", { type: "checkbox", id: uid, "data-tid": t.id, checked: pickedT.has(t.id) }),
            h("span", { className: "toggle-slider" }),
          ),
        ),
  );
}

function updateTweakBadges() {
  const nav = document.getElementById("tweaks-nav");
  if (!nav) return;
  nav.querySelectorAll(".tweak-cat").forEach((btn) => {
    const ci = parseInt(btn.dataset.ci, 10);
    let w = [],
      sel = 0;
    if (ci === -1) {
      catData.forEach((cat) => {
        const tw = cat.tweaks.filter((t) => t.commands && t.commands.length > 0);
        w.push(...tw);
      });
    } else {
      const c = catData[ci];
      if (!c) return;
      w = c.tweaks.filter((t) => t.commands && t.commands.length > 0);
    }
    sel = w.filter((t) => pickedT.has(t.id)).length;
    const badge = btn.querySelector(".cat-badge");
    if (!badge) return;
    badge.textContent = `${sel} / ${w.length}`;
    badge.classList.toggle("cat-badge-full", sel > 0 && sel === w.length);
    badge.classList.toggle("cat-badge-partial", sel > 0 && sel < w.length);
  });
}

function updatePaneHeadState() {
  const pane = document.getElementById("tweak-pane");
  if (!pane) return;
  pane.querySelectorAll(".cat-sel-all").forEach((wrap) => {
    const ci = parseInt(wrap.dataset.ci, 10);
    const c = catData[ci];
    if (!c) return;
    const w = c.tweaks.filter((t) => t.commands && t.commands.length > 0);
    const all = w.length > 0 && w.every((t) => pickedT.has(t.id));
    const lbl = wrap.querySelector(".sel-lbl");
    const ico = wrap.querySelector(".sel-ico");
    const btn = wrap.querySelector(".cat-sel-all-btn");
    if (lbl) lbl.textContent = all ? T("deselectAll") : T("selectAll");
    if (ico) ico.textContent = all ? "☑" : "☐";
    if (btn) btn.classList.toggle("all-selected", all);
  });
  pane.querySelectorAll('.tweak-row input[type="checkbox"]').forEach((cb) => {
    if (cb.disabled) return;
    cb.checked = pickedT.has(cb.dataset.tid);
  });
}

function preservePaneScroll(fn) {
  const pane = document.getElementById("tweak-pane");
  const st = pane ? pane.scrollTop : 0;
  fn();
  if (pane) pane.scrollTop = st;
}

function bindTweakEv() {
  const nav = document.getElementById("tweaks-nav");
  const pane = document.getElementById("tweak-pane");
  if (!nav || !pane) return;

  nav.addEventListener("click", function (e) {
    const btn = e.target.closest(".tweak-cat");
    if (!btn) return;
    curTweakCat = parseInt(btn.dataset.ci, 10);
    tweakQuery = "";
    const input = document.getElementById("tweak-search");
    if (input) input.value = "";
    const hint = document.getElementById("tweaks-filter-hint");
    if (hint) hint.textContent = "";
    drawTweaks();
    refreshUI();
  });

  pane.addEventListener("change", function (e) {
    const cb = e.target;
    if (cb.tagName !== "INPUT" || cb.type !== "checkbox" || !cb.dataset.tid) return;
    e.stopPropagation();
    const id = cb.dataset.tid;
    if (cb.checked) pickedT.add(id);
    else pickedT.delete(id);
    updateTweakBadges();
    updatePaneHeadState();
    refreshUI();
  });

  pane.addEventListener("click", function (e) {
    const selWrap = e.target.closest(".cat-sel-all");
    if (selWrap) {
      e.stopPropagation();
      const ci = parseInt(selWrap.dataset.ci, 10);
      const cat = catData[ci];
      if (!cat) return;
      const tw = cat.tweaks.filter((t) => t.commands && t.commands.length > 0);
      const all = tw.length > 0 && tw.every((t) => pickedT.has(t.id));
      tw.forEach((t) => (all ? pickedT.delete(t.id) : pickedT.add(t.id)));
      preservePaneScroll(() => {
        updateTweakBadges();
        updatePaneHeadState();
      });
      refreshUI();
      return;
    }
    const main = e.target.closest(".tweak-row-main");
    if (main && !e.target.closest("button, a")) {
      const row = main.closest(".tweak-row");
      const cb = row && row.querySelector('input[type="checkbox"]');
      if (cb && !cb.disabled) {
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return;
    }
    const more = e.target.closest(".tweak-more-btn");
    if (more) {
      e.stopPropagation();
      e.preventDefault();
      const tid = more.dataset.tid;
      const href = `https://codewinoptimizer.com/docs/tweaks/${tid}`;
      window.go.main.App.OpenURL(href);
      appendLog(`[DOCS] Opening: ${href}`);
    }
  });
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

    updateTweakBadges();
  updatePaneHeadState();
}


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

/* ========= TWEAK QUICK PROFILES ========= */

const QUICK_PROFILES = {
  Standard: [
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
  ],
  Gaming: [
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
  ],
  Minimal: [
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
  ],
};

function drawTweakActionLabels() {
  const btnClear = document.getElementById("btn-tweaks-clear-text");
  const btnSelAll = document.getElementById("btn-tweaks-select-all-text");
  if (btnClear) btnClear.textContent = T("tweaksClear");
  if (btnSelAll) btnSelAll.textContent = T("tweaksSelectAllGlobal");
}

function doLoadProfile(name) {
  const ids = QUICK_PROFILES[name];
  if (!ids) {
    appendLog(`[ERR] Unknown profile: ${name}`);
    return;
  }
  pickedT = new Set(ids);
  drawTweaks();
  refreshUI();
  appendLog(`[OK] Profile loaded: ${name} (${ids.length} tweaks)`);
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
