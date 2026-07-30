import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import pg from 'pg';
import { createClient } from '@supabase/supabase-js';

import {
  createLocalUsers,
  localExpectedEmails,
} from './prepare-torneos-qa-users.mjs';
import {
  buildCanonicalManifest,
  validateCanonicalManifest,
} from './torneos-demo-manifest.mjs';
import {
  QAIdentityMap,
  QA_IDENTITY_RELATIONS,
} from './torneos-qa-identity-map.mjs';
import {
  cleanupManifest,
  materializeManifest,
  preflightDatabase,
  withSerializableRetry,
} from './torneos-seed-db.mjs';

function resolveLocalRuntime() {
  if (
    process.env.QA_SEED_DATABASE_URL
    && process.env.QA_SUPABASE_URL
    && process.env.QA_LOCAL_SERVICE_ROLE_KEY
  ) {
    return {
      databaseUrl: process.env.QA_SEED_DATABASE_URL,
      apiUrl: process.env.QA_SUPABASE_URL,
      serviceRoleKey: process.env.QA_LOCAL_SERVICE_ROLE_KEY,
    };
  }
  if (process.env.QA_TORNEOS_LOCAL_TEST !== 'true') return null;
  const status = spawnSync('npx', ['supabase', 'status', '-o', 'env'], {
    encoding: 'utf8',
  });
  if (status.status !== 0) {
    throw new Error(status.stderr || status.stdout || 'Supabase local status failed.');
  }
  const value = (name) => status.stdout.match(new RegExp(`^${name}="([^"]+)"$`, 'm'))?.[1];
  const runtime = {
    databaseUrl: value('DB_URL'),
    apiUrl: value('API_URL'),
    serviceRoleKey: value('SERVICE_ROLE_KEY'),
  };
  if (Object.values(runtime).some((entry) => !entry)) {
    throw new Error('Supabase local did not expose DB_URL/API_URL/SERVICE_ROLE_KEY.');
  }
  return runtime;
}

const localRuntime = resolveLocalRuntime();

