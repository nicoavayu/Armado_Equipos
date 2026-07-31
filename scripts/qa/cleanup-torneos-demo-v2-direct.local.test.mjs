import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import pg from 'pg';
import { createClient } from '@supabase/supabase-js';

import {
  executeV2Cleanup,
  preflightV2Cleanup,
} from './cleanup-torneos-demo-v2-direct.mjs';
import {
  V2_CLEANUP_AUTHORIZATION,
  buildCleanupDescriptor,
} from './torneos-demo-v2-cleanup-contract.mjs';

function localRuntime() {
  if (process.env.QA_TORNEOS_V2_CLEANUP_LOCAL_TEST !== 'true') return null;
  const status = spawnSync('npx', ['supabase', 'status', '-o', 'env'], {
    encoding: 'utf8',
  });
  if (status.status !== 0) throw new Error('Supabase local status failed.');
  const value = (name) => status.stdout.match(new RegExp(`^${name}="([^"]+)"$`, 'm'))?.[1];
  const runtime = {
    databaseUrl: value('DB_URL'),
    apiUrl: value('API_URL'),
    serviceRoleKey: value('SERVICE_ROLE_KEY'),
  };
  if (Object.values(runtime).some((entry) => !entry)) {
    throw new Error('Supabase local runtime is incomplete.');
  }
  return runtime;
}

async function historicalModules() {
  const root = process.env.QA_V2_HISTORICAL_WORKTREE;
  if (!root) throw new Error('QA_V2_HISTORICAL_WORKTREE is required.');
  return {
    users: await import(pathToFileURL(`${root}/scripts/qa/prepare-torneos-qa-users.mjs`)),
    manifest: await import(pathToFileURL(`${root}/scripts/qa/torneos-demo-manifest.mjs`)),
    database: await import(pathToFileURL(`${root}/scripts/qa/torneos-seed-db.mjs`)),
  };
}

function profilesFromIdentityMap(identityMap) {
  return Object.entries(identityMap.toJSON()).map(([role, identity]) => ({
    role,
    id: identity.auth_user_id,
    email: identity.expected_email,
  }));
}

