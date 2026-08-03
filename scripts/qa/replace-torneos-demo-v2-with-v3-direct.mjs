#!/usr/bin/env node

import { resolve } from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

import {
  buildAuthorizedStagingTarget,
  buildStrictPgConfiguration,
  diagnoseConnectedDatabase,
  loadStrictDatabaseCA,
  readPasswordFromMacOSDialog,
  safeError,
} from './apply-torneos-seed-direct.mjs';
import {
  deleteV2InCurrentTransaction,
  loadV2IdentityMap,
  preflightV2Cleanup,
  readQAProfileSnapshot,
  readV2DeleteGuards,
  readV2ExpectedState,
  validateV2DeleteGuards,
} from './cleanup-torneos-demo-v2-direct.mjs';
import {
  buildCanonicalManifest,
  deriveQAIdentityRelations,
  validateCanonicalManifest,
} from './torneos-demo-v3-manifest.mjs';
import { TORNEOS_DEMO_V2_CLEANUP_DESCRIPTOR } from './torneos-demo-v2-cleanup-descriptor.mjs';
import {
  V2_CLEANUP_AUTHORIZATION,
  canonicalJson,
  identityKey,
  sha256,
  validateCleanupDescriptor,
} from './torneos-demo-v2-cleanup-contract.mjs';
import {
  QAIdentityMap,
  QA_IDENTITY_RELATIONS,
} from './torneos-qa-identity-map.mjs';
import {
  insertManifestBaseInCurrentTransaction,
  insertManifestMarkerInCurrentTransaction,
  readManifestExpectedState,
  splitManifestForAtomicReplacement,
} from './torneos-seed-db.mjs';

export const REPLACEMENT_AUTHORIZATION = Object.freeze({
  stagingProjectRef: 'hhyvmhgpapyuzjgxfnqv',
  productionProjectRef: 'rcyuuoaqfwcembdajcss',
  v2ManifestHash: '48b413d1c6673ad96d3ce5bb30fecc89bd2c432b465a00447eb6f2cb51befb2f',
  v2IdentityFingerprint: '77d95cb8caee567de1e8275b81c1e8c850eb59dcf6025504cab93c634ff3657c',
  v2OwnershipFingerprint: '9375b59f2f908aec4b0d5b32b79514491e2ebbd648c4d9e7c245064c772ebe8d',
  v2DescriptorFingerprint: 'd513f0141b84037df67bf854fa0ac6769f08c3171d0257a6416cf87f4d853d6e',
  v3ManifestHash: '0afc357d733bdfbed0bae9ea8bf87b6c0b58a05ada2c0d8b65ef4b51cbb596f4',
  v3IdentityFingerprint: 'd13bf642667c8a02c79a6f7b6db3325be3a2196c1569cfb655d67a72a3ab4cdd',
  v3OwnershipFingerprint: '940e50032644694b3e2e06f0a022ada8b0474bfa4e70cb22ea45e4ceb3701d7a',
  v3MarkerId: '85ab8c2e-6cd5-54c4-86b6-fbbfc0f0b050',
  baseRows: 586,
  totalRows: 587,
  tables: 32,
});

export const REQUIRED_REPLACEMENT_CONFIRMATION =
  'REEMPLAZAR torneos-demo-v2 POR torneos-demo-v3 EN STAGING';

const DEFAULT_IDENTITY_MAP_FILE = 'torneos-demo-v2-identity-map.local';
const REPLACEMENT_ADVISORY_LOCK_NAMESPACE = 'replace:torneos-demo-v2:torneos-demo-v3';
const REPLACEMENT_ADVISORY_LOCK_PROOF = Symbol('replacement-advisory-lock-proof');
const PREFERENCE_TABLE = 'user_tournament_context_preferences';
const EXTERNAL_CONSTRAINT_COUNT = 62;
const EXTERNAL_CONSTRAINT_CATALOG_FINGERPRINT =
  'f0e09632e900cc9b25666c44d999e5102120a8e7ab5880b442de9464aeccbb5a';
const PREFERENCE_COLUMNS = Object.freeze([
  Object.freeze({ name: 'user_id', type: 'uuid', nullable: false }),
  Object.freeze({ name: 'organization_id', type: 'uuid', nullable: false }),
  Object.freeze({ name: 'active_season_id', type: 'uuid', nullable: true }),
  Object.freeze({ name: 'active_tournament_id', type: 'uuid', nullable: true }),
  Object.freeze({ name: 'updated_at', type: 'timestamp with time zone', nullable: false }),
]);
const PREFERENCE_PRIMARY_KEY = Object.freeze({
  name: 'user_tournament_context_preferences_pkey',
  columns: Object.freeze(['user_id', 'organization_id']),
  deferrable: false,
  initiallyDeferred: false,
});
const EXPECTED_EXTERNAL_CONSTRAINTS = Object.freeze({
  user_tournament_context_preferences_organization_id_fkey: Object.freeze({
    sourceColumns: Object.freeze(['organization_id']),
    targetTable: 'tournament_organizations',
    targetColumns: Object.freeze(['id']),
    deleteAction: 'c',
    nullable: Object.freeze([false]),
  }),
  user_tournament_context_season_fk: Object.freeze({
    sourceColumns: Object.freeze(['organization_id', 'active_season_id']),
    targetTable: 'tournament_seasons',
    targetColumns: Object.freeze(['organization_id', 'id']),
    deleteAction: 'r',
    nullable: Object.freeze([false, true]),
  }),
  user_tournament_context_tournament_fk: Object.freeze({
    sourceColumns: Object.freeze([
      'organization_id',
      'active_tournament_id',
      'active_season_id',
    ]),
    targetTable: 'tournaments',
    targetColumns: Object.freeze(['organization_id', 'id', 'season_id']),
    deleteAction: 'r',
    nullable: Object.freeze([false, true, true]),
  }),
});

function quoteIdentifier(value) {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error('Unsafe immutable SQL identifier.');
  return `"${value}"`;
}

function normalizeValue(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
      key,
      normalizeValue(entry),
    ]));
  }
  return value;
}

export function preferenceFingerprint(row) {
  return sha256(canonicalJson(normalizeValue(Object.fromEntries(
    PREFERENCE_COLUMNS.map(({ name }) => [name, row[name]]),
  ))));
}

function sanitizedFingerprint(value) {
  return `${value.slice(0, 12)}…${value.slice(-8)}`;
}

function advisoryLockUnavailableError() {
  const error = new Error('Replacement advisory lock is unavailable.');
  error.code = '55P03';
  error.preflight = {
    status: 'reject',
    reason: 'advisory_lock_unavailable',
  };
  return error;
}

export async function tryAcquireReplacementAdvisoryLock(client) {
  const result = await client.query(
    'select pg_try_advisory_xact_lock(hashtextextended($1, 0)) as acquired',
    [REPLACEMENT_ADVISORY_LOCK_NAMESPACE],
  );
  if (
    result?.rowCount !== 1
    || !Array.isArray(result.rows)
    || result.rows.length !== 1
    || typeof result.rows[0]?.acquired !== 'boolean'
  ) {
    throw new Error('PostgreSQL returned an invalid advisory lock result.');
  }
  return result.rows[0].acquired;
}

