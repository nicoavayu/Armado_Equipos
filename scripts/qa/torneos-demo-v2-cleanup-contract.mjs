import { createHash } from 'node:crypto';

export const V2_CLEANUP_AUTHORIZATION = Object.freeze({
  sourceCommit: '0dc66b5f0297d7c59be486559ec36c8c50779e96',
  seedKey: 'torneos-demo-v2',
  manifestHash: '48b413d1c6673ad96d3ce5bb30fecc89bd2c432b465a00447eb6f2cb51befb2f',
  identityMapFingerprint: '77d95cb8caee567de1e8275b81c1e8c850eb59dcf6025504cab93c634ff3657c',
  ownershipFingerprint: '9375b59f2f908aec4b0d5b32b79514491e2ebbd648c4d9e7c245064c772ebe8d',
  baseRows: 586,
  markerRows: 1,
  totalRows: 587,
  tables: 32,
});

const OWNERSHIP_SCOPE_COLUMNS = Object.freeze([
  'organization_id',
  'season_id',
  'tournament_id',
  'category_id',
  'team_entry_id',
  'roster_id',
  'participant_set_id',
  'fixture_version_id',
  'phase_id',
  'round_id',
  'match_id',
  'match_operation_id',
  'revision_id',
  'suspension_id',
]);

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
    ).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function valueKind(value) {
  if (value === null) return 'nullable';
  if (typeof value === 'number') return 'number';
  if (
    typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(value)
  ) return 'date';
  if (
    typeof value === 'string'
    && /^[{[]/.test(value.trim())
  ) {
    try {
      JSON.parse(value);
      return 'json';
    } catch {
      // It is a regular string.
    }
  }
  return 'scalar';
}

function mergeKinds(left, right, column) {
  if (!left || left === 'nullable') return right;
  if (!right || right === 'nullable') return left;
  if (left !== right) {
    throw new Error(`Historical v2 column ${column} has incompatible value kinds.`);
  }
  return left;
}

function normalizeValue(value, kind) {
  if (value === null || value === undefined) return null;
  if (kind === 'number') {
    const number = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(number)) throw new Error('Expected a finite numeric database value.');
    return number;
  }
  if (kind === 'date') {
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return String(value).slice(0, 10);
  }
  if (kind === 'json') {
    if (typeof value === 'string') return JSON.parse(value);
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((entry) => normalizeValue(entry, 'scalar'));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
      key,
      normalizeValue(entry, 'scalar'),
    ]));
  }
  return value;
}

export function normalizedRow(row, columns, columnKinds) {
  return Object.fromEntries(columns.map((column) => [
    column,
    normalizeValue(row[column], columnKinds[column]),
  ]));
}

export function rowContentHash(row, tableDescriptor) {
  return sha256(canonicalJson(normalizedRow(
    row,
    tableDescriptor.columns,
    tableDescriptor.columnKinds,
  )));
}

function identityObject(identity, row) {
  return Object.fromEntries(identity.map((column) => [column, row[column]]));
}

export function identityKey(identity) {
  return canonicalJson(identity);
}

function isMarkerRow(table, row) {
  return table === 'tournament_audit_log'
    && row.resource_type === 'qa_seed_execution'
    && row.action === 'qa.seed.applied';
}

function ownershipScope(table, rows) {
  if (table === 'tournament_organizations') {
    return { column: 'id', values: rows.map((row) => row.id) };
  }
  const column = OWNERSHIP_SCOPE_COLUMNS.find((candidate) => (
    rows.every((row) => Object.hasOwn(row, candidate) && row[candidate] !== null)
  ));
  if (!column) {
    throw new Error(`Historical v2 table ${table} has no exact ownership scope.`);
  }
  return {
    column,
    values: [...new Set(rows.map((row) => row[column]))].sort(),
  };
}

function descriptorPayload(descriptor) {
  const { descriptorFingerprint: _fingerprint, ...payload } = descriptor;
  return payload;
}

export function descriptorFingerprint(descriptor) {
  return sha256(canonicalJson(descriptorPayload(descriptor)));
}

