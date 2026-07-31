import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  REPLACEMENT_AUTHORIZATION,
  REQUIRED_REPLACEMENT_CONFIRMATION,
  assertInteractiveReplacementConfirmation,
  assertReplacementProjectRef,
  assertSharedPreferenceDestinations,
  buildV3IdentityMap,
  externalConstraintCatalogFingerprint,
  parseReplacementArguments,
  preferenceFingerprint,
  preferenceSnapshotReport,
  preflightReplacement,
  shouldRetryReplacement,
  validateExternalConstraintCatalog,
  validatePreferenceCatalog,
  validatePreferencePrimaryKeyCatalog,
  validateReplacementArtifacts,
} from './replace-torneos-demo-v2-with-v3-direct.mjs';
import { loadV2IdentityMap } from './cleanup-torneos-demo-v2-direct.mjs';
import { buildCanonicalManifest } from './torneos-demo-manifest.mjs';
import { TORNEOS_DEMO_V2_CLEANUP_DESCRIPTOR } from './torneos-demo-v2-cleanup-descriptor.mjs';
import { splitManifestForAtomicReplacement } from './torneos-seed-db.mjs';

async function artifacts() {
  const identity = await loadV2IdentityMap();
  const manifest = buildCanonicalManifest({
    identityMap: buildV3IdentityMap(identity.profiles),
  });
  return { identity, manifest, descriptor: TORNEOS_DEMO_V2_CLEANUP_DESCRIPTOR };
}

function constraintFixture() {
  return [
    {
      name: 'user_tournament_context_preferences_organization_id_fkey',
      source_table: 'user_tournament_context_preferences',
      target_table: 'tournament_organizations',
      delete_action: 'c',
      deferrable: false,
      initially_deferred: false,
      source_columns: ['organization_id'],
      target_columns: ['id'],
      nullable: [false],
    },
    {
      name: 'user_tournament_context_season_fk',
      source_table: 'user_tournament_context_preferences',
      target_table: 'tournament_seasons',
      delete_action: 'r',
      deferrable: false,
      initially_deferred: false,
      source_columns: ['organization_id', 'active_season_id'],
      target_columns: ['organization_id', 'id'],
      nullable: [false, true],
    },
    {
      name: 'user_tournament_context_tournament_fk',
      source_table: 'user_tournament_context_preferences',
      target_table: 'tournaments',
      delete_action: 'r',
      deferrable: false,
      initially_deferred: false,
      source_columns: ['organization_id', 'active_tournament_id', 'active_season_id'],
      target_columns: ['organization_id', 'id', 'season_id'],
      nullable: [false, true, true],
    },
    {
      name: 'user_workspace_preferences_active_organization_id_fkey',
      source_table: 'user_workspace_preferences',
      target_table: 'tournament_organizations',
      delete_action: 'n',
      deferrable: false,
      initially_deferred: false,
      source_columns: ['active_organization_id'],
      target_columns: ['id'],
      nullable: [true],
    },
  ];
}

test('replacement artifacts are the immutable v2 descriptor and exact v3 manifest', async () => {
  const { descriptor, manifest } = await artifacts();
  const validation = validateReplacementArtifacts({ descriptor, manifest });
  assert.equal(descriptor.descriptorFingerprint, REPLACEMENT_AUTHORIZATION.v2DescriptorFingerprint);
  assert.equal(manifest.manifestHash, REPLACEMENT_AUTHORIZATION.v3ManifestHash);
  assert.equal(manifest.identityMapFingerprint, REPLACEMENT_AUTHORIZATION.v3IdentityFingerprint);
  assert.equal(manifest.rowOwnershipFingerprint, REPLACEMENT_AUTHORIZATION.v3OwnershipFingerprint);
  assert.equal(validation.split.baseRows, 586);
  assert.equal(validation.split.markers, 1);
});

test('runner exposes exactly diagnose, preflight and execute', () => {
  for (const mode of ['diagnose', 'preflight', 'execute']) {
    assert.deepEqual(
      parseReplacementArguments([`--${mode}`, '--ca-cert', '/tmp/ca.crt'], {}),
      {
        mode,
        caCertPath: '/tmp/ca.crt',
        identityMapPath: 'torneos-demo-v2-identity-map.local',
      },
    );
  }
  assert.throws(() => parseReplacementArguments([], {}), /exactly one/);
  assert.throws(
    () => parseReplacementArguments(['--execute', '--preflight', '--ca-cert', '/tmp/ca'], {}),
    /exactly one/,
  );
});

test('confirmation cannot be supplied by argument, environment or preconfigured stdin', () => {
  assert.throws(
    () => parseReplacementArguments([
      '--execute', '--confirm', REQUIRED_REPLACEMENT_CONFIRMATION, '--ca-cert', '/tmp/ca',
    ], {}),
    /Unsupported/,
  );
  assert.throws(
    () => assertInteractiveReplacementConfirmation(REQUIRED_REPLACEMENT_CONFIRMATION, {
      inputIsTTY: false,
      outputIsTTY: true,
    }),
    /live interactive terminal/,
  );
  assert.equal(
    parseReplacementArguments(['--execute', '--ca-cert', '/tmp/ca'], {
      REPLACEMENT_CONFIRMATION: REQUIRED_REPLACEMENT_CONFIRMATION,
    }).mode,
    'execute',
  );
});

