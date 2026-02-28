const fs = require("fs");
const path = require("path");
const http = require("http");
const { URL } = require("url");
const { generateWithGemini } = require("../ai/gemini");

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function readBody(req, maxBytes = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on("data", (c) => {
      size += c.length;
      if (size > maxBytes) {
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
  const aiDisabled = Boolean(opts.aiDisabled || String(process.env.ARCHIPEL_NO_AI || "").trim() === "1");

  const buildSnapshot = () => ({
    status: node.getStatus(),
    peers: node.getPeers(),
    messages: node.getMessages(300),
    files: node.listAvailableFiles(),
    trust: node.getTrustStore(),
    events: node.getEvents(120),
    ai: {
      disabled: aiDisabled,
      configured: Boolean(String(process.env.GEMINI_API_KEY || "").trim()),
      model: String(process.env.GEMINI_MODEL || "gemini-2.0-flash"),
    },
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

        if (req.method === "GET" && u.pathname === "/api/trust-store") {
          return json(res, 200, { ok: true, data: node.getTrustStore() });
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

        if (req.method === "POST" && u.pathname === "/api/send-upload") {
          const body = await readBody(req, 140 * 1024 * 1024);
          const filename = String(body.filename || "upload.bin");
          const raw = String(body.data_b64 || "");
          if (!raw) throw new Error("data_b64 requis");

          const buf = Buffer.from(raw, "base64");
          if (!buf.length) throw new Error("upload invalide");

          const data = await node.sendUploadedBuffer(String(body.nodeId || ""), filename, buf);
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

        if (req.method === "POST" && u.pathname === "/api/peer") {
          const body = await readBody(req);
          const data = node.addPeer({
            nodeId: String(body.nodeId || ""),
            ip: String(body.ip || ""),
            tcpPort: Number(body.tcpPort || 7777),
          });
          return json(res, 200, { ok: true, data });
        }

        if (req.method === "GET" && u.pathname === "/api/ai/status") {
          return json(res, 200, {
            ok: true,
            data: {
              disabled: aiDisabled,
              configured: Boolean(String(process.env.GEMINI_API_KEY || "").trim()),
              model: String(process.env.GEMINI_MODEL || "gemini-2.0-flash"),
            },
          });
        }

        if (req.method === "POST" && u.pathname === "/api/ai/generate") {
          if (aiDisabled) {
            throw new Error("mode offline --no-ai actif");
          }
          const body = await readBody(req);
          const text = await generateWithGemini({
            prompt: String(body.prompt || ""),
            systemInstruction: String(
              body.systemInstruction ||
                "Tu es un assistant de chat Archipel. Réponds en français simple, clair, court."
            ),
            model: String(body.model || process.env.GEMINI_MODEL || "gemini-2.0-flash"),
            temperature: Number(body.temperature ?? 0.6),
            maxOutputTokens: Number(body.maxOutputTokens ?? 300),
          });
          return json(res, 200, { ok: true, data: { text } });
        }

        if (req.method === "POST" && u.pathname === "/api/security/revoke-key") {
          const data = await node.revokeOwnKey();
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
