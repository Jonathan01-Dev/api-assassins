const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  ready: () => ipcRenderer.send("ui:ready"),
  onLog: (cb) => ipcRenderer.on("log", (_evt, msg) => cb(msg)),
  onStatus: (cb) => ipcRenderer.on("node:status", (_evt, status) => cb(status)),
  startNode: (tcpPort) => ipcRenderer.invoke("node:start", { tcpPort }),
  stopNode: () => ipcRenderer.invoke("node:stop"),
});