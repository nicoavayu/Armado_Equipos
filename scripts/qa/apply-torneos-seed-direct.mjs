#!/usr/bin/env node

import { X509Certificate } from 'node:crypto';
import {
  lstat,
  readFile,
  realpath,
} from 'node:fs/promises';
import {
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline/promises';
import { spawnSync } from 'node:child_process';
import { checkServerIdentity } from 'node:tls';
import { fileURLToPath } from 'node:url';

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
  baseRows: 586,
  markerRows: 1,
  totalRows: 587,
  tables: 32,
});

const STAGING_TARGET = Object.freeze({
  hostname: 'aws-0-us-east-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  username: `postgres.${AUTHORIZED.projectRef}`,
});

const SESSION_POOLER_HOST = /^[a-z0-9-]+\.pooler\.supabase\.com$/i;
const ACCEPTED_TLS_VERSIONS = new Set(['TLSv1.2', 'TLSv1.3']);
const CHECK_NAMES = Object.freeze([
  'project_ref',
  'database',
  'username',
  'session_pooler',
  'ssl_active',
  'tls_version',
  'certificate_validation',
  'port',
]);

export function readPasswordFromMacOSDialog({
  spawn = spawnSync,
  platform = process.platform,
} = {}) {
  if (platform !== 'darwin') {
    throw new Error('The secure database password dialog requires macOS.');
  }
  const result = spawn('/usr/bin/osascript', [
    '-e',
    'tell application "System Events" to activate',
    '-e',
    'set response to display dialog "Ingresá únicamente la contraseña nueva de la base de Staging." default answer "" with hidden answer buttons {"Cancelar", "Continuar"} default button "Continuar" cancel button "Cancelar" with title "Supabase Staging"',
    '-e',
    'return text returned of response',
  ], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw new Error('Secure database password input was cancelled or unavailable.');
  }
  const password = String(result.stdout || '').replace(/\r?\n$/, '');
  if (password.length === 0) {
    throw new Error('The database password cannot be empty.');
  }
  return password;
}

function isPathWithin(parent, candidate) {
  const pathFromParent = relative(parent, candidate);
  return pathFromParent === ''
    || (!pathFromParent.startsWith(`..${sep}`) && !isAbsolute(pathFromParent));
}

function gitOutput(args, cwd) {
  return spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

function certificateBlocks(pem) {
  const pattern = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g;
  const blocks = [...pem.matchAll(pattern)].map((match) => match[0]);
  const remainder = pem.replace(pattern, '').trim();
  if (blocks.length === 0 || remainder) {
    throw new Error('The database CA file must contain only valid PEM certificates.');
  }
  try {
    const certificates = blocks.map((block) => new X509Certificate(block));
    if (!certificates.every((certificate) => certificate.ca === true)) {
      throw new Error('not a certificate authority');
    }
  } catch {
    throw new Error('The database CA file does not contain a valid CA certificate.');
  }
  return `${blocks.join('\n')}\n`;
}

export function parseRunnerArguments(args, env = process.env) {
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
    throw new Error('NODE_TLS_REJECT_UNAUTHORIZED=0 is forbidden.');
  }
  let execute = false;
  let diagnose = false;
  let argumentCAPath = null;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--execute' && !execute) {
      execute = true;
      continue;
    }
    if (argument === '--diagnose' && !diagnose) {
      diagnose = true;
      continue;
    }
    if (argument === '--ca-cert' && argumentCAPath === null) {
      argumentCAPath = args[index + 1] || null;
      index += 1;
      continue;
    }
    if (argument.startsWith('--ca-cert=') && argumentCAPath === null) {
      argumentCAPath = argument.slice('--ca-cert='.length) || null;
      continue;
    }
    throw new Error('Unsupported or repeated runner argument.');
  }
  const environmentCAPath = env.SUPABASE_DB_CA_CERT_PATH || null;
  if (
    argumentCAPath
    && environmentCAPath
    && resolve(argumentCAPath) !== resolve(environmentCAPath)
  ) {
    throw new Error('Choose exactly one database CA certificate path.');
  }
  if (execute && diagnose) {
    throw new Error('Choose exactly one runner mode: --execute or --diagnose.');
  }
  return {
    execute,
    diagnose,
    caCertPath: argumentCAPath || environmentCAPath,
  };
}

