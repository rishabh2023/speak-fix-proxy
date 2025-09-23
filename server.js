// server.js – Railway WS proxy for Deepgram
// Run: node server.js (Railway sets PORT)
// URL:  wss://<your-app>.up.railway.app/api/deepgram?dg=...&lang=en-US

const http = require("http");
const url = require("url");
const WebSocket = require("ws");

const PORT = process.env.PORT || 8080;

const server = http.createServer((req, res) => {
  // simple health/info
  if (req.url.startsWith("/health")) {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ ok: true }));
  }
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("Deepgram WS proxy is running.\n");
});

const wss = new WebSocket.Server({ noServer: true });

// Optional: keepalive timer to prevent Railway idling WS
function heartbeat() {
  this.isAlive = true;
}

wss.on("connection", (client, request, q) => {
  client.isAlive = true;
  client.on("pong", heartbeat);

  const dgKey = q.dg;
  const lang = (q.lang || "en-US").toString();

  if (!dgKey) {
    try {
      client.close(1011, "Missing dg (Deepgram key)");
    } catch {}
    return;
  }

  const params = new URLSearchParams({
    model: "nova-2-general",
    smart_format: "true",
    punctuate: "true",
    interim_results: "true",
    encoding: "linear16",
    sample_rate: "16000",
    language: lang,
    channels: "1",
  });

  const dg = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, {
    headers: { Authorization: `Token ${dgKey}` },
  });

  dg.binaryType = "arraybuffer";

  dg.on("open", () => {
    try {
      client.send(JSON.stringify({ type: "ready" }));
    } catch {}
  });

  dg.on("message", (data) => {
    // Deepgram -> client: forward only text frames (JSON)
    if (typeof data === "string") {
      try {
        client.send(data);
      } catch {}
    }
  });

  dg.on("close", (code, reason) => {
    try {
      client.close(code, reason.toString());
    } catch {}
  });

  dg.on("error", (err) => {
    try {
      client.close(1011, "Upstream error");
    } catch {}
  });

  // Client -> Deepgram: forward **binary** PCM16 and any control JSON
  client.on("message", (data, isBinary) => {
    if (dg.readyState !== WebSocket.OPEN) return;

    // If browser sent ArrayBuffer (binary), ws lib gives Buffer (isBinary=true)
    if (isBinary) {
      dg.send(data, { binary: true });
    } else {
      // text control messages (if you add any later)
      dg.send(data.toString());
    }
  });

  client.on("close", () => {
    try {
      dg.close();
    } catch {}
  });

  client.on("error", () => {
    try {
      dg.close();
    } catch {}
  });
});

// HTTP → WS upgrade
server.on("upgrade", (request, socket, head) => {
  const { pathname, query } = url.parse(request.url, true);
  if (pathname === "/api/deepgram") {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request, query);
    });
  } else {
    socket.destroy(); // not our route
  }
});

// Periodic ping to keep connections healthy
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping(() => {});
  });
}, 30000);

server.on("close", () => clearInterval(interval));

server.listen(PORT, () => {
  console.log("WS proxy listening on", PORT);
});
