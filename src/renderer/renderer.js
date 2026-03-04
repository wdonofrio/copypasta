let allEntries = [];
let filteredEntries = [];
let activeIndex = 0;

const historyListEl = document.getElementById("historyList");
const searchInputEl = document.getElementById("searchInput");
const clearBtnEl = document.getElementById("clearBtn");
const settingsBtnEl = document.getElementById("settingsBtn");
const settingsPanelEl = document.getElementById("settingsPanel");
const closeSettingsBtnEl = document.getElementById("closeSettingsBtn");
const autoPasteToggleEl = document.getElementById("autoPasteToggle");
const shortcutBehaviorSelectEl = document.getElementById("shortcutBehaviorSelect");
const launchAtLoginToggleEl = document.getElementById("launchAtLoginToggle");
const shortcutTestStatusEl = document.getElementById("shortcutTestStatus");
const testShortcutBtnEl = document.getElementById("testShortcutBtn");
const accessibilityStatusEl = document.getElementById("accessibilityStatus");
const automationStatusEl = document.getElementById("automationStatus");
const autopasteStatusLineEl = document.getElementById("autopasteStatusLine");
const requestAccessibilityBtnEl = document.getElementById("requestAccessibilityBtn");
const openAccessibilityBtnEl = document.getElementById("openAccessibilityBtn");
const checkAutomationBtnEl = document.getElementById("checkAutomationBtn");
const openAutomationBtnEl = document.getElementById("openAutomationBtn");
const trayDiagSummaryEl = document.getElementById("trayDiagSummary");
const trayDiagRawEl = document.getElementById("trayDiagRaw");
const refreshTrayDiagBtnEl = document.getElementById("refreshTrayDiagBtn");
const recreateTrayBtnEl = document.getElementById("recreateTrayBtn");

let settingsOpen = false;

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function filterEntries() {
  const query = searchInputEl.value.trim().toLowerCase();
  filteredEntries = !query
    ? allEntries
    : allEntries.filter((entry) => {
        const searchable = `${entry.searchableText || ""}\n${entry.preview || ""}`.toLowerCase();
        return searchable.includes(query);
      });

  if (activeIndex >= filteredEntries.length) {
    activeIndex = Math.max(0, filteredEntries.length - 1);
  }
}

async function refreshHistory() {
  allEntries = await window.copypasta.listHistory();
  filterEntries();
  render();
}

function renderSettingsStatus(status) {
  autoPasteToggleEl.checked = Boolean(status.autoPasteEnabled);
  shortcutBehaviorSelectEl.value = status.shortcutBehavior === "tray-menu" ? "tray-menu" : "window";
  launchAtLoginToggleEl.checked = Boolean(status.launchAtLogin);

  accessibilityStatusEl.textContent = status.accessibilityTrusted ? "Granted" : "Missing";
  accessibilityStatusEl.className = status.accessibilityTrusted ? "ok" : "warn";

  if (status.automationPermissionGranted === true) {
    automationStatusEl.textContent = "Granted";
    automationStatusEl.className = "ok";
  } else if (status.automationPermissionGranted === false) {
    automationStatusEl.textContent = "Missing";
    automationStatusEl.className = "warn";
  } else {
    automationStatusEl.textContent = "Unknown";
    automationStatusEl.className = "muted";
  }

  if (status.autoPasteOperational) {
    autopasteStatusLineEl.textContent = "Auto-paste is ready.";
    autopasteStatusLineEl.className = "status-line ok";
    return;
  }

  if (!status.autoPasteEnabled) {
    autopasteStatusLineEl.textContent = "Auto-paste is turned off.";
    autopasteStatusLineEl.className = "status-line muted";
    return;
  }

  if (!status.accessibilityTrusted) {
    autopasteStatusLineEl.textContent = "Grant Accessibility permission to enable auto-paste.";
    autopasteStatusLineEl.className = "status-line warn";
    return;
  }

  if (status.automationPermissionGranted !== true) {
    autopasteStatusLineEl.textContent = "Verify Automation permission for System Events.";
    autopasteStatusLineEl.className = "status-line warn";
    return;
  }

  if (status.autoPastePermissionBlocked) {
    autopasteStatusLineEl.textContent = "Auto-paste was blocked. Re-verify permissions.";
    autopasteStatusLineEl.className = "status-line warn";
  }
}

async function refreshSettingsStatus() {
  const status = await window.copypasta.getSettingsStatus();
  renderSettingsStatus(status);
}

function renderTrayDiagnostics(diag) {
  const hasBounds = Boolean(diag.hasBounds);
  const exists = Boolean(diag.trayExists);
  const hasError = Boolean(diag.trayInitError);

  if (exists && hasBounds && !hasError) {
    trayDiagSummaryEl.textContent = "Tray looks healthy (created with non-zero bounds).";
    trayDiagSummaryEl.className = "ok";
  } else if (exists && !hasBounds && !hasError) {
    trayDiagSummaryEl.textContent = "Tray object exists, but bounds are zero. Menu bar may be hidden or blocked.";
    trayDiagSummaryEl.className = "warn";
  } else if (hasError) {
    trayDiagSummaryEl.textContent = `Tray creation error: ${diag.trayInitError}`;
    trayDiagSummaryEl.className = "warn";
  } else {
    trayDiagSummaryEl.textContent = "Tray object not created.";
    trayDiagSummaryEl.className = "warn";
  }

  trayDiagRawEl.classList.remove("hidden");
  trayDiagRawEl.textContent = JSON.stringify(diag, null, 2);
}

async function refreshTrayDiagnostics() {
  const diag = await window.copypasta.getTrayDiagnostics();
  renderTrayDiagnostics(diag);
}

