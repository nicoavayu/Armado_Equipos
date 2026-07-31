import { createHash } from 'node:crypto';

import pg from 'pg';

import { canonicalJson } from './torneos-qa-identity-map.mjs';

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function whereClause(row, columns, startAt = 1) {
  const values = [];
  const predicates = columns.map((column, index) => {
    values.push(row[column]);
    return `${quoteIdentifier(column)} is not distinct from $${startAt + index}`;
  });
  return { sql: predicates.join(' and '), values };
}

function identityOf(operation, row) {
  return Object.fromEntries(operation.identity.map((column) => [column, row[column]]));
}

function reportValues(values, personalIds) {
  return Object.fromEntries(Object.entries(values).map(([column, value]) => [
    column,
    personalIds.has(value)
      ? `[sha256:${createHash('sha256').update(value).digest('hex').slice(0, 16)}]`
      : value,
  ]));
}

async function rowExists(client, table, row, columns) {
  const where = whereClause(row, columns);
  const result = await client.query(
    `select 1 from public.${quoteIdentifier(table)} where ${where.sql} limit 1`,
    where.values,
  );
  return result.rowCount === 1;
}

function normalizeDatabaseValue(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeDatabaseValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
      key,
      normalizeDatabaseValue(entry),
    ]));
  }
  return value;
}

