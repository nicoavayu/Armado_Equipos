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
  buildCanonicalManifest,
  validateCanonicalManifest,
} from './torneos-demo-manifest.mjs';
import { stableUuid } from './torneos-demo-dataset.mjs';
import {
  QAIdentityMap,
  QA_IDENTITY_RELATIONS,
} from './torneos-qa-identity-map.mjs';
import {
  cleanupManifest,
  detectCleanupTriggerBlockers,
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

async function withAuthenticatedIdentity(client, userId, action) {
  await client.query('begin');
  try {
    await client.query('set local role authenticated');
    await client.query(
      `select set_config(
        'request.jwt.claims',
        json_build_object('sub', $1::text, 'role', 'authenticated')::text,
        true
      )`,
      [userId],
    );
    return await action();
  } finally {
    await client.query('rollback');
  }
}

async function managedMatchesFor(client, userId) {
  return withAuthenticatedIdentity(client, userId, async () => {
    const result = await client.query('select public.get_managed_tournament_matches() as matches');
    return result.rows[0].matches;
  });
}

async function assertAdministrativeWriteDenied(client, userId, sql, values) {
  await assert.rejects(
    () => withAuthenticatedIdentity(client, userId, () => client.query(sql, values)),
    (error) => {
      assert.equal(error.code, '42501');
      return true;
    },
  );
}

test('local canonical seed lifecycle validates Auth UUIDs, safety and cleanup blockers', {
  skip: !localRuntime,
}, async () => {
  const client = new pg.Client({ connectionString: localRuntime.databaseUrl });
  await client.connect();
  const authAdmin = createClient(localRuntime.apiUrl, localRuntime.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  }).auth.admin;
  let identityMap = null;
  let manifest = null;
  const transientAuthUserIds = [];
  const sentinelOrganizationId = stableUuid('foreign-sentinel-organization');
  try {
    const prepared = await createLocalUsers({
      client,
      authAdmin,
      expectedEmails: localExpectedEmails({}),
    });
    identityMap = prepared.identityMap;
    const users = Object.fromEntries(Object.entries(identityMap.toJSON()).map(([role, identity]) => [
      role,
      { id: identity.auth_user_id },
    ]));
    manifest = buildCanonicalManifest({ identityMap });
    validateCanonicalManifest(manifest);

    await client.query('begin');
    await client.query(
      `insert into public.tournament_organizations (
        id, name, slug, status, created_by, creation_key
      ) values ($1, 'Dataset QA v2 pendiente', $2, 'active', $3, $4)`,
      [
        manifest.organizationId,
        manifest.organizationSlug,
        users.owner.id,
        stableUuid('seed-key:torneos-demo-v2'),
      ],
    );
    await client.query(
      `insert into public.tournament_audit_log (
        organization_id, actor_user_id, actor_type, action,
        resource_type, resource_id, metadata, created_at
      ) values ($1, $2, 'user', 'qa.seed.applied',
        'qa_seed_execution', $3, $4::jsonb, now())`,
      [
        manifest.organizationId,
        users.owner.id,
        stableUuid('seed-registry:torneos-demo-v2'),
        JSON.stringify({ seed_key: 'torneos-demo-v2' }),
      ],
    );
    const replacementBlocked = await preflightDatabase(client, manifest);
    assert.equal(replacementBlocked.status, 'reject');
    assert.equal(replacementBlocked.reason, 'replacement_authorization_required');
    assert.equal(replacementBlocked.collisions[0].seedKey, 'torneos-demo-v2');
    await client.query('rollback');

    const { data: foreignCreator, error: foreignCreatorError } = await authAdmin.createUser({
      email: 'qa-foreign-collision@localhost.invalid',
      email_confirm: true,
      app_metadata: { qa_seed_key: 'foreign-dataset', qa_role: 'owner' },
    });
    assert.equal(foreignCreatorError, null);
    transientAuthUserIds.push(foreignCreator.user.id);
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
    assert.deepEqual(second.inserted, []);

    const relationCounts = {};
    for (const [role, user] of Object.entries(users)) {
      const result = await client.query(
        `select
          (select count(*)::integer from public.tournament_organization_members
           where organization_id = $1 and user_id = $2) as memberships,
          (select count(*)::integer from public.tournament_team_managers
           where organization_id = $1 and user_id = $2) as managers,
          (select count(*)::integer from public.tournament_roster_players
           where organization_id = $1 and arma2_user_id = $2) as roster_links`,
        [manifest.organizationId, user.id],
      );
      relationCounts[role] = result.rows[0];
    }
    assert.deepEqual(relationCounts, {
      owner: { memberships: 1, managers: 7, roster_links: 0 },
      admin: { memberships: 1, managers: 1, roster_links: 0 },
      collaborator: { memberships: 1, managers: 0, roster_links: 0 },
      delegate: { memberships: 0, managers: 1, roster_links: 1 },
      player: { memberships: 0, managers: 0, roster_links: 1 },
      outsider: { memberships: 0, managers: 0, roster_links: 0 },
    });

    const teamRows = manifest.operations.find(
      (operation) => operation.table === 'tournament_team_entries',
    ).rows;
    const rosterRows = manifest.operations.find(
      (operation) => operation.table === 'tournament_rosters',
    ).rows;
    const participants = manifest.operations.find(
      (operation) => operation.table === 'tournament_competition_participants',
    ).rows;
    const matches = manifest.operations.find(
      (operation) => operation.table === 'tournament_matches',
    ).rows;
    const ownerTeam = teamRows[2];
    const ownerParticipant = participants.find(
      (participant) => participant.team_entry_id === ownerTeam.id,
    );
    const ownerMatch = matches.find((match) => (
      match.home_participant_id === ownerParticipant.id
      || match.away_participant_id === ownerParticipant.id
    ));
    const collaboratorManaged = await managedMatchesFor(client, users.collaborator.id);
    assert.deepEqual(collaboratorManaged, []);
    assert.equal((await managedMatchesFor(client, users.outsider.id)).length, 0);
    assert.equal((await managedMatchesFor(client, users.player.id)).length, 0);
    const ownerManaged = await managedMatchesFor(client, users.owner.id);
    const adminManaged = await managedMatchesFor(client, users.admin.id);
    const delegateManaged = await managedMatchesFor(client, users.delegate.id);
    assert.equal(new Set(ownerManaged.map((match) => match.teamEntryId)).size, 7);
    assert.equal(new Set(adminManaged.map((match) => match.teamEntryId)).size, 1);
    assert.equal(new Set(delegateManaged.map((match) => match.teamEntryId)).size, 1);
    await assertAdministrativeWriteDenied(
      client,
      users.collaborator.id,
      'select public.withdraw_tournament_team_entry($1, $2, $3)',
      [manifest.organizationId, ownerTeam.id, 'QA denied'],
    );
    await assertAdministrativeWriteDenied(
      client,
      users.collaborator.id,
      'select public.lock_tournament_roster($1, $2, $3)',
      [manifest.organizationId, ownerTeam.id, rosterRows[2].id],
    );
    await assertAdministrativeWriteDenied(
      client,
      users.collaborator.id,
      "select public.save_match_squad($1, $2, $3, '[]'::jsonb)",
      [manifest.organizationId, ownerMatch.id, ownerTeam.id],
    );
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

    const outsiderVisible = await withAuthenticatedIdentity(client, users.outsider.id, () => (
      client.query('select count(*)::integer as count from public.tournament_organizations')
    ));
    assert.equal(outsiderVisible.rows[0].count, 0);

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
    transientAuthUserIds.push(replacement.user.id);
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

    await client.query(
      `insert into public.tournament_organizations (
        id, name, slug, status, created_by, creation_key
      ) values ($1, 'Sentinel ajeno', 'qa-foreign-sentinel', 'active', $2, $3)`,
      [
        sentinelOrganizationId,
        foreignCreator.user.id,
        stableUuid('foreign-sentinel-creation-key'),
      ],
    );
    const cleaned = await cleanupManifest(client, manifest, {
      apply: true,
      allowLocalTriggerBypass: true,
    });
    assert.equal(cleaned.status, 'cleaned');
    assert.equal(cleaned.after.identityPresent, 0);
    assert.equal(cleaned.orphanCount, 0);
    assert.equal(cleaned.organizationScopedLeftovers.length, 0);
    assert.ok(cleaned.localTriggerBypass.every((trigger) => trigger.restored));
    const sentinel = await client.query(
      'select count(*)::integer as count from public.tournament_organizations where slug = $1',
      ['qa-foreign-sentinel'],
    );
    assert.equal(sentinel.rows[0].count, 1);
    const restoredBlockers = await detectCleanupTriggerBlockers(client, manifest);
    assert.equal(restoredBlockers.length, cleanup.triggerBlockers.length);
    const afterCleanup = await preflightDatabase(client, manifest);
    assert.equal(afterCleanup.status, 'create');
    assert.equal(afterCleanup.present, 0);

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
    await client.query('rollback').catch(() => {});
    if (manifest) {
      const cleanup = await cleanupManifest(client, manifest, {
        apply: true,
        allowLocalTriggerBypass: true,
      });
      assert.ok(
        ['cleaned', 'already_clean'].includes(cleanup.status),
        `Seed suite cleanup failed: ${JSON.stringify(cleanup)}`,
      );
    }
    await client.query(
      'delete from public.tournament_organizations where id = $1',
      [sentinelOrganizationId],
    );
    for (const userId of transientAuthUserIds.reverse()) {
      const { error } = await authAdmin.deleteUser(userId);
      assert.equal(error, null);
    }
    if (identityMap) {
      const cleanupUsers = await cleanupLocalUsers({ client, authAdmin, identityMap });
      assert.ok(['cleaned', 'already_clean'].includes(cleanupUsers.status));
    }
    await client.end();
  }
});
