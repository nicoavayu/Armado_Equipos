#!/usr/bin/env node

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
const MIGRATION = '20260810160355_tournament_entitlements_foundation.sql';
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

async function effective(client, organizationId, tournamentId = null) {
  return value(
    client,
    'select public.get_effective_tournament_entitlements($1,$2)',
    [organizationId, tournamentId],
  );
}

async function setSubscription(service, organizationId, status, times = {}) {
  const startsAt = times.startsAt || new Date(Date.now() - 30 * 86400000);
  const periodEnd = times.periodEnd || new Date(Date.now() + 30 * 86400000);
  return value(
    service,
    `select public.set_tournament_organization_subscription(
      $1,$2,$3,$4,$5,$6,$7
    )`,
    [
      organizationId,
      status,
      startsAt,
      periodEnd,
      times.graceUntil || null,
      times.cancelledAt || null,
      times.postExpirationRetentionDays || 90,
    ],
  );
}

async function seedRetentionMedia(admin, scope) {
  const baseRound = (await admin.query(
    `select round_row.*
     from public.tournament_rounds round_row
     join public.tournament_fixture_versions fixture
       on fixture.id = round_row.fixture_version_id
     where round_row.tournament_id = $1
       and fixture.status = 'published'
       and fixture.invalidated_at is null
     order by round_row.round_number
     limit 1`,
    [scope.tournamentId],
  )).rows[0];
  const roundIds = [baseRound.id];
  for (let roundNumber = 2; roundNumber <= 4; roundNumber += 1) {
    // eslint-disable-next-line no-await-in-loop
    roundIds.push(await value(
      admin,
      `insert into public.tournament_rounds (
        organization_id,tournament_id,category_id,fixture_version_id,phase_id,
        group_id,round_number,name,status,sort_order
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,'scheduled',$9) returning id`,
      [
        baseRound.organization_id,
        baseRound.tournament_id,
        baseRound.category_id,
        baseRound.fixture_version_id,
        baseRound.phase_id,
        baseRound.group_id,
        roundNumber,
        `Fecha ${roundNumber}`,
        roundNumber - 1,
      ],
    ));
  }

  const createdDaysAgo = [10, 20, 19, 18];
  const assetIds = [];
  for (let index = 0; index < roundIds.length; index += 1) {
    const galleryId = `97000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
    const assetId = `97100000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
    const fileId = `97200000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
    // eslint-disable-next-line no-await-in-loop
    await admin.query(
      `insert into public.tournament_media_galleries (
        id,organization_id,season_id,tournament_id,category_id,round_id,
        title,status,visibility,created_by,idempotency_key
      ) select $1,$2,tournament.season_id,tournament.id,$3,$4,$5,'draft',
        'tournament_participants',$6,$7
        from public.tournaments tournament where tournament.id = $8`,
      [
        galleryId,
        scope.organizationId,
        scope.categoryId,
        roundIds[index],
        `Galería Fecha ${index + 1}`,
        USERS.owner,
        `97300000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        scope.tournamentId,
      ],
    );
    // eslint-disable-next-line no-await-in-loop
    await admin.query(
      `insert into public.tournament_media_assets (
        id,organization_id,tournament_id,gallery_id,internal_path,safe_name,
        detected_mime,byte_size,width,height,checksum_sha256,status,uploaded_by,
        created_at
      ) values (
        $1,$2,$3,$4,$5,$6,'image/jpeg',2048,1200,675,$7,'pending_review',$8,
        now() - make_interval(days => $9)
      )`,
      [
        assetId,
        scope.organizationId,
        scope.tournamentId,
        galleryId,
        `${scope.organizationId}/${scope.tournamentId}/${galleryId}/${fileId}.jpg`,
        `foto-${String(index + 1).padStart(12, '0')}.jpg`,
        String.fromCharCode(97 + index).repeat(64),
        USERS.owner,
        createdDaysAgo[index],
      ],
    );
    assetIds.push(assetId);
  }
  return { roundIds, assetIds };
}

