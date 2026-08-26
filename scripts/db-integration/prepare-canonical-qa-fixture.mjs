#!/usr/bin/env node

// Materializa el dataset QA canónico de Torneos sobre el Supabase LOCAL.
//
// Este bootstrap no define datos propios: reutiliza las seis identidades y el
// manifest torneos-demo-v4 oficiales. Es necesario después de la baseline de
// integración, porque esa suite hace `db reset --local --no-seed` y los
// contratos históricos posteriores ejercitan UUIDs del dataset QA.
//
// Si recibe un comando después de `--`, lo ejecuta con las URLs locales sólo en
// el entorno del proceso hijo. Esto permite pasar SUPABASE_DB_URL a los tests
// que la exigen sin persistir credenciales en el repo ni en archivos.

import { spawnSync } from 'node:child_process';
import process from 'node:process';

import { createClient } from '@supabase/supabase-js';

import { createLocalUsers, localExpectedEmails } from '../qa/prepare-torneos-qa-users.mjs';
import {
  buildCanonicalManifest,
  validateCanonicalManifest,
} from '../qa/torneos-demo-manifest.mjs';
import { materializeManifest, withDatabase } from '../qa/torneos-seed-db.mjs';

function readLocalEnv() {
  const result = spawnSync('npx', ['supabase', 'status', '-o', 'env'], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'supabase status falló');
  }
  const localEnv = Object.fromEntries(
    result.stdout
      .split('\n')
      .map((line) => line.match(/^([A-Z0-9_]+)="(.*)"$/))
      .filter(Boolean)
      .map((match) => [match[1], match[2]]),
  );
  for (const name of ['API_URL', 'DB_URL', 'SERVICE_ROLE_KEY']) {
    if (!localEnv[name]) throw new Error(`Supabase local no expuso ${name}.`);
  }
  for (const raw of [localEnv.API_URL, localEnv.DB_URL]) {
    const host = new URL(raw).hostname;
    if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
      throw new Error(`El bootstrap QA sólo admite loopback; recibido ${host}.`);
    }
  }
  return localEnv;
}

function authenticatorUrl(databaseUrl) {
  const parsed = new URL(databaseUrl);
  parsed.username = 'authenticator';
  return parsed.toString();
}

async function prepare(localEnv) {
  const authAdmin = createClient(localEnv.API_URL, localEnv.SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  }).auth.admin;

  return withDatabase(localEnv.DB_URL, async (client) => {
    const users = await createLocalUsers({
      client,
      authAdmin,
      expectedEmails: localExpectedEmails(),
    });
    const manifest = buildCanonicalManifest({ identityMap: users.identityMap });
    const validation = validateCanonicalManifest(manifest);
    const seed = await materializeManifest(client, manifest);
    return {
      users: {
        created: users.createdCount,
        reused: users.reusedSeedOwnedCount,
      },
      seed: {
        key: manifest.seedKey,
        status: seed.status,
        expectedRows: validation.counts.totalRows,
        expectedTables: validation.counts.tables,
      },
    };
  });
}

async function main() {
  const separator = process.argv.indexOf('--');
  const command = separator === -1 ? [] : process.argv.slice(separator + 1);
  if (separator === -1 && process.argv.length > 2) {
    throw new Error('Use `-- <comando>` para ejecutar una suite después del bootstrap.');
  }
  if (separator !== -1 && command.length === 0) {
    throw new Error('Falta el comando después de `--`.');
  }

  const localEnv = readLocalEnv();
  const result = await prepare(localEnv);
  console.log(`Fixture QA canónico: ${result.seed.key} ${result.seed.status}; ${result.seed.expectedRows} filas/${result.seed.expectedTables} tablas; usuarios ${result.users.created} creados, ${result.users.reused} reutilizados.`);

  if (command.length === 0) return;
  const child = spawnSync(command[0], command.slice(1), {
    stdio: 'inherit',
    env: {
      ...process.env,
      SUPABASE_DB_URL: localEnv.DB_URL,
      TORNEOS_LOCAL_DATABASE_URL: localEnv.DB_URL,
      TORNEOS_LOCAL_AUTHENTICATOR_URL: authenticatorUrl(localEnv.DB_URL),
      TORNEOS_LOCAL_SUPABASE_URL: localEnv.API_URL,
      ...(localEnv.JWT_SECRET
        ? { TORNEOS_LOCAL_JWT_SECRET: localEnv.JWT_SECRET }
        : {}),
    },
  });
  if (child.error) throw child.error;
  process.exitCode = child.status ?? 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
