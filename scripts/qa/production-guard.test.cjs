const assert = require('node:assert/strict');
const test = require('node:test');

const {
  ALLOWED_QA_PROJECT_REF,
  PRODUCTION_PROJECT_REF,
  ProductionGuardError,
  assertLocalAppTarget,
  assertLocalDatabaseTarget,
  assertRemoteApplyDisabled,
  assertRemotePlanTarget,
  assertSafeQaEnvironment,
  assertSafeQaValue,
} = require('./production-guard');

test('allows loopback and only the exact authorized QA project', () => {
  assert.doesNotThrow(() => assertSafeQaValue('http://127.0.0.1:57321'));
  assert.doesNotThrow(() => assertSafeQaValue(
    `https://${ALLOWED_QA_PROJECT_REF}.supabase.co`,
  ));
  assert.throws(
    () => assertSafeQaValue('https://unknownprojectrefxxx.supabase.co'),
    /not the authorized QA ref/,
  );
});

test('rejects protected hosts, Production ref, and Production environments', () => {
  assert.throws(
    () => assertSafeQaValue('https://app.arma2.com.ar/torneos'),
    ProductionGuardError,
  );
  assert.throws(
    () => assertSafeQaValue(`https://${PRODUCTION_PROJECT_REF}.supabase.co`),
    /Production/,
  );
  assert.throws(
    () => assertSafeQaEnvironment({ VERCEL_ENV: 'production' }),
    /Production execution is forbidden/,
  );
});

test('local target rejects missing, remote, and ambiguous credentials', () => {
  assert.throws(() => assertLocalDatabaseTarget({}), /QA_SEED_ENV/);
  assert.throws(() => assertLocalDatabaseTarget({
    QA_SEED_ENV: 'local',
    QA_SEED_PROJECT_REF: 'local',
  }), /required and has no fallback/);
  assert.throws(() => assertLocalDatabaseTarget({
    QA_SEED_ENV: 'local',
    QA_SEED_PROJECT_REF: 'local',
    QA_SEED_DATABASE_URL: 'postgresql://postgres:test@example.com/postgres',
  }), /loopback/);
  assert.throws(() => assertLocalDatabaseTarget({
    QA_SEED_ENV: 'local',
    QA_SEED_PROJECT_REF: 'local',
    QA_SEED_DATABASE_URL: 'postgresql://postgres:test@127.0.0.1:57322/postgres',
    DATABASE_URL: 'postgresql://postgres:other@127.0.0.1:57322/postgres',
  }), /ambiguous/);
});

test('remote plan requires exact non-ambiguous variables and never applies', () => {
  assert.throws(() => assertRemotePlanTarget({}), /required and has no fallback/);
  assert.deepEqual(assertRemotePlanTarget({
    QA_SEED_PROJECT_REF: ALLOWED_QA_PROJECT_REF,
    QA_SEED_SUPABASE_URL: `https://${ALLOWED_QA_PROJECT_REF}.supabase.co`,
    QA_SEED_ENV: 'staging',
  }), {
    mode: 'remote-plan-only',
    projectRef: ALLOWED_QA_PROJECT_REF,
    apiUrl: `https://${ALLOWED_QA_PROJECT_REF}.supabase.co`,
  });
  assert.throws(() => assertRemoteApplyDisabled(), /intentionally disabled/);
});

// El arranque de una sesión de QA LOCAL. El caso que motiva estas pruebas es el
// real: `.env.local` apunta a un Supabase remoto y CRA lo lee salvo que alguien
// pise la variable. Sin destino explícito no puede haber arranque.
const localAnonKey = (claims) => {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(claims)}.firma`;
};

test('local app target refuses to start without an explicit loopback destination', () => {
  assert.throws(() => assertLocalAppTarget({}), /QA_SUPABASE_URL/);
  assert.throws(() => assertLocalAppTarget({
    QA_SUPABASE_URL: 'http://127.0.0.1:57321',
  }), /QA_SUPABASE_ANON_KEY/);
});

test('local app target rejects every route back to a hosted project', () => {
  const anonKey = localAnonKey({ role: 'anon', iss: 'supabase-demo' });
  // La URL remota autorizada de QA sigue siendo remota: no sirve para LOCAL.
  assert.throws(() => assertLocalAppTarget({
    QA_SUPABASE_URL: `https://${ALLOWED_QA_PROJECT_REF}.supabase.co`,
    QA_SUPABASE_ANON_KEY: anonKey,
  }), /loopback|http:\/\//);
  // Production nunca llega siquiera a evaluarse como destino.
  assert.throws(() => assertLocalAppTarget({
    QA_SUPABASE_URL: `https://${PRODUCTION_PROJECT_REF}.supabase.co`,
    QA_SUPABASE_ANON_KEY: anonKey,
  }), /Production/);
  // Y una anon key de un proyecto hospedado delata el destino real aunque la
  // URL diga loopback.
  assert.throws(() => assertLocalAppTarget({
    QA_SUPABASE_URL: 'http://127.0.0.1:57321',
    QA_SUPABASE_ANON_KEY: localAnonKey({ role: 'anon', ref: PRODUCTION_PROJECT_REF }),
  }), /belongs to the hosted project/);
});

test('local app target accepts the loopback destination and returns it resolved', () => {
  const anonKey = localAnonKey({ role: 'anon', iss: 'supabase-demo' });
  assert.deepEqual(assertLocalAppTarget({
    QA_SUPABASE_URL: 'http://127.0.0.1:57321/',
    QA_SUPABASE_ANON_KEY: anonKey,
  }), {
    mode: 'local-app',
    supabaseUrl: 'http://127.0.0.1:57321',
    anonKey,
  });
});
