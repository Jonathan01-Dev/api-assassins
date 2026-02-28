// src/crypto/aead.js
const sodium = require("libsodium-wrappers");

/**
 * Chiffre avec XChaCha20-Poly1305 (libsodium).
 * Portable (pas dépendant du support AES du CPU).
 * @param {Uint8Array} key 32 bytes
 * @param {Uint8Array} plaintext
 * @param {Uint8Array|null} aad additional authenticated data (optionnel)
 * @returns {{ alg: string, nonce: Uint8Array, ciphertext: Uint8Array }}
 */
async function encrypt(key, plaintext, aad = null) {
  await sodium.ready;

  if (!(key instanceof Uint8Array) || key.length !== 32) {
    throw new Error("AEAD key must be Uint8Array(32)");
  }

  const nonce = sodium.randombytes_buf(
    sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES
  );

  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintext,
    aad,
    null,
    nonce,
    key
  );

  return { alg: "xchacha20poly1305_ietf", nonce, ciphertext };
}

/**
 * Déchiffre avec XChaCha20-Poly1305 (libsodium).
 * @param {Uint8Array} key 32 bytes
 * @param {Uint8Array} nonce 24 bytes
 * @param {Uint8Array} ciphertext
 * @param {Uint8Array|null} aad
 * @returns {Uint8Array} plaintext
 */
async function decrypt(key, nonce, ciphertext, aad = null) {
  await sodium.ready;

  if (!(key instanceof Uint8Array) || key.length !== 32) {
    throw new Error("AEAD key must be Uint8Array(32)");
  }

  return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,
    ciphertext,
    aad,
    nonce,
    key
  );
}

module.exports = { encrypt, decrypt };