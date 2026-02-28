// scripts/kx_client_frames_test.js
// Test handshake + ping chiffré (frames), alias vers secure_client_ping.
if (!process.argv[2]) process.argv[2] = "127.0.0.1";
if (!process.argv[3]) process.argv[3] = "7999";
require("./secure_client_ping");
