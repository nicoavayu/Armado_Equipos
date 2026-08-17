#!/usr/bin/env node
//
// PostgreSQL/RLS coverage for the Multimedia Upload pipeline.
//
// `torneos-media-galleries.mjs` already covers the gallery, moderation,
// consent and reporting contracts. This file covers what the pipeline adds:
// how `uploadReady` is derived, how upload targets and reads are authorised,
// how variants are finalised, and how abandoned uploads are swept.
//
// The embedded harness has no Supabase Storage, so the storage schema is
// reconstructed here as a fixture. That is on purpose: it is the only way to
// drive the verifier through every state — bucket absent, bucket public, a
// client write policy appearing, a service policy disappearing — without a
// container and without ever touching a real backend.

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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PIPELINE_MIGRATIONS = [
  '20260802090000_tournament_media_upload_pipeline.sql',
  '20260802120000_tournament_media_trusted_processing.sql',
  '20260809232508_tournament_media_free_mvp.sql',
  '20260810160355_tournament_entitlements_foundation.sql',
  '20260815234340_tournament_media_storage_readiness_and_delete.sql',
];
const SESSION_PATH_RE =
  /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/;

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

/** Mirror of `tournament_media_variant_geometry`, kept independent on purpose. */
function expectedGeometry(kind, width, height) {
  const box = { thumbnail: 320, grid: 800, detail: 1600 }[kind];
  const longest = Math.max(width, height);
  if (longest <= box) return { width, height };
  return {
    width: Math.max(1, Math.floor((width * box) / longest + 0.5)),
    height: Math.max(1, Math.floor((height * box) / longest + 0.5)),
  };
}