function openSettings() {
  settingsOpen = true;
  settingsPanelEl.classList.remove("hidden");
  refreshSettingsStatus();
  refreshTrayDiagnostics();
}

function closeSettings() {
  settingsOpen = false;
  settingsPanelEl.classList.add("hidden");
}

function render() {
  if (!filteredEntries.length) {
    historyListEl.innerHTML = '<div class="empty">Clipboard is empty. Copy text, images, or files and it will appear here.</div>';
    return;
  }

  historyListEl.innerHTML = filteredEntries
    .map((entry, index) => {
      const activeClass = index === activeIndex ? "active" : "";
      const pinClass = entry.pinned ? "on" : "";
      const pinLabel = entry.pinned ? "Unpin" : "Pin";
      const kind = String(entry.kind || "text").toUpperCase();
      const text = escapeHtml(entry.preview || "");
      return `
        <article class="item ${activeClass}" data-id="${entry.id}">
          <div class="item-content">
            <div class="meta">
              <span class="kind">${kind}</span>
            </div>
            <div class="item-text">${text || "(no preview available)"}</div>
          </div>
          <div class="actions">
            <button class="pin ${pinClass}" data-action="pin" data-id="${entry.id}">${pinLabel}</button>
            <button class="delete" data-action="delete" data-id="${entry.id}">Delete</button>
          </div>
        </article>
      `;
    })
    .join("");

  const activeItem = historyListEl.querySelector(".item.active");
  activeItem?.scrollIntoView({ block: "nearest" });
}

async function copyActiveEntry() {
  if (!filteredEntries.length) {
    return;
  }
  const current = filteredEntries[activeIndex];
  await window.copypasta.copyItem(current.id);
}

searchInputEl.addEventListener("input", () => {
  activeIndex = 0;
  filterEntries();
  render();
});

historyListEl.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const button = target.closest("button");
  if (button) {
    const action = button.dataset.action;
    const id = button.dataset.id;

    if (!id || !action) {
      return;
    }

    if (action === "pin") {
      await window.copypasta.pinItem(id);
      await refreshHistory();
      return;
    }

    if (action === "delete") {
      await window.copypasta.deleteItem(id);
      await refreshHistory();
    }
    return;
  }

  const item = target.closest(".item");
  if (item instanceof HTMLElement) {
    const id = item.dataset.id;
    const idx = filteredEntries.findIndex((entry) => entry.id === id);
    if (idx >= 0) {
      activeIndex = idx;
      render();
      await copyActiveEntry();
    }
  }
});

clearBtnEl.addEventListener("click", async () => {
  await window.copypasta.clearHistory();
  await refreshHistory();
});

settingsBtnEl.addEventListener("click", () => {
  if (settingsOpen) {
    closeSettings();
    return;
  }
  openSettings();
});

closeSettingsBtnEl.addEventListener("click", () => closeSettings());

autoPasteToggleEl.addEventListener("change", async () => {
  const status = await window.copypasta.setAutoPaste(autoPasteToggleEl.checked);
  renderSettingsStatus(status);
});

shortcutBehaviorSelectEl.addEventListener("change", async () => {
  const status = await window.copypasta.setShortcutBehavior(shortcutBehaviorSelectEl.value);
  renderSettingsStatus(status);
  await refreshTrayDiagnostics();
});

launchAtLoginToggleEl.addEventListener("change", async () => {
  const status = await window.copypasta.setLaunchAtLogin(launchAtLoginToggleEl.checked);
  renderSettingsStatus(status);
});

requestAccessibilityBtnEl.addEventListener("click", async () => {
  const status = await window.copypasta.requestAccessibilityPermission();
  renderSettingsStatus(status);
});

checkAutomationBtnEl.addEventListener("click", async () => {
  const status = await window.copypasta.checkAutomationPermission();
  renderSettingsStatus(status);
});

openAccessibilityBtnEl.addEventListener("click", async () => {
  await window.copypasta.openPermissionPanel("accessibility");
});

openAutomationBtnEl.addEventListener("click", async () => {
  await window.copypasta.openPermissionPanel("automation");
});

refreshTrayDiagBtnEl.addEventListener("click", async () => {
  await refreshTrayDiagnostics();
});

recreateTrayBtnEl.addEventListener("click", async () => {
  const diag = await window.copypasta.recreateTray();
  renderTrayDiagnostics(diag);
});

testShortcutBtnEl.addEventListener("click", async () => {
  const result = await window.copypasta.testShortcutTrigger();
  const event = result?.event || {};
  shortcutTestStatusEl.textContent = `Action: ${event.action || "unknown"} (${event.source || "unknown"})`;
  shortcutTestStatusEl.className = "ok";
  if (result?.diagnostics) {
    renderTrayDiagnostics(result.diagnostics);
  }
});

window.addEventListener("keydown", async (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
    event.preventDefault();
    searchInputEl.focus();
    searchInputEl.select();
    return;
  }

  if (event.key === "Escape") {
    if (settingsOpen) {
      closeSettings();
      return;
    }
    window.copypasta.hideWindow();
    return;
  }

  if (event.key === "ArrowDown") {
    event.preventDefault();
    if (activeIndex < filteredEntries.length - 1) {
      activeIndex += 1;
      render();
    }
    return;
  }

  if (event.key === "ArrowUp") {
    event.preventDefault();
    if (activeIndex > 0) {
      activeIndex -= 1;
      render();
    }
    return;
  }

  if (event.key === "Enter") {
    event.preventDefault();
    await copyActiveEntry();
  }
});

window.copypasta.onHistoryUpdated((entries) => {
  allEntries = entries;
  filterEntries();
  render();
});

refreshHistory().then(() => {
  searchInputEl.focus();
  refreshSettingsStatus();
});
