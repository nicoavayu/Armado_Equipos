import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import pg from 'pg';
import { createClient } from '@supabase/supabase-js';

import {
  cleanupLocalUsers,
  createLocalUsers,
  localExpectedEmails,
} from './prepare-torneos-qa-users.mjs';
import {
  buildCanonicalManifest as buildV4Manifest,
  SEED_KEY as V4_SEED_KEY,
} from './torneos-demo-manifest.mjs';
import { buildLegacyV3Manifest } from './torneos-demo-v3-contract.mjs';
import {
  cleanupManifest,
  materializeManifest,
  preflightDatabase,
  readManifestExpectedState,
} from './torneos-seed-db.mjs';
import { transitionV3ToV4 } from './transition-torneos-demo-v3-to-v4.mjs';

function localRuntime() {
  if (process.env.QA_TORNEOS_LOCAL_TEST !== 'true') return null;
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

function localAuthorization(manifest) {
  return {
    seedKey: manifest.seedKey,
    datasetVersion: manifest.seedVersion,
    markerId: manifest.seedRegistryId,
    manifestHash: manifest.manifestHash,
    identityMapFingerprint: manifest.identityMapFingerprint,
    ownershipFingerprint: manifest.rowOwnershipFingerprint,
    baseRows: 586,
    markerRows: 1,
    totalRows: 587,
    tables: 32,
  };
}

const runtime = localRuntime();

test('V3/V4 local lifecycle, rollback, collision and transition are fail-closed', {
  skip: !runtime,
}, async (t) => {
  const client = new pg.Client({ connectionString: runtime.databaseUrl });
  await client.connect();
  const authAdmin = createClient(runtime.apiUrl, runtime.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  }).auth.admin;
  let identityMap = null;
  let v3Manifest = null;
  let v4Manifest = null;
  try {
    const prepared = await createLocalUsers({
      client,
      authAdmin,
      expectedEmails: localExpectedEmails({}),
    });
    identityMap = prepared.identityMap;
    for (const identity of Object.values(identityMap.toJSON())) {
      await client.query(
        `update auth.users
         set raw_app_meta_data = jsonb_set(raw_app_meta_data, '{qa_seed_key}', '"torneos-demo-v3"')
         where id = $1`,
        [identity.auth_user_id],
      );
    }
    v3Manifest = buildLegacyV3Manifest({ identityMap });
    v4Manifest = buildV4Manifest({ identityMap });
    const v3Authorization = localAuthorization(v3Manifest);
    const v4Authorization = localAuthorization(v4Manifest);
    const transitionOptions = {
      v3Manifest,
      v4Manifest,
      v3Authorization,
      v4Authorization,
    };

    await t.test('V3 installs, validates and skips exactly', async () => {
      const first = await materializeManifest(client, v3Manifest);
      assert.equal(first.status, 'created');
      assert.equal(first.verification.present, 587);
      assert.equal(new Set(v3Manifest.operations.map((operation) => operation.table)).size, 32);
      const second = await materializeManifest(client, v3Manifest);
      assert.equal(second.status, 'skip');
      assert.equal(second.preflight.missing.length, 0);
      assert.equal(second.preflight.mismatched.length, 0);
    });

    await t.test('normal V4 creation detects V3 and performs zero writes', async () => {
      const preflight = await preflightDatabase(client, v4Manifest);
      assert.equal(preflight.status, 'legacy_dataset_detected');
      assert.equal(preflight.reason, 'explicit_transition_required');
      const apply = await materializeManifest(client, v4Manifest);
      assert.equal(apply.status, 'legacy_dataset_detected');
      assert.deepEqual(apply.inserted, []);
      const v3State = await readManifestExpectedState(client, v3Manifest);
      assert.equal(v3State.present, 587);
      assert.equal(v3State.mismatched.length, 0);
    });

    await t.test('injected transition failure rolls back ledger and markers completely', async () => {
      await assert.rejects(
        () => transitionV3ToV4(client, {
          ...transitionOptions,
          failAfterStep: 'ledger_update',
        }),
        /division by zero/,
      );
      const v3Preflight = await preflightDatabase(client, v3Manifest);
      assert.equal(v3Preflight.status, 'skip');
      assert.equal(v3Preflight.present, 587);
      assert.equal(v3Preflight.mismatched.length, 0);
      assert.equal((await preflightDatabase(client, v4Manifest)).status, 'legacy_dataset_detected');
    });

    await t.test('foreign row collision rejects before any transition write', async () => {
      const owner = identityMap.get('owner');
      await client.query(
        `insert into public.user_tournament_context_preferences (
           user_id, organization_id, active_season_id, active_tournament_id
         ) values ($1, $2, $3, $4)`,
        [
          owner.auth_user_id,
          v3Manifest.organizationId,
          v3Manifest.operations.find((operation) => operation.table === 'tournament_seasons').rows[0].id,
          v3Manifest.activeTournamentId,
        ],
      );
      await assert.rejects(
        () => transitionV3ToV4(client, transitionOptions),
        /Frozen V3 validation rejected|foreign organization rows/,
      );
      const ledger = v3Manifest.operations.find(
        (operation) => operation.table === 'tournament_discipline_ledgers',
      ).rows.find((row) => row.direct_reds === 1);
      const actual = await client.query(
        `select automatic_suspensions
         from public.tournament_discipline_ledgers
         where revision_id = $1 and roster_player_id = $2`,
        [ledger.revision_id, ledger.roster_player_id],
      );
      assert.equal(actual.rows[0].automatic_suspensions, 0);
      await client.query(
        'delete from public.user_tournament_context_preferences where user_id = $1',
        [owner.auth_user_id],
      );
    });

    await t.test('atomic V3 to V4 transition succeeds and then skips', async () => {
      const first = await transitionV3ToV4(client, transitionOptions);
      assert.equal(first.status, 'transitioned');
      assert.equal(first.changedRows, 11);
      assert.equal(first.verification.present, 587);
      assert.equal(first.verification.mismatched.length, 0);
      const second = await transitionV3ToV4(client, transitionOptions);
      assert.equal(second.status, 'skip');
      assert.equal(second.reason, 'v4_already_materialized');
    });

    await t.test('V3 cleanup rejects V4 while V4 cleanup is exact and idempotent', async () => {
      const wrongCleanup = await cleanupManifest(client, v3Manifest, {
        apply: true,
        allowLocalTriggerBypass: true,
      });
      assert.equal(wrongCleanup.status, 'reject');
      const cleaned = await cleanupManifest(client, v4Manifest, {
        apply: true,
        allowLocalTriggerBypass: true,
      });
      assert.equal(cleaned.status, 'cleaned');
      assert.equal(cleaned.after.identityPresent, 0);
      assert.equal(cleaned.organizationScopedLeftovers.length, 0);
      const second = await cleanupManifest(client, v4Manifest, {
        apply: true,
        allowLocalTriggerBypass: true,
      });
      assert.equal(second.status, 'already_clean');
    });

    await t.test('V4 cleanup rejects V3 while V3 cleanup remains available and idempotent', async () => {
      assert.equal((await materializeManifest(client, v3Manifest)).status, 'created');
      const wrongCleanup = await cleanupManifest(client, v4Manifest, {
        apply: true,
        allowLocalTriggerBypass: true,
      });
      assert.equal(wrongCleanup.status, 'reject');
      const cleaned = await cleanupManifest(client, v3Manifest, {
        apply: true,
        allowLocalTriggerBypass: true,
      });
      assert.equal(cleaned.status, 'cleaned');
      const second = await cleanupManifest(client, v3Manifest, {
        apply: true,
        allowLocalTriggerBypass: true,
      });
      assert.equal(second.status, 'already_clean');
    });
  } finally {
    await client.query('rollback').catch(() => {});
    if (identityMap) {
      const owner = identityMap.get('owner');
      await client.query(
        'delete from public.user_tournament_context_preferences where user_id = $1',
        [owner.auth_user_id],
      );
    }
    const cleanupResults = [];
    for (const manifest of [v4Manifest, v3Manifest].filter(Boolean)) {
      cleanupResults.push(await cleanupManifest(client, manifest, {
        apply: true,
        allowLocalTriggerBypass: true,
      }));
    }
    assert.ok(
      cleanupResults.some((result) => ['cleaned', 'already_clean'].includes(result.status)),
      `Transition suite cleanup failed: ${JSON.stringify(cleanupResults)}`,
    );
    for (const manifest of [v4Manifest, v3Manifest].filter(Boolean)) {
      const residual = await readManifestExpectedState(client, manifest);
      assert.equal(residual.present, 0, JSON.stringify(residual));
    }
    if (identityMap) {
      for (const identity of Object.values(identityMap.toJSON())) {
        await client.query(
          `update auth.users
           set raw_app_meta_data = jsonb_set(raw_app_meta_data, '{qa_seed_key}', to_jsonb($2::text))
           where id = $1`,
          [identity.auth_user_id, V4_SEED_KEY],
        );
      }
      const cleanupUsers = await cleanupLocalUsers({ client, authAdmin, identityMap });
      assert.ok(['cleaned', 'already_clean'].includes(cleanupUsers.status));
    }
    await client.end();
  }
});
