#!/usr/bin/env node
//
// Fixture LOCAL idempotente para revisar FREE y PREMIUM con Auth/RLS reales.
// No concede PREMIUM, no inventa compras y no modifica el dataset canónico:
// agrega una organización QA nueva cuyo primer tournament queda FREE por el
// trigger productivo. El ejemplo PREMIUM sigue siendo el torneo preexistente
// de qa-metropolitana, preservado por legacy_grant.

import process from 'node:process';

import pg from 'pg';

import productionGuard from './production-guard.js';
import { stableUuid } from './torneos-demo-dataset.mjs';

const { assertLocalDatabaseTarget, ProductionGuardError } = productionGuard;

const FIXTURE_KEY = 'qa.plans.review.v1';
const FREE_ORGANIZATION_ID = stableUuid(`${FIXTURE_KEY}:organization`);
const FREE_ORGANIZATION_CREATION_KEY = stableUuid(`${FIXTURE_KEY}:organization:create`);
const FREE_MEMBERSHIP_ID = stableUuid(`${FIXTURE_KEY}:membership`);
const FREE_SEASON_ID = stableUuid(`${FIXTURE_KEY}:season`);
const FREE_SEASON_CREATION_KEY = stableUuid(`${FIXTURE_KEY}:season:create`);
const FREE_TOURNAMENT_ID = stableUuid(`${FIXTURE_KEY}:tournament`);
const FREE_TOURNAMENT_CREATION_KEY = stableUuid(`${FIXTURE_KEY}:tournament:create`);
const FREE_ORGANIZATION_SLUG = 'qa-planes-first-free';
const PREMIUM_ORGANIZATION_SLUG = 'qa-metropolitana';
const PREMIUM_TOURNAMENT_NAME = 'Torneo Apertura QA 2026';

async function readFixture(client) {
  const result = await client.query(
    `select
       free_organization.id free_organization_id,
       free_tournament.id free_tournament_id,
       free_grant.plan_code free_plan,
       free_grant.source free_source,
       premium_organization.id premium_organization_id,
       premium_tournament.id premium_tournament_id,
       premium_grant.plan_code premium_plan,
       premium_grant.source premium_source
     from public.tournament_organizations free_organization
     join public.tournaments free_tournament
       on free_tournament.organization_id = free_organization.id
     join public.tournament_plan_grants free_grant
       on free_grant.organization_id = free_organization.id
      and free_grant.tournament_id = free_tournament.id
     cross join public.tournament_organizations premium_organization
     join public.tournaments premium_tournament
       on premium_tournament.organization_id = premium_organization.id
     join public.tournament_plan_grants premium_grant
       on premium_grant.organization_id = premium_organization.id
      and premium_grant.tournament_id = premium_tournament.id
     where free_organization.id = $1
       and free_tournament.id = $2
       and premium_organization.slug = $3
       and premium_tournament.name = $4
       and free_grant.plan_code = 'FREE'
       and free_grant.source = 'first_free'
       and premium_grant.plan_code = 'PREMIUM'
       and premium_grant.source = 'legacy_grant'`,
    [
      FREE_ORGANIZATION_ID,
      FREE_TOURNAMENT_ID,
      PREMIUM_ORGANIZATION_SLUG,
      PREMIUM_TOURNAMENT_NAME,
    ],
  );
  return result.rows[0] || null;
}

