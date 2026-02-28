// scripts/kx_client_test.js
const net = require("net");
const sodium = require("libsodium-wrappers");
const { createKxKeypair, deriveSessionKeys } = require("../src/crypto/handshake");

const port = Number(process.argv[2] || 7777);

(async () => {
  await sodium.ready;

  console.log("CLIENT: starting...");
  const myKx = await createKxKeypair();

  const s = net.connect(port, "127.0.0.1", () => {
    console.log("CLIENT: connected to", port);
  });

  let buf = "";
  let serverPub = null;

  // Envoie notre KX_PUB immédiatement (plus simple)
  s.write(
    JSON.stringify({
      type: "KX_PUB",
      publicKey: Buffer.from(myKx.publicKey).toString("base64"),
    }) + "\n"
  );
  console.log("CLIENT: sent KX_PUB");

  s.on("data", async (d) => {
    buf += d.toString("utf8");
    while (buf.includes("\n")) {
      const i = buf.indexOf("\n");
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);

      if (!line) continue;

      const msg = JSON.parse(line);
      if (msg.type === "KX_PUB") {
        serverPub = Buffer.from(msg.publicKey, "base64");
        console.log("CLIENT: received server KX_PUB");

        // Client role = "client"
        const keys = await deriveSessionKeys("client", myKx, serverPub);
        console.log("CLIENT: 🔐 Session established (rx/tx ready)");
      }
    }
  });

  s.on("error", (e) => console.log("CLIENT ERR:", e.message));
})();