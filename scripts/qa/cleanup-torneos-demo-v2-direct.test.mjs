import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  buildAuthorizedStagingTarget,
  evaluateConnectedDiagnostics,
} from './apply-torneos-seed-direct.mjs';
import {
  assertCleanupProjectRef,
  assertManualConfirmation,
  loadV2IdentityMap,
  parseCleanupArguments,
  preflightV2Cleanup,
} from './cleanup-torneos-demo-v2-direct.mjs';
import {
  V2_CLEANUP_AUTHORIZATION,
  canonicalJson,
  descriptorFingerprint,
  sha256,
  validateCleanupDescriptor,
} from './torneos-demo-v2-cleanup-contract.mjs';
import { TORNEOS_DEMO_V2_CLEANUP_DESCRIPTOR } from './torneos-demo-v2-cleanup-descriptor.mjs';

test('immutable v2 descriptor matches the historical authorization exactly', () => {
  const descriptor = validateCleanupDescriptor(TORNEOS_DEMO_V2_CLEANUP_DESCRIPTOR);
  assert.equal(descriptor.sourceCommit, V2_CLEANUP_AUTHORIZATION.sourceCommit);
  assert.equal(descriptor.seedKey, 'torneos-demo-v2');
  assert.equal(descriptor.manifestHash, V2_CLEANUP_AUTHORIZATION.manifestHash);
  assert.equal(
    descriptor.identityMapFingerprint,
    V2_CLEANUP_AUTHORIZATION.identityMapFingerprint,
  );
  assert.equal(descriptor.ownershipFingerprint, V2_CLEANUP_AUTHORIZATION.ownershipFingerprint);
  assert.equal(descriptor.expected.totalRows, 587);
  assert.equal(descriptor.expected.tables, 32);
  assert.equal(descriptorFingerprint(descriptor), descriptor.descriptorFingerprint);
});

test('cleanup descriptor contains only public dataset identities and excludes Auth/profiles', () => {
  const tables = TORNEOS_DEMO_V2_CLEANUP_DESCRIPTOR.tables.map((table) => table.table);
  assert.equal(new Set(tables).size, 32);
  assert.ok(tables.every((table) => table === 'tournaments' || table.startsWith('tournament_')));
  assert.ok(!tables.includes('usuarios'));
  assert.ok(!tables.some((table) => table.startsWith('auth.')));
  assert.equal(
    TORNEOS_DEMO_V2_CLEANUP_DESCRIPTOR.tables.reduce(
      (sum, table) => sum + table.rows.length,
      0,
    ),
    587,
  );
});

test('runner exposes exactly diagnose, preflight and execute modes', () => {
  for (const mode of ['diagnose', 'preflight', 'execute']) {
    assert.deepEqual(
      parseCleanupArguments([`--${mode}`, '--ca-cert', '/tmp/ca.crt'], {}),
      {
        mode,
        caCertPath: '/tmp/ca.crt',
        identityMapPath: 'torneos-demo-v2-identity-map.local',
      },
    );
  }
  assert.throws(() => parseCleanupArguments([], {}), /exactly one/);
  assert.throws(
    () => parseCleanupArguments(['--execute', '--preflight', '--ca-cert', '/tmp/ca.crt'], {}),
    /exactly one/,
  );
  assert.throws(
    () => parseCleanupArguments(['--execute', '--confirm', 'yes', '--ca-cert', '/tmp/ca.crt'], {}),
    /Unsupported/,
  );
  assert.throws(
    () => parseCleanupArguments(['--diagnose', '--ca-cert', '/tmp/ca.crt'], {
      NODE_TLS_REJECT_UNAUTHORIZED: '0',
    }),
    /forbidden/,
  );
});

