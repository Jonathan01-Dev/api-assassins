const peerListEl = document.getElementById("peerList");
const fileListEl = document.getElementById("fileList");
const messageListEl = document.getElementById("messageList");
const meNodeEl = document.getElementById("meNode");
const copyMyIdBtn = document.getElementById("copyMyIdBtn");
const pastePeerBtn = document.getElementById("pastePeerBtn");
const chatPeerTitleEl = document.getElementById("chatPeerTitle");
const connectionStateEl = document.getElementById("connectionState");
const manualPeerInput = document.getElementById("manualPeerInput");
const msgForm = document.getElementById("msgForm");
const msgInput = document.getElementById("msgInput");
const usePeerBtn = document.getElementById("usePeerBtn");
const trustBtn = document.getElementById("trustBtn");
const notifBtn = document.getElementById("notifBtn");
const docFab = document.getElementById("docFab");
const docModal = document.getElementById("docModal");
const sendForm = document.getElementById("sendForm");
const closeModalBtn = document.getElementById("closeModalBtn");
const docTargetInput = document.getElementById("docTargetInput");
const docPathInput = document.getElementById("docPathInput");
const toastEl = document.getElementById("toast");

const state = {
  status: null,
  peers: [],
  messages: [],
  files: [],
  selectedPeer: null,
  streamConnected: false,
  seenMessageKeys: new Set(),
  initialized: false,
};

function toast(msg, isError = false) {
  toastEl.textContent = msg;
  toastEl.className = `toast show${isError ? " error" : ""}`;
  setTimeout(() => {
    toastEl.className = "toast";
  }, 2400);
}

async function api(method, route, body) {
  const res = await fetch(route, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });

  const payload = await res.json();
  if (!res.ok || !payload.ok) {
    throw new Error(payload.error || `HTTP ${res.status}`);
  }
  return payload.data;
}

function normalizeNodeInput(v) {
  return String(v || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function shortNode(v) {
  const s = normalizeNodeInput(v);
  return s ? `${s.slice(0, 12)}...${s.slice(-6)}` : "-";
}

function fmtTime(ts) {
  try {
    return new Date(ts).toLocaleTimeString();
  } catch {
    return "--:--";
  }
}

function selectedPeer() {
  if (state.selectedPeer) return state.selectedPeer;
  const fromInput = normalizeNodeInput(manualPeerInput.value);
  return fromInput || null;
}

function renderConnection() {
  connectionStateEl.textContent = state.streamConnected ? "Connexion: live" : "Connexion: reconnexion...";
}

function renderHeader() {
  if (!state.status) return;
  meNodeEl.textContent = `Mon node: ${state.status.nodeId}`;

  const target = selectedPeer();
  if (!target) {
    chatPeerTitleEl.textContent = "Aucun pair sélectionné";
    return;
  }

  const p = state.peers.find((x) => x.nodeId === target || x.nodeId.startsWith(target));
  chatPeerTitleEl.textContent = p
    ? `${shortNode(p.nodeId)} (${p.ip}:${p.tcpPort})`
    : `${shortNode(target)} (manuel)`;
}

function renderPeers() {
  peerListEl.innerHTML = "";

  if (!state.peers.length) {
    peerListEl.innerHTML = '<div class="empty">Aucun pair détecté pour le moment.</div>';
    return;
  }

  for (const p of state.peers) {
    const item = document.createElement("div");
    item.className = `peer-item ${state.selectedPeer === p.nodeId ? "active" : ""}`;

    const trustClass = p.trusted ? "badge trusted" : "badge";
    item.innerHTML = `
      <div class="peer-top">
        <div class="peer-id">${shortNode(p.nodeId)}</div>
        <span class="${trustClass}">${p.trusted ? "trusted" : "tofu"}</span>
      </div>
      <div class="small">${p.ip}:${p.tcpPort} | rep=${p.reputation ?? 1}</div>
      <div class="row" style="margin-top:6px;">
        <button type="button" data-act="select">Ouvrir chat</button>
        <button type="button" data-act="copy" class="ghost">Copier node_id</button>
      </div>
    `;

    item.querySelector('[data-act="select"]').addEventListener("click", () => {
      state.selectedPeer = p.nodeId;
      manualPeerInput.value = p.nodeId;
      renderAll();
    });

    item.querySelector('[data-act="copy"]').addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(p.nodeId);
        toast("node_id copié");
      } catch {
        toast("copie impossible dans ce navigateur", true);
      }
    });

    peerListEl.appendChild(item);
  }
}

