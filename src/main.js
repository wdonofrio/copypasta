const {
  app,
  BrowserWindow,
  clipboard,
  globalShortcut,
  ipcMain,
  Menu,
  Tray,
  nativeImage,
  screen,
  dialog,
  shell,
  systemPreferences
} = require("electron");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFile, execFileSync } = require("node:child_process");
const {
  normalizedText,
  stripHtml,
  asPreview,
  collectFilePathsFromBuffers,
  buildFileSnapshot,
  buildFileClipboardPayload
} = require("./clipboard-formats");

const WINDOW_WIDTH = 560;
const WINDOW_HEIGHT = 680;
const WINDOW_MARGIN = 8;
const SHORTCUT = "CommandOrControl+Shift+V";
const POLL_INTERVAL_MS = 450;
const MAX_TEXT_BYTES = 100000;
const MAX_HTML_BYTES = 250000;
const MAX_RTF_BYTES = 250000;
const MAX_IMAGE_BYTES = 2_000_000;
const AUTO_PASTE_INITIAL_DELAY_MS = 30;
const AUTO_PASTE_RETRY_DELAY_MS = 110;
const TRAY_TEXT_FALLBACK = "PASTA";

let mainWindow = null;
let tray = null;
let trayMenu = null;
let pollingTimer = null;
let lastSeenSignature = "";
let lastFocusedAppName = "";
let autoPasteEnabled = true;
let autoPastePermissionWarned = false;
let autoPastePermissionBlocked = false;
let automationPermissionGranted = null;
let trayIconWasEmpty = false;
let trayInitError = "";
let shortcutBehavior = "tray-menu";
let lastShortcutEvent = {
  source: "startup",
  action: "none",
  at: null
};

const storePath = path.join(app.getPath("userData"), "clipboard-history.json");

const state = {
  entries: []
};

function canUseMainWindow() {
  return Boolean(mainWindow) && !mainWindow.isDestroyed();
}

function hashBuffer(value) {
  return crypto.createHash("sha1").update(value).digest("hex");
}

function hashText(value) {
  return hashBuffer(Buffer.from(value, "utf8"));
}

function canonicalText(value) {
  return normalizedText(value).trim();
}

function entryDedupeKey(entry) {
  if (entry.kind === "files" && Array.isArray(entry.payload?.paths)) {
    const sorted = [...entry.payload.paths].map((p) => String(p)).sort();
    return `files:${hashText(sorted.join("\n"))}`;
  }

  if (entry.kind === "image" && typeof entry.payload?.pngBase64 === "string") {
    return `image:${hashText(entry.payload.pngBase64)}`;
  }

  if (entry.kind === "html") {
    const text = canonicalText(entry.payload?.text || entry.searchableText || "");
    if (text) {
      return `html-text:${hashText(text)}`;
    }
    const html = canonicalText(entry.payload?.html || "");
    return `html:${hashText(html)}`;
  }

  if (entry.kind === "rtf") {
    const text = canonicalText(entry.payload?.text || entry.searchableText || "");
    if (text) {
      return `rtf-text:${hashText(text)}`;
    }
    const rtf = canonicalText(entry.payload?.rtf || "");
    return `rtf:${hashText(rtf)}`;
  }

  const text = canonicalText(entry.payload?.text || entry.searchableText || "");
  return `text:${hashText(text)}`;
}

function readFileSnapshot() {
  const paths = collectFilePathsFromBuffers(
    clipboard.availableFormats(),
    (format) => clipboard.readBuffer(format)
  );
  const snapshot = buildFileSnapshot(paths, hashText);
  if (!snapshot) {
    return null;
  }
  return {
    ...snapshot,
    dedupeKey: entryDedupeKey(snapshot)
  };
}

function publicEntries() {
  return state.entries.map((item) => ({
    id: item.id,
    kind: item.kind,
    preview: item.preview,
    searchableText: item.searchableText,
    pinned: item.pinned,
    createdAt: item.createdAt
  }));
}

