#!/usr/bin/env node

import { lstat, readFile, realpath } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline/promises';
import { spawnSync } from 'node:child_process';
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
  canonicalJson,
  descriptorFingerprint,
  identityKey,
  rowContentHash,
  sha256,
  validateCleanupDescriptor,
} from './torneos-demo-v2-cleanup-contract.mjs';
import { TORNEOS_DEMO_V2_CLEANUP_DESCRIPTOR } from './torneos-demo-v2-cleanup-descriptor.mjs';

const STAGING_PROJECT_REF = 'hhyvmhgpapyuzjgxfnqv';
const PRODUCTION_PROJECT_REF = 'rcyuuoaqfwcembdajcss';
const V3_MARKER_ID = '85ab8c2e-6cd5-54c4-86b6-fbbfc0f0b050';
const REQUIRED_CONFIRMATION = 'ELIMINAR torneos-demo-v2 DE STAGING';
const DEFAULT_IDENTITY_MAP_FILE = 'torneos-demo-v2-identity-map.local';
const ROLE_NAMES = Object.freeze([
  'owner',
  'admin',
  'collaborator',
  'delegate',
  'player',
  'outsider',
]);

const ALLOWED_DELETE_GUARDS = Object.freeze([
  ['tournament_audit_log', 'tournament_audit_append_only', 'reject_tournament_audit_mutation'],
  ['tournament_discipline_ledgers', 'tournament_discipline_ledgers_immutable', 'reject_tournament_projection_mutation'],
  ['tournament_match_events', 'tournament_match_events_history_guard', 'protect_tournament_match_child_history'],
  ['tournament_match_events', 'tournament_match_events_no_delete', 'reject_tournament_match_child_delete'],
  ['tournament_match_operation_players', 'tournament_match_operation_players_history_guard', 'protect_tournament_match_child_history'],
  ['tournament_match_operations', 'tournament_match_operations_history_guard', 'protect_tournament_match_operation_history'],
  ['tournament_match_outcomes', 'tournament_match_outcomes_history_guard', 'protect_tournament_match_child_history'],
  ['tournament_match_reviews', 'tournament_match_reviews_no_delete', 'reject_tournament_match_child_delete'],
  ['tournament_match_scores', 'tournament_match_scores_history_guard', 'protect_tournament_match_child_history'],
  ['tournament_organization_members', 'tournament_organization_members_protect_owner', 'protect_tournament_organization_owner'],
  ['tournament_player_statistics', 'tournament_player_statistics_immutable', 'reject_tournament_projection_mutation'],
  ['tournament_standings_revisions', 'tournament_standings_revisions_no_delete', 'reject_tournament_projection_mutation'],
  ['tournament_team_standings', 'tournament_team_standings_immutable', 'reject_tournament_projection_mutation'],
  ['tournament_team_statistics', 'tournament_team_statistics_immutable', 'reject_tournament_projection_mutation'],
].map(([table, trigger, functionName]) => Object.freeze({ table, trigger, functionName })));

function quoteIdentifier(value) {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error('Unsafe immutable SQL identifier.');
  return `"${value}"`;
}

function isPathWithin(parent, candidate) {
  const path = relative(parent, candidate);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..');
}

