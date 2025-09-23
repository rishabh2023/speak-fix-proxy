// app/api/deepgram/route.ts
export const runtime = 'edge';

export async function GET(req: Request) {
  // Only accept WebSocket upgrades
  if (req.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
    return new Response(
      JSON.stringify({ error: 'Expected WebSocket upgrade' }),
      { status: 426, headers: { 'content-type': 'application/json' } }
    );
  }

  const { searchParams } = new URL(req.url);
  const dgKey = searchParams.get('dg');
  const lang = searchParams.get('lang') || 'en-US';
  if (!dgKey) {
    return new Response(
      JSON.stringify({ error: 'Missing dg (Deepgram API key) query param' }),
      { status: 400, headers: { 'content-type': 'application/json' } }
    );
  }

  // Create a client/server socket pair for the browser<->edge connection
  // @ts-ignore - WebSocketPair is provided by the Edge runtime
  const pair = new WebSocketPair();
  const client = pair[0];
  const server = pair[1];

  server.accept();

  // Build Deepgram listen URL with params
  const qs = new URLSearchParams({
    model: 'nova-2-general',
    smart_format: 'true',
    punctuate: 'true',
    interim_results: 'true',
    encoding: 'linear16',
    sample_rate: '16000',
    language: lang,
  });

  // Open a WebSocket to Deepgram using fetch upgrade in Edge runtime
  const upstreamResp = await fetch(`https://api.deepgram.com/v1/listen?${qs}`, {
    headers: { Authorization: `Token ${dgKey}` },
  });

  // @ts-ignore - Edge runtime exposes webSocket on Response for upgraded connections
  const upstream = upstreamResp.webSocket;
  if (!upstream) {
    server.send(JSON.stringify({ type: 'error', details: 'Failed to open upstream WS' }));
    server.close();
    return new Response('Upstream failed', { status: 502 });
  }

  upstream.accept();

  // Pipe browser -> Deepgram (binary PCM16 or control text)
  server.addEventListener('message', (ev: MessageEvent) => {
    try { upstream.send(ev.data as any); } catch {}
  });

  // Pipe Deepgram -> browser (JSON events)
  upstream.addEventListener('message', (ev: MessageEvent) => {
    try { server.send(ev.data as any); } catch {}
  });

  const closeBoth = () => {
    try { server.close(); } catch {}
    try { upstream.close(); } catch {}
  };
  server.addEventListener('close', closeBoth);
  upstream.addEventListener('close', closeBoth);
  server.addEventListener('error', closeBoth);
  upstream.addEventListener('error', closeBoth);

  // Return the client side of the pair to complete the 101 upgrade
  // @ts-ignore
  return new Response(null, { status: 101, webSocket: client });
}
