// src/network/secureChannel.js
const sodium = require("libsodium-wrappers");
const { encodeFrame, decodeSingleFrame } = require("./frame");

// Frame types
const FRAME_KX_PUB = 1;
const FRAME_ENCRYPTED = 2;

// Inner message types (dans le tunnel chiffré)
const MSG_PING = 10;
const MSG_PONG = 11;

/**
 * Chiffre une frame interne et retourne une payload binaire: [nonce(24)][ciphertext]
 * @param {Uint8Array} txKey 32 bytes
 * @param {number} innerType 0..255
 * @param {Buffer|Uint8Array|string} innerPayload
 */
async function sealFrame(txKey, innerType, innerPayload) {
  await sodium.ready;

  const plain = encodeFrame(innerType, innerPayload);
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);

  // aad optionnel (on peut mettre un tag fixe)
  const aad = null;

  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plain,
    aad,
    null,
    nonce,
    txKey
  );

  return Buffer.concat([Buffer.from(nonce), Buffer.from(ciphertext)]);
}

/**
 * Déchiffre payload [nonce(24)][ciphertext] et renvoie la frame interne {type,payload}
 * @param {Uint8Array} rxKey 32 bytes
 * @param {Buffer} encryptedPayload
 */
async function openFrame(rxKey, encryptedPayload) {
  await sodium.ready;

  const NPUB = sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES; // 24
  if (encryptedPayload.length < NPUB + 16) {
    throw new Error("openFrame: payload too small");
  }

  const nonce = encryptedPayload.subarray(0, NPUB);
  const ciphertext = encryptedPayload.subarray(NPUB);

  const aad = null;
  const plain = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,
    ciphertext,
    aad,
    nonce,
    rxKey
  );

  return decodeSingleFrame(Buffer.from(plain));
}

module.exports = {
  FRAME_KX_PUB,
  FRAME_ENCRYPTED,
  MSG_PING,
  MSG_PONG,
  sealFrame,
  openFrame,
};