// Minimal Deepgram WS proxy for Railway/Node
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { parse } from "url";

const PORT = process.env.PORT || 8080;

// HTTP server just to handle upgrades
const server = createServer((req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: true, hint: "use WebSocket at /ws/deepgram" }));
});

const wss = new WebSocketServer({ noServer: true });

wss.on("connection", (client, request) => {
  const { query } = parse(request.url, true);
  const dgKey = query?.dg;
  const lang = (query?.lang || "en-US").toString();

  if (!dgKey) {
    client.close(1011, "Missing dg (Deepgram API key) query param");
    return;
  }

  const qs = new URLSearchParams({
    model: "nova-2-general",
    smart_format: "true",
    punctuate: "true",
    interim_results: "true",
    encoding: "linear16",
    sample_rate: "16000",
    language: lang,
  });

  const upstream = new WebSocket(
    `wss://api.deepgram.com/v1/listen?${qs.toString()}`,
    { headers: { Authorization: `Token ${dgKey}` } }
  );

  upstream.on("open", () => {
    try {
      client.send(JSON.stringify({ type: "ready" }));
    } catch {}
  });

  upstream.on("message", (data, isBinary) => {
    // Deepgram sends JSON text frames; forward as-is to browser
    if (!isBinary) {
      try {
        client.send(data.toString());
      } catch {}
    }
  });

  upstream.on("close", (code, reason) => {
    try {
      client.close(code, reason);
    } catch {}
  });

  upstream.on("error", (err) => {
    try {
      client.send(JSON.stringify({ type: "error", details: String(err) }));
    } catch {}
    try {
      client.close(1011, "Upstream error");
    } catch {}
  });

  client.on("message", (data, isBinary) => {
    // From browser: binary PCM16 frames and occasional text control
    if (upstream.readyState === WebSocket.OPEN) {
      try {
        upstream.send(data, { binary: isBinary });
      } catch {}
    }
  });

  client.on("close", () => {
    try {
      upstream.close();
    } catch {}
  });

  client.on("error", () => {
    try {
      upstream.close();
    } catch {}
  });

  // Keep connections healthy
  const ping = setInterval(() => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.ping();
      } catch {}
    }
    if (upstream.readyState === WebSocket.OPEN) {
      try {
        upstream.ping?.();
      } catch {}
    }
  }, 30000);

  const clear = () => clearInterval(ping);
  client.on("close", clear);
  upstream.on("close", clear);
});

server.on("upgrade", (request, socket, head) => {
  const { pathname } = parse(request.url);
  if (pathname === "/ws/deepgram") {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  } else {
    socket.destroy();
  }
});

server.listen(PORT, () => {
  console.log(`WS proxy listening on :${PORT}  (path: /ws/deepgram)`);
});
