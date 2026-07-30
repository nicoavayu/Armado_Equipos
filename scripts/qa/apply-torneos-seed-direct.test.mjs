import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import tls from 'node:tls';

import pg from 'pg';

import {
  assertAuthorizedManifest,
  assertAuthorizedStagingTarget,
  assertStrictPgConfiguration,
  buildAuthorizedStagingTarget,
  buildStrictPgConfiguration,
  diagnoseConnectedDatabase,
  evaluateConnectedDiagnostics,
  loadStrictDatabaseCA,
  parseRunnerArguments,
  readPasswordFromMacOSDialog,
  safeError,
  validateRunnerPreflight,
} from './apply-torneos-seed-direct.mjs';
import {
  buildCanonicalManifest,
  validateCanonicalManifest,
} from './torneos-demo-manifest.mjs';
import {
  QAIdentityMap,
  QA_IDENTITY_RELATIONS,
  QA_IDENTITY_ROLES,
} from './torneos-qa-identity-map.mjs';

function fixtureIdentityMap() {
  return new QAIdentityMap(Object.fromEntries(QA_IDENTITY_ROLES.map((role, index) => [
    role,
    {
      auth_user_id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      expected_email: `qa-${role}@localhost.invalid`,
      logical_role: role,
      projected_relations: QA_IDENTITY_RELATIONS[role],
    },
  ])));
}

function fixture() {
  const manifest = buildCanonicalManifest({ identityMap: fixtureIdentityMap() });
  return {
    manifest,
    authorization: {
      seedKey: manifest.seedKey,
      manifestHash: manifest.manifestHash,
      identityMapFingerprint: manifest.identityMapFingerprint,
      ownershipFingerprint: manifest.rowOwnershipFingerprint,
      baseRows: 586,
      markerRows: 1,
      totalRows: 587,
      tables: 32,
    },
  };
}

function validSessionPoolerDiagnostic() {
  const target = buildAuthorizedStagingTarget('local-only');
  return {
    target,
    server: {
      databaseName: 'postgres',
      currentUser: 'postgres',
      sessionUser: 'postgres',
      serverAddress: '10.0.0.14',
      serverPort: 5432,
      backendPid: 4242,
      backendSsl: false,
      backendTlsVersion: null,
      backendCipher: null,
    },
    tls: {
      encrypted: true,
      authorized: true,
      authorizationError: null,
      protocol: 'TLSv1.3',
      cipher: 'TLS_AES_256_GCM_SHA384',
      servername: target.hostname,
      peerSubjectCN: '*.pooler.supabase.com',
      peerIssuerCN: 'Supabase database CA',
    },
  };
}

function manifestWithRowDelta(manifest, delta) {
  const changed = structuredClone(manifest);
  const operation = changed.operations.find((item) => (
    item.table !== 'tournament_audit_log' && item.rows.length > 1
  ));
  if (delta === -1) operation.rows.pop();
  if (delta === 1) operation.rows.push(structuredClone(operation.rows[0]));
  return changed;
}

function manifestWithTableCount(manifest, tables) {
  const changed = structuredClone(manifest);
  if (tables === 31) {
    const removed = changed.operations.findIndex((operation) => (
      operation.table !== 'tournament_audit_log' && operation.rows.length > 0
    ));
    const [operation] = changed.operations.splice(removed, 1);
    changed.operations[0].rows.push(...operation.rows);
    return changed;
  }
  changed.operations.push({
    table: 'qa_unexpected_table',
    identity: ['id'],
    rows: [],
    naturalKeys: [],
  });
  return changed;
}

function runOpenSSL(args, cwd) {
  const result = spawnSync('openssl', args, {
    cwd,
    encoding: 'utf8',
  });
  assert.equal(
    result.status,
    0,
    result.stderr || result.stdout || `openssl ${args[0]} failed`,
  );
}

