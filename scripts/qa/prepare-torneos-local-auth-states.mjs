#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import pg from 'pg';

import productionGuard from './production-guard.js';

const { assertLocalDatabaseTarget, assertSafeQaValue } = productionGuard;
const ROLES = ['owner', 'admin', 'delegate', 'player', 'collaborator', 'outsider'];

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function signLocalJwt(payload, secret) {
  const unsigned = `${base64UrlJson({ alg: 'HS256', typ: 'JWT' })}.${base64UrlJson(payload)}`;
  const signature = crypto.createHmac('sha256', secret).update(unsigned).digest('base64url');
  return `${unsigned}.${signature}`;
}

async function verifyLocalUser(supabaseUrl, anonKey, accessToken) {
  let lastStatus = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: anonKey, authorization: `Bearer ${accessToken}` },
    });
    lastStatus = response.status;
    if (response.ok) return response.json();
    if (response.status < 500 || attempt === 3) break;
    await new Promise((resolve) => setTimeout(resolve, attempt * 250));
  }
  throw new Error(`Generated local token was rejected (${lastStatus}).`);
}

async function main() {
  if (process.argv.length !== 3 || process.argv[2] !== '--write-local') {
    console.log(JSON.stringify({
      status: 'plan', writes: false, authMutations: false,
      roles: ROLES,
      usage: 'QA_ALLOW_LOCAL_AUTH_STATES=true node scripts/qa/prepare-torneos-local-auth-states.mjs --write-local',
    }, null, 2));
    return;
  }
  if (process.env.QA_ALLOW_LOCAL_AUTH_STATES !== 'true') {
    throw new Error('QA_ALLOW_LOCAL_AUTH_STATES=true is required.');
  }
  const target = assertLocalDatabaseTarget(process.env);
  const supabaseUrl = String(process.env.QA_SUPABASE_URL || '').replace(/\/+$/, '');
  const anonKey = String(process.env.QA_SUPABASE_ANON_KEY || '');
  const jwtSecret = String(process.env.QA_LOCAL_JWT_SECRET || '');
  const appOrigin = String(process.env.QA_BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
  const outputDirectory = path.resolve(
    process.env.QA_AUTH_STATE_DIR || '.secrets/torneos-qa-scenario-auth',
  );
  assertSafeQaValue(supabaseUrl, 'local auth-state Supabase URL');
  assertSafeQaValue(appOrigin, 'local auth-state app origin');
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(supabaseUrl)) {
    throw new Error('QA_SUPABASE_URL must be loopback HTTP.');
  }
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(appOrigin)) {
    throw new Error('QA_BASE_URL must be a loopback origin.');
  }
  if (!anonKey || jwtSecret.length < 32) throw new Error('Local anon key and JWT secret are required.');

  const client = new pg.Client({ connectionString: target.databaseUrl });
  await client.connect();
  const { rows } = await client.query(
    `select id,email,email_confirmed_at,created_at,updated_at,
            raw_app_meta_data,raw_user_meta_data
     from auth.users
     where raw_app_meta_data->>'qa_role'=any($1)
       and raw_app_meta_data->>'qa_seed_key' in
         ('torneos-demo-v2','torneos-demo-v3','torneos-demo-v4')
     order by raw_app_meta_data->>'qa_role'`,
    [ROLES],
  );
  await client.end();
  const byRole = new Map(rows.map((row) => [row.raw_app_meta_data.qa_role, row]));
  const missing = ROLES.filter((role) => !byRole.has(role));
  if (missing.length > 0 || rows.length !== ROLES.length) {
    throw new Error(`Existing QA identities are incomplete: ${missing.join(', ') || 'duplicates'}.`);
  }

  fs.mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });
  const now = Math.floor(Date.now() / 1000);
  for (const role of ROLES) {
    const row = byRole.get(role);
    const payload = {
      aud: 'authenticated', exp: now + 21_600, iat: now,
      iss: 'supabase-demo', sub: row.id, email: row.email,
      role: 'authenticated', aal: 'aal1',
      app_metadata: row.raw_app_meta_data,
      user_metadata: row.raw_user_meta_data || {},
    };
    const accessToken = signLocalJwt(payload, jwtSecret);
    let user;
    try {
      user = await verifyLocalUser(supabaseUrl, anonKey, accessToken);
    } catch (error) {
      throw new Error(`Generated local ${role} token validation failed: ${error.message}`);
    }
    const session = {
      access_token: accessToken,
      token_type: 'bearer',
      expires_in: 21_600,
      expires_at: now + 21_600,
      refresh_token: `qa-local-non-refreshing-${role}`,
      user,
    };
    const storageState = {
      cookies: [],
      origins: [{
        origin: appOrigin,
        localStorage: [{ name: 'sb-127-auth-token', value: JSON.stringify(session) }],
      }],
    };
    const filePath = path.join(outputDirectory, `${role}.json`);
    fs.writeFileSync(filePath, `${JSON.stringify(storageState)}\n`, { mode: 0o600 });
    fs.chmodSync(filePath, 0o600);
  }
  console.log(JSON.stringify({
    status: 'created', authMutations: false, roles: ROLES,
    outputDirectory, files: ROLES.length,
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ error: error.message }, null, 2));
  process.exitCode = 1;
});