async function sportingSnapshot(admin, organizationId) {
  return value(
    admin,
    `select jsonb_build_object(
      'tournaments',(select count(*) from public.tournaments where organization_id = $1),
      'fixtures',(select count(*) from public.tournament_fixture_versions where organization_id = $1),
      'rounds',(select count(*) from public.tournament_rounds where organization_id = $1),
      'matches',(select count(*) from public.tournament_matches where organization_id = $1),
      'results',(select count(*) from public.tournament_match_scores where organization_id = $1),
      'standings',(select count(*) from public.tournament_team_standings where organization_id = $1),
      'scorers',(select count(*) from public.tournament_player_statistics where organization_id = $1),
      'sanctions',(select count(*) from public.tournament_player_suspensions where organization_id = $1),
      'teams',(select count(*) from public.tournament_team_entries where organization_id = $1),
      'rosters',(select count(*) from public.tournament_rosters where organization_id = $1),
      'players',(select count(*) from public.tournament_roster_players where organization_id = $1),
      'audit',(select count(*) from public.tournament_audit_log where organization_id = $1)
    )`,
    [organizationId],
  );
}

async function insertUploadSession(admin, scope, galleryId, sequence) {
  const suffix = sequence.toString(16).padStart(12, '0');
  const fileId = `98000000-0000-4000-8000-${suffix}`;
  return admin.query(
    `insert into public.tournament_media_upload_sessions (
      organization_id,tournament_id,gallery_id,requested_by,token_hash,
      internal_path,safe_name,requested_mime,requested_size,idempotency_key,
      quota_snapshot,expires_at
    ) values (
      $1,$2,$3,$4,$5,$6,$7,'image/jpeg',2048,$8,'{}'::jsonb,
      now() + interval '10 minutes'
    )`,
    [
      scope.organizationId,
      scope.tournamentId,
      galleryId,
      USERS.owner,
      sequence.toString(16).padStart(64, '0'),
      `${scope.organizationId}/${scope.tournamentId}/${galleryId}/${fileId}.jpg`,
      `foto-${suffix}.jpg`,
      `98100000-0000-4000-8000-${suffix}`,
    ],
  );
}