async function createTLSFixture(hostname) {
  const directory = await mkdtemp(join(tmpdir(), 'torneos-direct-tls-'));
  const caKey = join(directory, 'ca.key');
  const caCert = join(directory, 'ca.crt');
  const serverKey = join(directory, 'server.key');
  const serverCsr = join(directory, 'server.csr');
  const serverCert = join(directory, 'server.crt');
  const extensions = join(directory, 'server.ext');
  runOpenSSL([
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-sha256',
    '-days',
    '1',
    '-subj',
    '/CN=Arma2 QA ephemeral root',
    '-addext',
    'basicConstraints=critical,CA:TRUE',
    '-addext',
    'keyUsage=critical,keyCertSign,cRLSign',
    '-keyout',
    caKey,
    '-out',
    caCert,
  ], directory);
  runOpenSSL([
    'req',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-sha256',
    '-subj',
    `/CN=${hostname}`,
    '-keyout',
    serverKey,
    '-out',
    serverCsr,
  ], directory);
  await writeFile(
    extensions,
    `subjectAltName=DNS:${hostname}\nbasicConstraints=critical,CA:FALSE\n`,
    { mode: 0o600 },
  );
  runOpenSSL([
    'x509',
    '-req',
    '-in',
    serverCsr,
    '-CA',
    caCert,
    '-CAkey',
    caKey,
    '-CAcreateserial',
    '-days',
    '1',
    '-sha256',
    '-extfile',
    extensions,
    '-out',
    serverCert,
  ], directory);
  return {
    directory,
    ca: await readFile(caCert, 'utf8'),
    caCert,
    key: await readFile(serverKey, 'utf8'),
    cert: await readFile(serverCert, 'utf8'),
  };
}

