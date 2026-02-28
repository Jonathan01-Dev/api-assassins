const peerTableBody = document.getElementById("peerTableBody");
const transferTableBody = document.getElementById("transferTableBody");
const conversationList = document.getElementById("conversationList");
const messageListEl = document.getElementById("messageList");
const chatPeerTitleEl = document.getElementById("chatPeerTitle");
const securityEventsEl = document.getElementById("securityEvents");
const fingerprintListEl = document.getElementById("fingerprintList");
const wotListEl = document.getElementById("wotList");

const connectionStateEl = document.getElementById("connectionState");
const nodeStatusPillEl = document.getElementById("nodeStatusPill");
const aiModePillEl = document.getElementById("aiModePill");

const nodeIdValue = document.getElementById("nodeIdValue");
const statusValue = document.getElementById("statusValue");
const tcpPortValue = document.getElementById("tcpPortValue");
const peerCountValue = document.getElementById("peerCountValue");
const cipherValue = document.getElementById("cipherValue");
const cipherAlgoValue = document.getElementById("cipherAlgoValue");
const msgSentValue = document.getElementById("msgSentValue");
const msgRecvValue = document.getElementById("msgRecvValue");
const chunksValue = document.getElementById("chunksValue");
const filesSharedValue = document.getElementById("filesSharedValue");

const copyMyIdBtn = document.getElementById("copyMyIdBtn");
const pastePeerBtn = document.getElementById("pastePeerBtn");
const bootstrapNodeId = document.getElementById("bootstrapNodeId");
const bootstrapAddr = document.getElementById("bootstrapAddr");
const addPeerBtn = document.getElementById("addPeerBtn");
const manualPeerInput = document.getElementById("manualPeerInput");
const usePeerBtn = document.getElementById("usePeerBtn");
const trustBtn = document.getElementById("trustBtn");
const revokeKeyBtn = document.getElementById("revokeKeyBtn");
const notifBtn = document.getElementById("notifBtn");

const msgForm = document.getElementById("msgForm");
const msgInput = document.getElementById("msgInput");
const aiDraftBtn = document.getElementById("aiDraftBtn");

const openUploadBtn = document.getElementById("openUploadBtn");
const docModal = document.getElementById("docModal");
const sendForm = document.getElementById("sendForm");
const closeModalBtn = document.getElementById("closeModalBtn");
const docTargetInput = document.getElementById("docTargetInput");
const docFileInput = document.getElementById("docFileInput");
const docPathInput = document.getElementById("docPathInput");

const toastEl = document.getElementById("toast");

const state = {
  status: null,
  peers: [],
  messages: [],
  files: [],
  trust: [],
  events: [],
  ai: { configured: false, disabled: true, model: "gemini-2.0-flash" },
  selectedPeer: null,
  streamConnected: false,
  initialized: false,
  seenMessageKeys: new Set(),
};

function toast(msg, isError = false) {
  toastEl.textContent = msg;
  toastEl.className = `toast show${isError ? " error" : ""}`;
  setTimeout(() => {
    toastEl.className = `toast${isError ? " error" : ""}`;
  }, 2400);
}

async function api(method, route, body) {
  const res = await fetch(route, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });

  const payload = await res.json().catch(() => ({}));
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

function shortHash(v) {
  const s = String(v || "").trim();
  return s ? `${s.slice(0, 16)}...${s.slice(-8)}` : "-";
}

function fmtDate(ts) {
  if (!ts) return "-";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "-";
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
}

