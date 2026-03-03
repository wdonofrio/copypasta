const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("copypasta", {
  listHistory: () => ipcRenderer.invoke("history:list"),
  copyItem: (id) => ipcRenderer.invoke("history:copy", id),
  deleteItem: (id) => ipcRenderer.invoke("history:delete", id),
  pinItem: (id) => ipcRenderer.invoke("history:pin", id),
  clearHistory: () => ipcRenderer.invoke("history:clear"),
  hideWindow: () => ipcRenderer.send("window:hide"),
  getSettingsStatus: () => ipcRenderer.invoke("settings:getStatus"),
  setAutoPaste: (enabled) => ipcRenderer.invoke("settings:setAutoPaste", enabled),
  setShortcutBehavior: (behavior) => ipcRenderer.invoke("settings:setShortcutBehavior", behavior),
  checkAutomationPermission: () => ipcRenderer.invoke("permissions:checkAutomation"),
  requestAccessibilityPermission: () => ipcRenderer.invoke("permissions:requestAccessibility"),
  openPermissionPanel: (panel) => ipcRenderer.invoke("permissions:openPanel", panel),
  getTrayDiagnostics: () => ipcRenderer.invoke("tray:diagnostics"),
  recreateTray: () => ipcRenderer.invoke("tray:recreate"),
  testShortcutTrigger: () => ipcRenderer.invoke("shortcut:testTrigger"),
  onHistoryUpdated: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("history:updated", listener);
    return () => ipcRenderer.removeListener("history:updated", listener);
  }
});
