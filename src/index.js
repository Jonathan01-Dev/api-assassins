// src/index.js
const crypto = require("crypto");
const { startTcpServer } = require("./network/tcpServer");
const { startDiscovery } = require("./network/discovery");
const peerTable = require("./network/peerTable");

// Config simple (env > défaut)
const TCP_PORT = Number(process.env.TCP_PORT || 7777);
const PEER_TIMEOUT_MS = Number(process.env.PEER_TIMEOUT_MS || 90000);

// NodeId simple pour Sprint 1 (on fera l'identité Ed25519 au Sprint 2)
const nodeId = crypto.randomBytes(16).toString("hex");

console.log(`\n=== Archipel Node ===`);
console.log(`nodeId=${nodeId}`);
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