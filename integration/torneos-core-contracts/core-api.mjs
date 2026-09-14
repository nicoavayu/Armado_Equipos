// Internal Core API origin for the lab (Kong substitute). Never published.
// /rest/v1/*      → PostgREST (core-rest)
// /auth/v1/*      → GoTrue (core-auth)
// /functions/v1/* → edge-runtime (core-functions), prefix stripped like the platform
import http from 'node:http';

const targets = [
  ['/rest/v1/', 'http://core-rest:3000/'],
  ['/auth/v1/', 'http://core-auth:9999/'],
  ['/functions/v1/', 'http://core-functions:9000/'],
];

async function body(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 262144) throw new Error('body too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://core-api:8000');
    const target = targets.find(([prefix]) => url.pathname.startsWith(prefix));
    if (!target) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end('{"error":"not found"}'); }
    const headers = {};
    for (const name of ['accept', 'content-type', 'prefer', 'range', 'authorization', 'apikey', 'x-time', 'x-nonce', 'x-signature', 'content-profile', 'accept-profile', 'x-client-info']) {
      if (req.headers[name]) headers[name] = req.headers[name];
    }
    const upstream = await fetch(target[1] + url.pathname.slice(target[0].length) + url.search, {
      method: req.method, headers, redirect: 'error', signal: AbortSignal.timeout(8000),
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : await body(req),
    });
    const out = { 'content-type': upstream.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' };
    if (upstream.headers.has('content-range')) out['content-range'] = upstream.headers.get('content-range');
    res.writeHead(upstream.status, out);
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch {
    // Never log request details; upstream faults are reported as unavailable.
    if (!res.headersSent) { res.writeHead(503, { 'content-type': 'application/json' }); res.end('{"error":"upstream unavailable"}'); } else res.end();
  }
}).listen(8000, '0.0.0.0', () => console.log('core-api ready'));
