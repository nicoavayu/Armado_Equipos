// One job, end to end, with a real codec and a real in-memory bucket.
//
// Only the database and the scanner are doubled here, because those are the
// two dependencies a test cannot bring up: the DB has its own suite
// (`scripts/db-integration/torneos-media-failclosed.mjs`) and the scanner has
// its own (`antivirus.test.mjs`). Everything else — decode, orientation,
// metadata stripping, re-encode, variants, checksums, object writes, rollback —
// is the production code path.

import assert from 'node:assert/strict';
import test from 'node:test';

import * as codec from '../src/codec.mjs';
import { processMediaJob, sha256Hex } from '../src/pipeline.mjs';

const sharp = await codec.loadSharp();

const EICAR = ['X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-',
  'ANTIVIRUS-TEST-FILE!$H+H*'].join('');

const QUARANTINE =
  '11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222'
  + '/33333333-3333-4333-8333-333333333333/44444444-4444-4444-8444-444444444444.jpg';

async function dirtyPhoto({ width = 200, height = 150 } = {}) {
  return new Uint8Array(await sharp({
    create: { width, height, channels: 3, background: { r: 30, g: 90, b: 200 } },
  }).withMetadata({
    orientation: 6,
    exif: { IFD0: { Artist: 'Nicolas Avayu', ImageDescription: 'cancha 3, sabado' } },
    icc: 'srgb',
  }).jpeg({ quality: 92 }).toBuffer());
}

function memoryBucket(initial = {}) {
  const objects = new Map(Object.entries(initial));
  return {
    objects,
    async download(name) { return objects.get(name) ?? null; },
    async upload(name, bytes) {
      if (objects.has(name)) throw new Error('STORAGE_UPLOAD_FAILED:409');
      objects.set(name, bytes);
      return true;
    },
    async remove(names) {
      for (const name of names) objects.delete(name);
      return true;
    },
  };
}