export async function loadStrictDatabaseCA(filePath, { cwd = process.cwd() } = {}) {
  if (!filePath) {
    throw new Error(
      'A local Supabase database CA certificate is required via --ca-cert '
      + 'or SUPABASE_DB_CA_CERT_PATH.',
    );
  }
  const requestedPath = resolve(cwd, filePath);
  let fileStats;
  try {
    fileStats = await lstat(requestedPath);
  } catch {
    throw new Error('The database CA certificate file is missing or inaccessible.');
  }
  if (!fileStats.isFile() || fileStats.isSymbolicLink()) {
    throw new Error('The database CA certificate path must be a regular file.');
  }

  const absolutePath = await realpath(requestedPath);
  const certificateDirectory = dirname(absolutePath);
  const repository = gitOutput(
    ['rev-parse', '--show-toplevel'],
    certificateDirectory,
  );
  if (repository.status === 0) {
    const repositoryRoot = await realpath(repository.stdout.trim());
    if (isPathWithin(repositoryRoot, absolutePath)) {
      const repositoryPath = relative(repositoryRoot, absolutePath);
      const tracked = gitOutput(
        ['ls-files', '--error-unmatch', '--', repositoryPath],
        repositoryRoot,
      );
      const ignored = gitOutput(
        ['check-ignore', '--quiet', '--', repositoryPath],
        repositoryRoot,
      );
      if (tracked.status === 0 || ignored.status !== 0) {
        throw new Error(
          'A database CA certificate inside the repository must be untracked and Git-ignored.',
        );
      }
    }
  }

  let pem;
  try {
    pem = await readFile(absolutePath, 'utf8');
  } catch {
    throw new Error('The database CA certificate file is unreadable.');
  }
  return certificateBlocks(pem);
}

export function assertAuthorizedStagingTarget(
  target,
  authorization = AUTHORIZED,
) {
  const failures = [];
  if (target.projectRef !== authorization.projectRef) failures.push('project_ref');
  if (target.database !== STAGING_TARGET.database) failures.push('database');
  if (target.username !== STAGING_TARGET.username) failures.push('username');
  if (
    target.connectionMode !== 'session-pooler'
    || target.hostname !== STAGING_TARGET.hostname
  ) {
    failures.push('session_pooler');
  }
  if (target.port !== STAGING_TARGET.port) failures.push('port');
  if (typeof target.password !== 'string' || target.password.length === 0) {
    failures.push('password');
  }
  if (failures.length > 0) {
    throw new Error(
      `PostgreSQL target rejected; failed checks: ${failures.join(', ')}.`,
    );
  }
  return target;
}

export function buildAuthorizedStagingTarget(
  password,
  authorization = AUTHORIZED,
) {
  const username = STAGING_TARGET.username;
  const target = {
    ...STAGING_TARGET,
    password,
    projectRef: username.slice('postgres.'.length),
    connectionMode: 'session-pooler',
  };
  return Object.freeze(assertAuthorizedStagingTarget(target, authorization));
}

export function assertStrictPgConfiguration(config, target) {
  assertAuthorizedStagingTarget(target);
  if (
    config.connectionString !== undefined
    || config.host !== target.hostname
    || config.port !== target.port
    || config.database !== target.database
    || config.user !== target.username
    || config.password !== target.password
  ) {
    throw new Error('PostgreSQL connection fields do not match the validated target.');
  }
  if (
    !config.ssl
    || config.ssl.rejectUnauthorized !== true
    || typeof config.ssl.ca !== 'string'
    || config.ssl.ca.length === 0
    || config.ssl.servername !== target.hostname
    || config.ssl.checkServerIdentity !== checkServerIdentity
  ) {
    throw new Error('Strict PostgreSQL TLS configuration is required.');
  }
  return config;
}

