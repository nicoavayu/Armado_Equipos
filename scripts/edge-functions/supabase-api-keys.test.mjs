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
  createSupabaseCredentialFetch,
  getSupabasePublishableCredential,
  getSupabaseSecretCredential,
} = helperModule;

const envReader = (values) => (name) => values[name];

test('prefers the named publishable key over the legacy anon key', () => {
  assert.deepEqual(
    getSupabasePublishableCredential(envReader({
      SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({
        default: 'sb_publishable_named_test',
      }),
      SUPABASE_ANON_KEY: 'anon-legacy',
    })),
    {
      key: 'sb_publishable_named_test',
      source: 'named',
      kind: 'publishable',
    },
  );
});

test('prefers the named secret key over the legacy service role key', () => {
  assert.deepEqual(
    getSupabaseSecretCredential(envReader({
      SUPABASE_SECRET_KEYS: JSON.stringify({
        default: 'sb_secret_named_test',
      }),
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-legacy',
    })),
    {
      key: 'sb_secret_named_test',
      source: 'named',
      kind: 'secret',
    },
  );
});

test('falls back to legacy keys only when the new variables are absent', () => {
  assert.deepEqual(
    getSupabasePublishableCredential(envReader({
      SUPABASE_ANON_KEY: 'anon-legacy',
    })),
    { key: 'anon-legacy', source: 'legacy', kind: 'publishable' },
  );
  assert.deepEqual(
    getSupabaseSecretCredential(envReader({
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-legacy',
    })),
    { key: 'service-role-legacy', source: 'legacy', kind: 'secret' },
  );
});