async function run() {
  console.log('Arma2 Torneos · FREE/PRO entitlements foundation PostgreSQL/RLS');
  try {
    const admin = await setup([
      '20260726200000_tournament_standings_discipline.sql',
      '20260726230000_tournament_participant_hub.sql',
      '20260727010000_tournament_communications.sql',
      '20260727060000_tournament_media_galleries.sql',
    ]);
    await admin.query(fs.readFileSync(
      path.join(ROOT, 'supabase', 'migrations', MIGRATION),
      'utf8',
    ));
    const scope = await seedOperationalMatch(admin);
    const owner = scope.owner;
    const player = await connect({ role: 'authenticated', userId: USERS.playerHome });
    const outsider = await connect({ role: 'authenticated', userId: USERS.outsider });
    const anonymous = await connect({ role: 'anon' });
    const service = await connect({ role: 'service_role' });

    eq((await effective(owner, scope.organizationId)).plan, 'FREE',
      'organización sin subscription resuelve FREE');
    eq((await effective(owner, scope.organizationId)).media.maxPhotosPerMatchday, 20,
      'FREE expone 20 fotos por fecha');
    eq((await effective(owner, scope.organizationId)).media.retainedMatchdays, 3,
      'FREE conserva tres fechas');
    eq((await effective(owner, scope.organizationId)).media.retentionGraceDays, 7,
      'FREE aplica siete días de gracia');

    await expectError(
      () => owner.query(
        `select public.set_tournament_organization_subscription(
          $1,'active',now(),now()+interval '30 days',null,null,90
        )`,
        [scope.organizationId],
      ),
      /permission denied/,
      'authenticated no puede autoconcederse PRO',
    );
    await expectError(
      () => owner.query('select * from public.tournament_organization_subscriptions'),
      /permission denied/,
      'owner no lee ni manipula directamente el estado de billing',
    );
    await expectError(
      () => anonymous.query(
        'select public.get_effective_tournament_entitlements($1,null)',
        [scope.organizationId],
      ),
      /permission denied/,
      'anon no obtiene entitlements privados',
    );

    await setSubscription(service, scope.organizationId, 'active');
    let entitlements = await effective(owner, scope.organizationId, scope.tournamentId);
    eq(entitlements.plan, 'PRO', 'manual PRO active resuelve PRO');
    eq(entitlements.media.retainedMatchdays, null, 'PRO conserva todas las fechas');
    eq(entitlements.media.postExpirationRetentionDays, 90,
      'PRO expone retención post-vencimiento de 90 días');
    eq(await value(owner,
      'select public.has_tournament_entitlement($1,$2,$3)',
      [scope.organizationId, scope.tournamentId, 'advanced_stats']), true,
    'owner PRO puede usar una capability PRO-only');

    const expiredEnd = new Date(Date.now() - 86400000);
    await setSubscription(service, scope.organizationId, 'expired', {
      startsAt: new Date(Date.now() - 40 * 86400000), periodEnd: expiredEnd,
    });
    eq((await effective(owner, scope.organizationId)).plan, 'FREE',
      'PRO expired resuelve FREE');
    eq(await value(owner,
      'select public.has_tournament_entitlement($1,$2,$3)',
      [scope.organizationId, scope.tournamentId, 'advanced_stats']), false,
    'owner FREE no puede usar una capability PRO-only');

    await setSubscription(service, scope.organizationId, 'cancelled', {
      periodEnd: new Date(Date.now() + 20 * 86400000), cancelledAt: new Date(),
    });
    eq((await effective(owner, scope.organizationId)).plan, 'PRO',
      'cancelled conserva PRO hasta current_period_end');

    const graceEnd = new Date(Date.now() + 5 * 86400000);
    await setSubscription(service, scope.organizationId, 'grace_period', {
      startsAt: new Date(Date.now() - 40 * 86400000),
      periodEnd: new Date(Date.now() - 86400000), graceUntil: graceEnd,
    });
    eq((await effective(owner, scope.organizationId)).plan, 'PRO',
      'grace_period vigente conserva PRO');
    await setSubscription(service, scope.organizationId, 'grace_period', {
      startsAt: new Date(Date.now() - 40 * 86400000),
      periodEnd: new Date(Date.now() - 10 * 86400000),
      graceUntil: new Date(Date.now() - 86400000),
    });
    eq((await effective(owner, scope.organizationId)).plan, 'FREE',
      'grace_period vencido resuelve FREE');

    await setSubscription(service, scope.organizationId, 'past_due');
    eq((await effective(owner, scope.organizationId)).plan, 'FREE',
      'past_due tiene política explícita FREE');
    eq(await value(admin,
      `select public.resolve_tournament_subscription_plan(
        'PRO','future_state',now()-interval '1 day',now()+interval '1 day',
        null,null,now()
      )`), 'FREE', 'estado desconocido falla cerrado a FREE');
    eq(await value(admin,
      `select public.resolve_tournament_subscription_plan(
        'PRO','active',now()+interval '2 days',now()+interval '1 day',
        null,null,now()
      )`), 'FREE', 'datos temporales inconsistentes fallan cerrado a FREE');

    await value(service,
      `select public.set_tournament_entitlement_override(
        $1,null,'advanced_stats',true,null,'Excepción manual aprobada para QA'
      )`, [scope.organizationId]);
    eq(await value(owner,
      'select public.has_tournament_entitlement($1,$2,$3)',
      [scope.organizationId, scope.tournamentId, 'advanced_stats']), true,
    'override organizacional se resuelve server-side');
    await value(service,
      'select public.clear_tournament_entitlement_override($1,null,$2)',
      [scope.organizationId, 'advanced_stats']);

    const otherOrganization = await value(
      outsider,
      'select public.create_tournament_organization($1,$2,$3)',
      ['Liga Ajena QA', 'liga-ajena-qa', '97400000-0000-4000-8000-000000000001'],
    );
    await expectError(
      () => value(service,
        `select public.set_tournament_entitlement_override(
          $1,$2,'advanced_stats',true,null,'Intento de cruce entre tenants'
        )`, [otherOrganization.organization.id, scope.tournamentId]),
      /TORNEOS_ENTITLEMENT_SCOPE_INVALID/,
      'override de torneo no puede escapar del tenant',
    );
    await expectError(
      () => effective(outsider, scope.organizationId, scope.tournamentId),
      /TORNEOS_ENTITLEMENTS_FORBIDDEN/,
      'usuario de otra organización no hereda PRO',
    );

    await setSubscription(service, scope.organizationId, 'active');
    const participantEntitlements = await effective(
      player, scope.organizationId, scope.tournamentId,
    );
    eq(participantEntitlements.plan, 'PRO',
      'jugador FREE hereda el plan del torneo PRO');
    eq(participantEntitlements.capabilities.advanced_stats, true,
      'jugador recibe capability PRO aplicable a participantes');
    eq(participantEntitlements.capabilities['media.upload'], false,
      'jugador no recibe capability reservada a roles organizadores');

    const media = await seedRetentionMedia(admin, scope);
    eq(await value(admin,
      `select public.tournament_media_gallery_sports_round(gallery_id)
       from public.tournament_media_assets where id = $1`, [media.assetIds[0]]),
    media.roundIds[0], 'la fecha se identifica por tournament_rounds canónico');
    eq(Number(await value(service,
      'select count(*) from public.list_tournament_media_retention_candidates($1,$2,now())',
      [scope.organizationId, scope.tournamentId])), 0,
    'ninguna foto PRO es candidata mientras PRO está vigente');

    await setSubscription(service, scope.organizationId, 'expired', {
      startsAt: new Date(Date.now() - 40 * 86400000),
      periodEnd: new Date(Date.now() - 10 * 86400000),
    });
    eq(Number(await value(service,
      'select count(*) from public.list_tournament_media_retention_candidates($1,$2,now())',
      [scope.organizationId, scope.tournamentId])), 0,
    'al vencer PRO comienza protección post-expiration, sin purge inmediato');

    await setSubscription(service, scope.organizationId, 'expired', {
      startsAt: new Date(Date.now() - 140 * 86400000),
      periodEnd: new Date(Date.now() - 100 * 86400000),
    });
    const before = await sportingSnapshot(admin, scope.organizationId);
    const candidates = (await service.query(
      `select * from public.list_tournament_media_retention_candidates($1,$2,now())`,
      [scope.organizationId, scope.tournamentId],
    )).rows;
    const after = await sportingSnapshot(admin, scope.organizationId);
    eq(candidates.length, 1,
      'fecha fuera de últimas tres y con gracia vencida es candidata');
    eq(candidates[0]?.asset_id, media.assetIds[0],
      'la foto tardía de Fecha 1 usa orden deportivo, no created_at');
    eq(candidates.some((row) => row.asset_id === media.assetIds[1]), false,
      'una foto de las últimas tres fechas nunca es candidata');
    eq(JSON.stringify(after), JSON.stringify(before),
      'calcular retención no modifica historia deportiva ni audit trail');
    eq(await value(admin,
      'select storage_state from public.tournament_media_assets where id = $1',
      [media.assetIds[0]]), 'active',
    'la función read-only no marca ni purga el asset lógico');

    const firstGallery = await value(admin,
      'select gallery_id from public.tournament_media_assets where id = $1',
      [media.assetIds[0]]);
    for (let sequence = 1; sequence <= 19; sequence += 1) {
      // One existing asset plus 19 live sessions reaches the FREE limit of 20.
      // eslint-disable-next-line no-await-in-loop
      await insertUploadSession(admin, scope, firstGallery, sequence);
    }
    await expectError(
      () => insertUploadSession(admin, scope, firstGallery, 20),
      /TORNEOS_MEDIA_QUOTA_EXCEEDED/,
      'FREE rechaza el upload 21 de la misma fecha deportiva',
    );

    for (const key of [
      'tournaments','fixtures','rounds','matches','results','standings',
      'scorers','sanctions','teams','rosters','players','audit',
    ]) {
      eq(after[key], before[key], `${key} permanece intacto`);
    }

    eq(Number(await value(admin,
      `select count(*) from pg_class
       where oid = any($1::regclass[]) and relrowsecurity`, [[
        'public.tournament_entitlement_plans',
        'public.tournament_entitlement_capabilities',
        'public.tournament_organization_subscriptions',
        'public.tournament_organization_entitlement_overrides',
        'public.tournament_entitlement_overrides',
      ]])), 5, 'todas las tablas de entitlements tienen RLS');
    eq(Number(await value(admin,
      `select count(*) from information_schema.role_table_grants
       where table_schema = 'public'
         and table_name like 'tournament%entitlement%'
         and grantee in ('PUBLIC','anon','authenticated')`)), 0,
    'cliente no tiene grants directos sobre catálogo u overrides');
  } catch (error) {
    failures += 1;
    console.error(error);
  } finally {
    await cleanupMatchOperationsHarness();
  }
  console.log(`\n${checks - failures}/${checks} verificaciones aprobadas`);
  if (failures) process.exitCode = 1;
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await run();
}
