const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const net = require("net");
const crypto = require("crypto");
const sodium = require("libsodium-wrappers");

const { loadOrCreateIdentity, nodeIdFromPublicKey } = require("../crypto/identity");
const { createKxKeypair, deriveSessionKeys } = require("../crypto/handshake");
const { startDiscovery, DEFAULT_MCAST_ADDR, DEFAULT_UDP_PORT } = require("../network/discovery");
const { PeerTable } = require("../network/peerTable");
const { encodeFrame, FrameDecoder } = require("../network/frame");
const {
  FRAME_KX_PUB,
  FRAME_ENCRYPTED,
  SecureChannelState,
  sealFrameState,
  openFrameState,
} = require("../network/secureChannel");
const {
  TYPE,
  TYPE_NAME,
  encodePacket,
  decodePacket,
  sha256Hex,
  signManifest,
  verifyManifestSignature,
} = require("../protocol");

const INNER_PROTOCOL_TYPE = 42;

function ensureDirSync(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function readJsonSync(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonSync(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

class ArchipelNode {
  constructor(opts = {}) {
    this.tcpPort = Number(opts.tcpPort || 7777);
    this.udpPort = Number(opts.udpPort || DEFAULT_UDP_PORT);
    this.multicastAddr = opts.multicastAddr || DEFAULT_MCAST_ADDR;
    this.peerTimeoutMs = Number(opts.peerTimeoutMs || 90_000);
    this.chunkSize = Number(opts.chunkSize || 524_288);
    this.helloIntervalMs = Number(opts.helloIntervalMs || 30_000);

    this.dataDir = path.resolve(opts.dataDir || path.join(process.cwd(), ".archipel", `node-${this.tcpPort}`));
    this.downloadDir = path.join(this.dataDir, "downloads");

    this.paths = {
      peers: path.join(this.dataDir, "peers.json"),
      trust: path.join(this.dataDir, "trust.json"),
      manifests: path.join(this.dataDir, "manifests.json"),
      shares: path.join(this.dataDir, "shares.json"),
      messages: path.join(this.dataDir, "messages.json"),
      stats: path.join(this.dataDir, "stats.json"),
    };

    this.identity = null;
    this.nodeId = null;

    this.peerTable = new PeerTable();
    this.discovery = null;
    this.tcpServer = null;
    this.maintenanceTimer = null;

    this.running = false;
    this.startedAt = null;

    this.trustStore = {};
    this.manifests = {};
    this.shares = {};
    this.messages = [];
    this.events = [];

    this.stats = {
      messagesSent: 0,
      messagesReceived: 0,
      filesSent: 0,
      filesReceived: 0,
      chunksServed: 0,
      chunksDownloaded: 0,
      startedAt: null,
    };
  }

  log(line) {
    const msg = `[${new Date().toISOString()}] ${line}`;
    this.events.push(msg);
    if (this.events.length > 300) this.events.shift();
    console.log(line);
  }

  _loadState() {
    ensureDirSync(this.dataDir);
    ensureDirSync(this.downloadDir);

    this.peerTable.hydrate(readJsonSync(this.paths.peers, []));
    this.trustStore = readJsonSync(this.paths.trust, {});
    this.manifests = readJsonSync(this.paths.manifests, {});
    this.shares = readJsonSync(this.paths.shares, {});
    this.messages = readJsonSync(this.paths.messages, []);
    this.stats = { ...this.stats, ...readJsonSync(this.paths.stats, {}) };
  }

  _saveState() {
    writeJsonSync(this.paths.peers, this.peerTable.asSerializable());
    writeJsonSync(this.paths.trust, this.trustStore);
    writeJsonSync(this.paths.manifests, this.manifests);
    writeJsonSync(this.paths.shares, this.shares);
    writeJsonSync(this.paths.messages, this.messages.slice(-500));
    writeJsonSync(this.paths.stats, this.stats);
  }

  getSharedFileIds() {
    const ids = new Set();
    for (const id of Object.keys(this.shares)) ids.add(id);
    for (const id of Object.keys(this.manifests)) ids.add(id);
    return Array.from(ids);
  }

  async start() {
    if (this.running) return;
    await sodium.ready;

    this._loadState();

    this.identity = await loadOrCreateIdentity({ homeDir: this.dataDir });
    this.nodeId = nodeIdFromPublicKey(this.identity.publicKey);

    this.startedAt = Date.now();
    this.stats.startedAt = new Date(this.startedAt).toISOString();

    this.tcpServer = this._startTcpServer();
    this.discovery = startDiscovery({
      nodeId: this.nodeId,
      tcpPort: this.tcpPort,
      udpPort: this.udpPort,
      multicastAddr: this.multicastAddr,
      helloIntervalMs: this.helloIntervalMs,
      getHelloExtra: () => ({ sharedFiles: this.getSharedFileIds() }),
      onHello: (peer) => {
        this.peerTable.upsertPeer({
          nodeId: peer.nodeId,
          ip: peer.ip,
          tcpPort: peer.tcpPort,
          lastSeen: peer.ts,
          sharedFiles: peer.sharedFiles,
        });
      },
    });

    this.maintenanceTimer = setInterval(() => {
      this.peerTable.pruneExpiredPeers(this.peerTimeoutMs);
      this._saveState();
    }, 5_000);

    this.running = true;
    this.log(`[NODE] started nodeId=${this.nodeId.slice(0, 12)}... tcp=${this.tcpPort} dataDir=${this.dataDir}`);
  }

  async stop() {
    this.running = false;

    if (this.maintenanceTimer) {
      clearInterval(this.maintenanceTimer);
      this.maintenanceTimer = null;
    }

    if (this.discovery) {
      this.discovery.stop();
      this.discovery = null;
    }

    if (this.tcpServer) {
      await new Promise((resolve) => this.tcpServer.close(() => resolve()));
      this.tcpServer = null;
    }

    this._saveState();
    this.log("[NODE] stopped");
  }

  _fingerprintKey(publicKeyBytes) {
    return crypto.createHash("sha256").update(Buffer.from(publicKeyBytes)).digest("hex");
  }

  _registerTrust(peerNodeId, peerPublicKeyBytes) {
    const fingerprint = this._fingerprintKey(peerPublicKeyBytes);
    const existing = this.trustStore[peerNodeId];

    if (!existing) {
      this.trustStore[peerNodeId] = {
        fingerprint,
        status: "tofu",
        firstSeenAt: new Date().toISOString(),
      };
      return { trusted: false, status: "tofu", fingerprint };
    }

    if (existing.fingerprint !== fingerprint) {
      throw new Error(`trust violation for ${peerNodeId}: fingerprint changed`);
    }

    return {
      trusted: existing.status === "trusted",
      status: existing.status,
      fingerprint,
    };
  }

  trustPeer(nodeId) {
    const resolvedNodeId = this._resolvePeerNodeId(nodeId);

    if (!this.trustStore[resolvedNodeId]) {
      this.trustStore[resolvedNodeId] = {
        fingerprint: null,
        status: "trusted",
        firstSeenAt: null,
      };
    } else {
      this.trustStore[resolvedNodeId].status = "trusted";
      this.trustStore[resolvedNodeId].trustedAt = new Date().toISOString();
    }

    const peer = this.peerTable.getPeer(resolvedNodeId);
    if (peer) {
      peer.trusted = true;
      this.peerTable.upsertPeer(peer);
    }

    this._saveState();
    return this.trustStore[resolvedNodeId];
  }

  _createHandshakePayload(ephemeralPublicKey) {
    const ephB64 = Buffer.from(ephemeralPublicKey).toString("base64");
    const staticB64 = Buffer.from(this.identity.publicKey).toString("base64");
    const ts = Date.now();

    const challenge = `archipel-v1|${this.nodeId}|${ephB64}|${this.tcpPort}|${ts}`;
    const signature = sodium.crypto_sign_detached(Buffer.from(challenge, "utf8"), this.identity.privateKey);

    return {
      nodeId: this.nodeId,
      tcpPort: this.tcpPort,
      ts,
      staticPublicKey: staticB64,
      ephemeralPublicKey: ephB64,
      signature: Buffer.from(signature).toString("base64"),
      sharedFiles: this.getSharedFileIds(),
    };
  }

  _parseAndVerifyHandshake(payload) {
    let data;
    try {
      data = JSON.parse(payload.toString("utf8"));
    } catch {
      throw new Error("invalid handshake json");
    }

    const peerPublicKey = Buffer.from(String(data.staticPublicKey || ""), "base64");
    const peerEphemeral = Buffer.from(String(data.ephemeralPublicKey || ""), "base64");
    const peerSignature = Buffer.from(String(data.signature || ""), "base64");

    if (peerPublicKey.length !== 32) throw new Error("invalid static key length");
    if (peerEphemeral.length !== 32) throw new Error("invalid ephemeral key length");
    if (peerSignature.length !== 64) throw new Error("invalid signature length");

    const peerNodeId = nodeIdFromPublicKey(peerPublicKey);
    if (data.nodeId && String(data.nodeId).toLowerCase() !== peerNodeId) {
      throw new Error("nodeId does not match static public key");
    }

    const challenge = `archipel-v1|${peerNodeId}|${Buffer.from(peerEphemeral).toString("base64")}|${Number(data.tcpPort || 0)}|${Number(data.ts || 0)}`;

    const ok = sodium.crypto_sign_verify_detached(
      new Uint8Array(peerSignature),
      Buffer.from(challenge, "utf8"),
      new Uint8Array(peerPublicKey)
    );

    if (!ok) throw new Error("handshake signature invalid");

    const trust = this._registerTrust(peerNodeId, peerPublicKey);

    return {
      nodeId: peerNodeId,
      tcpPort: Number(data.tcpPort || 0),
      ts: Number(data.ts || Date.now()),
      publicKey: new Uint8Array(peerPublicKey),
      ephemeralPublicKey: new Uint8Array(peerEphemeral),
      sharedFiles: Array.isArray(data.sharedFiles) ? data.sharedFiles.map(String) : [],
      trust,
    };
  }

  _startTcpServer() {
    const server = net.createServer((socket) => {
      this._handleIncomingSocket(socket).catch((err) => {
        this.log(`[TCP] incoming socket error: ${err.message}`);
        socket.destroy();
      });
    });

    server.on("error", (err) => {
      this.log(`[TCP] server error: ${err.message}`);
    });

    server.listen(this.tcpPort, () => {
      this.log(`[TCP] listening on port ${this.tcpPort}`);
    });

    return server;
  }

  async _handleIncomingSocket(socket) {
    const remote = `${socket.remoteAddress}:${socket.remotePort}`;
    const chan = new SecureChannelState({ windowSize: 64 });
    const myKx = await createKxKeypair();

    let session = null;
    let peer = null;

    socket.write(
      encodeFrame(FRAME_KX_PUB, Buffer.from(JSON.stringify(this._createHandshakePayload(myKx.publicKey)), "utf8"))
    );

    const decoder = new FrameDecoder(async (type, payload) => {
      try {
        if (!session) {
          if (type !== FRAME_KX_PUB) throw new Error("expected handshake frame");

          peer = this._parseAndVerifyHandshake(payload);
          if (peer.nodeId === this.nodeId) {
            throw new Error("self-connection blocked");
          }

          const keys = await deriveSessionKeys("server", myKx, peer.ephemeralPublicKey);
          session = { rx: keys.rx, tx: keys.tx };

          this.peerTable.upsertPeer({
            nodeId: peer.nodeId,
            ip: (socket.remoteAddress || "").replace(/^::ffff:/, "") || "127.0.0.1",
            tcpPort: peer.tcpPort,
            lastSeen: Date.now(),
            sharedFiles: peer.sharedFiles,
            trusted: peer.trust.trusted,
          });
          return;
        }

        if (type !== FRAME_ENCRYPTED) throw new Error(`unexpected frame type ${type}`);

        const inner = await openFrameState(session.rx, chan, payload);
        if (inner.type !== INNER_PROTOCOL_TYPE) throw new Error("unexpected inner type");

        const packet = decodePacket(inner.payload, session.rx);
        const responsePacket = await this._handleProtocolPacket(packet, {
          peer,
          remote,
          session,
          socket,
        });

        if (responsePacket) {
          const responseBuffer = encodePacket(responsePacket, session.tx);
          await this._sendEncryptedPacket(socket, session.tx, chan, responseBuffer);
        }
      } catch (err) {
        this.log(`[TCP] frame error from ${remote}: ${err.message}`);
        socket.destroy();
      }
    });

    socket.on("data", (chunk) => decoder.push(chunk));
    socket.on("error", (err) => this.log(`[TCP] socket error ${remote}: ${err.message}`));
  }

  async _sendEncryptedPacket(socket, txKey, chan, packetBuffer) {
    const encPayload = await sealFrameState(txKey, chan, INNER_PROTOCOL_TYPE, packetBuffer);
    socket.write(encodeFrame(FRAME_ENCRYPTED, encPayload));
  }

  async _requestPeer(peerNodeId, packetType, payload, opts = {}) {
    const expectType = opts.expectType;
    const timeoutMs = Number(opts.timeoutMs || 10_000);
    const resolvedPeerNodeId = this._resolvePeerNodeId(peerNodeId);

    const peer = this.peerTable.getPeer(resolvedPeerNodeId);
    if (!peer) throw new Error(`unknown peer ${resolvedPeerNodeId}`);

    const socket = net.connect({ host: peer.ip, port: peer.tcpPort });
    const chan = new SecureChannelState({ windowSize: 64 });
    const myKx = await createKxKeypair();

    let session = null;
    let done = false;

    const requestPacket = { type: packetType, nodeId: this.nodeId, payload };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        socket.destroy();
        reject(new Error(`request timeout to ${resolvedPeerNodeId}`));
      }, timeoutMs);

      const finish = (fn, value) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        socket.end();
        fn(value);
      };

      const decoder = new FrameDecoder(async (type, framePayload) => {
        try {
          if (!session) {
            if (type !== FRAME_KX_PUB) throw new Error("expected handshake frame");

            const handshakePeer = this._parseAndVerifyHandshake(framePayload);
            if (handshakePeer.nodeId !== resolvedPeerNodeId) {
              throw new Error(`connected peer mismatch expected=${resolvedPeerNodeId} got=${handshakePeer.nodeId}`);
            }

            const keys = await deriveSessionKeys("client", myKx, handshakePeer.ephemeralPublicKey);
            session = { rx: keys.rx, tx: keys.tx };

            this.peerTable.upsertPeer({
              nodeId: handshakePeer.nodeId,
              ip: peer.ip,
              tcpPort: handshakePeer.tcpPort || peer.tcpPort,
              lastSeen: Date.now(),
              sharedFiles: handshakePeer.sharedFiles,
              trusted: handshakePeer.trust.trusted,
            });

            const packetBuffer = encodePacket(requestPacket, session.tx);
            await this._sendEncryptedPacket(socket, session.tx, chan, packetBuffer);
            return;
          }

          if (type !== FRAME_ENCRYPTED) throw new Error(`unexpected frame type ${type}`);

          const inner = await openFrameState(session.rx, chan, framePayload);
          if (inner.type !== INNER_PROTOCOL_TYPE) throw new Error("unexpected inner type");

          const responsePacket = decodePacket(inner.payload, session.rx);
          if (!expectType || responsePacket.type === expectType) {
            finish(resolve, responsePacket);
          }
        } catch (err) {
          finish(reject, err);
        }
      });

      socket.on("connect", () => {
        const hs = Buffer.from(JSON.stringify(this._createHandshakePayload(myKx.publicKey)), "utf8");
        socket.write(encodeFrame(FRAME_KX_PUB, hs));
      });
      socket.on("data", (chunk) => decoder.push(chunk));
      socket.on("error", (err) => finish(reject, err));
      socket.on("close", () => {
        if (!done && !expectType) finish(resolve, null);
      });
    });
  }

  _appendMessage(entry) {
    this.messages.push(entry);
    if (this.messages.length > 500) this.messages = this.messages.slice(-500);
    this._saveState();
  }

  _resolvePeerNodeId(nodeIdInput) {
    const peers = this.peerTable.getPeers();
    if (!peers.length) {
      throw new Error("node_id introuvable: aucun peer détecté (vérifie le réseau et /api/peers)");
    }

    const raw = String(nodeIdInput || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "");

    if (!raw) throw new Error("node_id vide");

    // Support format abrégé copié depuis l'UI: abcd1234...ef90
    const shortParts = raw.split(/\.{3}|…/).filter(Boolean);
    if (shortParts.length === 2) {
      const start = shortParts[0].replace(/[^0-9a-f]/g, "");
      const end = shortParts[1].replace(/[^0-9a-f]/g, "");

      const shortMatches = peers.filter((p) => p.nodeId.startsWith(start) && p.nodeId.endsWith(end));
      if (shortMatches.length === 1) return shortMatches[0].nodeId;
      if (shortMatches.length > 1) throw new Error("node_id ambigu (format abrégé correspond à plusieurs peers)");
    }

    // Nettoie les caractères non-hexa éventuels (guillemets, ponctuation, etc.).
    const cleaned = raw.replace(/[^0-9a-f]/g, "");
    if (!cleaned) throw new Error("node_id invalide");

    const exact = this.peerTable.getPeer(cleaned);
    if (exact) return exact.nodeId;

    const prefixMatches = peers.filter((p) => p.nodeId.startsWith(cleaned));
    if (prefixMatches.length === 1) return prefixMatches[0].nodeId;
    if (prefixMatches.length > 1) throw new Error("node_id ambigu (plusieurs peers)");

    throw new Error(`node_id introuvable dans les peers: ${cleaned.slice(0, 16)}...`);
  }

  _ackPacket(payload) {
    return { type: TYPE.ACK, nodeId: this.nodeId, payload };
  }

  async _handleProtocolPacket(packet, ctx) {
    const { peer } = ctx;
    const payload = packet.payload || {};

    if (packet.type === TYPE.MSG) {
      this.stats.messagesReceived += 1;
      this._appendMessage({
        ts: new Date().toISOString(),
        direction: "in",
        from: packet.nodeId,
        text: String(payload.text || ""),
      });

      return this._ackPacket({ status: "OK", refType: TYPE.MSG, ts: Date.now() });
    }

    if (packet.type === TYPE.MANIFEST) {
      const manifest = payload.manifest;
      if (!manifest || typeof manifest !== "object") {
        return this._ackPacket({ status: "INVALID_MANIFEST" });
      }

      const senderPublicKey = peer?.publicKey;
      if (!senderPublicKey || !verifyManifestSignature(manifest, senderPublicKey, sodium)) {
        return this._ackPacket({ status: "BAD_SIGNATURE" });
      }

      const fileId = String(manifest.file_id || "");
      if (!fileId) return this._ackPacket({ status: "INVALID_FILE_ID" });

      const existing = this.manifests[fileId] || { manifest, sources: [] };
      const srcSet = new Set(existing.sources || []);
      srcSet.add(packet.nodeId);

      this.manifests[fileId] = {
        manifest,
        sources: Array.from(srcSet),
        updatedAt: new Date().toISOString(),
      };

      this.peerTable.markSharedFile(packet.nodeId, fileId);
      this._saveState();

      return this._ackPacket({ status: "OK", refType: TYPE.MANIFEST, fileId });
    }

    if (packet.type === TYPE.CHUNK_REQ) {
      const fileId = String(payload.file_id || "");
      const chunkIdx = Number(payload.chunk_idx);
      const shared = this.shares[fileId];

      if (!shared || !shared.filePath || !shared.manifest) {
        return this._ackPacket({ status: "NOT_FOUND", refType: TYPE.CHUNK_REQ, chunk_idx: chunkIdx });
      }

      try {
        const chunk = await this._readChunk(shared.filePath, shared.manifest.chunk_size, chunkIdx);
        const chunkHash = sha256Hex(chunk);

        const signMaterial = Buffer.from(`${fileId}:${chunkIdx}:${chunkHash}`, "utf8");
        const sig = sodium.crypto_sign_detached(signMaterial, this.identity.privateKey);

        this.stats.chunksServed += 1;

        return {
          type: TYPE.CHUNK_DATA,
          nodeId: this.nodeId,
          payload: {
            file_id: fileId,
            chunk_idx: chunkIdx,
            chunk_hash: chunkHash,
            data_b64: chunk.toString("base64"),
            signature: Buffer.from(sig).toString("base64"),
          },
        };
      } catch (err) {
        return this._ackPacket({ status: `CHUNK_ERROR:${err.message}`, refType: TYPE.CHUNK_REQ, chunk_idx: chunkIdx });
      }
    }

    if (packet.type === TYPE.HELLO) {
      return {
        type: TYPE.PEER_LIST,
        nodeId: this.nodeId,
        payload: {
          peers: this.peerTable.getPeers().map((p) => ({
            node_id: p.nodeId,
            ip: p.ip,
            tcp_port: p.tcpPort,
            last_seen: p.lastSeen,
          })),
        },
      };
    }

    return this._ackPacket({ status: "UNSUPPORTED", type: packet.type });
  }

  async sendMessage(nodeId, text) {
    if (!text || !String(text).trim()) throw new Error("message vide");
    const resolvedNodeId = this._resolvePeerNodeId(nodeId);

    const response = await this._requestPeer(
      resolvedNodeId,
      TYPE.MSG,
      {
        text: String(text),
        ts: Date.now(),
      },
      { expectType: TYPE.ACK, timeoutMs: 10_000 }
    );

    this.stats.messagesSent += 1;
    this._appendMessage({
      ts: new Date().toISOString(),
      direction: "out",
      to: resolvedNodeId,
      text: String(text),
    });

    return response?.payload || { status: "OK" };
  }

  async _buildManifest(filePath) {
    const absPath = path.resolve(filePath);
    const stat = await fsp.stat(absPath);
    if (!stat.isFile()) throw new Error("fichier invalide");

    const chunkSize = this.chunkSize;
    const nbChunks = Math.ceil(stat.size / chunkSize);

    const fd = await fsp.open(absPath, "r");
    const chunks = [];
    const fileHash = crypto.createHash("sha256");

    try {
      for (let i = 0; i < nbChunks; i += 1) {
        const offset = i * chunkSize;
        const len = Math.min(chunkSize, stat.size - offset);
        const buf = Buffer.allocUnsafe(len);
        const { bytesRead } = await fd.read(buf, 0, len, offset);
        const part = buf.subarray(0, bytesRead);

        fileHash.update(part);
        chunks.push({ index: i, hash: sha256Hex(part), size: bytesRead });
      }
    } finally {
      await fd.close();
    }

    const manifestBase = {
      file_id: fileHash.digest("hex"),
      filename: path.basename(absPath),
      size: stat.size,
      chunk_size: chunkSize,
      nb_chunks: nbChunks,
      chunks,
      sender_id: this.nodeId,
      created_at: new Date().toISOString(),
    };

    const signature = signManifest(this.identity.privateKey, manifestBase, sodium);
    const manifest = { ...manifestBase, signature };

    return { manifest, absPath };
  }

  async sendFile(nodeId, filePath) {
    const resolvedNodeId = this._resolvePeerNodeId(nodeId);
    const { manifest, absPath } = await this._buildManifest(filePath);

    this.shares[manifest.file_id] = {
      filePath: absPath,
      manifest,
      sharedAt: new Date().toISOString(),
    };

    this.peerTable.markSharedFile(this.nodeId, manifest.file_id);
    this._saveState();

    const response = await this._requestPeer(
      resolvedNodeId,
      TYPE.MANIFEST,
      { manifest },
      { expectType: TYPE.ACK, timeoutMs: 15_000 }
    );

    this.stats.filesSent += 1;
    return {
      fileId: manifest.file_id,
      ack: response?.payload || { status: "UNKNOWN" },
      manifest,
    };
  }

  listAvailableFiles() {
    return Object.values(this.manifests).map((entry) => ({
      ...entry.manifest,
      sources: entry.sources || [],
    }));
  }

  async _readChunk(filePath, chunkSize, chunkIdx) {
    const stat = await fsp.stat(filePath);
    const offset = Number(chunkIdx) * Number(chunkSize);
    if (offset < 0 || offset >= stat.size) {
      throw new Error("chunk index out of range");
    }

    const len = Math.min(Number(chunkSize), stat.size - offset);
    const fd = await fsp.open(filePath, "r");
    try {
      const buf = Buffer.allocUnsafe(len);
      const { bytesRead } = await fd.read(buf, 0, len, offset);
      return buf.subarray(0, bytesRead);
    } finally {
      await fd.close();
    }
  }

  async downloadFile(fileId) {
    const entry = this.manifests[fileId];
    if (!entry || !entry.manifest) throw new Error("manifest inconnu");

    const manifest = entry.manifest;
    const sources = Array.from(new Set(entry.sources || []));
    if (sources.length === 0) throw new Error("aucune source disponible");

    const total = manifest.nb_chunks;
    const chunkBuffers = new Array(total);
    const maxParallel = Math.min(3, sources.length);
    let nextIndex = 0;

    const worker = async () => {
      while (nextIndex < total) {
        const idx = nextIndex;
        nextIndex += 1;

        let ok = false;
        let lastErr = null;

        for (let attempt = 0; attempt < sources.length && !ok; attempt += 1) {
          const source = sources[(idx + attempt) % sources.length];

          try {
            const response = await this._requestPeer(
              source,
              TYPE.CHUNK_REQ,
              {
                file_id: fileId,
                chunk_idx: idx,
                requester: this.nodeId,
              },
              { timeoutMs: 12_000 }
            );

            if (!response) throw new Error("empty response");

            if (response.type === TYPE.ACK) {
              throw new Error(String(response.payload?.status || "ACK error"));
            }

            if (response.type !== TYPE.CHUNK_DATA) {
              throw new Error(`unexpected response type ${TYPE_NAME[response.type] || response.type}`);
            }

            const buf = Buffer.from(String(response.payload.data_b64 || ""), "base64");
            const hash = sha256Hex(buf);

            if (hash !== manifest.chunks[idx].hash) {
              throw new Error("hash mismatch");
            }

            chunkBuffers[idx] = buf;
            this.peerTable.updateReputation(source, true);
            this.stats.chunksDownloaded += 1;
            ok = true;
          } catch (err) {
            lastErr = err;
            this.peerTable.updateReputation(source, false);
            await delay(120);
          }
        }

        if (!ok) {
          throw new Error(`chunk ${idx} failed: ${lastErr ? lastErr.message : "unknown"}`);
        }
      }
    };

    await Promise.all(Array.from({ length: maxParallel }, () => worker()));

    const full = Buffer.concat(chunkBuffers);
    const finalHash = sha256Hex(full);
    if (finalHash !== manifest.file_id) {
      throw new Error("final file hash mismatch");
    }

    ensureDirSync(this.downloadDir);
    const outPath = path.join(this.downloadDir, manifest.filename);
    await fsp.writeFile(outPath, full);

    this.shares[fileId] = {
      filePath: outPath,
      manifest,
      sharedAt: new Date().toISOString(),
      origin: "download",
    };

    this.stats.filesReceived += 1;
    this._saveState();

    return { outPath, fileId, size: full.length };
  }

  getStatus() {
    const uptimeSec = this.startedAt ? Math.floor((Date.now() - this.startedAt) / 1000) : 0;

    return {
      nodeId: this.nodeId,
      running: this.running,
      tcpPort: this.tcpPort,
      udpPort: this.udpPort,
      multicastAddr: this.multicastAddr,
      dataDir: this.dataDir,
      uptimeSec,
      peers: this.peerTable.getPeers().length,
      knownFiles: Object.keys(this.manifests).length,
      sharedFiles: Object.keys(this.shares).length,
      stats: this.stats,
    };
  }

  getPeers() {
    return this.peerTable.getPeers();
  }

  getMessages(limit = 100) {
    return this.messages.slice(-Math.max(1, Number(limit || 100)));
  }

  getEvents(limit = 120) {
    return this.events.slice(-Math.max(1, Number(limit || 120)));
  }
}

module.exports = { ArchipelNode };
