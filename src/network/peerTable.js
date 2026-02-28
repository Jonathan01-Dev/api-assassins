class PeerTable {
  constructor() {
    this.peers = new Map();
  }

  upsertPeer(peer) {
    const now = Date.now();
    const existing = this.peers.get(peer.nodeId);

    this.peers.set(peer.nodeId, {
      nodeId: peer.nodeId,
      ip: peer.ip,
      tcpPort: Number(peer.tcpPort),
      lastSeen: Number(peer.lastSeen ?? now),
      firstSeen: existing?.firstSeen ?? now,
      sharedFiles: Array.isArray(peer.sharedFiles)
        ? Array.from(new Set(peer.sharedFiles.map(String)))
        : (existing?.sharedFiles || []),
      reputation: Number.isFinite(peer.reputation)
        ? Number(peer.reputation)
        : (existing?.reputation ?? 1),
      trusted: peer.trusted ?? existing?.trusted ?? false,
    });
  }

  getPeer(nodeId) {
    return this.peers.get(nodeId);
  }

  removePeer(nodeId) {
    this.peers.delete(nodeId);
  }

  getPeers() {
    return Array.from(this.peers.values()).sort((a, b) => b.lastSeen - a.lastSeen);
  }

  getPeersWithFile(fileId) {
    return this.getPeers().filter((p) => (p.sharedFiles || []).includes(fileId));
  }

  markSharedFile(nodeId, fileId) {
    const p = this.peers.get(nodeId);
    if (!p) return;
    const set = new Set(p.sharedFiles || []);
    set.add(fileId);
    p.sharedFiles = Array.from(set);
    this.peers.set(nodeId, p);
  }

  updateReputation(nodeId, ok) {
    const p = this.peers.get(nodeId);
    if (!p) return;
    const delta = ok ? 0.05 : -0.2;
    p.reputation = Math.max(0, Math.min(5, Number((p.reputation + delta).toFixed(2))));
    this.peers.set(nodeId, p);
  }

  pruneExpiredPeers(timeoutMs) {
    const now = Date.now();
    for (const [nodeId, p] of this.peers.entries()) {
      if (now - p.lastSeen > timeoutMs) {
        this.peers.delete(nodeId);
      }
    }
  }

  asSerializable() {
    return this.getPeers();
  }

  hydrate(rows) {
    this.peers.clear();
    for (const p of rows || []) {
      if (p && p.nodeId) this.upsertPeer(p);
    }
  }

  formatPeers() {
    const list = this.getPeers();
    if (list.length === 0) return "Peers: (0)";

    const lines = list.map((p) => {
      const trust = p.trusted ? "trusted" : "tofu";
      const shared = p.sharedFiles?.length || 0;
      return `- ${p.nodeId.slice(0, 10)}... ${p.ip}:${p.tcpPort} trust=${trust} files=${shared} rep=${p.reputation}`;
    });

    return `Peers: (${list.length})\n${lines.join("\n")}`;
  }
}

module.exports = { PeerTable };
