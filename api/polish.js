// api/polish.js — Vercel Serverless Function (Node 18+)
// Handles CORS (OPTIONS + POST) and calls Gemini generateContent.

const MODEL = "gemini-1.5-flash"; // explicit version is safer than "-latest"

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",                          // or set your extension/site origin
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

const SYS = `You are a writing assistant. Fix grammar, punctuation, and casing.
Keep the original meaning. Make it concise and natural. Do not add new facts.
Return only the corrected text.`;

// Small helper: ensure we get an object from req.body
async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  // Vercel sometimes passes body as string when content-type is JSON
  if (typeof req.body === "string" && req.body.trim().length) {
    try { return JSON.parse(req.body); } catch { /* fallthrough */ }
  }
  // Fallback: read stream
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8");
  try { return JSON.parse(raw || "{}"); } catch { return {}; }
}

export default async function handler(req, res) {
  // Always send CORS headers
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));

  // CORS preflight
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Only POST is allowed
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST", "OPTIONS"]);
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { text, mode } = await readJson(req);
    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "Field 'text' is required" });
    }

    const system = SYS; // optionally vary by `mode`

    const body = {
      contents: [
        {
          role: "user",
          parts: [{ text: `${system}\n\nText:\n${text}` }]
        }
      ]
    };

    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      }
    );

    if (!r.ok) {
      const errTxt = await r.text();
      console.error("Gemini API error:", r.status, errTxt);
      return res.status(r.status).json({ error: "Gemini API error", details: errTxt });
    }

    const data = await r.json();
    const out =
      data?.candidates?.[0]?.content?.parts?.map(p => p.text).join("").trim() || text;

    return res.status(200).json({ text: out });
  } catch (e) {
    console.error("Server error:", e);
    return res.status(500).json({ error: "server error", details: String(e) });
  }
}
