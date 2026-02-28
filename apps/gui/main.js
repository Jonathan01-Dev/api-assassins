const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const { startNode, stopNode, isRunning } = require("./nodeRunner");

let win;

function sendLog(line) {
  if (win && !win.isDestroyed()) {
    win.webContents.send("log", line);
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 980,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, "index.html"));
}

app.whenReady().then(() => {
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

ipcMain.on("ui:ready", (evt) => {
  evt.sender.send("log", "[GUI] ready ✅");
  evt.sender.send("node:status", { running: isRunning() });
});

ipcMain.handle("node:start", async (_evt, { tcpPort }) => {
  const projectRoot = path.resolve(__dirname, "..", ".."); // remonte à la racine du repo
  startNode(
    {
      projectRoot,
      env: {
        TCP_PORT: String(tcpPort || 7777),
      },
    },
    sendLog
  );

  return { ok: true };
});

ipcMain.handle("node:stop", async () => {
  stopNode(sendLog);
  return { ok: true };
});