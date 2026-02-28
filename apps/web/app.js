const statusOut = document.getElementById("statusOut");
const peersOut = document.getElementById("peersOut");
const filesOut = document.getElementById("filesOut");
const eventsOut = document.getElementById("eventsOut");
const toastEl = document.getElementById("toast");
const metaEl = document.getElementById("meta");

function toast(msg, isError = false) {
  toastEl.textContent = msg;
  toastEl.className = `toast show${isError ? " error" : ""}`;
  setTimeout(() => {
    toastEl.className = "toast";
  }, 2200);
}

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data.data;
}

function pretty(obj) {
  return JSON.stringify(obj, null, 2);
}

async function refresh() {
  try {
    const [status, peers, files, events] = await Promise.all([
      api("GET", "/api/status"),
      api("GET", "/api/peers"),
      api("GET", "/api/files"),
      api("GET", "/api/events?limit=120"),
    ]);

    statusOut.textContent = pretty(status);
    peersOut.textContent = peers.length ? pretty(peers) : "Aucun pair détecté.";
    filesOut.textContent = files.length ? pretty(files) : "Aucun fichier disponible.";
    eventsOut.textContent = events.length ? events.join("\n") : "Aucun événement.";

    metaEl.textContent = `node=${status.nodeId?.slice(0, 14)}... | tcp=${status.tcpPort} | peers=${status.peers} | uptime=${status.uptimeSec}s`;
  } catch (e) {
    toast(e.message, true);
  }
}

function bindForms() {
  document.getElementById("msgForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      await api("POST", "/api/msg", {
        nodeId: f.get("nodeId"),
        text: f.get("text"),
      });
      toast("Message envoyé");
      e.currentTarget.reset();
      refresh();
    } catch (err) {
      toast(err.message, true);
    }
  });

  document.getElementById("sendForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      const out = await api("POST", "/api/send", {
        nodeId: f.get("nodeId"),
        filePath: f.get("filePath"),
      });
      toast(`Manifest envoyé: ${out.fileId.slice(0, 12)}...`);
      refresh();
    } catch (err) {
      toast(err.message, true);
    }
  });

  document.getElementById("downloadForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      const out = await api("POST", "/api/download", { fileId: f.get("fileId") });
      toast(`Téléchargé: ${out.outPath}`);
      refresh();
    } catch (err) {
      toast(err.message, true);
    }
  });

  document.getElementById("trustForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      await api("POST", "/api/trust", { nodeId: f.get("nodeId") });
      toast("Pair marqué trusted");
      refresh();
    } catch (err) {
      toast(err.message, true);
    }
  });
}

bindForms();
refresh();
setInterval(refresh, 5000);