test('local canonical seed lifecycle validates Auth UUIDs, safety and cleanup blockers', {
  skip: !localRuntime,
}, async () => {
  const client = new pg.Client({ connectionString: localRuntime.databaseUrl });
  await client.connect();
  const authAdmin = createClient(localRuntime.apiUrl, localRuntime.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  }).auth.admin;
  try {
    const prepared = await createLocalUsers({
      client,
      authAdmin,
      expectedEmails: localExpectedEmails({}),
    });
    const identityMap = prepared.identityMap;
    const users = Object.fromEntries(Object.entries(identityMap.toJSON()).map(([role, identity]) => [
      role,
      { id: identity.auth_user_id },
    ]));
    const manifest = buildCanonicalManifest({ identityMap });
    validateCanonicalManifest(manifest);

    const { data: foreignCreator, error: foreignCreatorError } = await authAdmin.createUser({
      email: 'qa-foreign-collision@localhost.invalid',
      email_confirm: true,
      app_metadata: { qa_seed_key: 'foreign-dataset', qa_role: 'owner' },
    });
    assert.equal(foreignCreatorError, null);
    await client.query(
      `insert into public.tournament_organizations (
        id, name, slug, status, created_by, creation_key
      ) values ($1, 'Registro ajeno QA', 'qa-metropolitana', 'active', $2, $3)`,
      [
        manifest.organizationId,
        foreignCreator.user.id,
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      ],
    );
    const collision = await preflightDatabase(client, manifest);
    assert.equal(collision.status, 'reject');
    assert.equal(
      collision.reason,
      'foreign_data_collision',
      JSON.stringify(collision.userIssues),
    );
    assert.ok(collision.collisions.some((item) => item.type === 'deterministic_identity'));
    await client.query(
      'delete from public.tournament_organizations where id = $1',
      [manifest.organizationId],
    );

    await assert.rejects(
      () => materializeManifest(client, manifest, {
        failAfterTable: 'tournament_matches',
      }),
      (error) => {
        assert.match(error.message, /division by zero/);
        assert.equal(error.code, '22012');
        return true;
      },
    );
    const afterFailure = await preflightDatabase(client, manifest);
    assert.equal(afterFailure.status, 'create');
    assert.equal(afterFailure.present, 0);

    const first = await materializeManifest(client, manifest);
    assert.equal(first.status, 'created');
    assert.equal(first.preflight.present, 0);
    assert.equal(first.preflight.expected, 587);
    assert.equal(first.verification.status, 'skip');
    assert.equal(first.verification.present, 587);

    const secondPreflight = await preflightDatabase(client, manifest);
    assert.equal(
      secondPreflight.status,
      'skip',
      JSON.stringify(secondPreflight.mismatched),
    );
    const second = await materializeManifest(client, manifest);
    assert.equal(second.status, 'skip');
    assert.equal(second.preflight.present, second.preflight.expected);

    const redCoherence = await client.query(
      `select count(*)::integer as count
       from public.tournament_player_suspensions suspension
       join public.tournament_match_events event
         on event.id = suspension.source_event_id
        and event.roster_player_id = suspension.roster_player_id
       where suspension.organization_id = $1
         and suspension.source_type = 'direct_red'
         and suspension.status = 'active'`,
      [manifest.organizationId],
    );
    assert.equal(redCoherence.rows[0].count, 1);

    const outsiderMembership = await client.query(
      `select count(*)::integer as count
       from public.tournament_organization_members
       where organization_id = $1 and user_id = $2`,
      [manifest.organizationId, users.outsider.id],
    );
    assert.equal(outsiderMembership.rows[0].count, 0);

    await client.query('begin');
    await client.query('set local role authenticated');
    await client.query(
      `select set_config(
        'request.jwt.claims',
        json_build_object('sub', $1::text, 'role', 'authenticated')::text,
        true
      )`,
      [users.outsider.id],
    );
    const outsiderVisible = await client.query(
      'select count(*)::integer as count from public.tournament_organizations',
    );
    assert.equal(outsiderVisible.rows[0].count, 0);
    await client.query('rollback');

    const ideal = await client.query(
      `select metadata
       from public.tournament_audit_log
       where organization_id = $1
         and action = 'qa.team_of_round.manual_curated'`,
      [manifest.organizationId],
    );
    assert.equal(ideal.rowCount, 1);
    assert.equal(ideal.rows[0].metadata.criterion, 'manual_curated');
    assert.equal(new Set(ideal.rows[0].metadata.playerIds).size, 5);

    const { data: replacement, error: replacementError } = await authAdmin.createUser({
      email: 'qa-owner-replacement@localhost.invalid',
      email_confirm: true,
      app_metadata: { qa_seed_key: manifest.seedKey, qa_role: 'owner' },
    });
    assert.equal(replacementError, null);
    const changedRaw = structuredClone(identityMap.toJSON());
    changedRaw.owner = {
      auth_user_id: replacement.user.id,
      expected_email: replacement.user.email,
      logical_role: 'owner',
      projected_relations: QA_IDENTITY_RELATIONS.owner,
    };
    const changedManifest = buildCanonicalManifest({
      identityMap: new QAIdentityMap(changedRaw),
    });
    const changedPreflight = await preflightDatabase(client, changedManifest);
    assert.equal(changedPreflight.status, 'reject');
    assert.equal(changedPreflight.reason, 'identity_map_changed');

    const cleanup = await cleanupManifest(client, manifest, { apply: true });
    assert.equal(cleanup.status, 'reject');
    assert.equal(cleanup.reason, 'active_append_only_cleanup_guards');
    assert.ok(cleanup.triggerBlockers.some(
      (item) => item.trigger === 'tournament_audit_append_only',
    ));

    const retryEvents = [];
    let serializationAttempts = 0;
    const retried = await withSerializableRetry(async () => {
      serializationAttempts += 1;
      if (serializationAttempts < 3) {
        const error = new Error('synthetic serialization failure');
        error.code = '40001';
        throw error;
      }
      return 'ok';
    }, {
      backoffMs: [0, 0],
      onRetry: (event) => retryEvents.push(event),
    });
    assert.equal(retried, 'ok');
    assert.equal(serializationAttempts, 3);
    assert.equal(retryEvents.length, 2);
    await assert.rejects(
      () => withSerializableRetry(async () => {
        const error = new Error('constraint');
        error.code = '23503';
        throw error;
      }),
      /constraint/,
    );
  } finally {
    await client.end();
  }
});