export function buildStrictPgConfiguration(target, ca) {
  const config = {
    host: target.hostname,
    port: target.port,
    database: target.database,
    user: target.username,
    password: target.password,
    ssl: {
      rejectUnauthorized: true,
      ca,
      servername: target.hostname,
      checkServerIdentity,
    },
    application_name: 'arma2_torneos_qa_seed_direct',
    connectionTimeoutMillis: 15_000,
    keepAlive: true,
  };
  return assertStrictPgConfiguration(config, target);
}

function sanitizedProjectRef(projectRef) {
  return projectRef ? `${projectRef.slice(0, 6)}…` : null;
}

function sanitizedUsername(username) {
  if (!username?.startsWith('postgres.')) return username || null;
  return `postgres.${sanitizedProjectRef(username.slice('postgres.'.length))}`;
}

function sanitizedServerAddress(address) {
  if (!address) return null;
  if (address.includes(':')) {
    const groups = address.split(':');
    return `${groups.slice(0, 2).join(':')}:…`;
  }
  const octets = address.split('.');
  return octets.length === 4
    ? `${octets.slice(0, 3).join('.')}.x`
    : '[present]';
}

function check(status, reason) {
  return { status: status ? 'pass' : 'fail', reason };
}

export function evaluateConnectedDiagnostics(
  { target, server, tls },
  authorization = AUTHORIZED,
) {
  const isSessionPooler = target.connectionMode === 'session-pooler';
  const expectedUsername = `postgres.${authorization.projectRef}`;
  const projectRefPass = target.projectRef === authorization.projectRef;
  const databasePass = (
    target.database === 'postgres'
    && server.databaseName === 'postgres'
  );
  const usernamePass = (
    target.username === expectedUsername
    && server.currentUser === 'postgres'
    && server.sessionUser === 'postgres'
  );
  const sessionPoolerPass = (
    isSessionPooler
    && target.hostname === STAGING_TARGET.hostname
    && SESSION_POOLER_HOST.test(target.hostname)
  );
  const sslActivePass = tls.encrypted === true;
  const tlsVersionPass = ACCEPTED_TLS_VERSIONS.has(tls.protocol);
  const certificateValidationPass = (
    tls.authorized === true
    && !tls.authorizationError
    && tls.servername === target.hostname
  );
  const portPass = target.port === 5432 && Number(server.serverPort) === 5432;

  const checks = {
    project_ref: check(
      projectRefPass,
      projectRefPass
        ? 'derived project ref matches the authorized Staging project'
        : 'derived project ref does not match the authorized Staging project',
    ),
    database: check(
      databasePass,
      databasePass
        ? 'target and current_database() are postgres'
        : 'target database or current_database() is not postgres',
    ),
    username: check(
      usernamePass,
      usernamePass
        ? 'routing username and PostgreSQL session roles are compatible'
        : 'routing username, current_user, or session_user is incompatible',
    ),
    session_pooler: check(
      sessionPoolerPass,
      sessionPoolerPass
        ? (
          isSessionPooler
            ? 'shared Session Pooler hostname is accepted without deriving project identity from it'
            : 'authorized direct endpoint does not require Pooler routing'
        )
        : 'host is neither the authorized direct endpoint nor a shared Session Pooler',
    ),
    ssl_active: check(
      sslActivePass,
      sslActivePass
        ? 'client-to-endpoint socket is encrypted'
        : 'client-to-endpoint socket is not encrypted',
    ),
    tls_version: check(
      tlsVersionPass,
      tlsVersionPass
        ? 'negotiated TLS version is accepted'
        : 'negotiated TLS version is missing or unsupported',
    ),
    certificate_validation: check(
      certificateValidationPass,
      certificateValidationPass
        ? 'CA chain and endpoint hostname were verified'
        : 'CA chain or endpoint hostname validation was not proven',
    ),
    port: check(
      portPass,
      portPass
        ? 'client endpoint and PostgreSQL backend use port 5432'
        : 'client endpoint or PostgreSQL backend is not on port 5432',
    ),
  };
  const failedChecks = CHECK_NAMES.filter((name) => checks[name].status === 'fail');
  return {
    mode: 'read-only-connection-diagnostic',
    status: failedChecks.length === 0 ? 'pass' : 'fail',
    failedChecks,
    checks,
    observed: {
      projectRef: sanitizedProjectRef(target.projectRef),
      hostname: target.hostname,
      connectionMode: target.connectionMode,
      targetPort: target.port,
      targetDatabase: target.database,
      targetUsername: sanitizedUsername(target.username),
      currentDatabase: server.databaseName,
      currentUser: server.currentUser,
      sessionUser: server.sessionUser,
      serverAddress: sanitizedServerAddress(server.serverAddress),
      serverPort: server.serverPort,
      backendPid: Number.isInteger(server.backendPid) ? 'observed' : 'unavailable',
      pgStatSsl: {
        active: server.backendSsl === true,
        tlsVersion: server.backendTlsVersion || null,
        cipher: server.backendCipher || null,
        scope: 'Session Pooler to PostgreSQL backend',
      },
      clientTls: {
        active: tls.encrypted === true,
        authorized: tls.authorized === true,
        protocol: tls.protocol || null,
        cipher: tls.cipher || null,
        servername: tls.servername || null,
        peerSubjectCN: tls.peerSubjectCN || null,
        peerIssuerCN: tls.peerIssuerCN || null,
      },
    },
  };
}

