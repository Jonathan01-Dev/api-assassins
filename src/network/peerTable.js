// src/network/peerTable.js

// Peer Table en mémoire (Map) : nodeId -> { nodeId, ip, tcpPort, lastSeen }
const peers = new Map();

/**
 * Ajoute ou met à jour un peer.
 * @param {{ nodeId: string, ip: string, tcpPort: number, lastSeen?: number }} peer
 */
function upsertPeer(peer) {
  const now = Date.now();
  const existing = peers.get(peer.nodeId);

  peers.set(peer.nodeId, {
    nodeId: peer.nodeId,
    ip: peer.ip,
    tcpPort: peer.tcpPort,
    lastSeen: peer.lastSeen ?? now,
    firstSeen: existing?.firstSeen ?? now,
  });
}

/** Retourne la liste des peers */
function getPeers() {
  return Array.from(peers.values());
}

/**
 * Supprime les peers inactifs.
 * @param {number} timeoutMs ex: 90000 (90s)
 */
function pruneExpiredPeers(timeoutMs) {
  const now = Date.now();
  for (const [nodeId, p] of peers.entries()) {
    if (now - p.lastSeen > timeoutMs) {
      peers.delete(nodeId);
    }
  }
}

/** Petit affichage lisible en console */
function formatPeers() {
  const list = getPeers();
  if (list.length === 0) return "Peers: (0)";
  const lines = list.map(
    (p) => `- ${p.nodeId.slice(0, 10)}…  ${p.ip}:${p.tcpPort}  lastSeen=${new Date(p.lastSeen).toLocaleTimeString()}`
  );
  return `Peers: (${list.length})\n` + lines.join("\n");
}

module.exports = {
  upsertPeer,
  getPeers,
  pruneExpiredPeers,
  formatPeers,
};