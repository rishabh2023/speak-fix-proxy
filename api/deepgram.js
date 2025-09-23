// api/deepgram.js (Edge Runtime) — WS proxy for Deepgram
export const config = { runtime: "edge" };

const DG_ENDPOINT = "wss://api.deepgram.com/v1/listen"; // params added dynamically

function okJSON(obj) {
  return new Response(JSON.stringify(obj), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

export default async function handler(req) {
  // Only handle WS upgrades
  if (req.headers.get("upgrade") !== "websocket") {
    return okJSON({ error: "Expected WebSocket upgrade" });
  }

  const { searchParams } = new URL(req.url);
  const dgKey = searchParams.get("dg");
  const lang = searchParams.get("lang") || "en-US";
  if (!dgKey) {
    return okJSON({ error: "missing dg (Deepgram API key) query param" });
  }

  // Accept client socket
  const { socket: client, response } = Deno.upgradeWebSocket(req);

  // Open socket to Deepgram (Edge runtime supports outbound WS)
  const qs = new URLSearchParams({
    model: "nova-2-general",
    smart_format: "true",
    punctuate: "true",
    interim_results: "true",
    encoding: "linear16",
    sample_rate: "16000",
    language: lang,
  });
  const dg = new WebSocket(`${DG_ENDPOINT}?${qs.toString()}`, {
    headers: { Authorization: `Token ${dgKey}` },
  });

  dg.binaryType = "arraybuffer";

  dg.onopen = () => {
    try {
      client.send(JSON.stringify({ type: "ready" }));
    } catch {}
  };

  dg.onmessage = (ev) => {
    try {
      // forward JSON messages
      if (typeof ev.data === "string") client.send(ev.data);
    } catch {}
  };

  dg.onerror = (e) => {
    try {
      client.send(JSON.stringify({ type: "error", details: String(e) }));
    } catch {}
    try {
      client.close();
    } catch {}
  };
  dg.onclose = () => {
    try {
      client.close();
    } catch {}
  };

  client.onmessage = (ev) => {
    // Forward raw PCM16 audio (ArrayBuffer) to Deepgram
    if (ev.data instanceof ArrayBuffer) {
      try {
        dg.send(ev.data);
      } catch {}
    } else if (typeof ev.data === "string") {
      // allow control messages if needed later (e.g., flush, stop)
      try {
        dg.send(ev.data);
      } catch {}
    }
  };
  client.onerror = () => {
    try {
      dg.close();
    } catch {}
  };
  client.onclose = () => {
    try {
      dg.close();
    } catch {}
  };

  return response;
}
