#!/usr/bin/env node
//
// Arma2 Torneos · Multimedia · el contrato fail-closed.
//
// `torneos-media-upload-pipeline.mjs` cubre el camino feliz del pipeline. Este
// archivo cubre exclusivamente lo que NO tiene que poder pasar, y cada bloque
// corresponde a un hallazgo confirmado contra la revisión anterior del PR:
//
//   * `uploadReady` podía ser true con `pixelTranscode:false` y
//     `antivirusScanning:false`;
//   * `attest_tournament_media_service` aceptaba cualquier objeto jsonb, así
//     que una llamada manual con `pixelTranscode:true` alcanzaba;
//   * `request_tournament_media_upload_session` insertaba fila, reservaba
//     cuota, emitía token, derivaba path y escribía auditoría con
//     `uploadReady:false`.
//
// Todo corre sobre el harness embebido: nunca toca Staging ni Production.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  USERS,
  cleanupMatchOperationsHarness,
  connect,
  seedOperationalMatch,
  setup,
  value,
} from './torneos-match-operations.mjs';
import {
  PROCESSOR_CAPABILITIES,
  SIGNER_CAPABILITIES,
  attest,
  buildAttestation,
} from './torneos-media-upload-pipeline.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PIPELINE_MIGRATIONS = [
  '20260802090000_tournament_media_upload_pipeline.sql',
  '20260802120000_tournament_media_trusted_processing.sql',
];

let checks = 0;
let failures = 0;