export async function acquireReplacementAdvisoryLock(client) {
  const acquired = await tryAcquireReplacementAdvisoryLock(client);
  if (!acquired) throw advisoryLockUnavailableError();
  return Object.freeze({
    [REPLACEMENT_ADVISORY_LOCK_PROOF]: client,
    attempted: true,
    acquired,
    source: 'postgres',
    namespaceFingerprint: sanitizedFingerprint(sha256(REPLACEMENT_ADVISORY_LOCK_NAMESPACE)),
  });
}

function replacementAdvisoryLockReport(client, lock, releasedBy) {
  if (
    lock?.[REPLACEMENT_ADVISORY_LOCK_PROOF] !== client
    || lock.attempted !== true
    || lock.acquired !== true
    || lock.source !== 'postgres'
  ) {
    throw new Error('A verified PostgreSQL replacement advisory lock is required.');
  }
  if (!['rollback', 'transaction_end'].includes(releasedBy)) {
    throw new Error('Replacement advisory lock release contract is invalid.');
  }
  return {
    advisoryLockAttempted: true,
    advisoryLockAcquired: true,
    advisoryLockSource: lock.source,
    advisoryLockNamespaceFingerprint: lock.namespaceFingerprint,
    advisoryLockReleasedBy: releasedBy,
  };
}

function nullableValueFingerprint(label, value) {
  return value === null ? null : sanitizedFingerprint(sha256(`${label}:${value}`));
}

export function preferenceSnapshotReport(preference) {
  return {
    fingerprint: sanitizedFingerprint(preferenceFingerprint(preference)),
    owner: nullableValueFingerprint('user_id', preference.user_id),
    organization: nullableValueFingerprint('organization_id', preference.organization_id),
    season: nullableValueFingerprint('active_season_id', preference.active_season_id),
    tournament: nullableValueFingerprint('active_tournament_id', preference.active_tournament_id),
    seasonIsNull: preference.active_season_id === null,
    tournamentIsNull: preference.active_tournament_id === null,
    updatedAtCaptured: preference.updated_at !== null,
  };
}

export function parseReplacementArguments(args, env = process.env) {
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
    throw new Error('NODE_TLS_REJECT_UNAUTHORIZED=0 is forbidden.');
  }
  let mode = null;
  let argumentCAPath = null;
  let identityMapPath = env.QA_V2_IDENTITY_MAP_FILE || DEFAULT_IDENTITY_MAP_FILE;
  let identityMapSeen = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (['--diagnose', '--preflight', '--execute'].includes(argument)) {
      if (mode) throw new Error('Choose exactly one replacement runner mode.');
      mode = argument.slice(2);
      continue;
    }
    if (argument === '--ca-cert' && args[index + 1] && !argumentCAPath) {
      argumentCAPath = args[index + 1];
      index += 1;
      continue;
    }
    if (argument.startsWith('--ca-cert=') && !argumentCAPath) {
      argumentCAPath = argument.slice('--ca-cert='.length);
      continue;
    }
    if (argument === '--identity-map' && args[index + 1] && !identityMapSeen) {
      identityMapPath = args[index + 1];
      identityMapSeen = true;
      index += 1;
      continue;
    }
    if (argument.startsWith('--identity-map=') && !identityMapSeen) {
      identityMapPath = argument.slice('--identity-map='.length);
      identityMapSeen = true;
      continue;
    }
    throw new Error('Unsupported or repeated replacement runner argument.');
  }
  if (!mode) throw new Error('Pass exactly one of --diagnose, --preflight, or --execute.');
  const environmentCAPath = env.SUPABASE_DB_CA_CERT_PATH || null;
  if (
    argumentCAPath
    && environmentCAPath
    && resolve(argumentCAPath) !== resolve(environmentCAPath)
  ) {
    throw new Error('Choose exactly one database CA certificate path.');
  }
  const caCertPath = argumentCAPath || environmentCAPath;
  if (!caCertPath) throw new Error('A local Supabase database CA certificate is required.');
  return { mode, caCertPath, identityMapPath };
}

export function assertReplacementProjectRef(projectRef) {
  if (projectRef === REPLACEMENT_AUTHORIZATION.productionProjectRef) {
    throw new Error('Production project ref is explicitly forbidden.');
  }
  if (projectRef !== REPLACEMENT_AUTHORIZATION.stagingProjectRef) {
    throw new Error('Only the exact authorized Staging project ref is accepted.');
  }
  return projectRef;
}

export function assertInteractiveReplacementConfirmation(answer, {
  inputIsTTY = process.stdin.isTTY,
  outputIsTTY = process.stderr.isTTY,
} = {}) {
  if (!inputIsTTY || !outputIsTTY) {
    throw new Error('Replacement confirmation requires a live interactive terminal.');
  }
  if (answer !== REQUIRED_REPLACEMENT_CONFIRMATION) {
    throw new Error('Replacement confirmation did not match exactly.');
  }
  return true;
}

export function buildV3IdentityMap(profiles) {
  if (!Array.isArray(profiles) || profiles.length !== 6) {
    throw new Error('Exactly six v2 QA identities are required to resolve v3.');
  }
  return new QAIdentityMap(Object.fromEntries(profiles.map((profile) => [
    profile.role,
    {
      auth_user_id: profile.id,
      expected_email: profile.email,
      logical_role: profile.role,
      projected_relations: QA_IDENTITY_RELATIONS[profile.role],
    },
  ])));
}

export function validateReplacementArtifacts({
  descriptor,
  manifest,
  authorization = REPLACEMENT_AUTHORIZATION,
}) {
  validateCleanupDescriptor(descriptor, {
    authorization: {
      ...V2_CLEANUP_AUTHORIZATION,
      manifestHash: authorization.v2ManifestHash,
      identityMapFingerprint: authorization.v2IdentityFingerprint,
      ownershipFingerprint: authorization.v2OwnershipFingerprint,
    },
  });
  const v3 = validateCanonicalManifest(manifest);
  const split = splitManifestForAtomicReplacement(manifest);
  const exact = [
    ['v2 manifest', descriptor.manifestHash, authorization.v2ManifestHash],
    ['v2 identity', descriptor.identityMapFingerprint, authorization.v2IdentityFingerprint],
    ['v2 ownership', descriptor.ownershipFingerprint, authorization.v2OwnershipFingerprint],
    ['v2 descriptor', descriptor.descriptorFingerprint, authorization.v2DescriptorFingerprint],
    ['v3 manifest', manifest.manifestHash, authorization.v3ManifestHash],
    ['v3 identity', manifest.identityMapFingerprint, authorization.v3IdentityFingerprint],
    ['v3 ownership', manifest.rowOwnershipFingerprint, authorization.v3OwnershipFingerprint],
    ['v3 marker', manifest.seedRegistryId, authorization.v3MarkerId],
    ['v3 base rows', split.baseRows, authorization.baseRows],
    ['v3 total rows', manifest.expectedRowCount, authorization.totalRows],
    ['v3 tables', manifest.expectedTableCount, authorization.tables],
  ];
  const mismatch = exact.find(([, actual, expected]) => actual !== expected);
  if (mismatch) throw new Error(`Replacement artifact mismatch: ${mismatch[0]}.`);
  return { v3, split };
}

