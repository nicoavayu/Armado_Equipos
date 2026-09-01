#!/usr/bin/env node

import {
  connectCanonicalLocal,
  createChecks,
  expectDatabaseError,
  insertAuthUser,
  resetRequestRole,
  setRequestRole,
} from './canonical-contract-test-helpers.mjs';

const ACTOR = '93000000-0000-4000-8000-000000000001';
const OTHER = '93000000-0000-4000-8000-000000000002';
const { check, finish } = createChecks('global availability — atomic domain contract');
const client = await connectCanonicalLocal();

const one = async (sql, params = []) => (await client.query(sql, params)).rows[0] || null;
const count = async (sql, params = []) => Number(Object.values(await one(sql, params) || {})[0] || 0);

const callAs = async (userId, enabled) => {
  await setRequestRole(client, 'authenticated', userId);
  try {
    return (await one(
      'select public.set_my_global_availability($1) as result',
      [enabled],
    ))?.result;
  } finally {
    await resetRequestRole(client);
  }
};

const seedActiveSearch = async (userId) => {
  await setRequestRole(client, 'authenticated', userId);
  try {
    return (await one(
      `select id
       from public.upsert_my_availability(
         $1::smallint[], $2::time, $3::time, $4::text[], $5, $6, $7, $8
       )`,
      [[1, 3, 5], '20:00', '23:00', ['F5'], 8, -34.6037, -58.3816, false],
    ))?.id;
  } finally {
    await resetRequestRole(client);
  }
};

const invitations = (userId) => one(
  'select acepta_invitaciones from public.usuarios where id = $1',
  [userId],
).then((row) => row?.acepta_invitaciones);
const activeFreePlayers = (userId) => count(
  'select count(*) from public.jugadores_sin_partido where user_id = $1 and disponible',
  [userId],
);
const allFreePlayers = (userId) => count(
  'select count(*) from public.jugadores_sin_partido where user_id = $1',
  [userId],
);
const activeSearches = (userId) => count(
  "select count(*) from public.player_availability where user_id = $1 and status = 'active'",
  [userId],
);

