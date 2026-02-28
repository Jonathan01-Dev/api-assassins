const path = require("path");

const { ArchipelNode } = require("./node/archipelNode");
const { createAdminServer } = require("./admin/server");

(async () => {
  const tcpPort = Number(process.env.TCP_PORT || 7777);
  const adminPort = Number(process.env.ADMIN_PORT || 8787);
  const udpPort = Number(process.env.UDP_PORT || 6000);
  const dataDir = path.resolve(process.env.ARCHIPEL_DATA_DIR || path.join(process.cwd(), ".archipel", `node-${tcpPort}`));

  const node = new ArchipelNode({
    tcpPort,
    udpPort,
    dataDir,
    multicastAddr: process.env.MULTICAST_ADDR || "239.255.42.99",
  });

  await node.start();

  const admin = createAdminServer(node, {
    adminPort,
    host: process.env.ADMIN_HOST || "127.0.0.1",
    webDir: path.join(process.cwd(), "apps", "web"),
    aiDisabled: String(process.env.ARCHIPEL_NO_AI || "").trim() === "1",
  });
  await admin.start();

  console.log(`[ARCHIPEL] running: tcp=${tcpPort}, admin=http://127.0.0.1:${adminPort}`);

  async function shutdown() {
    console.log("[ARCHIPEL] shutdown requested");
    await admin.stop().catch(() => {});
    await node.stop().catch(() => {});
    process.exit(0);
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
})();