function gitStatus(args, cwd) {
  return spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

function assertNoCredentialFields(value, path = 'identity_map') {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoCredentialFields(entry, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    if (/(?:password|token|service[_-]?role|secret|cookie|session)/i.test(key)) {
      throw new Error(`Forbidden credential field in ${path}: ${key}.`);
    }
    assertNoCredentialFields(entry, `${path}.${key}`);
  }
}

function identityMapFingerprint(raw) {
  return sha256(canonicalJson(Object.fromEntries(ROLE_NAMES.map((role) => {
    const identity = raw[role];
    return [role, {
      auth_user_id: identity.auth_user_id,
      email_fingerprint: sha256(identity.expected_email),
      logical_role: identity.logical_role,
      projected_relations: [...identity.projected_relations].sort(),
    }];
  }))));
}

export async function loadV2IdentityMap(filePath = DEFAULT_IDENTITY_MAP_FILE, {
  cwd = process.cwd(),
  expectedFingerprint = TORNEOS_DEMO_V2_CLEANUP_DESCRIPTOR.identityMapFingerprint,
} = {}) {
  const requested = resolve(cwd, filePath);
  const stats = await lstat(requested).catch(() => null);
  if (!stats?.isFile() || stats.isSymbolicLink()) {
    throw new Error('The v2 identity map must be a regular, non-symlink file.');
  }
  if ((stats.mode & 0o077) !== 0) {
    throw new Error('The v2 identity map permissions must be 0600 or stricter.');
  }
  const absolute = await realpath(requested);
  const repository = gitStatus(['rev-parse', '--show-toplevel'], cwd);
  if (repository.status === 0) {
    const root = await realpath(repository.stdout.trim());
    if (isPathWithin(root, absolute)) {
      const repositoryPath = relative(root, absolute);
      const tracked = gitStatus(['ls-files', '--error-unmatch', '--', repositoryPath], root);
      const ignored = gitStatus(['check-ignore', '--quiet', '--', repositoryPath], root);
      if (tracked.status === 0 || ignored.status !== 0) {
        throw new Error('The v2 identity map inside the repository must be untracked and ignored.');
      }
    }
  }
  const raw = JSON.parse(await readFile(absolute, 'utf8'));
  assertNoCredentialFields(raw);
  const unknown = Object.keys(raw).filter((role) => !ROLE_NAMES.includes(role));
  const missing = ROLE_NAMES.filter((role) => !raw[role]);
  if (unknown.length > 0 || missing.length > 0) {
    throw new Error('The v2 identity map must contain exactly the six authorized QA roles.');
  }
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const profiles = ROLE_NAMES.map((role) => {
    const identity = raw[role];
    if (
      identity.logical_role !== role
      || !uuid.test(identity.auth_user_id)
      || typeof identity.expected_email !== 'string'
      || !Array.isArray(identity.projected_relations)
    ) {
      throw new Error(`The v2 identity ${role} is malformed.`);
    }
    return Object.freeze({
      role,
      id: identity.auth_user_id.toLowerCase(),
      email: identity.expected_email.trim().toLowerCase(),
    });
  });
  const fingerprint = identityMapFingerprint(raw);
  if (fingerprint !== expectedFingerprint) {
    throw new Error('The v2 identity map fingerprint does not match the immutable descriptor.');
  }
  return Object.freeze({ fingerprint, profiles: Object.freeze(profiles) });
}

export function parseCleanupArguments(args, env = process.env) {
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
    throw new Error('NODE_TLS_REJECT_UNAUTHORIZED=0 is forbidden.');
  }
  let mode = null;
  let argumentCAPath = null;
  let identityMapPath = env.QA_V2_IDENTITY_MAP_FILE || DEFAULT_IDENTITY_MAP_FILE;
  let identityMapArgumentSeen = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (['--diagnose', '--preflight', '--execute'].includes(argument)) {
      if (mode) throw new Error('Choose exactly one cleanup runner mode.');
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
    if (argument === '--identity-map' && args[index + 1] && !identityMapArgumentSeen) {
      identityMapPath = args[index + 1];
      identityMapArgumentSeen = true;
      index += 1;
      continue;
    }
    if (argument.startsWith('--identity-map=') && !identityMapArgumentSeen) {
      identityMapPath = argument.slice('--identity-map='.length);
      identityMapArgumentSeen = true;
      continue;
    }
    throw new Error('Unsupported or repeated cleanup runner argument.');
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

export function assertCleanupProjectRef(projectRef) {
  if (projectRef === PRODUCTION_PROJECT_REF) {
    throw new Error('Production project ref is explicitly forbidden.');
  }
  if (projectRef !== STAGING_PROJECT_REF) {
    throw new Error('Only the exact authorized Staging project ref is accepted.');
  }
  return projectRef;
}

export function assertManualConfirmation(answer) {
  if (answer !== REQUIRED_CONFIRMATION) {
    throw new Error('Cleanup confirmation did not match exactly.');
  }
  return true;
}

function identityPredicate(table, rows, startAt = 1, alias = null) {
  const prefix = alias ? `${quoteIdentifier(alias)}.` : '';
  const values = [];
  const predicates = rows.map((row) => {
    const columns = table.identity.map((column, index) => {
      values.push(row.identity[column]);
      return `${prefix}${quoteIdentifier(column)} is not distinct from $${startAt + values.length - 1}`;
    });
    return `(${columns.join(' and ')})`;
  });
  return { sql: predicates.join(' or '), values };
}

function identityFromRow(table, row) {
  return Object.fromEntries(table.identity.map((column) => [column, row[column]]));
}

export async function readV2ExpectedState(client, descriptor) {
  const tableResults = [];
  let present = 0;
  let exact = 0;
  let missing = 0;
  let mismatched = 0;
  for (const table of descriptor.tables) {
    const predicate = identityPredicate(table, table.rows);
    const result = await client.query(
      `select ${table.columns.map(quoteIdentifier).join(', ')}
       from public.${quoteIdentifier(table.table)}
       where ${predicate.sql}`,
      predicate.values,
    );
    const actualByIdentity = new Map();
    for (const row of result.rows) {
      const key = identityKey(identityFromRow(table, row));
      const values = actualByIdentity.get(key) || [];
      values.push(row);
      actualByIdentity.set(key, values);
    }
    let tableExact = 0;
    let tableMissing = 0;
    let tableMismatched = 0;
    for (const expected of table.rows) {
      const matches = actualByIdentity.get(identityKey(expected.identity)) || [];
      if (matches.length === 0) {
        tableMissing += 1;
      } else if (
        matches.length === 1
        && rowContentHash(matches[0], table) === expected.contentHash
      ) {
        tableExact += 1;
      } else {
        tableMismatched += 1;
      }
    }
    const tablePresent = table.rows.length - tableMissing;
    present += tablePresent;
    exact += tableExact;
    missing += tableMissing;
    mismatched += tableMismatched;
    tableResults.push({
      table: table.table,
      expected: table.rows.length,
      present: tablePresent,
      exact: tableExact,
      missing: tableMissing,
      mismatched: tableMismatched,
    });
  }
  return { expected: descriptor.expected.totalRows, present, exact, missing, mismatched, tables: tableResults };
}

async function schemaIssues(client, descriptor) {
  const issues = [];
  for (const table of descriptor.tables) {
    const result = await client.query(
      `select column_name
       from information_schema.columns
       where table_schema = 'public' and table_name = $1`,
      [table.table],
    );
    const actual = new Set(result.rows.map((row) => row.column_name));
    if (actual.size === 0) issues.push({ table: table.table, code: 'missing_table' });
    else if (table.columns.some((column) => !actual.has(column))) {
      issues.push({ table: table.table, code: 'missing_columns' });
    }
  }
  return issues;
}

export async function readV2OwnershipInventory(client, descriptor) {
  const inventory = [];
  for (const table of descriptor.tables) {
    const values = table.ownership.values;
    const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
    const result = await client.query(
      `select count(*)::integer as count
       from public.${quoteIdentifier(table.table)}
       where ${quoteIdentifier(table.ownership.column)} in (${placeholders})`,
      values,
    );
    inventory.push({
      table: table.table,
      expected: table.rows.length,
      actual: result.rows[0].count,
    });
  }
  return inventory;
}

async function foreignInventory(client, descriptor) {
  const inventory = [];
  for (const table of descriptor.tables) {
    const predicate = identityPredicate(table, table.rows, 1, 'candidate');
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
    inventory.push({
      table: table.table,
      count: result.rows[0].count,
      fingerprint: result.rows[0].fingerprint,
    });
  }
  return inventory;
}

async function unrelatedTableInventory(client, descriptor) {
  const protectedTables = new Set(descriptor.tables.map((table) => table.table));
  const catalog = await client.query(
    `select tablename
     from pg_tables
     where schemaname = 'public'
     order by tablename`,
  );
  const inventory = [];
  for (const { tablename } of catalog.rows) {
    if (protectedTables.has(tablename)) continue;
    const result = await client.query(
      `select count(*)::integer as count,
              md5(coalesce(string_agg(
                md5(to_jsonb(candidate)::text),
                '' order by md5(to_jsonb(candidate)::text)
              ), '')) as fingerprint
       from public.${quoteIdentifier(tablename)} as candidate`,
    );
    inventory.push({
      table: tablename,
      count: result.rows[0].count,
      fingerprint: result.rows[0].fingerprint,
    });
  }
  return inventory;
}

export async function readQAProfileSnapshot(client, profiles) {
  if (!Array.isArray(profiles) || profiles.length !== 6) {
    throw new Error('Exactly six QA profiles are required for cleanup preflight.');
  }
  const result = await client.query(
    `select id, lower(email) as email
     from public.usuarios
     where id = any($1::uuid[])
     order by id`,
    [profiles.map((profile) => profile.id)],
  );
  const expected = new Map(profiles.map((profile) => [profile.id, profile.email]));
  const intact = result.rowCount === 6 && result.rows.every((row) => (
    expected.get(row.id) === row.email
  ));
  return {
    count: result.rowCount,
    intact,
    fingerprint: sha256(canonicalJson(result.rows.map((row) => ({
      id: sha256(row.id),
      email: sha256(row.email),
    })))),
  };
}

async function v3MarkerCount(client) {
  const result = await client.query(
    `select count(*)::integer as count
     from public.tournament_audit_log
     where resource_type = 'qa_seed_execution'
       and action = 'qa.seed.applied'
       and (resource_id = $1 or metadata ->> 'seed_key' = 'torneos-demo-v3')`,
    [V3_MARKER_ID],
  );
  return result.rows[0].count;
}

export async function readV2DeleteGuards(client, descriptor) {
  const tables = descriptor.tables.map((table) => table.table);
  const result = await client.query(
    `select table_row.relname as table_name,
            trigger_row.tgname as trigger_name,
            trigger_row.tgenabled as enabled,
            function_row.proname as function_name
     from pg_trigger trigger_row
     join pg_class table_row on table_row.oid = trigger_row.tgrelid
     join pg_namespace schema_row on schema_row.oid = table_row.relnamespace
     join pg_proc function_row on function_row.oid = trigger_row.tgfoid
     where schema_row.nspname = 'public'
       and table_row.relname = any($1::text[])
       and not trigger_row.tgisinternal
       and trigger_row.tgenabled <> 'D'
       and (trigger_row.tgtype & 8) = 8
     order by table_row.relname, trigger_row.tgname`,
    [tables],
  );
  return result.rows.map((row) => ({
    table: row.table_name,
    trigger: row.trigger_name,
    enabled: row.enabled,
    functionName: row.function_name,
  }));
}

function guardKey(guard) {
  return `${guard.table}.${guard.trigger}.${guard.functionName}`;
}

export function validateV2DeleteGuards(guards) {
  const actual = guards.map(guardKey).sort();
  const expected = ALLOWED_DELETE_GUARDS.map(guardKey).sort();
  return canonicalJson(actual) === canonicalJson(expected)
    && guards.every((guard) => guard.enabled === 'O');
}

async function markerResult(client, descriptor) {
  const descriptorTable = descriptor.tables.find((entry) => entry.table === descriptor.marker.table);
  const marker = descriptorTable.rows.find((row) => (
    identityKey(row.identity) === identityKey(descriptor.marker.identity)
  ));
  const predicate = identityPredicate(descriptorTable, [marker]);
  const result = await client.query(
    `select ${descriptorTable.columns.map(quoteIdentifier).join(', ')}
     from public.${quoteIdentifier(descriptor.marker.table)}
     where ${predicate.sql}`,
    predicate.values,
  );
  return {
    uniqueAndExact: result.rowCount === 1
      && rowContentHash(result.rows[0], descriptorTable) === marker.contentHash,
    expectedHash: descriptor.marker.contentHash,
  };
}

export async function preflightV2Cleanup(client, {
  descriptor = TORNEOS_DEMO_V2_CLEANUP_DESCRIPTOR,
  profiles,
  advisoryLockAcquired = false,
  targetProjectRef = STAGING_PROJECT_REF,
} = {}) {
  assertCleanupProjectRef(targetProjectRef);
  const descriptorHash = descriptorFingerprint(descriptor);
  if (descriptorHash !== descriptor.descriptorFingerprint) {
    throw new Error('Runtime v2 descriptor fingerprint mismatch.');
  }
  const schema = await schemaIssues(client, descriptor);
  if (schema.length > 0) {
    return { status: 'reject', reason: 'schema_mismatch', schemaIssues: schema };
  }
  let lockAcquired = advisoryLockAcquired;
  if (!lockAcquired) {
    const lock = await client.query(
      'select pg_try_advisory_xact_lock(hashtextextended($1, 0)) as acquired',
      [`cleanup:${descriptor.seedKey}`],
    );
    lockAcquired = lock.rows[0]?.acquired === true;
  }
  if (!lockAcquired) return { status: 'reject', reason: 'advisory_lock_unavailable' };

  const expectedState = await readV2ExpectedState(client, descriptor);
  const ownership = await readV2OwnershipInventory(client, descriptor);
  const unexpectedOwnership = ownership.filter((entry) => entry.actual !== entry.expected);
  const profilesBefore = await readQAProfileSnapshot(client, profiles);
  const v3Markers = await v3MarkerCount(client);
  const foreign = await foreignInventory(client, descriptor);
  const unrelated = await unrelatedTableInventory(client, descriptor);
  const guards = await readV2DeleteGuards(client, descriptor);
  const marker = await markerResult(client, descriptor);
  const failures = [];
  if (!marker.uniqueAndExact) failures.push('marker_v2_mismatch');
  if (v3Markers !== 0) failures.push('marker_v3_present');
  if (
    expectedState.present !== descriptor.expected.totalRows
    || expectedState.exact !== descriptor.expected.totalRows
    || expectedState.missing !== 0
    || expectedState.mismatched !== 0
  ) failures.push('partial_or_tampered_v2');
  if (unexpectedOwnership.length > 0) failures.push('unexpected_v2_ownership');
  if (!profilesBefore.intact) failures.push('qa_profiles_mismatch');
  if (!validateV2DeleteGuards(guards)) failures.push('delete_guard_contract_mismatch');
  return {
    status: failures.length === 0 ? 'ready' : 'reject',
    reason: failures[0] || 'ownership_verified',
    projectRef: targetProjectRef,
    failures,
    descriptorFingerprint: descriptor.descriptorFingerprint,
    expected: descriptor.expected.totalRows,
    present: expectedState.present,
    exact: expectedState.exact,
    missing: expectedState.missing,
    mismatched: expectedState.mismatched,
    tables: descriptor.expected.tables,
    markerV2: marker.uniqueAndExact ? 1 : 0,
    markerV3: v3Markers,
    unexpectedOwnership,
    profiles: profilesBefore,
    foreignInventory: foreign,
    unrelatedTableInventory: unrelated,
    deleteGuards: guards.map(({ table, trigger }) => ({ table, trigger })),
    authPlanRows: 0,
  };
}

export async function lockCleanupTables(client, descriptor) {
  for (const table of [...descriptor.tables].map((entry) => entry.table).sort()) {
    await client.query(
      `lock table public.${quoteIdentifier(table)} in access exclusive mode`,
    );
  }
}

export async function setDeleteGuards(client, enabled) {
  const action = enabled ? 'enable' : 'disable';
  for (const guard of ALLOWED_DELETE_GUARDS) {
    await client.query(
      `alter table public.${quoteIdentifier(guard.table)} ${action} trigger ${quoteIdentifier(guard.trigger)}`,
    );
  }
}

async function deleteDescriptorRow(client, table, row) {
  const predicate = identityPredicate(table, [row]);
  return client.query(
    `delete from public.${quoteIdentifier(table.table)} where ${predicate.sql}`,
    predicate.values,
  );
}

async function deleteFinalParentsAndMarker(client, descriptor) {
  const tournamentTable = descriptor.tables.find((table) => table.table === 'tournaments');
  const seasonTable = descriptor.tables.find((table) => table.table === 'tournament_seasons');
  const rootTable = descriptor.tables.find((table) => table.table === 'tournament_organizations');
  const auditTable = descriptor.tables.find((table) => table.table === descriptor.marker.table);
  if (rootTable.rows.length !== 1) throw new Error('Expected exactly one v2 organization root.');
  const tournamentPredicate = identityPredicate(tournamentTable, tournamentTable.rows, 1);
  const seasonPredicate = identityPredicate(
    seasonTable,
    seasonTable.rows,
    tournamentPredicate.values.length + 1,
  );
  const rootPredicate = identityPredicate(
    rootTable,
    rootTable.rows,
    tournamentPredicate.values.length + seasonPredicate.values.length + 1,
  );
  const markerRow = auditTable.rows.find((row) => (
    identityKey(row.identity) === identityKey(descriptor.marker.identity)
  ));
  const markerPredicate = identityPredicate(
    auditTable,
    [markerRow],
    tournamentPredicate.values.length
      + seasonPredicate.values.length
      + rootPredicate.values.length
      + 1,
  );
  const result = await client.query(
    `with deleted_tournaments as (
       delete from public.tournaments
       where ${tournamentPredicate.sql}
       returning 1
     ), deleted_seasons as (
       delete from public.tournament_seasons
       where ${seasonPredicate.sql}
       returning 1
     ), deleted_root as (
       delete from public.tournament_organizations
       where ${rootPredicate.sql}
       returning 1
     )
     delete from public.tournament_audit_log
     where ${markerPredicate.sql}
     returning
       (select count(*)::integer from deleted_tournaments) as tournaments_deleted,
       (select count(*)::integer from deleted_seasons) as seasons_deleted,
       (select count(*)::integer from deleted_root) as root_deleted`,
    [
      ...tournamentPredicate.values,
      ...seasonPredicate.values,
      ...rootPredicate.values,
      ...markerPredicate.values,
    ],
  );
  return {
    markerDeleted: result.rowCount,
    tournamentsDeleted: result.rows[0]?.tournaments_deleted || 0,
    seasonsDeleted: result.rows[0]?.seasons_deleted || 0,
    rootDeleted: result.rows[0]?.root_deleted || 0,
  };
}

export async function deleteV2InCurrentTransaction(client, {
  descriptor = TORNEOS_DEMO_V2_CLEANUP_DESCRIPTOR,
  failAfterDeleteCount = null,
} = {}) {
  await setDeleteGuards(client, false);

  const auditTable = descriptor.tables.find((table) => table.table === descriptor.marker.table);
  const markerKey = identityKey(descriptor.marker.identity);
  const nonMarkerAuditRows = auditTable.rows.filter((row) => (
    identityKey(row.identity) !== markerKey
  ));
  let deleted = 0;
  for (const row of [...nonMarkerAuditRows].reverse()) {
    const result = await deleteDescriptorRow(client, auditTable, row);
    if (result.rowCount !== 1) throw new Error('Expected one owned audit row.');
    deleted += 1;
  }
  const deleteTables = descriptor.tables.filter((table) => (
    table.table !== 'tournament_organizations'
    && table.table !== 'tournament_seasons'
    && table.table !== 'tournaments'
    && table.table !== descriptor.marker.table
  )).reverse();
  for (const table of deleteTables) {
    for (const row of [...table.rows].reverse()) {
      const result = await deleteDescriptorRow(client, table, row);
      if (result.rowCount !== 1) {
        throw new Error(`Expected one owned ${table.table} row, deleted ${result.rowCount}.`);
      }
      deleted += 1;
      if (failAfterDeleteCount !== null && deleted >= failAfterDeleteCount) {
        await client.query('select 1 / 0 as qa_deliberate_cleanup_failure');
      }
    }
  }
  const finalRows = await deleteFinalParentsAndMarker(client, descriptor);
  if (
    finalRows.tournamentsDeleted !== 4
    || finalRows.seasonsDeleted !== 1
    || finalRows.rootDeleted !== 1
    || finalRows.markerDeleted !== 1
  ) {
    throw new Error('Final v2 marker and parent deletion did not delete exactly seven rows.');
  }
  deleted += 7;
  if (deleted !== descriptor.expected.totalRows) {
    throw new Error(`Cleanup deleted ${deleted}, expected ${descriptor.expected.totalRows}.`);
  }

  await setDeleteGuards(client, true);
  return { deleted, deleteGuardsRestored: true };
}

function sameInventory(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

async function rollbackQuietly(client) {
  try {
    await client.query('rollback');
  } catch {
    // The transaction may already be aborted.
  }
}

function isSerializationFailure(error) {
  return error?.code === '40001';
}

export async function executeV2Cleanup(client, {
  descriptor = TORNEOS_DEMO_V2_CLEANUP_DESCRIPTOR,
  profiles,
  maxAttempts = 3,
  backoffMs = [25, 75],
  onRetry = () => {},
  failAfterDeleteCount = null,
  afterPreflight = () => {},
} = {}) {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) {
    throw new Error('Cleanup retry attempts must be between 1 and 3.');
  }
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await client.query('begin isolation level serializable');
    try {
      await client.query("set local idle_in_transaction_session_timeout = '5min'");
      const lock = await client.query(
        'select pg_try_advisory_xact_lock(hashtextextended($1, 0)) as acquired',
        [`cleanup:${descriptor.seedKey}`],
      );
      if (lock.rows[0]?.acquired !== true) {
        const error = new Error('Cleanup advisory lock is already held.');
        error.code = '55P03';
        throw error;
      }
      await lockCleanupTables(client, descriptor);
      const preflight = await preflightV2Cleanup(client, {
        descriptor,
        profiles,
        advisoryLockAcquired: true,
      });
      if (preflight.status !== 'ready') {
        const error = new Error(`Cleanup preflight rejected: ${preflight.reason}.`);
        error.preflight = preflight;
        throw error;
      }
      await afterPreflight({ attempt, preflight });
      const cleanup = await deleteV2InCurrentTransaction(client, {
        descriptor,
        failAfterDeleteCount,
      });
      const { deleted } = cleanup;
      const postState = await readV2ExpectedState(client, descriptor);
      const postOwnership = await readV2OwnershipInventory(client, descriptor);
      const postProfiles = await readQAProfileSnapshot(client, profiles);
      const postForeign = await foreignInventory(client, descriptor);
      const postUnrelated = await unrelatedTableInventory(client, descriptor);
      const postV3Marker = await v3MarkerCount(client);
      const postGuards = await readV2DeleteGuards(client, descriptor);
      if (
        postState.present !== 0
        || postOwnership.some((entry) => entry.actual !== 0)
        || !postProfiles.intact
        || postProfiles.fingerprint !== preflight.profiles.fingerprint
        || !sameInventory(postForeign, preflight.foreignInventory)
        || !sameInventory(postUnrelated, preflight.unrelatedTableInventory)
        || postV3Marker !== 0
        || !validateV2DeleteGuards(postGuards)
      ) {
        throw new Error('Cleanup post-validation rejected before commit.');
      }
      await client.query('commit');
      return {
        status: 'cleaned',
        attempts: attempt,
        retries: attempt - 1,
        deleted,
        tables: descriptor.expected.tables,
        markerV2: 0,
        markerV3: 0,
        orphanRows: 0,
        profiles: postProfiles,
        foreignInventory: postForeign,
        unrelatedTableInventory: postUnrelated,
        deleteGuardsRestored: true,
        preflight,
      };
    } catch (error) {
      await rollbackQuietly(client);
      if (!isSerializationFailure(error) || attempt === maxAttempts) throw error;
      const delayMs = backoffMs[Math.min(attempt - 1, backoffMs.length - 1)] || 0;
      onRetry({ code: '40001', attempt, nextAttempt: attempt + 1, delayMs });
      if (delayMs > 0) await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
    }
  }
  throw new Error('Unreachable cleanup retry state.');
}

function assertDiagnosticPass(diagnostic) {
  if (diagnostic.status !== 'pass') {
    const error = new Error(`Connection diagnostic rejected: ${diagnostic.failedChecks.join(', ')}.`);
    error.connectionDiagnostic = diagnostic;
    throw error;
  }
  return diagnostic;
}

async function main() {
  validateCleanupDescriptor(TORNEOS_DEMO_V2_CLEANUP_DESCRIPTOR);
  assertCleanupProjectRef(STAGING_PROJECT_REF);
  const options = parseCleanupArguments(process.argv.slice(2));
  const databaseCA = await loadStrictDatabaseCA(options.caCertPath);
  const identityMap = options.mode === 'diagnose'
    ? null
    : await loadV2IdentityMap(options.identityMapPath);
  const databasePassword = readPasswordFromMacOSDialog();
  const target = buildAuthorizedStagingTarget(databasePassword);
  assertCleanupProjectRef(target.projectRef);

  if (options.mode === 'execute') {
    const confirmation = createInterface({ input: process.stdin, output: process.stderr });
    const answer = await confirmation.question(
      `Escribí "${REQUIRED_CONFIRMATION}" para continuar: `,
    );
    confirmation.close();
    assertManualConfirmation(answer);
  }

  const client = new pg.Client(buildStrictPgConfiguration(target, databaseCA));
  await client.connect();
  try {
    if (options.mode === 'diagnose') {
      await client.query('begin read only');
      try {
        const diagnostic = assertDiagnosticPass(
          await diagnoseConnectedDatabase(client, target),
        );
        console.log(JSON.stringify(diagnostic, null, 2));
      } finally {
        await client.query('rollback');
      }
      return;
    }
    const diagnostic = assertDiagnosticPass(await diagnoseConnectedDatabase(client, target));
    if (options.mode === 'preflight') {
      await client.query('begin isolation level repeatable read read only');
      try {
        const preflight = await preflightV2Cleanup(client, {
          profiles: identityMap.profiles,
        });
        console.log(JSON.stringify({
          connectionDiagnostic: diagnostic,
          seedKey: TORNEOS_DEMO_V2_CLEANUP_DESCRIPTOR.seedKey,
          preflight,
        }, null, 2));
        if (preflight.status !== 'ready') {
          const error = new Error(`Cleanup preflight rejected: ${preflight.reason}.`);
          error.preflight = preflight;
          throw error;
        }
      } finally {
        await client.query('rollback');
      }
      return;
    }
    const retries = [];
    const result = await executeV2Cleanup(client, {
      profiles: identityMap.profiles,
      onRetry: (event) => retries.push(event),
    });
    console.log(JSON.stringify({
      projectRef: STAGING_PROJECT_REF,
      connectionDiagnostic: diagnostic,
      seedKey: TORNEOS_DEMO_V2_CLEANUP_DESCRIPTOR.seedKey,
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
