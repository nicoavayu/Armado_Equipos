#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  USERS,
  cleanupMatchOperationsHarness,
  connect,
  seedOperationalMatch,
  setup,
  value,
} from './torneos-match-operations.mjs';
import { installStorageFixture } from './torneos-media-upload-pipeline.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIGRATIONS = [
  '20260802090000_tournament_media_upload_pipeline.sql',
  '20260802120000_tournament_media_trusted_processing.sql',
  '20260809232508_tournament_media_free_mvp.sql',
  '20260810160355_tournament_entitlements_foundation.sql',
  '20260815234340_tournament_media_storage_readiness_and_delete.sql',
  '20260820120000_tournament_media_publication_is_processing_aware.sql',
  '20260821120000_media_restore_respects_closed_galleries.sql',
  '20260831163520_fix_tournament_media_session_reuse.sql',
];

let checks = 0;
let failures = 0;

function check(condition, label, detail = '') {
  checks += 1;
  if (condition) console.log(`  ✔ ${label}`);
  else {
    failures += 1;
    console.error(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function equal(actual, expected, label) {
  check(
    actual === expected,
    label,
    `esperado ${JSON.stringify(expected)}, obtenido ${JSON.stringify(actual)}`,
  );
}

async function createGallery(client, organizationId, tournamentId, suffix) {
  return value(
    client,
    'select public.create_tournament_media_gallery($1,$2,null,null,null,$3,$4,$5,$6)',
    [
      organizationId,
      tournamentId,
      `Galería sesión ${suffix}`,
      'Regresión focal de reutilización de sesiones.',
      'organization',
      `98200000-0000-4000-8000-${suffix.padStart(12, '0')}`,
    ],
  );
}

async function requestUpload(client, galleryId, idempotencyKey, overrides = {}) {
  return value(
    client,
    'select public.request_tournament_media_upload_session($1,$2,$3,$4,$5)',
    [
      galleryId,
      overrides.name || 'fixture.png',
      overrides.mime || 'image/png',
      overrides.size || 7021,
      idempotencyKey,
    ],
  );
}

async function sessionRow(admin, sessionId) {
  return (await admin.query(
    `select id, organization_id, requested_by, status, idempotency_key,
            internal_path, token_hash, expires_at, consumed_at, asset_id
     from public.tournament_media_upload_sessions
     where id = $1`,
    [sessionId],
  )).rows[0];
}

async function authorizeTarget(service, session, actorId) {
  return value(
    service,
    'select public.authorize_tournament_media_upload_target($1,$2,$3)',
    [session.sessionId, session.token, actorId],
  );
}

async function run() {
  console.log('Arma2 Torneos · regresión focal de media session reuse');
  try {
    const admin = await setup([
      '20260726200000_tournament_standings_discipline.sql',
      '20260726230000_tournament_participant_hub.sql',
      '20260727010000_tournament_communications.sql',
      '20260727060000_tournament_media_galleries.sql',
    ]);
    for (const migration of MIGRATIONS) {
      await admin.query(
        fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', migration), 'utf8'),
      );
    }
    const scope = await seedOperationalMatch(admin);
    const owner = scope.owner;
    const organizationAdmin = await connect({
      role: 'authenticated', userId: USERS.admin,
    });
    const service = await connect({ role: 'service_role' });

    await installStorageFixture(admin);
    await admin.query(
      "insert into storage.buckets (id, public) values ('tournament-media', false)",
    );
    await admin.query(
      "update public.tournament_media_pipeline_configuration set mode = 'MVP_SIMPLE'",
    );

    const galleryId = await createGallery(
      owner, scope.organizationId, scope.tournamentId, '1',
    );

    console.log('\n· sesión vigente: misma fila y credencial utilizable');
    const liveKey = '98300000-0000-4000-8000-000000000001';
    const liveFirst = await requestUpload(owner, galleryId, liveKey);
    const liveRetry = await requestUpload(owner, galleryId, liveKey);
    equal(liveRetry.sessionId, liveFirst.sessionId, 'la sesión vigente se reutiliza');
    equal(liveRetry.reused, true, 'la respuesta declara reutilización');
    check(Boolean(liveRetry.token), 'la reutilización devuelve un token no nulo');
    check(liveRetry.token !== liveFirst.token, 'el secreto se rota y no se reexpone');
    equal(
      Number(await value(
        admin,
        `select count(*) from public.tournament_media_upload_sessions
         where organization_id = $1 and requested_by = $2 and idempotency_key = $3`,
        [scope.organizationId, USERS.owner, liveKey],
      )),
      1,
      'la reutilización vigente no duplica filas',
    );
    equal(
      (await authorizeTarget(service, liveRetry, USERS.owner)).sessionId,
      liveRetry.sessionId,
      'el signer acepta la credencial rotada',
    );

    console.log('\n· sesión issued, assetless y vencida: intento nuevo recuperable');
    const expiredKey = '98300000-0000-4000-8000-000000000002';
    const expiredFirst = await requestUpload(owner, galleryId, expiredKey);
    const expiredFirstRow = await sessionRow(admin, expiredFirst.sessionId);
    await admin.query(
      `update public.tournament_media_upload_sessions
       set created_at = now() - interval '10 minutes',
           expires_at = now() - interval '5 minutes'
       where id = $1`,
      [expiredFirst.sessionId],
    );
    const expiredRetry = await requestUpload(owner, galleryId, expiredKey);
    check(expiredRetry.sessionId !== expiredFirst.sessionId,
      'la sesión vencida no se devuelve como reusable');
    equal(expiredRetry.reused, false, 'la recuperación es una emisión nueva');
    check(Boolean(expiredRetry.token), 'la recuperación nunca devuelve token null');
    const expiredOldRow = await sessionRow(admin, expiredFirst.sessionId);
    const expiredNewRow = await sessionRow(admin, expiredRetry.sessionId);
    equal(expiredOldRow.status, 'expired', 'el intento anterior queda vencido');
    equal(expiredOldRow.asset_id, null, 'el intento abandonado sigue assetless');
    equal(expiredNewRow.status, 'issued', 'el intento nuevo queda emitido');
    equal(expiredNewRow.asset_id, null, 'issued assetless sigue siendo un estado válido');
    check(expiredNewRow.internal_path !== expiredFirstRow.internal_path,
      'la recuperación usa un path nuevo y preserva el viejo para cleanup');
    equal(
      Number(await value(
        admin,
        `select count(*) from public.tournament_media_upload_sessions
         where organization_id = $1 and requested_by = $2 and idempotency_key = $3`,
        [scope.organizationId, USERS.owner, expiredKey],
      )),
      2,
      'el historial conserva el intento expirado y el vigente',
    );
    equal(
      (await authorizeTarget(service, expiredRetry, USERS.owner)).sessionId,
      expiredRetry.sessionId,
      'el signer acepta la sesión renovada',
    );

    console.log('\n· path ya escrito: no se reutiliza ni se pierde del cleanup');
    const writtenKey = '98300000-0000-4000-8000-000000000003';
    const writtenFirst = await requestUpload(owner, galleryId, writtenKey);
    const writtenFirstRow = await sessionRow(admin, writtenFirst.sessionId);
    await admin.query(
      "insert into storage.objects (bucket_id, name) values ('tournament-media', $1)",
      [writtenFirstRow.internal_path],
    );
    const writtenRetry = await requestUpload(owner, galleryId, writtenKey);
    check(writtenRetry.sessionId !== writtenFirst.sessionId,
      'una sesión con objeto parcial recibe un intento distinto');
    equal((await sessionRow(admin, writtenFirst.sessionId)).status, 'failed',
      'el intento parcial queda purgable como failed');
    check(Boolean(writtenRetry.token), 'el reemplazo del parcial tiene token válido');
    check((await sessionRow(admin, writtenRetry.sessionId)).internal_path
      !== writtenFirstRow.internal_path, 'el reemplazo no intenta sobrescribir el objeto parcial');

    console.log('\n· aislamiento por actor, organización y clave');
    const isolationKey = '98300000-0000-4000-8000-000000000004';
    const ownerIntent = await requestUpload(owner, galleryId, isolationKey);
    const adminIntent = await requestUpload(organizationAdmin, galleryId, isolationKey);
    check(adminIntent.sessionId !== ownerIntent.sessionId,
      'otro actor nunca reutiliza la sesión del owner');
    equal((await sessionRow(admin, adminIntent.sessionId)).requested_by, USERS.admin,
      'la sesión del segundo actor conserva su ownership');

    const otherOrganization = await value(
      owner,
      'select public.create_tournament_organization($1,$2,$3::uuid)',
      ['Liga Media Reuse', 'liga-media-reuse', '98400000-0000-4000-8000-000000000001'],
    );
    const otherSeason = await value(
      owner,
      'select public.create_tournament_season($1,$2,$3,null,null,$4::uuid)',
      [
        otherOrganization.organization.id,
        'Temporada Media Reuse',
        'temporada-media-reuse',
        '98400000-0000-4000-8000-000000000002',
      ],
    );
    const otherTournament = await value(
      owner,
      `select public.create_tournament_with_defaults(
        $1,$2,'Copa Media Reuse','copa-media-reuse',null,
        'football_5','league','open',null,null,$3::uuid
      )`,
      [
        otherOrganization.organization.id,
        otherSeason.id,
        '98400000-0000-4000-8000-000000000003',
      ],
    );
    const otherGalleryId = await createGallery(
      owner, otherOrganization.organization.id, otherTournament.id, '2',
    );
    const otherOrganizationIntent = await requestUpload(owner, otherGalleryId, isolationKey);
    check(otherOrganizationIntent.sessionId !== ownerIntent.sessionId,
      'otra organización nunca reutiliza la sesión del primer tenant');
    equal(
      (await sessionRow(admin, otherOrganizationIntent.sessionId)).organization_id,
      otherOrganization.organization.id,
      'la nueva sesión queda ligada a la segunda organización',
    );

    const differentKeyIntent = await requestUpload(
      owner, galleryId, '98300000-0000-4000-8000-000000000005',
    );
    check(differentKeyIntent.sessionId !== ownerIntent.sessionId,
      'una idempotency key distinta no reutiliza la anterior');

    console.log(`\n${checks - failures}/${checks} verificaciones de media session reuse aprobadas`);
    if (failures > 0) process.exitCode = 1;
  } finally {
    await cleanupMatchOperationsHarness();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