test('manual confirmation is exact and cannot be shortened', () => {
  assert.equal(assertManualConfirmation('ELIMINAR torneos-demo-v2 DE STAGING'), true);
  for (const answer of [
    '',
    'ELIMINAR torneos-demo-v2',
    'ELIMINAR TORNEOS-DEMO-V2 DE STAGING',
    'ELIMINAR torneos-demo-v2 DE PRODUCTION',
    'ELIMINAR torneos-demo-v2 DE STAGING ',
  ]) {
    assert.throws(() => assertManualConfirmation(answer), /did not match exactly/);
  }
});

test('Production and every non-Staging project ref are blocked', () => {
  assert.equal(assertCleanupProjectRef('hhyvmhgpapyuzjgxfnqv'), 'hhyvmhgpapyuzjgxfnqv');
  assert.throws(() => assertCleanupProjectRef('rcyuuoaqfwcembdajcss'), /Production/);
  assert.throws(() => assertCleanupProjectRef('local'), /Only the exact/);
  assert.throws(() => assertCleanupProjectRef(''), /Only the exact/);
});

test('Production preflight is rejected before the first database query', async () => {
  let queries = 0;
  await assert.rejects(
    () => preflightV2Cleanup({
      query: async () => {
        queries += 1;
        throw new Error('query must not run');
      },
    }, {
      targetProjectRef: 'rcyuuoaqfwcembdajcss',
      profiles: [],
    }),
    /Production/,
  );
  assert.equal(queries, 0);
});

test('the same eight strict connected diagnostics can pass without cleanup calls', () => {
  const target = buildAuthorizedStagingTarget('test-only');
  const diagnostic = evaluateConnectedDiagnostics({
    target,
    server: {
      databaseName: 'postgres',
      currentUser: 'postgres',
      sessionUser: 'postgres',
      serverAddress: '10.0.0.14',
      serverPort: 5432,
      backendPid: 42,
      backendSsl: true,
      backendTlsVersion: 'TLSv1.3',
      backendCipher: 'TLS_AES_256_GCM_SHA384',
    },
    tls: {
      encrypted: true,
      authorized: true,
      authorizationError: null,
      protocol: 'TLSv1.3',
      cipher: 'TLS_AES_256_GCM_SHA384',
      servername: target.hostname,
      peerSubjectCN: '*.pooler.supabase.com',
      peerIssuerCN: 'Supabase database CA',
    },
  });
  assert.equal(diagnostic.status, 'pass');
  assert.deepEqual(Object.keys(diagnostic.checks).sort(), [
    'certificate_validation',
    'database',
    'port',
    'project_ref',
    'session_pooler',
    'ssl_active',
    'tls_version',
    'username',
  ]);
});

test('v2 identity map loader accepts no credentials and requires a matching fingerprint', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'torneos-v2-identities-'));
  const file = join(directory, 'identities.local');
  const raw = Object.fromEntries([
    'owner',
    'admin',
    'collaborator',
    'delegate',
    'player',
    'outsider',
  ].map((role, index) => [role, {
    auth_user_id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    expected_email: `${role}@localhost.invalid`,
    logical_role: role,
    projected_relations: [`fixture:${role}`],
  }]));
  const expectedFingerprint = sha256(canonicalJson(Object.fromEntries(
    Object.entries(raw).map(([role, identity]) => [role, {
      auth_user_id: identity.auth_user_id,
      email_fingerprint: sha256(identity.expected_email),
      logical_role: role,
      projected_relations: identity.projected_relations,
    }]),
  )));
  try {
    await writeFile(file, JSON.stringify(raw), { mode: 0o600 });
    const loaded = await loadV2IdentityMap(file, { expectedFingerprint });
    assert.equal(loaded.fingerprint, expectedFingerprint);
    assert.equal(loaded.profiles.length, 6);
    raw.owner.password = 'forbidden';
    await writeFile(file, JSON.stringify(raw), { mode: 0o600 });
    await assert.rejects(
      () => loadV2IdentityMap(file, { expectedFingerprint }),
      /Forbidden credential field/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