test('interactive confirmation accepts only the exact mandatory phrase', () => {
  assert.equal(assertInteractiveReplacementConfirmation(REQUIRED_REPLACEMENT_CONFIRMATION, {
    inputIsTTY: true,
    outputIsTTY: true,
  }), true);
  for (const answer of [
    '',
    'REEMPLAZAR torneos-demo-v2 POR torneos-demo-v3',
    `${REQUIRED_REPLACEMENT_CONFIRMATION} `,
    REQUIRED_REPLACEMENT_CONFIRMATION.toLowerCase(),
    'REEMPLAZAR torneos-demo-v2 POR torneos-demo-v3 EN PRODUCTION',
  ]) {
    assert.throws(() => assertInteractiveReplacementConfirmation(answer, {
      inputIsTTY: true,
      outputIsTTY: true,
    }), /did not match exactly/);
  }
});

test('Production and every non-authorized project are blocked', () => {
  assert.equal(
    assertReplacementProjectRef(REPLACEMENT_AUTHORIZATION.stagingProjectRef),
    REPLACEMENT_AUTHORIZATION.stagingProjectRef,
  );
  assert.throws(
    () => assertReplacementProjectRef(REPLACEMENT_AUTHORIZATION.productionProjectRef),
    /Production/,
  );
  assert.throws(() => assertReplacementProjectRef('local'), /Only the exact/);
});

test('Production is rejected before the first database query', async () => {
  const { descriptor, identity, manifest } = await artifacts();
  let queries = 0;
  await assert.rejects(
    () => preflightReplacement({
      query: async () => {
        queries += 1;
        throw new Error('query must not run');
      },
    }, {
      descriptor,
      manifest,
      profiles: identity.profiles,
      targetProjectRef: REPLACEMENT_AUTHORIZATION.productionProjectRef,
    }),
    /Production/,
  );
  assert.equal(queries, 0);
});

test('preference fingerprint is deterministic and covers every stored value', () => {
  const row = {
    user_id: '00000000-0000-4000-8000-000000000001',
    organization_id: '00000000-0000-4000-8000-000000000002',
    active_season_id: '00000000-0000-4000-8000-000000000003',
    active_tournament_id: '00000000-0000-4000-8000-000000000004',
    updated_at: new Date('2026-07-30T12:34:56.789Z'),
  };
  const fingerprint = preferenceFingerprint(row);
  assert.equal(fingerprint.length, 64);
  assert.equal(preferenceFingerprint({ ...row }), fingerprint);
  for (const key of Object.keys(row)) {
    const changed = { ...row, [key]: key === 'updated_at' ? new Date(0) : null };
    assert.notEqual(preferenceFingerprint(changed), fingerprint, key);
  }
});

test('preference snapshot report exposes only partial fingerprints and null state', () => {
  const report = preferenceSnapshotReport({
    user_id: '00000000-0000-4000-8000-000000000001',
    organization_id: '00000000-0000-4000-8000-000000000002',
    active_season_id: null,
    active_tournament_id: null,
    updated_at: new Date('2026-07-30T12:34:56.789Z'),
  });
  assert.match(report.fingerprint, /^[0-9a-f]{12}…[0-9a-f]{8}$/);
  assert.match(report.owner, /^[0-9a-f]{12}…[0-9a-f]{8}$/);
  assert.equal(report.season, null);
  assert.equal(report.tournament, null);
  assert.equal(report.seasonIsNull, true);
  assert.equal(report.tournamentIsNull, true);
  assert.equal(JSON.stringify(report).includes('00000000-'), false);
});

test('preference primary key must remain exact, ordered and non-deferrable', () => {
  const expected = [{
    name: 'user_tournament_context_preferences_pkey',
    columns: ['user_id', 'organization_id'],
    deferrable: false,
    initially_deferred: false,
  }];
  assert.equal(validatePreferencePrimaryKeyCatalog(expected), true);
  for (const rows of [
    [],
    [...expected, expected[0]],
    [{ ...expected[0], columns: [...expected[0].columns].reverse() }],
    [{ ...expected[0], deferrable: true }],
  ]) {
    assert.throws(() => validatePreferencePrimaryKeyCatalog(rows), /primary key contract/);
  }
});

test('preference columns, types and nullability remain exact', () => {
  const expected = [
    { name: 'user_id', type: 'uuid', not_null: true },
    { name: 'organization_id', type: 'uuid', not_null: true },
    { name: 'active_season_id', type: 'uuid', not_null: false },
    { name: 'active_tournament_id', type: 'uuid', not_null: false },
    { name: 'updated_at', type: 'timestamp with time zone', not_null: true },
  ];
  assert.equal(validatePreferenceCatalog(expected), undefined);
  for (const rows of [
    expected.slice(0, -1),
    expected.map((row, index) => index === 2 ? { ...row, type: 'text' } : row),
    expected.map((row, index) => index === 3 ? { ...row, not_null: true } : row),
  ]) {
    assert.throws(() => validatePreferenceCatalog(rows), /column\/type\/nullability contract/);
  }
});

