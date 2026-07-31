import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import pg from 'pg';
import { createClient } from '@supabase/supabase-js';

import {
  assertSharedPreferenceDestinations,
  buildV3IdentityMap,
  executeReplacement,
  preferenceFingerprint,
  preflightReplacement,
  validateReplacementArtifacts,
} from './replace-torneos-demo-v2-with-v3-direct.mjs';
import {
  V2_CLEANUP_AUTHORIZATION,
  buildCleanupDescriptor,
} from './torneos-demo-v2-cleanup-contract.mjs';
import { buildCanonicalManifest } from './torneos-demo-manifest.mjs';
import { insertManifestMarkerInCurrentTransaction } from './torneos-seed-db.mjs';

function localRuntime() {
  if (process.env.QA_TORNEOS_REPLACEMENT_LOCAL_TEST !== 'true') return null;
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

const runtime = localRuntime();

test('atomic v2 to v3 replacement is fail-closed across the required local matrix', {
  skip: !runtime,
}, async (t) => {
  const historical = await historicalModules();
  const client = new pg.Client({ connectionString: runtime.databaseUrl });
  await client.connect();
  const authAdmin = createClient(runtime.apiUrl, runtime.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  }).auth.admin;
  let sentinelUserId = null;
  try {
    const prepared = await historical.users.createLocalUsers({
      client,
      authAdmin,
      expectedEmails: historical.users.localExpectedEmails({}),
    });
    const v2Manifest = historical.manifest.buildCanonicalManifest({
      identityMap: prepared.identityMap,
    });
    historical.manifest.validateCanonicalManifest(v2Manifest);
    const descriptor = buildCleanupDescriptor(v2Manifest, {
      authorization: {
        ...V2_CLEANUP_AUTHORIZATION,
        manifestHash: v2Manifest.manifestHash,
        identityMapFingerprint: v2Manifest.identityMapFingerprint,
        ownershipFingerprint: v2Manifest.rowOwnershipFingerprint,
      },
    });
    const profiles = profilesFromIdentityMap(prepared.identityMap);
    const manifest = buildCanonicalManifest({ identityMap: buildV3IdentityMap(profiles) });
    const artifactAuthorization = {
      v2ManifestHash: descriptor.manifestHash,
      v2IdentityFingerprint: descriptor.identityMapFingerprint,
      v2OwnershipFingerprint: descriptor.ownershipFingerprint,
      v2DescriptorFingerprint: descriptor.descriptorFingerprint,
      v3ManifestHash: manifest.manifestHash,
      v3IdentityFingerprint: manifest.identityMapFingerprint,
      v3OwnershipFingerprint: manifest.rowOwnershipFingerprint,
      v3MarkerId: manifest.seedRegistryId,
      baseRows: 586,
      totalRows: 587,
      tables: 32,
    };
    validateReplacementArtifacts({ descriptor, manifest, authorization: artifactAuthorization });

    await t.test('1 load exact v2 as 587 rows in 32 tables', async () => {
      const result = await historical.database.materializeManifest(client, v2Manifest);
      assert.equal(result.status, 'created');
      assert.equal(result.verification.present, 587);
      assert.equal(descriptor.tables.length, 32);
    });

    const seasonId = descriptor.tables.find(
      (table) => table.table === 'tournament_seasons',
    ).rows[0].identity.id;
    const tournamentId = descriptor.tables.find(
      (table) => table.table === 'tournaments',
    ).rows[0].identity.id;
    const preferenceTimestamp = new Date('2026-07-30T10:11:12.345Z');
    await client.query(
      `insert into public.user_tournament_context_preferences (
         user_id, organization_id, active_season_id, active_tournament_id, updated_at
       ) values ($1, $2, $3, $4, $5)`,
      [profiles.find((profile) => profile.role === 'owner').id,
        descriptor.organizationId, seasonId, tournamentId, preferenceTimestamp],
    );
    const preferenceBefore = (await client.query(
      `select user_id, organization_id, active_season_id, active_tournament_id, updated_at
       from public.user_tournament_context_preferences
       where organization_id = $1`,
      [descriptor.organizationId],
    )).rows[0];
    const expectedPreferenceFingerprint = preferenceFingerprint(preferenceBefore);
    assertSharedPreferenceDestinations(preferenceBefore, descriptor, manifest);

    const { data: sentinelUser, error: sentinelUserError } = await authAdmin.createUser({
      email: 'qa-replacement-sentinel@localhost.invalid',
      email_confirm: true,
      app_metadata: { qa_seed_key: 'foreign-sentinel', qa_role: 'owner' },
    });
    assert.equal(sentinelUserError, null);
    sentinelUserId = sentinelUser.user.id;
    const sentinelOrganization = '11111111-2222-4333-8444-555555555555';
    const sentinelMembership = '22222222-3333-4444-8555-666666666666';
    const sentinelAuditResource = '33333333-4444-4555-8666-777777777777';
    await client.query(
      `insert into public.tournament_organizations (
         id, name, slug, status, created_by, creation_key
       ) values ($1, 'Sentinel ajeno', 'sentinel-reemplazo', 'active', $2, $3)`,
      [sentinelOrganization, sentinelUserId, '44444444-5555-4666-8777-888888888888'],
    );
    await client.query(
      `insert into public.tournament_organization_members (
         id, organization_id, user_id, role, status, invited_by, joined_at
       ) values ($1, $2, $3, 'owner', 'active', $3, now())`,
      [sentinelMembership, sentinelOrganization, sentinelUserId],
    );
    await client.query(
      `insert into public.tournament_audit_log (
         organization_id, actor_user_id, actor_type, action, resource_type, resource_id, metadata
       ) values ($1, $2, 'user', 'qa.sentinel.preserved', 'qa_sentinel', $3, '{"foreign":true}')`,
      [sentinelOrganization, sentinelUserId, sentinelAuditResource],
    );

    const replacementOptions = {
      descriptor,
      manifest,
      profiles,
      expectedPreferenceFingerprint,
      artifactAuthorization,
      backoffMs: [0, 0],
    };

    async function assertOriginalState(label) {
      const preflight = await preflightReplacement(client, replacementOptions);
      assert.equal(preflight.status, 'ready', label);
      assert.equal(preflight.v2State.present, 587, label);
      assert.equal(preflight.v2State.exact, 587, label);
      assert.equal(preflight.v3State.present < 587, true, label);
      assert.equal(preflight.preferenceFingerprint, expectedPreferenceFingerprint, label);
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
      }, label);
    }

    await t.test('2 preflight captures one exact preference and foreign sentinels', async () => {
      const preflight = await preflightReplacement(client, replacementOptions);
      assert.equal(preflight.status, 'ready');
      assert.equal(preflight.preferenceFingerprint, expectedPreferenceFingerprint);
      assert.equal(preflight.profiles.count, 6);
      assert.equal(preflight.v2.present, 587);
    });

    const failures = [
      ['3 failure before preference deletion', { failpoint: 'before_preference_delete' }],
      ['4 failure after preference deletion', { failpoint: 'after_preference_delete' }],
      ['5 failure during v2 cleanup', { failAfterCleanupDeleteCount: 25 }],
      ['6 failure during v3 base insertion', { failAfterV3BaseRowCount: 25 }],
      ['7 failure before preference restore', { failpoint: 'before_preference_restore' }],
      ['8 failure after preference restore', { failpoint: 'after_preference_restore' }],
      ['9 failure before v3 marker', { failpoint: 'before_v3_marker' }],
      ['10 failure after marker before commit', { failpoint: 'after_v3_marker' }],
    ];
    for (const [name, injection] of failures) {
      await t.test(name, async () => {
        await assert.rejects(
          () => executeReplacement(client, { ...replacementOptions, ...injection }),
          (error) => error.code === '22012',
        );
        await assertOriginalState(name);
      });
    }

    await t.test('11 incorrect preference fingerprint aborts before writing', async () => {
      await assert.rejects(
        () => executeReplacement(client, {
          ...replacementOptions,
          expectedPreferenceFingerprint: '0'.repeat(64),
        }),
        /fingerprint mismatch/,
      );
      await assertOriginalState('incorrect preference fingerprint');
    });

    await t.test('12 a second external preference aborts before writing', async () => {
      await client.query('begin');
      try {
        await client.query(
          `insert into public.user_tournament_context_preferences (
             user_id, organization_id, active_season_id, active_tournament_id, updated_at
           ) values ($1, $2, $3, $4, $5)`,
          [profiles.find((profile) => profile.role === 'admin').id,
            descriptor.organizationId, seasonId, tournamentId, preferenceTimestamp],
        );
        await assert.rejects(
          () => preflightReplacement(client, replacementOptions),
          /exactly one external preference/,
        );
      } finally {
        await client.query('rollback');
      }
      await assertOriginalState('second preference');
    });

    await t.test('13 a new external FK aborts before writing', async () => {
      await client.query('begin');
      try {
        await client.query(
          `create table public.qa_replacement_external_fk (
             id uuid primary key,
             organization_id uuid references public.tournament_organizations(id)
           )`,
        );
        await assert.rejects(
          () => preflightReplacement(client, replacementOptions),
          /catalog count changed/,
        );
      } finally {
        await client.query('rollback');
      }
      await assertOriginalState('new FK');
    });

    await t.test('14 RESTRICT/CASCADE change aborts', async () => {
      await client.query('begin');
      try {
        await client.query(
          `alter table public.user_tournament_context_preferences
             drop constraint user_tournament_context_season_fk,
             add constraint user_tournament_context_season_fk
             foreign key (organization_id, active_season_id)
             references public.tournament_seasons(organization_id, id) on delete cascade`,
        );
        await assert.rejects(
          () => preflightReplacement(client, replacementOptions),
          /constraint contract changed/,
        );
      } finally {
        await client.query('rollback');
      }
      await assertOriginalState('FK action');
    });

    await t.test('15 nullability change aborts', async () => {
      await client.query('begin');
      try {
        await client.query(
          `alter table public.user_tournament_context_preferences
           alter column active_season_id set not null`,
        );
        await assert.rejects(
          () => preflightReplacement(client, replacementOptions),
          /column\/type\/nullability contract changed/,
        );
      } finally {
        await client.query('rollback');
      }
      await assertOriginalState('nullability');
    });

    await t.test('16 UUID mismatch between v2 and v3 aborts before database access', () => {
      const changed = structuredClone(manifest);
      changed.operations.find((operation) => operation.table === 'tournaments').rows[0].id =
        '00000000-0000-4000-8000-000000000099';
      assert.throws(
        () => assertSharedPreferenceDestinations(preferenceBefore, descriptor, changed),
        /not identical/,
      );
    });

    await t.test('17 incomplete v2 aborts before writing', async () => {
      await client.query('begin');
      try {
        await client.query(
          `delete from public.tournament_organization_members
           where organization_id = $1 and role = 'collaborator'`,
          [descriptor.organizationId],
        );
        await assert.rejects(
          () => preflightReplacement(client, replacementOptions),
          /Replacement v2 preflight rejected/,
        );
      } finally {
        await client.query('rollback');
      }
      await assertOriginalState('incomplete v2');
    });

    await t.test('18 simultaneous v2 and v3 markers abort', async () => {
      await client.query('begin');
      try {
        await insertManifestMarkerInCurrentTransaction(client, manifest);
        await assert.rejects(
          () => preflightReplacement(client, replacementOptions),
          /simultaneously|partial/,
        );
      } finally {
        await client.query('rollback');
      }
      await assertOriginalState('both markers');
    });

    await t.test('19 non-40001 is not retried and rolls back', async () => {
      let attempts = 0;
      await assert.rejects(
        () => executeReplacement(client, {
          ...replacementOptions,
          afterPreflight: () => {
            attempts += 1;
            const error = new Error('synthetic FK failure');
            error.code = '23503';
            throw error;
          },
        }),
        (error) => error.code === '23503',
      );
      assert.equal(attempts, 1);
      await assertOriginalState('non-40001');
    });

    await t.test('20 retry 40001 repeats full preflight and stops at three', async () => {
      const attempts = [];
      const retries = [];
      const result = await executeReplacement(client, {
        ...replacementOptions,
        onRetry: (event) => retries.push(event),
        afterPreflight: ({ attempt, preflight }) => {
          attempts.push({ attempt, status: preflight.status });
          if (attempt < 3) {
            const error = new Error('synthetic serialization failure');
            error.code = '40001';
            throw error;
          }
        },
      });
      assert.equal(result.status, 'replaced');
      assert.equal(result.attempts, 3);
      assert.equal(result.retries, 2);
      assert.deepEqual(attempts, [
        { attempt: 1, status: 'ready' },
        { attempt: 2, status: 'ready' },
        { attempt: 3, status: 'ready' },
      ]);
      assert.equal(retries.length, 2);
      assert.ok(retries.every((event) => event.code === '40001'));
      assert.equal(result.validation.v2Rows, 0);
      assert.equal(result.validation.v3Rows, 587);
      assert.equal(result.validation.markerV3, 1);
      assert.equal(result.validation.preferenceRestored, true);
      assert.equal(result.validation.updatedAtIdentical, true);
      assert.equal(result.validation.foreignDataIdentical, true);
      assert.equal(result.validation.triggersIdentical, true);
      assert.equal(result.validation.outsiderRelations, 0);
      assert.equal(result.lastWrite, 'v3_marker');
    });

    await t.test('21 second execution is an exact zero-write skip', async () => {
      const result = await executeReplacement(client, replacementOptions);
      assert.equal(result.status, 'skip');
      assert.equal(result.preflight.reason, 'v3_already_exact');
      const preferenceAfter = (await client.query(
        `select user_id, organization_id, active_season_id, active_tournament_id, updated_at
         from public.user_tournament_context_preferences
         where organization_id = $1`,
        [descriptor.organizationId],
      )).rows[0];
      assert.equal(preferenceFingerprint(preferenceAfter), expectedPreferenceFingerprint);
      assert.equal(preferenceAfter.updated_at.toISOString(), preferenceTimestamp.toISOString());
    });

    await t.test('22 Auth, profiles, preference and sentinels remain intact', async () => {
      const auth = await client.query(
        'select count(*)::integer as count from auth.users where id = any($1::uuid[])',
        [profiles.map((profile) => profile.id)],
      );
      const publicProfiles = await client.query(
        'select count(*)::integer as count from public.usuarios where id = any($1::uuid[])',
        [profiles.map((profile) => profile.id)],
      );
      const sentinel = await client.query(
        `select
           (select count(*)::integer from public.tournament_organizations where id = $1) as organizations,
           (select count(*)::integer from public.tournament_organization_members where id = $2) as memberships,
           (select count(*)::integer from public.tournament_audit_log where resource_id = $3) as audit_rows`,
        [sentinelOrganization, sentinelMembership, sentinelAuditResource],
      );
      assert.equal(auth.rows[0].count, 6);
      assert.equal(publicProfiles.rows[0].count, 6);
      assert.deepEqual(sentinel.rows[0], { organizations: 1, memberships: 1, audit_rows: 1 });
    });
  } finally {
    await client.end();
    if (sentinelUserId) await authAdmin.deleteUser(sentinelUserId);
  }
});
