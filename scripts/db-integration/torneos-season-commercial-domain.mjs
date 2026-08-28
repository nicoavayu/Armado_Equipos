#!/usr/bin/env node

import process from 'node:process';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const DB_URL = process.env.SUPABASE_DB_URL
  || 'postgresql://postgres:postgres@127.0.0.1:57322/postgres';
const OWNER = '9c000000-0000-4000-8000-000000000001';
const MEMBER_A = '9c000000-0000-4000-8000-000000000002';
const MEMBER_B = '9c000000-0000-4000-8000-000000000003';
let checks = 0;

function ok(condition, label) {
  checks += 1;
  if (!condition) throw new Error(`FAIL: ${label}`);
  console.log(`  ✔ ${label}`);
}

async function scalar(client, sql, params = []) {
  const row = (await client.query(sql, params)).rows[0];
  return row ? Object.values(row)[0] : null;
}

async function asRole(client, role, userId, operation) {
  await client.query(`set local role ${role}`);
  await client.query("select set_config('request.jwt.claim.sub',$1,true)", [userId || '']);
  let result;
  try {
    result = await operation();
  } catch (error) {
    // The caller that expected a database error owns the savepoint rollback;
    // issuing RESET while PostgreSQL is aborted would hide the domain error.
    throw error;
  }
  try {
    await client.query('reset role');
    await client.query("select set_config('request.jwt.claim.sub','',true)");
    return result;
  } catch (error) {
    throw error;
  }
}

async function expectError(client, operation, pattern, label) {
  await client.query('savepoint expected_error');
  try {
    await operation();
    throw new Error(`FAIL: ${label} no fue rechazado`);
  } catch (error) {
    await client.query('rollback to savepoint expected_error');
    const message = String(error?.message || error);
    if (!pattern.test(message)) throw new Error(`FAIL: ${label} — ${message}`);
    ok(true, label);
  }
}

async function createSeason(client, organizationId, name, slug) {
  return asRole(client, 'authenticated', OWNER, () => scalar(
    client,
    'select public.create_tournament_season($1,$2,$3,null,null,$4::uuid)',
    [organizationId, name, slug, randomUUID()],
  ));
}

async function createTournament(client, organizationId, seasonId, name, slug) {
  return asRole(client, 'authenticated', OWNER, () => scalar(client, `
    select public.create_tournament_with_defaults(
      $1,$2,$3,$4,null,'football_7','league','open',null,null,$5::uuid
    )
  `, [organizationId, seasonId, name, slug, randomUUID()]));
}

async function entitlements(client, organizationId, seasonId) {
  return asRole(client, 'authenticated', OWNER, () => scalar(
    client,
    'select public.get_effective_tournament_season_entitlements($1,$2)',
    [organizationId, seasonId],
  ));
}

