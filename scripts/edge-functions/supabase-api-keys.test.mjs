import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const helperUrl = new URL(
  '../../supabase/functions/_shared/supabaseApiKeys.ts',
  import.meta.url,
);
const helperSource = await fs.readFile(helperUrl, 'utf8');
const compiledHelper = ts.transpileModule(helperSource, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const helperModule = await import(
  `data:text/javascript;base64,${Buffer.from(compiledHelper).toString('base64')}`
);

const {
  createSupabaseApiKeyOnlyFetch,
  getSupabasePublishableKey,
  getSupabaseSecretKey,
} = helperModule;

const envReader = (values) => (name) => values[name];

test('prefers the named publishable key over the legacy anon key', () => {
  assert.equal(
    getSupabasePublishableKey(envReader({
      SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: 'publishable-new' }),
      SUPABASE_ANON_KEY: 'anon-legacy',
    })),
    'publishable-new',
  );
});

test('prefers the named secret key over the legacy service role key', () => {
  assert.equal(
    getSupabaseSecretKey(envReader({
      SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'secret-new' }),
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-legacy',
    })),
    'secret-new',
  );
});

test('falls back to legacy keys only when the new variables are absent', () => {
  assert.equal(
    getSupabasePublishableKey(envReader({ SUPABASE_ANON_KEY: 'anon-legacy' })),
    'anon-legacy',
  );
  assert.equal(
    getSupabaseSecretKey(envReader({
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-legacy',
    })),
    'service-role-legacy',
  );
});

test('rejects invalid JSON without falling back', () => {
  assert.throws(
    () => getSupabaseSecretKey(envReader({
      SUPABASE_SECRET_KEYS: '{invalid',
      SUPABASE_SERVICE_ROLE_KEY: 'must-not-be-used',
    })),
    { message: 'supabase_secret_key_misconfigured' },
  );
});

test('rejects a missing, empty, or contradictory default entry', () => {
  for (const value of [
    JSON.stringify({ other: 'key' }),
    JSON.stringify({ default: '  ' }),
    JSON.stringify(['default', 'key']),
    JSON.stringify('key'),
  ]) {
    assert.throws(
      () => getSupabasePublishableKey(envReader({
        SUPABASE_PUBLISHABLE_KEYS: value,
        SUPABASE_ANON_KEY: 'must-not-be-used',
      })),
      { message: 'supabase_publishable_key_misconfigured' },
    );
  }
});

test('rejects missing keys with a sanitized error', () => {
  assert.throws(
    () => getSupabasePublishableKey(envReader({})),
    { message: 'supabase_publishable_key_misconfigured' },
  );
  assert.throws(
    () => getSupabaseSecretKey(envReader({})),
    { message: 'supabase_secret_key_misconfigured' },
  );
});

test('sends an API key only through apikey', async () => {
  let capturedInit;
  const wrappedFetch = createSupabaseApiKeyOnlyFetch(
    'secret-new',
    async (_input, init) => {
      capturedInit = init;
      return new Response(null, { status: 204 });
    },
  );

  await wrappedFetch('https://example.test', {
    headers: {
      Authorization: 'Bearer secret-new',
      'x-extra': 'preserved',
    },
  });

  assert.equal(capturedInit.headers.get('apikey'), 'secret-new');
  assert.equal(capturedInit.headers.get('Authorization'), null);
  assert.equal(capturedInit.headers.get('x-extra'), 'preserved');
});

test('preserves a user JWT while adding the API key', async () => {
  let capturedInit;
  const wrappedFetch = createSupabaseApiKeyOnlyFetch(
    'publishable-new',
    async (_input, init) => {
      capturedInit = init;
      return new Response(null, { status: 204 });
    },
  );

  await wrappedFetch('https://example.test', {
    headers: { Authorization: 'Bearer user.jwt.token' },
  });

  assert.equal(capturedInit.headers.get('apikey'), 'publishable-new');
  assert.equal(
    capturedInit.headers.get('Authorization'),
    'Bearer user.jwt.token',
  );
});