function databaseValueMatches(actualValue, expectedValue) {
  if (
    actualValue instanceof Date
    && typeof expectedValue === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(expectedValue)
  ) {
    return actualValue.toISOString().slice(0, 10) === expectedValue;
  }
  if (
    typeof expectedValue === 'number'
    && typeof actualValue === 'string'
    && actualValue.trim() !== ''
    && Number.isFinite(Number(actualValue))
  ) {
    return Number(actualValue) === expectedValue;
  }
  if (
    actualValue
    && typeof actualValue === 'object'
    && typeof expectedValue === 'string'
    && /^[{[]/.test(expectedValue.trim())
  ) {
    try {
      return canonicalJson(normalizeDatabaseValue(actualValue))
        === canonicalJson(JSON.parse(expectedValue));
    } catch {
      // Compare as a regular scalar below.
    }
  }
  return canonicalJson(normalizeDatabaseValue(actualValue))
    === canonicalJson(normalizeDatabaseValue(expectedValue));
}

function isSeedMarkerRow(operation, row) {
  return operation.table === 'tournament_audit_log'
    && row.resource_type === 'qa_seed_execution';
}

async function expectedRowState(client, operation, row) {
  const where = whereClause(row, operation.identity);
  const columns = Object.keys(row);
  const result = await client.query(
    `select ${columns.map(quoteIdentifier).join(', ')}
     from public.${quoteIdentifier(operation.table)}
     where ${where.sql}
     limit 2`,
    where.values,
  );
  if (result.rowCount === 0) return 'missing';
  if (result.rowCount !== 1) return 'duplicate';
  if (isSeedMarkerRow(operation, row)) return 'exact';
  return columns.every((column) => (
    databaseValueMatches(result.rows[0][column], row[column])
  )) ? 'exact' : 'mismatched';
}

async function requiredSchemaPreflight(client, manifest) {
  const issues = [];
  for (const operation of manifest.operations) {
    const columns = new Set(Object.keys(operation.rows[0] || {}));
    const result = await client.query(
      `select column_name
       from information_schema.columns
       where table_schema = 'public' and table_name = $1`,
      [operation.table],
    );
    if (result.rowCount === 0) {
      issues.push(`missing table public.${operation.table}`);
      continue;
    }
    const available = new Set(result.rows.map((row) => row.column_name));
    for (const column of columns) {
      if (!available.has(column)) {
        issues.push(`missing column public.${operation.table}.${column}`);
      }
    }
  }
  return issues;
}

export async function readSeedMarker(client, manifest) {
  const result = await client.query(
    `select id, organization_id, metadata
     from public.tournament_audit_log
     where resource_type = 'qa_seed_execution'
       and resource_id = $1
       and action = 'qa.seed.applied'
     order by id`,
    [manifest.seedRegistryId],
  );
  return result.rows;
}

async function readConflictingSeedMarkers(client, manifest) {
  const result = await client.query(
    `select resource_id, metadata
     from public.tournament_audit_log
     where organization_id = $1
       and resource_type = 'qa_seed_execution'
       and action = 'qa.seed.applied'
       and resource_id <> $2
     order by resource_id`,
    [manifest.organizationId, manifest.seedRegistryId],
  );
  return result.rows.filter((row) => row.metadata?.seed_key !== manifest.seedKey);
}

async function verifyRequiredUsers(client, manifest) {
  const issues = [];
  const references = [];
  for (const user of Object.values(manifest.users)) {
    const auth = await client.query(
      `select id, email, raw_app_meta_data
       from auth.users
       where id = $1 or lower(email) = $2
       order by (id = $1) desc`,
      [user.id, user.email],
    );
    const exactAuth = auth.rows.find((row) => row.id === user.id);
    if (!exactAuth) {
      issues.push({ role: user.role, code: 'auth_user_missing' });
      continue;
    }
    if (
      String(exactAuth.email || '').toLowerCase() !== user.email
      || auth.rows.some((row) => row.id !== user.id)
    ) {
      issues.push({ role: user.role, code: 'auth_email_identity_mismatch' });
      continue;
    }
    if (
      !manifest.acceptedAuthSeedKeys.includes(exactAuth.raw_app_meta_data?.qa_seed_key)
      || exactAuth.raw_app_meta_data?.qa_role !== user.role
    ) {
      issues.push({ role: user.role, code: 'personal_or_foreign_auth_user_rejected' });
      continue;
    }
    const profile = await client.query(
      'select email from public.usuarios where id = $1',
      [user.id],
    );
    if (
      profile.rowCount !== 1
      || String(profile.rows[0].email || '').toLowerCase() !== user.email
    ) {
      issues.push({ role: user.role, code: 'synced_profile_missing_or_mismatched' });
    }
  }

  const foreignKeys = await client.query(
    `select source_ns.nspname as schema_name,
            source.relname as table_name,
            source_col.attname as column_name
     from pg_constraint constraint_row
     join pg_class source on source.oid = constraint_row.conrelid
     join pg_namespace source_ns on source_ns.oid = source.relnamespace
     join pg_class target on target.oid = constraint_row.confrelid
     join pg_namespace target_ns on target_ns.oid = target.relnamespace
     join lateral generate_subscripts(constraint_row.conkey, 1) position on true
     join pg_attribute source_col
       on source_col.attrelid = source.oid
      and source_col.attnum = constraint_row.conkey[position]
     join pg_attribute target_col
       on target_col.attrelid = target.oid
      and target_col.attnum = constraint_row.confkey[position]
     where constraint_row.contype = 'f'
       and source_ns.nspname = 'public'
       and source.relname <> 'usuarios'
       and target_ns.nspname in ('auth', 'public')
       and target.relname in ('users', 'usuarios')
       and target_col.attname = 'id'
     order by source.relname, source_col.attname`,
  );
  for (const user of Object.values(manifest.users)) {
    for (const reference of foreignKeys.rows) {
      const actual = await client.query(
        `select count(*)::integer as count
         from ${quoteIdentifier(reference.schema_name)}.${quoteIdentifier(reference.table_name)}
         where ${quoteIdentifier(reference.column_name)} = $1`,
        [user.id],
      );
      const expected = manifest.operations.reduce((sum, operation) => (
        sum + (operation.table === reference.table_name
          ? operation.rows.filter((row) => row[reference.column_name] === user.id).length
          : 0)
      ), 0);
      if (actual.rows[0].count > 0 || expected > 0) {
        references.push({
          role: user.role,
          table: reference.table_name,
          column: reference.column_name,
          actual: actual.rows[0].count,
          expected,
        });
      }
    }
  }
  if (references.some((reference) => (
    reference.role === 'outsider' && reference.actual !== 0
  ))) {
    issues.push({ role: 'outsider', code: 'outsider_has_prior_relations' });
  }
  return { issues, references };
}

function referenceIssues(referenceSnapshot, { materialized }) {
  return referenceSnapshot.filter((reference) => (
    materialized
      ? reference.actual !== reference.expected
      : reference.actual !== 0
  )).map((reference) => ({
    role: reference.role,
    code: materialized
      ? 'incompatible_materialized_relation'
      : 'preexisting_relation_rejected',
    table: reference.table,
    column: reference.column,
    actual: reference.actual,
    expected: materialized ? reference.expected : 0,
  }));
}

function markerOwnershipMatches(marker, organization, manifest) {
  return (
    marker.organization_id === manifest.organizationId
    && marker.metadata?.seed_key === manifest.seedKey
    && marker.metadata?.manifest_hash === manifest.manifestHash
    && marker.metadata?.dataset_version === manifest.seedVersion
    && marker.metadata?.identity_map_fingerprint === manifest.identityMapFingerprint
    && marker.metadata?.creation_key === manifest.organizationCreationKey
    && marker.metadata?.ownership_fingerprint === manifest.rowOwnershipFingerprint
    && marker.metadata?.expected_row_count === manifest.expectedRowCount
    && marker.metadata?.expected_table_count === manifest.expectedTableCount
    && organization.rowCount === 1
    && organization.rows[0].creation_key === manifest.organizationCreationKey
  );
}

function markerIdentityChanged(marker, manifest) {
  return marker.metadata?.seed_key === manifest.seedKey
    && marker.metadata?.identity_map_fingerprint
    && marker.metadata.identity_map_fingerprint !== manifest.identityMapFingerprint;
}

async function countExpectedRows(client, manifest, { includeMissing = true } = {}) {
  let expected = 0;
  let present = 0;
  let identityPresent = 0;
  const missing = [];
  const mismatched = [];
  const personalIds = new Set(Object.values(manifest.users).map((user) => user.id));
  for (const operation of manifest.operations) {
    for (const row of operation.rows) {
      expected += 1;
      const state = await expectedRowState(client, operation, row);
      if (state !== 'missing') identityPresent += 1;
      if (state === 'exact') {
        present += 1;
      } else if (includeMissing && state === 'missing') {
        missing.push({
          table: operation.table,
          identity: reportValues(identityOf(operation, row), personalIds),
        });
      } else if (state !== 'missing') {
        mismatched.push({
          table: operation.table,
          identity: reportValues(identityOf(operation, row), personalIds),
          state,
        });
      }
    }
  }
  return {
    expected,
    present,
    identityPresent,
    missing,
    mismatched,
  };
}

export async function readManifestExpectedState(client, manifest, options = {}) {
  return countExpectedRows(client, manifest, options);
}

export async function preflightDatabase(client, manifest) {
  const schemaIssues = await requiredSchemaPreflight(client, manifest);
  const userVerification = await verifyRequiredUsers(client, manifest);
  const markers = schemaIssues.length === 0
    ? await readSeedMarker(client, manifest)
    : [];
  const conflictingMarkers = schemaIssues.length === 0
    ? await readConflictingSeedMarkers(client, manifest)
    : [];
  const userIssues = [
    ...userVerification.issues,
    ...referenceIssues(userVerification.references, { materialized: markers.length === 1 }),
  ];
  if (conflictingMarkers.length > 0) {
    return {
      status: 'reject',
      reason: 'replacement_authorization_required',
      schemaIssues,
      userIssues,
      collisions: conflictingMarkers.map((marker) => ({
        table: 'tournament_audit_log',
        seedKey: marker.metadata?.seed_key || 'unknown',
      })),
      expected: manifest.expectedRowCount,
      present: 0,
    };
  }
  if (markers.length > 1) {
    return {
      status: 'reject',
      reason: 'duplicate_seed_markers',
      schemaIssues,
      userIssues,
      collisions: [{ table: 'tournament_audit_log', count: markers.length }],
    };
  }

  if (markers.length === 1) {
    const marker = markers[0];
    const organization = await client.query(
      `select creation_key
       from public.tournament_organizations
       where id = $1 and slug = $2`,
      [manifest.organizationId, manifest.organizationSlug],
    );
    const ownershipMatches = markerOwnershipMatches(marker, organization, manifest);
    const counts = await countExpectedRows(client, manifest);
    if (
      ownershipMatches
      && counts.present === counts.expected
      && schemaIssues.length === 0
      && userIssues.length === 0
    ) {
      return {
        status: 'skip',
        reason: 'already_materialized',
        schemaIssues,
        userIssues,
        collisions: [],
        ...counts,
      };
    }
    return {
      status: 'reject',
      reason: markerIdentityChanged(marker, manifest)
        ? 'identity_map_changed'
        : (ownershipMatches ? 'partial_or_tampered_seed' : 'seed_marker_mismatch'),
      schemaIssues,
      userIssues,
      collisions: [],
      ...counts,
    };
  }

  const collisions = [];
  const personalIds = new Set(Object.values(manifest.users).map((user) => user.id));
  for (const operation of manifest.operations) {
    for (const row of operation.rows) {
      if (await rowExists(client, operation.table, row, operation.identity)) {
        collisions.push({
          type: 'deterministic_identity',
          table: operation.table,
          columns: operation.identity,
          values: reportValues(identityOf(operation, row), personalIds),
        });
      }
      for (const naturalKey of operation.naturalKeys || []) {
        if (await rowExists(client, operation.table, row, naturalKey)) {
          collisions.push({
            type: 'natural_key',
            table: operation.table,
            columns: naturalKey,
            values: reportValues(
              Object.fromEntries(naturalKey.map((column) => [column, row[column]])),
              personalIds,
            ),
          });
        }
      }
    }
  }
  return {
    status: schemaIssues.length || userIssues.length || collisions.length ? 'reject' : 'create',
    reason: schemaIssues.length
      ? 'canonical_schema_incomplete'
      : (userIssues.length
        ? 'qa_users_incomplete'
        : (collisions.length ? 'foreign_data_collision' : 'safe_to_create')),
    schemaIssues,
    userIssues,
    collisions,
    expected: manifest.expectedRowCount,
    present: collisions.filter((collision) => collision.type === 'deterministic_identity').length,
  };
}

async function insertRow(client, operation, row) {
  let materializedRow = row;
  if (operation.table === 'tournament_match_operations' && row.status !== 'draft') {
    materializedRow = {
      ...row,
      status: 'draft',
      match_status: 'ready',
      submitted_by: null,
      submitted_at: null,
      validated_by: null,
      validated_at: null,
      official_by: null,
      official_at: null,
      closed_at: null,
    };
  }
  const columns = Object.keys(materializedRow);
  const sql = `insert into public.${quoteIdentifier(operation.table)}
    (${columns.map(quoteIdentifier).join(', ')})
    values (${columns.map((_, index) => `$${index + 1}`).join(', ')})`;
  await client.query(sql, columns.map((column) => materializedRow[column]));
}

async function finalizeMatchOperations(client, manifest) {
  const operation = manifest.operations.find(
    (item) => item.table === 'tournament_match_operations',
  );
  for (const row of operation.rows.filter((item) => item.status !== 'draft')) {
    await client.query(
      `update public.tournament_match_operations
       set status = $2,
           match_status = $3,
           submitted_by = $4,
           submitted_at = $5,
           validated_by = $6,
           validated_at = $7,
           official_by = $8,
           official_at = $9,
           closed_at = $10
       where id = $1 and status = 'draft'`,
      [
        row.id,
        row.status,
        row.match_status,
        row.submitted_by,
        row.submitted_at,
        row.validated_by,
        row.validated_at,
        row.official_by,
        row.official_at,
        row.closed_at,
      ],
    );
  }
}

function markerRows(operation) {
  return operation.table === 'tournament_audit_log'
    ? operation.rows.filter((row) => row.resource_type === 'qa_seed_execution')
    : [];
}

export function splitManifestForAtomicReplacement(manifest) {
  const baseOperations = [];
  const markerOperations = [];
  for (const operation of manifest.operations) {
    const markers = markerRows(operation);
    const markerSet = new Set(markers);
    const baseRows = operation.rows.filter((row) => !markerSet.has(row));
    if (baseRows.length > 0) baseOperations.push({ ...operation, rows: baseRows });
    if (markers.length > 0) markerOperations.push({ ...operation, rows: markers });
  }
  const baseRows = baseOperations.reduce((sum, operation) => sum + operation.rows.length, 0);
  const markers = markerOperations.reduce((sum, operation) => sum + operation.rows.length, 0);
  if (baseRows !== 586 || markers !== 1) {
    throw new Error('Atomic replacement requires exactly 586 base rows and one marker.');
  }
  return { baseOperations, markerOperations, baseRows, markers };
}

async function insertOperations(client, operations, {
  manifest,
  failAfterRowCount = null,
} = {}) {
  const inserted = [];
  let insertedRows = 0;
  for (const operation of operations) {
    for (const row of operation.rows) {
      try {
        await insertRow(client, operation, row);
      } catch (error) {
        error.message = `${operation.table}: ${error.message}`;
        throw error;
      }
      insertedRows += 1;
      if (failAfterRowCount !== null && insertedRows >= failAfterRowCount) {
        await client.query('select 1 / 0 as qa_deliberate_seed_failure');
      }
    }
    inserted.push({ table: operation.table, rows: operation.rows.length });
  }
  return { inserted, insertedRows };
}

export async function insertManifestBaseInCurrentTransaction(client, manifest, options = {}) {
  const { baseOperations } = splitManifestForAtomicReplacement(manifest);
  const result = await insertOperations(client, baseOperations, {
    manifest,
    ...options,
  });
  await finalizeMatchOperations(client, manifest);
  return result;
}

export async function insertManifestMarkerInCurrentTransaction(client, manifest) {
  const { markerOperations } = splitManifestForAtomicReplacement(manifest);
  return insertOperations(client, markerOperations, { manifest });
}

function isSerializationFailure(error) {
  return error?.code === '40001';
}

async function rollbackQuietly(client) {
  try {
    await client.query('rollback');
  } catch {
    // The server may already have aborted/closed the failed transaction.
  }
}

export async function withSerializableRetry(
  action,
  {
    maxAttempts = 3,
    backoffMs = [25, 75],
    onRetry = () => {},
  } = {},
) {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) {
    throw new Error('SERIALIZABLE retry maxAttempts must be between 1 and 3.');
  }
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await action(attempt);
    } catch (error) {
      if (!isSerializationFailure(error) || attempt === maxAttempts) throw error;
      const delayMs = backoffMs[Math.min(attempt - 1, backoffMs.length - 1)] || 0;
      onRetry({ code: '40001', attempt, nextAttempt: attempt + 1, delayMs });
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw new Error('Unreachable SERIALIZABLE retry state.');
}

export async function materializeManifest(
  client,
  manifest,
  {
    failAfterTable = null,
    retry = {},
  } = {},
) {
  return withSerializableRetry(async (attempt) => {
    await client.query('begin isolation level serializable');
    try {
      await client.query("set local idle_in_transaction_session_timeout = '5min'");
      const lock = await client.query(
        'select pg_try_advisory_xact_lock(hashtextextended($1, 0)) as acquired',
        [
          manifest.seedKey,
        ],
      );
      if (!lock.rows[0]?.acquired) {
        const error = new Error('Seed advisory lock is already held.');
        error.code = '55P03';
        throw error;
      }
      const preflight = await preflightDatabase(client, manifest);
      if (preflight.status === 'skip') {
        await client.query('rollback');
        return {
          status: 'skip',
          preflight,
          inserted: [],
          attempts: attempt,
        };
      }
      if (preflight.status !== 'create') {
        const error = new Error(`Seed preflight rejected: ${preflight.reason}`);
        error.preflight = preflight;
        throw error;
      }
      const inserted = [];
      let matchOperationsFinalized = false;
      for (const operation of manifest.operations) {
        if (
          operation.table === 'tournament_audit_log'
          && !matchOperationsFinalized
        ) {
          await finalizeMatchOperations(client, manifest);
          matchOperationsFinalized = true;
        }
        for (const row of operation.rows) {
          try {
            await insertRow(client, operation, row);
          } catch (error) {
            error.message = `${operation.table}: ${error.message}`;
            throw error;
          }
        }
        inserted.push({ table: operation.table, rows: operation.rows.length });
        if (failAfterTable === operation.table) {
          await client.query('select 1 / 0 as qa_deliberate_failure');
        }
      }
      const verification = await preflightDatabase(client, manifest);
      if (
        verification.status !== 'skip'
        || verification.present !== manifest.expectedRowCount
        || verification.expected !== manifest.expectedRowCount
      ) {
        const error = new Error('Seed validation failed before commit.');
        error.preflight = verification;
        throw error;
      }
      await client.query('commit');
      return {
        status: 'created',
        preflight,
        verification,
        inserted,
        attempts: attempt,
      };
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    }
  }, retry);
}

async function deleteExpectedRow(client, operation, row) {
  const where = whereClause(row, operation.identity);
  return client.query(
    `delete from public.${quoteIdentifier(operation.table)}
     where ${where.sql}`,
    where.values,
  );
}

function isSeedMarkerOperation(operation) {
  return operation.table === 'tournament_audit_log'
    && operation.rows.some((row) => row.resource_type === 'qa_seed_execution');
}

function cleanupOperations(manifest) {
  const markerOperations = manifest.operations.filter(isSeedMarkerOperation);
  const ownedDataOperations = manifest.operations.filter(
    (operation) => !isSeedMarkerOperation(operation),
  ).reverse();
  const tournamentParents = ownedDataOperations.findIndex(
    (operation) => operation.table === 'tournaments',
  );
  if (tournamentParents < 0) {
    throw new Error('Cleanup could not locate the tournament parent boundary.');
  }
  return [
    ...ownedDataOperations.slice(0, tournamentParents),
    ...markerOperations,
    ...ownedDataOperations.slice(tournamentParents),
  ];
}

async function countOrganizationScopedRows(client, organizationId) {
  const tables = await client.query(
    `select table_name
     from information_schema.columns
     where table_schema = 'public' and column_name = 'organization_id'
     group by table_name
     order by table_name`,
  );
  const leftovers = [];
  for (const { table_name: tableName } of tables.rows) {
    const result = await client.query(
      `select count(*)::integer as count
       from public.${quoteIdentifier(tableName)}
       where organization_id = $1`,
      [organizationId],
    );
    if (result.rows[0].count > 0) {
      leftovers.push({ table: tableName, count: result.rows[0].count });
    }
  }
  return leftovers;
}

async function findUnexpectedOrganizationRows(client, manifest) {
  const actual = await countOrganizationScopedRows(client, manifest.organizationId);
  const expectedByTable = new Map();
  for (const operation of manifest.operations) {
    const scopedRows = operation.rows.filter((row) => (
      row.organization_id === manifest.organizationId
    )).length;
    expectedByTable.set(
      operation.table,
      (expectedByTable.get(operation.table) || 0) + scopedRows,
    );
  }
  return actual.filter(({ table, count }) => count !== (expectedByTable.get(table) || 0)).map(
    ({ table, count }) => ({
      table,
      actual: count,
      expected: expectedByTable.get(table) || 0,
    }),
  );
}

export async function detectCleanupTriggerBlockers(client, manifest) {
  const seededTables = [...new Set(manifest.operations.map((operation) => operation.table))];
  const result = await client.query(
    `select table_row.relname as table_name,
            trigger_row.tgname as trigger_name,
            pg_get_triggerdef(trigger_row.oid) as definition
     from pg_trigger trigger_row
     join pg_class table_row on table_row.oid = trigger_row.tgrelid
     join pg_namespace schema_row on schema_row.oid = table_row.relnamespace
     where schema_row.nspname = 'public'
       and table_row.relname = any($1::text[])
       and not trigger_row.tgisinternal
       and trigger_row.tgenabled <> 'D'
       and (trigger_row.tgtype & 8) = 8
     order by table_row.relname, trigger_row.tgname`,
    [seededTables],
  );
  return result.rows.map((row) => ({
    table: row.table_name,
    trigger: row.trigger_name,
    deleteGuard: row.definition.replace(/\s+/g, ' ').trim(),
  }));
}

async function setLocalCleanupGuardState(client, triggerBlockers, enabled) {
  const action = enabled ? 'enable' : 'disable';
  const tables = [...new Set(triggerBlockers.map((blocker) => blocker.table))].sort();
  for (const tableName of tables) {
    await client.query(
      `lock table public.${quoteIdentifier(tableName)} in access exclusive mode`,
    );
  }
  for (const blocker of triggerBlockers) {
    await client.query(
      `alter table public.${quoteIdentifier(blocker.table)} ${action} trigger ${quoteIdentifier(blocker.trigger)}`,
    );
  }
}

export async function cleanupManifest(client, manifest, {
  apply = false,
  allowLocalTriggerBypass = false,
} = {}) {
  const markers = await readSeedMarker(client, manifest);
  const counts = await countExpectedRows(client, manifest, { includeMissing: false });
  if (markers.length === 0) {
    if (counts.present !== 0) {
      return {
        status: 'reject',
        reason: 'unmarked_seed_shaped_rows',
        ...counts,
      };
    }
    return { status: 'already_clean', reason: 'no_marker_or_seed_rows', ...counts };
  }
  if (markers.length !== 1) {
    return { status: 'reject', reason: 'duplicate_seed_markers', ...counts };
  }
  const marker = markers[0];
  const organization = await client.query(
    `select creation_key from public.tournament_organizations
     where id = $1 and slug = $2`,
    [manifest.organizationId, manifest.organizationSlug],
  );
  if (!markerOwnershipMatches(marker, organization, manifest)) {
    return { status: 'reject', reason: 'ownership_proof_failed', ...counts };
  }
  if (
    counts.present !== counts.expected
    || counts.identityPresent !== counts.expected
    || counts.mismatched.length !== 0
  ) {
    return { status: 'reject', reason: 'partial_or_tampered_seed', ...counts };
  }
  const unexpectedOrganizationRows = await findUnexpectedOrganizationRows(client, manifest);
  if (unexpectedOrganizationRows.length > 0) {
    return {
      status: 'reject',
      reason: 'foreign_organization_references',
      unexpectedOrganizationRows,
      ...counts,
    };
  }
  const triggerBlockers = await detectCleanupTriggerBlockers(client, manifest);
  if (triggerBlockers.length > 0 && !allowLocalTriggerBypass) {
    return {
      status: 'reject',
      reason: 'active_append_only_cleanup_guards',
      triggerBlockers,
      requiredSolution: {
        scope: 'explicitly-authorized local cleanup only',
        design: [
          'validate a loopback PostgreSQL target in the cleanup CLI',
          'verify marker, creation_key, manifest_hash and fingerprints before mutation',
          'lock affected tables and keep all FK/internal triggers enabled',
          'disable only user-defined DELETE triggers inside the cleanup transaction',
          'restore every trigger before commit and reject any foreign organization row',
        ],
      },
      ...counts,
    };
  }
  const orderedCleanup = cleanupOperations(manifest);
  const projected = orderedCleanup.map((operation) => ({
    table: operation.table,
    rows: operation.rows.length,
  }));
  if (!apply) return { status: 'ready', reason: 'ownership_verified', projected, ...counts };

  await withSerializableRetry(async () => {
    await client.query('begin isolation level serializable');
    try {
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
        manifest.seedKey,
      ]);
      if (triggerBlockers.length > 0) {
        await setLocalCleanupGuardState(client, triggerBlockers, false);
      }
      for (const operation of orderedCleanup) {
        for (const row of [...operation.rows].reverse()) {
          const result = await deleteExpectedRow(client, operation, row);
          if (result.rowCount !== 1) {
            throw new Error(
              `Cleanup expected one ${operation.table} row, deleted ${result.rowCount}.`,
            );
          }
        }
      }
      if (triggerBlockers.length > 0) {
        await setLocalCleanupGuardState(client, triggerBlockers, true);
      }
      const inTransactionPost = await countExpectedRows(
        client,
        manifest,
        { includeMissing: false },
      );
      const inTransactionLeftovers = await countOrganizationScopedRows(
        client,
        manifest.organizationId,
      );
      if (inTransactionPost.identityPresent !== 0 || inTransactionLeftovers.length !== 0) {
        throw new Error(
          `Cleanup verification failed before commit: ${JSON.stringify({
            seedRows: inTransactionPost.identityPresent,
            organizationRows: inTransactionLeftovers,
          })}`,
        );
      }
      await client.query('commit');
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    }
  });
  const post = await countExpectedRows(client, manifest, { includeMissing: false });
  const leftovers = await countOrganizationScopedRows(client, manifest.organizationId);
  if (post.identityPresent !== 0 || leftovers.length !== 0) {
    throw new Error('Cleanup verification found seed rows or organization-scoped orphans.');
  }
  return {
    status: 'cleaned',
    reason: 'ownership_verified',
    localTriggerBypass: triggerBlockers.map((blocker) => ({
      table: blocker.table,
      trigger: blocker.trigger,
      restored: true,
    })),
    projected: projected.map(({ table, rows }) => ({ table, rows })),
    before: counts,
    after: post,
    orphanCount: 0,
    organizationScopedLeftovers: leftovers,
  };
}