await client.query('begin');
try {
  await insertAuthUser(client, ACTOR, 'global-availability-actor@example.com');
  await insertAuthUser(client, OTHER, 'global-availability-other@example.com');
  await client.query(
    `update public.usuarios
     set nombre = case id when $1 then 'Actor Global' else 'Other Global' end,
         localidad = 'Buenos Aires'
     where id in ($1, $2)`,
    [ACTOR, OTHER],
  );

  const signature = await one(`
    select pg_get_function_identity_arguments(proc.oid) as args,
           pg_get_function_result(proc.oid) as result,
           proc.prosecdef,
           proc.proconfig
    from pg_proc proc
    join pg_namespace namespace on namespace.oid = proc.pronamespace
    where namespace.nspname = 'public'
      and proc.proname = 'set_my_global_availability'
  `);
  check(signature?.args === 'p_enabled boolean', 'RPC accepts only p_enabled boolean');
  check(signature?.result === 'jsonb', 'RPC returns jsonb');
  check(signature?.prosecdef === true, 'RPC is SECURITY DEFINER');
  check(signature?.proconfig?.includes('search_path=""'), 'RPC pins an empty search_path');

  const privilege = await one(`
    select
      coalesce(bool_or(acl.grantee = 0) filter (where acl.privilege_type = 'EXECUTE'), false) as public_execute,
      has_function_privilege('anon', proc.oid, 'EXECUTE') as anon_execute,
      has_function_privilege('authenticated', proc.oid, 'EXECUTE') as authenticated_execute,
      has_function_privilege('service_role', proc.oid, 'EXECUTE') as service_role_execute
    from pg_proc proc
    join pg_namespace namespace on namespace.oid = proc.pronamespace
    cross join lateral aclexplode(coalesce(proc.proacl, acldefault('f', proc.proowner))) acl
    where namespace.nspname = 'public'
      and proc.proname = 'set_my_global_availability'
    group by proc.oid
  `);
  check(privilege?.public_execute === false, 'PUBLIC has no EXECUTE');
  check(privilege?.anon_execute === false, 'anon has no EXECUTE');
  check(privilege?.authenticated_execute === true, 'authenticated has EXECUTE');
  check(privilege?.service_role_execute === false, 'service_role has no explicit/inherited EXECUTE');

  const rls = await client.query(`
    select relname, relrowsecurity
    from pg_class
    where oid in ('public.usuarios'::regclass, 'public.jugadores_sin_partido'::regclass)
    order by relname
  `);
  check(rls.rows.length === 2 && rls.rows.every((row) => row.relrowsecurity), 'existing RLS remains enabled');

  // Canonical direct own UPDATE proves the old REST payload is compatible with
  // the versioned table/policy contract; the observed 403 came from runtime drift.
  await setRequestRole(client, 'authenticated', ACTOR);
  const directOwnUpdate = await client.query(
    'update public.usuarios set acepta_invitaciones = false where id = $1 returning id',
    [ACTOR],
  );
  check(directOwnUpdate.rowCount === 1, 'canonical own usuarios UPDATE policy accepts the old payload');
  await resetRequestRole(client);

  // B + D + F: enabling creates one free-player row, is idempotent, and never
  // starts Auto-Match.
  const enabled = await callAs(ACTOR, true);
  check(enabled?.enabled === true && enabled?.autoMatchStarted === false, 'No disponible → Disponible returns enabled without Auto-Match');
  check(await invitations(ACTOR) === true, 'Disponible enables invitations');
  check(await activeFreePlayers(ACTOR) === 1, 'Disponible exposes exactly one active free-player row');
  check(await activeSearches(ACTOR) === 0, 'Disponible does not create player_availability');
  await callAs(ACTOR, true);
  check(await activeFreePlayers(ACTOR) === 1, 'repeated enabled=true keeps one active free-player row');
  check(await allFreePlayers(ACTOR) === 1, 'repeated enabled=true does not duplicate the row');

  // A: seed a live Auto-Match membership, then disable globally.
  const availabilityId = await seedActiveSearch(ACTOR);
  const proposal = await one(
    `with fixture_slots as (
       select (
         date_trunc('week', now() at time zone 'America/Argentina/Buenos_Aires')
           + interval '28 days 21 hours'
           + (week_offset * interval '7 days')
       ) at time zone 'America/Argentina/Buenos_Aires' as starts_at
       from generate_series(0, 51) as slots(week_offset)
     ), free_fixture_slot as (
       select fixture_slots.starts_at
       from fixture_slots
       where not exists (
         select 1
         from public.auto_match_proposals existing
         where existing.format = 'F5'
           and existing.status in ('collecting', 'ready')
           and existing.titulares_completed_at is null
           and public.auto_match_slot_bucket_range(existing.proposed_starts_at)
             && public.auto_match_slot_bucket_range(fixture_slots.starts_at)
       )
       order by fixture_slots.starts_at
       limit 1
     )
     insert into public.auto_match_proposals (
       format, proposed_starts_at, latitude, longitude, max_players,
       status, expires_at, gestation_started_at, gestation_threshold
     )
     select
       'F5', starts_at, -34.6037, -58.3816, 10,
       'collecting', starts_at - interval '30 minutes', now(), 4
     from free_fixture_slot
     returning id, proposed_starts_at`,
  );
  if (!proposal) throw new Error('No deterministic free F5 fixture slot was available.');
  await client.query(
    `insert into public.auto_match_proposal_members (
       proposal_id, availability_id, user_id, response, invite_expires_at
     ) values ($1, $2, $3, 'pending', now() + interval '20 days')`,
    [proposal.id, availabilityId, ACTOR],
  );

  const disabled = await callAs(ACTOR, false);
  check(disabled?.enabled === false, 'Disponible → No disponible completes');
  check(await invitations(ACTOR) === false, 'No disponible disables invitations');
  check(await activeFreePlayers(ACTOR) === 0, 'No disponible deactivates the free-player row');
  check(await activeSearches(ACTOR) === 0, 'No disponible cancels player_availability');
  const membership = await one(
    'select response, response_reason from public.auto_match_proposal_members where proposal_id = $1 and user_id = $2',
    [proposal.id, ACTOR],
  );
  check(
    membership?.response === 'declined' && membership?.response_reason === 'user_declined',
    'No disponible reuses certified Auto-Match membership cleanup',
  );

  // C + E: disabling without an active search and repeating it are idempotent.
  await callAs(ACTOR, false);
  check(await invitations(ACTOR) === false, 'enabled=false without active Auto-Match passes');
  check(await activeFreePlayers(ACTOR) === 0 && await activeSearches(ACTOR) === 0, 'repeated enabled=false stays fully inactive');

  await callAs(ACTOR, true);
  check(await activeFreePlayers(ACTOR) === 1 && await activeSearches(ACTOR) === 0, 'reactivation restores free-player only');

  // G: actor A can never modify actor B.
  await callAs(OTHER, true);
  await callAs(ACTOR, false);
  check(await invitations(OTHER) === true, 'actor A cannot change actor B invitations');
  check(await activeFreePlayers(OTHER) === 1, 'actor A cannot change actor B free-player state');

  // H: fail after usuarios changed but while jugadores_sin_partido updates.
  // The failed statement must roll back invitations and leave Auto-Match live.
  await callAs(ACTOR, true);
  await seedActiveSearch(ACTOR);
  await client.query(`
    create function pg_temp.fail_global_availability_free_player()
    returns trigger
    language plpgsql
    as $$
    begin
      if new.user_id = '${ACTOR}'::uuid then
        raise exception 'simulated_global_availability_failure';
      end if;
      return new;
    end;
    $$
  `);
  await client.query(`
    create trigger simulate_global_availability_failure
    before update on public.jugadores_sin_partido
    for each row execute function pg_temp.fail_global_availability_free_player()
  `);
  await setRequestRole(client, 'authenticated', ACTOR);
  const simulatedFailure = await expectDatabaseError(
    client,
    'select public.set_my_global_availability(false)',
  );
  await resetRequestRole(client);
  check(/simulated_global_availability_failure/.test(simulatedFailure?.message || ''), 'simulated intermediate failure is observed');
  check(await invitations(ACTOR) === true, 'intermediate failure rolls back usuarios');
  check(await activeFreePlayers(ACTOR) === 1, 'intermediate failure rolls back free-player state');
  check(await activeSearches(ACTOR) === 1, 'intermediate failure leaves Auto-Match unchanged');
  await client.query('drop trigger simulate_global_availability_failure on public.jugadores_sin_partido');

  // I: anon is denied before the function body can run.
  await setRequestRole(client, 'anon');
  const anonError = await expectDatabaseError(
    client,
    'select public.set_my_global_availability(false)',
  );
  await resetRequestRole(client);
  check(anonError?.code === '42501', 'anon execution is denied');
} finally {
  await client.query('rollback');
  await client.end();
  finish();
}
