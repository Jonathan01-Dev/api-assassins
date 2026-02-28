// src/network/secureChannel.js
const sodium = require("libsodium-wrappers");
const { encodeFrame, decodeSingleFrame } = require("./frame");

// Frame types (outer)
const FRAME_KX_PUB = 1;
const FRAME_ENCRYPTED = 2;

// Inner message types
const MSG_PING = 10;
const MSG_PONG = 11;

// -------------------------
// uint64 helpers (BE)
// -------------------------
function u64ToBufBE(n) {
  const bi = typeof n === "bigint" ? n : BigInt(n);
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(bi, 0);
  return b;
}
function bufToU64BE(buf, offset = 0) {
  return buf.readBigUInt64BE(offset);
}

// -------------------------
// Anti-replay window
// -------------------------
class AntiReplayWindow {
  constructor(windowSize = 64) {
    if (windowSize <= 0 || windowSize > 1024) throw new Error("AntiReplayWindow: windowSize invalid");
    this.windowSize = BigInt(windowSize);
    this.maxSeq = null; // BigInt
    this.bitmap = 0n;
  }

  accept(seq) {
    if (this.maxSeq === null) {
      this.maxSeq = seq;
      this.bitmap = 1n;
      return true;
    }

    if (seq > this.maxSeq) {
      const shift = seq - this.maxSeq;

      if (shift >= this.windowSize) {
        this.bitmap = 1n;
      } else {
        this.bitmap = (this.bitmap << shift) | 1n;
        const mask = (1n << this.windowSize) - 1n;
        this.bitmap &= mask;
      }

      this.maxSeq = seq;
      return true;
    }

    // seq <= maxSeq
    const diff = this.maxSeq - seq;
    if (diff >= this.windowSize) return false;

    const bit = 1n << diff;
    if (this.bitmap & bit) return false; // replay
    this.bitmap |= bit;
    return true;
  }
}

class SecureChannelState {
  constructor({ windowSize = 64 } = {}) {
    this.txSeq = 0n;
    this.rxWindow = new AntiReplayWindow(windowSize);
  }
}

// -------------------------
// Stateless (backward compatible)
// -------------------------
async function sealFrame(txKey, innerType, innerPayload) {
  await sodium.ready;

  const plain = encodeFrame(innerType, innerPayload);
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);

  // no aad
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

// -------------------------
// Stateful (seq + anti-replay) ✅
// Format: [seq:8][nonce:24][ciphertext]
// AAD: [seq:8] (binds seq to auth tag)
// -------------------------
async function sealFrameState(txKey, st, innerType, innerPayload) {
  await sodium.ready;
  if (!st || typeof st.txSeq === "undefined") throw new Error("sealFrameState: state required");

  const plain = encodeFrame(innerType, innerPayload);
  const seqBuf = u64ToBufBE(st.txSeq);

  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const aad = Buffer.from(seqBuf);

  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plain,
    aad,
    null,
    nonce,
    txKey
  );

  st.txSeq += 1n;
  return Buffer.concat([seqBuf, Buffer.from(nonce), Buffer.from(ciphertext)]);
}

async function openFrameState(rxKey, st, encryptedPayload) {
  await sodium.ready;
  if (!st || !st.rxWindow) throw new Error("openFrameState: state required");

  const NPUB = sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES; // 24
  if (encryptedPayload.length < 8 + NPUB + 16) throw new Error("openFrameState: payload too small");

  const seq = bufToU64BE(encryptedPayload, 0);
  const seqBuf = encryptedPayload.subarray(0, 8);

  // anti-replay first
  if (!st.rxWindow.accept(seq)) {
    throw new Error(`openFrameState: replay/too-old seq=${seq.toString()}`);
  }

  const nonce = encryptedPayload.subarray(8, 8 + NPUB);
  const ciphertext = encryptedPayload.subarray(8 + NPUB);

  const aad = Buffer.from(seqBuf);

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

  AntiReplayWindow,
  SecureChannelState,

  // old (stateless)
  sealFrame,
  openFrame,

  // new (stateful)
  sealFrameState,
  openFrameState,
};