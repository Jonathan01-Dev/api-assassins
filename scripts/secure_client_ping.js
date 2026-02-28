// scripts/secure_client_ping.js
const net = require("net");
const sodium = require("libsodium-wrappers");

const { FrameDecoder, encodeFrame } = require("../src/network/frame");
const { createKxKeypair, deriveSessionKeys } = require("../src/crypto/handshake");
const {
  FRAME_KX_PUB,
  FRAME_ENCRYPTED,
  MSG_PING,
  MSG_PONG,
  SecureChannelState,
  sealFrameState,
  openFrameState,
} = require("../src/network/secureChannel");

(async () => {
  await sodium.ready;

  const host = process.argv[2] || "127.0.0.1";
  const port = Number(process.argv[3] || process.env.TCP_PORT || 7777);

  const socket = net.connect({ host, port });

  const myKx = await createKxKeypair();
  let session = null;

  // ✅ channel state (seq + anti-replay)
  const chan = new SecureChannelState({ windowSize: 64 });

  console.log(`[CLIENT] connecting to ${host}:${port} ...`);

  socket.on("error", (err) => {
    console.error("[CLIENT] socket error:", err.message);
    process.exit(1);
  });

  socket.on("connect", () => {
    console.log("[CLIENT] connected");
    socket.write(encodeFrame(FRAME_KX_PUB, Buffer.from(myKx.publicKey)));
  });

  const decoder = new FrameDecoder(async (type, payload) => {
    try {
      // Handshake
      if (!session) {
        if (type !== FRAME_KX_PUB) throw new Error("Expected FRAME_KX_PUB during handshake");
        if (payload.length !== 32) throw new Error("Invalid KX public key length");

        const theirPub = new Uint8Array(payload);
        const keys = await deriveSessionKeys("client", myKx, theirPub);
        session = { rx: keys.rx, tx: keys.tx };

        console.log("[CLIENT] 🔐 session established");

        // Send encrypted PING (stateful)
        const message = Buffer.from("hello-secure", "utf8");
        const encryptedPayload = await sealFrameState(session.tx, chan, MSG_PING, message);
        socket.write(encodeFrame(FRAME_ENCRYPTED, encryptedPayload));
        return;
      }

      // Secure phase
      if (type !== FRAME_ENCRYPTED) throw new Error("Received clear frame after handshake");

      const inner = await openFrameState(session.rx, chan, payload);

      if (inner.type === MSG_PONG) {
        console.log("[CLIENT] ✅ got PONG:", inner.payload.toString("utf8"));
        socket.end();
        return;
      }

      console.log("[CLIENT] inner message:", inner.type);
    } catch (err) {
      console.error("[CLIENT] error:", err.message);
      socket.destroy();
    }
  });

  socket.on("data", (chunk) => decoder.push(chunk));
  socket.on("close", () => console.log("[CLIENT] connection closed"));
})();