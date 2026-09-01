#!/usr/bin/env node

import {
  connectCanonicalLocal,
  createChecks,
  insertAuthUser,
  resetRequestRole,
  setRequestRole,
} from './canonical-contract-test-helpers.mjs';

const ACTOR = '92000000-0000-4000-8000-000000000011';
const { check, finish } = createChecks('usuarios — current profile contract');
const client = await connectCanonicalLocal();

await client.query('begin');
try {
  const expectedTypes = new Map([
    ['created_at', 'timestamp with time zone'],
    ['bio', 'text'],
    ['nacionalidad', 'text'],
    ['pais_codigo', 'text'],
    ['fecha_nacimiento', 'date'],
    ['numero', 'integer'],
    ['lesion_activa', 'boolean'],
  ]);
  const columns = await client.query(`
    select column_name, data_type, column_default, is_nullable
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'usuarios'
      and column_name = any($1::text[])
  `, [[...expectedTypes.keys()]]);
  const byColumn = new Map(columns.rows.map((row) => [row.column_name, row]));
  check(byColumn.size === expectedTypes.size, 'created_at and all six current profile columns exist');
  for (const [column, dataType] of expectedTypes) {
    check(byColumn.get(column)?.data_type === dataType, `${column} has type ${dataType}`);
  }
  check(byColumn.get('created_at')?.is_nullable === 'NO', 'created_at is not nullable');
  check(/now\(\)/i.test(byColumn.get('created_at')?.column_default || ''), 'created_at defaults automatically to now()');
  check(/false/i.test(byColumn.get('lesion_activa')?.column_default || ''), 'lesion_activa defaults false');

  const legacyColumn = await client.query(`
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'usuarios'
      and column_name = 'fecha_alta'
  `);
  check(legacyColumn.rowCount === 0, 'legacy fecha_alta is absent from the current usuarios contract');

  await insertAuthUser(client, ACTOR, 'profile-contract@example.com');
  await client.query(
    `insert into public.usuarios (id, nombre, email)
     values ($1, 'Profile contract', 'profile-contract@example.com')
     on conflict (id) do nothing`,
    [ACTOR],
  );

  await setRequestRole(client, 'authenticated', ACTOR);
  const persisted = await client.query(
    `update public.usuarios
     set bio = 'Arquero y organizador',
         nacionalidad = 'Argentina',
         pais_codigo = 'AR',
         fecha_nacimiento = '1994-05-17',
         numero = 12,
         lesion_activa = true
     where id = $1
     returning bio, nacionalidad, pais_codigo, fecha_nacimiento, numero, lesion_activa, created_at`,
    [ACTOR],
  );
  check(persisted.rowCount === 1, 'authenticated profile update persists one own row');
  const row = persisted.rows[0] || {};
  check(row.bio === 'Arquero y organizador', 'bio persists');
  check(row.nacionalidad === 'Argentina', 'nacionalidad persists');
  check(row.pais_codigo === 'AR', 'pais_codigo persists');
  check(
    row.fecha_nacimiento === '1994-05-17'
      || (row.fecha_nacimiento instanceof Date && row.fecha_nacimiento.toISOString().startsWith('1994-05-17')),
    'fecha_nacimiento persists as date',
  );
  check(row.numero === 12, 'numero persists as integer');
  check(row.lesion_activa === true, 'lesion_activa persists');
  check(row.created_at instanceof Date, 'created_at is populated automatically on insert');
  await resetRequestRole(client);
} finally {
  await client.query('rollback');
  await client.end();
  finish();
}
