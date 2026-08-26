import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const repoRoot = process.cwd();
const functionsRoot = path.join(repoRoot, 'supabase', 'functions');
const functionNames = (await fs.readdir(functionsRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && entry.name !== '_shared')
  .map((entry) => entry.name)
  .sort();

const expectedFunctions = [
  'accept-invite',
  'approve-join-request',
  'delete-account',
  'issue-voting-photo-token',
  'join-match-guest',
  'push-auto-match-now',
  'push-dispatch-now',
  'push-sender',
  'tournament-media-processor',
  'tournament-media-signer',
  'tournament-player-portraits',
  'tournament-team-photos',
  'upload-voting-photo',
];

const publicFunctions = new Set([
  'issue-voting-photo-token',
  'join-match-guest',
  'upload-voting-photo',
]);

const userFunctions = new Set([
  'accept-invite',
  'approve-join-request',
  'delete-account',
  'push-auto-match-now',
  'push-dispatch-now',
  'tournament-media-processor',
  'tournament-media-signer',
  'tournament-player-portraits',
  'tournament-team-photos',
]);

const backendFunctions = new Set(['push-sender']);

test('the complete Edge Function inventory is classified', () => {
  assert.deepEqual(functionNames, expectedFunctions);
  const classified = new Set([
    ...publicFunctions,
    ...userFunctions,
    ...backendFunctions,
  ]);
  assert.deepEqual([...classified].sort(), expectedFunctions);
});

test('every key-consuming function uses the shared helper', async () => {
  for (const name of functionNames) {
    const source = await fs.readFile(
      path.join(functionsRoot, name, 'index.ts'),
      'utf8',
    );
    assert.doesNotMatch(
      source,
      /Deno\.env\.get\("(?:SERVICE_ROLE_KEY|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_ANON_KEY|SUPABASE_SECRET_KEYS|SUPABASE_PUBLISHABLE_KEYS)"\)/,
      `${name} reads an API key outside the shared helper`,
    );
  }
});

test('new API keys are never built into Authorization Bearer headers', async () => {
  const roots = [
    'supabase/functions',
    'supabase/migrations',
    'src',
    'scripts',
    '.github',
  ];
  const files = [];
  for (const root of roots) {
    const walk = async (directory) => {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) await walk(absolute);
        else if (/\.(?:js|jsx|mjs|sql|ts|tsx|yml|yaml)$/.test(entry.name)) {
          files.push(absolute);
        }
      }
    };
    await walk(path.join(repoRoot, root));
  }

  for (const file of files) {
    const source = await fs.readFile(file, 'utf8');
    assert.doesNotMatch(
      source,
      /(?:Authorization\s*:\s*`Bearer \$\{(?:serviceRoleKey|serviceKey|supabaseServiceKey|anonKey|SUPABASE_(?:READ|WRITE)_KEY)\}`|'Authorization'\s*,\s*'Bearer '\s*\|\|\s*trim\(v_service_role_jwt\)|--header "Authorization: Bearer \$SERVICE_ROLE_KEY")/,
      `${path.relative(repoRoot, file)} sends an API key as Bearer`,
    );
  }
});

test('verify_jwt matches each function authentication mode', async () => {
  const config = await fs.readFile(
    path.join(repoRoot, 'supabase', 'config.toml'),
    'utf8',
  );
  const configuredModes = new Map(
    [...config.matchAll(
      /\[functions\.([^\]]+)\][\s\S]*?verify_jwt\s*=\s*(true|false)/g,
    )].map((match) => [match[1], match[2] === 'true']),
  );
  for (const name of publicFunctions) {
    assert.equal(configuredModes.get(name), false, name);
  }
  for (const name of userFunctions) {
    assert.equal(configuredModes.get(name), true, name);
  }
  assert.equal(configuredModes.get('push-sender'), false, 'push-sender');
});

