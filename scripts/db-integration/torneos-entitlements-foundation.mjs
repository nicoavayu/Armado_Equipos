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
const LEGACY_MIGRATION = '20260810160355_tournament_entitlements_foundation.sql';
const MIGRATION = '20260821213918_plans_entitlements_foundation_v2.sql';
const CORE_CAPABILITIES = [
  'sport.teams',
  'sport.rosters',
  'sport.fixture',
  'sport.schedule',
  'sport.matches',
  'sport.match_reports',
  'sport.results',
  'sport.standings',
  'sport.basic_scorers',
  'sport.cards',
  'sport.discipline',
  'sport.sanctions',
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

async function effective(client, organizationId, tournamentId) {
  return value(
    client,
    'select public.get_effective_tournament_entitlements($1,$2)',
    [organizationId, tournamentId],
  );
}

async function createOrganization(client, name, slug, key) {
  return value(
    client,
    'select public.create_tournament_organization($1,$2,$3::uuid)',
    [name, slug, key],
  );
}

async function createSeason(client, organizationId, name, slug, key) {
  return value(
    client,
    'select public.create_tournament_season($1,$2,$3,null,null,$4::uuid)',
    [organizationId, name, slug, key],
  );
}

async function createTournament(client, organizationId, seasonId, name, slug, key) {
  return value(
    client,
    `select public.create_tournament_with_defaults(
      $1,$2,$3,$4,null,'football_7','league','open',null,null,$5::uuid
    )`,
    [organizationId, seasonId, name, slug, key],
  );
}

async function sportingSnapshot(admin, organizationId) {
  return value(
    admin,
    `select jsonb_build_object(
      'tournaments',(select count(*) from public.tournaments where organization_id = $1),
      'fixtures',(select count(*) from public.tournament_fixture_versions where organization_id = $1),
      'matches',(select count(*) from public.tournament_matches where organization_id = $1),
      'results',(select count(*) from public.tournament_match_scores where organization_id = $1),
      'standings',(select count(*) from public.tournament_team_standings where organization_id = $1),
      'scorers',(select count(*) from public.tournament_player_statistics where organization_id = $1),
      'sanctions',(select count(*) from public.tournament_player_suspensions where organization_id = $1),
      'teams',(select count(*) from public.tournament_team_entries where organization_id = $1),
      'rosters',(select count(*) from public.tournament_rosters where organization_id = $1),
      'players',(select count(*) from public.tournament_roster_players where organization_id = $1)
    )`,
    [organizationId],
  );
}

async function run() {
  console.log('Arma2 Torneos · FREE/PREMIUM por edición PostgreSQL/RLS');
  try {
    const admin = await setup([
      '20260726200000_tournament_standings_discipline.sql',
      '20260726230000_tournament_participant_hub.sql',
      '20260727010000_tournament_communications.sql',
      '20260727060000_tournament_media_galleries.sql',
    ]);
    const legacyScope = await seedOperationalMatch(admin);
    const service = await connect({ role: 'service_role' });
    const outsider = await connect({ role: 'authenticated', userId: USERS.outsider });
    const otherOwner = await connect({ role: 'authenticated', userId: USERS.playerAway });
    const anonymous = await connect({ role: 'anon' });

    await admin.query(fs.readFileSync(
      path.join(ROOT, 'supabase', 'migrations', LEGACY_MIGRATION),
      'utf8',
    ));
    await value(
      service,
      `select public.set_tournament_organization_subscription(
        $1,'active',now()-interval '1 day',now()+interval '30 days',null,null,90
      )`,
      [legacyScope.organizationId],
    );
    const legacyOrganizationWithoutTournaments = await createOrganization(
      otherOwner,
      'Liga Legacy Sin Torneos',
      'liga-legacy-sin-torneos',
      '97300000-0000-4000-8000-000000000001',
    );
    const beforeBackfill = await sportingSnapshot(admin, legacyScope.organizationId);

    await admin.query(fs.readFileSync(
      path.join(ROOT, 'supabase', 'migrations', MIGRATION),
      'utf8',
    ));

    const afterBackfill = await sportingSnapshot(admin, legacyScope.organizationId);
    eq(JSON.stringify(afterBackfill), JSON.stringify(beforeBackfill),
      'backfill preserva toda la historia deportiva preexistente');
    eq(Number(await value(admin,
      'select count(*) from public.tournament_plan_grants where source = $1',
      ['legacy_grant'])), 1,
    'cada torneo preexistente recibe un legacy_grant permanente');
    eq(Number(await value(admin,
      'select count(*) from public.tournament_plan_grants where source = $1',
      ['purchase'])), 0,
    'backfill no inventa compras');
    eq(Number(await value(admin,
      'select count(*) from public.tournament_legacy_organization_subscriptions')),
    1, 'la fila temporal anterior se conserva sólo como historial legacy');
    eq((await value(
      otherOwner,
      'select public.get_tournament_creation_eligibility($1)',
      [legacyOrganizationWithoutTournaments.organization.id],
    )).status, 'free_available',
    'organización preexistente sin torneos conserva su primer Free');

    let premium = await effective(
      legacyScope.owner, legacyScope.organizationId, legacyScope.tournamentId,
    );
    eq(premium.plan, 'PREMIUM', 'torneo preexistente resuelve PREMIUM');
    eq(premium.assignmentSource, 'legacy_grant', 'origen legacy queda explícito');
    eq(premium.scope.tournamentId, legacyScope.tournamentId,
      'la licencia se resuelve por edición concreta');
    eq(premium.administration.currentAdministrativeSeatUsage, 2,
      'admin y collaborator cuentan como asientos administrativos');
    eq(premium.administration.administrativeSeatLimit, 10,
      'PREMIUM permite diez colaboradores administrativos además del owner');

    await admin.query(
      "update public.tournaments set status = 'archived', archived_at = now() where id = $1",
      [legacyScope.tournamentId],
    );
    eq((await effective(
      legacyScope.owner, legacyScope.organizationId, legacyScope.tournamentId,
    )).plan, 'PREMIUM', 'PREMIUM no expira por finalizar o archivar la edición');

    const freeOrganization = await createOrganization(
      outsider,
      'Liga First Free QA',
      'liga-first-free-qa',
      '97400000-0000-4000-8000-000000000001',
    );
    const freeOrganizationId = freeOrganization.organization.id;
    eq((await value(
      outsider,
      'select public.get_tournament_creation_eligibility($1)',
      [freeOrganizationId],
    )).status, 'free_available',
    'organización sin torneo puede consumir su Free');

    const freeSeason = await createSeason(
      outsider,
      freeOrganizationId,
      'Temporada First Free',
      'temporada-first-free',
      '97400000-0000-4000-8000-000000000002',
    );
    const freeTournament = await createTournament(
      outsider,
      freeOrganizationId,
      freeSeason.id,
      'Apertura First Free',
      'apertura-first-free',
      '97400000-0000-4000-8000-000000000003',
    );
    let free = await effective(outsider, freeOrganizationId, freeTournament.id);
    eq(free.plan, 'FREE', 'primer torneo nuevo resuelve FREE');
    eq(free.assignmentSource, 'first_free', 'primer torneo registra origen first_free');
    eq(await value(
      outsider,
      'select public.has_organization_consumed_free_tournament($1)',
      [freeOrganizationId],
    ), true, 'consumo del primer Free queda registrado');
    eq((await value(
      outsider,
      'select public.get_tournament_creation_eligibility($1)',
      [freeOrganizationId],
    )).status, 'premium_required',
    'después del primer Free la siguiente edición requiere Premium');

    const secondTournament = await createTournament(
      outsider,
      freeOrganizationId,
      freeSeason.id,
      'Clausura posterior',
      'clausura-posterior',
      '97400000-0000-4000-8000-000000000004',
    );
    let second = await effective(outsider, freeOrganizationId, secondTournament.id);
    eq(second.plan, 'FREE',
      'foundation no bloquea el flujo actual antes de integrar Billing');
    eq(second.assignmentSource, 'unassigned',
      'la edición posterior queda explícitamente sin grant, nunca simula una compra');

    await value(
      service,
      `select public.grant_tournament_premium(
        $1,$2,'legacy_grant','Grant local determinista para verificar PREMIUM'
      )`,
      [freeOrganizationId, freeTournament.id],
    );
    free = await effective(outsider, freeOrganizationId, freeTournament.id);
    second = await effective(outsider, freeOrganizationId, secondTournament.id);
    eq(free.plan, 'PREMIUM', 'un grant confiable actualiza sólo esa edición');
    eq(second.plan, 'FREE', 'nueva edición no hereda PREMIUM');
    eq(second.assignmentSource, 'unassigned',
      'crear/copiar otra edición no transfiere la licencia');

    const independentOrganization = await createOrganization(
      otherOwner,
      'Liga Independiente Free QA',
      'liga-independiente-free-qa',
      '97500000-0000-4000-8000-000000000001',
    );
    eq((await value(
      otherOwner,
      'select public.get_tournament_creation_eligibility($1)',
      [independentOrganization.organization.id],
    )).status, 'free_available',
    'otra organización conserva su propio Free');

    const freeForCapabilities = await effective(
      outsider, freeOrganizationId, secondTournament.id,
    );
    for (const capability of CORE_CAPABILITIES) {
      eq(freeForCapabilities.capabilities[capability], true,
        `${capability} está disponible en FREE`);
      eq(premium.capabilities[capability], true,
        `${capability} está disponible en PREMIUM`);
    }
    for (const capability of [
      'statistics.advanced',
      'branding.advanced',
      'sponsors',
      'social_studio.premium',
      'exports.professional',
    ]) {
      eq(freeForCapabilities.capabilities[capability], false,
        `${capability} no está incluido en FREE`);
      eq(premium.capabilities[capability], true,
        `${capability} está incluido en PREMIUM`);
    }
    eq(freeForCapabilities.capabilities['media.history'], true,
      'FREE conserva la multimedia ya aprobada');
    eq(freeForCapabilities.media.galleryAssetLimit, 100,
      'límite Free de galería está centralizado en 100');
    eq(premium.media.galleryAssetLimit, 10000,
      'PREMIUM usa una cuota amplia y configurable, no ilimitada');
    eq(freeForCapabilities.media.essentialAssetsCountTowardLimit, false,
      'assets esenciales de identidad no consumen cuota de galería');
    eq(freeForCapabilities.administration.administrativeSeatLimit, 1,
      'FREE incluye un colaborador administrativo además del owner');
    eq(freeForCapabilities.administration.ownerCountsTowardLimit, false,
      'owner no cuenta dentro del límite administrativo');

    eq(freeForCapabilities.pricing.currency, 'ARS', 'pricing usa ARS');
    eq(freeForCapabilities.pricing.listPrice, 49900, 'precio de lista es 49.900');
    eq(freeForCapabilities.pricing.launchPrice, 39900, 'precio lanzamiento es 39.900');
    eq(freeForCapabilities.pricing.billingModel, 'one_time', 'cobro es pago único');
    eq(freeForCapabilities.pricing.scope, 'tournament_edition',
      'precio corresponde a una edición');

    await expectError(
      () => legacyScope.owner.query(
        `select public.grant_tournament_premium(
          $1,$2,'legacy_grant','Intento inseguro desde el browser autenticado'
        )`,
        [legacyScope.organizationId, legacyScope.tournamentId],
      ),
      /permission denied/,
      'usuario final no puede autoasignarse PREMIUM',
    );
    await expectError(
      () => legacyScope.owner.query('select * from public.tournament_plan_grants'),
      /permission denied/,
      'owner no lee razones internas ni grants directamente',
    );
    await expectError(
      () => service.query(
        "update public.tournament_plan_grants set reason = 'Cambio no permitido'",
      ),
      /permission denied/,
      'grants permanentes no se actualizan ni reciclan directamente',
    );
    await expectError(
      () => effective(outsider, legacyScope.organizationId, legacyScope.tournamentId),
      /TORNEOS_ENTITLEMENTS_FORBIDDEN/,
      'RLS no filtra información de planes entre organizaciones',
    );
    await expectError(
      () => anonymous.query(
        'select public.get_effective_tournament_entitlements($1,$2)',
        [legacyScope.organizationId, legacyScope.tournamentId],
      ),
      /permission denied/,
      'anon no obtiene la proyección privada del plan',
    );
    await expectError(
      () => service.query(
        `select public.set_tournament_organization_subscription(
          $1,'active',now(),now()+interval '1 day',null,null,90
        )`,
        [legacyScope.organizationId],
      ),
      /permission denied|TORNEOS_LEGACY_SUBSCRIPTION_DISABLED/,
      'la suscripción temporal anterior ya no puede modificar el plan',
    );

    eq(Number(await value(admin,
      `select count(*) from pg_class
       where oid = any($1::regclass[]) and relrowsecurity`, [[
        'public.tournament_plan_catalog',
        'public.tournament_pricing_config',
        'public.tournament_plan_grants',
        'public.tournament_organization_plan_state',
      ]])), 4, 'todas las tablas nuevas tienen RLS');
    eq(Number(await value(admin,
      `select count(*) from information_schema.role_table_grants
       where table_schema = 'public'
         and table_name in (
           'tournament_plan_catalog','tournament_pricing_config',
           'tournament_plan_grants','tournament_organization_plan_state'
         )
         and grantee in ('PUBLIC','anon','authenticated')`)), 0,
    'no hay grants directos a roles del browser');
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
