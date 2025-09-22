// Vercel Serverless Function (Node 18+)
import fetch from "node-fetch";

const MODEL = "gemini-1.5-flash-latest";
// Set GEMINI_API_KEY in Vercel Project Settings → Environment Variables

const SYS = `You are a writing assistant. Fix grammar, punctuation, and casing.
Keep the original meaning. Make it concise and natural. Do not add new facts.
Return only the corrected text.`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST" });
  }
  try {
    const { text, mode } = req.body || {};
    if (!text) return res.status(400).json({ error: "text required" });

    const system = SYS; // you can switch by "mode" if needed

    const body = {
      contents: [
        { role: "user", parts: [{ text: system + "\n\nText:\n" + text }] },
      ],
    };

    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );
    const data = await r.json();

    const out =
      data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ??
      text;
    res.status(200).json({ text: out });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "server error", details: String(e) });
  }
}
