/**
 * ClamAV, over clamd's INSTREAM protocol.
 *
 * There is deliberately no fallback scanner, no heuristic and no "assume
 * clean". If clamd is unreachable, or its signature database is older than the
 * freshness window, `scanBytes` throws and the worker does not attest
 * `antivirusScanning` — which keeps `uploadReady` false. A stub that returned
 * "clean" would be exactly the simulated capability this pipeline exists to
 * remove.
 *
 * Protocol (clamd, TCP):
 *   > zINSTREAM\0
 *   > <uint32be length><chunk> ...        (repeat)
 *   > <uint32be 0>                        (terminator)
 *   < "stream: OK\0"  |  "stream: <name> FOUND\0"  |  "... ERROR\0"
 */

import net from 'node:net';

export class AntivirusError extends Error {
  constructor(code, detail) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'AntivirusError';
    this.code = code;
  }
}

const CHUNK_BYTES = 64 * 1024;

function connect({ host, port, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => resolve(socket));
    socket.once('timeout', () => {
      socket.destroy();
      reject(new AntivirusError('ANTIVIRUS_TIMEOUT', `${host}:${port}`));
    });
    socket.once('error', (error) => {
      reject(new AntivirusError('ANTIVIRUS_UNAVAILABLE', error?.message));
    });
  });
}

function readReply(socket, timeoutMs) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new AntivirusError('ANTIVIRUS_TIMEOUT', 'no reply'));
    }, timeoutMs);
    socket.on('data', (chunk) => chunks.push(chunk));
    socket.once('end', () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString('utf8').replace(/\0+$/, '').trim());
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(new AntivirusError('ANTIVIRUS_UNAVAILABLE', error?.message));
    });
  });
}

export function defaultAntivirusConfig(env = process.env) {
  return {
    host: env.TOURNAMENT_MEDIA_CLAMD_HOST || '127.0.0.1',
    port: Number(env.TOURNAMENT_MEDIA_CLAMD_PORT || 3310),
    timeoutMs: Number(env.TOURNAMENT_MEDIA_CLAMD_TIMEOUT_MS || 15000),
    /** Definitions older than this are treated as no antivirus at all. */
    maxSignatureAgeDays: Number(env.TOURNAMENT_MEDIA_CLAMD_MAX_SIGNATURE_AGE_DAYS || 7),
  };
}

/**
 * `VERSION` → `ClamAV 1.3.1/27300/Thu Aug  1 08:00:00 2026`.
 * The signature date is evidence the database binds the attestation to, so a
 * scanner running on year-old definitions cannot certify the pipeline.
 */
export async function antivirusVersion(config = defaultAntivirusConfig()) {
  const socket = await connect(config);
  socket.write('zVERSION\0');
  const reply = await readReply(socket, config.timeoutMs);
  const match = reply.match(/^ClamAV\s+([0-9][^/\s]*)(?:\/(\d+))?(?:\/(.+))?$/i);
  if (!match) throw new AntivirusError('ANTIVIRUS_VERSION_UNPARSEABLE', reply.slice(0, 120));
  const signaturesAt = match[3] ? new Date(match[3].trim()) : null;
  if (!signaturesAt || Number.isNaN(signaturesAt.getTime())) {
    throw new AntivirusError('ANTIVIRUS_SIGNATURES_UNKNOWN');
  }
  const ageDays = (Date.now() - signaturesAt.getTime()) / 86400000;
  if (ageDays > config.maxSignatureAgeDays) {
    throw new AntivirusError('ANTIVIRUS_SIGNATURES_STALE', `${Math.round(ageDays)}d`);
  }
  return {
    name: 'clamav',
    version: match[1],
    signatureVersion: match[2] || null,
    signaturesAt: signaturesAt.toISOString(),
  };
}

/**
 * Streams one buffer through clamd. Returns `{ clean: true }` or throws
 * `ANTIVIRUS_INFECTED` with the signature name; it never returns "unknown".
 */
export async function scanBytes(bytes, config = defaultAntivirusConfig()) {
  const socket = await connect(config);
  socket.write('zINSTREAM\0');
  for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
    const chunk = Buffer.from(bytes.subarray(offset, Math.min(offset + CHUNK_BYTES, bytes.length)));
    const header = Buffer.alloc(4);
    header.writeUInt32BE(chunk.length, 0);
    socket.write(header);
    socket.write(chunk);
  }
  const terminator = Buffer.alloc(4);
  terminator.writeUInt32BE(0, 0);
  socket.write(terminator);

  const reply = await readReply(socket, config.timeoutMs);
  if (/\bFOUND\b/.test(reply)) {
    const signature = reply.replace(/^stream:\s*/i, '').replace(/\s*FOUND$/i, '').trim();
    throw new AntivirusError('ANTIVIRUS_INFECTED', signature || 'unknown signature');
  }
  if (/\bERROR\b/.test(reply) || !/\bOK\b/.test(reply)) {
    throw new AntivirusError('ANTIVIRUS_SCAN_FAILED', reply.slice(0, 120));
  }
  return { clean: true, reply };
}

export function createAntivirus(config = defaultAntivirusConfig()) {
  return {
    version: () => antivirusVersion(config),
    scan: (bytes) => scanBytes(bytes, config),
  };
}