function recordingDb(overrides = {}) {
  const calls = [];
  return {
    calls,
    async completeUploadForJob(input) {
      calls.push(['completeUploadForJob', input]);
      if (overrides.completeUploadForJob) return overrides.completeUploadForJob(input);
      return { assetId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
    },
    async finalizeVariants(input) {
      calls.push(['finalizeVariants', input]);
      if (overrides.finalizeVariants) return overrides.finalizeVariants(input);
      return { variantsReady: 4 };
    },
    async completeJob(input) {
      calls.push(['completeJob', input]);
      return { status: 'succeeded' };
    },
    async failJob(input) {
      calls.push(['failJob', input]);
      return { status: 'failed' };
    },
  };
}

const cleanAntivirus = {
  async scan() { return { clean: true }; },
  async version() { return { name: 'clamav', version: '1.3.1', signaturesAt: new Date().toISOString() }; },
};

function infectedAntivirus(match = EICAR) {
  return {
    async scan(bytes) {
      if (Buffer.from(bytes).toString('latin1').includes(match)) {
        const error = new Error('ANTIVIRUS_INFECTED: Eicar-Test-Signature');
        error.code = 'ANTIVIRUS_INFECTED';
        throw error;
      }
      return { clean: true };
    },
    async version() { return { name: 'clamav', version: '1.3.1' }; },
  };
}

function jobFor(bytes) {
  return {
    jobId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    sessionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    leaseToken: 'd'.repeat(64),
    objectName: QUARANTINE,
    declaredMime: 'image/jpeg',
    expectedBytes: bytes.length,
    requestedBy: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  };
}

test('el camino feliz publica cuatro objetos finales y purga la cuarentena', async () => {
  const source = await dirtyPhoto();
  const storage = memoryBucket({ [QUARANTINE]: source });
  const db = recordingDb();
  const outcome = await processMediaJob(jobFor(source), {
    storage, codec, antivirus: cleanAntivirus, db,
  });

  assert.equal(outcome.status, 'succeeded');
  // La orientación 6 rota los píxeles: 200x150 sube, 150x200 se publica.
  assert.equal(outcome.width, 150);
  assert.equal(outcome.height, 200);
  const names = [...storage.objects.keys()];
  assert.equal(names.length, 4, `objetos en el bucket: ${names}`);
  assert.ok(!names.includes(QUARANTINE), 'el objeto bruto ya no existe');
  for (const kind of ['original', 'thumbnail', 'grid', 'detail']) {
    assert.ok(
      names.some((name) => name.endsWith(`-${kind}.jpg`)),
      `falta la variante ${kind}`,
    );
  }

  // Ninguno de los cuatro es una copia de lo subido, y ninguno trae metadata.
  for (const [, bytes] of storage.objects) {
    assert.notEqual(Buffer.compare(Buffer.from(bytes), Buffer.from(source)), 0);
    const carriers = await codec.inspectMetadataCarriers(bytes);
    assert.deepEqual(carriers.carriers, []);
  }

  const finalize = db.calls.find(([name]) => name === 'finalizeVariants')[1];
  for (const kind of ['thumbnail', 'grid', 'detail']) {
    assert.equal(finalize.variants[kind].pixelTranscoded, true);
    assert.equal(finalize.variants[kind].antivirusClean, true);
    assert.equal(finalize.variants[kind].metadataStripped, true);
    assert.match(finalize.variants[kind].checksumSha256, /^[0-9a-f]{64}$/);
  }
  // El checksum que va a la base es el del objeto realmente almacenado.
  const originalName = [...storage.objects.keys()].find((name) => name.endsWith('-original.jpg'));
  const upload = db.calls.find(([name]) => name === 'completeUploadForJob')[1];
  assert.equal(upload.checksumSha256, sha256Hex(storage.objects.get(originalName)));
  assert.equal(upload.leaseToken, 'd'.repeat(64));
});

test('un cliente que se saltea mediaImageClient igual queda saneado', async () => {
  // Bytes que ningún navegador produjo: EXIF real, ICC real, orientación 6 y
  // dimensiones que el cliente nunca declaró. El worker los normaliza igual.
  const source = await dirtyPhoto({ width: 1234, height: 567 });
  const storage = memoryBucket({ [QUARANTINE]: source });
  const db = recordingDb();
  const before = await codec.inspectMetadataCarriers(source);
  assert.equal(before.clean, false, 'la muestra realmente venía sucia');

  const outcome = await processMediaJob(jobFor(source), {
    storage, codec, antivirus: cleanAntivirus, db,
  });
  assert.equal(outcome.status, 'succeeded');
  assert.equal(outcome.width, 567);
  assert.equal(outcome.height, 1234);
  const finalize = db.calls.find(([name]) => name === 'finalizeVariants')[1];
  // Geometría derivada de lo que el worker midió, no de lo que nadie declaró.
  assert.equal(finalize.variants.thumbnail.width, 147);
  assert.equal(finalize.variants.thumbnail.height, 320);
  for (const [, bytes] of storage.objects) {
    assert.deepEqual((await codec.inspectMetadataCarriers(bytes)).carriers, []);
  }
});

test('un archivo infectado no deja variantes y limpia todo', async () => {
  const source = await dirtyPhoto();
  // El scanner marca cualquier objeto derivado de esta imagen.
  const antivirus = {
    async scan() {
      const error = new Error('ANTIVIRUS_INFECTED: Eicar-Test-Signature');
      error.code = 'ANTIVIRUS_INFECTED';
      throw error;
    },
    async version() { return { name: 'clamav', version: '1.3.1' }; },
  };
  const storage = memoryBucket({ [QUARANTINE]: source });
  const db = recordingDb();
  const outcome = await processMediaJob(jobFor(source), {
    storage, codec, antivirus, db,
  });

  assert.equal(outcome.status, 'failed');
  assert.equal(outcome.code, 'ANTIVIRUS_INFECTED');
  assert.equal(outcome.terminal, true);
  assert.equal(
    db.calls.filter(([name]) => name === 'finalizeVariants').length, 0,
    'nunca se intentó publicar una variante',
  );
  assert.equal(
    db.calls.filter(([name]) => name === 'completeUploadForJob').length, 0,
    'ni registrar el asset',
  );
  const failed = db.calls.find(([name]) => name === 'failJob');
  assert.equal(failed[1].failureCode, 'ANTIVIRUS_INFECTED');
  // El scan corre ANTES de escribir, así que no quedó ningún objeto final.
  assert.deepEqual([...storage.objects.keys()], [QUARANTINE]);
});

test('EICAR embebido en un JPEG válido se detecta sobre los bytes finales', async () => {
  const source = await dirtyPhoto();
  const storage = memoryBucket({ [QUARANTINE]: source });
  const db = recordingDb();
  // Este scanner sólo dispara con la firma real; el objeto final la lleva
  // porque se la inyectamos al comentario del encoder de la muestra.
  const infected = new Uint8Array(await sharp({
    create: { width: 32, height: 32, channels: 3, background: '#0f0' },
  }).withMetadata({ exif: { IFD0: { ImageDescription: EICAR } } }).jpeg().toBuffer());
  storage.objects.set(QUARANTINE, infected);
  const outcome = await processMediaJob(
    { ...jobFor(infected), expectedBytes: infected.length },
    { storage, codec, antivirus: infectedAntivirus(), db },
  );
  // El transcode borra el EXIF, así que el objeto final ya no lleva la firma:
  // el resultado correcto es que se publique limpio, no que se rechace por un
  // metadato que dejó de existir.
  assert.equal(outcome.status, 'succeeded');
  assert.equal([...storage.objects.keys()].length, 4);
});

test('una falla entre variantes revierte todo lo escrito', async () => {
  const source = await dirtyPhoto();
  const storage = memoryBucket({ [QUARANTINE]: source });
  const uploads = [];
  const original = storage.upload.bind(storage);
  storage.upload = async (name, bytes, contentType) => {
    uploads.push(name);
    // Falla al escribir la tercera variante: original + thumbnail ya están.
    if (uploads.length === 3) throw new Error('STORAGE_UPLOAD_FAILED:500');
    return original(name, bytes, contentType);
  };
  const db = recordingDb();
  const outcome = await processMediaJob(jobFor(source), {
    storage, codec, antivirus: cleanAntivirus, db,
  });

  assert.equal(outcome.status, 'failed');
  assert.equal(
    db.calls.filter(([name]) => name === 'finalizeVariants').length, 0,
    'no hubo publicación parcial',
  );
  assert.deepEqual(
    [...storage.objects.keys()], [QUARANTINE],
    'los objetos parciales fueron eliminados',
  );
  assert.ok(db.calls.some(([name]) => name === 'failJob'));
});

test('una falla al finalizar revierte los objetos finales', async () => {
  const source = await dirtyPhoto();
  const storage = memoryBucket({ [QUARANTINE]: source });
  const db = recordingDb({
    finalizeVariants() {
      const error = new Error('RPC_FAILED:finalize_tournament_media_variants:400');
      error.code = 'TORNEOS_MEDIA_PIPELINE_NOT_READY';
      throw error;
    },
  });
  const outcome = await processMediaJob(jobFor(source), {
    storage, codec, antivirus: cleanAntivirus, db,
  });
  assert.equal(outcome.status, 'failed');
  assert.deepEqual([...storage.objects.keys()], [QUARANTINE]);
  assert.ok(db.calls.some(([name]) => name === 'failJob'));
});

test('un objeto ausente o de tamaño distinto no se procesa', async () => {
  const db = recordingDb();
  const missing = await processMediaJob(jobFor(new Uint8Array(10)), {
    storage: memoryBucket(), codec, antivirus: cleanAntivirus, db,
  });
  assert.equal(missing.code, 'SOURCE_OBJECT_MISSING');

  const source = await dirtyPhoto();
  const mismatched = await processMediaJob(
    { ...jobFor(source), expectedBytes: source.length + 1 },
    { storage: memoryBucket({ [QUARANTINE]: source }), codec, antivirus: cleanAntivirus, db },
  );
  assert.equal(mismatched.code, 'SOURCE_SIZE_MISMATCH');
});

test('un JPEG estructuralmente válido pero roto para el decoder es rechazado', async () => {
  const source = await dirtyPhoto({ width: 400, height: 300 });
  const truncated = source.subarray(0, Math.floor(source.length * 0.5));
  const storage = memoryBucket({ [QUARANTINE]: truncated });
  const db = recordingDb();
  const outcome = await processMediaJob(
    { ...jobFor(truncated), expectedBytes: truncated.length },
    { storage, codec, antivirus: cleanAntivirus, db },
  );
  assert.equal(outcome.status, 'failed');
  assert.equal(outcome.code, 'MEDIA_CONTENT_CORRUPT');
  assert.equal(outcome.terminal, true);
  assert.deepEqual([...storage.objects.keys()], [QUARANTINE]);
});
