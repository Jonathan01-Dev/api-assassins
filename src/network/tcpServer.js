// src/network/tcpServer.js
const net = require("net");

/**
 * Démarre un serveur TCP.
 * @param {{ port: number, onData?: (socket, data) => void }} opts
 */
function startTcpServer({ port, onData }) {
  const server = net.createServer((socket) => {
    const remote = `${socket.remoteAddress}:${socket.remotePort}`;
    console.log(`[TCP] client connected: ${remote}`);

    socket.on("data", (data) => {
      // Petit log lisible
      console.log(`[TCP] data from ${remote}: ${data.toString().trim()}`);

      // Callback optionnel
      if (onData) onData(socket, data);

      // Réponse simple (ping/pong)
      const msg = data.toString().trim().toLowerCase();
      if (msg === "ping") socket.write("pong\n");
    });

    socket.on("close", () => console.log(`[TCP] client disconnected: ${remote}`));
    socket.on("error", (err) => console.log(`[TCP] socket error: ${err.message}`));
  });

  server.on("error", (err) => {
    console.log(`[TCP] server error: ${err.message}`);
  });

  server.listen(port, () => {
    console.log(`[TCP] listening on port ${port}`);
  });

  return server;
}

module.exports = { startTcpServer };