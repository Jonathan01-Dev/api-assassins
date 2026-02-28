// src/crypto/identity.js
const fs = require("fs");
const path = require("path");
const sodium = require("libsodium-wrappers");

/**
 * Charge ou crée l'identité Ed25519 du nœud.
 * Stockage local : .archipel/identity.json (NON versionné)
 */
async function loadOrCreateIdentity() {
  await sodium.ready;

  const dir = path.join(process.cwd(), ".archipel");
  const file = path.join(dir, "identity.json");

  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  if (fs.existsSync(file)) {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    return {
      publicKey: sodium.from_base64(raw.publicKey),
      privateKey: sodium.from_base64(raw.privateKey),
    };
  }

  const kp = sodium.crypto_sign_keypair();

  const payload = {
    publicKey: sodium.to_base64(kp.publicKey),
    privateKey: sodium.to_base64(kp.privateKey),
    createdAt: new Date().toISOString(),
  };

  fs.writeFileSync(file, JSON.stringify(payload, null, 2), "utf8");

  return { publicKey: kp.publicKey, privateKey: kp.privateKey };
}

/** nodeId stable = publicKey en hex */
function nodeIdFromPublicKey(publicKey) {
  return Buffer.from(publicKey).toString("hex");
}

module.exports = { loadOrCreateIdentity, nodeIdFromPublicKey };