function ok(condition, label, detail = '') {
  checks += 1;
  if (condition) console.log(`  ✔ ${label}`);
  else {
    failures += 1;
    console.error(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function eq(actual, expected, label) {
  ok(
    actual === expected,
    label,
    `esperado ${JSON.stringify(expected)}, obtenido ${JSON.stringify(actual)}`,
  );
}

async function expectError(action, pattern, label) {
  try {
    await action();
    ok(false, label, 'la operación no fue rechazada');
  } catch (error) {
    const message = String(error?.message || error);
    ok(pattern.test(message), label, message);
  }
}

const SERVICE_POLICIES = `
  create policy tournament_media_service_read on storage.objects
    for select to service_role using (bucket_id = 'tournament-media');
  create policy tournament_media_service_insert on storage.objects
    for insert to service_role with check (bucket_id = 'tournament-media');
  create policy tournament_media_service_update on storage.objects
    for update to service_role using (false) with check (false);
  create policy tournament_media_service_delete on storage.objects
    for delete to service_role using (false);
`;

async function installStorageFixture(admin) {
  await admin.query(`
    create schema if not exists storage;
    create table storage.buckets (
      id text primary key,
      public boolean not null default false
    );
    create table storage.objects (
      id uuid primary key default gen_random_uuid(),
      bucket_id text not null references storage.buckets(id),
      name text not null
    );
    alter table storage.objects enable row level security;
    ${SERVICE_POLICIES}
    insert into storage.buckets (id, public) values ('tournament-media', false);
  `);
}

const readiness = (admin) => value(admin, 'select public.tournament_media_pipeline_readiness()');

const rejection = (admin, service, envelope, ttl = 900) => value(
  admin,
  'select public.tournament_media_attestation_rejection($1,$2::jsonb,$3)',
  [service, JSON.stringify(envelope), ttl],
);

/** Cantidad de filas y de auditoría que un rechazo no debe mover. */
async function ledger(admin) {
  return value(admin, `select jsonb_build_object(
    'sessions',(select count(*) from public.tournament_media_upload_sessions),
    'jobs',(select count(*) from public.tournament_media_processing_jobs),
    'assets',(select count(*) from public.tournament_media_assets),
    'variants',(select count(*) from public.tournament_media_variants),
    'reservedBytes',(select coalesce(sum(requested_size),0)
      from public.tournament_media_upload_sessions where status = 'issued'),
    'issuedAudit',(select count(*) from public.tournament_audit_log
      where action = 'media.upload_session.issued'),
    'anyAudit',(select count(*) from public.tournament_audit_log
      where action like 'media.%'))`);
}

let gallerySuffix = 100;
async function createGallery(client, scope) {
  gallerySuffix += 1;
  return value(
    client,
    'select public.create_tournament_media_gallery($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [
      scope.organizationId, scope.tournamentId, scope.categoryId, null, scope.matchId,
      `Galería fail-closed ${gallerySuffix}`, 'Fotos.', 'tournament_participants',
      `96000000-0000-4000-8000-${String(gallerySuffix).padStart(12, '0')}`,
    ],
  );
}

let uploadSuffix = 200;
async function requestUpload(client, galleryId, overrides = {}) {
  uploadSuffix += 1;
  return value(
    client,
    'select public.request_tournament_media_upload_session($1,$2,$3,$4,$5)',
    [
      galleryId,
      overrides.name || 'upload.jpg',
      overrides.mime || 'image/jpeg',
      overrides.size || 2048,
      overrides.idempotencyKey
        || `96100000-0000-4000-8000-${String(uploadSuffix).padStart(12, '0')}`,
    ],
  );
}

async function openPipeline(admin) {
  await attest(admin, 'signer', SIGNER_CAPABILITIES);
  await attest(admin, 'processor', PROCESSOR_CAPABILITIES);
}

async function run() {
  console.log('Arma2 Torneos · media · contrato fail-closed');
  try {
    const admin = await setup([
      '20260726200000_tournament_standings_discipline.sql',
      '20260726230000_tournament_participant_hub.sql',
      '20260727010000_tournament_communications.sql',
      '20260727060000_tournament_media_galleries.sql',
    ]);
    for (const migration of PIPELINE_MIGRATIONS) {
      await admin.query(
        fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', migration), 'utf8'),
      );
    }
    const scope = await seedOperationalMatch(admin);
    const owner = scope.owner;
    const service = await connect({ role: 'service_role' });
    const authenticated = await connect({ role: 'authenticated', userId: USERS.admin });
    const anonymous = await connect({ role: 'anon' });
    await installStorageFixture(admin);
    const galleryId = await createGallery(owner, scope);

    // -----------------------------------------------------------------------
    console.log('\n· 1-3. una capacidad ausente cierra la carga y no emite sesión');
    // -----------------------------------------------------------------------
    const missingCases = [
      ['pixelDecode', 'processor.pixel_decode_absent', 'pixelDecodeReady'],
      ['pixelTranscode', 'processor.pixel_transcode_absent', 'pixelTranscodeReady'],
      ['metadataStrippingApplied', 'processor.metadata_sanitization_absent', 'metadataSanitizationReady'],
      ['antivirusScanning', 'processor.antivirus_absent', 'antivirusReady'],
      ['cleanup', 'cleanup.unavailable', 'cleanupReady'],
      ['contentSniffing', 'service.processor_unattested', 'processorReady'],
      ['storageReadWrite', 'service.processor_unattested', 'processorReady'],
    ];
    for (const [capability, blocker, readyKey] of missingCases) {
      const partial = { ...PROCESSOR_CAPABILITIES };
      delete partial[capability];
      await attest(admin, 'signer', SIGNER_CAPABILITIES);
      await attest(admin, 'processor', partial);
      const state = await readiness(admin);
      eq(state.uploadReady, false, `sin ${capability} la carga queda cerrada`);
      eq(state[readyKey], false, `y ${readyKey} lo dice`);
      ok(state.blockers.includes(blocker), `y aparece el bloqueo ${blocker}`,
        JSON.stringify(state.blockers));

      const before = await ledger(admin);
      await expectError(
        () => requestUpload(owner, galleryId),
        /TORNEOS_MEDIA_PIPELINE_NOT_READY/,
        `y no se emite ninguna sesión sin ${capability}`,
      );
      const after = await ledger(admin);
      eq(after.sessions, before.sessions, `cero filas nuevas sin ${capability}`);
      eq(after.issuedAudit, before.issuedAudit, `auditoría intacta sin ${capability}`);
      eq(
        Number(after.reservedBytes), Number(before.reservedBytes),
        `cuota intacta sin ${capability}`,
      );
    }

    // -----------------------------------------------------------------------
    console.log('\n· 4. una atestación falsa no alcanza');
    // -----------------------------------------------------------------------
    const fingerprint = await value(
      admin, 'select public.tournament_media_backend_fingerprint()',
    );
    ok(/^[0-9a-f]{64}$/.test(fingerprint), 'el backend tiene fingerprint estable');
    ok(
      !String(fingerprint).includes('postgres'),
      'y no publica ningún identificador sensible',
    );

    // La llamada manual del enunciado: capacidades a mano, sin self-test.
    const handWritten = { capabilities: { pixelTranscode: true }, evidence: {} };
    ok(
      String(await rejection(admin, 'processor', handWritten)).length > 0,
      'una llamada manual con pixelTranscode:true es rechazada',
    );
    await expectError(
      () => value(
        admin, 'select public.attest_tournament_media_service($1,$2,$3::jsonb,$4)',
        ['processor', '0.2.0', JSON.stringify(handWritten), 900],
      ),
      /TORNEOS_MEDIA_ATTESTATION_INVALID/,
      'y no se persiste',
    );

    const falseCases = [
      ['capability_not_allowlisted', { workerType: 'external_image_worker' },
        { ...PROCESSOR_CAPABILITIES, superPowers: true }],
      ['self_test_missing_check', { checks: { pixelTranscode: false } }, null],
      ['self_test_absent', { selfTestPassed: false }, null],
      ['backend_fingerprint_mismatch', { backendFingerprint: 'f'.repeat(64) }, null],
      ['probe_stale', { probedAt: new Date(Date.now() - 3600_000).toISOString() }, null],
      ['worker_type_not_allowlisted', { workerType: 'edge_runtime' }, null],
      ['codec_evidence_absent', { codec: {} }, null],
      ['antivirus_evidence_absent', { antivirus: { name: 'clamav' } }, null],
      ['antivirus_signatures_stale',
        { antivirus: { name: 'clamav', version: '1.3.1', signaturesAt: '2020-01-01T00:00:00Z' } },
        null],
    ];
    for (const [expected, overrides, capabilities] of falseCases) {
      const envelope = await buildAttestation(
        admin, 'processor', capabilities || PROCESSOR_CAPABILITIES, overrides,
      );
      const reason = String(await rejection(admin, 'processor', envelope) || '');
      ok(reason.startsWith(expected), `atestación rechazada: ${expected}`, reason);
      await expectError(
        () => value(
          admin, 'select public.attest_tournament_media_service($1,$2,$3::jsonb,$4)',
          ['processor', '0.2.0', JSON.stringify(envelope), 900],
        ),
        /TORNEOS_MEDIA_ATTESTATION_INVALID/,
        `y ${expected} nunca se persiste`,
      );
    }
    const persisted = await value(
      admin,
      `select coalesce(capabilities->'capabilities','{}'::jsonb)
       from public.tournament_media_service_attestations where service = 'processor'`,
    );
    eq(
      persisted.superPowers, undefined,
      'ninguna capacidad inventada quedó guardada',
    );

    // -----------------------------------------------------------------------
    console.log('\n· 5. el processor estructural anterior no alcanza');
    // -----------------------------------------------------------------------
    const legacyFlat = {
      contentSniffing: true, structuralDecode: true, metadataStripping: true,
      checksumVerification: true, variantGeneration: true, pixelTranscode: false,
    };
    ok(
      String(await rejection(admin, 'processor', legacyFlat)) === 'envelope_unknown_key',
      'la atestación plana anterior no tiene forma válida',
    );
    const legacyEnvelope = await buildAttestation(admin, 'processor', {
      contentSniffing: true, structuralDecode: true, checksumVerification: true,
      variantGeneration: true, storageReadWrite: true, cleanup: true,
    });
    ok(
      String(await rejection(admin, 'processor', legacyEnvelope))
        === 'capability_not_allowlisted:structuralDecode',
      'structuralDecode no es un nombre de capacidad y no sustituye a pixelDecode',
    );
    // Y aunque el processor estructural declarara sólo lo que sí puede probar,
    // los cuatro portones avanzados siguen cerrados.
    await attest(admin, 'processor', {
      contentSniffing: true, checksumVerification: true,
      variantGeneration: true, storageReadWrite: true,
    });
    let state = await readiness(admin);
    eq(state.processorReady, true, 'el tier básico sí queda atestiguado');
    eq(state.uploadReady, false, 'pero no abre la carga por sí solo');
    ok(
      ['processor.pixel_decode_absent', 'processor.pixel_transcode_absent',
        'processor.metadata_sanitization_absent', 'processor.antivirus_absent',
        'cleanup.unavailable'].every((blocker) => state.blockers.includes(blocker)),
      'y los cinco bloqueos avanzados siguen presentes',
      JSON.stringify(state.blockers),
    );

    // -----------------------------------------------------------------------
    console.log('\n· 6. un rechazo no mueve una sola fila');
    // -----------------------------------------------------------------------
    await openPipeline(admin);
    const warm = await requestUpload(owner, galleryId);
    ok(Boolean(warm.token), 'con el pipeline certificado sí se emite una sesión');
    const baseline = await ledger(admin);
    await value(admin, `delete from public.tournament_media_service_attestations
                        where service = 'processor'`);
    const attempts = 5;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      await expectError(
        () => requestUpload(owner, galleryId),
        /TORNEOS_MEDIA_PIPELINE_NOT_READY/,
        `intento ${attempt + 1} rechazado con un error estable`,
      );
    }
    const afterAttempts = await ledger(admin);
    eq(afterAttempts.sessions, baseline.sessions, 'cero sesiones nuevas');
    eq(afterAttempts.jobs, baseline.jobs, 'cero jobs nuevos');
    eq(afterAttempts.assets, baseline.assets, 'cero assets nuevos');
    eq(
      Number(afterAttempts.reservedBytes), Number(baseline.reservedBytes),
      'la cuota reservada queda idéntica',
    );
    eq(afterAttempts.anyAudit, baseline.anyAudit, 'la auditoría queda idéntica');

    // El mensaje no revela configuración interna.
    let leaked = '';
    try {
      await requestUpload(owner, galleryId);
    } catch (error) {
      leaked = String(error?.message || error);
    }
    ok(
      /TORNEOS_MEDIA_PIPELINE_NOT_READY/.test(leaked)
      && !/bucket|policy|attest|signer|processor|clamav|libvips|tournament-media/i.test(leaked),
      'el error es estable y no filtra configuración',
      leaked,
    );

    // -----------------------------------------------------------------------
    console.log('\n· 12-13. revocación y expiración cortan la emisión al instante');
    // -----------------------------------------------------------------------
    await openPipeline(admin);
    eq((await readiness(admin)).uploadReady, true, 'la carga vuelve a abrirse');
    await value(admin, "select public.revoke_tournament_media_service_attestation('processor')");
    eq((await readiness(admin)).uploadReady, false, 'revocar cierra sin deploy');
    await expectError(
      () => requestUpload(owner, galleryId),
      /TORNEOS_MEDIA_PIPELINE_NOT_READY/,
      'y la emisión se corta en el mismo instante',
    );

    await openPipeline(admin);
    await admin.query(
      `update public.tournament_media_service_attestations
       set attested_at = now() - interval '2 hours', expires_at = now() - interval '1 second'
       where service = 'processor'`,
    );
    eq((await readiness(admin)).uploadReady, false, 'una atestación vencida cierra igual');
    await expectError(
      () => requestUpload(owner, galleryId),
      /TORNEOS_MEDIA_PIPELINE_NOT_READY/,
      'y tampoco emite sesión',
    );

    // -----------------------------------------------------------------------
    console.log('\n· una caída después de emitir corta firma, cola y finalización');
    // -----------------------------------------------------------------------
    await openPipeline(admin);
    const live = await requestUpload(owner, galleryId);
    await value(admin, "select public.revoke_tournament_media_service_attestation('processor')");
    await expectError(
      () => value(
        service, 'select public.authorize_tournament_media_upload_target($1,$2,$3)',
        [live.sessionId, live.token, USERS.owner],
      ),
      /TORNEOS_MEDIA_PIPELINE_NOT_READY/,
      'el signer deja de firmar una sesión ya emitida',
    );
    await expectError(
      () => value(
        service, 'select public.enqueue_tournament_media_processing_job($1,$2,$3)',
        [live.sessionId, live.token, USERS.owner],
      ),
      /TORNEOS_MEDIA_PIPELINE_NOT_READY/,
      'y no se encola ningún trabajo',
    );
    await expectError(
      () => value(
        service,
        `select public.complete_tournament_media_upload_for_actor(
          $1,$2,$3,$4,$5,$6,$7,$8)`,
        [USERS.owner, live.sessionId, live.token, 'image/jpeg', 2048, 4000, 3000,
          'a'.repeat(64)],
      ),
      /TORNEOS_MEDIA_PIPELINE_NOT_READY/,
      'y el processor no puede completar',
    );
    const strandedBefore = await ledger(admin);
    eq(strandedBefore.jobs, 0, 'no quedó ningún job huérfano');

    // La sesión abandonada vence y su objeto queda purgable.
    await admin.query(
      `update public.tournament_media_upload_sessions
       set created_at = now() - interval '20 minutes',
           expires_at = now() - interval '10 minutes'
       where id = $1`,
      [live.sessionId],
    );
    const swept = await value(
      service, 'select public.cleanup_tournament_media_upload_sessions($1)', [50],
    );
    ok(
      swept.expired.some((entry) => entry.sessionId === live.sessionId),
      'la sesión abandonada vence sola',
    );
    ok(
      swept.purgeable.some((entry) => entry.objectName.endsWith('.jpg')),
      'y su objeto queda listo para limpieza',
    );
    eq(
      Number(await value(admin, `select count(*) from public.tournament_media_variants
                                 where status = 'ready'`)),
      0,
      'nunca se publicó nada de esa sesión',
    );

    // -----------------------------------------------------------------------
    console.log('\n· 7 y 11. finalizar exige evidencia del worker y es todo o nada');
    // -----------------------------------------------------------------------
    await openPipeline(admin);
    const good = await requestUpload(owner, galleryId);
    const queued = await value(
      service, 'select public.enqueue_tournament_media_processing_job($1,$2,$3)',
      [good.sessionId, good.token, USERS.owner],
    );
    ok(Boolean(queued.jobId), 'el orquestador encola el trabajo');
    eq(queued.created, true, 'la primera vez lo crea');
    const again = await value(
      service, 'select public.enqueue_tournament_media_processing_job($1,$2,$3)',
      [good.sessionId, good.token, USERS.owner],
    );
    eq(again.created, false, 'y es idempotente');
    eq(again.jobId, queued.jobId, 'sobre el mismo job');

    const leased = await value(
      service, 'select public.lease_tournament_media_processing_jobs($1,$2,$3)',
      ['media-worker-test', 300, 5],
    );
    eq(leased.jobs.length, 1, 'el worker toma exactamente un trabajo');
    const lease = leased.jobs[0];
    ok(/^[0-9a-f]{64}$/.test(lease.leaseToken), 'con un lease token propio');
    ok(
      /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/
        .test(lease.objectName),
      'que apunta a la zona de cuarentena y no a una variante',
      lease.objectName,
    );
    const emptyLease = await value(
      service, 'select public.lease_tournament_media_processing_jobs($1,$2,$3)',
      ['media-worker-otro', 300, 5],
    );
    eq(emptyLease.jobs.length, 0, 'y otro worker no lo toma dos veces');

    await expectError(
      () => value(
        service, `select public.complete_tournament_media_upload_for_job(
          $1,$2,$3,$4,$5,$6,$7)`,
        [lease.jobId, 'e'.repeat(64), 'image/jpeg', 2048, 4000, 3000, 'a'.repeat(64)],
      ),
      /TORNEOS_MEDIA_JOB_LEASE_INVALID/,
      'un lease token equivocado no completa nada',
    );

    // Un original re-encodeado casi nunca pesa lo que pesaba la subida (acá la
    // sesión reservó 2048). Si la completación exigiera que coincidieran, un
    // saneamiento real jamás se podría publicar, así que el worker completa con
    // el tamaño que midió y no con el que se reservó.
    const asset = await value(
      service,
      `select public.complete_tournament_media_upload_for_job($1,$2,$3,$4,$5,$6,$7)`,
      [lease.jobId, lease.leaseToken, 'image/jpeg', 7331, 4000, 3000, 'a'.repeat(64)],
    );
    ok(Boolean(asset.assetId), 'el worker registra el asset con lo que él midió');
    eq(
      Number(await value(
        admin, 'select byte_size from public.tournament_media_assets where id = $1',
        [asset.assetId],
      )),
      7331,
      'y el asset guarda el tamaño del original re-encodeado, no el de la subida',
    );
    // El token del navegador dejó de servir en cuanto el worker tomó el trabajo.
    await expectError(
      () => value(
        service, 'select public.authorize_tournament_media_upload_target($1,$2,$3)',
        [good.sessionId, good.token, USERS.owner],
      ),
      /TORNEOS_MEDIA_UPLOAD_SESSION_INVALID/,
      'y el token original del navegador queda inservible',
    );

    const geometry = (kind) => {
      const box = { thumbnail: 320, grid: 800, detail: 1600 }[kind];
      const longest = 4000;
      return {
        width: Math.max(1, Math.floor((4000 * box) / longest + 0.5)),
        height: Math.max(1, Math.floor((3000 * box) / longest + 0.5)),
      };
    };
    const workerPayload = (overrides = {}) => {
      const payload = {};
      for (const kind of ['thumbnail', 'grid', 'detail']) {
        payload[kind] = {
          detectedMime: 'image/jpeg',
          byteSize: 4096,
          ...geometry(kind),
          checksumSha256: 'b'.repeat(64),
          metadataStripped: true,
          pixelTranscoded: true,
          antivirusClean: true,
          ...(overrides[kind] || {}),
        };
      }
      return payload;
    };

    const readyCount = async () => Number(await value(
      admin,
      `select count(*) from public.tournament_media_variants
       where asset_id = $1 and status = 'ready'`,
      [asset.assetId],
    ));
    eq(await readyCount(), 1, 'sólo el original queda listo antes de finalizar');

    await expectError(
      () => value(
        service, 'select public.finalize_tournament_media_variants($1,$2::jsonb)',
        [asset.assetId, JSON.stringify(workerPayload({ grid: { pixelTranscoded: false } }))],
      ),
      /TORNEOS_MEDIA_VARIANT_PAYLOAD_INVALID/,
      'una variante sin transcode real no se finaliza',
    );
    eq(await readyCount(), 1, 'y no dejó publicación parcial');
    await expectError(
      () => value(
        service, 'select public.finalize_tournament_media_variants($1,$2::jsonb)',
        [asset.assetId, JSON.stringify(workerPayload({ detail: { antivirusClean: false } }))],
      ),
      /TORNEOS_MEDIA_VARIANT_PAYLOAD_INVALID/,
      'una variante sin scan limpio tampoco',
    );
    eq(await readyCount(), 1, 'sigue sin haber publicación parcial');
    await expectError(
      () => value(
        service, 'select public.finalize_tournament_media_variants($1,$2::jsonb)',
        [asset.assetId, JSON.stringify(workerPayload({ thumbnail: { width: 999 } }))],
      ),
      /TORNEOS_MEDIA_VARIANT_PAYLOAD_INVALID/,
      'una geometría inventada tampoco',
    );
    eq(await readyCount(), 1, 'el rollback lógico es total');

    const finalized = await value(
      service, 'select public.finalize_tournament_media_variants($1,$2::jsonb)',
      [asset.assetId, JSON.stringify(workerPayload())],
    );
    eq(Number(finalized.variantsReady), 4, 'con evidencia completa se publican las cuatro');

    const completed = await value(
      service, 'select public.complete_tournament_media_processing_job($1,$2,$3)',
      [lease.jobId, lease.leaseToken, asset.assetId],
    );
    eq(completed.status, 'succeeded', 'y recién ahí el job cierra bien');

    // -----------------------------------------------------------------------
    console.log('\n· 10. el objeto en cuarentena nunca es publicable');
    // -----------------------------------------------------------------------
    const paths = await value(
      admin,
      `select jsonb_build_object(
        'quarantine',(select quarantine_path from public.tournament_media_processing_jobs
                      where id = $1),
        'assetPath',(select internal_path from public.tournament_media_assets where id = $2),
        'variantPaths',(select jsonb_agg(internal_path)
                        from public.tournament_media_variants where asset_id = $2))`,
      [lease.jobId, asset.assetId],
    );
    ok(
      paths.variantPaths.every((variantPath) => variantPath !== paths.quarantine),
      'ninguna variante apunta al objeto bruto',
      JSON.stringify(paths),
    );
    ok(
      paths.variantPaths.every(
        (variantPath) => /-(thumbnail|grid|detail|original)\.(jpg|png|webp)$/.test(variantPath),
      ),
      'todas las variantes usan un nombre derivado',
    );
    await expectError(
      () => admin.query(
        `insert into public.tournament_media_variants
           (organization_id,tournament_id,asset_id,kind,internal_path,detected_mime,status)
         values ($1,$2,$3,'original',$4,'image/jpeg','processing')`,
        [scope.organizationId, scope.tournamentId, asset.assetId, paths.quarantine],
      ),
      /tournament_media_variants_path_check/,
      'la base rechaza estructuralmente publicar el objeto bruto',
    );

    // -----------------------------------------------------------------------
    // Re-basear el tamaño no es barra libre: sigue acotado por el tope de la
    // sesión, y un worker que reporte cualquier cosa no publica nada.
    const boundGallery = await createGallery(owner, scope);
    const boundSession = await requestUpload(owner, boundGallery);
    await value(
      service, 'select public.enqueue_tournament_media_processing_job($1,$2,$3)',
      [boundSession.sessionId, boundSession.token, USERS.owner],
    );
    const boundLease = await value(
      service, 'select public.lease_tournament_media_processing_jobs($1,$2,$3)',
      ['media-worker-bound', 300, 1],
    );
    await expectError(
      () => value(
        service, `select public.complete_tournament_media_upload_for_job(
          $1,$2,$3,$4,$5,$6,$7)`,
        [
          boundLease.jobs[0].jobId, boundLease.jobs[0].leaseToken,
          'image/jpeg', 12582913, 4000, 3000, 'a'.repeat(64),
        ],
      ),
      /TORNEOS_MEDIA_FILE_INVALID/,
      'un tamaño por encima del tope de la sesión se rechaza',
    );
    eq(
      Number(await value(
        admin,
        `select count(*) from public.tournament_media_assets where gallery_id = $1`,
        [boundGallery],
      )),
      0,
      'y no deja ningún asset',
    );

    console.log('\n· reintento, abandono y limpieza de trabajos');
    // -----------------------------------------------------------------------
    const retryGallery = await createGallery(owner, scope);
    const retrySession = await requestUpload(owner, retryGallery);
    const retryJob = await value(
      service, 'select public.enqueue_tournament_media_processing_job($1,$2,$3)',
      [retrySession.sessionId, retrySession.token, USERS.owner],
    );
    let attemptsUsed = 0;
    let lastStatus = '';
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const batch = await value(
        service, 'select public.lease_tournament_media_processing_jobs($1,$2,$3)',
        ['media-worker-test', 60, 5],
      );
      if (batch.jobs.length === 0) break;
      attemptsUsed += 1;
      const failed = await value(
        service, 'select public.fail_tournament_media_processing_job($1,$2,$3)',
        [batch.jobs[0].jobId, batch.jobs[0].leaseToken, 'MEDIA_CONTENT_CORRUPT'],
      );
      lastStatus = failed.status;
    }
    eq(attemptsUsed, 3, 'el job reintenta hasta agotar sus intentos');
    eq(lastStatus, 'abandoned', 'y después queda abandonado');
    const jobState = await value(
      admin,
      `select jsonb_build_object(
        'jobStatus',(select status from public.tournament_media_processing_jobs where id = $1),
        'sessionStatus',(select status from public.tournament_media_upload_sessions where id = $2))`,
      [retryJob.jobId, retrySession.sessionId],
    );
    eq(jobState.sessionStatus, 'failed', 'abandonar el job cierra la sesión');
    const jobSweep = await value(
      service, 'select public.cleanup_tournament_media_processing_jobs($1)', [50],
    );
    ok(
      jobSweep.purgeable.some((entry) => entry.objectName.endsWith('.jpg')),
      'y entrega el objeto en cuarentena para purgar',
    );
    eq(
      Number(await value(
        admin,
        `select count(*) from public.tournament_media_variants
         where asset_id in (select id from public.tournament_media_assets
                            where gallery_id = $1)`,
        [retryGallery],
      )),
      0,
      'un job abandonado no deja ninguna variante',
    );

    // Lease vencido vuelve a la cola.
    const requeueGallery = await createGallery(owner, scope);
    const requeueSession = await requestUpload(owner, requeueGallery);
    await value(
      service, 'select public.enqueue_tournament_media_processing_job($1,$2,$3)',
      [requeueSession.sessionId, requeueSession.token, USERS.owner],
    );
    const requeueLease = await value(
      service, 'select public.lease_tournament_media_processing_jobs($1,$2,$3)',
      ['media-worker-test', 30, 1],
    );
    await admin.query(
      `update public.tournament_media_processing_jobs
       set lease_expires_at = now() - interval '1 minute'
       where id = $1`,
      [requeueLease.jobs[0].jobId],
    );
    const requeued = await value(
      service, 'select public.cleanup_tournament_media_processing_jobs($1)', [50],
    );
    ok(
      requeued.requeued.some((entry) => entry.jobId === requeueLease.jobs[0].jobId),
      'un lease vencido vuelve a la cola',
    );
    await expectError(
      () => value(
        service, 'select public.complete_tournament_media_processing_job($1,$2,$3)',
        [requeueLease.jobs[0].jobId, requeueLease.jobs[0].leaseToken, asset.assetId],
      ),
      /TORNEOS_MEDIA_JOB_LEASE_INVALID/,
      'y el worker que lo perdió ya no puede cerrarlo',
    );

    // -----------------------------------------------------------------------
    console.log('\n· superficie: nada nuevo para clientes');
    // -----------------------------------------------------------------------
    const newFunctions = [
      'tournament_media_backend_fingerprint',
      'tournament_media_capability_allowlist',
      'tournament_media_worker_type_allowlist',
      'tournament_media_attestation_rejection',
      'tournament_media_require_pipeline_ready',
      'enqueue_tournament_media_processing_job',
      'lease_tournament_media_processing_jobs',
      'complete_tournament_media_processing_job',
      'fail_tournament_media_processing_job',
      'cleanup_tournament_media_processing_jobs',
      'complete_tournament_media_upload_for_job',
    ];
    eq(
      Number(await value(
        admin,
        `select count(*)
         from pg_proc proc
         join pg_namespace namespace on namespace.oid = proc.pronamespace
         cross join lateral aclexplode(coalesce(proc.proacl, acldefault('f', proc.proowner))) grant_row
         join pg_roles grantee on grantee.oid = grant_row.grantee
         where namespace.nspname = 'public'
           and proc.proname = any($1::text[])
           and grantee.rolname in ('anon','authenticated','public')
           and grant_row.privilege_type = 'EXECUTE'`,
        [newFunctions],
      )),
      0,
      'ninguna función nueva se concede a anon, authenticated o PUBLIC',
    );
    eq(
      Number(await value(
        admin,
        `select count(*) from pg_proc proc
         join pg_namespace namespace on namespace.oid = proc.pronamespace
         where namespace.nspname = 'public' and proc.proname = any($1::text[])
           and not exists (
             select 1 from unnest(coalesce(proc.proconfig, array[]::text[])) setting
             where setting in ('search_path=', 'search_path=""')
           )`,
        [newFunctions],
      )),
      0,
      'todas fijan search_path vacío',
    );
    for (const [client, label] of [[authenticated, 'authenticated'], [anonymous, 'anon']]) {
      await expectError(
        () => value(client, 'select count(*) from public.tournament_media_processing_jobs'),
        /permission denied|no existe|does not exist/i,
        `${label} no lee la cola de procesamiento`,
      );
      await expectError(
        () => value(client, 'select public.tournament_media_backend_fingerprint()'),
        /permission denied|no existe|does not exist/i,
        `${label} no lee el fingerprint del backend`,
      );
    }
    eq(
      Boolean(await value(
        admin,
        `select relrowsecurity from pg_class
         where oid = 'public.tournament_media_processing_jobs'::regclass`,
      )),
      true,
      'la cola de procesamiento tiene RLS',
    );

    console.log(`\n${checks - failures}/${checks} verificaciones fail-closed aprobadas`);
    if (failures > 0) process.exitCode = 1;
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await cleanupMatchOperationsHarness();
  }
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await run();
}
