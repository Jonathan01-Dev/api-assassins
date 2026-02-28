// scripts/frame_test.js
const { encodeFrame, FrameDecoder } = require("../src/network/frame");

const frames = [];
frames.push(encodeFrame(1, Buffer.from("hello")));
frames.push(encodeFrame(2, Buffer.from("world")));
frames.push(encodeFrame(3, Buffer.from("ok")));

const stream = Buffer.concat(frames);

// On simule un TCP qui coupe en morceaux 👇
const chunks = [stream.subarray(0, 3), stream.subarray(3, 9), stream.subarray(9)];

const out = [];
const decoder = new FrameDecoder((type, payload) => {
  out.push({ type, payload: payload.toString("utf8") });
});

for (const c of chunks) decoder.push(c);

console.log(out);