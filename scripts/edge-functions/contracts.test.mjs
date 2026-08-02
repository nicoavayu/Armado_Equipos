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