function previewForMenu(text) {
  const oneLine = normalizedText(text || "").replace(/\s+/g, " ").trim();
  return oneLine.length > 54 ? `${oneLine.slice(0, 54)}...` : oneLine;
}

function entryMenuLabel(entry) {
  const marker = entry.pinned ? "• " : "";
  const preview = previewForMenu(entry.preview || entry.searchableText || "");
  return `${marker}${preview || "(empty)"}`;
}

function entryMenuIcon(entry) {
  if (entry.kind !== "image" || typeof entry.payload?.pngBase64 !== "string") {
    return undefined;
  }

  try {
    const png = Buffer.from(entry.payload.pngBase64, "base64");
    const image = nativeImage.createFromBuffer(png);
    if (image.isEmpty()) {
      return undefined;
    }
    return image.resize({ width: 18, height: 18 });
  } catch {
    return undefined;
  }
}

function refreshTrayMenu() {
  if (!tray) {
    return;
  }

  const recentEntries = state.entries.slice(0, 12);
  const historyItems = recentEntries.map((entry) => ({
    label: entryMenuLabel(entry),
    icon: entryMenuIcon(entry),
    click: () => selectEntryFromTray(entry)
  }));

  const manageItems = recentEntries.map((entry) => ({
    label: entryMenuLabel(entry),
    submenu: [
      {
        label: entry.pinned ? "Unpin" : "Pin",
        click: () => {
          state.entries = state.entries.map((item) => {
            if (item.id !== entry.id) {
              return item;
            }
            return { ...item, pinned: !item.pinned };
          });
          state.entries.sort((a, b) => {
            if (a.pinned === b.pinned) {
              return b.createdAt - a.createdAt;
            }
            return a.pinned ? -1 : 1;
          });
          saveState();
          emitHistory();
        }
      },
      {
        label: "Delete",
        click: () => {
          state.entries = state.entries.filter((item) => item.id !== entry.id);
          saveState();
          emitHistory();
        }
      }
    ]
  }));

  const template = [
    { label: "Clipboard History", enabled: false },
    ...(historyItems.length ? historyItems : [{ label: "No clipboard history yet", enabled: false }]),
    { type: "separator" },
    ...(manageItems.length
      ? [{ label: "Manage Recent", submenu: manageItems }, { type: "separator" }]
      : []),
    { label: "Open Clipboard Window", click: () => showMainWindow() },
    {
      label: "Clear Unpinned History",
      click: () => {
        state.entries = state.entries.filter((entry) => entry.pinned);
        saveState();
        emitHistory();
      }
    },
    { type: "separator" },
    { label: "Quit", role: "quit" }
  ];

  trayMenu = Menu.buildFromTemplate(template);
  tray.setContextMenu(trayMenu);
}

function emitHistory() {
  if (canUseMainWindow()) {
    mainWindow.webContents.send("history:updated", publicEntries());
  }
  refreshTrayMenu();
}

