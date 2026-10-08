#!/usr/bin/env node
// B04 hybrid lab bridge — dev-only, loopback-only.
//
// The Phase 3A lab gateway serves exactly one browser origin (its own, as Phase 1.5
// served the app from the gateway) and the lab's Core API has no CORS at all. A CRA
// dev server on localhost:3000 therefore cannot talk to either directly. This bridge
// stands in for "the app served from the allowed origin":
//
//   127.0.0.1:58422  →  127.0.0.1:58424   lab Core (GoTrue / PostgREST / functions) + CORS
//   127.0.0.1:58423  →  127.0.0.1:58420   lab gateway, Host/Origin rewritten to the lab
//                                         origin the gateway allows, + CORS
//                    (B04_LAB_GATEWAY=edge: 127.0.0.1:58421/torneos-gateway, the Edge Function the hosted gateway runs —
//                     the one that carries PLAN READ / SOCIAL, for a run that mirrors Production)
//
// It never touches remote hosts, never reads env files, never logs bodies or bearers,
// and refuses any browser origin but the app's. In remote staging the hosted gateway
// gets TORNEOS_ALLOWED_ORIGIN = the app origin and the browser does real CORS.
import http from 'node:http';

const APP_ORIGIN = process.env.B04_LAB_APP_ORIGIN || 'http://localhost:3000';
const EDGE_GATEWAY = process.env.B04_LAB_GATEWAY === 'edge';
// A second lab gateway (B04_LAB_GATEWAY_ORIGIN, e.g. MEDIA-V1's beside the preview's) and its own bridge ports, all on
// the 584xx loopback range of the lab; the defaults are the original single-gateway lab.
const LOOPBACK_584 = /^http:\/\/127\.0\.0\.1:584[0-9]{2}$/;
const bridgePort = (name, fallback) => {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value) || value < 58400 || value > 58499) throw new Error(`${name} must be a 584xx port`);
  return value;
};
const LAB_GATEWAY_ORIGIN = process.env.B04_LAB_GATEWAY_ORIGIN || (EDGE_GATEWAY ? 'http://127.0.0.1:58421' : 'http://127.0.0.1:58420');
if (!LOOPBACK_584.test(LAB_GATEWAY_ORIGIN)) throw new Error('B04_LAB_GATEWAY_ORIGIN must be a 584xx loopback origin');
const LAB_GATEWAY_UPSTREAM = EDGE_GATEWAY ? `${LAB_GATEWAY_ORIGIN}/torneos-gateway` : LAB_GATEWAY_ORIGIN;
const LAB_CORE_ORIGIN = 'http://127.0.0.1:58424';
const CORE_PORT = bridgePort('B04_LAB_BRIDGE_CORE_PORT', 58422);
const GATEWAY_PORT = bridgePort('B04_LAB_BRIDGE_GATEWAY_PORT', 58423);
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'te', 'trailer', 'upgrade', 'proxy-authorization', 'proxy-authenticate', 'host', 'origin', 'content-length']);

function cors(req, res) {
  res.setHeader('access-control-allow-origin', APP_ORIGIN);
  res.setHeader('access-control-allow-methods', 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('access-control-allow-headers', req.headers['access-control-request-headers'] || 'authorization, content-type, accept, prefer, range, apikey, x-client-info, x-supabase-api-version, accept-profile, content-profile');
  res.setHeader('access-control-expose-headers', 'content-range, x-supabase-api-version');
  res.setHeader('access-control-max-age', '600');
  res.setHeader('vary', 'origin');
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function bridge({ port, upstream, rewriteOrigin }) {
  const server = http.createServer(async (req, res) => {
    try {
      const origin = req.headers.origin;
      if (origin && origin !== APP_ORIGIN) {
        res.writeHead(403, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: 'origin rejected by lab bridge' }));
      }
      cors(req, res);
      if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
      const headers = {};
      for (const [name, value] of Object.entries(req.headers)) {
        if (!HOP_BY_HOP.has(name) && value !== undefined) headers[name] = value;
      }
      headers.host = new URL(upstream).host;
      if (rewriteOrigin && origin) headers.origin = rewriteOrigin;
      const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await readBody(req);
      const response = await fetch(`${upstream}${req.url}`, {
        method: req.method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(15000),
      });
      for (const [name, value] of response.headers) {
        // fetch already decoded the body: forwarding content-encoding would make the browser decode it twice (the Edge
        // runtime compresses; the Node gateway does not).
        if (!HOP_BY_HOP.has(name) && name !== 'content-encoding' && !name.startsWith('access-control-')) res.setHeader(name, value);
      }
      res.writeHead(response.status);
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      if (!res.headersSent) { res.writeHead(503, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'lab upstream unavailable' })); } else res.end();
    }
  });
  server.listen(port, '127.0.0.1', () => console.log(`[b04 lab bridge] ${port} → ${upstream}${rewriteOrigin ? ` (origin ${rewriteOrigin})` : ''} for ${APP_ORIGIN}`));
  return server;
}

bridge({ port: CORE_PORT, upstream: LAB_CORE_ORIGIN, rewriteOrigin: null });
bridge({ port: GATEWAY_PORT, upstream: LAB_GATEWAY_UPSTREAM, rewriteOrigin: LAB_GATEWAY_ORIGIN });
