// scripts/kx_client_frames_test.js
const net = require("net");
const sodium = require("libsodium-wrappers");
const { createKxKeypair, deriveSessionKeys } = require("../src/crypto/handshake");
const { encodeFrame, FrameDecoder } = require("../src/network/frame");

const FT = { JSON: 1 };

async function main() {
  await sodium.ready;

  const host = "127.0.0.1";
  const port = 9000;

  const socket = net.connect({ host, port });
  const myKx = await createKxKeypair();
  let session = null;

  function sendJson(obj) {
    const payload = Buffer.from(JSON.stringify(obj), "utf8");
    socket.write(encodeFrame(FT.JSON, payload));
  }

  const decoder = new FrameDecoder(async (type, payload) => {
    if (type !== FT.JSON) return;

    let msg;
    try {
      msg = JSON.parse(payload.toString("utf8"));
    } catch {
      console.log("[CLIENT] invalid JSON frame");
      return;
    }

    // Reçoit la clé publique du serveur
    if (msg.type === "KX_PUB" && typeof msg.publicKey === "string") {
      const theirPub = Buffer.from(msg.publicKey, "base64");

      // côté client : role "client"
      const keys = await deriveSessionKeys("client", myKx, theirPub);
      session = { rx: keys.rx, tx: keys.tx };

      console.log("[CLIENT] 🔐 Session established (client side)");
      console.log("[CLIENT] session keys ready (rx/tx)");

      // renvoie notre pubkey au serveur (pour qu'il établisse sa session aussi)
      sendJson({
        type: "KX_PUB",
        publicKey: Buffer.from(myKx.publicKey).toString("base64"),
      });

      // test ping
      sendJson({ type: "PING" });
      return;
    }

    if (msg.type === "PONG") {
      console.log("[CLIENT] ✅ got PONG");
      console.log("[CLIENT] session is", !!session);
      socket.end();
      return;
    }

    console.log("[CLIENT] msg:", msg);
  });

  socket.on("connect", () => console.log("[CLIENT] connected"));
  socket.on("data", (chunk) => decoder.push(chunk));
  socket.on("error", (err) => console.log("[CLIENT] error:", err.message));
  socket.on("close", () => console.log("[CLIENT] closed"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});