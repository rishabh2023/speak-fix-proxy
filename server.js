// server.js — VERY VERBOSE proxy (Deepgram WS)
// Logs: connections, binary sizes, frame previews, errors.
const http = require("http");
const url = require("url");
const WebSocket = require("ws");
const PORT = process.env.PORT || 8080;

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/health")) {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ ok: true }));
  }
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("Deepgram WS proxy is running.\n");
});

const wss = new WebSocket.Server({ noServer: true });

wss.on("connection", (client, request, q) => {
  console.log("[proxy] client connected", request.socket.remoteAddress);
  client.isAlive = true;
  client.on("pong", () => (client.isAlive = true));

  const dgKey = q.dg;
  const lang = (q.lang || "en-US").toString();
  if (!dgKey) {
    console.log("[proxy] missing dg key");
    try {
      client.close(1011, "Missing dg key");
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

  console.log("[proxy] connecting Deepgram…", lang);
  const upstream = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, {
    headers: { Authorization: `Token ${dgKey}` },
  });
  upstream.binaryType = "arraybuffer";

  upstream.on("open", () => {
    console.log("[proxy] upstream open");
    try {
      upstream.send(
        JSON.stringify({
          type: "start",
          encoding: "linear16",
          sample_rate: 16000,
          channels: 1,
          language: lang,
          interim_results: true,
          punctuate: true,
          smart_format: true,
          model: "nova-2-general",
        })
      );
    } catch (e) {
      console.log("[proxy] start send err", e?.message);
    }
    try {
      client.send(JSON.stringify({ type: "ready" }));
    } catch {}
  });

  upstream.on("message", (data) => {
    if (typeof data === "string") {
      const preview = data.length > 200 ? data.slice(0, 200) + "…" : data;
      console.log("[proxy] <- DG", preview);
      try {
        client.send(data);
      } catch {}
    } else {
      console.log("[proxy] <- DG binary", data?.byteLength);
    }
  });

  upstream.on("close", (code, reason) => {
    console.log("[proxy] upstream close", code, reason?.toString?.());
    try {
      client.close(code, reason?.toString?.() || "");
    } catch {}
  });

  upstream.on("error", (err) => {
    console.log("[proxy] upstream error", err?.message || err);
    try {
      client.send(JSON.stringify({ type: "error", error: "upstream" }));
    } catch {}
    try {
      client.close(1011, "Upstream error");
    } catch {}
  });

  client.on("message", (data, isBinary) => {
    if (upstream.readyState !== WebSocket.OPEN) return;
    if (isBinary) {
      console.log("[proxy] -> DG audio bytes", data.length || data.byteLength);
      upstream.send(data, { binary: true });
    } else {
      // ignore text from browser
      const t = data.toString();
      console.log("[proxy] (ignored client text)", t.slice(0, 100));
    }
  });

  client.on("close", (code, reason) => {
    console.log("[proxy] client close", code, reason?.toString?.());
    try {
      upstream.close();
    } catch {}
  });

  client.on("error", (err) => {
    console.log("[proxy] client error", err?.message || err);
    try {
      upstream.close();
    } catch {}
  });
});

server.on("upgrade", (request, socket, head) => {
  const { pathname, query } = url.parse(request.url, true);
  if (pathname === "/api/deepgram") {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request, query);
    });
  } else {
    socket.destroy();
  }
});

const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping(() => {});
  });
}, 30000);

server.on("close", () => clearInterval(interval));
server.listen(PORT, () => console.log("WS proxy listening on", PORT));
