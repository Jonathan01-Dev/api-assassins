const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";
const DEFAULT_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS || 20000);
const DEFAULT_API_BASE = String(process.env.GEMINI_API_BASE || "https://generativelanguage.googleapis.com").replace(/\/+$/, "");

function extractGeminiText(payload) {
  const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
  if (!candidates.length) return "";

  const parts = candidates[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";

  return parts
    .map((p) => String(p?.text || ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}

async function generateWithGemini({
  prompt,
  systemInstruction = "",
  model = DEFAULT_MODEL,
  temperature = 0.6,
  maxOutputTokens = 300,
}) {
  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("Gemini non configuré: définis GEMINI_API_KEY");
  }

  const text = String(prompt || "").trim();
  if (!text) throw new Error("prompt vide");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  const body = {
    contents: [{ role: "user", parts: [{ text }] }],
    generationConfig: {
      temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : 0.6,
      maxOutputTokens: Number.isFinite(Number(maxOutputTokens)) ? Number(maxOutputTokens) : 300,
    },
  };

  const sys = String(systemInstruction || "").trim();
  if (sys) {
    body.systemInstruction = { parts: [{ text: sys }] };
  }

  const endpoint = `${DEFAULT_API_BASE}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = payload?.error?.message || `Gemini HTTP ${res.status}`;
      throw new Error(msg);
    }

    const out = extractGeminiText(payload);
    if (!out) throw new Error("Gemini a renvoyé une réponse vide");
    return out;
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new Error(`Gemini timeout (${DEFAULT_TIMEOUT_MS}ms)`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  generateWithGemini,
  extractGeminiText,
};