export async function diagnoseConnectedDatabase(client, target) {
  const serverResult = await client.query(
    `select current_database() as database_name,
            current_user as current_user_name,
            session_user as session_user_name,
            host(inet_server_addr()) as server_address,
            inet_server_port() as server_port,
            pg_backend_pid() as backend_pid,
            ssl_row.ssl as backend_ssl,
            ssl_row.version as backend_tls_version,
            ssl_row.cipher as backend_cipher
     from (select pg_backend_pid() as backend_pid) current_backend
     left join pg_stat_ssl ssl_row on ssl_row.pid = current_backend.backend_pid`,
  );
  const row = serverResult.rows[0] || {};
  const stream = client.connection.stream;
  const peer = stream.getPeerCertificate?.();
  const cipher = stream.getCipher?.();
  return evaluateConnectedDiagnostics({
    target,
    server: {
      databaseName: row.database_name,
      currentUser: row.current_user_name,
      sessionUser: row.session_user_name,
      serverAddress: row.server_address,
      serverPort: row.server_port,
      backendPid: row.backend_pid,
      backendSsl: row.backend_ssl,
      backendTlsVersion: row.backend_tls_version,
      backendCipher: row.backend_cipher,
    },
    tls: {
      encrypted: stream.encrypted === true,
      authorized: stream.authorized === true,
      authorizationError: stream.authorizationError || null,
      protocol: stream.getProtocol?.() || null,
      cipher: cipher?.standardName || cipher?.name || null,
      servername: stream.servername || null,
      peerSubjectCN: peer?.subject?.CN || null,
      peerIssuerCN: peer?.issuer?.CN || null,
    },
  });
}

function assertDiagnosticPass(diagnostic) {
  if (diagnostic.status === 'pass') return diagnostic;
  const error = new Error(
    `Connection diagnostic rejected; failed checks: ${diagnostic.failedChecks.join(', ')}.`,
  );
  error.connectionDiagnostic = diagnostic;
  throw error;
}

function requiredProperty(object, property, label) {
  if (!object || !Object.hasOwn(object, property)) {
    throw new Error(`Resolved manifest validation is missing ${label}.`);
  }
  return object[property];
}

function assertExact(label, actual, expected) {
  if (actual !== expected) {
    throw new Error(
      `Resolved manifest ${label} does not match the remote authorization: `
      + `expected ${expected}, got ${actual}.`,
    );
  }
}