function messageKey(m) {
  return `${m.ts}|${m.direction}|${m.from || ""}|${m.to || ""}|${m.text || ""}`;
}

function renderMessages() {
  const target = selectedPeer();

  let messages = Array.isArray(state.messages) ? [...state.messages] : [];
  if (target) {
    messages = messages.filter((m) => {
      const from = normalizeNodeInput(m.from);
      const to = normalizeNodeInput(m.to);
      return from === target || to === target;
    });
  }

  messages.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

  messageListEl.innerHTML = "";
  if (!messages.length) {
    messageListEl.innerHTML = '<div class="empty">Aucun message pour cette conversation.</div>';
    return;
  }

  for (const m of messages) {
    const bubble = document.createElement("div");
    const out = m.direction === "out";
    bubble.className = `bubble ${out ? "out" : "in"}`;
    bubble.innerHTML = `
      <div>${String(m.text || "")}</div>
      <div class="meta">${out ? "moi" : shortNode(m.from)} • ${fmtTime(m.ts)}</div>
    `;
    messageListEl.appendChild(bubble);
  }

  messageListEl.scrollTop = messageListEl.scrollHeight;
}

function renderFiles() {
  fileListEl.innerHTML = "";

  if (!state.files.length) {
    fileListEl.innerHTML = '<div class="empty">Aucun fichier connu.</div>';
    return;
  }

  for (const f of state.files) {
    const item = document.createElement("div");
    item.className = "file-item";

    const sources = Array.isArray(f.sources) ? f.sources : [];
    item.innerHTML = `
      <div class="file-top">
        <div><b>${f.filename || "fichier"}</b></div>
        <span class="badge">${(f.size || 0).toLocaleString()} B</span>
      </div>
      <div class="file-id">${shortNode(f.file_id || "")}</div>
      <div class="small">sources: ${sources.length}</div>
      <div class="row" style="margin-top:6px;">
        <button type="button" data-act="download">Télécharger</button>
        <button type="button" data-act="copy" class="ghost">Copier file_id</button>
      </div>
    `;

    item.querySelector('[data-act="download"]').addEventListener("click", async () => {
      try {
        const out = await api("POST", "/api/download", { fileId: f.file_id });
        toast(`Téléchargé: ${out.outPath}`);
      } catch (err) {
        toast(err.message, true);
      }
    });

    item.querySelector('[data-act="copy"]').addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(f.file_id || "");
        toast("file_id copié");
      } catch {
        toast("copie impossible", true);
      }
    });

    fileListEl.appendChild(item);
  }
}

function notifyIncoming(newMessages) {
  if (!state.initialized) return;

  const unread = newMessages.filter((m) => m.direction === "in");
  if (!unread.length) return;

  const last = unread[unread.length - 1];
  toast(`Nouveau message de ${shortNode(last.from)}`);

  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    new Notification(`Nouveau message`, {
      body: `${shortNode(last.from)}: ${String(last.text || "").slice(0, 90)}`,
    });
  }
}

function applySnapshot(snapshot) {
  state.status = snapshot.status || null;
  state.peers = Array.isArray(snapshot.peers) ? snapshot.peers : [];
  state.messages = Array.isArray(snapshot.messages) ? snapshot.messages : [];
  state.files = Array.isArray(snapshot.files) ? snapshot.files : [];

  const fresh = [];
  for (const m of state.messages) {
    const key = messageKey(m);
    if (!state.seenMessageKeys.has(key)) {
      fresh.push(m);
      state.seenMessageKeys.add(key);
    }
  }

  if (state.seenMessageKeys.size > 2000) {
    const keys = Array.from(state.seenMessageKeys).slice(-1200);
    state.seenMessageKeys = new Set(keys);
  }

  notifyIncoming(fresh);
  renderAll();
  state.initialized = true;
}