export function buildCleanupDescriptor(manifest, {
  sourceCommit = V2_CLEANUP_AUTHORIZATION.sourceCommit,
  authorization = V2_CLEANUP_AUTHORIZATION,
} = {}) {
  const exact = [
    ['seed key', manifest.seedKey, authorization.seedKey],
    ['manifest hash', manifest.manifestHash, authorization.manifestHash],
    ['identity fingerprint', manifest.identityMapFingerprint, authorization.identityMapFingerprint],
    ['ownership fingerprint', manifest.rowOwnershipFingerprint, authorization.ownershipFingerprint],
    ['row count', manifest.expectedRowCount, authorization.totalRows],
    ['table count', manifest.expectedTableCount, authorization.tables],
  ];
  for (const [label, actual, expected] of exact) {
    if (actual !== expected) {
      throw new Error(`Historical v2 ${label} mismatch: expected ${expected}, got ${actual}.`);
    }
  }

  const grouped = new Map();
  for (const operation of manifest.operations) {
    const existing = grouped.get(operation.table);
    if (existing && canonicalJson(existing.identity) !== canonicalJson(operation.identity)) {
      throw new Error(`Historical v2 table ${operation.table} changes its delete identity.`);
    }
    const entry = existing || {
      table: operation.table,
      identity: [...operation.identity],
      rawRows: [],
    };
    entry.rawRows.push(...operation.rows.map((row) => structuredClone(row)));
    grouped.set(operation.table, entry);
  }

  let marker = null;
  const tables = [...grouped.values()].map((entry) => {
    const columns = [...new Set(entry.rawRows.flatMap((row) => Object.keys(row)))].sort();
    const columnKinds = {};
    for (const column of columns) {
      for (const row of entry.rawRows) {
        columnKinds[column] = mergeKinds(
          columnKinds[column],
          valueKind(row[column]),
          `${entry.table}.${column}`,
        );
      }
      if (!columnKinds[column]) columnKinds[column] = 'nullable';
    }
    const hashContract = { columns, columnKinds };
    const rows = entry.rawRows.map((row) => {
      const result = {
        identity: identityObject(entry.identity, row),
        contentHash: rowContentHash(row, hashContract),
      };
      if (isMarkerRow(entry.table, row)) {
        if (marker) throw new Error('Historical v2 must contain exactly one seed marker.');
        marker = {
          table: entry.table,
          identity: structuredClone(result.identity),
          contentHash: result.contentHash,
          metadata: {
            seedKey: row.metadata?.seed_key,
            manifestHash: row.metadata?.manifest_hash,
            identityMapFingerprint: row.metadata?.identity_map_fingerprint,
            ownershipFingerprint: row.metadata?.ownership_fingerprint,
          },
        };
      }
      return result;
    });
    return {
      table: entry.table,
      identity: entry.identity,
      columns,
      columnKinds,
      ownership: ownershipScope(entry.table, entry.rawRows),
      rows,
    };
  });

  if (!marker) throw new Error('Historical v2 seed marker is missing.');
  const payload = {
    version: 1,
    sourceCommit,
    seedKey: manifest.seedKey,
    organizationId: manifest.organizationId,
    organizationSlug: manifest.organizationSlug,
    creationKey: manifest.organizationCreationKey,
    manifestHash: manifest.manifestHash,
    identityMapFingerprint: manifest.identityMapFingerprint,
    ownershipFingerprint: manifest.rowOwnershipFingerprint,
    expected: {
      baseRows: authorization.baseRows,
      markerRows: authorization.markerRows,
      totalRows: authorization.totalRows,
      tables: authorization.tables,
    },
    marker,
    tables,
  };
  return Object.freeze({
    ...payload,
    descriptorFingerprint: descriptorFingerprint(payload),
  });
}

export function validateCleanupDescriptor(descriptor, {
  authorization = V2_CLEANUP_AUTHORIZATION,
  requireAuthorizedIdentityMap = true,
} = {}) {
  const failures = [];
  const checks = [
    ['version', descriptor.version, 1],
    ['source_commit', descriptor.sourceCommit, authorization.sourceCommit],
    ['seed_key', descriptor.seedKey, authorization.seedKey],
    ['manifest_hash', descriptor.manifestHash, authorization.manifestHash],
    ['ownership_fingerprint', descriptor.ownershipFingerprint, authorization.ownershipFingerprint],
    ['base_rows', descriptor.expected?.baseRows, authorization.baseRows],
    ['marker_rows', descriptor.expected?.markerRows, authorization.markerRows],
    ['total_rows', descriptor.expected?.totalRows, authorization.totalRows],
    ['tables', descriptor.expected?.tables, authorization.tables],
  ];
  if (requireAuthorizedIdentityMap) {
    checks.push([
      'identity_map_fingerprint',
      descriptor.identityMapFingerprint,
      authorization.identityMapFingerprint,
    ]);
  }
  for (const [label, actual, expected] of checks) {
    if (actual !== expected) failures.push(label);
  }
  const rowCount = descriptor.tables?.reduce((sum, table) => sum + table.rows.length, 0);
  const tableCount = new Set(descriptor.tables?.map((table) => table.table)).size;
  const identities = descriptor.tables?.flatMap((table) => table.rows.map((row) => (
    `${table.table}:${identityKey(row.identity)}`
  ))) || [];
  const markerMatches = descriptor.tables?.flatMap((table) => table.rows.filter((row) => (
    table.table === descriptor.marker?.table
    && identityKey(row.identity) === identityKey(descriptor.marker?.identity)
    && row.contentHash === descriptor.marker?.contentHash
  ))) || [];
  if (rowCount !== descriptor.expected?.totalRows) failures.push('descriptor_rows');
  if (tableCount !== descriptor.expected?.tables) failures.push('descriptor_tables');
  if (new Set(identities).size !== identities.length) failures.push('duplicate_identities');
  if (markerMatches.length !== 1) failures.push('descriptor_marker_count');
  if (descriptor.marker?.metadata?.seedKey !== authorization.seedKey) failures.push('marker_seed_key');
  if (descriptor.marker?.metadata?.manifestHash !== authorization.manifestHash) failures.push('marker_manifest_hash');
  if (
    requireAuthorizedIdentityMap
    && descriptor.marker?.metadata?.identityMapFingerprint !== authorization.identityMapFingerprint
  ) failures.push('marker_identity_fingerprint');
  if (descriptor.marker?.metadata?.ownershipFingerprint !== authorization.ownershipFingerprint) {
    failures.push('marker_ownership_fingerprint');
  }
  if (descriptorFingerprint(descriptor) !== descriptor.descriptorFingerprint) {
    failures.push('descriptor_fingerprint');
  }
  if (failures.length > 0) {
    throw new Error(`Immutable v2 cleanup descriptor rejected: ${failures.join(', ')}.`);
  }
  return descriptor;
}