function fromLegacyEntry(item) {
  if (typeof item?.text !== "string") {
    return null;
  }
  const text = normalizedText(item.text);
  if (!text) {
    return null;
  }
  return {
    id: item.id || `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    kind: "text",
    signature: `text:${hashText(text)}`,
    dedupeKey: `text:${hashText(canonicalText(text))}`,
    preview: asPreview(text),
    searchableText: text,
    payload: { text },
    pinned: Boolean(item.pinned),
    createdAt: Number(item.createdAt) || Date.now()
  };
}

function normalizePersistedEntry(item) {
  if (item?.payload && typeof item.kind === "string") {
    const preview = typeof item.preview === "string" ? item.preview : asPreview(item.searchableText || "");
    const searchableText = typeof item.searchableText === "string" ? item.searchableText : "";
    const payload = item.payload;
    let signature = typeof item.signature === "string" ? item.signature : "";

    if (!signature) {
      if (item.kind === "files" && Array.isArray(payload.paths)) {
        signature = `files:${hashText(payload.paths.join("\n"))}`;
      } else if (item.kind === "image" && typeof payload.pngBase64 === "string") {
        signature = `image:${hashText(payload.pngBase64)}`;
      } else if (item.kind === "html" && typeof payload.html === "string") {
        signature = `html:${hashText(payload.html)}:${hashText(payload.text || "")}`;
      } else if (item.kind === "rtf" && typeof payload.rtf === "string") {
        signature = `rtf:${hashText(payload.rtf)}:${hashText(payload.text || "")}`;
      } else if (item.kind === "text" && typeof payload.text === "string") {
        signature = `text:${hashText(payload.text)}`;
      }
    }

    if (!signature) {
      return null;
    }

    const normalizedEntry = {
      id: item.id || `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      kind: item.kind,
      signature,
      dedupeKey: typeof item.dedupeKey === "string" ? item.dedupeKey : "",
      preview,
      searchableText,
      payload,
      pinned: Boolean(item.pinned),
      createdAt: Number(item.createdAt) || Date.now()
    };
    normalizedEntry.dedupeKey = normalizedEntry.dedupeKey || entryDedupeKey(normalizedEntry);
    return normalizedEntry;
  }

  return fromLegacyEntry(item);
}

function loadState() {
  try {
    if (!fs.existsSync(storePath)) {
      return;
    }

    const raw = fs.readFileSync(storePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.entries)) {
      return;
    }
    state.entries = parsed.entries.map(normalizePersistedEntry).filter(Boolean);
  } catch (error) {
    console.error("Failed to load clipboard history:", error);
  }
}

function saveState() {
  try {
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(storePath, JSON.stringify(state, null, 2), "utf8");
  } catch (error) {
    console.error("Failed to save clipboard history:", error);
  }
}

function readClipboardSnapshot() {
  const fileSnapshot = readFileSnapshot();
  if (fileSnapshot) {
    return fileSnapshot;
  }

  const image = clipboard.readImage();
  if (!image.isEmpty()) {
    const png = image.toPNG();
    if (png.byteLength > 0 && png.byteLength <= MAX_IMAGE_BYTES) {
      const size = image.getSize();
      const signature = `image:${hashBuffer(png)}`;
      const snapshot = {
        kind: "image",
        signature,
        preview: `Image ${size.width}x${size.height}`,
        searchableText: `image ${size.width}x${size.height}`,
        payload: { pngBase64: png.toString("base64") }
      };
      return { ...snapshot, dedupeKey: entryDedupeKey(snapshot) };
    }
  }

  const text = normalizedText(clipboard.readText());
  const html = normalizedText(clipboard.readHTML());
  const rtf = clipboard.readRTF() || "";

  const hasText = text.length > 0 && Buffer.byteLength(text, "utf8") <= MAX_TEXT_BYTES;
  const hasHtml = html.length > 0 && Buffer.byteLength(html, "utf8") <= MAX_HTML_BYTES;
  const hasRtf = rtf.length > 0 && Buffer.byteLength(rtf, "utf8") <= MAX_RTF_BYTES;

  if (hasHtml) {
    const plainText = hasText ? text : stripHtml(html);
    const snapshot = {
      kind: "html",
      signature: `html:${hashText(html)}:${hashText(plainText)}`,
      preview: asPreview(plainText) || "Rich HTML content",
      searchableText: `${plainText}\n${html}`,
      payload: {
        html,
        text: plainText
      }
    };
    return { ...snapshot, dedupeKey: entryDedupeKey(snapshot) };
  }

  if (hasRtf) {
    const snapshot = {
      kind: "rtf",
      signature: `rtf:${hashText(rtf)}:${hashText(text)}`,
      preview: asPreview(text) || "Rich text content",
      searchableText: text,
      payload: {
        rtf,
        text
      }
    };
    return { ...snapshot, dedupeKey: entryDedupeKey(snapshot) };
  }

  if (hasText) {
    const snapshot = {
      kind: "text",
      signature: `text:${hashText(text)}`,
      preview: asPreview(text),
      searchableText: text,
      payload: {
        text
      }
    };
    return { ...snapshot, dedupeKey: entryDedupeKey(snapshot) };
  }

  return null;
}

