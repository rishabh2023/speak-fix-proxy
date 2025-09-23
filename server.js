// server.js — Deepgram WS proxy (spec-correct multilingual)
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

const wss = new WebSocket.Server({
  noServer: true,
  perMessageDeflate: {
    zlibDeflateOptions: { chunkSize: 1024 },
    zlibInflateOptions: { chunkSize: 1024 },
    serverNoContextTakeover: true,
    clientNoContextTakeover: true,
  },
});

function heartbeat() {
  this.isAlive = true;
}

wss.on("connection", (client, request, q) => {
  console.log("[proxy] client connected", request.socket.remoteAddress);
  client.isAlive = true;
  client.on("pong", heartbeat);

  const dgKey = q.dg;
  const langParam = (q.lang || "multi").toString(); // "en-US" or "multi"
  const langsList = (q.langs || "").toString(); // e.g. "en,hi,es"

  if (!dgKey) {
    console.log("[proxy] missing dg key");
    try {
      client.close(1011, "Missing dg key");
    } catch {}
    return;
  }

  // Build query params for Deepgram
  const params = new URLSearchParams({
    model: "nova-2-general",
    smart_format: "true", // implies punctuate
    interim_results: "true",
    encoding: "linear16",
    sample_rate: "16000",
    channels: "1",
  });

  if (langParam.toLowerCase() === "multi") {
    params.set("detect_language", "true");
    if (langsList) params.set("languages", langsList); // optional restrict list
  } else {
    params.set("language", langParam); // single language path
  }

  const upstream = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, {
    headers: { Authorization: `Token ${dgKey}` },
    perMessageDeflate: true,
  });
  upstream.binaryType = "arraybuffer";

  upstream.on("open", () => {
    console.log("[proxy] upstream open");

    // Mirror params in an explicit "start" control
    const startPayload = {
      type: "start",
      encoding: "linear16",
      sample_rate: 16000,
      channels: 1,
      interim_results: true,
      smart_format: true,
      model: "nova-2-general",
    };
    if (langParam.toLowerCase() === "multi") {
      startPayload.detect_language = true;
      if (langsList) startPayload.languages = langsList;
    } else {
      startPayload.language = langParam;
    }

    try {
      upstream.send(JSON.stringify(startPayload));
    } catch (e) {
      console.log("[proxy] start send err", e?.message);
    }

    try {
      client.send(JSON.stringify({ type: "ready" }));
    } catch {}
  });

  // DG -> Browser (string or binary JSON)
  upstream.on("message", (data, isBinary) => {
    let text;
    if (isBinary) {
      text = Buffer.isBuffer(data)
        ? data.toString("utf8")
        : data instanceof ArrayBuffer
        ? Buffer.from(data).toString("utf8")
        : "";
      console.log(
        "[proxy] <- DG binary",
        Buffer.isBuffer(data) ? data.length : data?.byteLength || 0
      );
    } else {
      text = data;
      const preview = text.length > 200 ? text.slice(0, 200) + "…" : text;
      console.log("[proxy] <- DG", preview);
    }
    if (text) {
      try {
        client.send(text);
      } catch (e) {
        console.log("[proxy] downstream send err", e?.message);
      }
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

  // Browser -> Deepgram: only binary audio
  client.on("message", (data, isBinary) => {
    if (upstream.readyState !== WebSocket.OPEN) return;
    if (isBinary) {
      const size = data.length || data.byteLength || 0;
      console.log("[proxy] -> DG audio bytes", size);
      upstream.send(data, { binary: true });
    } else {
      console.log(
        "[proxy] (ignored client text)",
        data.toString().slice(0, 100)
      );
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

// Keep client<->proxy alive only
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping(() => {});
  });
}, 30000);

server.on("close", () => clearInterval(interval));
server.listen(PORT, () => console.log("WS proxy listening on", PORT));