export function assertAuthorizedManifest(
  manifest,
  validation,
  authorization = AUTHORIZED,
) {
  const counts = requiredProperty(validation, 'counts', 'validation.counts');
  const baseRows = requiredProperty(counts, 'baseRows', 'validation.counts.baseRows');
  const markerRows = requiredProperty(counts, 'markerRows', 'validation.counts.markerRows');
  const totalRows = requiredProperty(counts, 'totalRows', 'validation.counts.totalRows');
  const tables = requiredProperty(counts, 'tables', 'validation.counts.tables');
  const expectedRowCount = requiredProperty(
    manifest,
    'expectedRowCount',
    'manifest.expectedRowCount',
  );
  const expectedTableCount = requiredProperty(
    manifest,
    'expectedTableCount',
    'manifest.expectedTableCount',
  );

  assertExact('seed key', manifest.seedKey, authorization.seedKey);
  assertExact('manifest hash', manifest.manifestHash, authorization.manifestHash);
  assertExact(
    'identity-map fingerprint',
    manifest.identityMapFingerprint,
    authorization.identityMapFingerprint,
  );
  assertExact(
    'ownership fingerprint',
    manifest.rowOwnershipFingerprint,
    authorization.ownershipFingerprint,
  );
  assertExact('validated base-row count', baseRows, authorization.baseRows);
  assertExact('validated marker count', markerRows, authorization.markerRows);
  assertExact('validated total-row count', totalRows, authorization.totalRows);
  assertExact('validated table count', tables, authorization.tables);
  assertExact('declared total-row count', expectedRowCount, totalRows);
  assertExact('declared table count', expectedTableCount, tables);
}

export function validateRunnerPreflight(manifest, authorization = AUTHORIZED) {
  const validation = validateCanonicalManifest(manifest);
  assertAuthorizedManifest(manifest, validation, authorization);
  return validation;
}

export function safeError(error) {
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
    connectionDiagnostic: error?.connectionDiagnostic || null,
  };
}

async function main() {
  const options = parseRunnerArguments(process.argv.slice(2));
  if (!options.execute && !options.diagnose) {
    throw new Error(
      'Prepared only. Pass --diagnose for a read-only connection audit, or '
      + '--execute after a separate remote-write authorization.',
    );
  }

  let manifest = null;
  if (options.execute) {
    const identityMap = await loadQAIdentityMap({
      env: {
        ...process.env,
        QA_IDENTITY_MAP_FILE: process.env.QA_IDENTITY_MAP_FILE
          || 'torneos-demo-v2-identity-map.local',
      },
    });
    manifest = buildCanonicalManifest({ identityMap });
    validateRunnerPreflight(manifest);
  }

  const databaseCA = await loadStrictDatabaseCA(options.caCertPath);
  const databasePassword = readPasswordFromMacOSDialog();
  const target = buildAuthorizedStagingTarget(databasePassword);

  if (options.execute) {
    const confirmation = createInterface({ input: process.stdin, output: process.stderr });
    const answer = await confirmation.question(
      `Escribí "APLICAR ${AUTHORIZED.seedKey}" para continuar: `,
    );
    confirmation.close();
    if (answer !== `APLICAR ${AUTHORIZED.seedKey}`) {
      throw new Error('Execution confirmation did not match.');
    }
  }

  const configuration = buildStrictPgConfiguration(target, databaseCA);
  const client = new pg.Client(configuration);
  await client.connect();
  try {
    if (options.diagnose) {
      await client.query('begin read only');
      try {
        const diagnostic = await diagnoseConnectedDatabase(client, target);
        console.log(JSON.stringify(diagnostic, null, 2));
        assertDiagnosticPass(diagnostic);
      } finally {
        await client.query('rollback');
      }
      return;
    }

    const diagnostic = assertDiagnosticPass(
      await diagnoseConnectedDatabase(client, target),
    );
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
      connectionDiagnostic: diagnostic,
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

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((error) => {
    console.error(JSON.stringify({ error: safeError(error) }, null, 2));
    process.exitCode = 1;
  });
}
