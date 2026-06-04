/* ========= TAB: STARTUP =========
 * Owns: enumeration of Windows auto-start entries (Run keys + Startup folders)
 * and per-item enable/disable toggles. Backend in app_startup.go.
 * Globals expected from main.js: T, LO, h, esc, busy, appendLog, setTerm.
 */

let startupItems = [];
let startupFilter = "all";
let startupQuery = "";
let startupLoaded = false;

function drawStartup() {
  document.getElementById("tab-startup-label").textContent = T("tabStartup");
  document.getElementById("startup-section-title").textContent = T("startupTitle");
  document.getElementById("startup-section-sub").textContent = T("startupSub");
  document.getElementById("startup-count-total-lbl").textContent = T("startupTotal");
  document.getElementById("startup-count-on-lbl").textContent = T("startupOn");
  document.getElementById("startup-count-off-lbl").textContent = T("startupOff");
  document.getElementById("btn-startup-refresh-text").textContent = T("startupRefresh");
  document.getElementById("startup-filter-all").textContent = T("startupFilterAll");
  document.getElementById("startup-filter-on").textContent = T("startupFilterOn");
  document.getElementById("startup-filter-off").textContent = T("startupFilterOff");
  document.getElementById("startup-search").placeholder = T("startupSearch");
  renderStartupList();
  if (!startupLoaded) {
    loadStartupItems();
  }
}

async function loadStartupItems() {
  const empty = document.getElementById("startup-empty-text");
  if (empty) empty.textContent = T("startupLoading");
  try {
    const raw = await window.go.main.App.GetStartupItems();
    const parsed = JSON.parse(raw);
    if (parsed && parsed.error) {
      startupItems = [];
      if (empty) empty.textContent = "Error: " + parsed.error;
    } else {
      startupItems = Array.isArray(parsed) ? parsed : [];
    }
    startupLoaded = true;
    renderStartupList();
  } catch (e) {
    console.warn("[Startup] load failed:", e);
    startupItems = [];
    if (empty) empty.textContent = T("startupLoadFail");
    renderStartupList();
  }
}

function startupCounts() {
  const on = startupItems.filter((i) => i.enabled).length;
  return { total: startupItems.length, on, off: startupItems.length - on };
}

function startupFiltered() {
  const q = startupQuery.trim().toLowerCase();
  return startupItems.filter((it) => {
    if (startupFilter === "on" && !it.enabled) return false;
    if (startupFilter === "off" && it.enabled) return false;
    if (!q) return true;
    return (
      (it.name || "").toLowerCase().includes(q) ||
      (it.command || "").toLowerCase().includes(q) ||
      (it.location || "").toLowerCase().includes(q)
    );
  });
}

function startupTypeIcon(type) {
  const map = {
    exe: '<path d="M4 4h16v16H4z"/><path d="M9 9h6v6H9z"/>',
    shortcut:
      '<path d="M15 3h6v6"/><path d="M10 14L21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    script:
      '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
    dll: '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/>',
    appx: '<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/>',
    task: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    other:
      '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
  };
  return map[type] || map.other;
}

function startupItemRow(item) {
  const row = h(
    "div",
    {
      className:
        "startup-row" + (item.enabled ? " startup-row-on" : " startup-row-off"),
      "data-id": item.id,
    },
    h(
      "div",
      { className: "startup-type" },
      Object.assign(document.createElement("span"), {
        innerHTML:
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
          startupTypeIcon(item.type) +
          "</svg>",
        className: "startup-type-svg",
      }),
    ),
    h(
      "div",
      { className: "startup-info" },
      h("div", { className: "startup-name", textContent: item.name || "—" }),
      h(
        "div",
        { className: "startup-cmd", title: item.command, textContent: item.command || "" },
      ),
      h(
        "div",
        { className: "startup-meta" },
        h("span", { className: "startup-loc", textContent: item.location }),
        h("span", { className: "startup-sep", textContent: "·" }),
        h("span", {
          className:
            "startup-state " +
            (item.enabled ? "startup-state-on" : "startup-state-off"),
          textContent: item.enabled ? T("startupStateOn") : T("startupStateOff"),
        }),
      ),
    ),
    h(
      "label",
      { className: "toggle" },
      Object.assign(document.createElement("input"), {
        type: "checkbox",
        checked: item.enabled,
        onchange: (e) => toggleStartupItem(item.id, e.target.checked),
      }),
      h("span", { className: "toggle-slider" }),
    ),
  );
  return row;
}

function renderStartupList() {
  const list = document.getElementById("startup-list");
  const empty = document.getElementById("startup-empty");
  if (!list) return;

  const counts = startupCounts();
  document.getElementById("startup-count-total").textContent = counts.total;
  document.getElementById("startup-count-on").textContent = counts.on;
  document.getElementById("startup-count-off").textContent = counts.off;

  const filtered = startupFiltered();
  list.replaceChildren();
  if (filtered.length === 0) {
    if (empty) {
      list.appendChild(empty);
      const txt = document.getElementById("startup-empty-text");
      if (txt)
        txt.textContent =
          startupItems.length === 0 ? T("startupNoItems") : T("startupNoMatch");
    }
    return;
  }
  filtered.forEach((it) => list.appendChild(startupItemRow(it)));
}

async function toggleStartupItem(id, enabled) {
  const item = startupItems.find((i) => i.id === id);
  if (!item) return;
  const prev = item.enabled;
  item.enabled = enabled;
  renderStartupList();
  appendLog(
    "[CMD] " +
      (enabled ? T("startupEnabling") : T("startupDisabling")) +
      ": " +
      item.name,
  );
  try {
    const r = await window.go.main.App.SetStartupItemEnabled(id, enabled);
    if (r && r.startsWith("OK")) {
      appendLog("[OK] " + r);
      setTerm(
        (enabled ? T("startupEnabled") : T("startupDisabled")) +
          ": " +
          item.name,
        "ok",
      );
    } else {
      item.enabled = prev;
      renderStartupList();
      appendLog("[ERR] " + r);
      setTerm(T("startupToggleFail"), "err");
    }
  } catch (e) {
    item.enabled = prev;
    renderStartupList();
    appendLog("[ERR] " + e);
    setTerm(T("startupToggleFail"), "err");
  }
}

function initStartupListeners() {
  document
    .getElementById("btn-startup-refresh")
    ?.addEventListener("click", () => {
      startupLoaded = false;
      loadStartupItems();
    });
  document.getElementById("startup-search")?.addEventListener("input", (e) => {
    startupQuery = e.target.value || "";
    renderStartupList();
  });
  document.querySelectorAll(".startup-filter").forEach((btn) => {
    btn.addEventListener("click", () => {
      startupFilter = btn.dataset.filter || "all";
      document
        .querySelectorAll(".startup-filter")
        .forEach((b) => b.classList.toggle("active", b === btn));
      renderStartupList();
    });
  });
}