async function readPreferenceCatalog(client) {
  const result = await client.query(
    `select attribute.attname as name,
            pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) as type,
            attribute.attnotnull as not_null
     from pg_attribute attribute
     join pg_class table_row on table_row.oid = attribute.attrelid
     join pg_namespace schema_row on schema_row.oid = table_row.relnamespace
     where schema_row.nspname = 'public'
       and table_row.relname = $1
       and attribute.attnum > 0
       and not attribute.attisdropped
     order by attribute.attnum`,
    [PREFERENCE_TABLE],
  );
  return result.rows;
}

async function readPreferencePrimaryKeyCatalog(client) {
  const result = await client.query(
    `select constraint_row.conname as name,
            constraint_row.condeferrable as deferrable,
            constraint_row.condeferred as initially_deferred,
            array(
              select column_row.attname
              from unnest(constraint_row.conkey) with ordinality key(attnum, position)
              join pg_attribute column_row
                on column_row.attrelid = table_row.oid and column_row.attnum = key.attnum
              order by key.position
            )::text[] as columns
       from pg_constraint constraint_row
       join pg_class table_row on table_row.oid = constraint_row.conrelid
       join pg_namespace schema_row on schema_row.oid = table_row.relnamespace
      where constraint_row.contype = 'p'
        and schema_row.nspname = 'public'
        and table_row.relname = $1
      order by constraint_row.conname`,
    [PREFERENCE_TABLE],
  );
  return result.rows;
}

export function validatePreferencePrimaryKeyCatalog(rows) {
  if (rows.length !== 1) throw new Error('Preference primary key contract changed.');
  const [row] = rows;
  if (
    row.name !== PREFERENCE_PRIMARY_KEY.name
    || canonicalJson(row.columns) !== canonicalJson(PREFERENCE_PRIMARY_KEY.columns)
    || row.deferrable !== PREFERENCE_PRIMARY_KEY.deferrable
    || row.initially_deferred !== PREFERENCE_PRIMARY_KEY.initiallyDeferred
  ) {
    throw new Error('Preference primary key contract changed.');
  }
  return true;
}

export async function readExternalConstraintCatalog(client, descriptor) {
  const datasetTables = descriptor.tables.map((table) => table.table);
  const result = await client.query(
    `select constraint_row.conname as name,
            source.relname as source_table,
            target.relname as target_table,
            constraint_row.confdeltype as delete_action,
            constraint_row.condeferrable as deferrable,
            constraint_row.condeferred as initially_deferred,
            array(
              select source_column.attname
              from unnest(constraint_row.conkey) with ordinality key(attnum, position)
              join pg_attribute source_column
                on source_column.attrelid = source.oid and source_column.attnum = key.attnum
              order by key.position
            )::text[] as source_columns,
            array(
              select target_column.attname
              from unnest(constraint_row.confkey) with ordinality key(attnum, position)
              join pg_attribute target_column
                on target_column.attrelid = target.oid and target_column.attnum = key.attnum
              order by key.position
            )::text[] as target_columns,
            array(
              select not source_column.attnotnull
              from unnest(constraint_row.conkey) with ordinality key(attnum, position)
              join pg_attribute source_column
                on source_column.attrelid = source.oid and source_column.attnum = key.attnum
              order by key.position
            ) as nullable
     from pg_constraint constraint_row
     join pg_class source on source.oid = constraint_row.conrelid
     join pg_namespace source_schema on source_schema.oid = source.relnamespace
     join pg_class target on target.oid = constraint_row.confrelid
     join pg_namespace target_schema on target_schema.oid = target.relnamespace
     where constraint_row.contype = 'f'
       and source_schema.nspname = 'public'
       and target_schema.nspname = 'public'
       and target.relname = any($1::text[])
       and not (source.relname = any($1::text[]))
     order by constraint_row.conname`,
    [datasetTables],
  );
  return result.rows;
}

export function validateExternalConstraintCatalog(rows, {
  expectedCount = EXTERNAL_CONSTRAINT_COUNT,
  expectedFingerprint = EXTERNAL_CONSTRAINT_CATALOG_FINGERPRINT,
} = {}) {
  if (rows.length !== expectedCount) {
    throw new Error('External dataset FK catalog count changed.');
  }
  const preferenceRows = rows.filter((row) => Object.hasOwn(
    EXPECTED_EXTERNAL_CONSTRAINTS,
    row.name,
  ));
  if (preferenceRows.length !== 3) {
    throw new Error('Expected exactly three preference dataset constraints.');
  }
  for (const row of preferenceRows) {
    const expected = EXPECTED_EXTERNAL_CONSTRAINTS[row.name];
    if (
      row.source_table !== PREFERENCE_TABLE
      || row.target_table !== expected.targetTable
      || row.delete_action !== expected.deleteAction
      || row.deferrable !== false
      || row.initially_deferred !== false
      || canonicalJson(row.source_columns) !== canonicalJson(expected.sourceColumns)
      || canonicalJson(row.target_columns) !== canonicalJson(expected.targetColumns)
      || canonicalJson(row.nullable) !== canonicalJson(expected.nullable)
    ) {
      throw new Error(`External constraint contract changed: ${row.name}.`);
    }
  }
  if (externalConstraintCatalogFingerprint(rows) !== expectedFingerprint) {
    throw new Error('External dataset FK catalog fingerprint changed.');
  }
  return true;
}

export function externalConstraintCatalogFingerprint(rows) {
  return sha256(canonicalJson(rows));
}

async function readOtherExternalReferenceCount(client, descriptor, constraints) {
  let count = 0;
  for (const constraint of constraints) {
    if (Object.hasOwn(EXPECTED_EXTERNAL_CONSTRAINTS, constraint.name)) continue;
    const target = descriptor.tables.find((table) => table.table === constraint.target_table);
    if (!target) throw new Error('External FK target left the replacement descriptor.');
    const targetPredicate = identityPredicate(
      target,
      target.rows.map((row) => row.identity),
      1,
      'target_row',
    );
    const join = constraint.source_columns.map((column, index) => (
      `source_row.${quoteIdentifier(column)} is not distinct from `
      + `target_row.${quoteIdentifier(constraint.target_columns[index])}`
    )).join(' and ');
    const result = await client.query(
      `select count(*)::integer as count
       from public.${quoteIdentifier(constraint.source_table)} source_row
       join public.${quoteIdentifier(constraint.target_table)} target_row on ${join}
       where ${targetPredicate.sql}`,
      targetPredicate.values,
    );
    count += result.rows[0].count;
  }
  return count;
}