function upsertClipboardSnapshot(snapshot) {
  if (!snapshot) {
    return;
  }

  const normalizedSnapshot = {
    ...snapshot,
    dedupeKey: snapshot.dedupeKey || entryDedupeKey(snapshot)
  };
  const existingIndex = state.entries.findIndex(
    (entry) =>
      (entry.dedupeKey && entry.dedupeKey === normalizedSnapshot.dedupeKey) ||
      entry.signature === normalizedSnapshot.signature
  );
  const existing = existingIndex >= 0 ? state.entries[existingIndex] : null;

  if (existing) {
    const next = {
      ...existing,
      ...normalizedSnapshot,
      createdAt: Date.now()
    };
    state.entries.splice(existingIndex, 1);
    state.entries.unshift(next);
  } else {
    state.entries.unshift({
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      ...normalizedSnapshot,
      pinned: false,
      createdAt: Date.now()
    });
  }

  saveState();
  emitHistory();
}

function startClipboardPolling() {
  if (pollingTimer) {
    return;
  }

  const initial = readClipboardSnapshot();
  lastSeenSignature = initial?.signature || "";

  pollingTimer = setInterval(() => {
    const snapshot = readClipboardSnapshot();
    if (!snapshot || snapshot.signature === lastSeenSignature) {
      return;
    }

    lastSeenSignature = snapshot.signature;
    upsertClipboardSnapshot(snapshot);
  }, POLL_INTERVAL_MS);
}

function stopClipboardPolling() {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    show: false,
    frame: true,
    movable: true,
    resizable: false,
    alwaysOnTop: false,
    fullscreenable: false,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#00000000",
    vibrancy: "sidebar",
    visualEffectState: "active",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  mainWindow.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true
  });
  mainWindow.setHiddenInMissionControl(true);

  mainWindow.on("blur", () => {
    if (canUseMainWindow() && mainWindow.isVisible()) {
      hideMainWindow();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function hideMainWindow() {
  if (!canUseMainWindow() || !mainWindow.isVisible()) {
    return;
  }
  mainWindow.setAlwaysOnTop(false);
  mainWindow.hide();
}

function isAccessibilityTrusted(promptUser) {
  if (process.platform !== "darwin" || typeof systemPreferences.isTrustedAccessibilityClient !== "function") {
    return true;
  }
  return systemPreferences.isTrustedAccessibilityClient(Boolean(promptUser));
}

function runAppleScript(lines) {
  return new Promise((resolve) => {
    const args = [];
    for (const line of lines) {
      args.push("-e", line);
    }
    execFile("osascript", args, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        error,
        stdout: String(stdout || "").trim(),
        stderr: String(stderr || "").trim()
      });
    });
  });
}

async function verifyAutomationPermission() {
  const result = await runAppleScript([
    'tell application "System Events" to get name of first process whose frontmost is true'
  ]);
  automationPermissionGranted = result.ok;
  if (result.ok) {
    autoPastePermissionBlocked = false;
  }
  return result.ok;
}

function openPrivacyPanel(panel) {
  const map = {
    accessibility: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
    automation: "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation"
  };
  const target = map[panel];
  if (!target) {
    return false;
  }
  shell.openExternal(target);
  return true;
}

async function getSettingsStatus() {
  const accessibilityTrusted = isAccessibilityTrusted(false);
  return {
    autoPasteEnabled,
    shortcutBehavior,
    autoPastePermissionBlocked,
    accessibilityTrusted,
    automationPermissionGranted,
    autoPasteOperational:
      autoPasteEnabled && !autoPastePermissionBlocked && accessibilityTrusted && automationPermissionGranted === true
  };
}

