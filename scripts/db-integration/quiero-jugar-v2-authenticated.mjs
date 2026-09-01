#!/usr/bin/env node

import {
  connectCanonicalLocal,
  createChecks,
  expectDatabaseError,
  insertAuthUser,
  resetRequestRole,
  setRequestRole,
} from './canonical-contract-test-helpers.mjs';

const ACTOR = '92000000-0000-4000-8000-000000000021';
const { check, finish } = createChecks('Quiero Jugar v2 — canonical authenticated execution');
const client = await connectCanonicalLocal();

await client.query('begin');
try {
  await insertAuthUser(client, ACTOR, 'quiero-jugar-contract@example.com');
  await client.query(
    `insert into public.usuarios (id, nombre, email)
     values ($1, 'Quiero Jugar contract', 'quiero-jugar-contract@example.com')
     on conflict (id) do nothing`,
    [ACTOR],
  );

  const grants = await client.query(`
    select
      has_function_privilege('authenticated', 'public.get_open_matches_for_quiero_jugar_v2(double precision,double precision,integer)', 'EXECUTE') as rpc_auth,
      has_function_privilege('anon', 'public.get_open_matches_for_quiero_jugar_v2(double precision,double precision,integer)', 'EXECUTE') as rpc_anon,
      has_function_privilege('authenticated', 'public.partido_is_operationally_open(text,timestamp with time zone,text,text,timestamp with time zone,date,text,boolean,timestamp with time zone)', 'EXECUTE') as operational_auth,
      has_function_privilege('authenticated', 'public.normalize_partido_estado(text)', 'EXECUTE') as normalize_auth,
      has_function_privilege('authenticated', 'public.partido_kickoff_at(date,text)', 'EXECUTE') as kickoff_auth
  `);
  const grant = grants.rows[0] || {};
  check(grant.rpc_auth === true, 'authenticated can execute get_open_matches_for_quiero_jugar_v2');
  check(grant.rpc_anon === false, 'anon cannot execute get_open_matches_for_quiero_jugar_v2');
  check(grant.operational_auth === true, 'authenticated can execute partido_is_operationally_open');
  check(grant.normalize_auth === true, 'authenticated can execute normalize_partido_estado');
  check(grant.kickoff_auth === true, 'authenticated can execute partido_kickoff_at');

  await setRequestRole(client, 'authenticated', ACTOR);
  const rpc = await client.query(
    'select count(*)::integer as count from public.get_open_matches_for_quiero_jugar_v2(null, null, 30)',
  );
  check(Number.isInteger(rpc.rows[0]?.count), 'authenticated executes v2 RPC successfully');

  const view = await client.query(
    'select count(*)::integer as count from public.partidos_abiertos_operativos_v2',
  );
  check(Number.isInteger(view.rows[0]?.count), 'authenticated evaluates/counts the security_invoker view');

  const helpers = await client.query(`
    select
      public.normalize_partido_estado('active') as normalized,
      public.partido_kickoff_at(current_date + 1, '20:00') is not null as kickoff_ok,
      public.partido_is_operationally_open(
        'active', null, null, null, null,
        current_date + 1, '20:00', true, now()
      ) as operational
  `);
  check(helpers.rows[0]?.normalized === 'active', 'normalize_partido_estado evaluates as authenticated');
  check(helpers.rows[0]?.kickoff_ok === true, 'partido_kickoff_at evaluates as authenticated');
  check(helpers.rows[0]?.operational === true, 'partido_is_operationally_open evaluates as authenticated');

  const cancellation = await client.query(
    'select * from public.cancel_my_availability_detailed()',
  );
  check(cancellation.rowCount >= 0, 'cancel_my_availability_detailed remains executable');
  await resetRequestRole(client);

  await setRequestRole(client, 'anon');
  const anonRpc = await expectDatabaseError(
    client,
    'select * from public.get_open_matches_for_quiero_jugar_v2(null, null, 30)',
  );
  check(anonRpc?.code === '42501', 'anon RPC execution is denied');
  const anonView = await expectDatabaseError(
    client,
    'select count(*) from public.partidos_abiertos_operativos_v2',
  );
  check(anonView?.code === '42501', 'anon view access is denied');
  await resetRequestRole(client);

  const debugGrant = await client.query(`
    select has_function_privilege(
      'authenticated',
      'public.debug_quiero_jugar_match_audit_v2(double precision,double precision,integer)',
      'EXECUTE'
    ) as allowed
  `);
  check(debugGrant.rows[0]?.allowed === false, 'debug_quiero_jugar_match_audit_v2 remains closed');
} finally {
  await client.query('rollback');
  await client.end();
  finish();
}