// ---------------------------------------------------------------------------
// Storage fixture
// ---------------------------------------------------------------------------

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
  `);
}

async function readiness(admin) {
  return value(admin, 'select public.tournament_media_pipeline_readiness()');
}

export const SIGNER_CAPABILITIES = {
  signedUploadUrls: true, signedReadUrls: true, derivesPathServerSide: true,
};

/**
 * Everything the trusted worker has to prove. `structuralDecode` is gone: it is
 * not a capability name any more, so a container walk can no longer stand in
 * for `pixelDecode`.
 */
export const PROCESSOR_CAPABILITIES = {
  contentSniffing: true, pixelDecode: true, pixelTranscode: true,
  metadataStrippingApplied: true, checksumVerification: true,
  variantGeneration: true, antivirusScanning: true,
  storageReadWrite: true, cleanup: true,
};

/**
 * Builds the envelope `attest_tournament_media_service` accepts: the claimed
 * capabilities, a self-test that names each of them, this backend's own
 * fingerprint and fresh evidence for the codec and the scanner.
 */
export async function buildAttestation(admin, service, capabilities, overrides = {}) {
  const fingerprint = await value(
    admin, 'select public.tournament_media_backend_fingerprint()',
  );
  const now = new Date().toISOString();
  const checks = { ...capabilities, ...(overrides.checks || {}) };
  const evidence = {
    selfTest: { passed: overrides.selfTestPassed !== false, checks },
    backendFingerprint: overrides.backendFingerprint || fingerprint,
    probedAt: overrides.probedAt || now,
  };
  if (service === 'processor') {
    evidence.workerType = overrides.workerType === undefined
      ? 'external_image_worker' : overrides.workerType;
    evidence.codec = overrides.codec === undefined
      ? { name: 'libvips', version: '8.15.3' } : overrides.codec;
    evidence.antivirus = overrides.antivirus === undefined
      ? { name: 'clamav', version: '1.3.1', signaturesAt: now } : overrides.antivirus;
  }
  return { capabilities, evidence };
}

export async function attest(admin, service, capabilities, ttlSeconds = 900, overrides = {}) {
  const envelope = await buildAttestation(admin, service, capabilities, overrides);
  return value(
    admin,
    'select public.attest_tournament_media_service($1,$2,$3::jsonb,$4)',
    [service, '0.2.0', JSON.stringify(envelope), ttlSeconds],
  );
}

// ---------------------------------------------------------------------------

async function createGallery(client, scope, suffix, overrides = {}) {
  return value(
    client,
    'select public.create_tournament_media_gallery($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [
      overrides.organizationId || scope.organizationId,
      overrides.tournamentId || scope.tournamentId,
      overrides.categoryId === undefined ? scope.categoryId : overrides.categoryId,
      null,
      overrides.matchId === undefined ? scope.matchId : overrides.matchId,
      overrides.title || `Galería pipeline ${suffix}`,
      'Fotos verificadas por el pipeline.',
      overrides.visibility || 'tournament_participants',
      `97000000-0000-4000-8000-${suffix.padStart(12, '0')}`,
    ],
  );
}

async function requestUpload(client, galleryId, suffix, overrides = {}) {
  return value(
    client,
    'select public.request_tournament_media_upload_session($1,$2,$3,$4,$5)',
    [
      galleryId,
      overrides.name || 'upload.jpg',
      overrides.mime || 'image/jpeg',
      overrides.size || 2048,
      overrides.idempotencyKey
        || `97100000-0000-4000-8000-${suffix.padStart(12, '0')}`,
    ],
  );
}

async function authorizeTarget(client, session, actorId) {
  return value(
    client,
    'select public.authorize_tournament_media_upload_target($1,$2,$3)',
    [session.sessionId, session.token, actorId],
  );
}

async function completeForActor(client, session, actorId, overrides = {}) {
  return value(
    client,
    `select public.complete_tournament_media_upload_for_actor(
      $1,$2,$3,$4,$5,$6,$7,$8
    )`,
    [
      actorId,
      session.sessionId,
      session.token,
      overrides.mime || 'image/jpeg',
      overrides.size || 2048,
      overrides.width || 4000,
      overrides.height || 3000,
      overrides.checksum || 'a'.repeat(64),
    ],
  );
}

async function completeSimple(client, session, actorId, overrides = {}) {
  return value(
    client,
    `select public.complete_tournament_media_simple_upload(
      $1,$2,$3,$4,$5,$6,$7,$8
    )`,
    [
      actorId,
      session.sessionId,
      session.token,
      overrides.mime || 'image/jpeg',
      overrides.size || 2048,
      overrides.width || 1200,
      overrides.height || 800,
      overrides.checksum || 'e'.repeat(64),
    ],
  );
}

function variantPayload(width, height, overrides = {}) {
  const payload = {};
  for (const kind of ['thumbnail', 'grid', 'detail']) {
    const geometry = expectedGeometry(kind, width, height);
    payload[kind] = {
      detectedMime: 'image/jpeg',
      byteSize: 4096,
      width: geometry.width,
      height: geometry.height,
      checksumSha256: 'b'.repeat(64),
      metadataStripped: true,
      pixelTranscoded: true,
      antivirusClean: true,
      ...(overrides[kind] || {}),
    };
  }
  return payload;
}

async function finalizeVariants(client, assetId, payload) {
  return value(
    client,
    'select public.finalize_tournament_media_variants($1,$2::jsonb)',
    [assetId, JSON.stringify(payload)],
  );
}

async function authorizeRead(client, actorId, assetId, kind) {
  return value(
    client,
    'select public.authorize_tournament_media_read($1,$2,$3)',
    [actorId, assetId, kind],
  );
}

// ---------------------------------------------------------------------------

async function run() {
  console.log('Arma2 Torneos · media upload pipeline PostgreSQL/RLS');
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
    const adminUser = await connect({ role: 'authenticated', userId: USERS.admin });
    const collaborator = await connect({
      role: 'authenticated', userId: USERS.collaborator,
    });
    const playerHome = await connect({ role: 'authenticated', userId: USERS.playerHome });
    const outsider = await connect({ role: 'authenticated', userId: USERS.outsider });
    const anonymous = await connect({ role: 'anon' });
    const service = await connect({ role: 'service_role' });

    // -----------------------------------------------------------------------
    console.log('\n· readiness derivada de capacidades verificables');
    // -----------------------------------------------------------------------
    let state = await readiness(admin);
    eq(state.uploadReady, false, 'sin storage ni servicios la carga está cerrada');
    ok(
      [
        'storage.bucket_absent', 'service.signer_unattested',
        'service.processor_unattested', 'processor.pixel_decode_absent',
        'processor.pixel_transcode_absent', 'processor.metadata_sanitization_absent',
        'processor.antivirus_absent', 'cleanup.unavailable',
      ].every((blocker) => state.blockers.includes(blocker)),
      'cada capacidad ausente se reporta con su propio bloqueo',
      JSON.stringify(state.blockers),
    );
    eq(state.pixelTranscode, false, 'el transcode de píxeles no se declara');
    eq(state.antivirusScanning, false, 'el antivirus no se declara');
    eq(state.pixelDecodeReady, false, 'sin worker no hay decodificación de píxeles');
    eq(state.metadataSanitizationReady, false, 'ni saneamiento de metadata');
    eq(state.cleanupReady, false, 'ni limpieza atestiguada');

    await attest(admin, 'signer', SIGNER_CAPABILITIES);
    await attest(admin, 'processor', PROCESSOR_CAPABILITIES);
    state = await readiness(admin);
    eq(state.uploadReady, false, 'atestiguar servicios no alcanza sin bucket');
    eq(state.signerReady, true, 'el signer queda atestiguado');
    eq(state.processorReady, true, 'el processor queda atestiguado');

    await installStorageFixture(admin);
    state = await readiness(admin);
    eq(state.uploadReady, false, 'el esquema de storage sin bucket sigue cerrado');

    await admin.query(
      "insert into storage.buckets (id, public) values ('tournament-media', false)",
    );
    state = await readiness(admin);
    eq(state.uploadReady, true, 'bucket privado + worker atestiguado abre la carga');
    eq(state.blockers.length, 0, 'no quedan bloqueos');
    eq(state.pixelDecodeReady, true, 'el decode de píxeles queda verificado');
    eq(state.pixelTranscodeReady, true, 'y el transcode también');
    eq(state.metadataSanitizationReady, true, 'y el saneamiento de metadata');
    eq(state.antivirusReady, true, 'y el antivirus');
    eq(state.cleanupReady, true, 'y la limpieza');
    eq(state.pixelTranscode, true, 'la proyección deja de ser una constante');
    eq(state.antivirusScanning, true, 'el antivirus deja de ser una constante');

    await admin.query("update storage.buckets set public = true where id = 'tournament-media'");
    state = await readiness(admin);
    eq(state.uploadReady, false, 'un bucket público cierra la carga');
    ok(state.blockers.includes('storage.bucket_public'), 'y lo dice');
    await admin.query("update storage.buckets set public = false where id = 'tournament-media'");

    await admin.query(`
      create policy tournament_media_client_write on storage.objects
        for insert to authenticated with check (bucket_id = 'tournament-media');
    `);
    state = await readiness(admin);
    eq(state.uploadReady, false, 'una policy de escritura para clientes cierra la carga');
    ok(state.blockers.includes('storage.client_write_open'), 'y lo dice');
    await admin.query('drop policy tournament_media_client_write on storage.objects');

    await admin.query('drop policy tournament_media_service_insert on storage.objects');
    state = await readiness(admin);
    eq(state.uploadReady, false, 'perder una policy de servicio cierra la carga');
    ok(state.blockers.includes('storage.service_policies_absent'), 'y lo dice');
    await admin.query(`
      create policy tournament_media_service_insert on storage.objects
        for insert to service_role with check (bucket_id = 'tournament-media');
    `);

    await admin.query(
      `update public.tournament_media_service_attestations
       set attested_at = now() - interval '2 hours', expires_at = now() - interval '1 hour'
       where service = 'processor'`,
    );
    state = await readiness(admin);
    eq(state.uploadReady, false, 'una atestación vencida cierra la carga sin deploy');
    ok(state.blockers.includes('service.processor_unattested'), 'y lo dice');
    await attest(admin, 'processor', PROCESSOR_CAPABILITIES);

    await expectError(
      () => attest(admin, 'processor', PROCESSOR_CAPABILITIES, 3600),
      /TORNEOS_MEDIA_ATTESTATION_INVALID/,
      'una atestación de processor no puede durar más de 15 minutos',
    );
    await expectError(
      () => attest(admin, 'transcoder', PROCESSOR_CAPABILITIES),
      /TORNEOS_MEDIA_ATTESTATION_INVALID/,
      'sólo signer y processor pueden atestiguar',
    );

    const context = await value(
      owner,
      'select public.get_tournament_media_admin_context($1)',
      [scope.organizationId],
    );
    eq(context.storage.uploadReady, true, 'el contexto refleja la readiness derivada');
    eq(context.storage.certified, true, 'certified deja de ser una constante');
    eq(context.storage.requiresStagingGate, false, 'el gate se apaga con evidencia');

    // -----------------------------------------------------------------------
    console.log('\n· geometría determinística de variantes');
    // -----------------------------------------------------------------------
    const geometryCases = [
      [4000, 3000], [3000, 4000], [1, 1], [320, 320], [321, 240],
      [12000, 3000], [1600, 1600], [1601, 900], [7, 4001],
    ];
    let geometryMatches = 0;
    for (const [width, height] of geometryCases) {
      for (const kind of ['thumbnail', 'grid', 'detail']) {
        const derived = await value(
          admin,
          'select public.tournament_media_variant_geometry($1,$2,$3)',
          [kind, width, height],
        );
        const expected = expectedGeometry(kind, width, height);
        if (derived.width === expected.width && derived.height === expected.height) {
          geometryMatches += 1;
        }
      }
    }
    eq(
      geometryMatches,
      geometryCases.length * 3,
      'PostgreSQL y el contrato compartido derivan la misma geometría',
    );
    const noUpscale = await value(
      admin, 'select public.tournament_media_variant_geometry($1,$2,$3)',
      ['detail', 100, 50],
    );
    ok(
      noUpscale.width === 100 && noUpscale.height === 50,
      'una imagen chica nunca se agranda',
    );

    // -----------------------------------------------------------------------
    console.log('\n· autorización del destino de carga');
    // -----------------------------------------------------------------------
    const galleryId = await createGallery(owner, scope, '1');
    // Assigned while the gallery is still a draft: an assignment cannot be
    // created or revoked once it is published, which is itself the contract.
    await value(owner, 'select public.assign_tournament_media_photographer($1,$2,$3)',
      [galleryId, USERS.collaborator, false]);
    const session = await requestUpload(owner, galleryId, '1');
    eq(session.uploadReady, true, 'la sesión refleja la readiness derivada');
    eq(
      session.requiresStagingStorageSigner, false,
      'y deja de pedir un gate de staging cuando hay evidencia',
    );

    const target = await authorizeTarget(service, session, USERS.owner);
    ok(SESSION_PATH_RE.test(target.objectName), 'el path lo deriva la base', target.objectName);
    eq(target.bucket, 'tournament-media', 'el bucket es el privado del contrato');
    eq(Number(target.expectedBytes), 2048, 'el tamaño esperado viene de la sesión');
    ok(
      target.objectName.startsWith(`${scope.organizationId}/${scope.tournamentId}/${galleryId}/`),
      'el path está anclado al tenant, torneo y galería',
    );
    ok(!target.objectName.includes('..'), 'el path no admite traversal');

    await expectError(
      () => authorizeTarget(service, { ...session, token: 'c'.repeat(64) }, USERS.owner),
      /TORNEOS_MEDIA_UPLOAD_SESSION_INVALID/,
      'un token equivocado no autoriza destino',
    );
    await expectError(
      () => authorizeTarget(service, session, USERS.admin),
      /TORNEOS_MEDIA_UPLOAD_SESSION_INVALID/,
      'otro actor no puede consumir la sesión ajena',
    );
    await expectError(
      () => authorizeTarget(service, session, null),
      /TORNEOS_MEDIA_UPLOAD_SESSION_INVALID/,
      'sin actor no hay destino',
    );
    await expectError(
      () => authorizeTarget(
        service,
        { sessionId: '97900000-0000-4000-8000-000000000099', token: session.token },
        USERS.owner,
      ),
      /TORNEOS_MEDIA_UPLOAD_SESSION_INVALID/,
      'un UUID ajeno no revela nada',
    );
    for (const [label, client] of [
      ['authenticated', owner], ['anon', anonymous], ['colaborador', collaborator],
    ]) {
      await expectError(
        () => authorizeTarget(client, session, USERS.owner),
        /permission denied|no existe la función|does not exist/i,
        `${label} no puede pedir un destino de carga`,
      );
    }

    // -----------------------------------------------------------------------
    console.log('\n· vinculación de actor y verificación server-side');
    // -----------------------------------------------------------------------
    await expectError(
      () => completeForActor(service, session, USERS.admin),
      /TORNEOS_MEDIA_UPLOAD_SESSION_INVALID/,
      'el adaptador no deja completar en nombre de otro',
    );
    await expectError(
      () => completeForActor(service, session, null),
      /TORNEOS_AUTH_REQUIRED/,
      'el adaptador exige un actor',
    );
    await expectError(
      () => completeForActor(owner, session, USERS.owner),
      /permission denied|no existe la función|does not exist/i,
      'un cliente autenticado no puede completar una carga',
    );

    const asset = await completeForActor(service, session, USERS.owner);
    eq(asset.status, 'pending_review', 'el asset entra en revisión, no publicado');
    eq(
      Number(await value(
        admin,
        `select count(*) from public.tournament_media_variants
         where asset_id = $1 and status = 'processing'`,
        [asset.assetId],
      )),
      3,
      'las tres variantes derivadas quedan en procesamiento',
    );
    await expectError(
      () => value(owner, 'select public.transition_tournament_media_asset($1,$2,$3)',
        [asset.assetId, 'approve', null]),
      /TORNEOS_MEDIA_PROCESSING_REQUIRED/,
      'no se aprueba un asset cuyas variantes no existen todavía',
    );
    eq(
      Number(await value(
        admin,
        `select count(*) from public.tournament_media_upload_sessions
         where id = $1 and status = 'consumed'`,
        [session.sessionId],
      )),
      1,
      'la sesión queda consumida',
    );
    await expectError(
      () => authorizeTarget(service, session, USERS.owner),
      /TORNEOS_MEDIA_UPLOAD_SESSION_INVALID/,
      'una sesión consumida no se vuelve a firmar (replay)',
    );

    // -----------------------------------------------------------------------
    console.log('\n· finalización de variantes');
    // -----------------------------------------------------------------------
    await expectError(
      () => finalizeVariants(owner, asset.assetId, variantPayload(4000, 3000)),
      /permission denied|no existe la función|does not exist/i,
      'un cliente autenticado no finaliza variantes',
    );
    await expectError(
      () => finalizeVariants(
        service, asset.assetId,
        variantPayload(4000, 3000, { grid: { width: 799 } }),
      ),
      /TORNEOS_MEDIA_VARIANT_PAYLOAD_INVALID/,
      'una geometría distinta a la derivada se rechaza',
    );
    await expectError(
      () => finalizeVariants(
        service, asset.assetId,
        variantPayload(4000, 3000, { detail: { detectedMime: 'image/png' } }),
      ),
      /TORNEOS_MEDIA_VARIANT_PAYLOAD_INVALID/,
      'una variante con otro MIME que el asset se rechaza',
    );
    await expectError(
      () => finalizeVariants(
        service, asset.assetId,
        variantPayload(4000, 3000, { thumbnail: { metadataStripped: false } }),
      ),
      /TORNEOS_MEDIA_VARIANT_PAYLOAD_INVALID/,
      'una variante sin saneamiento declarado se rechaza',
    );
    await expectError(
      () => finalizeVariants(
        service, asset.assetId,
        variantPayload(4000, 3000, { grid: { checksumSha256: 'no-es-un-hash' } }),
      ),
      /TORNEOS_MEDIA_VARIANT_PAYLOAD_INVALID/,
      'un checksum inválido se rechaza',
    );
    const partial = variantPayload(4000, 3000);
    delete partial.detail;
    await expectError(
      () => finalizeVariants(service, asset.assetId, partial),
      /TORNEOS_MEDIA_VARIANT_PAYLOAD_INVALID/,
      'no se puede finalizar dejando una variante afuera',
    );
    eq(
      Number(await value(
        admin,
        `select count(*) from public.tournament_media_variants
         where asset_id = $1 and status = 'ready'`,
        [asset.assetId],
      )),
      1,
      'ningún rechazo dejó variantes a medio finalizar',
    );

    const finalized = await finalizeVariants(service, asset.assetId, variantPayload(4000, 3000));
    eq(Number(finalized.variantsReady), 4, 'quedan las cuatro variantes listas');
    await expectError(
      () => finalizeVariants(service, asset.assetId, variantPayload(4000, 3000)),
      /TORNEOS_MEDIA_VARIANT_SLOT_INVALID/,
      'finalizar dos veces no reabre una variante lista',
    );
    await value(owner, 'select public.transition_tournament_media_asset($1,$2,$3)',
      [asset.assetId, 'approve', null]);
    eq(
      await value(admin, 'select status from public.tournament_media_assets where id = $1',
        [asset.assetId]),
      'approved',
      'con las cuatro variantes listas la aprobación procede',
    );

    // -----------------------------------------------------------------------
    console.log('\n· autorización de lectura firmada');
    // -----------------------------------------------------------------------
    await expectError(
      () => authorizeRead(owner, USERS.owner, asset.assetId, 'grid'),
      /permission denied|no existe la función|does not exist/i,
      'un cliente autenticado no resuelve paths de lectura',
    );
    const managerRead = await authorizeRead(service, USERS.owner, asset.assetId, 'grid');
    eq(managerRead.audience, 'manager', 'el owner lee como gestor');
    ok(managerRead.objectName.endsWith('-grid.jpg'), 'la variante correcta');
    const originalRead = await authorizeRead(service, USERS.owner, asset.assetId, 'original');
    ok(originalRead.objectName.endsWith('-original.jpg'), 'el gestor puede pedir el original');

    await expectError(
      () => authorizeRead(service, USERS.playerHome, asset.assetId, 'grid'),
      /TORNEOS_MEDIA_FORBIDDEN/,
      'un participante no lee un asset sin publicar',
    );
    await expectError(
      () => authorizeRead(service, USERS.outsider, asset.assetId, 'grid'),
      /TORNEOS_MEDIA_FORBIDDEN/,
      'un outsider nunca lee',
    );
    await expectError(
      () => authorizeRead(service, USERS.owner, asset.assetId, 'source'),
      /TORNEOS_MEDIA_FORBIDDEN/,
      'no existe una variante fuera de la taxonomía',
    );

    // The photographer's own upload, so the "may re-read what I uploaded"
    // branch is exercised against a real assignment rather than a stub.
    const photographerSession = await requestUpload(collaborator, galleryId, 'a');
    const photographerAsset = await completeForActor(
      service, photographerSession, USERS.collaborator, { checksum: 'd'.repeat(64) },
    );
    await finalizeVariants(
      service, photographerAsset.assetId, variantPayload(4000, 3000),
    );
    await value(owner, 'select public.transition_tournament_media_asset($1,$2,$3)',
      [photographerAsset.assetId, 'approve', null]);
    eq(
      (await authorizeRead(service, USERS.collaborator, photographerAsset.assetId, 'original'))
        .audience,
      'manager',
      'un fotógrafo asignado puede releer su propia carga',
    );
    await expectError(
      () => authorizeRead(service, USERS.collaborator, asset.assetId, 'original'),
      /TORNEOS_MEDIA_FORBIDDEN/,
      'pero nunca el original de una carga ajena',
    );
    eq(
      (await authorizeRead(service, USERS.collaborator, asset.assetId, 'grid')).kind,
      'grid',
      'un colaborador read-only sí ve las variantes derivadas',
    );
    await value(owner, 'select public.assign_tournament_media_photographer($1,$2,$3)',
      [galleryId, USERS.collaborator, true]);
    await expectError(
      () => authorizeRead(service, USERS.collaborator, photographerAsset.assetId, 'original'),
      /TORNEOS_MEDIA_FORBIDDEN/,
      'revocar la asignación corta el acceso al original de inmediato',
    );
    await expectError(
      () => requestUpload(collaborator, galleryId, 'b'),
      /TORNEOS_MEDIA_FORBIDDEN/,
      'y también corta nuevas sesiones de carga',
    );

    await value(owner, 'select public.set_tournament_media_cover($1,$2)',
      [galleryId, asset.assetId]);
    await value(owner, 'select public.publish_tournament_media_gallery($1)', [galleryId]);
    const participantRead = await authorizeRead(
      service, USERS.playerHome, asset.assetId, 'grid',
    );
    eq(participantRead.audience, 'participant', 'publicada, el jugador lee la variante');
    await expectError(
      () => authorizeRead(service, USERS.playerHome, asset.assetId, 'original'),
      /TORNEOS_MEDIA_FORBIDDEN/,
      'un participante nunca alcanza el original',
    );
    await expectError(
      () => authorizeRead(service, USERS.outsider, asset.assetId, 'grid'),
      /TORNEOS_MEDIA_FORBIDDEN/,
      'publicar no abre la galería a un outsider',
    );
    eq(
      (await value(
        owner, 'select public.get_published_tournament_media($1,$2,$3,$4,$5)',
        [scope.tournamentId, scope.categoryId, null, 20, 0],
      )).delivery.status,
      'signed_urls',
      'la entrega declara URLs firmadas cuando storage y signer están listos',
    );

    // A revoked consent must close reads even on a published asset.
    const rosterPlayerId = scope.rosterPlayers?.home?.[0]
      || (await value(admin,
        `select id from public.tournament_roster_players
         where team_entry_id = $1 limit 1`, [scope.homeEntryId]));
    await admin.query(
      `insert into public.tournament_media_relations (
        organization_id, tournament_id, asset_id, relation_type, team_entry_id,
        roster_player_id, created_by
      ) values ($1,$2,$3,'player',$4,$5,$6)`,
      [
        scope.organizationId, scope.tournamentId, asset.assetId, scope.homeEntryId,
        rosterPlayerId, USERS.owner,
      ],
    );
    await expectError(
      () => authorizeRead(service, USERS.playerHome, asset.assetId, 'grid'),
      /TORNEOS_MEDIA_FORBIDDEN/,
      'un consentimiento desconocido cierra la lectura (fail-closed)',
    );
    await admin.query(
      'delete from public.tournament_media_relations where asset_id = $1', [asset.assetId],
    );

    // -----------------------------------------------------------------------
    console.log('\n· segundo tenant');
    // -----------------------------------------------------------------------
    const otherOrganization = (await value(
      outsider, 'select public.create_tournament_organization($1,$2,$3::uuid)',
      ['Liga Rival QA', 'liga-rival-qa', '97800000-0000-4000-8000-000000000001'],
    )).organization.id;
    ok(Boolean(otherOrganization), 'el segundo tenant existe');
    await expectError(
      () => value(outsider, 'select public.get_tournament_media_admin_context($1)',
        [scope.organizationId]),
      /TORNEOS_MEDIA_FORBIDDEN/,
      'el segundo tenant no ve el centro multimedia ajeno',
    );
    await expectError(
      () => createGallery(outsider, scope, '9', { organizationId: scope.organizationId }),
      /TORNEOS_/,
      'el segundo tenant no crea galerías ajenas',
    );
    await expectError(
      () => authorizeRead(service, USERS.outsider, asset.assetId, 'grid'),
      /TORNEOS_MEDIA_FORBIDDEN/,
      'el segundo tenant no obtiene lecturas cross-tenant',
    );

    // -----------------------------------------------------------------------
    console.log('\n· sesiones vencidas, canceladas y limpieza');
    // -----------------------------------------------------------------------
    const draftGalleryId = await createGallery(owner, scope, '2', { matchId: null });
    const expiring = await requestUpload(owner, draftGalleryId, '2');
    await admin.query(
      `update public.tournament_media_upload_sessions
       set created_at = now() - interval '20 minutes',
           expires_at = now() - interval '10 minutes'
       where id = $1`,
      [expiring.sessionId],
    );
    await expectError(
      () => authorizeTarget(service, expiring, USERS.owner),
      /TORNEOS_MEDIA_UPLOAD_SESSION_INVALID/,
      'una sesión vencida no se firma',
    );

    const cancelled = await requestUpload(owner, draftGalleryId, '3');
    await value(owner, 'select public.cancel_tournament_media_upload_session($1)',
      [cancelled.sessionId]);
    await expectError(
      () => authorizeTarget(service, cancelled, USERS.owner),
      /TORNEOS_MEDIA_UPLOAD_SESSION_INVALID/,
      'una sesión cancelada no se firma',
    );

    const failing = await requestUpload(owner, draftGalleryId, '4');
    const failed = await value(
      service, 'select public.fail_tournament_media_upload_session($1,$2)',
      [failing.sessionId, 'MEDIA_CONTENT_CORRUPT'],
    );
    eq(failed.status, 'failed', 'el processor puede marcar una sesión fallida');
    ok(SESSION_PATH_RE.test(failed.objectName), 'y devuelve el objeto a purgar');
    eq(
      (await value(service, 'select public.fail_tournament_media_upload_session($1,$2)',
        [failing.sessionId, 'MEDIA_CONTENT_CORRUPT'])).changed,
      false,
      'marcar dos veces es idempotente',
    );
    await expectError(
      () => value(service, 'select public.fail_tournament_media_upload_session($1,$2)',
        [failing.sessionId, 'minusculas']),
      /TORNEOS_MEDIA_FAILURE_CODE_INVALID/,
      'el código de falla está acotado',
    );
    await expectError(
      () => value(owner, 'select public.fail_tournament_media_upload_session($1,$2)',
        [failing.sessionId, 'MEDIA_CONTENT_CORRUPT']),
      /permission denied|no existe la función|does not exist/i,
      'un cliente no marca sesiones fallidas',
    );

    const swept = await value(
      service, 'select public.cleanup_tournament_media_upload_sessions($1)', [200],
    );
    eq(swept.expired.length, 1, 'la limpieza vence exactamente la sesión abandonada');
    eq(
      swept.expired[0].sessionId, expiring.sessionId,
      'y es la que había vencido',
    );
    const purgeableNames = swept.purgeable.map((entry) => entry.objectName);
    ok(
      purgeableNames.includes(failed.objectName),
      'el objeto de una sesión fallida es purgable',
    );
    ok(
      !purgeableNames.some((name) => name === target.objectName),
      'el objeto de una sesión consumida nunca es purgable',
    );
    eq(
      (await value(service, 'select public.cleanup_tournament_media_upload_sessions($1)', [200]))
        .expired.length,
      0,
      'una segunda pasada no vuelve a vencer lo mismo',
    );
    await expectError(
      () => value(owner, 'select public.cleanup_tournament_media_upload_sessions($1)', [200]),
      /permission denied|no existe la función|does not exist/i,
      'un cliente no ejecuta la limpieza',
    );

    const known = await value(
      service, 'select public.tournament_media_known_object_names($1)',
      [scope.organizationId],
    );
    ok(
      known.objectNames.some((name) => name.endsWith('-original.jpg'))
      && known.objectNames.some((name) => name.endsWith('-thumbnail.jpg')),
      'la reconciliación conoce las variantes del tenant',
    );

    // -----------------------------------------------------------------------
    console.log('\n· cuotas y superficie de grants');
    // -----------------------------------------------------------------------
    await expectError(
      () => requestUpload(owner, draftGalleryId, '5', { size: 12582913 }),
      /TORNEOS_MEDIA_FILE_INVALID/,
      'un archivo por encima del máximo no abre sesión',
    );
    await expectError(
      () => requestUpload(owner, draftGalleryId, '6', { name: 'upload.png' }),
      /TORNEOS_MEDIA_FILE_INVALID/,
      'una extensión que no coincide con el MIME no abre sesión',
    );

    const pipelineFunctions = [
      'attest_tournament_media_service',
      'revoke_tournament_media_service_attestation',
      'authorize_tournament_media_upload_target',
      'authorize_tournament_media_read',
      'finalize_tournament_media_variants',
      'fail_tournament_media_upload_session',
      'cleanup_tournament_media_upload_sessions',
      'tournament_media_known_object_names',
      'tournament_media_pipeline_readiness',
      'tournament_media_storage_contract_status',
      'complete_tournament_media_upload_for_actor',
      'tournament_media_current_pipeline_mode',
      'tournament_media_effective_readiness',
      'tournament_media_require_upload_tier',
      'tournament_media_mvp_user_can_upload',
      'complete_tournament_media_simple_upload',
      'begin_tournament_media_asset_delete',
      'complete_tournament_media_asset_delete',
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
           and grantee.rolname in ('anon','authenticated')
           and grant_row.privilege_type = 'EXECUTE'`,
        [pipelineFunctions],
      )),
      0,
      'ninguna función del pipeline se concede a anon o authenticated',
    );
    eq(
      Number(await value(
        admin,
        `select count(*) from pg_proc proc
         join pg_namespace namespace on namespace.oid = proc.pronamespace
         cross join lateral aclexplode(coalesce(proc.proacl, acldefault('f', proc.proowner))) grant_row
         where namespace.nspname = 'public'
           and proc.proname = any($1::text[])
           and grant_row.grantee = 0`,
        [pipelineFunctions],
      )),
      0,
      'ninguna función del pipeline queda concedida a PUBLIC',
    );
    eq(
      Number(await value(
        admin,
        `select count(*) from information_schema.role_table_grants
         where table_schema = 'public'
           and table_name = 'tournament_media_service_attestations'
           and grantee in ('PUBLIC','anon','authenticated')`,
      )),
      0,
      'la tabla de atestaciones no es legible por clientes',
    );
    eq(
      Boolean(await value(
        admin,
        `select relrowsecurity from pg_class
         where oid = 'public.tournament_media_service_attestations'::regclass`,
      )),
      true,
      'la tabla de atestaciones tiene RLS',
    );
    for (const [label, client] of [['authenticated', owner], ['anon', anonymous]]) {
      await expectError(
        () => value(client, 'select count(*) from public.tournament_media_service_attestations'),
        /permission denied/i,
        `${label} no lee las atestaciones`,
      );
    }
    eq(
      Number(await value(
        admin,
        `select count(*) from pg_proc proc
         join pg_namespace namespace on namespace.oid = proc.pronamespace
         where namespace.nspname = 'public'
           and proc.proname in (
             'get_tournament_media_admin_context','get_published_tournament_media'
           )
           and proc.provolatile <> 's'`,
      )),
      0,
      'los getters siguen siendo STABLE y de sólo lectura',
    );
    eq(
      Number(await value(
        admin,
        `select count(*) from pg_proc proc
         join pg_namespace namespace on namespace.oid = proc.pronamespace
         where namespace.nspname = 'public'
           and proc.proname = any($1::text[])
           and not exists (
             select 1 from unnest(coalesce(proc.proconfig, array[]::text[])) setting
             where setting in ('search_path=', 'search_path=""')
           )`,
        [pipelineFunctions],
      )),
      0,
      'todas las funciones del pipeline fijan search_path vacío',
    );

    // -----------------------------------------------------------------------
    console.log('\n· tier gratuito simple (activación local explícita)');
    // -----------------------------------------------------------------------
    const simpleGalleryId = await createGallery(owner, scope, '7', { matchId: null });
    await value(owner, 'select public.assign_tournament_media_photographer($1,$2,$3)',
      [simpleGalleryId, USERS.collaborator, false]);

    await admin.query(
      "update public.tournament_media_pipeline_configuration set mode = 'DISABLED'",
    );
    let simpleCapability = await value(
      owner, 'select public.get_tournament_media_upload_capability($1)',
      [scope.organizationId],
    );
    eq(simpleCapability.uploadReady, false, 'DISABLED cierra la carga');
    eq(simpleCapability.blockers[0], 'pipeline.disabled', 'el cierre es explícito');
    await expectError(
      () => requestUpload(owner, simpleGalleryId, '70'),
      /TORNEOS_MEDIA_PIPELINE_NOT_READY/,
      'DISABLED tampoco permite abrir sesiones',
    );

    await admin.query(
      "update public.tournament_media_pipeline_configuration set mode = 'MVP_SIMPLE'",
    );
    await admin.query(
      "delete from public.tournament_media_service_attestations where service in ('signer','processor')",
    );
    simpleCapability = await value(
      owner, 'select public.get_tournament_media_upload_capability($1)',
      [scope.organizationId],
    );
    eq(simpleCapability.uploadReady, true,
      'MVP_SIMPLE abre sin attestations externas de signer ni processor');
    eq(simpleCapability.signerReady, null,
      'MVP_SIMPLE no presenta una attestation externa del signer como requisito');
    eq(simpleCapability.processorReady, null,
      'MVP_SIMPLE no presenta una attestation externa del processor como requisito');
    eq(simpleCapability.simpleContractReady, true,
      'MVP_SIMPLE verifica sus RPC locales completos');
    eq(simpleCapability.processingTier, 'mvp_simple', 'expone el tier seleccionado');
    eq(Number(simpleCapability.maxFileBytes), 4194304, 'fija salida máxima en 4 MiB');
    eq(Number(simpleCapability.maxSelectedFileBytes), 8388608,
      'expone selección local máxima de 8 MiB');
    eq(Number(simpleCapability.maxEdge), 1600, 'fija lado máximo en 1600');
    eq(Number(simpleCapability.maxPixels), 2560000, 'fija 2,56 MP');
    eq(Number(simpleCapability.maxConcurrentUploads), 2, 'fija concurrencia en dos');
    eq(Number(simpleCapability.signedUrlTtlSeconds), 300, 'fija URL en cinco minutos');
    eq(simpleCapability.pixelTranscode, false, 'no afirma transcode server-side');
    eq(simpleCapability.antivirusScanning, false, 'no afirma antivirus');

    await admin.query(
      "update public.tournament_media_pipeline_configuration set mode = 'PROCESSOR_EXTERNAL'",
    );
    await attest(admin, 'processor', PROCESSOR_CAPABILITIES);
    let externalCapability = await value(
      owner, 'select public.get_tournament_media_upload_capability($1)',
      [scope.organizationId],
    );
    eq(externalCapability.uploadReady, false,
      'PROCESSOR_EXTERNAL cierra si falta la attestation del signer');
    ok(externalCapability.blockers.includes('service.signer_unattested'),
      'PROCESSOR_EXTERNAL reporta signer sin attestation');

    await admin.query(
      "delete from public.tournament_media_service_attestations where service = 'processor'",
    );
    await attest(admin, 'signer', SIGNER_CAPABILITIES);
    externalCapability = await value(
      owner, 'select public.get_tournament_media_upload_capability($1)',
      [scope.organizationId],
    );
    eq(externalCapability.uploadReady, false,
      'PROCESSOR_EXTERNAL cierra si falta la attestation del processor');
    ok(externalCapability.blockers.includes('service.processor_unattested'),
      'PROCESSOR_EXTERNAL reporta processor sin attestation');

    await admin.query(
      "update public.tournament_media_pipeline_configuration set mode = 'MVP_SIMPLE'",
    );
    await admin.query(
      "update storage.buckets set public = true where id = 'tournament-media'",
    );
    simpleCapability = await value(
      owner, 'select public.get_tournament_media_upload_capability($1)',
      [scope.organizationId],
    );
    eq(simpleCapability.uploadReady, false,
      'MVP_SIMPLE cierra con el contrato de Storage inválido');
    ok(simpleCapability.blockers.includes('storage.bucket_public'),
      'MVP_SIMPLE explica que el bucket dejó de ser privado');
    await admin.query(
      "update storage.buckets set public = false where id = 'tournament-media'",
    );

    await admin.query(
      `alter function public.complete_tournament_media_simple_upload(
        uuid,uuid,text,text,bigint,integer,integer,text
      ) rename to complete_tournament_media_simple_upload_contract_test_missing`,
    );
    simpleCapability = await value(
      owner, 'select public.get_tournament_media_upload_capability($1)',
      [scope.organizationId],
    );
    eq(simpleCapability.uploadReady, false,
      'MVP_SIMPLE cierra si falta un RPC del contrato simple');
    ok(simpleCapability.blockers.includes('simple.contract_absent'),
      'MVP_SIMPLE reporta el contrato simple ausente');
    await admin.query(
      `alter function public.complete_tournament_media_simple_upload_contract_test_missing(
        uuid,uuid,text,text,bigint,integer,integer,text
      ) rename to complete_tournament_media_simple_upload`,
    );

    simpleCapability = await value(
      owner, 'select public.get_tournament_media_upload_capability($1)',
      [scope.organizationId],
    );
    eq(simpleCapability.uploadReady, true,
      'MVP_SIMPLE reabre sólo al restaurar Storage y todos sus RPC');
    await expectError(
      () => value(outsider, 'select public.get_tournament_media_upload_capability($1)',
        [scope.organizationId]),
      /TORNEOS_MEDIA_FORBIDDEN/,
      'un tenant ajeno no obtiene la capability',
    );
    await expectError(
      () => value(owner, 'select mode from public.tournament_media_pipeline_configuration'),
      /permission denied/i,
      'el cliente no puede leer la configuración operativa',
    );
    eq(
      await value(admin, 'select public.tournament_media_mvp_user_can_upload($1,$2)',
        [USERS.admin, simpleGalleryId]),
      true,
      'un admin activo puede cargar en el tier simple',
    );
    await expectError(
      () => requestUpload(collaborator, simpleGalleryId, '71'),
      /TORNEOS_MEDIA_FORBIDDEN/,
      'un fotógrafo asignado no carga en MVP_SIMPLE',
    );
    await expectError(
      () => requestUpload(anonymous, simpleGalleryId, '74'),
      /TORNEOS_AUTH_REQUIRED|permission denied/i,
      'anon no abre sesiones simples',
    );
    await expectError(
      () => requestUpload(outsider, simpleGalleryId, '75'),
      /TORNEOS_MEDIA_FORBIDDEN/,
      'un authenticated sin capacidad no abre sesiones simples',
    );
    await expectError(
      () => requestUpload(owner, simpleGalleryId, '72', { size: 4194305 }),
      /TORNEOS_MEDIA_FILE_INVALID/,
      'la salida por encima de 4 MiB no abre sesión simple',
    );

    const simpleSession = await requestUpload(owner, simpleGalleryId, '73');
    eq(simpleSession.processingTier, 'mvp_simple', 'la sesión queda ligada al tier');
    ok(
      new Date(simpleSession.expiresAt).getTime() - Date.now() <= 300000,
      'la sesión no vive más de cinco minutos',
    );
    const simpleTarget = await authorizeTarget(service, simpleSession, USERS.owner);
    eq(simpleTarget.processingTier, 'mvp_simple', 'el destino conserva el tier');
    await expectError(
      () => value(
        service,
        'select public.enqueue_tournament_media_processing_job($1,$2,$3)',
        [simpleSession.sessionId, simpleSession.token, USERS.owner],
      ),
      /TORNEOS_MEDIA_FORBIDDEN/,
      'el tier simple nunca entra a la cola robusta',
    );
    const simpleAsset = await completeSimple(service, simpleSession, USERS.owner);
    eq(simpleAsset.status, 'pending_review', 'la foto simple entra a moderación');
    eq(simpleAsset.processingTier, 'mvp_simple', 'el asset persiste el tier');
    const projectedTiers = await value(
      owner, 'select public.get_tournament_media_asset_processing_tiers($1)',
      [scope.organizationId],
    );
    eq(projectedTiers[simpleAsset.assetId], 'mvp_simple',
      'la UI recibe el tier histórico del asset');
    eq(
      Number(await value(admin,
        'select count(*) from public.tournament_media_variants where asset_id = $1',
        [simpleAsset.assetId])),
      0,
      'una foto simple no duplica objetos como variantes físicas',
    );
    const simpleGrid = await authorizeRead(
      service, USERS.owner, simpleAsset.assetId, 'grid',
    );
    const simpleOriginal = await authorizeRead(
      service, USERS.owner, simpleAsset.assetId, 'original',
    );
    eq(simpleGrid.objectName, simpleTarget.objectName, 'grid resuelve al único objeto');
    eq(simpleOriginal.objectName, simpleTarget.objectName, 'original resuelve al mismo objeto');
    await value(owner, 'select public.transition_tournament_media_asset($1,$2,$3)',
      [simpleAsset.assetId, 'approve', null]);
    eq(
      await value(admin, 'select status from public.tournament_media_assets where id = $1',
        [simpleAsset.assetId]),
      'approved',
      'la moderación simple no exige variantes inexistentes',
    );

    // ---------------------------------------------------------------------
    console.log('\n· borrado definitivo en dos fases');
    // ---------------------------------------------------------------------
    await expectError(
      () => value(owner, 'select public.begin_tournament_media_asset_delete($1,$2)',
        [USERS.owner, simpleAsset.assetId]),
      /permission denied|no existe la función|does not exist/i,
      'ni siquiera el owner ejecuta la frontera reservada al servicio',
    );
    await expectError(
      () => value(service, 'select public.begin_tournament_media_asset_delete($1,$2)',
        [USERS.collaborator, simpleAsset.assetId]),
      /TORNEOS_MEDIA_FORBIDDEN/,
      'un colaborador sin media.revoke no inicia el borrado',
    );
    await expectError(
      () => value(service, 'select public.begin_tournament_media_asset_delete($1,$2)',
        [USERS.outsider, simpleAsset.assetId]),
      /TORNEOS_MEDIA_FORBIDDEN/,
      'un tenant ajeno no puede usar el gateway como oráculo',
    );

    const pendingDelete = await value(
      service,
      'select public.begin_tournament_media_asset_delete($1,$2)',
      [USERS.owner, simpleAsset.assetId],
    );
    eq(pendingDelete.bucket, 'tournament-media', 'el bucket sale sólo de PostgreSQL');
    eq(pendingDelete.objectNames.length, 1, 'MVP_SIMPLE purga un único objeto físico');
    eq(pendingDelete.objectNames[0], simpleTarget.objectName,
      'la ruta devuelta coincide con la ruta canónica emitida por el backend');
    ok(
      pendingDelete.objectNames[0].startsWith(
        `${scope.organizationId}/${scope.tournamentId}/${simpleGalleryId}/`,
      ),
      'la ruta queda acotada al tenant, torneo y galería',
      pendingDelete.objectNames[0],
    );
    eq(
      await value(admin,
        'select storage_state from public.tournament_media_assets where id = $1',
        [simpleAsset.assetId]),
      'retention_marked',
      'fase 1 deja metadata explícitamente pendiente de borrado',
    );
    await expectError(
      () => authorizeRead(service, USERS.owner, simpleAsset.assetId, 'grid'),
      /TORNEOS_MEDIA_FORBIDDEN/,
      'una fila pendiente no emite nuevas lecturas firmadas',
    );
    const retryDelete = await value(
      service,
      'select public.begin_tournament_media_asset_delete($1,$2)',
      [USERS.owner, simpleAsset.assetId],
    );
    eq(retryDelete.objectNames[0], pendingDelete.objectNames[0],
      'reintentar fase 1 es idempotente y conserva el destino');

    await service.query('begin');
    const rolledBackDelete = await value(
      service,
      'select public.complete_tournament_media_asset_delete($1,$2)',
      [USERS.owner, simpleAsset.assetId],
    );
    eq(rolledBackDelete.deleted, true, 'la fase final se ejecuta dentro de la transacción');
    await service.query('rollback');
    eq(
      Number(await value(admin,
        'select count(*) from public.tournament_media_assets where id = $1',
        [simpleAsset.assetId])),
      1,
      'un fallo transaccional conserva la fila pendiente para reintento',
    );

    const deleted = await value(
      service,
      'select public.complete_tournament_media_asset_delete($1,$2)',
      [USERS.owner, simpleAsset.assetId],
    );
    eq(deleted.deleted, true, 'el reintento completa el borrado de metadata');
    eq(
      Number(await value(admin,
        'select count(*) from public.tournament_media_assets where id = $1',
        [simpleAsset.assetId])),
      0,
      'el asset deja de existir',
    );
    eq(
      Number(await value(admin,
        'select count(*) from public.tournament_media_gallery_items where asset_id = $1',
        [simpleAsset.assetId])),
      0,
      'la relación de galería también se elimina',
    );
    eq(
      Number(await value(admin,
        `select count(*) from public.tournament_audit_log
         where action = 'media.asset.deleted' and resource_id = $1`,
        [simpleAsset.assetId])),
      1,
      'queda una auditoría general sin conservar metadata del asset',
    );

    const openSessions = [];
    for (let index = 0; index < 10; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      openSessions.push(await requestUpload(owner, simpleGalleryId, String(100 + index)));
    }
    await expectError(
      () => requestUpload(owner, simpleGalleryId, '110'),
      /TORNEOS_MEDIA_QUOTA_EXCEEDED/,
      'la sesión abierta número once se rechaza',
    );
    await admin.query(
      `update public.tournament_media_upload_sessions
       set status = case when status = 'issued' then 'revoked' else status end,
           created_at = now() - interval '16 minutes',
           expires_at = now() - interval '11 minutes'
       where requested_by = $1`,
      [USERS.owner],
    );
    const recentSessions = [];
    for (let index = 0; index < 30; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      const emitted = await requestUpload(owner, simpleGalleryId, String(200 + index));
      recentSessions.push(emitted.sessionId);
      // eslint-disable-next-line no-await-in-loop
      await value(owner, 'select public.cancel_tournament_media_upload_session($1)',
        [emitted.sessionId]);
    }
    await expectError(
      () => requestUpload(owner, simpleGalleryId, '230'),
      /TORNEOS_MEDIA_MVP_RATE_LIMITED/,
      'la emisión número 31 dentro de 15 minutos se limita',
    );

    await admin.query(
      "update public.tournament_media_pipeline_configuration set mode = 'PROCESSOR_EXTERNAL'",
    );

    console.log(`\n${checks - failures}/${checks} verificaciones del pipeline aprobadas`);
    if (failures > 0) process.exitCode = 1;
  } finally {
    await cleanupMatchOperationsHarness();
  }
}

// Guarded so `torneos-media-failclosed.mjs` can reuse the attestation helpers
// above without running this suite as a side effect of importing them.
if (
  process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
