// The clamd client, exercised against a real TCP server that speaks the real
// INSTREAM protocol.
//
// The server below is a test double for the DAEMON, not for the scanner's
// verdict: it reassembles the chunked stream exactly as clamd does and answers
// FOUND only when the bytes it received really contain the EICAR test string.
// So a bug in our framing, our terminator or our reply parsing fails here.
//
// What this file deliberately does NOT do is let the worker claim
// `antivirusScanning` without a real ClamAV. That capability comes from
// `selfTest.mjs`, which talks to whatever clamd the environment actually has.

import assert from 'node:assert/strict';
import net from 'node:net';
import test from 'node:test';

import { AntivirusError, antivirusVersion, scanBytes } from '../src/antivirus.mjs';

const EICAR = ['X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-',
  'ANTIVIRUS-TEST-FILE!$H+H*'].join('');

function defaultVersionLine(date = new Date()) {
  return `ClamAV 1.3.1/27300/${date.toUTCString().replace('GMT', 'UTC')}`;
}

/** A clamd that implements zINSTREAM/zVERSION over TCP. */
function startFakeClamd({ versionLine } = {}) {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
      let buffer = Buffer.alloc(0);
      let command = null;
      const payload = [];
      socket.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        if (!command) {
          const end = buffer.indexOf(0);
          if (end === -1) return;
          command = buffer.subarray(0, end).toString('utf8');
          buffer = buffer.subarray(end + 1);
          if (command === 'zVERSION') {
            socket.end(`${versionLine || defaultVersionLine()}\0`);
            return;
          }
          if (command !== 'zINSTREAM') {
            socket.end('UNKNOWN COMMAND\0');
            return;
          }
        }
        // Reassemble <uint32be length><chunk>… until the zero terminator.
        for (;;) {
          if (buffer.length < 4) return;
          const size = buffer.readUInt32BE(0);
          if (size === 0) {
            const received = Buffer.concat(payload).toString('latin1');
            socket.end(received.includes(EICAR)
              ? 'stream: Eicar-Test-Signature FOUND\0'
              : 'stream: OK\0');
            return;
          }
          if (buffer.length < 4 + size) return;
          payload.push(buffer.subarray(4, 4 + size));
          buffer = buffer.subarray(4 + size);
        }
      });
      socket.on('error', () => {});
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        server,
        config: { host: '127.0.0.1', port, timeoutMs: 5000, maxSignatureAgeDays: 7 },
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

test('un buffer limpio pasa el scan', async () => {
  const clamd = await startFakeClamd();
  try {
    const result = await scanBytes(new TextEncoder().encode('una foto cualquiera'), clamd.config);
    assert.equal(result.clean, true);
  } finally {
    await clamd.close();
  }
});

test('el archivo de prueba EICAR es rechazado', async () => {
  const clamd = await startFakeClamd();
  try {
    await assert.rejects(
      () => scanBytes(new TextEncoder().encode(EICAR), clamd.config),
      (error) => {
        assert.ok(error instanceof AntivirusError);
        assert.equal(error.code, 'ANTIVIRUS_INFECTED');
        assert.match(error.message, /Eicar-Test-Signature/);
        return true;
      },
    );
  } finally {
    await clamd.close();
  }
});

test('EICAR escondido en un archivo grande y fragmentado también se detecta', async () => {
  const clamd = await startFakeClamd();
  try {
    // Más de un chunk de 64 KB, con la firma a caballo del segundo: prueba el
    // framing, no la firma.
    const filler = Buffer.alloc(70 * 1024, 0x41);
    const payload = Buffer.concat([filler, Buffer.from(EICAR, 'latin1'), filler]);
    await assert.rejects(
      () => scanBytes(new Uint8Array(payload), clamd.config),
      (error) => error.code === 'ANTIVIRUS_INFECTED',
    );
  } finally {
    await clamd.close();
  }
});

test('la versión y la fecha de firmas se leen de clamd', async () => {
  const clamd = await startFakeClamd();
  try {
    const version = await antivirusVersion(clamd.config);
    assert.equal(version.name, 'clamav');
    assert.equal(version.version, '1.3.1');
    assert.equal(version.signatureVersion, '27300');
    assert.ok(Date.now() - new Date(version.signaturesAt).getTime() < 86400000);
  } finally {
    await clamd.close();
  }
});

test('definiciones viejas se tratan como si no hubiera antivirus', async () => {
  const old = new Date(Date.now() - 60 * 86400000);
  const clamd = await startFakeClamd({ versionLine: defaultVersionLine(old) });
  try {
    await assert.rejects(
      () => antivirusVersion(clamd.config),
      (error) => error.code === 'ANTIVIRUS_SIGNATURES_STALE',
    );
  } finally {
    await clamd.close();
  }
});

test('sin clamd no hay veredicto: se rompe, no se asume limpio', async () => {
  const clamd = await startFakeClamd();
  const { config } = clamd;
  await clamd.close();
  await assert.rejects(
    () => scanBytes(new TextEncoder().encode('foto'), config),
    (error) => {
      assert.ok(error instanceof AntivirusError);
      assert.equal(error.code, 'ANTIVIRUS_UNAVAILABLE');
      return true;
    },
  );
});