function getTrayDiagnostics() {
  const diagnostics = {
    trayExists: Boolean(tray),
    trayInitError,
    trayIconWasEmpty,
    platform: process.platform,
    trayTextFallback: TRAY_TEXT_FALLBACK,
    interactionMode: "hybrid",
    clickBehavior: {
      leftClick: "open-window",
      rightClick: "open-menu"
    },
    shortcutBehavior,
    lastShortcutEvent
  };

  if (!tray) {
    return diagnostics;
  }

  try {
    const bounds = tray.getBounds();
    diagnostics.bounds = bounds;
    diagnostics.hasBounds = Boolean(bounds && (bounds.width > 0 || bounds.height > 0));
  } catch (error) {
    diagnostics.boundsError = String(error.message || error);
  }

  return diagnostics;
}

function captureFrontmostAppName() {
  try {
    const output = execFileSync(
      "osascript",
      [
        "-e",
        'tell application "System Events" to get name of first process whose frontmost is true'
      ],
      { encoding: "utf8" }
    );
    return String(output || "").trim();
  } catch {
    return "";
  }
}

function triggerPasteShortcut(options = {}) {
  const activateFirst = Boolean(options.activateFirst);
  const appName = String(lastFocusedAppName || "").replaceAll('"', '\\"');
  const script = appName && activateFirst
    ? [
        "-e",
        `tell application "${appName}" to activate`,
        "-e",
        'tell application "System Events" to keystroke "v" using command down'
      ]
    : ["-e", 'tell application "System Events" to keystroke "v" using command down'];

  return new Promise((resolve) => {
    execFile("osascript", script, (error) => {
      if (error) {
        const message = String(error.message || "");
        if (message.includes("not allowed to send keystrokes") || message.includes("not authorized")) {
          autoPastePermissionBlocked = true;
          automationPermissionGranted = false;
          if (!autoPastePermissionWarned) {
            autoPastePermissionWarned = true;
            dialog.showMessageBox({
              type: "warning",
              title: "Auto-paste blocked by macOS",
              message: "CopyPasta copied the item, but macOS blocked automatic paste.",
              detail:
                "Grant Accessibility + Automation permissions to your terminal/Electron app, then restart CopyPasta. Until then, paste manually with Cmd+V."
            });
          }
          resolve({ ok: false, blocked: true });
          return;
        }
        console.error("Failed to auto-paste clipboard selection:", error);
        resolve({ ok: false, blocked: false });
        return;
      }
      automationPermissionGranted = true;
      autoPastePermissionBlocked = false;
      resolve({ ok: true, blocked: false });
    });
  });
}

function queueAutoPaste() {
  setTimeout(async () => {
    const fastAttempt = await triggerPasteShortcut({ activateFirst: false });
    if (fastAttempt.ok || fastAttempt.blocked) {
      return;
    }

    setTimeout(async () => {
      await triggerPasteShortcut({ activateFirst: true });
    }, AUTO_PASTE_RETRY_DELAY_MS);
  }, AUTO_PASTE_INITIAL_DELAY_MS);
}

function openTrayMenu() {
  lastFocusedAppName = captureFrontmostAppName();
  if (trayMenu) {
    tray.popUpContextMenu(trayMenu);
  }
}

function runShortcutAction(source = "shortcut") {
  let action = "noop";

  if (shortcutBehavior === "tray-menu" && tray && trayMenu) {
    openTrayMenu();
    action = "open-tray-menu";
  } else if (canUseMainWindow()) {
    if (mainWindow.isVisible()) {
      hideMainWindow();
      action = "hide-window";
    } else {
      showMainWindow();
      action = "show-window";
    }
  } else {
    action = "no-window";
  }

  lastShortcutEvent = {
    source,
    action,
    at: new Date().toISOString()
  };
  return lastShortcutEvent;
}

