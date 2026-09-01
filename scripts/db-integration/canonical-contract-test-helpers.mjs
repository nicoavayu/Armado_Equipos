import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const connectCanonicalLocal = async () => {
  const status = spawnSync('npx', ['supabase', 'status', '-o', 'env'], {
    cwd: root,
    encoding: 'utf8',
  });
  if (status.status !== 0) {
    throw new Error(status.stderr || status.stdout || 'Supabase local is not running.');
  }
  const localEnv = Object.fromEntries(
    status.stdout
      .split('\n')
      .map((line) => line.match(/^([A-Z0-9_]+)="(.*)"$/))
      .filter(Boolean)
      .map((match) => [match[1], match[2]]),
  );
  if (!localEnv.DB_URL) throw new Error('Supabase local did not expose DB_URL.');

  const client = new pg.Client({ connectionString: localEnv.DB_URL });
  await client.connect();
  return client;
};

export const createChecks = (title) => {
  let checks = 0;
  let failures = 0;

  console.log(`\n${title}\n`);
  return {
    check(condition, label, detail = '') {
      checks += 1;
      if (condition) {
        console.log(`  ✔ ${label}`);
      } else {
        failures += 1;
        console.error(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`);
      }
    },
    finish() {
      console.log(`\n${checks} checks, ${failures} failures.`);
      if (failures > 0) process.exitCode = 1;
    },
  };
};

export const insertAuthUser = async (client, id, email) => {
  await client.query(
    `insert into auth.users (
       id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
       created_at, updated_at
     ) values (
       $1, 'authenticated', 'authenticated', $2,
       '{}'::jsonb, '{}'::jsonb, now(), now()
     )`,
    [id, email],
  );
};

export const setRequestRole = async (client, role, userId = '') => {
  await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
  await client.query(`set local role ${role}`);
};

export const resetRequestRole = async (client) => {
  await client.query('reset role');
};

export const expectDatabaseError = async (client, sql, params = []) => {
  await client.query('savepoint expected_database_error');
  try {
    await client.query(sql, params);
    await client.query('rollback to savepoint expected_database_error');
    return null;
  } catch (error) {
    await client.query('rollback to savepoint expected_database_error');
    return error;
  }
};
