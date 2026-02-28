// src/network/frame.js
// Frame format: [type:1][len:4 BE][payload:len]

function encodeFrame(type, payload) {
  if (!Number.isInteger(type) || type < 0 || type > 255) {
    throw new Error("encodeFrame: type must be 0..255");
  }

  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload || []);
  const header = Buffer.allocUnsafe(5);
  header.writeUInt8(type, 0);
  header.writeUInt32BE(body.length, 1);

  return Buffer.concat([header, body]);
}

class FrameDecoder {
  /**
   * @param {(type:number, payload:Buffer)=>void} onFrame
   */
  constructor(onFrame) {
    if (typeof onFrame !== "function") throw new Error("FrameDecoder: onFrame required");
    this.onFrame = onFrame;
    this.buffer = Buffer.alloc(0);
    this.MAX_LEN = 10 * 1024 * 1024; // 10MB safety
  }

  push(chunk) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    this.buffer = Buffer.concat([this.buffer, buf]);

    // Parse as many frames as possible
    while (this.buffer.length >= 5) {
      const type = this.buffer.readUInt8(0);
      const len = this.buffer.readUInt32BE(1);

      if (len > this.MAX_LEN) {
        throw new Error(`FrameDecoder: payload too large (${len})`);
      }

      const frameSize = 5 + len;
      if (this.buffer.length < frameSize) break; // wait more data

      const payload = this.buffer.subarray(5, frameSize);
      this.buffer = this.buffer.subarray(frameSize);

      this.onFrame(type, payload);
    }
  }
}

module.exports = { encodeFrame, FrameDecoder };