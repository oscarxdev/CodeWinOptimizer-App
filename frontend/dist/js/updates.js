/* ========= TAB: UPDATES ========= */
function setText(id, key) {
  const el = document.getElementById(id);
  if (el) el.textContent = T(key);
}

function drawUpdates() {
  document.getElementById("tab-updates-label").textContent = T("tabUpdates");

  setText("updates-section-title", "updatesSectionTitle");
  setText("updates-section-sub", "updatesSectionSub");

  setText("update-default-badge", "updateBadgeDefault");
  setText("update-security-badge", "updateBadgeRecommended");
  setText("update-disable-badge", "updateBadgeDanger");

  document.getElementById("btn-update-default-text").textContent =
    T("updateDefaultBtn");
  document.getElementById("update-default-title").textContent =
    T("updateDefaultTitle");
  const defList = document.getElementById("update-default-list");
  defList.replaceChildren();
  [T("updateDefaultItem1"), T("updateDefaultItem2")].forEach((t) => {
    const li = document.createElement("li");
    li.textContent = t;
    defList.appendChild(li);
  });
  document.getElementById("update-default-note").textContent =
    T("updateDefaultNote");

  document.getElementById("btn-update-security-text").textContent =
    T("updateSecurityBtn");
  document.getElementById("update-security-title").textContent = T(
    "updateSecurityTitle",
  );
  const secList = document.getElementById("update-security-list");
  secList.replaceChildren();
  [
    T("updateSecurityItem1"),
    T("updateSecurityItem2"),
    T("updateSecurityItem3"),
  ].forEach((t) => {
    const li = document.createElement("li");
    li.textContent = t;
    secList.appendChild(li);
  });
  document.getElementById("update-security-note").textContent =
    T("updateSecurityNote");

  const infoFeature = document.getElementById("update-info-feature-text");
  const infoSecurity = document.getElementById("update-info-security-text");
  if (infoFeature) infoFeature.textContent = T("updateInfoFeatureText");
  if (infoSecurity) infoSecurity.textContent = T("updateInfoSecurityText");
  const infoTags = document.querySelectorAll(".update-info-tag");
  if (infoTags[0]) infoTags[0].textContent = T("updateInfoFeatureLabel");
  if (infoTags[1]) infoTags[1].textContent = T("updateInfoSecurityLabel");

  document.getElementById("btn-update-disable-text").textContent =
    T("updateDisableBtn");
  document.getElementById("update-disable-title").textContent =
    T("updateDisableTitle");
  const disList = document.getElementById("update-disable-list");
  disList.replaceChildren();
  [
    T("updateDisableItem1"),
    T("updateDisableItem2"),
    T("updateDisableItem3"),
  ].forEach((t) => {
    const li = document.createElement("li");
    li.textContent = t;
    disList.appendChild(li);
  });
  document.getElementById("update-disable-warning").textContent = T(
    "updateDisableWarning",
  );
}

async function doUpdateDefault() {
  if (busy) return;
  setBusy(true, 300000);
  setTerm(T("updateDefaultRunning"), "running");
  appendLog("=== " + T("updateDefaultRunning") + " ===");
  try {
    const r = await window.go.main.App.SetWindowsUpdate("default");
    if (r) appendLog(r);
    appendLog("[OK] " + T("updateDefaultOk"));
    setTerm(T("updateDefaultOk"), "ok");
  } catch (e) {
    appendLog("[ERR] " + T("updateDefaultFail") + ": " + e);
    setTerm(T("updateDefaultFail"), "err");
  }
  setBusy(false);
}

async function doUpdateSecurity() {
  if (busy) return;
  setBusy(true, 300000);
  setTerm(T("updateSecurityRunning"), "running");
  appendLog("=== " + T("updateSecurityRunning") + " ===");
  try {
    const r = await window.go.main.App.SetWindowsUpdate("security");
    if (r) appendLog(r);
    appendLog("[OK] " + T("updateSecurityOk"));
    setTerm(T("updateSecurityOk"), "ok");
  } catch (e) {
    appendLog("[ERR] " + T("updateSecurityFail") + ": " + e);
    setTerm(T("updateSecurityFail"), "err");
  }
  setBusy(false);
}

async function doUpdateDisable() {
  if (busy) return;
  const ok = await showConfirm(
    T("updateDisableConfirm"),
    T("updateDisableConfirmMsg"),
  );
  if (!ok) {
    return;
  }
  setBusy(true, 300000);
  setTerm(T("updateDisableRunning"), "running");
  appendLog("=== " + T("updateDisableRunning") + " ===");
  try {
    const r = await window.go.main.App.SetWindowsUpdate("disable");
    if (r) appendLog(r);
    appendLog("[OK] " + T("updateDisableOk"));
    setTerm(T("updateDisableOk"), "ok");
  } catch (e) {
    appendLog("[ERR] " + T("updateDisableFail") + ": " + e);
    setTerm(T("updateDisableFail"), "err");
  }
  setBusy(false);
}

function initUpdateListeners() {
  document
    .getElementById("btn-update-default")
    ?.addEventListener("click", doUpdateDefault);
  document
    .getElementById("btn-update-security")
    ?.addEventListener("click", doUpdateSecurity);
  document
    .getElementById("btn-update-disable")
    ?.addEventListener("click", doUpdateDisable);
}

function refreshUpdateUI() {
  const d = document.getElementById("btn-update-default"),
    dt = document.getElementById("btn-update-default-text");
  const s = document.getElementById("btn-update-security"),
    st = document.getElementById("btn-update-security-text");
  const dis = document.getElementById("btn-update-disable"),
    dist = document.getElementById("btn-update-disable-text");

  if (d) {
    d.disabled = busy;
    dt.textContent = busy ? "..." : T("updateDefaultBtn");
  }
  if (s) {
    s.disabled = busy;
    st.textContent = busy ? "..." : T("updateSecurityBtn");
  }
  if (dis) {
    dis.disabled = busy;
    dist.textContent = busy ? "..." : T("updateDisableBtn");
  }
}
