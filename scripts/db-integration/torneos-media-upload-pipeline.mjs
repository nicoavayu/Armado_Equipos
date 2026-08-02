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
import { fileURLToPath } from 'node:url';

import {
  USERS,
  cleanupMatchOperationsHarness,
  connect,
  seedOperationalMatch,
  setup,
  value,
} from './torneos-match-operations.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PIPELINE_MIGRATION = '20260802090000_tournament_media_upload_pipeline.sql';
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

async function attest(admin, service, capabilities, ttlSeconds = 3600) {
  return value(
    admin,
    'select public.attest_tournament_media_service($1,$2,$3::jsonb,$4)',
    [service, '0.1.0', JSON.stringify(capabilities), ttlSeconds],
  );
}

const SIGNER_CAPABILITIES = {
  signedUploadUrls: true, signedReadUrls: true, derivesPathServerSide: true,
};
const PROCESSOR_CAPABILITIES = {
  contentSniffing: true, structuralDecode: true, metadataStripping: true,
  checksumVerification: true, variantGeneration: true, pixelTranscode: false,
};

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
    await admin.query(
      fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', PIPELINE_MIGRATION), 'utf8'),
    );
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
      state.blockers.includes('storage.bucket_absent')
      && state.blockers.includes('service.signer_unattested')
      && state.blockers.includes('service.processor_unattested'),
      'los tres bloqueos se reportan explícitamente',
      JSON.stringify(state.blockers),
    );
    eq(state.pixelTranscode, false, 'el transcode de píxeles no se declara');
    eq(state.antivirusScanning, false, 'el antivirus no se declara');

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
    eq(state.uploadReady, true, 'bucket privado + servicios atestiguados abre la carga');
    eq(state.blockers.length, 0, 'no quedan bloqueos');

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
      () => attest(admin, 'processor', PROCESSOR_CAPABILITIES, 172800),
      /TORNEOS_MEDIA_ATTESTATION_INVALID/,
      'una atestación no puede durar más de 24 horas',
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

    console.log(`\n${checks - failures}/${checks} verificaciones del pipeline aprobadas`);
    if (failures > 0) process.exitCode = 1;
  } finally {
    await cleanupMatchOperationsHarness();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
