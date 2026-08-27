#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const contractsPath = path.join(
  root,
  'supabase/migrations/20260727215106_canonical_core_rls_contracts.sql',
);

const CRITICAL = [
  'public.claim_push_delivery_batch(integer,text,integer,integer)',
  'public.claim_targeted_push_delivery_batch(uuid[],integer,text,integer,integer)',
  'public.run_push_sender_scheduler_tick(text,integer,integer,integer)',
];

const HIGH = [
  'public.cancel_partido_with_notification(bigint,text)',
  'public.cleanup_invalid_device_tokens(integer,integer)',
  'public.cleanup_voting_access_state(bigint)',
  'public.enqueue_auto_match_notification(bigint,text,text,text,uuid[],text,jsonb)',
  'public.enqueue_match_participant_notification(bigint,text,text,text,jsonb,uuid,boolean)',
  'public.enqueue_partido_notification(bigint,text,text,text,jsonb)',
  'public.finalize_push_delivery_attempt(uuid,text,text,text,timestamp with time zone,text,jsonb)',
  'public.mark_match_assumed_not_played(bigint,text)',
  'public.prepare_challenge_team_squad(uuid,boolean)',
  'public.prepare_pending_challenge_partido_for_post_match(bigint,timestamp with time zone,timestamp with time zone)',
  'public.purge_old_notification_delivery_logs(integer,integer,boolean)',
  'public.purge_old_notifications(integer,integer,boolean)',
  'public.send_match_kicked_notification(uuid,bigint,text,uuid,timestamp with time zone)',
  'public.sync_team_match_to_partido(uuid)',
];

const MEDIUM = [
  'public._notify_goalkeepers_for_match(bigint,uuid,integer)',
  'public.auto_match_scheduled_sweep()',
  'public.backfill_auto_match_proposal_members(bigint)',
  'public.expire_stale_auto_match_invites()',
  'public.expire_stale_auto_match_proposals()',
  'public.expire_stale_directed_challenges()',
  'public.invite_auto_match_substitutes(bigint,integer,boolean)',
  'public.process_auto_match_member_exit(bigint)',
  'public.process_challenge_result_survey_notifications_backend(integer)',
  'public.process_match_reminder_notifications_backend(integer,integer)',
  'public.process_survey_start_notifications_backend(integer,integer)',
  'public.prune_ineligible_auto_match_members()',
  'public.reconcile_auto_match_proposal_members(bigint)',
  'public.reopen_auto_match_vacancies()',
  'public.resolve_auto_match_full_cupo(bigint)',
  'public.spawn_next_auto_match_cohort(bigint)',
  'public.accept_invite_for_user(text,uuid)',
];

const AUTO_MATCH_SERVICE_ROLE = [
  'public.auto_match_account_is_eligible(uuid)',
  'public.auto_match_availabilities_are_compatible(bigint,bigint)',
  'public.auto_match_availability_fits_proposal(bigint,bigint)',
  'public.auto_match_availability_has_free_slot(bigint,bigint)',
  'public.auto_match_availability_is_eligible(bigint)',
  'public.auto_match_distance_km(double precision,double precision,double precision,double precision)',
  'public.auto_match_duration(text)',
  'public.auto_match_has_valid_coordinates(double precision,double precision)',
  'public.auto_match_member_has_free_slot(bigint,uuid)',
  'public.auto_match_member_snapshot_fits_proposal(bigint,uuid)',
  'public.auto_match_member_snapshot_is_valid_for_proposal(bigint,uuid)',
  'public.auto_match_member_snapshots_are_compatible(bigint,uuid,uuid)',
  'public.auto_match_play_range(timestamp with time zone,text)',
  'public.auto_match_snapshots_are_compatible(double precision,double precision,integer,double precision,double precision,integer)',
  'public.auto_match_user_real_match_conflict(uuid,timestamp with time zone,text,bigint)',
  'public.auto_match_window_has_free_slot(uuid,timestamp with time zone,text,smallint[],time without time zone,time without time zone,text,boolean,bigint)',
  'public.capture_auto_match_member_snapshot()',
  'public.enforce_auto_match_member_eligibility()',
  'public.prevent_auto_match_member_snapshot_update()',
  'public.sync_active_auto_match_gestations()',
  'public.user_declined_auto_match_slot(uuid,text,timestamp with time zone)',
  'public.user_has_overlapping_auto_match(uuid,timestamp with time zone,bigint)',
];