async function startPostgresTLSServer({ key, cert }) {
  const secureContext = tls.createSecureContext({ key, cert });
  const state = {
    sslRequests: 0,
    tlsConnections: 0,
    applicationBytes: 0,
    startupMessages: 0,
    queryMessages: 0,
  };
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.once('data', (request) => {
      if (
        request.length !== 8
        || request.readInt32BE(0) !== 8
        || request.readInt32BE(4) !== 80877103
      ) {
        socket.destroy(new Error('Unexpected PostgreSQL SSL request.'));
        return;
      }
      state.sslRequests += 1;
      socket.write('S', () => {
        const secureSocket = new tls.TLSSocket(socket, {
          isServer: true,
          secureContext,
        });
        secureSocket.once('secure', () => {
          state.tlsConnections += 1;
        });
        let pending = Buffer.alloc(0);
        let startupComplete = false;
        secureSocket.on('data', (chunk) => {
          state.applicationBytes += chunk.length;
          pending = Buffer.concat([pending, chunk]);
          if (!startupComplete && pending.length >= 4) {
            const startupLength = pending.readInt32BE(0);
            if (pending.length >= startupLength) {
              startupComplete = true;
              state.startupMessages += 1;
              pending = pending.subarray(startupLength);
              const authenticationOK = Buffer.alloc(9);
              authenticationOK.write('R', 0);
              authenticationOK.writeInt32BE(8, 1);
              authenticationOK.writeInt32BE(0, 5);
              const readyForQuery = Buffer.alloc(6);
              readyForQuery.write('Z', 0);
              readyForQuery.writeInt32BE(5, 1);
              readyForQuery.write('I', 5);
              secureSocket.write(Buffer.concat([authenticationOK, readyForQuery]));
            }
          }
          while (startupComplete && pending.length >= 5) {
            const messageLength = pending.readInt32BE(1);
            const frameLength = messageLength + 1;
            if (pending.length < frameLength) break;
            if (pending.toString('utf8', 0, 1) === 'Q') {
              state.queryMessages += 1;
            }
            pending = pending.subarray(frameLength);
          }
        });
        secureSocket.on('error', () => {});
      });
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    port: server.address().port,
    state,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function pgClientForLocalTLSServer(config, port) {
  return new pg.Client({
    ...config,
    stream: () => {
      const socket = new net.Socket();
      const connect = socket.connect.bind(socket);
      socket.connect = () => connect({ host: '127.0.0.1', port });
      return socket;
    },
  });
}

test('direct runner preflight accepts only the exact validated manifest contract', () => {
  const { manifest, authorization } = fixture();
  const validation = validateRunnerPreflight(manifest, authorization);
  assert.deepEqual(validation, validateCanonicalManifest(manifest));
  assert.deepEqual(validation.counts, {
    baseRows: 586,
    markerRows: 1,
    totalRows: 587,
    tables: 32,
  });
});

test('direct runner preflight rejects a missing validated total-row property explicitly', () => {
  const { manifest, authorization } = fixture();
  const validation = structuredClone(validateCanonicalManifest(manifest));
  delete validation.counts.totalRows;
  assert.throws(
    () => assertAuthorizedManifest(manifest, validation, authorization),
    /validation\.counts\.totalRows/,
  );
});

test('direct runner preflight rejects 586 or 588 total rows', () => {
  const { manifest, authorization } = fixture();
  for (const delta of [-1, 1]) {
    assert.throws(
      () => validateRunnerPreflight(
        manifestWithRowDelta(manifest, delta),
        authorization,
      ),
      new RegExp(`${587 + delta} total rows`),
    );
  }
});

test('direct runner preflight rejects 31 or 33 tables', () => {
  const { manifest, authorization } = fixture();
  for (const tables of [31, 33]) {
    assert.throws(
      () => validateRunnerPreflight(
        manifestWithTableCount(manifest, tables),
        authorization,
      ),
      new RegExp(`${tables} tables`),
    );
  }
});

test('direct runner preflight rejects an incorrect manifest hash or fingerprint', () => {
  const { manifest, authorization } = fixture();
  for (const property of [
    'manifestHash',
    'identityMapFingerprint',
    'rowOwnershipFingerprint',
  ]) {
    const changed = structuredClone(manifest);
    changed[property] = '0'.repeat(64);
    assert.throws(
      () => validateRunnerPreflight(changed, authorization),
      /does not match the remote authorization/,
    );
  }
});

test('direct runner preflight requires exactly one seed marker', () => {
  const { manifest, authorization } = fixture();
  const changed = structuredClone(manifest);
  const marker = changed.operations
    .flatMap((operation) => operation.rows)
    .find((row) => row.resource_type === 'qa_seed_execution');
  marker.resource_type = 'not_a_seed_execution';
  assert.throws(
    () => validateRunnerPreflight(changed, authorization),
    /0 marker/,
  );
});

test('strict TLS accepts a valid untracked CA and builds verify-full pg configuration', async (t) => {
  const hostname = 'aws-0-us-east-1.pooler.supabase.com';
  const fixture = await createTLSFixture(hostname);
  t.after(() => rm(fixture.directory, { recursive: true, force: true }));
  const ca = await loadStrictDatabaseCA(fixture.caCert);
  const target = buildAuthorizedStagingTarget('local-only');
  const config = buildStrictPgConfiguration(target, ca);
  assert.equal(config.connectionString, undefined);
  assert.equal(config.ssl.rejectUnauthorized, true);
  assert.equal(config.ssl.ca, ca);
  assert.equal(config.ssl.servername, hostname);
  assert.equal(config.ssl.checkServerIdentity, tls.checkServerIdentity);
  assert.equal(assertStrictPgConfiguration(config, target), config);
});

test('strict TLS rejects a missing CA before a client can be created', async () => {
  await assert.rejects(
    () => loadStrictDatabaseCA(join(tmpdir(), 'torneos-ca-does-not-exist.crt')),
    /missing or inaccessible/,
  );
});

test('strict TLS rejects an invalid PEM file', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'torneos-invalid-ca-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, 'invalid.crt');
  await writeFile(filePath, 'not a certificate\n', { mode: 0o600 });
  await assert.rejects(
    () => loadStrictDatabaseCA(filePath),
    /valid PEM certificates/,
  );
});

test('strict TLS rejects a CA file inside Git unless the path is ignored', async (t) => {
  const hostname = 'aws-0-us-east-1.pooler.supabase.com';
  const fixture = await createTLSFixture(hostname);
  const unignoredPath = join(
    process.cwd(),
    `torneos-unignored-ca-${process.pid}.crt`,
  );
  const ignoredPath = join(
    process.cwd(),
    `torneos-ignored-ca-${process.pid}.local`,
  );
  t.after(async () => {
    await rm(unignoredPath, { force: true });
    await rm(ignoredPath, { force: true });
    await rm(fixture.directory, { recursive: true, force: true });
  });
  await writeFile(unignoredPath, fixture.ca, { mode: 0o600 });
  await assert.rejects(
    () => loadStrictDatabaseCA(unignoredPath),
    /must be untracked and Git-ignored/,
  );
  await writeFile(ignoredPath, fixture.ca, { mode: 0o600 });
  assert.equal(await loadStrictDatabaseCA(ignoredPath), fixture.ca);
});

test('strict TLS rejects any rejectUnauthorized value other than true', async (t) => {
  const hostname = 'aws-0-us-east-1.pooler.supabase.com';
  const fixture = await createTLSFixture(hostname);
  t.after(() => rm(fixture.directory, { recursive: true, force: true }));
  const target = buildAuthorizedStagingTarget('local-only');
  const config = buildStrictPgConfiguration(target, fixture.ca);
  config.ssl.rejectUnauthorized = false;
  assert.throws(
    () => assertStrictPgConfiguration(config, target),
    /Strict PostgreSQL TLS configuration is required/,
  );
});

test('authorized target uses only fixed Staging Session Pooler fields', () => {
  const sessionPooler = buildAuthorizedStagingTarget('local-only');
  assert.equal(sessionPooler.hostname, 'aws-0-us-east-1.pooler.supabase.com');
  assert.equal(sessionPooler.database, 'postgres');
  assert.equal(sessionPooler.username, 'postgres.hhyvmhgpapyuzjgxfnqv');
  assert.equal(sessionPooler.connectionMode, 'session-pooler');
  assert.equal(sessionPooler.projectRef, 'hhyvmhgpapyuzjgxfnqv');
  assert.equal(sessionPooler.port, 5432);
  assert.throws(
    () => buildAuthorizedStagingTarget(''),
    /failed checks: password/,
  );
});

test('secure macOS dialog requests only a hidden password and keeps it out of arguments', () => {
  const secret = 'new-password-only-from-dialog-pipe';
  let invocation = null;
  const password = readPasswordFromMacOSDialog({
    platform: 'darwin',
    spawn(command, args, options) {
      invocation = { command, args, options };
      return {
        status: 0,
        stdout: `${secret}\n`,
        stderr: '',
      };
    },
  });
  assert.equal(password, secret);
  assert.equal(invocation.command, '/usr/bin/osascript');
  assert.deepEqual(invocation.options.stdio, ['ignore', 'pipe', 'pipe']);
  assert.match(invocation.args.join(' '), /with hidden answer/);
  assert.equal(invocation.args.some((argument) => argument.includes(secret)), false);
  assert.doesNotMatch(invocation.args.join(' '), /postgres(?:ql)?:\/\//);
});

test('secure macOS dialog reports cancellation without exposing child output', () => {
  const secret = 'must-not-appear-in-the-error';
  assert.throws(
    () => readPasswordFromMacOSDialog({
      platform: 'darwin',
      spawn: () => ({
        status: 1,
        stdout: '',
        stderr: secret,
      }),
    }),
    (error) => {
      assert.match(error.message, /cancelled or unavailable/);
      assert.doesNotMatch(error.message, new RegExp(secret));
      return true;
    },
  );
});

test('valid Session Pooler diagnostic passes when client TLS is strict and backend pg_stat_ssl is false', () => {
  const diagnostic = evaluateConnectedDiagnostics(validSessionPoolerDiagnostic());
  assert.equal(diagnostic.status, 'pass');
  assert.deepEqual(diagnostic.failedChecks, []);
  assert.equal(diagnostic.checks.project_ref.status, 'pass');
  assert.equal(diagnostic.checks.database.status, 'pass');
  assert.equal(diagnostic.checks.username.status, 'pass');
  assert.equal(diagnostic.checks.session_pooler.status, 'pass');
  assert.equal(diagnostic.checks.ssl_active.status, 'pass');
  assert.equal(diagnostic.checks.tls_version.status, 'pass');
  assert.equal(diagnostic.checks.certificate_validation.status, 'pass');
  assert.equal(diagnostic.checks.port.status, 'pass');
  assert.equal(diagnostic.observed.pgStatSsl.active, false);
  assert.equal(
    diagnostic.observed.pgStatSsl.scope,
    'Session Pooler to PostgreSQL backend',
  );
  assert.equal(diagnostic.observed.clientTls.active, true);
  assert.match(diagnostic.observed.projectRef, /^hhyvmh…$/);
  assert.match(diagnostic.observed.targetUsername, /^postgres\.hhyvmh…$/);
});

test('connection target rejects every unsafe Staging condition by name', () => {
  const authorized = buildAuthorizedStagingTarget('local-only');
  const cases = [
    {
      label: 'project_ref',
      mutate: (target) => { target.projectRef = 'aaaaaaaaaaaaaaaaaaaa'; },
    },
    {
      label: 'database',
      mutate: (target) => { target.database = 'template1'; },
    },
    {
      label: 'username',
      mutate: (target) => { target.username = 'postgres'; },
    },
    {
      label: 'session_pooler',
      mutate: (target) => { target.hostname = 'db.hhyvmhgpapyuzjgxfnqv.supabase.co'; },
    },
    {
      label: 'port',
      mutate: (target) => { target.port = 6543; },
    },
    {
      label: 'password',
      mutate: (target) => { target.password = ''; },
    },
  ];
  for (const { label, mutate } of cases) {
    const target = structuredClone(authorized);
    mutate(target);
    assert.throws(
      () => assertAuthorizedStagingTarget(target),
      new RegExp(`failed checks: .*${label}`),
    );
  }
});

test('connected diagnostic rejects each post-connect condition independently', () => {
  const cases = [
    {
      label: 'project_ref',
      mutate: (fixture) => { fixture.target.projectRef = 'aaaaaaaaaaaaaaaaaaaa'; },
    },
    {
      label: 'database',
      mutate: (fixture) => { fixture.server.databaseName = 'template1'; },
    },
    {
      label: 'username',
      mutate: (fixture) => { fixture.server.sessionUser = 'authenticator'; },
    },
    {
      label: 'session_pooler',
      mutate: (fixture) => { fixture.target.connectionMode = 'unsupported'; },
    },
    {
      label: 'ssl_active',
      mutate: (fixture) => { fixture.tls.encrypted = false; },
    },
    {
      label: 'tls_version',
      mutate: (fixture) => { fixture.tls.protocol = 'TLSv1.1'; },
    },
    {
      label: 'certificate_validation',
      mutate: (fixture) => {
        fixture.tls.authorized = false;
        fixture.tls.authorizationError = 'UNABLE_TO_VERIFY_LEAF_SIGNATURE';
      },
    },
    {
      label: 'port',
      mutate: (fixture) => { fixture.server.serverPort = 6543; },
    },
  ];
  for (const { label, mutate } of cases) {
    const fixture = validSessionPoolerDiagnostic();
    fixture.target = { ...fixture.target };
    mutate(fixture);
    const diagnostic = evaluateConnectedDiagnostics(fixture);
    assert.equal(diagnostic.status, 'fail', label);
    assert.equal(diagnostic.checks[label].status, 'fail', label);
    assert.ok(diagnostic.failedChecks.includes(label), label);
  }
});

test('connected diagnostic queries identity and both TLS scopes without writing', async () => {
  const fixture = validSessionPoolerDiagnostic();
  const queries = [];
  const client = {
    connection: {
      stream: {
        encrypted: true,
        authorized: true,
        authorizationError: null,
        servername: fixture.target.hostname,
        getProtocol: () => fixture.tls.protocol,
        getCipher: () => ({ standardName: fixture.tls.cipher }),
        getPeerCertificate: () => ({
          subject: { CN: fixture.tls.peerSubjectCN },
          issuer: { CN: fixture.tls.peerIssuerCN },
        }),
      },
    },
    async query(sql) {
      queries.push(sql);
      return {
        rows: [{
          database_name: fixture.server.databaseName,
          current_user_name: fixture.server.currentUser,
          session_user_name: fixture.server.sessionUser,
          server_address: fixture.server.serverAddress,
          server_port: fixture.server.serverPort,
          backend_pid: fixture.server.backendPid,
          backend_ssl: fixture.server.backendSsl,
          backend_tls_version: fixture.server.backendTlsVersion,
          backend_cipher: fixture.server.backendCipher,
        }],
      };
    },
  };
  const diagnostic = await diagnoseConnectedDatabase(client, fixture.target);
  assert.equal(diagnostic.status, 'pass');
  assert.equal(queries.length, 1);
  assert.match(queries[0], /current_database\(\)/);
  assert.match(queries[0], /current_user/);
  assert.match(queries[0], /session_user/);
  assert.match(queries[0], /inet_server_addr\(\)/);
  assert.match(queries[0], /inet_server_port\(\)/);
  assert.match(queries[0], /pg_backend_pid\(\)/);
  assert.match(queries[0], /pg_stat_ssl/);
  assert.doesNotMatch(queries[0], /\b(insert|update|delete|merge|truncate)\b/i);
});

test('runner rejects process-wide TLS verification disablement', () => {
  assert.throws(
    () => parseRunnerArguments(
      ['--execute', '--ca-cert', '/tmp/local-ca.crt'],
      { NODE_TLS_REJECT_UNAUTHORIZED: '0' },
    ),
    /NODE_TLS_REJECT_UNAUTHORIZED=0 is forbidden/,
  );
});

test('runner exposes a read-only diagnostic mode and forbids combining it with execute', () => {
  assert.deepEqual(
    parseRunnerArguments(['--diagnose', '--ca-cert', '/tmp/local-ca.crt'], {}),
    {
      execute: false,
      diagnose: true,
      caCertPath: '/tmp/local-ca.crt',
    },
  );
  assert.throws(
    () => parseRunnerArguments(
      ['--diagnose', '--execute', '--ca-cert', '/tmp/local-ca.crt'],
      {},
    ),
    /exactly one runner mode/,
  );
});

test('runner completes manifest validation before reading the CA or credentials', async (t) => {
  const invalidIdentityMap = join(
    process.cwd(),
    `torneos-invalid-identity-${process.pid}.local`,
  );
  t.after(() => rm(invalidIdentityMap, { force: true }));
  await writeFile(invalidIdentityMap, '{}\n', { mode: 0o600 });
  const result = spawnSync(
    process.execPath,
    [
      'scripts/qa/apply-torneos-seed-direct.mjs',
      '--execute',
      '--ca-cert',
      join(tmpdir(), 'torneos-ca-must-not-be-read.crt'),
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        QA_IDENTITY_MAP_FILE: invalidIdentityMap,
        NODE_TLS_REJECT_UNAUTHORIZED: '',
      },
      encoding: 'utf8',
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /QAIdentityMap roles mismatch/);
  assert.doesNotMatch(result.stderr, /database CA certificate file is missing/);
});

test('ephemeral PostgreSQL TLS handshake trusts only the configured CA and sends zero SQL on rejection', async (t) => {
  const hostname = 'aws-0-us-east-1.pooler.supabase.com';
  const trusted = await createTLSFixture(hostname);
  const untrusted = await createTLSFixture(hostname);
  const server = await startPostgresTLSServer(trusted);
  t.after(async () => {
    await server.close();
    await rm(trusted.directory, { recursive: true, force: true });
    await rm(untrusted.directory, { recursive: true, force: true });
  });

  const target = buildAuthorizedStagingTarget('local-only');
  const trustedClient = pgClientForLocalTLSServer(
    buildStrictPgConfiguration(target, trusted.ca),
    server.port,
  );
  await trustedClient.connect();
  assert.equal(trustedClient.connection.stream.authorized, true);
  await trustedClient.end();

  const untrustedClient = pgClientForLocalTLSServer(
    buildStrictPgConfiguration(target, untrusted.ca),
    server.port,
  );
  await assert.rejects(
    () => untrustedClient.connect(),
    (error) => {
      const visible = safeError(error);
      assert.match(
        visible.message,
        /certificate|issuer|self[- ]signed|unable to verify/i,
      );
      return true;
    },
  );
  assert.equal(server.state.sslRequests, 2);
  assert.equal(server.state.startupMessages, 1);
  assert.equal(server.state.queryMessages, 0);
});

test('ephemeral PostgreSQL TLS handshake rejects a CA-trusted hostname mismatch before SQL', async (t) => {
  const targetHostname = 'aws-0-us-east-1.pooler.supabase.com';
  const wrongHostname = 'wrong.pooler.supabase.com';
  const fixture = await createTLSFixture(wrongHostname);
  const server = await startPostgresTLSServer(fixture);
  t.after(async () => {
    await server.close();
    await rm(fixture.directory, { recursive: true, force: true });
  });

  const target = buildAuthorizedStagingTarget('local-only');
  const client = pgClientForLocalTLSServer(
    buildStrictPgConfiguration(target, fixture.ca),
    server.port,
  );
  await assert.rejects(
    () => client.connect(),
    (error) => {
      assert.match(
        safeError(error).message,
        /hostname|altname|not cert's/i,
      );
      return true;
    },
  );
  assert.equal(server.state.sslRequests, 1);
  assert.equal(server.state.startupMessages, 0);
  assert.equal(server.state.queryMessages, 0);
});
