// src/network/tcpServer.js
const net = require("net");
const sodium = require("libsodium-wrappers");
const { createKxKeypair, deriveSessionKeys } = require("../crypto/handshake");
const { encodeFrame, FrameDecoder } = require("./frame");

// Types de frame (V1)
const FT = {
  JSON: 1, // payload = JSON string (utf8)
  // plus tard: ENCRYPTED = 2
};

/**
 * Démarre un serveur TCP + handshake (Sprint 2) en mode frames.
 * @param {{ port: number }} opts
 */
function startTcpServer({ port }) {
  const server = net.createServer(async (socket) => {
    await sodium.ready;

    const remote = `${socket.remoteAddress}:${socket.remotePort}`;
    console.log(`[TCP] client connected: ${remote}`);

    // 1) Génère notre paire X25519
    const myKx = await createKxKeypair();
    let session = null;

    // Utilitaire: envoyer un message JSON en frame
    function sendJson(obj) {
      const payload = Buffer.from(JSON.stringify(obj), "utf8");
      socket.write(encodeFrame(FT.JSON, payload));
    }

    // 2) Envoie notre clé publique (KX_PUB) (en frame)
    sendJson({
      type: "KX_PUB",
      publicKey: Buffer.from(myKx.publicKey).toString("base64"),
    });

    // 3) Decoder frames (gère TCP chunking)
    const decoder = new FrameDecoder(async (type, payload) => {
      try {
        if (type !== FT.JSON) {
          console.log(`[TCP] unknown frame type=${type} from ${remote}`);
          return;
        }

        const text = payload.toString("utf8");
        let msg;
        try {
          msg = JSON.parse(text);
        } catch {
          console.log(`[TCP] invalid JSON frame from ${remote}`);
          return;
        }

        // 4) Handshake : réception de la clé publique distante
        if (msg.type === "KX_PUB" && typeof msg.publicKey === "string") {
          const theirPub = Buffer.from(msg.publicKey, "base64");

          // Sur un serveur, role = "server"
          const keys = await deriveSessionKeys("server", myKx, theirPub);

          session = { rx: keys.rx, tx: keys.tx };
          console.log(`[TCP] 🔐 Session established with ${remote}`);
          console.log(`[TCP] session keys ready (rx/tx)`);
          return;
        }

        // 5) Ping/Pong simple après handshake
        if (msg.type === "PING") {
          sendJson({ type: "PONG" });
          return;
        }

        // Debug: log les autres messages
        console.log(`[TCP] msg from ${remote}:`, msg);
      } catch (err) {
        console.log(`[TCP] handler error: ${err.message}`);
      }
    });

    socket.on("data", (chunk) => {
      try {
        decoder.push(chunk);
      } catch (err) {
        console.log(`[TCP] decoder error: ${err.message}`);
        socket.destroy();
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