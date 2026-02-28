const dgram = require("dgram");

const DEFAULT_MCAST_ADDR = "239.255.42.99";
const DEFAULT_UDP_PORT = 6000;

/**
 * @param {{
 *  nodeId: string,
 *  tcpPort: number,
 *  udpPort?: number,
 *  multicastAddr?: string,
 *  helloIntervalMs?: number,
 *  getHelloExtra?: ()=>Record<string, unknown>,
 *  onHello?: (peer: { nodeId: string, ip: string, tcpPort: number, ts: number, sharedFiles: string[] }) => void
 * }} opts
 */
function startDiscovery(opts) {
  const {
    nodeId,
    tcpPort,
    udpPort = DEFAULT_UDP_PORT,
    multicastAddr = DEFAULT_MCAST_ADDR,
    helloIntervalMs = 30000,
    getHelloExtra,
    onHello,
  } = opts;

  const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });

  socket.on("error", (err) => {
    console.log(`[UDP] socket error: ${err.message}`);
  });

  socket.on("message", (msg, rinfo) => {
    try {
      const data = JSON.parse(msg.toString("utf8"));

      if (!data || data.type !== "HELLO") return;
      if (data.nodeId === nodeId) return;
      if (typeof data.tcpPort !== "number") return;

      const peer = {
        nodeId: String(data.nodeId),
        ip: rinfo.address,
        tcpPort: Number(data.tcpPort),
        ts: Number(data.ts || Date.now()),
        sharedFiles: Array.isArray(data.sharedFiles)
          ? data.sharedFiles.map(String)
          : [],
      };

      if (onHello) onHello(peer);
    } catch (_) {
      // ignore invalid packets
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
    const payloadObj = {
      type: "HELLO",
      nodeId,
      tcpPort,
      ts: Date.now(),
      ...(typeof getHelloExtra === "function" ? getHelloExtra() : {}),
    };

    const payload = Buffer.from(JSON.stringify(payloadObj), "utf8");

    socket.send(payload, 0, payload.length, udpPort, multicastAddr, (err) => {
      if (err) console.log(`[UDP] send error: ${err.message}`);
    });
  }

  sendHello();
  const timer = setInterval(sendHello, helloIntervalMs);

  function stop() {
    clearInterval(timer);
    try {
      socket.dropMembership(multicastAddr);
    } catch (_) {}
    socket.close();
  }

  return { stop, sendHelloNow: sendHello };
}

module.exports = { startDiscovery, DEFAULT_MCAST_ADDR, DEFAULT_UDP_PORT };
