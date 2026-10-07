// Core lab API origin (Kong substitute). Published on 127.0.0.1 only.
//   /rest/v1/*      → PostgREST
//   /auth/v1/*      → GoTrue
//   /storage/v1/*   → storage-api
//   /functions/v1/* → edge-runtime (prefix stripped like the platform)
//   /realtime/v1/*  → Realtime (websocket upgrade, tenant `realtime-dev`)
// Like the hosted gateway, a request that carries only `apikey` gets it as the
// bearer (legacy JWT keys), and CORS is answered for the lab app origins only.
import http from 'node:http';
import net from 'node:net';

const ALLOWED_ORIGINS = new Set(String(process.env.LAB_ALLOWED_ORIGINS || '')
  .split(',').map((origin) => origin.trim()).filter(Boolean));
// Optional slow network for UX review: "prefix=ms,prefix=ms" (e.g. /rest/v1/notifications=2500).
const SLOW_PATHS = String(process.env.LAB_SLOW_PATHS || '').split(',').map((entry) => entry.trim()).filter(Boolean)
  .map((entry) => { const [prefix, ms] = entry.split('='); return [prefix, Math.min(Number(ms) || 0, 15000)]; });
const delayFor = (pathname) => SLOW_PATHS.find(([prefix]) => pathname.startsWith(prefix))?.[1] || 0;

const routes = [
  ['/rest/v1/', { host: 'core-rest', port: 3000, prefix: '/' }],
  ['/auth/v1/', { host: 'core-auth', port: 9999, prefix: '/' }],
  ['/storage/v1/', { host: 'core-storage', port: 5000, prefix: '/' }],
  ['/functions/v1/', { host: 'core-functions', port: 9000, prefix: '/' }],
  ['/realtime/v1/', { host: 'core-realtime', port: 4000, prefix: '/socket/', hostHeader: 'realtime-dev.core-realtime' }],
];

const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'host']);

function corsHeaders(req) {
  const origin = req.headers.origin;
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': req.headers['access-control-request-headers']
      || 'authorization,apikey,content-type,prefer,range,x-client-info,x-upsert,accept-profile,content-profile',
    'access-control-expose-headers': 'content-range,content-length,etag,x-total-count',
    'access-control-max-age': '600',
    vary: 'Origin',
  };
}

function route(pathname) {
  const match = routes.find(([prefix]) => pathname.startsWith(prefix));
  if (!match) return null;
  const [prefix, target] = match;
  return { ...target, path: target.prefix + pathname.slice(prefix.length) };
}

function upstreamHeaders(req, target) {
  const headers = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (!HOP_BY_HOP.has(name)) headers[name] = value;
  }
  if (!headers.authorization && typeof headers.apikey === 'string' && headers.apikey.split('.').length === 3) {
    headers.authorization = `Bearer ${headers.apikey}`;
  }
  headers.host = target.hostHeader || `${target.host}:${target.port}`;
  return headers;
}

const server = http.createServer((req, res) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') {
    res.writeHead(Object.keys(cors).length ? 204 : 403, cors);
    return res.end();
  }
  const url = new URL(req.url, 'http://core-api');
  if (url.pathname === '/_lab/health') {
    res.writeHead(200, { 'content-type': 'application/json', ...cors });
    return res.end('{"ok":true}');
  }
  const target = route(url.pathname);
  if (!target) {
    res.writeHead(404, { 'content-type': 'application/json', ...cors });
    return res.end('{"error":"not found"}');
  }
  const delay = req.method === 'OPTIONS' ? 0 : delayFor(url.pathname);
  if (delay) {
    req.pause();
    return setTimeout(() => { req.resume(); proxy(req, res, url, target, cors); }, delay);
  }
  return proxy(req, res, url, target, cors);
});

function proxy(req, res, url, target, cors) {
  const upstream = http.request({
    host: target.host, port: target.port, method: req.method,
    path: target.path + url.search, headers: upstreamHeaders(req, target),
  }, (upstreamRes) => {
    const headers = { ...upstreamRes.headers };
    for (const name of Object.keys(headers)) {
      if (name.startsWith('access-control-')) delete headers[name];
    }
    res.writeHead(upstreamRes.statusCode || 502, { ...headers, ...cors });
    upstreamRes.pipe(res);
  });
  upstream.setTimeout(30000, () => upstream.destroy(new Error('timeout')));
  upstream.on('error', () => {
    // Never log request details; upstream faults are reported as unavailable.
    if (!res.headersSent) {
      res.writeHead(503, { 'content-type': 'application/json', ...cors });
      res.end('{"error":"upstream unavailable"}');
    } else res.end();
  });
  req.pipe(upstream);
}

// Realtime websocket upgrade: raw TCP tunnel after rewriting the request line.
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://core-api');
  const target = route(url.pathname);
  if (!target || target.host !== 'core-realtime') return socket.destroy();
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.has(origin)) return socket.destroy();
  const upstream = net.connect(target.port, target.host, () => {
    const headers = upstreamHeaders(req, target);
    headers.connection = 'Upgrade';
    headers.upgrade = req.headers.upgrade;
    const lines = [`GET ${target.path}${url.search} HTTP/1.1`];
    for (const [name, value] of Object.entries(headers)) lines.push(`${name}: ${value}`);
    upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
    if (head?.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
});

server.listen(8000, '0.0.0.0', () => console.log('core-lab api ready'));