function showMainWindow() {
  if (!canUseMainWindow()) {
    return;
  }

  lastFocusedAppName = captureFrontmostAppName();
  let x;
  let y;
  const trayBounds = tray && typeof tray.getBounds === "function" ? tray.getBounds() : null;

  if (trayBounds && trayBounds.width > 0) {
    const display = screen.getDisplayNearestPoint({
      x: trayBounds.x + Math.floor(trayBounds.width / 2),
      y: trayBounds.y + Math.floor(trayBounds.height / 2)
    });
    const workArea = display.workArea;
    x = trayBounds.x + Math.floor((trayBounds.width - WINDOW_WIDTH) / 2);
    y = workArea.y + WINDOW_MARGIN + trayBounds.height;
    x = Math.min(Math.max(x, workArea.x + WINDOW_MARGIN), workArea.x + workArea.width - WINDOW_WIDTH - WINDOW_MARGIN);
    y = Math.min(Math.max(y, workArea.y + WINDOW_MARGIN), workArea.y + workArea.height - WINDOW_HEIGHT - WINDOW_MARGIN);
  } else {
    const cursor = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursor);
    const { x: dx, y: dy, width, height } = display.workArea;
    x = dx + Math.floor((width - WINDOW_WIDTH) / 2);
    y = dy + Math.floor((height - WINDOW_HEIGHT) / 3);
  }

  mainWindow.setPosition(x, y);
  mainWindow.setAlwaysOnTop(true, "pop-up-menu", 1);

  emitHistory();
  mainWindow.show();
  mainWindow.moveTop();
  mainWindow.focus();
}

function createTray() {
  try {
    if (tray) {
      tray.destroy();
      tray = null;
    }
    trayInitError = "";
    trayIconWasEmpty = false;

    const traySvg = encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18"><path fill="black" d="M6 2h6a1 1 0 0 1 1 1v1h1.5A1.5 1.5 0 0 1 16 5.5v9A1.5 1.5 0 0 1 14.5 16h-11A1.5 1.5 0 0 1 2 14.5v-9A1.5 1.5 0 0 1 3.5 4H5V3a1 1 0 0 1 1-1Zm1 2h4V3H7v1Zm-3 2v8h10V6H4Z"/></svg>'
    );
    const icon = nativeImage.createFromDataURL(`data:image/svg+xml;utf8,${traySvg}`);
    icon.setTemplateImage(true);
    let trayIcon = icon.resize({ width: 18, height: 18 });
    if (trayIcon.isEmpty()) {
      trayIconWasEmpty = true;
      trayIcon = nativeImage.createEmpty();
    }
    tray = new Tray(trayIcon);
    tray.setTitle(trayIconWasEmpty ? TRAY_TEXT_FALLBACK : "CP");
    tray.setToolTip("CopyPasta");
    refreshTrayMenu();
    tray.on("click", () => showMainWindow());
    tray.on("right-click", () => openTrayMenu());
  } catch (error) {
    trayInitError = String(error.message || error);
    console.error("Failed to create tray:", error);
  }
}

function registerShortcut() {
  const ok = globalShortcut.register(SHORTCUT, () => {
    runShortcutAction("global-shortcut");
  });

  if (!ok) {
    console.error(`Failed to register global shortcut: ${SHORTCUT}`);
  }
}

function writeFileListToClipboard(paths) {
  const payload = buildFileClipboardPayload(paths);
  clipboard.write({ text: payload.text });
  if (payload.uriList) {
    clipboard.writeBuffer("text/uri-list", Buffer.from(payload.uriList, "utf8"));
  }
  if (payload.publicFileUrl) {
    clipboard.writeBuffer("public.file-url", Buffer.from(payload.publicFileUrl, "utf8"));
  }
  clipboard.writeBuffer("NSFilenamesPboardType", Buffer.from(payload.nsFilenamesPboardType, "utf8"));
}

