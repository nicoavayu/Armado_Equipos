import pg from 'pg';

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

async function rowExists(client, table, row, columns) {
  const where = whereClause(row, columns);
  const result = await client.query(
    `select 1 from public.${quoteIdentifier(table)} where ${where.sql} limit 1`,
    where.values,
  );
  return result.rowCount === 1;
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

async function verifyRequiredUsers(client, manifest) {
  const issues = [];
  for (const user of Object.values(manifest.users)) {
    const auth = await client.query(
      'select email from auth.users where id = $1',
      [user.id],
    );
    if (
      auth.rowCount !== 1
      || String(auth.rows[0].email || '').toLowerCase() !== user.email
    ) {
      issues.push(`${user.role}: auth.users ${user.id}/${user.email} is not resolved`);
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
      issues.push(`${user.role}: public.usuarios profile is missing or mismatched`);
    }
  }
  return issues;
}

async function countExpectedRows(client, manifest, { includeMissing = true } = {}) {
  let expected = 0;
  let present = 0;
  const missing = [];
  for (const operation of manifest.operations) {
    for (const row of operation.rows) {
      expected += 1;
      if (await rowExists(client, operation.table, row, operation.identity)) {
        present += 1;
      } else if (includeMissing) {
        missing.push({
          table: operation.table,
          identity: identityOf(operation, row),
        });
      }
    }
  }
  return { expected, present, missing };
}

export async function preflightDatabase(client, manifest) {
  const schemaIssues = await requiredSchemaPreflight(client, manifest);
  const userIssues = await verifyRequiredUsers(client, manifest);
  const markers = schemaIssues.length === 0
    ? await readSeedMarker(client, manifest)
    : [];
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
    const ownershipMatches = (
      marker.organization_id === manifest.organizationId
      && marker.metadata?.seedKey === manifest.seedKey
      && marker.metadata?.manifestHash === manifest.manifestHash
      && organization.rowCount === 1
      && organization.rows[0].creation_key === manifest.organizationCreationKey
    );
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
      reason: ownershipMatches ? 'partial_or_tampered_seed' : 'seed_marker_mismatch',
      schemaIssues,
      userIssues,
      collisions: [],
      ...counts,
    };
  }

  const collisions = [];
  for (const operation of manifest.operations) {
    for (const row of operation.rows) {
      if (await rowExists(client, operation.table, row, operation.identity)) {
        collisions.push({
          type: 'deterministic_identity',
          table: operation.table,
          columns: operation.identity,
          values: identityOf(operation, row),
        });
      }
      for (const naturalKey of operation.naturalKeys || []) {
        if (await rowExists(client, operation.table, row, naturalKey)) {
          collisions.push({
            type: 'natural_key',
            table: operation.table,
            columns: naturalKey,
            values: Object.fromEntries(naturalKey.map((column) => [column, row[column]])),
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
    expected: manifest.operations.reduce((sum, operation) => sum + operation.rows.length, 0),
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

export async function materializeManifest(
  client,
  manifest,
  { failAfterTable = null } = {},
) {
  await client.query('begin isolation level serializable');
  try {
    await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
      manifest.seedKey,
    ]);
    const preflight = await preflightDatabase(client, manifest);
    if (preflight.status === 'skip') {
      await client.query('rollback');
      return { status: 'skip', preflight, inserted: [] };
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
        throw new Error(`QA deliberate failure after ${operation.table}`);
      }
    }
    await client.query('commit');
    return { status: 'created', preflight, inserted };
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

async function deleteExpectedRow(client, operation, row) {
  const where = whereClause(row, operation.identity);
  return client.query(
    `delete from public.${quoteIdentifier(operation.table)}
     where ${where.sql}`,
    where.values,
  );
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

export async function cleanupManifest(client, manifest, { apply = false } = {}) {
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
  if (
    marker.organization_id !== manifest.organizationId
    || marker.metadata?.seedKey !== manifest.seedKey
    || marker.metadata?.manifestHash !== manifest.manifestHash
    || organization.rowCount !== 1
    || organization.rows[0].creation_key !== manifest.organizationCreationKey
  ) {
    return { status: 'reject', reason: 'ownership_proof_failed', ...counts };
  }
  if (counts.present !== counts.expected) {
    return { status: 'reject', reason: 'partial_or_tampered_seed', ...counts };
  }
  const projected = [...manifest.operations].reverse().map((operation) => ({
    table: operation.table,
    rows: operation.rows.length,
    identities: operation.rows.map((row) => identityOf(operation, row)),
  }));
  if (!apply) return { status: 'ready', reason: 'ownership_verified', projected, ...counts };

  await client.query('begin isolation level serializable');
  try {
    await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
      manifest.seedKey,
    ]);
    // Canonical match history is append-only. A database-owner cleanup can
    // bypass user and FK triggers only inside this transaction; exact reverse
    // deletes plus the catalog-driven zero-leftover check below are mandatory
    // before commit.
    await client.query("set local session_replication_role = 'replica'");
    for (const operation of [...manifest.operations].reverse()) {
      for (const row of [...operation.rows].reverse()) {
        const result = await deleteExpectedRow(client, operation, row);
        if (result.rowCount !== 1) {
          throw new Error(
            `Cleanup expected one ${operation.table} row, deleted ${result.rowCount}.`,
          );
        }
      }
    }
    await client.query("set local session_replication_role = 'origin'");
    const inTransactionPost = await countExpectedRows(
      client,
      manifest,
      { includeMissing: false },
    );
    const inTransactionLeftovers = await countOrganizationScopedRows(
      client,
      manifest.organizationId,
    );
    if (inTransactionPost.present !== 0 || inTransactionLeftovers.length !== 0) {
      throw new Error(
        `Cleanup verification failed before commit: ${JSON.stringify({
          seedRows: inTransactionPost.present,
          organizationRows: inTransactionLeftovers,
        })}`,
      );
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
  const post = await countExpectedRows(client, manifest, { includeMissing: false });
  const leftovers = await countOrganizationScopedRows(client, manifest.organizationId);
  if (post.present !== 0 || leftovers.length !== 0) {
    throw new Error('Cleanup verification found seed rows or organization-scoped orphans.');
  }
  return {
    status: 'cleaned',
    reason: 'ownership_verified',
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
    ids: operation.rows.map((row) => identityOf(operation, row)),
    relationships: [...new Set(operation.rows.flatMap(
      (row) => Object.keys(row).filter((column) => (
        column.endsWith('_id') && !operation.identity.includes(column)
      )),
    ))],
    relationshipValues: operation.rows.map((row) => Object.fromEntries(
      Object.entries(row).filter(([column]) => (
        column.endsWith('_id') && !operation.identity.includes(column)
      )),
    )),
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
    usersRequired: Object.values(manifest.users).map((user) => ({
      role: user.role,
      id: user.id,
      email: user.email,
      organizationRelation: user.role === 'outsider'
        ? 'none'
        : ({
          owner: 'membership:owner',
          admin: 'membership:admin',
          collaborator: 'membership:collaborator',
          delegate: 'team-manager:delegate + roster-player',
          player: 'roster-player',
        }[user.role]),
    })),
    preconditions: [
      'canonical tables and columns exist',
      'six auth.users and public.usuarios profiles resolve exactly',
      'no deterministic ID collision',
      'no slug, creation key, idempotency key, or declared natural-key collision',
      'no conflicting seed marker',
      'local apply requires explicit loopback database URL and double opt-in',
      'remote apply is disabled',
    ],
    collisionStatus: 'unknown-offline; run --preflight-local for catalog checks',
    disposition: {
      create: manifest.operations.reduce((sum, operation) => sum + operation.rows.length, 0),
      update: 0,
      skip: 0,
      reject: 0,
      conditionalOn: 'connected preflight returning safe_to_create',
    },
    operations: manifest.operations.map(describe),
    rollback: [...manifest.operations].reverse().map(describe),
  };
}
