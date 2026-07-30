#!/usr/bin/env node

import process from 'node:process';
import { fileURLToPath } from 'node:url';

import productionGuard from './production-guard.js';
import {
  QA_USER_ROLES,
  SEED_KEY,
  qaUsers,
} from './torneos-demo-manifest.mjs';
import { withDatabase } from './torneos-seed-db.mjs';

const {
  assertLocalDatabaseTarget,
  assertRemoteApplyDisabled,
  assertRemotePlanTarget,
  assertSafeQaEnvironment,
} = productionGuard;

function userPlan(users) {
  return {
    roles: Object.values(users).map((user) => ({
      role: user.role,
      id: user.id,
      email: user.email,
      idVariable: user.idVariable,
      emailVariable: user.emailVariable,
      passwordInGit: false,
      profile: 'public.usuarios (created by canonical Auth sync trigger)',
    })),
    remoteAdministrativeOperation: {
      status: 'blocked-pending-specific-authorization',
      required: [
        'resolve email in Auth Admin',
        'invite missing identity without a repository password',
        'record returned auth.users.id in secure environment variables',
        'rerun seed preflight',
      ],
    },
  };
}

export async function inspectUsers(client, users) {
  const result = [];
  for (const user of Object.values(users)) {
    const byId = await client.query(
      'select id, email, raw_app_meta_data from auth.users where id = $1',
      [user.id],
    );
    const byEmail = await client.query(
      'select id, email, raw_app_meta_data from auth.users where lower(email) = $1',
      [user.email],
    );
    const profile = await client.query(
      'select id, email from public.usuarios where id = $1',
      [user.id],
    );
    if (
      (byId.rowCount && String(byId.rows[0].email).toLowerCase() !== user.email)
      || (byEmail.rowCount && byEmail.rows[0].id !== user.id)
    ) {
      result.push({ ...user, status: 'reject', reason: 'id_or_email_collision' });
    } else if (
      byId.rowCount === 1
      && profile.rowCount === 1
      && String(profile.rows[0].email).toLowerCase() === user.email
    ) {
      result.push({ ...user, status: 'skip', reason: 'resolved' });
    } else if (byId.rowCount === 1) {
      result.push({ ...user, status: 'reject', reason: 'profile_missing_or_mismatched' });
    } else {
      result.push({ ...user, status: 'create', reason: 'missing_local_identity' });
    }
  }
  return result;
}

export async function createLocalUsers(client, users) {
  await client.query('begin isolation level serializable');
  try {
    await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `${SEED_KEY}:auth-users`,
    ]);
    const preflight = await inspectUsers(client, users);
    if (preflight.some((item) => item.status === 'reject')) {
      throw new Error(`QA user preflight rejected: ${JSON.stringify(preflight)}`);
    }
    for (const user of preflight.filter((item) => item.status === 'create')) {
      await client.query(
        `insert into auth.users (
          instance_id, id, aud, role, email, encrypted_password,
          email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
          created_at, updated_at, is_sso_user, is_anonymous
        ) values (
          '00000000-0000-0000-0000-000000000000', $1,
          'authenticated', 'authenticated', $2, null,
          now(), $3::jsonb, $4::jsonb, now(), now(), false, false
        )`,
        [
          user.id,
          user.email,
          JSON.stringify({
            provider: 'email',
            providers: ['email'],
            qa_seed_key: SEED_KEY,
            qa_role: user.role,
          }),
          JSON.stringify({ full_name: user.displayName, qa_role: user.role }),
        ],
      );
    }
    const postflight = await inspectUsers(client, users);
    if (postflight.some((item) => item.status !== 'skip')) {
      throw new Error(`QA user postflight failed: ${JSON.stringify(postflight)}`);
    }
    await client.query('commit');
    return { status: 'ready', preflight, postflight };
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

