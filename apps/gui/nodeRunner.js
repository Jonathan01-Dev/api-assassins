const { spawn } = require("child_process");
const path = require("path");

let child = null;

function startNode({ projectRoot, env = {} }, onLog) {
  if (child) throw new Error("Node already running");

  const nodeExe = process.execPath; // node
  const entry = path.join(projectRoot, "src", "index.js");

  child = spawn(nodeExe, [entry], {
    cwd: projectRoot,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const pipe = (data) => {
    const text = data.toString("utf8");
    text.split(/\r?\n/).forEach((line) => {
      if (line.trim()) onLog(line);
    });
  };

  child.stdout.on("data", pipe);
  child.stderr.on("data", (d) => pipe(d));

  child.on("close", (code, signal) => {
    onLog(`[GUI] node stopped (code=${code}, signal=${signal || "none"})`);
    child = null;
  });

  onLog("[GUI] node started ✅");
}

function stopNode(onLog) {
  if (!child) {
    onLog("[GUI] node not running");
    return;
  }

  onLog("[GUI] stopping node...");
  child.kill("SIGINT");

  // fallback si ça refuse
  setTimeout(() => {
    if (child) {
      onLog("[GUI] force kill node...");
      child.kill("SIGKILL");
    }
  }, 2000);
}

function isRunning() {
  return !!child;
}

module.exports = { startNode, stopNode, isRunning };