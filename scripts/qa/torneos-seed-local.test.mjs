import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import pg from 'pg';

import { createLocalUsers } from './prepare-torneos-qa-users.mjs';
import {
  buildCanonicalManifest,
  qaUsers,
  validateCanonicalManifest,
} from './torneos-demo-manifest.mjs';
import {
  cleanupManifest,
  materializeManifest,
  preflightDatabase,
} from './torneos-seed-db.mjs';

function resolveDatabaseUrl() {
  if (process.env.QA_SEED_DATABASE_URL) return process.env.QA_SEED_DATABASE_URL;
  if (process.env.QA_TORNEOS_LOCAL_TEST !== 'true') return null;
  const status = spawnSync('npx', ['supabase', 'status', '-o', 'env'], {
    encoding: 'utf8',
  });
  if (status.status !== 0) {
    throw new Error(status.stderr || status.stdout || 'Supabase local status failed.');
  }
  const match = status.stdout.match(/^DB_URL="([^"]+)"$/m);
  if (!match) throw new Error('Supabase local did not expose DB_URL.');
  return match[1];
}

const databaseUrl = resolveDatabaseUrl();

test('local canonical seed lifecycle is atomic, idempotent, collision-safe and reversible', {
  skip: !databaseUrl,
}, async () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  const users = qaUsers({ env: process.env, localDefaults: true });
  const manifest = buildCanonicalManifest({ users });
  validateCanonicalManifest(manifest);
  try {
    await createLocalUsers(client, users);

    const first = await materializeManifest(client, manifest);
    assert.equal(first.status, 'created');
    assert.equal(first.preflight.present, 0);
    assert.equal(first.preflight.expected, 587);

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

    const cleanup = await cleanupManifest(client, manifest, { apply: true });
    assert.equal(cleanup.status, 'cleaned');
    assert.equal(cleanup.after.present, 0);
    assert.equal(cleanup.orphanCount, 0);

    const secondCleanup = await cleanupManifest(client, manifest, { apply: true });
    assert.equal(secondCleanup.status, 'already_clean');

    await client.query(
      `insert into public.tournament_organizations (
        id, name, slug, status, created_by, creation_key
      ) values ($1, 'Registro ajeno QA', 'qa-metropolitana', 'active', $2, $3)`,
      [
        manifest.organizationId,
        users.owner.id,
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      ],
    );
    const collision = await preflightDatabase(client, manifest);
    assert.equal(collision.status, 'reject');
    assert.equal(collision.reason, 'foreign_data_collision');
    assert.ok(collision.collisions.some((item) => item.type === 'deterministic_identity'));
    await client.query(
      'delete from public.tournament_organizations where id = $1',
      [manifest.organizationId],
    );

    await assert.rejects(
      () => materializeManifest(client, manifest, {
        failAfterTable: 'tournament_matches',
      }),
      /deliberate failure/,
    );
    const afterFailure = await preflightDatabase(client, manifest);
    assert.equal(afterFailure.status, 'create');
    assert.equal(afterFailure.present, 0);
  } finally {
    await client.end();
  }
});
