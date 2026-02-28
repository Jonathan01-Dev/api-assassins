#!/usr/bin/env node
const path = require("path");
const http = require("http");
const { loadEnvFile } = require("./utils/loadEnv");

loadEnvFile();

const { ArchipelNode } = require("./node/archipelNode");
const { createAdminServer } = require("./admin/server");

function parseArgs(argv) {
  const args = [];
  const flags = {};

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [k, inline] = a.slice(2).split("=");
      if (inline !== undefined) {
        flags[k] = inline;
      } else {
        const next = argv[i + 1];
        if (!next || next.startsWith("--")) {
          flags[k] = true;
        } else {
          flags[k] = next;
          i += 1;
        }
      }
    } else {
      args.push(a);
    }
  }

  return { args, flags };
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function parseHostPort(input, fallbackPort = 7777) {
  const raw = String(input || "").trim();
  if (!raw) throw new Error("adresse vide (attendu: IP:PORT)");

  const idx = raw.lastIndexOf(":");
  if (idx <= 0 || idx === raw.length - 1) {
    return { ip: raw, tcpPort: fallbackPort };
  }

  const ip = raw.slice(0, idx).trim();
  const port = Number(raw.slice(idx + 1).trim());
  if (!ip || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("adresse invalide (attendu: IP:PORT)");
  }
  return { ip, tcpPort: port };
}

function printHelp() {
  console.log(`
Archipel CLI

Commandes:
  archipel start --port 7777 --admin-port 8787 [--data-dir .archipel/node-7777] [--no-ai] [--ad-hoc]
  archipel peers [--admin-port 8787]
  archipel peer-add <node_id> <ip:port> [--admin-port 8787]
  archipel hello [--admin-port 8787]
  archipel status [--admin-port 8787]
  archipel msg <node_id> <message> [--admin-port 8787]
  archipel send <node_id> <filepath> [--admin-port 8787]
  archipel ai <prompt> [--admin-port 8787]
  archipel ai-status [--admin-port 8787]
  archipel key-revoke [--admin-port 8787]
  archipel receive [--admin-port 8787]
  archipel download <file_id> [--admin-port 8787]
  archipel trust <node_id> [--admin-port 8787]
  archipel stop [--admin-port 8787]

Exemple:
  node src/cli.js start --port 7777 --admin-port 8787
  node src/cli.js start --port 7777 --admin-port 8787 --ad-hoc
  node src/cli.js peer-add <node_id> 192.168.1.50:7777 --admin-port 8787
  node src/cli.js peers --admin-port 8787
  node src/cli.js ai "propose une réponse simple"
`);
}