async function applyFixture(client) {
  await client.query('begin isolation level serializable');
  try {
    await client.query(
      'select pg_advisory_xact_lock(hashtextextended($1,0))',
      [FIXTURE_KEY],
    );
    const owner = await client.query(
      `select membership.user_id
       from public.tournament_organization_members membership
       join public.tournament_organizations organization
         on organization.id = membership.organization_id
       where organization.slug = $1
         and membership.role = 'owner'
         and membership.status = 'active'`,
      [PREMIUM_ORGANIZATION_SLUG],
    );
    const ownerUserId = owner.rows[0]?.user_id;
    if (!ownerUserId) throw new Error('No se encontró el Owner QA canónico.');

    await client.query(
      `insert into public.tournament_organizations (
         id,name,slug,status,created_by,creation_key
       ) values ($1,'QA Planes · Primer Torneo','qa-planes-first-free','active',$2,$3)
       on conflict (id) do nothing`,
      [FREE_ORGANIZATION_ID, ownerUserId, FREE_ORGANIZATION_CREATION_KEY],
    );
    await client.query(
      `insert into public.tournament_organization_members (
         id,organization_id,user_id,role,status,joined_at
       ) values ($1,$2,$3,'owner','active',now())
       on conflict (organization_id,user_id) do nothing`,
      [FREE_MEMBERSHIP_ID, FREE_ORGANIZATION_ID, ownerUserId],
    );
    await client.query(
      `insert into public.tournament_seasons (
         id,organization_id,name,slug,status,start_date,end_date,created_by,creation_key
       ) values (
         $1,$2,'Temporada Planes QA 2026','temporada-planes-qa-2026','active',
         '2026-01-01','2026-12-31',$3,$4
       ) on conflict (id) do nothing`,
      [FREE_SEASON_ID, FREE_ORGANIZATION_ID, ownerUserId, FREE_SEASON_CREATION_KEY],
    );
    await client.query(
      `insert into public.tournaments (
         id,organization_id,season_id,name,slug,description,status,
         sport_modality,competition_format,gender_category,team_size,
         substitutes_limit,start_date,end_date,created_by,creation_key
       ) values (
         $1,$2,$3,'Primer Torneo Free QA','primer-torneo-free-qa',
         'Fixture LOCAL para revisar el primer torneo gratuito.','draft',
         'football_7','league','open',7,5,'2026-09-01','2026-12-15',$4,$5
       ) on conflict (id) do nothing`,
      [
        FREE_TOURNAMENT_ID,
        FREE_ORGANIZATION_ID,
        FREE_SEASON_ID,
        ownerUserId,
        FREE_TOURNAMENT_CREATION_KEY,
      ],
    );
    await client.query(
      `insert into public.user_tournament_context_preferences (
         user_id,organization_id,active_season_id,active_tournament_id
       ) values ($1,$2,$3,$4)
       on conflict (user_id,organization_id) do update set
         active_season_id = excluded.active_season_id,
         active_tournament_id = excluded.active_tournament_id`,
      [ownerUserId, FREE_ORGANIZATION_ID, FREE_SEASON_ID, FREE_TOURNAMENT_ID],
    );

    const fixture = await readFixture(client);
    if (!fixture) {
      throw new Error('El trigger de primer torneo Free no produjo el contrato esperado.');
    }
    await client.query('commit');
    return fixture;
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const doApply = args.has('--apply-local');
  const doReport = args.has('--report');
  if (args.size > 1 || (!doApply && !doReport && args.size > 0)) {
    throw new Error('Use exactly one of --apply-local or --report.');
  }
  if (!doApply && !doReport) {
    console.log(JSON.stringify({
      status: 'plan',
      writes: false,
      fixtureKey: FIXTURE_KEY,
      freeOrganizationSlug: FREE_ORGANIZATION_SLUG,
      premiumOrganizationSlug: PREMIUM_ORGANIZATION_SLUG,
      apply: 'QA_ALLOW_PLANS_REVIEW_FIXTURE=true node scripts/qa/seed-torneos-plan-review-fixtures.mjs --apply-local',
    }, null, 2));
    return;
  }
  if (doApply && process.env.QA_ALLOW_PLANS_REVIEW_FIXTURE !== 'true') {
    throw new ProductionGuardError('QA_ALLOW_PLANS_REVIEW_FIXTURE=true is required.');
  }
  const target = assertLocalDatabaseTarget(process.env);
  const client = new pg.Client({ connectionString: target.databaseUrl });
  await client.connect();
  try {
    const fixture = doApply ? await applyFixture(client) : await readFixture(client);
    if (!fixture) throw new Error('El fixture de planes no está aplicado.');
    console.log(JSON.stringify({ status: doApply ? 'ready' : 'report', ...fixture }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof ProductionGuardError ? error.message : error);
  process.exitCode = 1;
});