function copyEntryToClipboard(entry) {
  if (entry.kind === "files" && Array.isArray(entry.payload?.paths) && entry.payload.paths.length) {
    writeFileListToClipboard(entry.payload.paths);
    return;
  }

  if (entry.kind === "image" && typeof entry.payload?.pngBase64 === "string") {
    const png = Buffer.from(entry.payload.pngBase64, "base64");
    clipboard.writeImage(nativeImage.createFromBuffer(png));
    return;
  }

  if (entry.kind === "html" && typeof entry.payload?.html === "string") {
    clipboard.write({
      html: entry.payload.html,
      text: entry.payload.text || ""
    });
    return;
  }

  if (entry.kind === "rtf" && typeof entry.payload?.rtf === "string") {
    clipboard.write({
      rtf: entry.payload.rtf,
      text: entry.payload.text || ""
    });
    return;
  }

  clipboard.writeText(entry.payload?.text || entry.searchableText || "");
}

function selectEntryFromTray(entry) {
  copyEntryToClipboard(entry);
  lastSeenSignature = entry.signature;
  hideMainWindow();
  if (autoPasteEnabled && !autoPastePermissionBlocked) {
    queueAutoPaste();
  }
}

function setupIpc() {
  ipcMain.handle("history:list", () => publicEntries());

  ipcMain.handle("history:copy", (_event, id) => {
    const entry = state.entries.find((item) => item.id === id);
    if (!entry) {
      return false;
    }
    copyEntryToClipboard(entry);
    lastSeenSignature = entry.signature;
    hideMainWindow();
    if (autoPasteEnabled && !autoPastePermissionBlocked) {
      queueAutoPaste();
    }
    return true;
  });

  ipcMain.handle("history:delete", (_event, id) => {
    state.entries = state.entries.filter((item) => item.id !== id);
    saveState();
    emitHistory();
    return true;
  });

  ipcMain.handle("history:pin", (_event, id) => {
    state.entries = state.entries.map((item) => {
      if (item.id !== id) {
        return item;
      }
      return { ...item, pinned: !item.pinned };
    });
    state.entries.sort((a, b) => {
      if (a.pinned === b.pinned) {
        return b.createdAt - a.createdAt;
      }
      return a.pinned ? -1 : 1;
    });
    saveState();
    emitHistory();
    return true;
  });

  ipcMain.handle("history:clear", () => {
    state.entries = state.entries.filter((entry) => entry.pinned);
    saveState();
    emitHistory();
    return true;
  });

  ipcMain.on("window:hide", () => {
    hideMainWindow();
  });

  ipcMain.handle("settings:getStatus", async () => getSettingsStatus());

  ipcMain.handle("settings:setAutoPaste", (_event, enabled) => {
    autoPasteEnabled = Boolean(enabled);
    return getSettingsStatus();
  });

  ipcMain.handle("settings:setShortcutBehavior", (_event, behavior) => {
    const normalized = String(behavior || "").toLowerCase();
    shortcutBehavior = normalized === "tray-menu" ? "tray-menu" : "window";
    return getSettingsStatus();
  });

  ipcMain.handle("permissions:checkAutomation", async () => {
    await verifyAutomationPermission();
    return getSettingsStatus();
  });

  ipcMain.handle("permissions:requestAccessibility", async () => {
    const trusted = isAccessibilityTrusted(true);
    if (trusted) {
      autoPastePermissionBlocked = false;
    }
    return getSettingsStatus();
  });

  ipcMain.handle("permissions:openPanel", (_event, panel) => {
    const opened = openPrivacyPanel(panel);
    return { opened };
  });

  ipcMain.handle("tray:diagnostics", () => getTrayDiagnostics());

  ipcMain.handle("tray:recreate", () => {
    createTray();
    return getTrayDiagnostics();
  });

  ipcMain.handle("shortcut:testTrigger", () => {
    const event = runShortcutAction("settings-test");
    return {
      event,
      diagnostics: getTrayDiagnostics()
    };
  });
}

app.whenReady().then(() => {
  loadState();
  createMainWindow();
  createTray();
  setupIpc();
  startClipboardPolling();
  registerShortcut();

  app.dock.hide();
});

app.on("before-quit", () => {
  stopClipboardPolling();
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", (event) => {
  event.preventDefault();
});

app.on("activate", () => {
  if (!canUseMainWindow()) {
    createMainWindow();
  }
  showMainWindow();
});