export function validatePreferenceCatalog(rows) {
  const actual = rows.map((row) => ({
    name: row.name,
    type: row.type,
    nullable: !row.not_null,
  }));
  if (canonicalJson(actual) !== canonicalJson(PREFERENCE_COLUMNS)) {
    throw new Error('Preference column/type/nullability contract changed.');
  }
}

async function readPreferenceRows(client, descriptor, { forUpdate = false } = {}) {
  const seasons = descriptor.tables.find((table) => table.table === 'tournament_seasons')
    .rows.map((row) => row.identity.id);
  const tournaments = descriptor.tables.find((table) => table.table === 'tournaments')
    .rows.map((row) => row.identity.id);
  return client.query(
    `select user_id, organization_id, active_season_id, active_tournament_id,
            updated_at::text as updated_at
     from public.user_tournament_context_preferences
     where organization_id = $1
        or active_season_id = any($2::uuid[])
        or active_tournament_id = any($3::uuid[])
     order by user_id, organization_id
     ${forUpdate ? 'for update' : ''}`,
    [descriptor.organizationId, seasons, tournaments],
  );
}

function tableRows(manifest, tableName) {
  return manifest.operations.filter((operation) => operation.table === tableName)
    .flatMap((operation) => operation.rows);
}

export function assertSharedPreferenceDestinations(preference, descriptor, manifest) {
  const v2Seasons = new Set(descriptor.tables.find(
    (table) => table.table === 'tournament_seasons',
  ).rows.map((row) => row.identity.id));
  const v2Tournaments = new Set(descriptor.tables.find(
    (table) => table.table === 'tournaments',
  ).rows.map((row) => row.identity.id));
  const v3Organizations = new Set(tableRows(manifest, 'tournament_organizations').map((row) => row.id));
  const v3Seasons = new Set(tableRows(manifest, 'tournament_seasons').map((row) => row.id));
  const v3TournamentRows = tableRows(manifest, 'tournaments');
  const v3Tournaments = new Set(v3TournamentRows.map((row) => row.id));
  const seasonIsValid = preference.active_season_id === null || (
    v2Seasons.has(preference.active_season_id)
    && v3Seasons.has(preference.active_season_id)
  );
  const tournamentIsValid = preference.active_tournament_id === null || (
    v2Tournaments.has(preference.active_tournament_id)
    && v3Tournaments.has(preference.active_tournament_id)
  );
  const selectedTournament = preference.active_tournament_id === null
    ? null
    : v3TournamentRows.find((row) => row.id === preference.active_tournament_id);
  const contextIsCoherent = (selectedTournament === null || selectedTournament === undefined)
    ? preference.active_tournament_id === null
    : preference.active_season_id !== null
      && selectedTournament.organization_id === preference.organization_id
      && selectedTournament.season_id === preference.active_season_id;
  if (
    preference.organization_id !== descriptor.organizationId
    || !v3Organizations.has(preference.organization_id)
    || !seasonIsValid
    || !tournamentIsValid
    || !contextIsCoherent
  ) {
    throw new Error('Preference destinations are not identical between v2 and v3.');
  }
  return true;
}

function identityPredicate(table, rows, startAt = 1, alias = 'candidate') {
  const values = [];
  const prefix = alias ? `${quoteIdentifier(alias)}.` : '';
  const predicates = rows.map((row) => `(${table.identity.map((column) => {
    values.push(row[column]);
    return `${prefix}${quoteIdentifier(column)} is not distinct from $${startAt + values.length - 1}`;
  }).join(' and ')})`);
  return { sql: predicates.join(' or '), values };
}

function replacementOwnedRows(descriptor, manifest) {
  const grouped = new Map();
  for (const table of descriptor.tables) {
    grouped.set(table.table, {
      table: table.table,
      identity: table.identity,
      rows: table.rows.map((row) => row.identity),
    });
  }
  for (const operation of manifest.operations) {
    const entry = grouped.get(operation.table);
    if (!entry || canonicalJson(entry.identity) !== canonicalJson(operation.identity)) {
      throw new Error(`v2/v3 table identity contract changed: ${operation.table}.`);
    }
    const seen = new Set(entry.rows.map(identityKey));
    for (const row of operation.rows) {
      const identity = Object.fromEntries(operation.identity.map((column) => [column, row[column]]));
      if (!seen.has(identityKey(identity))) entry.rows.push(identity);
    }
  }
  return [...grouped.values()].sort((left, right) => left.table.localeCompare(right.table));
}

async function readForeignInventory(client, descriptor, manifest) {
  const inventory = [];
  for (const table of replacementOwnedRows(descriptor, manifest)) {
    const predicate = identityPredicate(table, table.rows);
    const result = await client.query(
      `select count(*)::integer as count,
              md5(coalesce(string_agg(
                md5(to_jsonb(candidate)::text),
                '' order by md5(to_jsonb(candidate)::text)
              ), '')) as fingerprint
       from public.${quoteIdentifier(table.table)} as candidate
       where not (${predicate.sql})`,
      predicate.values,
    );
    inventory.push({ table: table.table, ...result.rows[0] });
  }
  return inventory;
}

async function readUnrelatedInventory(client, descriptor) {
  const protectedTables = descriptor.tables.map((table) => table.table);
  const catalog = await client.query(
    `select tablename
     from pg_tables
     where schemaname = 'public' and not (tablename = any($1::text[]))
     order by tablename`,
    [protectedTables],
  );
  const inventory = [];
  for (const { tablename } of catalog.rows) {
    const result = await client.query(
      `select count(*)::integer as count,
              md5(coalesce(string_agg(
                md5(to_jsonb(candidate)::text),
                '' order by md5(to_jsonb(candidate)::text)
              ), '')) as fingerprint
       from public.${quoteIdentifier(tablename)} as candidate`,
    );
    inventory.push({ table: tablename, ...result.rows[0] });
  }
  return inventory;
}

async function readTriggerInventory(client, descriptor) {
  const tables = [...descriptor.tables.map((table) => table.table), PREFERENCE_TABLE].sort();
  const result = await client.query(
    `select table_row.relname as table_name,
            trigger_row.tgname as trigger_name,
            trigger_row.tgenabled as enabled,
            function_row.proname as function_name,
            pg_get_triggerdef(trigger_row.oid) as definition
     from pg_trigger trigger_row
     join pg_class table_row on table_row.oid = trigger_row.tgrelid
     join pg_namespace schema_row on schema_row.oid = table_row.relnamespace
     join pg_proc function_row on function_row.oid = trigger_row.tgfoid
     where schema_row.nspname = 'public'
       and table_row.relname = any($1::text[])
       and not trigger_row.tgisinternal
     order by table_row.relname, trigger_row.tgname`,
    [tables],
  );
  return result.rows;
}