async function apiRequest({ adminPort, method, route, body }) {
  const payload = body ? Buffer.from(JSON.stringify(body), "utf8") : null;

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: Number(adminPort || 8787),
        path: route,
        method,
        headers: payload
          ? {
              "Content-Type": "application/json",
              "Content-Length": payload.length,
            }
          : undefined,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let parsed;
          try {
            parsed = raw ? JSON.parse(raw) : {};
          } catch {
            return reject(new Error(`invalid API response: ${raw.slice(0, 120)}`));
          }

          if (res.statusCode >= 400 || !parsed.ok) {
            return reject(new Error(parsed.error || `HTTP ${res.statusCode}`));
          }

          resolve(parsed.data);
        });
      }
    );

    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function runStart(flags) {
  const tcpPort = num(flags.port || process.env.TCP_PORT, 7777);
  const adminPort = num(flags["admin-port"] || process.env.ADMIN_PORT, 8787);
  const udpPort = num(flags["udp-port"] || process.env.UDP_PORT, 6000);
  const dataDir = path.resolve(
    String(flags["data-dir"] || path.join(process.cwd(), ".archipel", `node-${tcpPort}`))
  );
  const noAiRaw = flags["no-ai"];
  const aiDisabled = noAiRaw === true || String(noAiRaw || "").toLowerCase() === "true";
  const adhocRaw = flags["ad-hoc"] ?? process.env.ARCHIPEL_ADHOC;
  const discoveryMode = adhocRaw === true || String(adhocRaw || "").toLowerCase() === "true"
    ? "ad-hoc"
    : "multicast";

  const node = new ArchipelNode({
    tcpPort,
    udpPort,
    chunkSize: num(flags["chunk-size"], 524288),
    peerTimeoutMs: num(flags["peer-timeout-ms"], 90000),
    helloIntervalMs: num(flags["hello-interval-ms"], 30000),
    multicastAddr: String(flags.multicast || "239.255.42.99"),
    discoveryMode,
    dataDir,
  });

  await node.start();

  const admin = createAdminServer(node, {
    adminPort,
    host: String(flags.host || "127.0.0.1"),
    webDir: path.join(process.cwd(), "apps", "web"),
    aiDisabled,
  });
  await admin.start();

  console.log(`\n[ARCHIPEL] CLI/API ready on http://127.0.0.1:${adminPort}`);
  console.log(`[ARCHIPEL] Web dashboard: http://127.0.0.1:${adminPort}`);
  console.log(`[ARCHIPEL] Node TCP port: ${tcpPort} | UDP: ${udpPort} | Discovery: ${discoveryMode}`);
  console.log(`[ARCHIPEL] AI mode: ${aiDisabled ? "disabled (--no-ai)" : "enabled"}`);

  const shutdown = async () => {
    console.log("\n[ARCHIPEL] stopping...");
    await admin.stop().catch(() => {});
    await node.stop().catch(() => {});
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await new Promise(() => {});
}

async function main() {
  const { args, flags } = parseArgs(process.argv.slice(2));
  const command = args[0];
  const adminPort = num(flags["admin-port"] || process.env.ADMIN_PORT, 8787);

  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "start") {
    await runStart(flags);
    return;
  }

  if (command === "status") {
    const out = await apiRequest({ adminPort, method: "GET", route: "/api/status" });
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  if (command === "peers") {
    const out = await apiRequest({ adminPort, method: "GET", route: "/api/peers" });
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  if (command === "peer-add") {
    const nodeId = args[1];
    const addr = args[2];
    if (!nodeId || !addr) throw new Error("usage: peer-add <node_id> <ip:port>");

    const { ip, tcpPort } = parseHostPort(addr, 7777);
    const out = await apiRequest({
      adminPort,
      method: "POST",
      route: "/api/peer",
      body: { nodeId, ip, tcpPort },
    });
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  if (command === "hello") {
    const out = await apiRequest({ adminPort, method: "POST", route: "/api/discovery/ping", body: {} });
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  if (command === "receive") {
    const out = await apiRequest({ adminPort, method: "GET", route: "/api/files" });
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  if (command === "ai-status") {
    const out = await apiRequest({ adminPort, method: "GET", route: "/api/ai/status" });
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  if (command === "ai") {
    const prompt = args.slice(1).join(" ").trim();
    if (!prompt) throw new Error('usage: ai "<prompt>"');
    const out = await apiRequest({
      adminPort,
      method: "POST",
      route: "/api/ai/generate",
      body: { prompt },
    });
    console.log(String(out.text || ""));
    return;
  }

  if (command === "key-revoke") {
    const out = await apiRequest({ adminPort, method: "POST", route: "/api/security/revoke-key", body: {} });
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  if (command === "msg") {
    const nodeId = args[1];
    const text = args.slice(2).join(" ");
    if (!nodeId || !text) throw new Error("usage: msg <node_id> <message>");
    const out = await apiRequest({ adminPort, method: "POST", route: "/api/msg", body: { nodeId, text } });
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  if (command === "send") {
    const nodeId = args[1];
    const filePath = args[2];
    if (!nodeId || !filePath) throw new Error("usage: send <node_id> <filepath>");
    const out = await apiRequest({
      adminPort,
      method: "POST",
      route: "/api/send",
      body: { nodeId, filePath },
    });
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  if (command === "download") {
    const fileId = args[1];
    if (!fileId) throw new Error("usage: download <file_id>");
    const out = await apiRequest({
      adminPort,
      method: "POST",
      route: "/api/download",
      body: { fileId },
    });
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  if (command === "trust") {
    const nodeId = args[1];
    if (!nodeId) throw new Error("usage: trust <node_id>");
    const out = await apiRequest({ adminPort, method: "POST", route: "/api/trust", body: { nodeId } });
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  if (command === "stop") {
    const out = await apiRequest({ adminPort, method: "POST", route: "/api/stop", body: {} });
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  throw new Error(`commande inconnue: ${command}`);
}

main().catch((err) => {
  console.error(`[ARCHIPEL] ${err.message}`);
  process.exit(1);
});
