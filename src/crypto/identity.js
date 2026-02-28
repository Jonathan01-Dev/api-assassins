const fs = require("fs");
const path = require("path");
const sodium = require("libsodium-wrappers");

function resolveIdentityPaths(homeDir) {
  const baseDir = homeDir
    ? path.resolve(homeDir)
    : path.join(process.cwd(), ".archipel");

  return {
    dir: baseDir,
    file: path.join(baseDir, "identity.json"),
  };
}

/**
 * Charge ou crée l'identité Ed25519 du nœud.
 * @param {{homeDir?: string}} [opts]
 */
async function loadOrCreateIdentity(opts = {}) {
  await sodium.ready;

  const { dir, file } = resolveIdentityPaths(opts.homeDir);

  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  if (fs.existsSync(file)) {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    return {
      publicKey: sodium.from_base64(raw.publicKey),
      privateKey: sodium.from_base64(raw.privateKey),
      createdAt: raw.createdAt,
      path: file,
    };
  }

  const kp = sodium.crypto_sign_keypair();

  const payload = {
    publicKey: sodium.to_base64(kp.publicKey),
    privateKey: sodium.to_base64(kp.privateKey),
    createdAt: new Date().toISOString(),
  };

  fs.writeFileSync(file, JSON.stringify(payload, null, 2), { encoding: "utf8", mode: 0o600 });

  return { publicKey: kp.publicKey, privateKey: kp.privateKey, createdAt: payload.createdAt, path: file };
}

/** nodeId stable = publicKey en hex */
function nodeIdFromPublicKey(publicKey) {
  return Buffer.from(publicKey).toString("hex");
}

module.exports = { loadOrCreateIdentity, nodeIdFromPublicKey, resolveIdentityPaths };