function validatePreferenceUpdatedAtTrigger(triggers) {
  const trigger = triggers.find((row) => (
    row.table_name === PREFERENCE_TABLE
    && row.trigger_name === 'user_tournament_context_touch_updated_at'
  ));
  if (
    !trigger
    || trigger.enabled !== 'O'
    || trigger.function_name !== 'touch_tournament_workspace_updated_at'
    || !/BEFORE UPDATE ON public\.user_tournament_context_preferences/i.test(trigger.definition)
  ) {
    throw new Error('Preference updated_at trigger contract changed.');
  }
}

async function readExactMarker(client, manifest) {
  const markerOperation = splitManifestForAtomicReplacement(manifest).markerOperations[0];
  const expected = markerOperation.rows[0];
  const result = await client.query(
    `select organization_id, actor_user_id, actor_type, action, resource_type, resource_id,
            team_entry_id, tournament_id, metadata, created_at
     from public.tournament_audit_log
     where resource_type = $1 and resource_id = $2 and action = $3`,
    [expected.resource_type, expected.resource_id, expected.action],
  );
  return {
    count: result.rowCount,
    exact: result.rowCount === 1
      && canonicalJson(normalizeValue(result.rows[0])) === canonicalJson(normalizeValue(expected)),
  };
}

async function readV2MarkerCount(client, descriptor) {
  const result = await client.query(
    `select count(*)::integer as count
     from public.tournament_audit_log
     where resource_type = $1 and resource_id = $2 and action = $3`,
    [
      descriptor.marker.identity.resource_type,
      descriptor.marker.identity.resource_id,
      descriptor.marker.identity.action,
    ],
  );
  return result.rows[0].count;
}

function exclusiveV3Manifest(descriptor, manifest) {
  const v2ByTable = new Map(descriptor.tables.map((table) => [
    table.table,
    new Set(table.rows.map((row) => identityKey(row.identity))),
  ]));
  return {
    ...manifest,
    operations: manifest.operations.map((operation) => ({
      ...operation,
      rows: operation.rows.filter((row) => {
        const identity = Object.fromEntries(operation.identity.map((column) => [column, row[column]]));
        return !v2ByTable.get(operation.table)?.has(identityKey(identity));
      }),
    })).filter((operation) => operation.rows.length > 0),
  };
}

function exclusiveV2Descriptor(descriptor, manifest) {
  const v3ByTable = new Map();
  for (const operation of manifest.operations) {
    const identities = v3ByTable.get(operation.table) || new Set();
    for (const row of operation.rows) {
      identities.add(identityKey(Object.fromEntries(
        operation.identity.map((column) => [column, row[column]]),
      )));
    }
    v3ByTable.set(operation.table, identities);
  }
  return {
    ...descriptor,
    tables: descriptor.tables.map((table) => ({
      ...table,
      rows: table.rows.filter((row) => !v3ByTable.get(table.table)?.has(identityKey(row.identity))),
    })).filter((table) => table.rows.length > 0),
  };
}

async function readRoleValidation(client, manifest) {
  const users = manifest.users;
  const result = await client.query(
    `select
       (select count(*)::integer from public.tournament_organization_members where user_id = $1 and role = 'owner') as owner_membership,
       (select count(*)::integer from public.tournament_team_managers where user_id = $1 and role = 'captain') as owner_captains,
       (select count(*)::integer from public.tournament_roster_players where arma2_user_id = $1) as owner_roster,
       (select count(*)::integer from public.tournament_organization_members where user_id = $2 and role = 'admin') as admin_membership,
       (select count(*)::integer from public.tournament_team_managers where user_id = $2 and role = 'captain') as admin_captains,
       (select count(*)::integer from public.tournament_roster_players where arma2_user_id = $2) as admin_roster,
       (select count(*)::integer from public.tournament_organization_members where user_id = $3 and role = 'collaborator') as collaborator_membership,
       (select count(*)::integer from public.tournament_team_managers where user_id = $3) as collaborator_managers,
       (select count(*)::integer from public.tournament_roster_players where arma2_user_id = $3) as collaborator_roster,
       (select count(*)::integer from public.tournament_match_operations where $3 in (opened_by, submitted_by, validated_by, official_by)) as collaborator_matches,
       (select count(*)::integer from public.tournament_team_managers where user_id = $4 and role = 'delegate') as delegate_managers,
       (select count(*)::integer from public.tournament_roster_players where arma2_user_id = $4) as delegate_roster,
       (select count(*)::integer from public.tournament_organization_members where user_id = $4) as delegate_memberships,
       (select count(*)::integer from public.tournament_roster_players where arma2_user_id = $5) as player_roster,
       (select count(*)::integer from public.tournament_organization_members where user_id = $5) as player_memberships,
       (select count(*)::integer from public.tournament_team_managers where user_id = $5) as player_managers`,
    [users.owner.id, users.admin.id, users.collaborator.id, users.delegate.id, users.player.id],
  );
  const references = await client.query(
    `select distinct source_schema.nspname as schema_name,
            source.relname as table_name,
            source_column.attname as column_name
     from pg_constraint constraint_row
     join pg_class source on source.oid = constraint_row.conrelid
     join pg_namespace source_schema on source_schema.oid = source.relnamespace
     join pg_class target on target.oid = constraint_row.confrelid
     join pg_namespace target_schema on target_schema.oid = target.relnamespace
     join lateral generate_subscripts(constraint_row.conkey, 1) position on true
     join pg_attribute source_column
       on source_column.attrelid = source.oid
      and source_column.attnum = constraint_row.conkey[position]
     join pg_attribute target_column
       on target_column.attrelid = target.oid
      and target_column.attnum = constraint_row.confkey[position]
     where constraint_row.contype = 'f'
       and source_schema.nspname = 'public'
       and (source.relname like 'tournament\\_%' escape '\\'
            or source.relname = 'user_tournament_context_preferences')
       and target_schema.nspname in ('auth', 'public')
       and target.relname in ('users', 'usuarios')
       and target_column.attname = 'id'
     order by source.relname, source_column.attname`,
  );
  const mismatches = [];
  let outsiderRelations = 0;
  for (const user of Object.values(users)) {
    for (const reference of references.rows) {
      const actual = await client.query(
        `select count(*)::integer as count
         from ${quoteIdentifier(reference.schema_name)}.${quoteIdentifier(reference.table_name)}
         where ${quoteIdentifier(reference.column_name)} = $1`,
        [user.id],
      );
      const expectedFromManifest = manifest.operations.reduce((sum, operation) => (
        sum + (operation.table === reference.table_name
          ? operation.rows.filter((row) => row[reference.column_name] === user.id).length
          : 0)
      ), 0);
      const expectedPreference = user.role === 'owner'
        && reference.table_name === PREFERENCE_TABLE
        && reference.column_name === 'user_id'
        ? 1
        : 0;
      const expected = expectedFromManifest + expectedPreference;
      if (user.role === 'outsider') outsiderRelations += actual.rows[0].count;
      if (actual.rows[0].count !== expected) {
        mismatches.push({
          role: user.role,
          table: reference.table_name,
          column: reference.column_name,
          actual: actual.rows[0].count,
          expected,
        });
      }
    }
  }
  return {
    ...result.rows[0],
    outsider_relations: outsiderRelations,
    additional_relation_mismatches: mismatches,
  };
}

