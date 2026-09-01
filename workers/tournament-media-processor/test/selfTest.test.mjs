// The self-test is the only route to `uploadReady: true`, so what matters here
// is that it cannot pass by accident and cannot claim what it did not prove.
//
// The codec is real. The bucket is a real in-memory implementation of the same
// three operations. clamd is the same protocol-level double as
// `antivirus.test.mjs`, and one case removes it entirely to show that the
// antivirus capability disappears rather than defaulting to true.

import assert from 'node:assert/strict';
import net from 'node:net';
import test from 'node:test';

import * as codec from '../src/codec.mjs';
import { scanBytes } from '../src/antivirus.mjs';
import { buildAttestation, runWorkerSelfTest } from '../src/selfTest.mjs';

const EICAR = ['X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-',
  'ANTIVIRUS-TEST-FILE!$H+H*'].join('');

function startFakeClamd({ neverFinds = false } = {}) {
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
            socket.end(`ClamAV 1.3.1/27300/${new Date().toUTCString().replace('GMT', 'UTC')}\0`);
            return;
          }
        }
        for (;;) {
          if (buffer.length < 4) return;
          const size = buffer.readUInt32BE(0);
          if (size === 0) {
            const received = Buffer.concat(payload).toString('latin1');
            socket.end(!neverFinds && received.includes(EICAR)
              ? 'stream: Eicar-Test-Signature FOUND\0' : 'stream: OK\0');
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
      const config = { host: '127.0.0.1', port, timeoutMs: 5000, maxSignatureAgeDays: 7 };
      resolve({
        config,
        antivirus: {
          version: async () => (await import('../src/antivirus.mjs')).antivirusVersion(config),
          scan: (bytes) => scanBytes(bytes, config),
        },
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

function memoryStorage() {
  const objects = new Map();
  return {
    objects,
    async upload(name, bytes) { objects.set(name, bytes); return true; },
    async download(name) { return objects.get(name) ?? null; },
    async remove(names) { for (const name of names) objects.delete(name); return true; },
  };
}

const brokenStorage = {
  async upload() { throw new Error('STORAGE_UNAVAILABLE'); },
  async download() { throw new Error('STORAGE_UNAVAILABLE'); },
  async remove() { throw new Error('STORAGE_UNAVAILABLE'); },
};

test('con codec, antivirus y storage reales el self-test pasa entero', async () => {
  const clamd = await startFakeClamd();
  try {
    const result = await runWorkerSelfTest({
      codec, antivirus: clamd.antivirus, storage: memoryStorage(),
    });
    assert.equal(result.passed, true, JSON.stringify(result.checks));
    for (const name of [
      'contentSniffing', 'pixelDecode', 'pixelTranscode', 'metadataStrippingApplied',
      'checksumVerification', 'variantGeneration', 'antivirusScanning',
      'storageReadWrite', 'cleanup',
    ]) {
      assert.equal(result.checks[name], true, `falló ${name}`);
    }
    assert.equal(result.evidence.codec.name, 'libvips');
    assert.equal(result.evidence.antivirus.name, 'clamav');
  } finally {
    await clamd.close();
  }
});

test('un escáner que nunca encuentra nada no certifica el antivirus', async () => {
  // El caso peligroso: un "antivirus" que siempre dice OK. El self-test exige
  // que EICAR sea detectado, así que un stub complaciente falla el check.
  const clamd = await startFakeClamd({ neverFinds: true });
  try {
    const result = await runWorkerSelfTest({
      codec, antivirus: clamd.antivirus, storage: memoryStorage(),
    });
    assert.equal(result.checks.antivirusScanning, false);
    assert.equal(result.passed, false);
    const attestation = buildAttestation(result, { backendFingerprint: 'a'.repeat(64) });
    assert.equal(attestation.capabilities.antivirusScanning, undefined);
    assert.equal(attestation.evidence.selfTest.passed, false);
  } finally {
    await clamd.close();
  }
});

test('sin clamd el worker no reclama antivirus', async () => {
  const clamd = await startFakeClamd();
  const { antivirus } = clamd;
  await clamd.close();
  const result = await runWorkerSelfTest({
    codec, antivirus, storage: memoryStorage(),
  });
  assert.equal(result.checks.antivirusScanning, false);
  assert.equal(result.checks.pixelDecode, true, 'el codec sigue estando');
  assert.equal(result.passed, false);
});

test('sin Storage el worker no reclama lectura/escritura ni limpieza', async () => {
  const clamd = await startFakeClamd();
  try {
    const result = await runWorkerSelfTest({
      codec, antivirus: clamd.antivirus, storage: brokenStorage,
    });
    assert.equal(result.checks.storageReadWrite, false);
    assert.equal(result.checks.cleanup, false);
    assert.equal(result.passed, false);
  } finally {
    await clamd.close();
  }
});

test('la atestación sólo declara lo que el self-test probó', async () => {
  const clamd = await startFakeClamd();
  try {
    const result = await runWorkerSelfTest({
      codec, antivirus: clamd.antivirus, storage: memoryStorage(),
    });
    const attestation = buildAttestation(result, { backendFingerprint: 'b'.repeat(64) });
    // Toda capacidad declarada tiene un check homónimo en true. Es exactamente
    // la invariante que la base vuelve a verificar del otro lado.
    for (const [name, claimed] of Object.entries(attestation.capabilities)) {
      assert.equal(claimed, true);
      assert.equal(attestation.evidence.selfTest.checks[name], true, name);
    }
    assert.equal(attestation.evidence.workerType, 'external_image_worker');
    assert.match(attestation.evidence.codec.version, /^\d+\.\d+/);
    assert.equal(attestation.evidence.backendFingerprint, 'b'.repeat(64));
    assert.ok(Date.now() - new Date(attestation.evidence.probedAt).getTime() < 60_000);
    // Y no hay forma de meter un nombre que la base no conoce.
    assert.equal(attestation.capabilities.structuralDecode, undefined);
    assert.equal(attestation.capabilities.codecAvailable, undefined);
  } finally {
    await clamd.close();
  }
});
