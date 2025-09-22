// api/polish.js — Vercel Serverless Function (Node 18+)

// No need for "node-fetch" import on Vercel (Node 18+ has global fetch)

const MODEL = "gemini-1.5-flash"; // "latest" alias sometimes fails
const SYS = `You are a writing assistant. Fix grammar, punctuation, and casing.
Keep the original meaning. Make it concise and natural. Do not add new facts.
Return only the corrected text.`;

// Main handler
export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    // Parse body
    const { text, mode } = req.body || {};
    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "Field 'text' is required" });
    }

    const system = SYS; // in future, you can vary based on "mode"

    const body = {
      contents: [
        {
          role: "user",
          parts: [{ text: `${system}\n\nText:\n${text}` }],
        },
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

    if (!r.ok) {
      const errTxt = await r.text();
      console.error("Gemini API error:", r.status, errTxt);
      return res
        .status(r.status)
        .json({ error: "Gemini API error", details: errTxt });
    }

    const data = await r.json();
    const out =
      data?.candidates?.[0]?.content?.parts
        ?.map((p) => p.text)
        .join("")
        .trim() || text;

    res.status(200).json({ text: out });
  } catch (e) {
    console.error("Server error:", e);
    res.status(500).json({ error: "server error", details: String(e) });
  }
}