function validateRoleValidation(actual) {
  const { additional_relation_mismatches: mismatches, ...counts } = actual;
  const expected = {
    owner_membership: 1,
    owner_captains: 7,
    owner_roster: 0,
    admin_membership: 1,
    admin_captains: 1,
    admin_roster: 0,
    collaborator_membership: 1,
    collaborator_managers: 0,
    collaborator_roster: 0,
    collaborator_matches: 0,
    delegate_managers: 1,
    delegate_roster: 1,
    delegate_memberships: 0,
    player_roster: 1,
    player_memberships: 0,
    player_managers: 0,
    outsider_relations: 0,
  };
  if (canonicalJson(counts) !== canonicalJson(expected) || mismatches.length !== 0) {
    throw new Error('Final v3 QA role relations changed.');
  }
}

async function lockReplacementTables(client, descriptor) {
  for (const table of descriptor.tables.map((entry) => entry.table).sort()) {
    await client.query(`lock table public.${quoteIdentifier(table)} in access exclusive mode`);
  }
  await client.query(
    'lock table public.user_tournament_context_preferences in access exclusive mode',
  );
}

async function rollbackQuietly(client) {
  try {
    await client.query('rollback');
  } catch {
    // The failed transaction may already be aborted.
  }
}

function same(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

export function shouldRetryReplacement(error, attempt, maxAttempts) {
  return error?.code === '40001' && attempt < maxAttempts;
}

async function hitFailpoint(client, active, stage) {
  if (active === stage) await client.query('select 1 / 0 as qa_deliberate_replacement_failure');
}

export async function preflightReplacement(client, {
  descriptor = TORNEOS_DEMO_V2_CLEANUP_DESCRIPTOR,
  manifest,
  profiles,
  targetProjectRef = REPLACEMENT_AUTHORIZATION.stagingProjectRef,
  artifactAuthorization = REPLACEMENT_AUTHORIZATION,
  advisoryLock,
  advisoryLockReleasedBy = 'transaction_end',
  lockPreference = false,
} = {}) {
  assertReplacementProjectRef(targetProjectRef);
  const advisoryLockReport = replacementAdvisoryLockReport(
    client,
    advisoryLock,
    advisoryLockReleasedBy,
  );
  validateReplacementArtifacts({ descriptor, manifest, authorization: artifactAuthorization });
  deriveQAIdentityRelations(manifest);

  const preferenceResult = await readPreferenceRows(client, descriptor, {
    forUpdate: lockPreference,
  });
  if (preferenceResult.rowCount !== 1) {
    throw new Error('Expected exactly one external preference referencing v2.');
  }
  const preference = preferenceResult.rows[0];
  if (preference.user_id !== manifest.users.owner.id) {
    throw new Error('External preference is not associated with the QA owner.');
  }
  assertSharedPreferenceDestinations(preference, descriptor, manifest);
  const actualPreferenceFingerprint = preferenceFingerprint(preference);

  const preferenceCatalog = await readPreferenceCatalog(client);
  validatePreferenceCatalog(preferenceCatalog);
  const preferencePrimaryKey = await readPreferencePrimaryKeyCatalog(client);
  validatePreferencePrimaryKeyCatalog(preferencePrimaryKey);
  const constraints = await readExternalConstraintCatalog(client, descriptor);
  validateExternalConstraintCatalog(constraints);
  const otherExternalReferences = await readOtherExternalReferenceCount(
    client,
    descriptor,
    constraints,
  );
  if (otherExternalReferences !== 0) {
    throw new Error('Unexpected external data references v2.');
  }

  const triggers = await readTriggerInventory(client, descriptor);
  validatePreferenceUpdatedAtTrigger(triggers);
  const v2State = await readV2ExpectedState(client, descriptor);
  const v2ExclusiveState = await readV2ExpectedState(
    client,
    exclusiveV2Descriptor(descriptor, manifest),
  );
  const v2Marker = await readV2MarkerCount(client, descriptor);
  const v3State = await readManifestExpectedState(client, manifest);
  const v3Marker = await readExactMarker(client, manifest);
  const profilesBefore = await readQAProfileSnapshot(client, profiles);
  if (!profilesBefore.intact) throw new Error('Exactly six QA profiles must be intact.');
  const guards = await readV2DeleteGuards(client, descriptor);
  if (!validateV2DeleteGuards(guards)) throw new Error('Delete guard contract mismatch.');
  const foreignInventory = await readForeignInventory(client, descriptor, manifest);
  const unrelatedInventory = await readUnrelatedInventory(client, descriptor);

  const v2Absent = v2ExclusiveState.present === 0 && v2Marker === 0;
  const v3Exact = v3State.expected === manifest.expectedRowCount
    && v3State.present === manifest.expectedRowCount
    && v3State.identityPresent === manifest.expectedRowCount
    && v3State.mismatched.length === 0
    && v3Marker.count === 1
    && v3Marker.exact;
  if (v2Absent && v3Exact) {
    return {
      status: 'skip',
      reason: 'v3_already_exact',
      preference,
      preferenceFingerprint: actualPreferenceFingerprint,
      preferenceCatalog,
      preferencePrimaryKey,
      constraints,
      profiles: profilesBefore,
      foreignInventory,
      unrelatedInventory,
      triggers,
      guards,
      otherExternalReferences,
      v2State,
      v2ExclusiveState,
      v2Marker,
      v3State,
      ...advisoryLockReport,
    };
  }
  if (v3Marker.count !== 0) throw new Error('v2 and v3 are present simultaneously or v3 is partial.');

  const v2 = await preflightV2Cleanup(client, {
    descriptor,
    profiles,
    advisoryLockAcquired: advisoryLock.acquired,
    targetProjectRef,
  });
  if (v2.status !== 'ready') {
    const error = new Error(`Replacement v2 preflight rejected: ${v2.reason}.`);
    error.preflight = v2;
    throw error;
  }
  const exclusive = await readManifestExpectedState(
    client,
    exclusiveV3Manifest(descriptor, manifest),
  );
  if (exclusive.identityPresent !== 0) {
    throw new Error('v3-exclusive rows are already present without an exact v3 marker.');
  }
  return {
    status: 'ready',
    reason: 'atomic_replacement_authorized',
    preference,
    preferenceFingerprint: actualPreferenceFingerprint,
    preferenceCatalog,
    preferencePrimaryKey,
    constraints,
    profiles: profilesBefore,
    foreignInventory,
    unrelatedInventory,
    triggers,
    guards,
    otherExternalReferences,
    v2State,
    v2ExclusiveState,
    v2Marker,
    v3State,
    v2,
    ...advisoryLockReport,
  };
}

async function restorePreference(client, preference) {
  const result = await client.query(
    `insert into public.user_tournament_context_preferences (
       user_id, organization_id, active_season_id, active_tournament_id, updated_at
     ) values ($1, $2, $3, $4, $5)
     returning user_id, organization_id, active_season_id, active_tournament_id,
               updated_at::text as updated_at`,
    [
      preference.user_id,
      preference.organization_id,
      preference.active_season_id,
      preference.active_tournament_id,
      preference.updated_at,
    ],
  );
  if (result.rowCount !== 1) throw new Error('Preference restore did not insert exactly one row.');
  return result.rows[0];
}

async function validateFinalState(client, {
  descriptor,
  manifest,
  profiles,
  preflight,
}) {
  const v2 = await readV2ExpectedState(client, descriptor);
  const v2Exclusive = await readV2ExpectedState(
    client,
    exclusiveV2Descriptor(descriptor, manifest),
  );
  const v2Marker = await readV2MarkerCount(client, descriptor);
  const v3 = await readManifestExpectedState(client, manifest);
  const marker = await readExactMarker(client, manifest);
  const preferenceResult = await readPreferenceRows(client, descriptor);
  const preference = preferenceResult.rows[0];
  const preferenceHash = preferenceResult.rowCount === 1
    ? preferenceFingerprint(preference)
    : null;
  const profilesAfter = await readQAProfileSnapshot(client, profiles);
  const foreignAfter = await readForeignInventory(client, descriptor, manifest);
  const unrelatedAfter = await readUnrelatedInventory(client, descriptor);
  const triggersAfter = await readTriggerInventory(client, descriptor);
  const guardsAfter = await readV2DeleteGuards(client, descriptor);
  const roles = await readRoleValidation(client, manifest);
  const finalConstraints = await readExternalConstraintCatalog(client, descriptor);
  validateExternalConstraintCatalog(finalConstraints);
  const finalPreferenceCatalog = await readPreferenceCatalog(client);
  validatePreferenceCatalog(finalPreferenceCatalog);
  const finalPreferencePrimaryKey = await readPreferencePrimaryKeyCatalog(client);
  validatePreferencePrimaryKeyCatalog(finalPreferencePrimaryKey);
  const otherExternalReferences = await readOtherExternalReferenceCount(
    client,
    descriptor,
    finalConstraints,
  );
  validateRoleValidation(roles);
  const finalChecks = {
    v2_absent: v2Exclusive.present === 0 && v2Marker === 0,
    v3_exact: v3.expected === manifest.expectedRowCount
      && v3.present === manifest.expectedRowCount
      && v3.identityPresent === manifest.expectedRowCount
      && v3.missing.length === 0
      && v3.mismatched.length === 0,
    marker_exact: marker.count === 1 && marker.exact,
    preference_exact: preferenceResult.rowCount === 1
      && preferenceHash === preflight.preferenceFingerprint,
    updated_at_exact: normalizeValue(preference?.updated_at)
      === normalizeValue(preflight.preference.updated_at),
    profiles_exact: profilesAfter.intact
      && profilesAfter.fingerprint === preflight.profiles.fingerprint,
    foreign_data_exact: same(foreignAfter, preflight.foreignInventory),
    unrelated_data_exact: same(unrelatedAfter, preflight.unrelatedInventory),
    triggers_exact: same(triggersAfter, preflight.triggers),
    guards_exact: validateV2DeleteGuards(guardsAfter),
    preference_catalog_exact: same(finalPreferenceCatalog, preflight.preferenceCatalog),
    preference_primary_key_exact: same(
      finalPreferencePrimaryKey,
      preflight.preferencePrimaryKey,
    ),
    external_constraint_catalog_exact: same(finalConstraints, preflight.constraints),
    other_external_references_absent: otherExternalReferences === 0,
  };
  const failures = Object.entries(finalChecks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  if (failures.length > 0) {
    throw new Error(`Atomic replacement final validation rejected: ${failures.join(', ')}.`);
  }
  return {
    v2Rows: v2Exclusive.present,
    markerV2: v2Marker,
    v3Rows: v3.present,
    markerV3: marker.count,
    tables: manifest.expectedTableCount,
    partialRows: v3.missing.length + v3.mismatched.length,
    preferenceRestored: true,
    preferenceFingerprintIdentical: true,
    updatedAtIdentical: true,
    profiles: profilesAfter,
    outsiderRelations: roles.outsider_relations,
    otherExternalReferences,
    foreignDataIdentical: true,
    triggersIdentical: true,
    deleteGuardsRestored: true,
  };
}

export async function executeReplacement(client, {
  descriptor = TORNEOS_DEMO_V2_CLEANUP_DESCRIPTOR,
  manifest,
  profiles,
  maxAttempts = 3,
  backoffMs = [25, 75],
  onRetry = () => {},
  failpoint = null,
  failAfterCleanupDeleteCount = null,
  failAfterV3BaseRowCount = null,
  afterPreflight = () => {},
  artifactAuthorization = REPLACEMENT_AUTHORIZATION,
} = {}) {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) {
    throw new Error('Replacement retry attempts must be between 1 and 3.');
  }
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await client.query('begin isolation level serializable');
    try {
      await client.query("set local idle_in_transaction_session_timeout = '5min'");
      const advisoryLock = await acquireReplacementAdvisoryLock(client);
      await lockReplacementTables(client, descriptor);
      const preflight = await preflightReplacement(client, {
        descriptor,
        manifest,
        profiles,
        artifactAuthorization,
        advisoryLock,
        advisoryLockReleasedBy: 'transaction_end',
        lockPreference: true,
      });
      if (preflight.status === 'skip') {
        await client.query('rollback');
        return { status: 'skip', attempts: attempt, retries: attempt - 1, preflight };
      }
      await afterPreflight({ attempt, preflight });
      await hitFailpoint(client, failpoint, 'before_preference_delete');
      const deletedPreference = await client.query(
        `delete from public.user_tournament_context_preferences
         where user_id = $1 and organization_id = $2`,
        [preflight.preference.user_id, preflight.preference.organization_id],
      );
      if (deletedPreference.rowCount !== 1) {
        throw new Error('Preference temporary deletion did not affect exactly one row.');
      }
      await hitFailpoint(client, failpoint, 'after_preference_delete');

      const cleanup = await deleteV2InCurrentTransaction(client, {
        descriptor,
        failAfterDeleteCount: failAfterCleanupDeleteCount,
      });
      await hitFailpoint(client, failpoint, 'after_v2_cleanup');

      const insertedBase = await insertManifestBaseInCurrentTransaction(client, manifest, {
        failAfterRowCount: failAfterV3BaseRowCount,
      });
      if (insertedBase.insertedRows !== REPLACEMENT_AUTHORIZATION.baseRows) {
        throw new Error('v3 base insertion did not insert exactly 586 rows.');
      }
      await hitFailpoint(client, failpoint, 'before_preference_restore');
      const restoredPreference = await restorePreference(client, preflight.preference);
      if (preferenceFingerprint(restoredPreference) !== preflight.preferenceFingerprint) {
        throw new Error('Restored preference is not byte-exact.');
      }
      await hitFailpoint(client, failpoint, 'after_preference_restore');
      await hitFailpoint(client, failpoint, 'before_v3_marker');

      const insertedMarker = await insertManifestMarkerInCurrentTransaction(client, manifest);
      if (insertedMarker.insertedRows !== 1) {
        throw new Error('v3 marker insertion did not insert exactly one row.');
      }
      await hitFailpoint(client, failpoint, 'after_v3_marker');
      const validation = await validateFinalState(client, {
        descriptor,
        manifest,
        profiles,
        preflight,
      });
      await client.query('commit');
      return {
        status: 'replaced',
        attempts: attempt,
        retries: attempt - 1,
        deletedV2: cleanup.deleted,
        insertedV3Base: insertedBase.insertedRows,
        insertedV3Marker: insertedMarker.insertedRows,
        lastWrite: 'v3_marker',
        validation,
      };
    } catch (error) {
      await rollbackQuietly(client);
      if (!shouldRetryReplacement(error, attempt, maxAttempts)) throw error;
      const delayMs = backoffMs[Math.min(attempt - 1, backoffMs.length - 1)] || 0;
      onRetry({ code: '40001', attempt, nextAttempt: attempt + 1, delayMs });
      if (delayMs > 0) await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
    }
  }
  throw new Error('Unreachable replacement retry state.');
}

