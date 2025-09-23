// api/polish.js — CORS + OPTIONS + X-API-Key support, safe text cleaning (no quotes/backticks)

const MODEL = "gemini-1.5-flash";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
};

async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body.trim()) {
    try {
      return JSON.parse(req.body);
    } catch {}
  }
  const chunks = [];
  for await (const c of req) chunks.push(Buffer.from(c));
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    return {};
  }
}

export default async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST", "OPTIONS"]);
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { text } = await readJson(req);
    const { apiKey } = await readJson(req);
    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "Field 'text' is required" });
    }

    // const apiKey = req.headers["x-api-key"] || process.env.GEMINI_API_KEY;

    const prompt = `You are a writing assistant. Fix grammar, punctuation, and casing.
Keep the meaning. Be concise. Return only the corrected text (no quotes, no code fences).

Text:
${text}`;

    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
        }),
      }
    );

    if (!r.ok) {
      const errTxt = await r.text();
      console.error("Gemini API error:", r.status, errTxt);
      return res
        .status(r.status)
        .json({ error: "Gemini API error", details: errTxt });
    }

    const data = await r.json();
    let out = (
      data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || text
    ).trim();

    // Clean any accidental formatting
    out = out
      .replace(/^```[\s\S]*?\n/, "")
      .replace(/```$/, "")
      .trim();
    if (out.startsWith('"') && out.endsWith('"')) out = out.slice(1, -1);

    return res.status(200).json({ text: out });
  } catch (e) {
    console.error("Server error:", e);
    return res.status(500).json({ error: "server error", details: String(e) });
  }
}
