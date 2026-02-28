// src/index.js
const { startTcpServer } = require("./network/tcpServer");
const { startDiscovery } = require("./network/discovery");
const peerTable = require("./network/peerTable");
const { loadOrCreateIdentity, nodeIdFromPublicKey } = require("./crypto/identity");

// Config simple (env > défaut)
const TCP_PORT = Number(process.env.TCP_PORT || 7777);
const PEER_TIMEOUT_MS = Number(process.env.PEER_TIMEOUT_MS || 90000);

(async () => {
  // Identité stable (Sprint 2)
  const { publicKey } = await loadOrCreateIdentity();
  const nodeId = nodeIdFromPublicKey(publicKey);

  console.log(`\n=== Archipel Node ===`);
  console.log(`nodeId=${nodeId.slice(0, 24)}...`); // affichage court
  console.log(`TCP_PORT=${TCP_PORT}\n`);

  // 1) TCP server
  startTcpServer({ port: TCP_PORT });

  // 2) UDP discovery -> met à jour la peer table
  startDiscovery({
    nodeId,
    tcpPort: TCP_PORT,
    onHello: (peer) => {
      peerTable.upsertPeer({
        nodeId: peer.nodeId,
        ip: peer.ip,
        tcpPort: peer.tcpPort,
        lastSeen: Date.now(),
      });
    },
  });

  // 3) Affichage périodique
  setInterval(() => {
    peerTable.pruneExpiredPeers(PEER_TIMEOUT_MS);
    console.log(peerTable.formatPeers());
  }, 5000);
})();