const ANON_ALLOWLIST = [
  'public.get_public_tournament_commercial_catalog(integer)',
  'public.get_public_tournament_branding(text)',
  'public.get_public_tournament_page(text,text)',
  'public.get_invite_landing(text)',
  'public.get_partido_by_invite(bigint,text)',
  'public.get_published_tournament_documents(uuid,uuid)',
  'public.get_published_tournament_matches(uuid,uuid,text,uuid,integer,integer)',
  'public.get_published_tournament_media(uuid,uuid,uuid,integer,integer)',
  'public.get_published_tournament_standings(uuid,uuid,uuid,uuid)',
  'public.get_published_tournament_statistics(uuid,uuid,uuid,uuid)',
  'public.get_published_tournament_teams(uuid,uuid,integer,integer)',
  'public.get_tournament_announcement(uuid)',
  'public.get_tournament_participant_hub(uuid,uuid)',
  'public.get_tournament_participant_match(uuid)',
  'public.is_public_voting_open(bigint)',
  'public.public_has_voter_already_voted(bigint,text,text)',
  'public.public_mark_voter_completed(bigint,text,text)',
  'public.public_submit_no_lo_conozco(bigint,text,text,bigint)',
  'public.public_submit_player_rating(bigint,text,text,bigint,integer)',
  'public.resolve_match_by_code(text)',
  'public.validate_guest_match_invite(bigint,text,text)',
];

// Functions created after the canonical contracts migration cannot be listed
// inside its chronological DO block: resolving their regprocedure there would
// fail before the later feature migration has created them. Keep each later
// authenticated surface explicit here so the catalog remains fail-closed.
const POST_CANONICAL_AUTHENTICATED_ALLOWLIST = [
  ['public.is_tournament_branding_path(text,text)', 'rls_helper_required'],
  ['public.can_update_tournament_team_branding(uuid,uuid)', 'rls_helper_required'],
  ['public.can_write_tournament_branding_object(text)', 'rls_helper_required'],
  ['public.set_tournament_branding_reference(uuid,text,uuid,text)', 'frontend_legitimate'],
  ['public.get_tournament_branding_context(uuid,uuid)', 'frontend_legitimate'],
  ['public.get_public_tournament_branding(text)', 'frontend_legitimate'],
  ['public.can_manage_tournament_player_portrait(uuid,uuid)', 'rls_helper_required'],
  ['public.can_read_tournament_player_portrait(uuid,uuid)', 'rls_helper_required'],
  ['public.get_tournament_player_portrait_ref(uuid,uuid,text)', 'frontend_legitimate'],
  [
    'public.set_tournament_player_portrait_editorial_status(uuid,uuid,text)',
    'frontend_legitimate',
  ],
  [
    'public.revoke_tournament_player_portrait_publication(uuid,uuid)',
    'frontend_legitimate',
  ],
  ['public.get_tournament_team_visual_policy(uuid,uuid)', 'frontend_legitimate'],
  ['public.set_tournament_team_visual_policy(uuid,uuid,text)', 'frontend_legitimate'],
  ['public.get_tournament_team_photo_state(uuid,uuid)', 'frontend_legitimate'],
  [
    'public.set_tournament_team_photo_editorial_status(uuid,uuid,text,text)',
    'frontend_legitimate',
  ],
  ['public.revoke_tournament_team_photo(uuid,uuid)', 'frontend_legitimate'],
  [
    'public.append_tournament_playoff_phase(uuid,uuid,uuid,uuid,integer,boolean,uuid)',
    'frontend_legitimate',
  ],
  ['public.get_public_tournament_page(text,text)', 'frontend_legitimate'],
  ['public.get_tournament_public_page_settings(uuid,uuid)', 'frontend_legitimate'],
  ['public.set_tournament_public_page_published(uuid,uuid,boolean)', 'frontend_legitimate'],
  ['public.get_effective_tournament_entitlements(uuid,uuid)', 'frontend_legitimate'],
  ['public.get_tournament_creation_eligibility(uuid)', 'frontend_legitimate'],
  ['public.has_organization_consumed_free_tournament(uuid)', 'frontend_legitimate'],
  ['public.has_tournament_entitlement(uuid,uuid,text)', 'frontend_legitimate'],
  ['public.tournament_role_capabilities(text)', 'rls_helper_required'],
  ['public.get_public_tournament_commercial_catalog(integer)', 'frontend_legitimate'],
  ['public.get_tournament_purchase(uuid)', 'frontend_legitimate'],
  [
    'public.create_fake_tournament_purchase(uuid,uuid,text,uuid,text)',
    'frontend_legitimate',
  ],
  [
    'public.create_tournament_purchase(uuid,uuid,text,uuid,text,text)',
    'frontend_legitimate',
  ],
  ['public.cancel_tournament_purchase(uuid)', 'frontend_legitimate'],
  ['public.get_tournament_media_asset_processing_tiers(uuid)', 'frontend_legitimate'],
  ['public.get_tournament_media_upload_capability(uuid)', 'frontend_legitimate'],
  ['public.get_tournament_social_snapshot(uuid,uuid,uuid,uuid,text,uuid,uuid)', 'frontend_legitimate'],
  ['public.get_tournament_social_studio_context(uuid)', 'frontend_legitimate'],
  ['public.set_tournament_social_permission(uuid,uuid,boolean)', 'frontend_legitimate'],
  ['public.start_tournament_competition(uuid,uuid)', 'frontend_legitimate'],
  ['public.finish_tournament_competition(uuid,uuid)', 'frontend_legitimate'],
  ['public.reopen_tournament_competition(uuid,uuid,text)', 'frontend_legitimate'],
  [
    'public.withdraw_tournament_competition_participant(uuid,uuid,uuid,text,text)',
    'frontend_legitimate',
  ],
  [
    'public.set_tournament_player_portrait_crop(uuid,uuid,numeric,numeric,numeric)',
    'frontend_legitimate',
  ],
  ['public.list_tournament_player_portrait_refs(uuid,uuid)', 'frontend_legitimate'],
];