function fmtAgo(ts) {
  const t = Number(ts || 0);
  if (!t) return "-";
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

function fmtBytes(n) {
  const x = Number(n || 0);
  if (x < 1024) return `${x} B`;
  if (x < 1024 * 1024) return `${(x / 1024).toFixed(1)} KB`;
  if (x < 1024 * 1024 * 1024) return `${(x / (1024 * 1024)).toFixed(1)} MB`;
  return `${(x / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function selectedPeer() {
  if (state.selectedPeer) return state.selectedPeer;
  const fromInput = normalizeNodeInput(manualPeerInput.value);
  return fromInput || null;
}

function resolvePeer(nodeIdInput) {
  const nodeId = normalizeNodeInput(nodeIdInput);
  if (!nodeId) return null;
  return state.peers.find((p) => p.nodeId === nodeId || p.nodeId.startsWith(nodeId)) || null;
}

function isPeerActive(peer) {
  return Date.now() - Number(peer?.lastSeen || 0) <= 45_000;
}

function trustForNode(nodeId) {
  const nid = normalizeNodeInput(nodeId);
  return state.trust.find((t) => normalizeNodeInput(t.nodeId) === nid) || null;
}

function trustLabel(peer) {
  const trust = trustForNode(peer.nodeId);
  const status = String(trust?.status || (peer?.trusted ? "trusted" : "tofu")).toLowerCase();
  if (status === "trusted" || status === "verified" || status === "verifie") return "Vérifié";
  if (status === "signed" || status === "signe") return "Signé";
  return "TOFU";
}

function messageKey(m) {
  return `${m.ts}|${m.direction}|${m.from || ""}|${m.to || ""}|${m.text || ""}`;
}

function getPeerMessages(nodeId) {
  const target = normalizeNodeInput(nodeId);
  if (!target) return [];
  return (state.messages || [])
    .filter((m) => {
      const from = normalizeNodeInput(m.from);
      const to = normalizeNodeInput(m.to);
      return from === target || to === target;
    })
    .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
}

function renderPills() {
  connectionStateEl.textContent = state.streamConnected ? "stream: live" : "stream: reconnect";
  const running = Boolean(state.status?.running);
  nodeStatusPillEl.textContent = `node: ${running ? "en ligne" : "hors ligne"}`;

  if (state.ai?.disabled) {
    aiModePillEl.textContent = "ai: --no-ai";
  } else if (!state.ai?.configured) {
    aiModePillEl.textContent = "ai: offline (no key)";
  } else {
    aiModePillEl.textContent = `ai: ${state.ai.model || "gemini"}`;
  }
}

function renderDashboard() {
  const s = state.status || {};
  const nodeId = String(s.nodeId || "");
  const enc = s.encryption || {};
  const stats = s.stats || {};

  nodeIdValue.textContent = shortNode(nodeId);
  nodeIdValue.title = nodeId || "";
  statusValue.textContent = s.running ? "En ligne" : "Hors ligne";
  tcpPortValue.textContent = String(s.tcpPort || "-");
  peerCountValue.textContent = String(state.peers.length);
  cipherValue.textContent = enc.active ? "Actif" : "Inactif";
  cipherAlgoValue.textContent = enc.transport || "XChaCha20-Poly1305";

  msgSentValue.textContent = String(stats.messagesSent || 0);
  msgRecvValue.textContent = String(stats.messagesReceived || 0);
  chunksValue.textContent = String((stats.chunksServed || 0) + (stats.chunksDownloaded || 0));
  filesSharedValue.textContent = String(s.sharedFiles || 0);
}

function renderPeersTable() {
  peerTableBody.innerHTML = "";

  if (!state.peers.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = '<td colspan="8" class="empty">Aucun pair détecté.</td>';
    peerTableBody.appendChild(tr);
    return;
  }

  for (const p of state.peers) {
    const tr = document.createElement("tr");
    const active = isPeerActive(p);
    const trust = trustLabel(p);

    const idTd = document.createElement("td");
    idTd.className = "wrap";
    idTd.textContent = shortNode(p.nodeId);
    idTd.title = p.nodeId;

    const ipTd = document.createElement("td");
    ipTd.textContent = String(p.ip || "-");

    const portTd = document.createElement("td");
    portTd.textContent = String(p.tcpPort || "-");

    const seenTd = document.createElement("td");
    seenTd.textContent = `${fmtAgo(p.lastSeen)} (${fmtDate(p.lastSeen)})`;

    const repTd = document.createElement("td");
    repTd.textContent = String(p.reputation ?? 1);

    const trustTd = document.createElement("td");
    const trustSpan = document.createElement("span");
    trustSpan.className = `badge${trust === "Vérifié" ? " secure" : ""}`;
    trustSpan.textContent = trust;
    trustTd.appendChild(trustSpan);

    const stateTd = document.createElement("td");
    stateTd.innerHTML = `<span class="state-dot ${active ? "active" : "inactive"}"></span>${active ? "actif" : "inactif"}`;

    const actionTd = document.createElement("td");
    const chatBtn = document.createElement("button");
    chatBtn.type = "button";
    chatBtn.textContent = "Chat";
    chatBtn.addEventListener("click", () => {
      state.selectedPeer = p.nodeId;
      manualPeerInput.value = p.nodeId;
      renderAll();
    });

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "ghost";
    copyBtn.textContent = "Copier";
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(p.nodeId);
        toast("node_id copié");
      } catch {
        toast("copie impossible", true);
      }
    });

    actionTd.appendChild(chatBtn);
    actionTd.appendChild(document.createTextNode(" "));
    actionTd.appendChild(copyBtn);

    tr.appendChild(idTd);
    tr.appendChild(ipTd);
    tr.appendChild(portTd);
    tr.appendChild(seenTd);
    tr.appendChild(repTd);
    tr.appendChild(trustTd);
    tr.appendChild(stateTd);
    tr.appendChild(actionTd);
    peerTableBody.appendChild(tr);
  }
}

function renderConversations() {
  conversationList.innerHTML = "";

  const map = new Map();
  for (const p of state.peers) {
    map.set(p.nodeId, {
      nodeId: p.nodeId,
      lastTs: Number(p.lastSeen || 0),
      preview: `${p.ip}:${p.tcpPort}`,
    });
  }

  for (const m of state.messages || []) {
    const other = normalizeNodeInput(m.direction === "out" ? m.to : m.from);
    if (!other) continue;
    const ts = new Date(m.ts).getTime() || Date.now();
    const existing = map.get(other) || { nodeId: other, lastTs: 0, preview: "" };
    if (ts >= existing.lastTs) {
      existing.lastTs = ts;
      existing.preview = String(m.text || "").slice(0, 46);
    }
    map.set(other, existing);
  }

  const rows = Array.from(map.values()).sort((a, b) => b.lastTs - a.lastTs);
  if (!rows.length) {
    conversationList.innerHTML = '<div class="empty">Aucune conversation.</div>';
    return;
  }

  for (const row of rows) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `conv-item ${normalizeNodeInput(state.selectedPeer) === normalizeNodeInput(row.nodeId) ? "active" : ""}`;
    btn.innerHTML = `
      <div class="conv-id">${shortNode(row.nodeId)}</div>
      <div class="conv-meta">${row.preview || "..."}</div>
      <div class="conv-meta">${fmtDate(row.lastTs)}</div>
    `;
    btn.addEventListener("click", () => {
      state.selectedPeer = row.nodeId;
      manualPeerInput.value = row.nodeId;
      renderAll();
    });
    conversationList.appendChild(btn);
  }
}

function renderChat() {
  const target = selectedPeer();
  if (!target) {
    chatPeerTitleEl.textContent = "Aucun pair sélectionné";
    messageListEl.innerHTML = '<div class="empty">Sélectionne un pair dans la liste de conversations.</div>';
    return;
  }

  const peer = resolvePeer(target);
  chatPeerTitleEl.textContent = peer ? `${shortNode(peer.nodeId)} (${peer.ip}:${peer.tcpPort})` : shortNode(target);

  const messages = getPeerMessages(target);
  messageListEl.innerHTML = "";
  if (!messages.length) {
    messageListEl.innerHTML = '<div class="empty">Aucun message pour cette conversation.</div>';
    return;
  }

  for (const m of messages) {
    const bubble = document.createElement("div");
    bubble.className = `bubble ${m.direction === "out" ? "out" : "in"}`;

    const text = document.createElement("div");
    text.textContent = String(m.text || "");
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = `${m.direction === "out" ? "moi" : shortNode(m.from)} • ${fmtDate(m.ts)}`;

    bubble.appendChild(text);
    bubble.appendChild(meta);
    messageListEl.appendChild(bubble);
  }

  messageListEl.scrollTop = messageListEl.scrollHeight;
}

function renderTransfers() {
  transferTableBody.innerHTML = "";

  if (!state.files.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = '<td colspan="7" class="empty">Aucun manifest reçu.</td>';
    transferTableBody.appendChild(tr);
    return;
  }

  const corruptionSeen = (state.events || []).some((e) => String(e).toLowerCase().includes("hash mismatch"));

  for (const f of state.files) {
    const tr = document.createElement("tr");
    const sources = Array.isArray(f.sources) ? f.sources.length : 0;
    const progress = 100;

    tr.innerHTML = `
      <td class="wrap">${String(f.filename || "fichier")}</td>
      <td>${fmtBytes(f.size || 0)}</td>
      <td class="wrap">${shortHash(f.file_id || "")}</td>
      <td>${Number(f.nb_chunks || 0)}</td>
      <td>${sources}</td>
      <td>
        <div class="progress"><div class="bar" style="width:${progress}%"></div></div>
        <div class="small">${progress}% ${corruptionSeen ? "| chunk corrompu détecté puis re-téléchargé" : ""}</div>
      </td>
      <td></td>
    `;

    const actionTd = tr.lastElementChild;
    const dlBtn = document.createElement("button");
    dlBtn.type = "button";
    dlBtn.textContent = "Télécharger";
    dlBtn.addEventListener("click", async () => {
      try {
        const out = await api("POST", "/api/download", { fileId: f.file_id });
        toast(`Téléchargé: ${out.outPath}`);
      } catch (err) {
        toast(err.message, true);
      }
    });

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "ghost";
    copyBtn.textContent = "Copier hash";
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(String(f.file_id || ""));
        toast("hash copié");
      } catch {
        toast("copie impossible", true);
      }
    });

    actionTd.appendChild(dlBtn);
    actionTd.appendChild(document.createTextNode(" "));
    actionTd.appendChild(copyBtn);
    transferTableBody.appendChild(tr);
  }
}

function renderTrust() {
  fingerprintListEl.innerHTML = "";
  wotListEl.innerHTML = "";

  const trustRows = Array.isArray(state.trust) ? [...state.trust] : [];
  if (!trustRows.length) {
    fingerprintListEl.innerHTML = '<div class="empty">Aucune empreinte disponible.</div>';
    wotListEl.innerHTML = '<div class="empty">Aucune signature Web of Trust.</div>';
  } else {
    for (const t of trustRows) {
      const item = document.createElement("div");
      item.className = "stack-item";
      item.innerHTML = `<b>${shortNode(t.nodeId)}</b><br/><span class="small">${shortHash(t.fingerprint)}</span>`;
      fingerprintListEl.appendChild(item);

      const trustState = String(t.status || "tofu").toLowerCase();
      const trustLabelText = trustState === "trusted" ? "Vérifié" : trustState === "signed" ? "Signé" : "TOFU";
      const sig = document.createElement("div");
      sig.className = "stack-item";
      sig.innerHTML = `
        <b>${shortNode(t.nodeId)}</b>
        <div class="small">Niveau: ${trustLabelText}</div>
        <div class="small">first_seen: ${fmtDate(t.firstSeenAt)}</div>
        <div class="small">trusted_at: ${fmtDate(t.trustedAt)}</div>
      `;
      wotListEl.appendChild(sig);
    }
  }

  const securityRows = (state.events || []).slice(-80);
  securityEventsEl.textContent = securityRows.length ? securityRows.join("\n") : "Aucun événement sécurité.";
}

function renderAll() {
  renderPills();
  renderDashboard();
  renderPeersTable();
  renderConversations();
  renderChat();
  renderTransfers();
  renderTrust();
}

function notifyIncoming(newMessages) {
  if (!state.initialized) return;
  const incoming = newMessages.filter((m) => m.direction === "in");
  if (!incoming.length) return;

  const last = incoming[incoming.length - 1];
  toast(`Nouveau message de ${shortNode(last.from)}`);

  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    new Notification("Message chiffré reçu", {
      body: `${shortNode(last.from)}: ${String(last.text || "").slice(0, 90)}`,
    });
  }
}

function applySnapshot(snapshot) {
  state.status = snapshot.status || null;
  state.peers = Array.isArray(snapshot.peers) ? snapshot.peers : [];
  state.messages = Array.isArray(snapshot.messages) ? snapshot.messages : [];
  state.files = Array.isArray(snapshot.files) ? snapshot.files : [];
  state.trust = Array.isArray(snapshot.trust) ? snapshot.trust : state.trust;
  state.events = Array.isArray(snapshot.events) ? snapshot.events : state.events;
  state.ai = snapshot.ai || state.ai;

  const fresh = [];
  for (const m of state.messages) {
    const key = messageKey(m);
    if (!state.seenMessageKeys.has(key)) {
      state.seenMessageKeys.add(key);
      fresh.push(m);
    }
  }
  if (state.seenMessageKeys.size > 2400) {
    state.seenMessageKeys = new Set(Array.from(state.seenMessageKeys).slice(-1400));
  }

  notifyIncoming(fresh);
  renderAll();
  state.initialized = true;
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
      // ignore malformed stream payload
    }
  });

  es.onopen = () => {
    state.streamConnected = true;
    renderPills();
  };

  es.onerror = () => {
    state.streamConnected = false;
    renderPills();
  };
}

async function refreshAiStatus() {
  try {
    state.ai = await api("GET", "/api/ai/status");
    renderPills();
  } catch {
    // keep default
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const out = String(reader.result || "");
      const idx = out.indexOf(",");
      if (idx < 0) return reject(new Error("lecture fichier invalide"));
      resolve(out.slice(idx + 1));
    };
    reader.onerror = () => reject(new Error("échec lecture fichier"));
    reader.readAsDataURL(file);
  });
}

function buildAiPrompt(targetNodeId, userPrompt) {
  const target = normalizeNodeInput(targetNodeId);
  const history = getPeerMessages(target)
    .slice(-12)
    .map((m) => `${m.direction === "out" ? "moi" : "pair"}: ${String(m.text || "")}`)
    .join("\n");

  return [
    "Contexte: messagerie P2P chiffrée Archipel.",
    "Consigne: réponse technique, claire, simple en français (max 2 phrases).",
    target ? `Pair cible: ${target}` : "",
    history ? `Historique:\n${history}` : "Historique: vide",
    `Demande: ${String(userPrompt || "").trim() || "Propose une réponse courte et utile."}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function generateAiDraft(userPrompt = "") {
  if (state.ai?.disabled) {
    throw new Error("mode offline --no-ai actif");
  }
  if (!state.ai?.configured) {
    throw new Error("Gemini non configuré (GEMINI_API_KEY manquant)");
  }

  const target = selectedPeer();
  const prompt = buildAiPrompt(target, userPrompt);
  const out = await api("POST", "/api/ai/generate", {
    prompt,
    maxOutputTokens: 220,
    temperature: 0.45,
  });
  return String(out.text || "").trim();
}

function openDocModal() {
  docTargetInput.value = selectedPeer() || "";
  docFileInput.value = "";
  docPathInput.value = "";
  docModal.classList.remove("hidden");
}

function closeDocModal() {
  docModal.classList.add("hidden");
}

function bindUi() {
  copyMyIdBtn.addEventListener("click", async () => {
    const nodeId = String(state.status?.nodeId || "");
    if (!nodeId) return toast("Node ID indisponible", true);
    try {
      await navigator.clipboard.writeText(nodeId);
      toast("Node ID copié");
    } catch {
      toast("copie impossible", true);
    }
  });

  pastePeerBtn.addEventListener("click", async () => {
    try {
      const raw = await navigator.clipboard.readText();
      const pasted = normalizeNodeInput(raw);
      if (!pasted) return toast("presse-papiers vide", true);
      manualPeerInput.value = pasted;
      state.selectedPeer = pasted;
      renderAll();
      toast("node_id collé");
    } catch {
      toast("collage impossible", true);
    }
  });

  addPeerBtn.addEventListener("click", async () => {
    const nodeId = normalizeNodeInput(bootstrapNodeId.value);
    const addr = String(bootstrapAddr.value || "").trim();
    if (!nodeId || !addr) return toast("node_id et IP:PORT requis", true);

    const [ipRaw, portRaw] = addr.split(":");
    const ip = String(ipRaw || "").trim();
    const tcpPort = Number(portRaw || 7777);
    if (!ip || !Number.isInteger(tcpPort)) return toast("adresse invalide (IP:PORT)", true);

    try {
      await api("POST", "/api/peer", { nodeId, ip, tcpPort });
      manualPeerInput.value = nodeId;
      state.selectedPeer = nodeId;
      toast("pair ajouté");
    } catch (err) {
      toast(err.message, true);
    }
  });

  usePeerBtn.addEventListener("click", () => {
    const pasted = normalizeNodeInput(manualPeerInput.value);
    if (!pasted) return toast("colle un node_id", true);
    state.selectedPeer = pasted;
    renderAll();
  });

  trustBtn.addEventListener("click", async () => {
    const target = selectedPeer();
    if (!target) return toast("sélectionne un pair", true);
    try {
      await api("POST", "/api/trust", { nodeId: target });
      toast("pair approuvé");
    } catch (err) {
      toast(err.message, true);
    }
  });

  revokeKeyBtn.addEventListener("click", async () => {
    const ok = window.confirm("Révoquer ta clé locale ? Une nouvelle clé sera prête mais un redémarrage sera requis.");
    if (!ok) return;
    try {
      const out = await api("POST", "/api/security/revoke-key", {});
      toast(`Clé révoquée. Nouveau node: ${shortNode(out.nextNodeId)} (redémarrage requis).`);
    } catch (err) {
      toast(err.message, true);
    }
  });

  notifBtn.addEventListener("click", async () => {
    if (typeof Notification === "undefined") return toast("notifications non supportées", true);
    const p = await Notification.requestPermission();
    toast(p === "granted" ? "notifications activées" : "notifications refusées", p !== "granted");
  });

  aiDraftBtn.addEventListener("click", async () => {
    try {
      toast("génération IA en cours...");
      const draft = await generateAiDraft(String(msgInput.value || ""));
      msgInput.value = draft;
      msgInput.focus();
      toast("brouillon IA prêt");
    } catch (err) {
      toast(err.message, true);
    }
  });

  msgForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const target = selectedPeer();
    const text = String(msgInput.value || "").trim();
    if (!target) return toast("sélectionne un pair ou colle un node_id", true);
    if (!text) return;

    const askPrefix = text.startsWith("/ask ") || text === "/ask";
    const mentionPrefix = text.startsWith("@archipel-ai ");
    if (askPrefix || mentionPrefix) {
      const prompt = askPrefix ? text.replace(/^\/ask\s*/i, "") : text.replace(/^@archipel-ai\s*/i, "");
      try {
        toast("commande IA détectée...");
        const draft = await generateAiDraft(prompt);
        msgInput.value = draft;
        toast("réponse IA générée, vérifie puis envoie");
      } catch (err) {
        toast(err.message, true);
      }
      return;
    }

    try {
      await api("POST", "/api/msg", { nodeId: target, text });
      msgInput.value = "";
      toast("message envoyé");
    } catch (err) {
      toast(err.message, true);
    }
  });

  openUploadBtn.addEventListener("click", openDocModal);
  closeModalBtn.addEventListener("click", closeDocModal);
  docModal.addEventListener("click", (e) => {
    if (e.target === docModal) closeDocModal();
  });

  sendForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const nodeId = normalizeNodeInput(docTargetInput.value);
    const file = docFileInput.files && docFileInput.files[0] ? docFileInput.files[0] : null;
    const filePath = String(docPathInput.value || "").trim();

    if (!nodeId) return toast("node_id requis", true);
    if (!file && !filePath) return toast("choisis un fichier ou un chemin", true);

    try {
      let out;
      if (file) {
        toast("upload en cours...");
        const data_b64 = await fileToBase64(file);
        out = await api("POST", "/api/send-upload", {
          nodeId,
          filename: file.name || "upload.bin",
          data_b64,
        });
      } else {
        out = await api("POST", "/api/send", { nodeId, filePath });
      }
      toast(`manifest envoyé: ${shortHash(out.fileId || "")}`);
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
    await refreshAiStatus();
  } catch (err) {
    toast(err.message, true);
  }
  connectStream();
})();
