// scripts/kx_client_test.js
// Test minimal du handshake KX contre src/network/tcpServer.js
const net = require("net");
const sodium = require("libsodium-wrappers");

const { createKxKeypair, deriveSessionKeys } = require("../src/crypto/handshake");
const { encodeFrame, FrameDecoder } = require("../src/network/frame");
const { FRAME_KX_PUB } = require("../src/network/secureChannel");

const host = process.argv[2] || "127.0.0.1";
const port = Number(process.argv[3] || process.env.TCP_PORT || 7999);

(async () => {
  await sodium.ready;

  const myKx = await createKxKeypair();
  const socket = net.connect({ host, port });
  let done = false;

  const timeout = setTimeout(() => {
    if (done) return;
    done = true;
    console.error("[KX TEST] timeout");
    socket.destroy();
    process.exit(1);
  }, 8000);

  const finish = (ok, msg) => {
    if (done) return;
    done = true;
    clearTimeout(timeout);
    if (ok) {
      console.log(`[KX TEST] ${msg}`);
      socket.end();
      process.exit(0);
    } else {
      console.error(`[KX TEST] ${msg}`);
      socket.destroy();
      process.exit(1);
    }
  };

  const decoder = new FrameDecoder(async (type, payload) => {
    try {
      if (type !== FRAME_KX_PUB) {
        return finish(false, `unexpected frame type=${type}`);
      }
      if (payload.length !== 32) {
        return finish(false, `invalid KX_PUB length=${payload.length}`);
      }

      const theirPub = new Uint8Array(payload);
      const keys = await deriveSessionKeys("client", myKx, theirPub);
      if (!keys?.rx || !keys?.tx) {
        return finish(false, "session keys missing");
      }

      finish(true, "session established (rx/tx derived)");
    } catch (err) {
      finish(false, err.message);
    }
  });

  socket.on("connect", () => {
    socket.write(encodeFrame(FRAME_KX_PUB, Buffer.from(myKx.publicKey)));
  });
  socket.on("data", (chunk) => decoder.push(chunk));
  socket.on("error", (err) => finish(false, err.message));
})();