const contracts = fs.readFileSync(contractsPath, 'utf8');
const allowlistBlock = contracts.match(
  /-- BEGIN AUTHENTICATED EXECUTE ALLOWLIST([\s\S]*?)-- END AUTHENTICATED EXECUTE ALLOWLIST/,
)?.[1];
if (!allowlistBlock) throw new Error('Authenticated EXECUTE allowlist block not found.');

const allowlist = new Map();
for (const match of allowlistBlock.matchAll(
  /\('([^']+)', '(frontend_legitimate|rls_helper_required)'\)/g,
)) {
  if (allowlist.has(match[1])) {
    throw new Error(`Duplicate authenticated allowlist signature: ${match[1]}`);
  }
  allowlist.set(match[1], match[2]);
}
for (const [signature, category] of POST_CANONICAL_AUTHENTICATED_ALLOWLIST) {
  if (allowlist.has(signature)) {
    throw new Error(`Duplicate authenticated allowlist signature: ${signature}`);
  }
  allowlist.set(signature, category);
}

let checks = 0;
let failures = 0;
const check = (condition, label, detail = '') => {
  checks += 1;
  if (condition) {
    console.log(`  ✔ ${label}`);
  } else {
    failures += 1;
    console.error(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

const status = await import('node:child_process').then(({ spawnSync }) => spawnSync(
  'npx',
  ['supabase', 'status', '-o', 'env'],
  { cwd: root, encoding: 'utf8' },
));
if (status.status !== 0) {
  throw new Error(status.stderr || status.stdout || 'Supabase local is not running.');
}
const localEnv = Object.fromEntries(
  status.stdout
    .split('\n')
    .map((line) => line.match(/^([A-Z0-9_]+)="(.*)"$/))
    .filter(Boolean)
    .map((match) => [match[1], match[2]]),
);
if (!localEnv.DB_URL) throw new Error('Supabase local did not expose DB_URL.');

const client = new pg.Client({ connectionString: localEnv.DB_URL });
await client.connect();

const catalog = await client.query(`
  select
    'public.' || procedure_row.oid::regprocedure::text as signature,
    procedure_row.prosecdef as security_definer,
    exists (
      select 1
      from aclexplode(coalesce(
        procedure_row.proacl,
        acldefault('f', procedure_row.proowner)
      )) acl
      where acl.grantee = 0
        and acl.privilege_type = 'EXECUTE'
    ) as public_execute,
    has_function_privilege('anon', procedure_row.oid, 'EXECUTE') as anon_execute,
    has_function_privilege('authenticated', procedure_row.oid, 'EXECUTE') as authenticated_execute,
    has_function_privilege('service_role', procedure_row.oid, 'EXECUTE') as service_execute
  from pg_proc procedure_row
  join pg_namespace namespace on namespace.oid = procedure_row.pronamespace
  where namespace.nspname = 'public'
  order by signature
`);
const bySignature = new Map(catalog.rows.map((row) => [row.signature, row]));

console.log('\nAuthenticated RPC grants — canonical Supabase local\n');

for (const [signature, category] of allowlist) {
  check(bySignature.has(signature), `${category}: ${signature} exists`);
  check(
    bySignature.get(signature)?.authenticated_execute === true,
    `${category}: ${signature} is executable by authenticated`,
  );
}

const unexpectedAuthenticated = catalog.rows
  .filter((row) => row.authenticated_execute && !allowlist.has(row.signature))
  .map((row) => row.signature);
check(
  unexpectedAuthenticated.length === 0,
  'authenticated has no signatures outside the exact allowlist',
  unexpectedAuthenticated.join(', '),
);

for (const signature of ANON_ALLOWLIST) {
  check(bySignature.get(signature)?.anon_execute === true, `anon allowlist: ${signature}`);
}
const unexpectedAnon = catalog.rows
  .filter((row) => row.anon_execute && !ANON_ALLOWLIST.includes(row.signature))
  .map((row) => row.signature);
check(
  unexpectedAnon.length === 0,
  `anon has exactly the ${ANON_ALLOWLIST.length} approved signatures`,
  unexpectedAnon.join(', '),
);

const serviceOnly = [...CRITICAL, ...HIGH, ...MEDIUM];
for (const signature of serviceOnly) {
  const row = bySignature.get(signature);
  check(Boolean(row), `service-only identity exists: ${signature}`);
  check(row?.public_execute === false, `PUBLIC denied: ${signature}`);
  check(row?.anon_execute === false, `anon denied: ${signature}`);
  check(row?.authenticated_execute === false, `authenticated denied: ${signature}`);
  check(row?.service_execute === true, `service_role allowed: ${signature}`);
}

for (const signature of AUTO_MATCH_SERVICE_ROLE) {
  const row = bySignature.get(signature);
  check(Boolean(row), `auto-match service_role identity exists: ${signature}`);
  check(row?.public_execute === false, `auto-match PUBLIC denied: ${signature}`);
  check(row?.anon_execute === false, `auto-match anon denied: ${signature}`);
  check(row?.authenticated_execute === false, `auto-match authenticated denied: ${signature}`);
  check(row?.service_execute === true, `auto-match service_role allowed: ${signature}`);
}

const unexpectedPublic = catalog.rows.filter((row) => row.public_execute);
check(
  unexpectedPublic.length === 0,
  'PUBLIC EXECUTE unexpected: 0',
  unexpectedPublic.map((row) => row.signature).join(', '),
);

const unsafeFunctionDefaults = await client.query(`
  select
    owner_role.rolname as owner,
    coalesce(grantee_role.rolname, 'PUBLIC') as grantee
  from pg_default_acl default_acl
  join pg_roles owner_role on owner_role.oid = default_acl.defaclrole
  join pg_namespace namespace on namespace.oid = default_acl.defaclnamespace
  cross join lateral aclexplode(default_acl.defaclacl) privilege
  left join pg_roles grantee_role on grantee_role.oid = privilege.grantee
  where namespace.nspname = 'public'
    and default_acl.defaclobjtype = 'f'
    and owner_role.rolname = 'postgres'
    and coalesce(grantee_role.rolname, 'PUBLIC')
      in ('PUBLIC', 'anon', 'authenticated', 'service_role')
    and privilege.privilege_type = 'EXECUTE'
  order by owner, grantee
`);
check(
  unsafeFunctionDefaults.rows.length === 0,
  'future public functions require an explicit EXECUTE allowlist',
  unsafeFunctionDefaults.rows
    .map((row) => `${row.owner}->${row.grantee}`)
    .join(', '),
);

const expectAuthenticatedDenied = async (label, sql, params = []) => {
  await client.query('begin');
  try {
    await client.query("select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000099', true)");
    await client.query('set local role authenticated');
    await client.query(sql, params);
    check(false, label, 'call unexpectedly succeeded');
  } catch (error) {
    check(
      error?.code === '42501' && /permission denied for function/i.test(error.message),
      label,
      error.message,
    );
  } finally {
    await client.query('rollback');
  }
};

await expectAuthenticatedDenied('authenticated cannot claim push queue', 'select * from public.claim_push_delivery_batch()');
await expectAuthenticatedDenied('authenticated cannot claim targeted push queue', 'select * from public.claim_targeted_push_delivery_batch(array[]::uuid[])');
await expectAuthenticatedDenied('authenticated cannot run push scheduler', 'select public.run_push_sender_scheduler_tick()');
await expectAuthenticatedDenied('authenticated cannot cancel through internal RPC', "select public.cancel_partido_with_notification(1, 'x')");
await expectAuthenticatedDenied('authenticated cannot cleanup voting through internal RPC', 'select public.cleanup_voting_access_state(1)');
await expectAuthenticatedDenied('authenticated cannot enqueue arbitrary partido notifications', "select public.enqueue_partido_notification(1, 'match_update')");
await expectAuthenticatedDenied('authenticated cannot purge notifications', 'select public.purge_old_notifications()');
await expectAuthenticatedDenied(
  'authenticated cannot accept an invite for another supplied user',
  "select * from public.accept_invite_for_user('token', '91000000-0000-4000-8000-000000000098'::uuid)",
);
await expectAuthenticatedDenied('authenticated cannot run the auto-match sweep', 'select public.auto_match_scheduled_sweep()');
await expectAuthenticatedDenied('authenticated cannot prepare an arbitrary challenge squad', "select public.prepare_challenge_team_squad('91000000-0000-4000-8000-000000000097'::uuid, true)");

await client.query('begin');
try {
  await client.query('set local role service_role');
  await client.query('select * from public.claim_push_delivery_batch(1, $1, 1, 1)', ['grant-test']);
  await client.query('select public.purge_old_notifications(14, 1, true)');
  await client.query('select public.purge_old_notification_delivery_logs(7, 1, true)');
  await client.query(`
    select
      public.auto_match_duration('F5'),
      public.auto_match_has_valid_coordinates(-34.6, -58.4),
      public.auto_match_distance_km(0, 0, 0, 0),
      public.auto_match_snapshots_are_compatible(
        -34.6, -58.4, 10,
        -34.6, -58.4, 10
      ),
      public.auto_match_play_range(
        '2030-01-01 20:00+00'::timestamptz,
        'F5'
      )
  `);
  check(true, 'service_role executes required backend helpers inside rollback');
} catch (error) {
  check(false, 'service_role executes required backend helpers inside rollback', error.message);
} finally {
  await client.query('rollback');
}

const actorId = '91000000-0000-4000-8000-000000000091';
await client.query('begin');
try {
  await client.query(
    `insert into auth.users (
       id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
       created_at, updated_at
     ) values (
       $1, 'authenticated', 'authenticated', 'grant-test@example.com',
       '{}'::jsonb, '{"full_name":"Grant test actor"}'::jsonb,
       now(), now()
     )`,
    [actorId],
  );
  const match = await client.query(
    `insert into public.partidos (
       codigo, nombre, fecha, hora, sede, modalidad, cupo_jugadores,
       creado_por, admin_id, estado
     ) values (
       'GRANTTEST', 'Grant test match', current_date + 1, '20:00',
       'Cancha local', 'F5', 10, $1, $1, 'active'
     ) returning id`,
    [actorId],
  );
  await client.query("select set_config('request.jwt.claim.sub', $1, true)", [actorId]);
  await client.query('set local role authenticated');
  await client.query(
    'select public.cleanup_voting_access_state_as_admin($1)',
    [match.rows[0].id],
  );
  check(true, 'legitimate match admin can use the actor-derived wrapper');
} catch (error) {
  check(false, 'legitimate match admin can use the actor-derived wrapper', error.message);
} finally {
  await client.query('rollback');
}

const counts = {
  securityDefiner: catalog.rows.filter((row) => row.security_definer).length,
  publicExecute: catalog.rows.filter((row) => row.public_execute).length,
  anonExecute: catalog.rows.filter((row) => row.anon_execute).length,
  authenticatedExecute: catalog.rows.filter((row) => row.authenticated_execute).length,
  serviceRoleExecute: catalog.rows.filter((row) => row.service_execute).length,
  authenticatedAllowlist: allowlist.size,
};
check(counts.publicExecute === 0, 'PUBLIC EXECUTE count remains 0');
check(
  counts.anonExecute === ANON_ALLOWLIST.length,
  `anon EXECUTE count remains ${ANON_ALLOWLIST.length}`,
);
check(
  counts.authenticatedExecute === allowlist.size,
  `authenticated EXECUTE count remains ${allowlist.size}`,
);
console.log('\nCatalog counts:', counts);
console.log(`\n${checks} grant/security checks, ${failures} failures.`);

await client.end();
if (failures > 0) process.exit(1);