async function markerMutation(client, descriptor, metadataMutation) {
  await client.query('begin');
  try {
    await client.query(
      'alter table public.tournament_audit_log disable trigger tournament_audit_append_only',
    );
    const marker = await client.query(
      `select metadata
       from public.tournament_audit_log
       where resource_type = $1 and resource_id = $2 and action = $3`,
      [
        descriptor.marker.identity.resource_type,
        descriptor.marker.identity.resource_id,
        descriptor.marker.identity.action,
      ],
    );
    await client.query(
      `update public.tournament_audit_log
       set metadata = $4::jsonb
       where resource_type = $1 and resource_id = $2 and action = $3`,
      [
        descriptor.marker.identity.resource_type,
        descriptor.marker.identity.resource_id,
        descriptor.marker.identity.action,
        JSON.stringify(metadataMutation(structuredClone(marker.rows[0].metadata))),
      ],
    );
    await client.query(
      'alter table public.tournament_audit_log enable trigger tournament_audit_append_only',
    );
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

const runtime = localRuntime();

test('remote v2 cleanup engine is fail-closed across the required local matrix', {
  skip: !runtime,
}, async (t) => {
  const historical = await historicalModules();
  const client = new pg.Client({ connectionString: runtime.databaseUrl });
  await client.connect();
  const authAdmin = createClient(runtime.apiUrl, runtime.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  }).auth.admin;
  try {
    const prepared = await historical.users.createLocalUsers({
      client,
      authAdmin,
      expectedEmails: historical.users.localExpectedEmails({}),
    });
    const manifest = historical.manifest.buildCanonicalManifest({
      identityMap: prepared.identityMap,
    });
    historical.manifest.validateCanonicalManifest(manifest);
    const localAuthorization = {
      ...V2_CLEANUP_AUTHORIZATION,
      manifestHash: manifest.manifestHash,
      identityMapFingerprint: manifest.identityMapFingerprint,
      ownershipFingerprint: manifest.rowOwnershipFingerprint,
    };
    const descriptor = buildCleanupDescriptor(manifest, {
      authorization: localAuthorization,
    });
    const profiles = profilesFromIdentityMap(prepared.identityMap);

    await t.test('1 historical v2 manifest applies as 587 rows in 32 tables', async () => {
      const result = await historical.database.materializeManifest(client, manifest);
      assert.equal(result.status, 'created');
      assert.equal(result.verification.present, 587);
      assert.equal(descriptor.tables.length, 32);
    });

    const { data: sentinelUser, error: sentinelUserError } = await authAdmin.createUser({
      email: 'qa-v2-cleanup-sentinel@localhost.invalid',
      email_confirm: true,
      app_metadata: { qa_seed_key: 'foreign-sentinel', qa_role: 'owner' },
    });
    assert.equal(sentinelUserError, null);
    const sentinelOrganization = '11111111-2222-4333-8444-555555555555';
    const sentinelMembership = '22222222-3333-4444-8555-666666666666';
    const sentinelAuditResource = '33333333-4444-4555-8666-777777777777';
    await client.query(
      `insert into public.tournament_organizations (
         id, name, slug, status, created_by, creation_key
       ) values ($1, 'Sentinel ajeno', 'sentinel-ajeno', 'active', $2, $3)`,
      [sentinelOrganization, sentinelUser.user.id, '44444444-5555-4666-8777-888888888888'],
    );
    await client.query(
      `insert into public.tournament_organization_members (
         id, organization_id, user_id, role, status, invited_by, joined_at
       ) values ($1, $2, $3, 'owner', 'active', $3, now())`,
      [sentinelMembership, sentinelOrganization, sentinelUser.user.id],
    );
    await client.query(
      `insert into public.tournament_audit_log (
         organization_id, actor_user_id, actor_type, action, resource_type, resource_id, metadata
       ) values ($1, $2, 'user', 'qa.sentinel.preserved', 'qa_sentinel', $3, '{"foreign":true}')`,
      [sentinelOrganization, sentinelUser.user.id, sentinelAuditResource],
    );

    await t.test('2 preflight sees exact v2 and inventories foreign sentinels', async () => {
      const result = await preflightV2Cleanup(client, { descriptor, profiles });
      assert.equal(result.status, 'ready', JSON.stringify(result.failures));
      assert.equal(result.present, 587);
      assert.equal(result.exact, 587);
      assert.equal(result.tables, 32);
      assert.ok(result.foreignInventory.some((entry) => entry.count > 0));
      assert.equal(result.profiles.count, 6);
      assert.equal(result.authPlanRows, 0);
    });

    await t.test('3 incorrect marker aborts with zero writes', async () => {
      await markerMutation(client, descriptor, (metadata) => ({
        ...metadata,
        seed_key: 'torneos-demo-v2-wrong',
      }));
      const result = await preflightV2Cleanup(client, { descriptor, profiles });
      assert.equal(result.status, 'reject');
      assert.ok(result.failures.includes('marker_v2_mismatch'));
      await client.query('rollback');
      assert.equal((await preflightV2Cleanup(client, { descriptor, profiles })).status, 'ready');
    });

    await t.test('4 incorrect manifest hash aborts with zero writes', async () => {
      await markerMutation(client, descriptor, (metadata) => ({
        ...metadata,
        manifest_hash: '0'.repeat(64),
      }));
      const result = await preflightV2Cleanup(client, { descriptor, profiles });
      assert.equal(result.status, 'reject');
      assert.ok(result.failures.includes('marker_v2_mismatch'));
      await client.query('rollback');
      assert.equal((await preflightV2Cleanup(client, { descriptor, profiles })).status, 'ready');
    });

    await t.test('5 one missing row aborts with zero writes', async () => {
      await client.query('begin');
      await client.query(
        `delete from public.tournament_organization_members
         where organization_id = $1 and role = 'collaborator'`,
        [descriptor.organizationId],
      );
      const result = await preflightV2Cleanup(client, { descriptor, profiles });
      assert.equal(result.status, 'reject');
      assert.ok(result.failures.includes('partial_or_tampered_v2'));
      await client.query('rollback');
      assert.equal((await preflightV2Cleanup(client, { descriptor, profiles })).present, 587);
    });

    await t.test('6 one modified row aborts with zero writes', async () => {
      await client.query('begin');
      await client.query(
        `update public.tournament_organization_members
         set role = 'admin'
         where organization_id = $1 and role = 'collaborator'`,
        [descriptor.organizationId],
      );
      const result = await preflightV2Cleanup(client, { descriptor, profiles });
      assert.equal(result.status, 'reject');
      assert.ok(result.failures.includes('partial_or_tampered_v2'));
      await client.query('rollback');
      assert.equal((await preflightV2Cleanup(client, { descriptor, profiles })).status, 'ready');
    });

    await t.test('7 unexpected v2-owned row aborts with zero writes', async () => {
      await client.query('begin');
      await client.query(
        `insert into public.tournament_organization_members (
           id, organization_id, user_id, role, status, invited_by, joined_at
         ) values ($1, $2, $3, 'collaborator', 'active', $3, now())`,
        [
          '55555555-6666-4777-8888-999999999999',
          descriptor.organizationId,
          sentinelUser.user.id,
        ],
      );
      const result = await preflightV2Cleanup(client, { descriptor, profiles });
      assert.equal(result.status, 'reject');
      assert.ok(result.failures.includes('unexpected_v2_ownership'));
      await client.query('rollback');
      assert.equal((await preflightV2Cleanup(client, { descriptor, profiles })).status, 'ready');
    });

    await t.test('8 v3 marker present aborts with zero writes', async () => {
      await client.query('begin');
      await client.query(
        `insert into public.tournament_audit_log (
           organization_id, actor_user_id, actor_type, action, resource_type, resource_id, metadata
         ) values ($1, $2, 'user', 'qa.seed.applied', 'qa_seed_execution', $3, $4::jsonb)`,
        [
          descriptor.organizationId,
          profiles[0].id,
          '85ab8c2e-6cd5-54c4-86b6-fbbfc0f0b050',
          JSON.stringify({ seed_key: 'torneos-demo-v3' }),
        ],
      );
      const result = await preflightV2Cleanup(client, { descriptor, profiles });
      assert.equal(result.status, 'reject');
      assert.ok(result.failures.includes('marker_v3_present'));
      await client.query('rollback');
      assert.equal((await preflightV2Cleanup(client, { descriptor, profiles })).status, 'ready');
    });

    await t.test('9 deliberate delete failure rolls back all 587 v2 rows', async () => {
      await assert.rejects(
        () => executeV2Cleanup(client, {
          descriptor,
          profiles,
          failAfterDeleteCount: 25,
        }),
        (error) => error.code === '22012',
      );
      const result = await preflightV2Cleanup(client, { descriptor, profiles });
      assert.equal(result.status, 'ready');
      assert.equal(result.present, 587);
    });

    const authBefore = await client.query(
      'select count(*)::integer as count from auth.users where id = any($1::uuid[])',
      [profiles.map((profile) => profile.id)],
    );
    await t.test('10 only SQLSTATE 40001 retries, re-preflights, then preserves sentinels', async () => {
      const preflightAttempts = [];
      const retryEvents = [];
      const result = await executeV2Cleanup(client, {
        descriptor,
        profiles,
        backoffMs: [0, 0],
        onRetry: (event) => retryEvents.push(event),
        afterPreflight: ({ attempt, preflight }) => {
          preflightAttempts.push({ attempt, status: preflight.status });
          if (attempt < 3) {
            const error = new Error('synthetic serialization failure after full preflight');
            error.code = '40001';
            throw error;
          }
        },
      });
      assert.equal(result.status, 'cleaned');
      assert.equal(result.attempts, 3);
      assert.equal(result.retries, 2);
      assert.deepEqual(preflightAttempts, [
        { attempt: 1, status: 'ready' },
        { attempt: 2, status: 'ready' },
        { attempt: 3, status: 'ready' },
      ]);
      assert.equal(retryEvents.length, 2);
      assert.ok(retryEvents.every((event) => event.code === '40001'));
      assert.equal(result.deleted, 587);
      assert.equal(result.markerV2, 0);
      assert.equal(result.orphanRows, 0);
      assert.equal(result.profiles.count, 6);
      assert.equal(result.deleteGuardsRestored, true);
      const sentinel = await client.query(
        `select
           (select count(*)::integer from public.tournament_organizations where id = $1) as organizations,
           (select count(*)::integer from public.tournament_organization_members where id = $2) as memberships,
           (select count(*)::integer from public.tournament_audit_log where resource_id = $3) as audit_rows`,
        [sentinelOrganization, sentinelMembership, sentinelAuditResource],
      );
      assert.deepEqual(sentinel.rows[0], {
        organizations: 1,
        memberships: 1,
        audit_rows: 1,
      });
    });

    await t.test('11 second execution rejects safely and writes nothing', async () => {
      const retryEvents = [];
      await assert.rejects(
        () => executeV2Cleanup(client, {
          descriptor,
          profiles,
          onRetry: (event) => retryEvents.push(event),
        }),
        (error) => error.preflight?.status === 'reject',
      );
      assert.equal(retryEvents.length, 0);
      const sentinel = await client.query(
        'select count(*)::integer as count from public.tournament_organizations where id = $1',
        [sentinelOrganization],
      );
      assert.equal(sentinel.rows[0].count, 1);
    });

    await t.test('12 Auth and six profiles remain intact and outside the delete plan', async () => {
      const authAfter = await client.query(
        'select count(*)::integer as count from auth.users where id = any($1::uuid[])',
        [profiles.map((profile) => profile.id)],
      );
      const profileAfter = await client.query(
        'select count(*)::integer as count from public.usuarios where id = any($1::uuid[])',
        [profiles.map((profile) => profile.id)],
      );
      assert.equal(authBefore.rows[0].count, 6);
      assert.equal(authAfter.rows[0].count, 6);
      assert.equal(profileAfter.rows[0].count, 6);
      assert.ok(!descriptor.tables.some((table) => table.table === 'usuarios'));
    });
  } finally {
    await client.end();
  }
});