test('rejects invalid JSON without falling back', () => {
  assert.throws(
    () => getSupabaseSecretCredential(envReader({
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
    JSON.stringify({ default: 'service-role-legacy.jwt' }),
  ]) {
    assert.throws(
      () => getSupabasePublishableCredential(envReader({
        SUPABASE_PUBLISHABLE_KEYS: value,
        SUPABASE_ANON_KEY: 'must-not-be-used',
      })),
      { message: 'supabase_publishable_key_misconfigured' },
    );
  }
});

test('rejects missing keys with a sanitized error', () => {
  assert.throws(
    () => getSupabasePublishableCredential(envReader({})),
    { message: 'supabase_publishable_key_misconfigured' },
  );
  assert.throws(
    () => getSupabaseSecretCredential(envReader({})),
    { message: 'supabase_secret_key_misconfigured' },
  );
});

test('sends a named secret only through apikey', async () => {
  let capturedInit;
  const credential = getSupabaseSecretCredential(envReader({
    SUPABASE_SECRET_KEYS: JSON.stringify({
      default: 'sb_secret_named_test',
    }),
  }));
  const wrappedFetch = createSupabaseCredentialFetch(
    credential,
    async (_input, init) => {
      capturedInit = init;
      return new Response(null, { status: 204 });
    },
  );

  await wrappedFetch('https://example.test', {
    headers: {
      Authorization: 'Bearer sb_secret_named_test',
      'x-extra': 'preserved',
    },
  });

  assert.equal(capturedInit.headers.get('apikey'), 'sb_secret_named_test');
  assert.equal(capturedInit.headers.get('Authorization'), null);
  assert.equal(capturedInit.headers.get('x-extra'), 'preserved');
});

test('preserves a legacy service role bearer', async () => {
  let capturedInit;
  const credential = getSupabaseSecretCredential(envReader({
    SUPABASE_SERVICE_ROLE_KEY: 'legacy.service.role.jwt',
  }));
  const wrappedFetch = createSupabaseCredentialFetch(
    credential,
    async (_input, init) => {
      capturedInit = init;
      return new Response(null, { status: 204 });
    },
  );

  await wrappedFetch('https://example.test', {
    headers: { Authorization: 'Bearer legacy.service.role.jwt' },
  });

  assert.equal(capturedInit.headers.get('apikey'), 'legacy.service.role.jwt');
  assert.equal(
    capturedInit.headers.get('Authorization'),
    'Bearer legacy.service.role.jwt',
  );
});

test('adds a missing legacy service role bearer', async () => {
  let capturedInit;
  const credential = getSupabaseSecretCredential(envReader({
    SUPABASE_SERVICE_ROLE_KEY: 'legacy.service.role.jwt',
  }));
  const wrappedFetch = createSupabaseCredentialFetch(
    credential,
    async (_input, init) => {
      capturedInit = init;
      return new Response(null, { status: 204 });
    },
  );

  await wrappedFetch('https://example.test');

  assert.equal(capturedInit.headers.get('apikey'), 'legacy.service.role.jwt');
  assert.equal(
    capturedInit.headers.get('Authorization'),
    'Bearer legacy.service.role.jwt',
  );
});

test('preserves a user JWT while adding a named publishable key', async () => {
  let capturedInit;
  const credential = getSupabasePublishableCredential(envReader({
    SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({
      default: 'sb_publishable_named_test',
    }),
  }));
  const wrappedFetch = createSupabaseCredentialFetch(
    credential,
    async (_input, init) => {
      capturedInit = init;
      return new Response(null, { status: 204 });
    },
  );

  await wrappedFetch('https://example.test', {
    headers: { Authorization: 'Bearer user.jwt.token' },
  });

  assert.equal(capturedInit.headers.get('apikey'), 'sb_publishable_named_test');
  assert.equal(
    capturedInit.headers.get('Authorization'),
    'Bearer user.jwt.token',
  );
});

test('sends a named publishable key without an API-key bearer', async () => {
  let capturedInit;
  const credential = getSupabasePublishableCredential(envReader({
    SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({
      default: 'sb_publishable_named_test',
    }),
  }));
  const wrappedFetch = createSupabaseCredentialFetch(
    credential,
    async (_input, init) => {
      capturedInit = init;
      return new Response(null, { status: 204 });
    },
  );

  await wrappedFetch('https://example.test', {
    headers: { Authorization: 'Bearer sb_publishable_named_test' },
  });

  assert.equal(capturedInit.headers.get('apikey'), 'sb_publishable_named_test');
  assert.equal(capturedInit.headers.get('Authorization'), null);
});

test('legacy anon keeps its bearer without gaining secret privileges', async () => {
  let capturedInit;
  const credential = getSupabasePublishableCredential(envReader({
    SUPABASE_ANON_KEY: 'legacy.anon.jwt',
  }));
  const wrappedFetch = createSupabaseCredentialFetch(
    credential,
    async (_input, init) => {
      capturedInit = init;
      return new Response(null, { status: 204 });
    },
  );

  await wrappedFetch('https://example.test');

  assert.equal(credential.kind, 'publishable');
  assert.equal(credential.source, 'legacy');
  assert.equal(capturedInit.headers.get('apikey'), 'legacy.anon.jwt');
  assert.equal(
    capturedInit.headers.get('Authorization'),
    'Bearer legacy.anon.jwt',
  );
});

test('never logs credentials or headers', async () => {
  const sensitiveValues = [
    'sb_secret_must_not_be_logged',
    'legacy.must.not.be.logged',
  ];
  const capturedLogs = [];
  const originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
  };

  console.log = (...args) => capturedLogs.push(args.join(' '));
  console.warn = (...args) => capturedLogs.push(args.join(' '));
  console.error = (...args) => capturedLogs.push(args.join(' '));

  try {
    const named = getSupabaseSecretCredential(envReader({
      SUPABASE_SECRET_KEYS: JSON.stringify({ default: sensitiveValues[0] }),
    }));
    const legacy = getSupabaseSecretCredential(envReader({
      SUPABASE_SERVICE_ROLE_KEY: sensitiveValues[1],
    }));
    await createSupabaseCredentialFetch(
      named,
      async () => new Response(null, { status: 204 }),
    )('https://example.test');
    await createSupabaseCredentialFetch(
      legacy,
      async () => new Response(null, { status: 204 }),
    )('https://example.test');
    assert.throws(
      () => getSupabaseSecretCredential(envReader({
        SUPABASE_SECRET_KEYS: '{invalid',
        SUPABASE_SERVICE_ROLE_KEY: sensitiveValues[1],
      })),
      { message: 'supabase_secret_key_misconfigured' },
    );
  } finally {
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
  }

  assert.deepEqual(capturedLogs, []);
  for (const value of sensitiveValues) {
    assert.equal(capturedLogs.join('\n').includes(value), false);
  }
});
