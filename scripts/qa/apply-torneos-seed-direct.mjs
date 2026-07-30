#!/usr/bin/env node

import process from 'node:process';
import { createInterface } from 'node:readline/promises';

import pg from 'pg';

import {
  buildCanonicalManifest,
  validateCanonicalManifest,
} from './torneos-demo-manifest.mjs';
import { loadQAIdentityMap } from './torneos-qa-identity-map.mjs';
import { materializeManifest } from './torneos-seed-db.mjs';

const AUTHORIZED = Object.freeze({
  projectRef: 'hhyvmhgpapyuzjgxfnqv',
  seedKey: 'torneos-demo-v2',
  manifestHash: '48b413d1c6673ad96d3ce5bb30fecc89bd2c432b465a00447eb6f2cb51befb2f',
  identityMapFingerprint: '77d95cb8caee567de1e8275b81c1e8c850eb59dcf6025504cab93c634ff3657c',
  ownershipFingerprint: '9375b59f2f908aec4b0d5b32b79514491e2ebbd648c4d9e7c245064c772ebe8d',
  rows: 587,
  tables: 32,
});

function readHiddenLine(prompt) {
  if (!process.stdin.isTTY || !process.stderr.isTTY || !process.stdin.setRawMode) {
    throw new Error('A local interactive TTY is required for hidden credential input.');
  }
  process.stderr.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    let value = '';
    const restore = () => {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stderr.write('\n');
    };
    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === '\u0003') {
          restore();
          reject(new Error('Credential input cancelled.'));
          return;
        }
        if (character === '\r' || character === '\n') {
          restore();
          resolve(value);
          return;
        }
        if (character === '\u007f' || character === '\b') {
          value = value.slice(0, -1);
        } else {
          value += character;
        }
      }
    };
    process.stdin.on('data', onData);
  });
}

function validatedConnection(rawConnectionString) {
  let url;
  try {
    url = new URL(rawConnectionString);
  } catch {
    throw new Error('The hidden value is not a valid PostgreSQL connection string.');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('The connection string must use postgres:// or postgresql://.');
  }
  if (!url.password) {
    throw new Error('The connection string must include the database password.');
  }
  if (url.pathname !== '/postgres') {
    throw new Error('The database name must be postgres.');
  }

  const username = decodeURIComponent(url.username);
  const directHost = `db.${AUTHORIZED.projectRef}.supabase.co`;
  const isDirect = url.hostname === directHost
    && (url.port || '5432') === '5432'
    && username === 'postgres';
  const isSessionPooler = /^[a-z0-9-]+\.pooler\.supabase\.com$/i.test(url.hostname)
    && (url.port || '5432') === '5432'
    && username === `postgres.${AUTHORIZED.projectRef}`;
  if (!isDirect && !isSessionPooler) {
    throw new Error(
      'Only the authorized direct endpoint or its port-5432 session pooler is accepted.',
    );
  }
  if (url.port === '6543') {
    throw new Error('Transaction-pooler port 6543 is forbidden for this session workflow.');
  }

  url.searchParams.delete('sslmode');
  return {
    connectionString: url.toString(),
    connectionMode: isDirect ? 'direct' : 'session-pooler',
  };
}

function assertAuthorizedManifest(manifest, validation) {
  const matches = manifest.seedKey === AUTHORIZED.seedKey
    && manifest.manifestHash === AUTHORIZED.manifestHash
    && manifest.identityMapFingerprint === AUTHORIZED.identityMapFingerprint
    && manifest.rowOwnershipFingerprint === AUTHORIZED.ownershipFingerprint
    && manifest.expectedRowCount === AUTHORIZED.rows
    && manifest.expectedTableCount === AUTHORIZED.tables
    && validation.rows === AUTHORIZED.rows
    && validation.tables === AUTHORIZED.tables;
  if (!matches) throw new Error('Resolved manifest does not match the remote authorization.');
}

function safeError(error) {
  return {
    name: error?.name || 'Error',
    message: error?.message || 'Unknown error',
    sqlstate: error?.code || null,
    table: error?.table || null,
    constraint: error?.constraint || null,
    preflight: error?.preflight ? {
      status: error.preflight.status,
      reason: error.preflight.reason,
      expected: error.preflight.expected,
      present: error.preflight.present,
    } : null,
  };
}

async function main() {
  if (process.argv.length !== 3 || process.argv[2] !== '--execute') {
    throw new Error('Prepared only. Pass --execute after a separate remote-write authorization.');
  }

  const identityMap = await loadQAIdentityMap({
    env: {
      ...process.env,
      QA_IDENTITY_MAP_FILE: process.env.QA_IDENTITY_MAP_FILE
        || 'torneos-demo-v2-identity-map.local',
    },
  });
  const manifest = buildCanonicalManifest({ identityMap });
  const validation = validateCanonicalManifest(manifest);
  assertAuthorizedManifest(manifest, validation);

  const rawConnectionString = await readHiddenLine(
    'Pegá la connection string de Staging (entrada oculta): ',
  );
  const target = validatedConnection(rawConnectionString);

  const confirmation = createInterface({ input: process.stdin, output: process.stderr });
  const answer = await confirmation.question(
    `Escribí "APLICAR ${AUTHORIZED.seedKey}" para continuar: `,
  );
  confirmation.close();
  if (answer !== `APLICAR ${AUTHORIZED.seedKey}`) {
    throw new Error('Execution confirmation did not match.');
  }

  const client = new pg.Client({
    connectionString: target.connectionString,
    ssl: { rejectUnauthorized: true },
    application_name: 'arma2_torneos_qa_seed_direct',
    connectionTimeoutMillis: 15_000,
    keepAlive: true,
  });
  await client.connect();
  try {
    const server = await client.query(
      `select current_database() as database_name,
              current_setting('transaction_isolation') as initial_isolation,
              exists (
                select 1 from pg_stat_ssl where pid = pg_backend_pid() and ssl
              ) as ssl`,
    );
    if (server.rows[0]?.database_name !== 'postgres' || !server.rows[0]?.ssl) {
      throw new Error('Connected database or SSL state is not acceptable.');
    }

    const retries = [];
    const result = await materializeManifest(client, manifest, {
      retry: {
        maxAttempts: 3,
        backoffMs: [25, 75],
        onRetry: (event) => retries.push(event),
      },
    });
    console.log(JSON.stringify({
      projectRef: AUTHORIZED.projectRef,
      connectionMode: target.connectionMode,
      seedKey: manifest.seedKey,
      manifestHash: manifest.manifestHash,
      status: result.status,
      attempts: result.attempts,
      retries,
      preflight: {
        status: result.preflight.status,
        reason: result.preflight.reason,
        expected: result.preflight.expected,
        present: result.preflight.present,
      },
      verification: result.verification ? {
        status: result.verification.status,
        reason: result.verification.reason,
        expected: result.verification.expected,
        present: result.verification.present,
      } : null,
      inserted: result.inserted,
    }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ error: safeError(error) }, null, 2));
  process.exitCode = 1;
});