test('external catalog accepts the three preference FKs plus the known zero-row workspace FK', () => {
  const rows = constraintFixture();
  assert.equal(validateExternalConstraintCatalog(rows, {
    expectedCount: rows.length,
    expectedFingerprint: externalConstraintCatalogFingerprint(rows),
  }), true);
});

test('a second external FK is rejected', () => {
  assert.throws(
    () => {
      const rows = constraintFixture();
      return validateExternalConstraintCatalog([
        ...rows,
        { ...rows[0], name: 'unexpected_external_fk' },
      ], {
        expectedCount: rows.length,
        expectedFingerprint: externalConstraintCatalogFingerprint(rows),
      });
    },
    /catalog count changed/,
  );
});

test('FK action, deferrability, columns and nullability are all fail-closed', () => {
  const mutations = [
    (row) => ({ ...row, delete_action: 'c' }),
    (row) => ({ ...row, deferrable: true }),
    (row) => ({ ...row, initially_deferred: true }),
    (row) => ({ ...row, source_columns: [...row.source_columns].reverse() }),
    (row) => ({ ...row, target_columns: [...row.target_columns].reverse() }),
    (row) => ({ ...row, nullable: row.nullable.map(() => false) }),
  ];
  for (const mutate of mutations) {
    const rows = constraintFixture();
    rows[1] = mutate(rows[1]);
    assert.throws(() => validateExternalConstraintCatalog(rows, {
      expectedCount: rows.length,
      expectedFingerprint: externalConstraintCatalogFingerprint(constraintFixture()),
    }), /contract changed/);
  }
});

test('preference destinations must exist with identical UUIDs in v2 and v3', async () => {
  const { descriptor, manifest } = await artifacts();
  const preference = {
    organization_id: descriptor.organizationId,
    active_season_id: descriptor.tables.find(
      (table) => table.table === 'tournament_seasons',
    ).rows[0].identity.id,
    active_tournament_id: descriptor.tables.find(
      (table) => table.table === 'tournaments',
    ).rows[0].identity.id,
  };
  assert.equal(assertSharedPreferenceDestinations(preference, descriptor, manifest), true);
  assert.equal(assertSharedPreferenceDestinations({
    ...preference,
    active_season_id: null,
    active_tournament_id: null,
  }, descriptor, manifest), true);
  assert.throws(
    () => assertSharedPreferenceDestinations({
      ...preference,
      active_tournament_id: '00000000-0000-4000-8000-000000000099',
    }, descriptor, manifest),
    /not identical/,
  );
  assert.throws(
    () => assertSharedPreferenceDestinations({
      ...preference,
      active_season_id: null,
    }, descriptor, manifest),
    /not identical/,
  );
  const otherTournament = manifest.operations.find(
    (operation) => operation.table === 'tournaments',
  ).rows[2];
  assert.equal(assertSharedPreferenceDestinations({
    ...preference,
    active_tournament_id: otherTournament.id,
  }, descriptor, manifest), true);
});

test('marker is separated from all 586 base rows for last-write insertion', async () => {
  const { manifest } = await artifacts();
  const split = splitManifestForAtomicReplacement(manifest);
  assert.equal(split.baseRows, 586);
  assert.equal(split.markers, 1);
  assert.equal(split.markerOperations.at(-1).rows[0].resource_id, REPLACEMENT_AUTHORIZATION.v3MarkerId);
  assert.ok(split.baseOperations.every((operation) => operation.rows.every(
    (row) => row.resource_type !== 'qa_seed_execution',
  )));
});

test('only SQLSTATE 40001 is retryable and never beyond three attempts', () => {
  assert.equal(shouldRetryReplacement({ code: '40001' }, 1, 3), true);
  assert.equal(shouldRetryReplacement({ code: '40001' }, 2, 3), true);
  assert.equal(shouldRetryReplacement({ code: '40001' }, 3, 3), false);
  for (const code of ['23503', '28P01', '42501', '08006', undefined]) {
    assert.equal(shouldRetryReplacement({ code }, 1, 3), false, code);
  }
});

test('runner source contains one COMMIT site and no forbidden remote mechanism', async () => {
  const source = await readFile(
    new URL('./replace-torneos-demo-v2-with-v3-direct.mjs', import.meta.url),
    'utf8',
  );
  assert.equal((source.match(/client\.query\('commit'\)/g) || []).length, 1);
  for (const forbidden of [
    'session_replication_role',
    'TRUNCATE',
    'supabase.execute_sql',
    'service_role',
    'connectionString',
    '--confirm',
    '9a161397fe84d50269cc8a290b74b9ab8f3880d3da745a8edb2cde0c36611221',
    'expectedPreferenceFingerprint',
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});