export async function cleanupLocalUsers(client, users) {
  await client.query('begin isolation level serializable');
  try {
    await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `${SEED_KEY}:auth-users`,
    ]);
    const present = [];
    for (const user of Object.values(users)) {
      const auth = await client.query(
        `select id, email, raw_app_meta_data
         from auth.users where id = $1`,
        [user.id],
      );
      if (!auth.rowCount) continue;
      if (
        String(auth.rows[0].email).toLowerCase() !== user.email
        || auth.rows[0].raw_app_meta_data?.qa_seed_key !== SEED_KEY
        || auth.rows[0].raw_app_meta_data?.qa_role !== user.role
      ) {
        throw new Error(`Ownership proof failed for QA user ${user.role}.`);
      }
      const references = await client.query(
        `select (
          (select count(*) from public.tournament_organization_members where user_id = $1)
          + (select count(*) from public.tournament_team_managers where user_id = $1)
          + (select count(*) from public.tournament_roster_players where arma2_user_id = $1)
        )::integer as count`,
        [user.id],
      );
      if (references.rows[0].count !== 0) {
        throw new Error(`QA user ${user.role} is still referenced by the tournament dataset.`);
      }
      present.push(user);
    }
    for (const user of present) {
      await client.query('delete from public.usuarios where id = $1', [user.id]);
      await client.query('delete from auth.users where id = $1', [user.id]);
    }
    await client.query('commit');
    return { status: present.length ? 'cleaned' : 'already_clean', deleted: present.length };
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has('--apply') || args.has('--apply-remote')) assertRemoteApplyDisabled();
  if (args.has('--remote-plan')) {
    const target = assertRemotePlanTarget(process.env);
    const users = qaUsers({ env: process.env, localDefaults: false });
    console.log(JSON.stringify({
      mode: 'remote-user-plan-only',
      connects: false,
      target,
      ...userPlan(users),
    }, null, 2));
    return;
  }
  if (args.has('--apply-local') || args.has('--cleanup-local')) {
    const target = assertLocalDatabaseTarget(process.env);
    const users = qaUsers({ env: process.env, localDefaults: true });
    if (args.has('--apply-local')) {
      if (process.env.QA_ALLOW_LOCAL_USER_PREP !== 'true') {
        throw new Error('QA_ALLOW_LOCAL_USER_PREP=true is required.');
      }
      const result = await withDatabase(
        target.databaseUrl,
        (client) => createLocalUsers(client, users),
      );
      console.log(JSON.stringify({ mode: 'local-user-apply', result }, null, 2));
      return;
    }
    if (
      process.env.QA_ALLOW_LOCAL_USER_CLEANUP !== 'true'
      || process.env.QA_CONFIRM_USER_SEED !== SEED_KEY
      || process.env.QA_CONFIRM_USER_COUNT !== String(QA_USER_ROLES.length)
    ) {
      throw new Error(
        `User cleanup requires QA_ALLOW_LOCAL_USER_CLEANUP=true, `
        + `QA_CONFIRM_USER_SEED=${SEED_KEY}, and QA_CONFIRM_USER_COUNT=${QA_USER_ROLES.length}.`,
      );
    }
    const result = await withDatabase(
      target.databaseUrl,
      (client) => cleanupLocalUsers(client, users),
    );
    console.log(JSON.stringify({ mode: 'local-user-cleanup', result }, null, 2));
    return;
  }
  if (args.size > 0 && !args.has('--dry-run')) {
    throw new Error('Use --dry-run, --remote-plan, --apply-local, or --cleanup-local.');
  }
  assertSafeQaEnvironment(process.env);
  const users = qaUsers({ env: process.env, localDefaults: true });
  console.log(JSON.stringify({
    mode: 'offline-user-plan',
    connects: false,
    writes: false,
    ...userPlan(users),
  }, null, 2));
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((error) => {
    console.error(JSON.stringify({ error: error.message }, null, 2));
    process.exitCode = 1;
  });
}
