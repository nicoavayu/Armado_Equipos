#!/usr/bin/env node

import {
  connectCanonicalLocal,
  createChecks,
  expectDatabaseError,
  insertAuthUser,
  resetRequestRole,
  setRequestRole,
} from './canonical-contract-test-helpers.mjs';

const ACTOR = '92000000-0000-4000-8000-000000000001';
const OTHER = '92000000-0000-4000-8000-000000000002';
const { check, finish } = createChecks('jugadores_sin_partido — canonical authenticated contract');
const client = await connectCanonicalLocal();

await client.query('begin');
try {
  await insertAuthUser(client, ACTOR, 'contract-actor@example.com');
  await insertAuthUser(client, OTHER, 'contract-other@example.com');

  const columns = await client.query(`
    select column_name, data_type, is_nullable, column_default
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'jugadores_sin_partido'
    order by ordinal_position
  `);
  check(
    JSON.stringify(columns.rows.map((row) => row.column_name))
      === JSON.stringify(['id', 'user_id', 'nombre', 'localidad', 'avatar_url', 'disponible', 'created_at']),
    'table exposes exactly the seven certified columns',
  );
  const byColumn = new Map(columns.rows.map((row) => [row.column_name, row]));
  check(byColumn.get('id')?.data_type === 'uuid', 'id is uuid');
  check(byColumn.get('user_id')?.data_type === 'uuid' && byColumn.get('user_id')?.is_nullable === 'NO', 'user_id is required uuid');
  check(byColumn.get('avatar_url')?.is_nullable === 'YES', 'avatar_url is nullable');
  check(/true/i.test(byColumn.get('disponible')?.column_default || ''), 'disponible defaults true');
  check(/now\(\)/i.test(byColumn.get('created_at')?.column_default || ''), 'created_at defaults now()');

  const tableSecurity = await client.query(`
    select relrowsecurity
    from pg_class
    where oid = 'public.jugadores_sin_partido'::regclass
  `);
  check(tableSecurity.rows[0]?.relrowsecurity === true, 'RLS is enabled');

  const policies = await client.query(`
    select policyname, cmd, roles, qual, with_check
    from pg_policies
    where schemaname = 'public' and tablename = 'jugadores_sin_partido'
    order by cmd
  `);
  check(policies.rowCount === 4, 'exactly four operation-specific policies exist');
  check(policies.rows.every((row) => row.roles.includes('authenticated')), 'all policies target authenticated only');

  const grants = await client.query(`
    select grantee, privilege_type
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'jugadores_sin_partido'
      and grantee in ('anon', 'authenticated')
    order by grantee, privilege_type
  `);
  check(
    JSON.stringify(grants.rows) === JSON.stringify([
      { grantee: 'authenticated', privilege_type: 'DELETE' },
      { grantee: 'authenticated', privilege_type: 'INSERT' },
      { grantee: 'authenticated', privilege_type: 'SELECT' },
      { grantee: 'authenticated', privilege_type: 'UPDATE' },
    ]),
    'authenticated has exactly SELECT/INSERT/UPDATE/DELETE and anon has none',
    JSON.stringify(grants.rows),
  );

  const fk = await client.query(`
    select confdeltype
    from pg_constraint
    where conrelid = 'public.jugadores_sin_partido'::regclass
      and conname = 'jugadores_sin_partido_user_id_fkey'
  `);
  check(fk.rows[0]?.confdeltype === 'c', 'user_id FK uses ON DELETE CASCADE');

  await client.query(
    `insert into public.jugadores_sin_partido (user_id, nombre, localidad)
     values ($1, 'Other player', 'Rosario')`,
    [OTHER],
  );

  await setRequestRole(client, 'authenticated', ACTOR);
  const ownInsert = await client.query(
    `insert into public.jugadores_sin_partido (user_id, nombre, localidad)
     values ($1, 'Actor player', 'Buenos Aires')
     returning id, disponible, created_at`,
    [ACTOR],
  );
  check(ownInsert.rows[0]?.disponible === true, 'authenticated inserts its own row with disponible=true');
  check(ownInsert.rows[0]?.created_at instanceof Date, 'authenticated insert receives created_at');

  const globalRead = await client.query(
    `select user_id
     from public.jugadores_sin_partido
     where user_id = any($1::uuid[])
     order by user_id`,
    [[ACTOR, OTHER]],
  );
  check(
    JSON.stringify(globalRead.rows.map((row) => row.user_id)) === JSON.stringify([ACTOR, OTHER]),
    'authenticated SELECT is global',
    JSON.stringify(globalRead.rows),
  );

  const crossInsertError = await expectDatabaseError(
    client,
    `insert into public.jugadores_sin_partido (user_id, nombre, localidad)
     values ($1, 'Forbidden', 'Nowhere')`,
    [OTHER],
  );
  check(crossInsertError?.code === '42501', 'cross-user INSERT is denied');

  const crossUpdate = await client.query(
    `update public.jugadores_sin_partido set disponible = false where user_id = $1`,
    [OTHER],
  );
  check(crossUpdate.rowCount === 0, 'cross-user UPDATE affects no rows');

  const crossDelete = await client.query(
    'delete from public.jugadores_sin_partido where user_id = $1',
    [OTHER],
  );
  check(crossDelete.rowCount === 0, 'cross-user DELETE affects no rows');

  const ownUpdate = await client.query(
    'update public.jugadores_sin_partido set disponible = false where user_id = $1',
    [ACTOR],
  );
  check(ownUpdate.rowCount === 1, 'authenticated updates its own row');
  const ownDelete = await client.query(
    'delete from public.jugadores_sin_partido where user_id = $1',
    [ACTOR],
  );
  check(ownDelete.rowCount === 1, 'authenticated deletes its own row');
  await resetRequestRole(client);

  await setRequestRole(client, 'anon');
  const anonReadError = await expectDatabaseError(
    client,
    'select * from public.jugadores_sin_partido',
  );
  check(anonReadError?.code === '42501', 'anon cannot read jugadores_sin_partido');
  await resetRequestRole(client);

  await client.query('delete from auth.users where id = $1', [OTHER]);
  const cascade = await client.query(
    'select count(*)::integer as count from public.jugadores_sin_partido where user_id = $1',
    [OTHER],
  );
  check(cascade.rows[0]?.count === 0, 'deleting auth.users cascades availability rows');
} finally {
  await client.query('rollback');
  await client.end();
  finish();
}
