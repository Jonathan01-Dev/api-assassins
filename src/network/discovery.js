// src/network/discovery.js
const dgram = require("dgram");

const DEFAULT_MCAST_ADDR = "239.255.42.99";
const DEFAULT_UDP_PORT = 6000;

/**
 * Démarre la découverte via UDP multicast.
 * @param {{
 *  nodeId: string,
 *  tcpPort: number,
 *  udpPort?: number,
 *  multicastAddr?: string,
 *  helloIntervalMs?: number,
 *  onHello?: (peer: { nodeId: string, ip: string, tcpPort: number, ts: number }) => void
 * }} opts
 */
function startDiscovery(opts) {
  const {
    nodeId,
    tcpPort,
    udpPort = DEFAULT_UDP_PORT,
    multicastAddr = DEFAULT_MCAST_ADDR,
    helloIntervalMs = 30000,
    onHello,
  } = opts;

  const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });

  socket.on("error", (err) => {
    console.log(`[UDP] socket error: ${err.message}`);
  });

  socket.on("message", (msg, rinfo) => {
    try {
      const data = JSON.parse(msg.toString("utf8"));

      // On ne se traite pas soi-même
      if (data.nodeId === nodeId) return;

      if (data.type === "HELLO" && typeof data.tcpPort === "number") {
        const peer = {
          nodeId: String(data.nodeId),
          ip: rinfo.address,
          tcpPort: data.tcpPort,
          ts: Number(data.ts || Date.now()),
        };

        // Log simple
        console.log(`[UDP] HELLO received from ${peer.ip}:${peer.tcpPort} (${peer.nodeId.slice(0, 10)}...)`);

        if (onHello) onHello(peer);
      }
    } catch (e) {
      // Ignore messages non-JSON
    }
  });

  socket.bind(udpPort, () => {
    try {
      socket.addMembership(multicastAddr);
      socket.setMulticastTTL(128);
      socket.setBroadcast(true);
      console.log(`[UDP] listening on ${multicastAddr}:${udpPort}`);
    } catch (err) {
      console.log(`[UDP] addMembership failed: ${err.message}`);
    }
  });

  function sendHello() {
    const payload = Buffer.from(
      JSON.stringify({
        type: "HELLO",
        nodeId,
        tcpPort,
        ts: Date.now(),
      }),
      "utf8"
    );

    socket.send(payload, 0, payload.length, udpPort, multicastAddr, (err) => {
      if (err) console.log(`[UDP] send error: ${err.message}`);
      else console.log(`[UDP] HELLO sent (tcpPort=${tcpPort})`);
    });
  }

  // Envoi immédiat + intervalle
  sendHello();
  const timer = setInterval(sendHello, helloIntervalMs);

  function stop() {
    clearInterval(timer);
    try {
      socket.dropMembership(multicastAddr);
    } catch (_) {}
    socket.close();
  }

  return { stop };
}

module.exports = { startDiscovery };