async function run() {
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();
  await client.query('begin');
  try {
    const suffix = Date.now().toString(36);
    await client.query(`
      insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
      values
        ($1,'authenticated','authenticated',$4,'',now(),now(),now()),
        ($2,'authenticated','authenticated',$5,'',now(),now(),now()),
        ($3,'authenticated','authenticated',$6,'',now(),now(),now())
      on conflict (id) do nothing
    `, [OWNER, MEMBER_A, MEMBER_B, `owner-${suffix}@local.test`, `a-${suffix}@local.test`, `b-${suffix}@local.test`]);

    const organization = await asRole(client, 'authenticated', OWNER, () => scalar(
      client,
      'select public.create_tournament_organization($1,$2,$3::uuid)',
      ['EDEBA QA', `edeba-qa-${suffix}`, randomUUID()],
    ));
    const organizationId = organization.organization.id;
    const seasonA = await createSeason(
      client, organizationId, 'Apertura 2027', `apertura-2027-${suffix}`,
    );
    const seasonB = await createSeason(
      client, organizationId, 'Clausura 2027', `clausura-2027-${suffix}`,
    );
    const seasonC = await createSeason(
      client, organizationId, 'Apertura 2028', `apertura-2028-${suffix}`,
    );

    for (const season of [seasonA, seasonB, seasonC]) {
      const policy = await entitlements(client, organizationId, season.id);
      ok(policy.schemaVersion === 4 && policy.plan === 'FREE', 'cada temporada nueva nace FREE');
      ok(policy.assignmentSource === 'default_free', 'FREE no depende de first_free');
      ok(policy.media.galleryAssetLimit === 25, 'FREE informa 25 archivos por temporada');
    }
    const eligibility = await asRole(client, 'authenticated', OWNER, () => scalar(
      client,
      'select public.get_tournament_creation_eligibility($1)',
      [organizationId],
    ));
    ok(eligibility.status === 'free_available', 'crear varias temporadas no consume elegibilidad FREE');

    const apertureNames = ['+35', '+40', 'Liga', 'Copa Argentina', 'Copa de Plata'];
    const apertureTournaments = [];
    for (const [index, name] of apertureNames.entries()) {
      apertureTournaments.push(await createTournament(
        client,
        organizationId,
        seasonA.id,
        name,
        `apertura-${index + 1}-${suffix}`,
      ));
    }
    const [tournamentA1] = apertureTournaments;
    const tournamentB1 = await createTournament(
      client, organizationId, seasonB.id, 'Liga Clausura', `liga-clausura-${suffix}`,
    );

    const purchase = await asRole(client, 'authenticated', OWNER, () => scalar(client, `
      select public.create_fake_tournament_season_purchase(
        $1,$2,'torneos_premium',$3::uuid,'local'
      )
    `, [organizationId, seasonA.id, randomUUID()]));
    ok(purchase.seasonId === seasonA.id && purchase.tournamentId === null,
      'la compra nueva apunta sólo a season_id');
    await asRole(client, 'service_role', null, () => scalar(
      client,
      "select public.apply_fake_tournament_payment_status($1,'approved',null,null,null)",
      [purchase.id],
    ));

    const seasonAPolicy = await entitlements(client, organizationId, seasonA.id);
    const seasonBPolicy = await entitlements(client, organizationId, seasonB.id);
    ok(seasonAPolicy.plan === 'PREMIUM' && seasonAPolicy.media.galleryAssetLimit === 1000,
      'Premium es permanente para la temporada y eleva multimedia a 1.000');
    ok(seasonBPolicy.plan === 'FREE', 'Premium no se hereda a otra temporada');
    for (const tournament of apertureTournaments) {
      const child = await asRole(client, 'authenticated', OWNER, () => scalar(
        client,
        'select public.get_effective_tournament_entitlements($1,$2)',
        [organizationId, tournament.id],
      ));
      ok(child.plan === 'PREMIUM' && child.scope.seasonId === seasonA.id,
        'cada torneo hijo hereda Premium de su temporada');
    }
    const childB = await asRole(client, 'authenticated', OWNER, () => scalar(
      client,
      'select public.get_effective_tournament_entitlements($1,$2)',
      [organizationId, tournamentB1.id],
    ));
    ok(childB.plan === 'FREE', 'un torneo de otra temporada conserva FREE');
    await expectError(client, () => asRole(client, 'authenticated', OWNER, () => scalar(client, `
      select public.create_fake_tournament_season_purchase(
        $1,$2,'torneos_premium',$3::uuid,'local'
      )
    `, [organizationId, seasonA.id, randomUUID()])), /TORNEOS_(SEASON_)?ALREADY_PREMIUM/,
    'no se puede duplicar una compra para una temporada Premium');

    const memberships = await client.query(`
      insert into public.tournament_organization_members(
        organization_id,user_id,role,status,invited_by,joined_at
      ) values
        ($1,$2,'collaborator','active',$4,now()),
        ($1,$3,'admin','active',$4,now())
      returning id,user_id
    `, [organizationId, MEMBER_A, MEMBER_B, OWNER]);
    const membershipA = memberships.rows.find((row) => row.user_id === MEMBER_A).id;
    const membershipB = memberships.rows.find((row) => row.user_id === MEMBER_B).id;
    await asRole(client, 'authenticated', OWNER, () => scalar(
      client,
      'select public.assign_tournament_season_member($1,$2,$3)',
      [organizationId, seasonA.id, membershipA],
    ));
    ok((await asRole(client, 'authenticated', MEMBER_A, () => scalar(client,
      'select count(*)::int from public.tournament_seasons where organization_id=$1',
      [organizationId]))) === 1,
    'colaborador asignado a Apertura no puede ver Clausura');
    await asRole(client, 'authenticated', OWNER, () => scalar(
      client,
      'select public.assign_tournament_season_member($1,$2,$3)',
      [organizationId, seasonB.id, membershipA],
    ));
    await expectError(client, () => asRole(client, 'authenticated', OWNER, () => scalar(
      client,
      'select public.assign_tournament_season_member($1,$2,$3)',
      [organizationId, seasonB.id, membershipB],
    )), /TORNEOS_SEASON_COLLABORATOR_LIMIT/, 'FREE limita a un colaborador por temporada');
    await asRole(client, 'authenticated', OWNER, () => scalar(
      client,
      'select public.assign_tournament_season_member($1,$2,$3)',
      [organizationId, seasonA.id, membershipB],
    ));
    ok((await asRole(client, 'authenticated', MEMBER_A, () => scalar(client,
      'select count(*)::int from public.tournament_seasons where organization_id=$1',
      [organizationId]))) === 2, 'colaborador sólo ve las temporadas asignadas');
    ok((await asRole(client, 'authenticated', OWNER, () => scalar(client,
      'select count(*)::int from public.tournament_seasons where organization_id=$1',
      [organizationId]))) === 3, 'owner ve todas las temporadas sin asignación ni asiento');

    async function galleryFor(tournament, season, name) {
      return scalar(client, `
        insert into public.tournament_media_galleries(
          organization_id,season_id,tournament_id,title,status,visibility,
          created_by,idempotency_key
        ) values ($1,$2,$3,$4,'draft','tournament_participants',$5,$6)
        returning id
      `, [organizationId, season.id, tournament.id, name, OWNER, randomUUID()]);
    }
    async function insertSessions(tournament, galleryId, total, prefix) {
      await client.query(`
        insert into public.tournament_media_upload_sessions(
          organization_id,tournament_id,gallery_id,requested_by,token_hash,
          internal_path,safe_name,requested_mime,requested_size,idempotency_key,
          max_size,quota_snapshot,expires_at,processing_tier
        ) select $1::uuid,$2::uuid,$3::uuid,$4::uuid,repeat(md5($5 || value::text),2),
          $1::text || '/' || $2::text || '/' || $3::text || '/'
            || (md5($5 || value::text)::uuid)::text || '.jpg',
          'foto-' || left(md5($5 || value::text),12) || '.jpg','image/jpeg',1024,
          gen_random_uuid(),4194304,'{}'::jsonb,now()+interval '5 minutes','mvp_simple'
        from generate_series(1,$6) value
      `, [organizationId, tournament.id, galleryId, OWNER, prefix, total]);
    }
    const freeGallery = await galleryFor(tournamentB1, seasonB, `FREE ${suffix}`);
    await insertSessions(tournamentB1, freeGallery, 25, `free-${suffix}`);
    await expectError(client, () => insertSessions(tournamentB1, freeGallery, 1, `free-over-${suffix}`),
      /TORNEOS_(SEASON_)?MEDIA_QUOTA_EXCEEDED/, 'FREE acepta 25 y rechaza el archivo 26');
    const premiumGallery = await galleryFor(tournamentA1, seasonA, `PREMIUM ${suffix}`);
    await insertSessions(tournamentA1, premiumGallery, 1000, `premium-${suffix}`);
    await expectError(client, () => insertSessions(tournamentA1, premiumGallery, 1, `premium-over-${suffix}`),
      /TORNEOS_(SEASON_)?MEDIA_QUOTA_EXCEEDED/, 'Premium acepta 1.000 y rechaza el archivo 1.001');

    const freeExport = await asRole(client, 'authenticated', OWNER, () => scalar(client,
      "select public.authorize_tournament_social_export($1,$2,'next_fixture',true)",
      [organizationId, tournamentB1.id]));
    ok(freeExport.authorized === true, 'FREE exporta Próximo partido Base con branding');
    await expectError(client, () => asRole(client, 'authenticated', OWNER, () => scalar(client,
      "select public.authorize_tournament_social_export($1,$2,'mvp',true)",
      [organizationId, tournamentB1.id])), /TORNEOS_SOCIAL_PREMIUM_REQUIRED/,
    'FREE no exporta familias fuera de las tres Base');
    await expectError(client, () => asRole(client, 'authenticated', OWNER, () => scalar(client,
      "select public.authorize_tournament_social_export($1,$2,'standings',false)",
      [organizationId, tournamentB1.id])), /TORNEOS_BRANDING_PREMIUM_REQUIRED/,
    'FREE no puede retirar el branding Arma2');
    const premiumExport = await asRole(client, 'authenticated', OWNER, () => scalar(client,
      "select public.authorize_tournament_social_export($1,$2,'mvp',false)",
      [organizationId, tournamentA1.id]));
    ok(premiumExport.authorized && premiumExport.includeArma2Branding === false,
      'Premium autoriza las 11 familias y branding OFF');

    ok(Number(await scalar(client, `
      select count(*) from public.tournament_plan_grants old_grant
      join public.tournaments tournament on tournament.id=old_grant.tournament_id
      where public.is_tournament_plan_grant_effective(old_grant.id)
        and old_grant.plan_code='PREMIUM'
        and not exists (
          select 1 from public.tournament_season_plan_grants season_grant
          where season_grant.organization_id=old_grant.organization_id
            and season_grant.season_id=tournament.season_id
            and public.is_tournament_season_plan_grant_effective(season_grant.id)
        )
    `)) === 0, 'todo Premium histórico válido promovió su temporada sin borrar auditoría');
    ok(Number(await scalar(client,
      'select count(*) from public.tournament_purchases where season_id is null')) === 0,
    'todas las compras históricas conservadas tienen season_id backfilleado');

    console.log(`\n${checks} verificaciones OK (transacción revertida).`);
  } finally {
    await client.query('rollback');
    await client.end();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
