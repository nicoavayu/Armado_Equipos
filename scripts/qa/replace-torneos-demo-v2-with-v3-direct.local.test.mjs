import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import pg from 'pg';
import { createClient } from '@supabase/supabase-js';

import {
  acquireReplacementAdvisoryLock,
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
import { buildCanonicalManifest } from './torneos-demo-v3-manifest.mjs';
import {
  cleanupManifest,
  insertManifestMarkerInCurrentTransaction,
} from './torneos-seed-db.mjs';

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
    const alternateTournamentId = descriptor.tables.find(
      (table) => table.table === 'tournaments',
    ).rows[2].identity.id;
    const preferenceTimestamp = new Date('2026-07-30T10:11:12.345Z');
    await client.query(
      `insert into public.user_tournament_context_preferences (
         user_id, organization_id, active_season_id, active_tournament_id, updated_at
       ) values ($1, $2, $3, $4, $5)`,
      [profiles.find((profile) => profile.role === 'owner').id,
        descriptor.organizationId, seasonId, tournamentId, preferenceTimestamp],
    );
    const preferenceBefore = (await client.query(
      `select user_id, organization_id, active_season_id, active_tournament_id,
              updated_at::text as updated_at
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
      artifactAuthorization,
      backoffMs: [0, 0],
    };

    async function preflightInCurrentTransaction(options = replacementOptions) {
      const advisoryLock = await acquireReplacementAdvisoryLock(client);
      return preflightReplacement(client, {
        ...options,
        advisoryLock,
        advisoryLockReleasedBy: 'transaction_end',
      });
    }

    async function readOnlyPreflight(options = replacementOptions) {
      await client.query('begin isolation level repeatable read read only');
      try {
        const advisoryLock = await acquireReplacementAdvisoryLock(client);
        return await preflightReplacement(client, {
          ...options,
          advisoryLock,
          advisoryLockReleasedBy: 'rollback',
        });
      } finally {
        await client.query('rollback');
      }
    }

    async function currentPreference() {
      return (await client.query(
        `select user_id, organization_id, active_season_id, active_tournament_id,
                updated_at::text as updated_at
           from public.user_tournament_context_preferences
          where organization_id = $1`,
        [descriptor.organizationId],
      )).rows[0];
    }

    async function resetV3ToV2(preference) {
      await client.query(
        `delete from public.user_tournament_context_preferences
          where user_id = $1 and organization_id = $2`,
        [preference.user_id, preference.organization_id],
      );
      const cleaned = await cleanupManifest(client, manifest, {
        apply: true,
        allowLocalTriggerBypass: true,
      });
      assert.equal(cleaned.status, 'cleaned');
      const restoredV2 = await historical.database.materializeManifest(client, v2Manifest);
      assert.equal(restoredV2.status, 'created');
      await client.query(
        `insert into public.user_tournament_context_preferences (
           user_id, organization_id, active_season_id, active_tournament_id, updated_at
         ) values ($1, $2, $3, $4, $5)`,
        [preference.user_id, preference.organization_id, preference.active_season_id,
          preference.active_tournament_id, preference.updated_at],
      );
    }

    async function assertOriginalState(label) {
      const preflight = await readOnlyPreflight();
      assert.equal(preflight.status, 'ready', label);
      assert.equal(preflight.v2State.present, 587, label);
      assert.equal(preflight.v2State.exact, 587, label);
      assert.equal(preflight.v3State.present < 587, true, label);
      assert.equal(
        preflight.preferenceFingerprint,
        preferenceFingerprint(preflight.preference),
        label,
      );
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
      const preflight = await readOnlyPreflight();
      assert.equal(preflight.status, 'ready');
      assert.equal(preflight.advisoryLockAttempted, true);
      assert.equal(preflight.advisoryLockAcquired, true);
      assert.equal(preflight.advisoryLockSource, 'postgres');
      assert.equal(preflight.advisoryLockReleasedBy, 'rollback');
      assert.equal(preflight.preferenceFingerprint, expectedPreferenceFingerprint);
      assert.equal(preflight.profiles.count, 6);
      assert.equal(preflight.v2.present, 587);
      assert.equal(preflight.constraints.length, 62);
      assert.ok(preflight.constraints.some(
        (constraint) => constraint.name === 'tournament_social_permissions_organization_fk',
      ));
    });

    await t.test('advisory lock concurrency is fail-closed and released by rollback', async () => {
      const holder = new pg.Client({ connectionString: runtime.databaseUrl });
      const contender = new pg.Client({ connectionString: runtime.databaseUrl });
      const observer = new pg.Client({ connectionString: runtime.databaseUrl });
      await Promise.all([holder.connect(), contender.connect(), observer.connect()]);
      try {
        await holder.query('begin');
        await acquireReplacementAdvisoryLock(holder);

        await contender.query('begin isolation level repeatable read read only');
        await assert.rejects(
          () => acquireReplacementAdvisoryLock(contender),
          (error) => error.code === '55P03'
            && error.preflight?.reason === 'advisory_lock_unavailable',
        );
        await contender.query('rollback');
        await holder.query('rollback');

        await contender.query('begin isolation level repeatable read read only');
        const contenderLock = await acquireReplacementAdvisoryLock(contender);
        const preflight = await preflightReplacement(contender, {
          ...replacementOptions,
          advisoryLock: contenderLock,
          advisoryLockReleasedBy: 'rollback',
        });
        assert.equal(preflight.status, 'ready');
        assert.equal(preflight.advisoryLockAcquired, true);

        await observer.query('begin');
        await assert.rejects(
          () => acquireReplacementAdvisoryLock(observer),
          (error) => error.code === '55P03',
        );
        await observer.query('rollback');
        await contender.query('rollback');

        await observer.query('begin');
        const observerLock = await acquireReplacementAdvisoryLock(observer);
        assert.equal(observerLock.acquired, true);
        await observer.query('rollback');
      } finally {
        await Promise.allSettled([
          holder.query('rollback'),
          contender.query('rollback'),
          observer.query('rollback'),
        ]);
        await Promise.all([holder.end(), contender.end(), observer.end()]);
      }
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

    await t.test('11 current updated_at and a different shared tournament are authorized dynamically', async () => {
      await client.query('begin');
      try {
        await client.query(
          `update public.user_tournament_context_preferences
              set active_tournament_id = $1
            where user_id = $2 and organization_id = $3`,
          [alternateTournamentId, preferenceBefore.user_id, descriptor.organizationId],
        );
        const preflight = await preflightInCurrentTransaction();
        assert.equal(preflight.status, 'ready');
        assert.equal(preflight.preference.active_tournament_id, alternateTournamentId);
        assert.notEqual(preflight.preferenceFingerprint, expectedPreferenceFingerprint);
        assert.notEqual(preflight.preference.updated_at, preferenceBefore.updated_at);
      } finally {
        await client.query('rollback');
      }
      await assertOriginalState('dynamic preference snapshot');
    });

    await t.test('12 wrong owner, organization and incoherent contexts are rejected', async () => {
      const adminId = profiles.find((profile) => profile.role === 'admin').id;
      await client.query('begin');
      try {
        await client.query(
          `update public.user_tournament_context_preferences
              set user_id = $1
            where user_id = $2 and organization_id = $3`,
          [adminId, preferenceBefore.user_id, descriptor.organizationId],
        );
        await assert.rejects(
          () => preflightInCurrentTransaction(),
          /not associated with the QA owner/,
        );
      } finally {
        await client.query('rollback');
      }
      assert.throws(
        () => assertSharedPreferenceDestinations({
          ...preferenceBefore,
          organization_id: sentinelOrganization,
        }, descriptor, manifest),
        /not identical/,
      );
      assert.throws(
        () => assertSharedPreferenceDestinations({
          ...preferenceBefore,
          active_season_id: null,
        }, descriptor, manifest),
        /not identical/,
      );
      await assertOriginalState('semantic preference rejection');
    });

    await t.test('13 a second external preference aborts before writing', async () => {
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
          () => preflightInCurrentTransaction(),
          /exactly one external preference/,
        );
      } finally {
        await client.query('rollback');
      }
      await assertOriginalState('second preference');
    });

    await t.test('14 a new external FK aborts before writing', async () => {
      await client.query('begin');
      try {
        await client.query(
          `create table public.qa_replacement_external_fk (
             id uuid primary key,
             organization_id uuid references public.tournament_organizations(id)
           )`,
        );
        await assert.rejects(
          () => preflightInCurrentTransaction(),
          /catalog count changed/,
        );
      } finally {
        await client.query('rollback');
      }
      await assertOriginalState('new FK');
    });

    await t.test('15 RESTRICT/CASCADE change aborts', async () => {
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
          () => preflightInCurrentTransaction(),
          /constraint contract changed/,
        );
      } finally {
        await client.query('rollback');
      }
      await assertOriginalState('FK action');
    });

    await t.test('16 nullability change aborts', async () => {
      await client.query('begin');
      try {
        await client.query(
          `alter table public.user_tournament_context_preferences
           alter column active_season_id set not null`,
        );
        await assert.rejects(
          () => preflightInCurrentTransaction(),
          /column\/type\/nullability contract changed/,
        );
      } finally {
        await client.query('rollback');
      }
      await assertOriginalState('nullability');
    });

    await t.test('17 UUID mismatch between v2 and v3 aborts before database access', () => {
      const changed = structuredClone(manifest);
      changed.operations.find((operation) => operation.table === 'tournaments').rows[0].id =
        '00000000-0000-4000-8000-000000000099';
      assert.throws(
        () => assertSharedPreferenceDestinations(preferenceBefore, descriptor, changed),
        /not identical/,
      );
    });

    await t.test('18 incomplete v2 aborts before writing', async () => {
      await client.query('begin');
      try {
        await client.query(
          `delete from public.tournament_organization_members
           where organization_id = $1 and role = 'collaborator'`,
          [descriptor.organizationId],
        );
        await assert.rejects(
          () => preflightInCurrentTransaction(),
          /Replacement v2 preflight rejected/,
        );
      } finally {
        await client.query('rollback');
      }
      await assertOriginalState('incomplete v2');
    });

    await t.test('19 simultaneous v2 and v3 markers abort', async () => {
      await client.query('begin');
      try {
        await insertManifestMarkerInCurrentTransaction(client, manifest);
        await assert.rejects(
          () => preflightInCurrentTransaction(),
          /simultaneously|partial/,
        );
      } finally {
        await client.query('rollback');
      }
      await assertOriginalState('both markers');
    });

    await t.test('20 non-40001 is not retried and rolls back', async () => {
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

    await t.test('execute reacquires after a successful manual preflight', async () => {
      const manualPreflight = await readOnlyPreflight();
      assert.equal(manualPreflight.advisoryLockAcquired, true);
      const originalQuery = client.query.bind(client);
      let lockAttempts = 0;
      client.query = (...args) => {
        if (String(args[0]).includes('pg_try_advisory_xact_lock')) lockAttempts += 1;
        return originalQuery(...args);
      };
      try {
        await assert.rejects(
          () => executeReplacement(client, {
            ...replacementOptions,
            afterPreflight: () => {
              const error = new Error('stop after proving execute reacquisition');
              error.code = '23503';
              throw error;
            },
          }),
          (error) => error.code === '23503',
        );
      } finally {
        client.query = originalQuery;
      }
      assert.equal(lockAttempts, 1);
      await assertOriginalState('execute reacquisition rollback');
    });

    await t.test('execute aborts without writing when the lock is taken after preflight', async () => {
      const manualPreflight = await readOnlyPreflight();
      assert.equal(manualPreflight.advisoryLockAcquired, true);
      const holder = new pg.Client({ connectionString: runtime.databaseUrl });
      await holder.connect();
      let reachedPreflight = false;
      try {
        await holder.query('begin');
        await acquireReplacementAdvisoryLock(holder);
        await assert.rejects(
          () => executeReplacement(client, {
            ...replacementOptions,
            afterPreflight: () => {
              reachedPreflight = true;
            },
          }),
          (error) => error.code === '55P03'
            && error.preflight?.reason === 'advisory_lock_unavailable',
        );
      } finally {
        await holder.query('rollback');
        await holder.end();
      }
      assert.equal(reachedPreflight, false);
      await assertOriginalState('execute busy lock');
    });

    await t.test('21 historical preference replaces successfully and is byte-exact', async () => {
      const before = await currentPreference();
      const result = await executeReplacement(client, replacementOptions);
      assert.equal(result.status, 'replaced');
      const after = await currentPreference();
      assert.equal(preferenceFingerprint(after), preferenceFingerprint(before));
      assert.equal(after.updated_at, before.updated_at);
      await resetV3ToV2(before);
      await assertOriginalState('historical successful replacement reset');
    });

    await t.test('22 only updated_at changed before preflight is preserved exactly', async () => {
      await client.query(
        `update public.user_tournament_context_preferences
            set updated_at = updated_at
          where user_id = $1 and organization_id = $2`,
        [preferenceBefore.user_id, descriptor.organizationId],
      );
      const before = await currentPreference();
      assert.notEqual(before.updated_at, preferenceBefore.updated_at);
      const result = await executeReplacement(client, replacementOptions);
      assert.equal(result.status, 'replaced');
      const after = await currentPreference();
      assert.equal(preferenceFingerprint(after), preferenceFingerprint(before));
      assert.equal(after.updated_at, before.updated_at);
      await resetV3ToV2(preferenceBefore);
      await assertOriginalState('updated_at before preflight reset');
    });

    await t.test('23 only updated_at changed after manual preflight is recaptured', async () => {
      const manualPreflight = await readOnlyPreflight();
      await client.query(
        `update public.user_tournament_context_preferences
            set updated_at = updated_at
          where user_id = $1 and organization_id = $2`,
        [preferenceBefore.user_id, descriptor.organizationId],
      );
      const latest = await currentPreference();
      assert.notEqual(latest.updated_at, manualPreflight.preference.updated_at);
      const result = await executeReplacement(client, replacementOptions);
      assert.equal(result.status, 'replaced');
      const after = await currentPreference();
      assert.equal(preferenceFingerprint(after), preferenceFingerprint(latest));
      assert.equal(after.updated_at, latest.updated_at);
      await resetV3ToV2(preferenceBefore);
      await assertOriginalState('updated_at after preflight reset');
    });

    await t.test('24 nullable season and tournament are preserved according to schema', async () => {
      await client.query(
        `update public.user_tournament_context_preferences
            set active_season_id = null, active_tournament_id = null
          where user_id = $1 and organization_id = $2`,
        [preferenceBefore.user_id, descriptor.organizationId],
      );
      const before = await currentPreference();
      const result = await executeReplacement(client, replacementOptions);
      assert.equal(result.status, 'replaced');
      const after = await currentPreference();
      assert.equal(after.active_season_id, null);
      assert.equal(after.active_tournament_id, null);
      assert.equal(preferenceFingerprint(after), preferenceFingerprint(before));
      await resetV3ToV2(preferenceBefore);
      await assertOriginalState('nullable successful replacement reset');
    });

    await t.test('25 FOR UPDATE prevents a concurrent preference change', async () => {
      const competing = new pg.Client({ connectionString: runtime.databaseUrl });
      await competing.connect();
      try {
        await assert.rejects(
          () => executeReplacement(client, {
            ...replacementOptions,
            afterPreflight: async () => {
              await competing.query("set lock_timeout = '250ms'");
              await assert.rejects(
                () => competing.query(
                  `update public.user_tournament_context_preferences
                      set active_tournament_id = $1
                    where user_id = $2 and organization_id = $3`,
                  [alternateTournamentId, preferenceBefore.user_id, descriptor.organizationId],
                ),
                (error) => error.code === '55P03',
              );
              const error = new Error('stop after proving row lock');
              error.code = '23503';
              throw error;
            },
          }),
          (error) => error.code === '23503',
        );
      } finally {
        await competing.end();
      }
      await assertOriginalState('row lock protection');
    });

    await t.test('26 restored fingerprint mismatch rolls back the complete replacement', async () => {
      await assert.rejects(
        () => executeReplacement(client, {
          ...replacementOptions,
          afterPreflight: async () => {
            await client.query(
              `create function pg_temp.mutate_replacement_preference()
               returns trigger language plpgsql as $$
               begin
                 new.updated_at := new.updated_at + interval '1 second';
                 return new;
               end
               $$`,
            );
            await client.query(
              `create trigger qa_mutate_replacement_preference
               before insert on public.user_tournament_context_preferences
               for each row execute function pg_temp.mutate_replacement_preference()`,
            );
          },
        }),
        /not byte-exact/,
      );
      await assertOriginalState('restored fingerprint mismatch');
    });

    await t.test('27 execute captures valid context changes after preflight and retries 40001', async () => {
      await client.query(
        `update public.user_tournament_context_preferences
            set active_season_id = null, active_tournament_id = null
          where user_id = $1 and organization_id = $2`,
        [preferenceBefore.user_id, descriptor.organizationId],
      );
      const manualPreflight = await readOnlyPreflight();
      assert.equal(manualPreflight.preference.active_season_id, null);
      assert.equal(manualPreflight.preference.active_tournament_id, null);
      await client.query(
        `update public.user_tournament_context_preferences
            set active_season_id = $1, active_tournament_id = $2
          where user_id = $3 and organization_id = $4`,
        [seasonId, alternateTournamentId, preferenceBefore.user_id, descriptor.organizationId],
      );
      const latestPreference = await currentPreference();
      const attempts = [];
      const retries = [];
      const originalQuery = client.query.bind(client);
      let lockAttempts = 0;
      client.query = (...args) => {
        if (String(args[0]).includes('pg_try_advisory_xact_lock')) lockAttempts += 1;
        return originalQuery(...args);
      };
      let result;
      try {
        result = await executeReplacement(client, {
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
      } finally {
        client.query = originalQuery;
      }
      assert.equal(result.status, 'replaced');
      assert.equal(result.attempts, 3);
      assert.equal(result.retries, 2);
      assert.equal(lockAttempts, 3);
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
      const after = await currentPreference();
      assert.equal(preferenceFingerprint(after), preferenceFingerprint(latestPreference));
      assert.equal(after.updated_at, latestPreference.updated_at);
      assert.equal(after.active_season_id, seasonId);
      assert.equal(after.active_tournament_id, alternateTournamentId);
    });

    await t.test('28 second execution is an exact zero-write skip', async () => {
      const result = await executeReplacement(client, replacementOptions);
      assert.equal(result.status, 'skip');
      assert.equal(result.preflight.reason, 'v3_already_exact');
      assert.deepEqual(result.deletedV2, undefined);
      assert.deepEqual(result.insertedV3Base, undefined);
      assert.deepEqual(result.insertedV3Marker, undefined);
      const observer = new pg.Client({ connectionString: runtime.databaseUrl });
      await observer.connect();
      try {
        await observer.query('begin');
        const lock = await acquireReplacementAdvisoryLock(observer);
        assert.equal(lock.acquired, true);
        await observer.query('rollback');
      } finally {
        await observer.end();
      }
    });

    await t.test('29 Auth, profiles, preference and sentinels remain intact', async () => {
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
