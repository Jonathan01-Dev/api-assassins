const fs = require("fs");
const path = require("path");
const http = require("http");
const { URL } = require("url");

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on("data", (c) => {
      size += c.length;
      if (size > 4 * 1024 * 1024) {
        reject(new Error("body too large"));
        return;
      }
      chunks.push(c);
    });

    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("invalid json"));
      }
    });

    req.on("error", reject);
  });
}

function safePublicPath(baseDir, requestPath) {
  const p = requestPath === "/" ? "/index.html" : requestPath;
  const normalized = path.normalize(p).replace(/^([.][.][/\\])+/, "");
  const out = path.join(baseDir, normalized);
  if (!out.startsWith(baseDir)) return null;
  return out;
}

function contentType(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".json")) return "application/json; charset=utf-8";
  if (file.endsWith(".png")) return "image/png";
  if (file.endsWith(".jpg") || file.endsWith(".jpeg")) return "image/jpeg";
  return "text/plain; charset=utf-8";
}

function createAdminServer(node, opts = {}) {
  const adminPort = Number(opts.adminPort || 8787);
  const host = opts.host || "127.0.0.1";
  const webDir = path.resolve(opts.webDir || path.join(process.cwd(), "apps", "web"));

  const buildSnapshot = () => ({
    status: node.getStatus(),
    peers: node.getPeers(),
    messages: node.getMessages(300),
    files: node.listAvailableFiles(),
    events: node.getEvents(120),
    ts: Date.now(),
  });

  const server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, `http://${req.headers.host || "localhost"}`);

      if (u.pathname.startsWith("/api/")) {
        if (req.method === "GET" && u.pathname === "/api/stream") {
          res.writeHead(200, {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-store",
            Connection: "keep-alive",
          });

          const sendSnapshot = () => {
            const payload = JSON.stringify(buildSnapshot());
            res.write(`event: snapshot\ndata: ${payload}\n\n`);
          };

          sendSnapshot();
          const interval = setInterval(sendSnapshot, 2500);
          const heartbeat = setInterval(() => res.write(": ping\n\n"), 15000);

          req.on("close", () => {
            clearInterval(interval);
            clearInterval(heartbeat);
          });

          return;
        }

        if (req.method === "GET" && u.pathname === "/api/snapshot") {
          return json(res, 200, { ok: true, data: buildSnapshot() });
        }

        if (req.method === "GET" && u.pathname === "/api/status") {
          return json(res, 200, { ok: true, data: node.getStatus() });
        }

        if (req.method === "GET" && u.pathname === "/api/peers") {
          return json(res, 200, { ok: true, data: node.getPeers() });
        }

        if (req.method === "GET" && u.pathname === "/api/messages") {
          const limit = Number(u.searchParams.get("limit") || 100);
          const peer = String(u.searchParams.get("peer") || "").trim().toLowerCase();
          let messages = node.getMessages(limit);

          if (peer) {
            messages = messages.filter((m) => String(m.from || "").toLowerCase() === peer || String(m.to || "").toLowerCase() === peer);
          }

          return json(res, 200, { ok: true, data: messages });
        }

        if (req.method === "GET" && u.pathname === "/api/files") {
          return json(res, 200, { ok: true, data: node.listAvailableFiles() });
        }

        if (req.method === "GET" && u.pathname === "/api/events") {
          const limit = Number(u.searchParams.get("limit") || 120);
          return json(res, 200, { ok: true, data: node.getEvents(limit) });
        }

        if (req.method === "POST" && u.pathname === "/api/msg") {
          const body = await readBody(req);
          const data = await node.sendMessage(String(body.nodeId || ""), String(body.text || ""));
          return json(res, 200, { ok: true, data });
        }

        if (req.method === "POST" && u.pathname === "/api/send") {
          const body = await readBody(req);
          const data = await node.sendFile(String(body.nodeId || ""), String(body.filePath || ""));
          return json(res, 200, { ok: true, data });
        }

        if (req.method === "POST" && u.pathname === "/api/download") {
          const body = await readBody(req);
          const data = await node.downloadFile(String(body.fileId || ""));
          return json(res, 200, { ok: true, data });
        }

        if (req.method === "POST" && u.pathname === "/api/trust") {
          const body = await readBody(req);
          const data = node.trustPeer(String(body.nodeId || ""));
          return json(res, 200, { ok: true, data });
        }

        if (req.method === "POST" && u.pathname === "/api/stop") {
          setTimeout(() => {
            node.stop().catch(() => {});
            server.close(() => process.exit(0));
          }, 100);
          return json(res, 200, { ok: true, data: { stopping: true } });
        }

        return json(res, 404, { ok: false, error: "not found" });
      }

      const file = safePublicPath(webDir, u.pathname);
      if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        return json(res, 404, { ok: false, error: "page not found" });
      }

      const buf = fs.readFileSync(file);
      res.writeHead(200, {
        "Content-Type": contentType(file),
        "Content-Length": buf.length,
        "Cache-Control": "no-store",
      });
      res.end(buf);
    } catch (err) {
      json(res, 500, { ok: false, error: err.message });
    }
  });

  return {
    start() {
      return new Promise((resolve) => {
        server.listen(adminPort, host, () => resolve());
      });
    },
    stop() {
      return new Promise((resolve) => server.close(() => resolve()));
    },
    server,
    adminPort,
    host,
  };
}

module.exports = { createAdminServer };