export async function withDatabase(databaseUrl, action) {
  const client = new pg.Client({
    connectionString: databaseUrl,
    application_name: 'arma2_torneos_qa_seed',
  });
  await client.connect();
  try {
    return await action(client);
  } finally {
    await client.end();
  }
}

export function offlinePlan(manifest) {
  const describe = (operation) => ({
    table: `public.${operation.table}`,
    operation: 'insert-only-after-preflight',
    count: operation.rows.length,
    identity: operation.identity,
    relationships: [...new Set(operation.rows.flatMap(
      (row) => Object.keys(row).filter((column) => (
        column.endsWith('_id') && !operation.identity.includes(column)
      )),
    ))],
    naturalKeys: operation.naturalKeys || [],
    ...(operation.table === 'tournament_match_operations'
      ? {
        finalization: 'non-draft rows are inserted draft and finalized after child rows in the same transaction',
      }
      : {}),
  });
  return {
    mode: 'offline-dry-run',
    connects: false,
    writes: false,
    seedKey: manifest.seedKey,
    seedVersion: manifest.seedVersion,
    manifestHash: manifest.manifestHash,
    identityMapFingerprint: manifest.identityMapFingerprint,
    ownershipFingerprint: manifest.rowOwnershipFingerprint,
    usersRequired: manifest.identityReport,
    preconditions: [
      'canonical tables and columns exist',
      'six auth.users and public.usuarios profiles resolve exactly',
      'each Auth user is tagged in raw_app_meta_data for this seed and logical role',
      'no personal user, foreign dataset identity, or incompatible existing relation',
      'outsider has zero projected and pre-existing relations',
      'no deterministic ID collision',
      'no slug, creation key, idempotency key, or declared natural-key collision',
      'no conflicting seed marker',
      'local apply requires explicit loopback database URL and double opt-in',
      'remote apply is disabled',
    ],
    collisionStatus: 'unknown-offline; run --preflight-local for catalog checks',
    disposition: {
      create: manifest.expectedRowCount,
      update: 0,
      skip: 0,
      reject: 0,
      conditionalOn: 'connected preflight returning safe_to_create',
    },
    operations: manifest.operations.map(describe),
    rollback: {
      status: 'requires cleanup trigger compatibility preflight',
      sessionReplicationRole: 'never changed',
      operations: cleanupOperations(manifest).map(describe),
    },
  };
}
