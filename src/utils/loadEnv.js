const fs = require("fs");
const path = require("path");

function parseEnvLine(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  const idx = trimmed.indexOf("=");
  if (idx <= 0) return null;

  const key = trimmed.slice(0, idx).trim();
  if (!key) return null;

  let val = trimmed.slice(idx + 1).trim();
  if (
    (val.startsWith('"') && val.endsWith('"')) ||
    (val.startsWith("'") && val.endsWith("'"))
  ) {
    val = val.slice(1, -1);
  }

  return { key, val };
}

function loadEnvFile(envPath = path.join(process.cwd(), ".env")) {
  try {
    if (!fs.existsSync(envPath)) return { loaded: false, path: envPath };

    const raw = fs.readFileSync(envPath, "utf8");
    const lines = raw.split(/\r?\n/);

    for (const line of lines) {
      const entry = parseEnvLine(line);
      if (!entry) continue;
      if (process.env[entry.key] === undefined) {
        process.env[entry.key] = entry.val;
      }
    }

    return { loaded: true, path: envPath };
  } catch {
    return { loaded: false, path: envPath };
  }
}

module.exports = {
  loadEnvFile,
};
