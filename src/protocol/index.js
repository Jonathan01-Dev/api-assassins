const crypto = require("crypto");

const MAGIC = Buffer.from("ARCH", "ascii");

const TYPE = {
  HELLO: 0x01,
  PEER_LIST: 0x02,
  MSG: 0x03,
  CHUNK_REQ: 0x04,
  CHUNK_DATA: 0x05,
  MANIFEST: 0x06,
  ACK: 0x07,
};

const TYPE_NAME = Object.fromEntries(Object.entries(TYPE).map(([k, v]) => [v, k]));

function normalizeNodeId(nodeId) {
  if (typeof nodeId !== "string") throw new Error("nodeId must be string");
  if (/^[0-9a-fA-F]{64}$/.test(nodeId)) return nodeId.toLowerCase();
  return crypto.createHash("sha256").update(nodeId).digest("hex");
}

function nodeIdHexToBytes(nodeId) {
  return Buffer.from(normalizeNodeId(nodeId), "hex");
}

function packetHashInput(header, payload) {
  return Buffer.concat([header, payload]);
}

function computePacketHmac(packetNoMac, macKey) {
  const key = Buffer.isBuffer(macKey) ? macKey : Buffer.from(macKey);
  return crypto.createHmac("sha256", key).update(packetNoMac).digest();
}

function encodePacket({ type, nodeId, payload }, macKey) {
  if (!Number.isInteger(type) || type < 0 || type > 255) {
    throw new Error("packet type must be integer 0..255");
  }

  const nodeBytes = nodeIdHexToBytes(nodeId);
  const payloadBuf = Buffer.from(JSON.stringify(payload || {}), "utf8");

  const header = Buffer.allocUnsafe(4 + 1 + 32 + 4);
  MAGIC.copy(header, 0);
  header.writeUInt8(type, 4);
  nodeBytes.copy(header, 5);
  header.writeUInt32BE(payloadBuf.length, 37);

  const noMac = packetHashInput(header, payloadBuf);
  const hmac = computePacketHmac(noMac, macKey);

  return Buffer.concat([noMac, hmac]);
}

function decodePacket(buf, macKey) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  const minLen = 4 + 1 + 32 + 4 + 32;
  if (b.length < minLen) throw new Error("packet too short");

  if (!b.subarray(0, 4).equals(MAGIC)) throw new Error("bad packet magic");

  const type = b.readUInt8(4);
  const nodeId = b.subarray(5, 37).toString("hex");
  const payloadLen = b.readUInt32BE(37);
  const expected = 4 + 1 + 32 + 4 + payloadLen + 32;

  if (b.length !== expected) {
    throw new Error(`bad packet length: expected ${expected}, got ${b.length}`);
  }

  const payloadBuf = b.subarray(41, 41 + payloadLen);
  const packetNoMac = b.subarray(0, 41 + payloadLen);
  const gotMac = b.subarray(41 + payloadLen);
  const expectedMac = computePacketHmac(packetNoMac, macKey);

  if (!crypto.timingSafeEqual(gotMac, expectedMac)) {
    throw new Error("packet HMAC mismatch");
  }

  let payload = {};
  if (payloadBuf.length > 0) {
    payload = JSON.parse(payloadBuf.toString("utf8"));
  }

  return { type, nodeId, payload, typeName: TYPE_NAME[type] || `0x${type.toString(16)}` };
}

function sha256Hex(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  return crypto.createHash("sha256").update(b).digest("hex");
}

function signManifest(identityPrivateKey, manifestWithoutSignature, sodium) {
  const hash = sha256Hex(Buffer.from(JSON.stringify(manifestWithoutSignature), "utf8"));
  const sig = sodium.crypto_sign_detached(Buffer.from(hash, "utf8"), identityPrivateKey);
  return Buffer.from(sig).toString("base64");
}

function verifyManifestSignature(manifest, publicKey, sodium) {
  if (!manifest || typeof manifest !== "object") return false;
  if (typeof manifest.signature !== "string") return false;

  const clone = { ...manifest };
  delete clone.signature;

  const hash = sha256Hex(Buffer.from(JSON.stringify(clone), "utf8"));
  const sig = Buffer.from(manifest.signature, "base64");

  return sodium.crypto_sign_verify_detached(sig, Buffer.from(hash, "utf8"), publicKey);
}

module.exports = {
  TYPE,
  TYPE_NAME,
  MAGIC,
  normalizeNodeId,
  encodePacket,
  decodePacket,
  sha256Hex,
  signManifest,
  verifyManifestSignature,
};
