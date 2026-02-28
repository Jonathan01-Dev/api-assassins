// src/network/tcpServer.js
const net = require("net");
const sodium = require("libsodium-wrappers");

const { createKxKeypair, deriveSessionKeys } = require("../crypto/handshake");
const { encodeFrame, FrameDecoder } = require("./frame");
const {
  FRAME_KX_PUB,
  FRAME_ENCRYPTED,
  MSG_PING,
  MSG_PONG,
  sealFrame,
  openFrame,
} = require("./secureChannel");

/**
 * Démarre un serveur TCP sécurisé (frames + X25519 + XChaCha20-Poly1305).
 * @param {{ port: number }} opts
 */
function startTcpServer({ port }) {
  const server = net.createServer(async (socket) => {
    await sodium.ready;

    const remote = `${socket.remoteAddress}:${socket.remotePort}`;
    console.log(`[TCP] client connected: ${remote}`);

    // 1) Notre paire X25519
    const myKx = await createKxKeypair();

    // 2) Session rx/tx après handshake
    let session = null;

    // 3) Timeout handshake (évite socket pendante)
    const HANDSHAKE_TIMEOUT_MS = 10_000;
    const handshakeTimer = setTimeout(() => {
      if (!session) {
        console.log(`[TCP] handshake timeout for ${remote} -> closing`);
        socket.destroy();
      }
    }, HANDSHAKE_TIMEOUT_MS);

    // 4) Frame decoder
    const decoder = new FrameDecoder(async (type, payload) => {
      try {
        // Tant que pas de session -> on accepte seulement KX_PUB
        if (!session) {
          if (type !== FRAME_KX_PUB) {
            console.log(`[TCP] protocol violation (no session yet) from ${remote} -> closing`);
            return socket.destroy();
          }

          if (payload.length !== 32) {
            console.log(`[TCP] invalid KX_PUB length (${payload.length}) from ${remote} -> closing`);
            return socket.destroy();
          }

          const theirPub = new Uint8Array(payload); // 32 bytes

          // Serveur = role "server"
          const keys = await deriveSessionKeys("server", myKx, theirPub);
          session = { rx: keys.rx, tx: keys.tx };

          clearTimeout(handshakeTimer);
          console.log(`[TCP] 🔐 Session established with ${remote}`);
          return;
        }

        // Session OK -> on accepte seulement ENCRYPTED
        if (type !== FRAME_ENCRYPTED) {
          console.log(`[TCP] unexpected frame type=${type} after session from ${remote} (ignored)`);
          return;
        }

        // Déchiffre la frame interne
        const inner = await openFrame(session.rx, payload); // { type, payload }
        const innerType = inner.type;

        if (innerType === MSG_PING) {
          const msg = inner.payload.toString("utf8");
          // Répond PONG dans le tunnel
          const enc = await sealFrame(session.tx, MSG_PONG, msg);
          socket.write(encodeFrame(FRAME_ENCRYPTED, enc));
          return;
        }

        // Autres messages (pour plus tard)
        console.log(`[TCP] inner msg type=${innerType} len=${inner.payload.length} from ${remote}`);
      } catch (err) {
        console.log(`[TCP] error handling frame from ${remote}: ${err.message}`);
        socket.destroy();
      }
    });

    // 5) Serveur envoie sa pubkey en frame (FRAME_KX_PUB)
    socket.write(encodeFrame(FRAME_KX_PUB, Buffer.from(myKx.publicKey)));

    socket.on("data", (chunk) => {
      try {
        decoder.push(chunk);
      } catch (err) {
        console.log(`[TCP] frame decode error from ${remote}: ${err.message}`);
        socket.destroy();
      }
    });

    socket.on("close", () => {
      clearTimeout(handshakeTimer);
      console.log(`[TCP] client disconnected: ${remote}`);
    });

    socket.on("error", (err) => {
      clearTimeout(handshakeTimer);
      console.log(`[TCP] socket error (${remote}): ${err.message}`);
    });
  });

  server.on("error", (err) => console.log(`[TCP] server error: ${err.message}`));
  server.listen(port, () => console.log(`[TCP] listening on port ${port}`));
  return server;
}

module.exports = { startTcpServer };