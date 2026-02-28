// src/network/tcpServer.js
const net = require("net");
const sodium = require("libsodium-wrappers");
const { createKxKeypair, deriveSessionKeys } = require("../crypto/handshake");

/**
 * Démarre un serveur TCP + handshake (Sprint 2).
 * @param {{ port: number }} opts
 */
function startTcpServer({ port }) {
  const server = net.createServer(async (socket) => {
    await sodium.ready;

    const remote = `${socket.remoteAddress}:${socket.remotePort}`;
    console.log(`[TCP] client connected: ${remote}`);

    // Buffer pour messages en lignes (JSONL)
    let buffer = "";

    // 1) Génère notre paire X25519
    const myKx = await createKxKeypair();
    let session = null;

    // 2) Envoie notre clé publique (KX_PUB)
    socket.write(
      JSON.stringify({
        type: "KX_PUB",
        publicKey: Buffer.from(myKx.publicKey).toString("base64"),
      }) + "\n"
    );

    socket.on("data", async (chunk) => {
      buffer += chunk.toString("utf8");

      // Traite toutes les lignes complètes
      while (buffer.includes("\n")) {
        const idx = buffer.indexOf("\n");
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);

        if (!line) continue;

        // 3) Parse JSON
        let msg;
        try {
          msg = JSON.parse(line);
        } catch (e) {
          console.log(`[TCP] invalid JSON from ${remote}`);
          continue;
        }

        // 4) Handshake : réception de la clé publique distante
        if (msg.type === "KX_PUB" && typeof msg.publicKey === "string") {
          const theirPub = Buffer.from(msg.publicKey, "base64");

          // Sur un serveur, on utilise role "server"
          const keys = await deriveSessionKeys("server", myKx, theirPub);

          session = {
            rx: keys.rx,
            tx: keys.tx,
          };

          console.log(`[TCP] 🔐 Session established with ${remote}`);
          // Pour debug: affiche juste que c'est non-null (pas les clés)
          console.log(`[TCP] session keys ready (rx/tx)`);
          continue;
        }

        // 5) (Optionnel) ping/pong simple après handshake
        if (msg.type === "PING") {
          socket.write(JSON.stringify({ type: "PONG" }) + "\n");
        }
      }
    });

    socket.on("close", () => console.log(`[TCP] client disconnected: ${remote}`));
    socket.on("error", (err) => console.log(`[TCP] socket error: ${err.message}`));
  });

  server.on("error", (err) => console.log(`[TCP] server error: ${err.message}`));

  server.listen(port, () => console.log(`[TCP] listening on port ${port}`));
  return server;
}

module.exports = { startTcpServer };