function assertDiagnosticPass(diagnostic) {
  if (diagnostic.status !== 'pass') {
    const error = new Error(`Connection diagnostic rejected: ${diagnostic.failedChecks.join(', ')}.`);
    error.connectionDiagnostic = diagnostic;
    throw error;
  }
  return diagnostic;
}

function preflightReport(preflight) {
  const preference = preferenceSnapshotReport(preflight.preference);
  const count = (value) => Array.isArray(value) ? value.length : Number(value || 0);
  return {
    status: preflight.status,
    reason: preflight.reason,
    v2: {
      expected: REPLACEMENT_AUTHORIZATION.totalRows,
      present: preflight.v2State.present,
      exact: preflight.v2State.exact,
      missing: count(preflight.v2State.missing),
      mismatched: count(preflight.v2State.mismatched),
    },
    v3: {
      expected: REPLACEMENT_AUTHORIZATION.totalRows,
      present: preflight.v3State.present,
      mismatched: count(preflight.v3State.mismatched),
    },
    preference: {
      count: 1,
      currentFingerprint: preference.fingerprint,
      dynamicSnapshot: true,
      ownerFingerprint: preference.owner,
      organizationFingerprint: preference.organization,
      seasonFingerprint: preference.season,
      tournamentFingerprint: preference.tournament,
      seasonIsNull: preference.seasonIsNull,
      tournamentIsNull: preference.tournamentIsNull,
      updatedAtCaptured: preference.updatedAtCaptured,
      destinationsShared: true,
      semanticallyValid: true,
      restorable: true,
    },
    constraints: 3,
    additionalExternalReferences: preflight.otherExternalReferences,
    profiles: preflight.profiles.count,
    authPlanRows: 0,
    storageStatePlanRows: 0,
    advisoryLockAttempted: preflight.advisoryLockAttempted,
    advisoryLockAcquired: preflight.advisoryLockAcquired,
    advisoryLockSource: preflight.advisoryLockSource,
    advisoryLockNamespaceFingerprint: preflight.advisoryLockNamespaceFingerprint,
    advisoryLockReleasedBy: preflight.advisoryLockReleasedBy,
  };
}