function renderAll() {
  renderConnection();
  renderHeader();
  renderPeers();
  renderMessages();
  renderFiles();
}

async function loadInitial() {
  const snapshot = await api("GET", "/api/snapshot");
  applySnapshot(snapshot);
}

function connectStream() {
  const es = new EventSource("/api/stream");

  es.addEventListener("snapshot", (evt) => {
    try {
      const data = JSON.parse(evt.data);
      state.streamConnected = true;
      applySnapshot(data);
    } catch {
      // ignore malformed snapshot
    }
  });

  es.onopen = () => {
    state.streamConnected = true;
    renderConnection();
  };

  es.onerror = () => {
    state.streamConnected = false;
    renderConnection();
  };
}

function openDocModal() {
  const target = selectedPeer();
  docTargetInput.value = target || "";
  docPathInput.value = "";
  docModal.classList.remove("hidden");
}

function closeDocModal() {
  docModal.classList.add("hidden");
}

function bindUi() {
  copyMyIdBtn.addEventListener("click", async () => {
    const nodeId = state.status?.nodeId;
    if (!nodeId) return toast("Node ID indisponible", true);

    try {
      await navigator.clipboard.writeText(nodeId);
      toast("Mon node_id copié");
    } catch {
      toast("Copie impossible (permission clipboard)", true);
    }
  });

  pastePeerBtn.addEventListener("click", async () => {
    try {
      const raw = await navigator.clipboard.readText();
      const pasted = normalizeNodeInput(raw);
      if (!pasted) return toast("Presse-papiers vide", true);

      manualPeerInput.value = pasted;
      state.selectedPeer = pasted;
      renderAll();
      toast("node_id collé");
    } catch {
      toast("Collage impossible (permission clipboard)", true);
    }
  });

  usePeerBtn.addEventListener("click", () => {
    const pasted = normalizeNodeInput(manualPeerInput.value);
    if (!pasted) return toast("Colle un node_id", true);

    state.selectedPeer = pasted;
    renderAll();
  });

  trustBtn.addEventListener("click", async () => {
    const target = selectedPeer();
    if (!target) return toast("Sélectionne un pair d'abord", true);

    try {
      await api("POST", "/api/trust", { nodeId: target });
      toast("Pair marqué trusted");
    } catch (err) {
      toast(err.message, true);
    }
  });

  notifBtn.addEventListener("click", async () => {
    if (typeof Notification === "undefined") {
      return toast("Notifications non supportées", true);
    }

    const p = await Notification.requestPermission();
    if (p === "granted") toast("Notifications activées");
    else toast("Notifications refusées", true);
  });

  msgForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const target = selectedPeer();
    const text = String(msgInput.value || "").trim();

    if (!target) return toast("Sélectionne un pair ou colle le node_id", true);
    if (!text) return;

    try {
      await api("POST", "/api/msg", { nodeId: target, text });
      msgInput.value = "";
      toast("Message envoyé");
    } catch (err) {
      toast(err.message, true);
    }
  });

  docFab.addEventListener("click", openDocModal);
  closeModalBtn.addEventListener("click", closeDocModal);
  docModal.addEventListener("click", (e) => {
    if (e.target === docModal) closeDocModal();
  });

  sendForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const nodeId = normalizeNodeInput(docTargetInput.value);
    const filePath = String(docPathInput.value || "").trim();

    if (!nodeId || !filePath) return toast("node_id et chemin fichier requis", true);

    try {
      const out = await api("POST", "/api/send", { nodeId, filePath });
      toast(`Manifest envoyé: ${String(out.fileId || "").slice(0, 12)}...`);
      closeDocModal();
    } catch (err) {
      toast(err.message, true);
    }
  });
}

(async () => {
  bindUi();

  try {
    await loadInitial();
  } catch (err) {
    toast(err.message, true);
  }

  connectStream();
})();