test('the browser guest flow sends only apikey when no user JWT exists', async () => {
  const source = await fs.readFile(
    path.join(repoRoot, 'src', 'pages', 'PartidoInvitacion.js'),
    'utf8',
  );
  const invocation = source.slice(
    source.indexOf('functions/v1/join-match-guest'),
    source.indexOf('functions/v1/join-match-guest') + 600,
  );
  assert.match(invocation, /['"]apikey['"]:\s*anonKey/);
  assert.doesNotMatch(invocation, /Authorization/);
});

test('the signer attests itself, and only itself, with the TTL the manifest declares', async () => {
  const source = await fs.readFile(
    path.join(functionsRoot, 'tournament-media-signer', 'index.ts'),
    'utf8',
  );
  const manifest = JSON.parse(await fs.readFile(
    path.join(repoRoot, 'ops', 'torneos-staging', 'manifest.json'), 'utf8',
  ));
  const declared = manifest.edgeFunctions.find(({ name }) => name === 'tournament-media-signer');

  assert.match(source, /\.rpc\("attest_tournament_media_service"/);
  assert.match(source, /p_service:\s*"signer"/);
  assert.match(source, new RegExp(`p_ttl_seconds:\\s*${declared.attestationTtlSeconds}\\b`));
  assert.doesNotMatch(source, /revoke_tournament_media_service_attestation/);
  // The health action is the only path that attests, and it is behind the
  // attestation secret rather than behind a user session.
  assert.match(source, /x-media-attestation-secret/);
  assert.deepEqual(declared.attests, ['signer']);
});

test('the processor health revokes a stale attestation and never writes one', async () => {
  const source = await fs.readFile(
    path.join(functionsRoot, 'tournament-media-processor', 'index.ts'),
    'utf8',
  );
  const manifest = JSON.parse(await fs.readFile(
    path.join(repoRoot, 'ops', 'torneos-staging', 'manifest.json'), 'utf8',
  ));
  const declared = manifest.edgeFunctions.find(({ name }) => name === 'tournament-media-processor');

  // The drift the audit found: the manifest used to describe this health probe
  // as "self-test action plus processor attestation". It is the opposite.
  assert.match(source, /\.rpc\("revoke_tournament_media_service_attestation"/);
  assert.match(source, /p_service:\s*"processor"/);
  assert.doesNotMatch(source, /attest_tournament_media_service/);
  assert.match(source, /attests:\s*false/);
  assert.deepEqual(declared.attests, []);
  assert.deepEqual(declared.revokesOnHealth, ['processor']);
  assert.equal(declared.attestationTtlSeconds, null);
  assert.equal(declared.processorAttestationOwner, 'workers/tournament-media-processor');
  assert.match(declared.healthContract, /REVOKES any stale processor attestation and never writes one/);
});

test('the signer attestation has a scheduled renewer that holds no service credential', async () => {
  const manifest = JSON.parse(await fs.readFile(
    path.join(repoRoot, 'ops', 'torneos-staging', 'manifest.json'), 'utf8',
  ));
  const renewal = manifest.signerAttestationRenewal;
  const config = await fs.readFile(
    path.join(repoRoot, renewal.path, 'src', 'config.mjs'), 'utf8',
  );
  // The renewer talks to the signer with the attestation secret and a public
  // gateway credential. A service credential here would defeat the split.
  assert.doesNotMatch(config, /env\.SUPABASE_SERVICE_ROLE_KEY|env\.SUPABASE_SECRET_KEY/);
  assert.match(config, /RENEWER_GATEWAY_KEY_PRIVILEGED/);
  assert.equal(renewal.holdsServiceCredential, false);
  // Renewal has to happen well inside the TTL the signer writes.
  assert.ok(renewal.intervalSeconds * (1 + renewal.jitterRatio) + renewal.safetyMarginSeconds
    < renewal.attestationTtlSeconds);
});

test('guest invite consumption and player creation use one atomic RPC', async () => {
  const source = await fs.readFile(
    path.join(functionsRoot, 'join-match-guest', 'index.ts'),
    'utf8',
  );

  assert.match(source, /\.rpc\(\s*["']join_guest_match_with_invite["']/);
  assert.doesNotMatch(source, /\.rpc\(\s*["']consume_guest_match_invite["']/);
  assert.doesNotMatch(source, /\.from\(["']jugadores["']\)\s*\.insert\(/);
  assert.match(source, /guest_identity_conflict/);
  assert.match(source, /substitute_order:\s*join\.substitute_order/);
});