async function main() {
  assertReplacementProjectRef(REPLACEMENT_AUTHORIZATION.stagingProjectRef);
  const options = parseReplacementArguments(process.argv.slice(2));
  validateCleanupDescriptor(TORNEOS_DEMO_V2_CLEANUP_DESCRIPTOR);
  const databaseCA = await loadStrictDatabaseCA(options.caCertPath);
  const identity = options.mode === 'diagnose'
    ? null
    : await loadV2IdentityMap(options.identityMapPath);
  const manifest = identity
    ? buildCanonicalManifest({ identityMap: buildV3IdentityMap(identity.profiles) })
    : null;
  if (manifest) validateReplacementArtifacts({
    descriptor: TORNEOS_DEMO_V2_CLEANUP_DESCRIPTOR,
    manifest,
  });
  const databasePassword = readPasswordFromMacOSDialog();
  const target = buildAuthorizedStagingTarget(databasePassword);
  assertReplacementProjectRef(target.projectRef);

  if (options.mode === 'execute') {
    if (!process.stdin.isTTY || !process.stderr.isTTY) {
      throw new Error('Replacement confirmation requires a live interactive terminal.');
    }
    const prompt = createInterface({ input: process.stdin, output: process.stderr });
    const answer = await prompt.question(
      `Escribí "${REQUIRED_REPLACEMENT_CONFIRMATION}" para continuar: `,
    );
    prompt.close();
    assertInteractiveReplacementConfirmation(answer);
  }

  const client = new pg.Client(buildStrictPgConfiguration(target, databaseCA));
  await client.connect();
  try {
    if (options.mode === 'diagnose') {
      await client.query('begin read only');
      try {
        console.log(JSON.stringify(
          assertDiagnosticPass(await diagnoseConnectedDatabase(client, target)),
          null,
          2,
        ));
      } finally {
        await client.query('rollback');
      }
      return;
    }
    if (options.mode === 'preflight') {
      await client.query('begin isolation level repeatable read read only');
      try {
        const diagnostic = assertDiagnosticPass(await diagnoseConnectedDatabase(client, target));
        const advisoryLock = await acquireReplacementAdvisoryLock(client);
        const preflight = await preflightReplacement(client, {
          manifest,
          profiles: identity.profiles,
          advisoryLock,
          advisoryLockReleasedBy: 'rollback',
        });
        console.log(JSON.stringify({
          connectionDiagnostic: diagnostic,
          preflight: preflightReport(preflight),
        }, null, 2));
      } finally {
        await client.query('rollback');
      }
      return;
    }
    const diagnostic = assertDiagnosticPass(await diagnoseConnectedDatabase(client, target));
    const retries = [];
    const result = await executeReplacement(client, {
      manifest,
      profiles: identity.profiles,
      onRetry: (event) => retries.push(event),
    });
    console.log(JSON.stringify({
      projectRef: REPLACEMENT_AUTHORIZATION.stagingProjectRef,
      connectionDiagnostic: diagnostic,
      result,
      retries,
    }, null, 2));
  } finally {
    await client.end();
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((error) => {
    console.error(JSON.stringify({ error: safeError(error) }, null, 2));
    process.exitCode = 1;
  });
}
