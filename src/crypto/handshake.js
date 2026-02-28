// src/crypto/handshake.js
const sodium = require("libsodium-wrappers");

/**
 * Génère une paire de clés X25519 (key exchange).
 * Utilise libsodium crypto_kx_keypair (Curve25519 / X25519).
 */
async function createKxKeypair() {
  await sodium.ready;
  const kp = sodium.crypto_kx_keypair();
  return {
    publicKey: kp.publicKey,   // Uint8Array(32)
    privateKey: kp.privateKey, // Uint8Array(32)
  };
}

/**
 * Dérive les clés de session (rx/tx) à partir des clés X25519.
 * @param {"client"|"server"} role
 * @param {{publicKey: Uint8Array, privateKey: Uint8Array}} myKx
 * @param {Uint8Array} theirPublicKey
 */
async function deriveSessionKeys(role, myKx, theirPublicKey) {
  await sodium.ready;

  if (role === "client") {
    const keys = sodium.crypto_kx_client_session_keys(
      myKx.publicKey,
      myKx.privateKey,
      theirPublicKey
    );
    return { rx: keys.sharedRx, tx: keys.sharedTx };
  }

  const keys = sodium.crypto_kx_server_session_keys(
    myKx.publicKey,
    myKx.privateKey,
    theirPublicKey
  );
  return { rx: keys.sharedRx, tx: keys.sharedTx };
}

function toB64(u8) {
  return sodium.to_base64(u8);
}

module.exports = {
  createKxKeypair,
  deriveSessionKeys,
  toB64,
};