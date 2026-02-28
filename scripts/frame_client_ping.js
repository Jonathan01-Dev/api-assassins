const net = require("net");
const { encodeFrame, FrameDecoder } = require("../src/network/frame");

const FT = { JSON: 1 };

const socket = net.connect({ host: "127.0.0.1", port: 9000 });

function sendJson(obj) {
  socket.write(encodeFrame(FT.JSON, Buffer.from(JSON.stringify(obj), "utf8")));
}

const decoder = new FrameDecoder((type, payload) => {
  if (type !== FT.JSON) return;
  const msg = JSON.parse(payload.toString("utf8"));
  console.log("[CLIENT] got:", msg);

  // Dès qu'on reçoit la clé serveur, on renvoie la notre (en base64)
  if (msg.type === "KX_PUB") {
    // ⚠️ Pour le test rapide: renvoyer un KX_PUB bidon ne créera pas de session.
    // Le vrai test handshake complet = on réutilise ton client handshake qui génère aussi X25519.
    // Ici on teste juste "frames ok".
    sendJson({ type: "PING" });
  }
});

socket.on("data", (chunk) => decoder.push(chunk));
socket.on("connect", () => console.log("[CLIENT] connected"));