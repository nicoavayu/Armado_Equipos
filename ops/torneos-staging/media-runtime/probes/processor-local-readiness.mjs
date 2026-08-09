#!/usr/bin/env node
/**
 * The processor's container HEALTHCHECK. Local only.
 *
 * ---------------------------------------------------------------------------
 * What this is not
 * ---------------------------------------------------------------------------
 * It is not `npm run healthcheck`. That command runs the full worker self-test,
 * which uploads, downloads and deletes `_selftest/<timestamp>.png` in the
 * Staging bucket. As a container healthcheck it would perform three remote
 * writes per interval, forever, against a project whose write authorization is
 * granted per operation. Remote certification stays a manual command; this is
 * what runs on a timer.
 *
 * It is also not the worker self-test's local half. It deliberately does NOT
 * import worker source modules: a healthcheck that reuses the process it watches
 * is least useful when those modules are the failure. The probe is mounted below
 * /app solely so ESM resolves the image's existing /app/node_modules/sharp;
 * everything else is reproduced here against the same libraries.
 *
 * ---------------------------------------------------------------------------
 * What it proves
 * ---------------------------------------------------------------------------
 *   node      the runtime is the pinned major (22), so a rebuilt image that
 *             silently moved is unhealthy rather than subtly different
 *   sharp     libvips is present AND can decode, resize and re-encode real
 *             pixels. `import('sharp')` alone only proves the addon resolved;
 *             a missing shared library shows up on first raster, not on load
 *   clamd     TCP to the address the worker is configured to use, answering
 *             the PING it is sent. Reachability, not a scan
 *
 * Exit 0 healthy, 1 unhealthy. It never prints an environment value.
 */

import net from 'node:net';

const CLAMD_HOST = process.env.TOURNAMENT_MEDIA_CLAMD_HOST || 'clamd';
const CLAMD_PORT = Number(process.env.TOURNAMENT_MEDIA_CLAMD_PORT || 3310);
const TIMEOUT_MS = Number(process.env.TOURNAMENT_MEDIA_READINESS_TIMEOUT_MS || 5000);

const fail = (code) => { process.stderr.write(`PROCESSOR_NOT_READY ${code}\n`); process.exit(1); };

// --- node ------------------------------------------------------------------
if (Number(process.versions.node.split('.')[0]) !== 22) fail('node-major');

// --- sharp / libvips -------------------------------------------------------
let sharp;
try {
  ({ default: sharp } = await import('sharp'));
} catch {
  fail('sharp-load');
}
try {
  const png = await sharp({
    create: { width: 64, height: 48, channels: 3, background: { r: 7, g: 11, b: 13 } },
  }).png().toBuffer();
  const out = await sharp(png).resize(16, 12, { fit: 'fill' }).jpeg().toBuffer();
  const meta = await sharp(out).metadata();
  if (meta.width !== 16 || meta.height !== 12 || meta.format !== 'jpeg') fail('sharp-raster');
} catch {
  fail('sharp-raster');
}

// --- clamd -----------------------------------------------------------------
// zINSTREAM-style null-terminated command: `zPING` is answered with `PONG\0`.
// A daemon that accepts the connection but cannot answer is not ready, and a
// bare connect() would have called it ready.
const pong = await new Promise((resolve) => {
  const socket = net.createConnection({ host: CLAMD_HOST, port: CLAMD_PORT });
  let buffer = '';
  const done = (value) => { socket.destroy(); resolve(value); };
  socket.setTimeout(TIMEOUT_MS);
  socket.on('connect', () => socket.write('zPING\0'));
  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    if (buffer.includes('PONG')) done(true);
  });
  socket.on('timeout', () => done(false));
  socket.on('error', () => done(false));
  socket.on('close', () => resolve(buffer.includes('PONG')));
});
if (!pong) fail('clamd-ping');

process.stdout.write('PROCESSOR_READY node sharp clamd\n');
process.exit(0);
