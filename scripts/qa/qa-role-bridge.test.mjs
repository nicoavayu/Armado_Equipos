import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import bridge from './qa-role-bridge.cjs';

const {
  MOUNT_PATH,
  QA_ROLES,
  QA_ROLE_CATALOG,
  REQUEST_HEADER,
  assertTrustedRequest,
  createQaRoleBridgeHandler,
  listRoles,
  readStorageState,
  resolveQaRoleBridgeGate,
  storageKeyForSupabaseUrl,
} = bridge;

const LOCAL_ENV = Object.freeze({
  REACT_APP_TORNEOS_QA_ROLE_SWITCHER: 'true',
  REACT_APP_TORNEOS_DATA_ENV: 'local',
  REACT_APP_DEPLOY_ENV: 'development',
  REACT_APP_SUPABASE_URL: 'http://127.0.0.1:57321',
  REACT_APP_SUPABASE_ANON_KEY: 'local-anon-key',
  NODE_ENV: 'development',
  HOST: '127.0.0.1',
  PORT: '3100',
});

const EXPECTED_ORIGIN = 'http://127.0.0.1:3100';

function sessionFor(role, { expiresAt = Math.floor(Date.now() / 1000) + 21_600 } = {}) {
  return {
    access_token: `local-token-${role}`,
    token_type: 'bearer',
    expires_at: expiresAt,
    refresh_token: `qa-local-non-refreshing-${role}`,
    user: { id: `id-${role}`, email: `qa-${role}@localhost.invalid` },
  };
}

function writeStates(directory, { roles = QA_ROLES, mode = 0o600, origin = EXPECTED_ORIGIN } = {}) {
  const target = path.join(directory, '.secrets', 'torneos-review-auth');
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  for (const role of roles) {
    const state = {
      cookies: [],
      origins: [{
        origin,
        localStorage: [{ name: 'sb-127-auth-token', value: JSON.stringify(sessionFor(role)) }],
      }],
    };
    const file = path.join(target, `${role}.json`);
    fs.writeFileSync(file, JSON.stringify(state));
    fs.chmodSync(file, mode);
  }
  return directory;
}

function temporaryRepo() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-role-bridge-'));
  return writeStates(directory);
}

function fakeAuth({ recognized = QA_ROLES } = {}) {
  return async (url, init) => {
    const token = String(init?.headers?.authorization || '');
    const role = token.replace('Bearer local-token-', '');
    if (!String(url).includes('/auth/v1/user')) {
      return { ok: true, status: 200, json: async () => [] };
    }
    if (!recognized.includes(role)) {
      return { ok: false, status: 401, json: async () => ({}) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: `id-${role}`,
        email: `qa-${role}@localhost.invalid`,
        app_metadata: { qa_role: role },
      }),
    };
  };
}

function request({ method = 'POST', url = '/roles', headers = {}, body = '{}' } = {}) {
  const listeners = {};
  return {
    method,
    url,
    socket: { remoteAddress: '127.0.0.1' },
    headers: {
      origin: EXPECTED_ORIGIN,
      [REQUEST_HEADER]: '1',
      ...headers,
    },
    on(event, handler) {
      listeners[event] = handler;
      if (event === 'end') {
        if (body !== null) listeners.data?.(Buffer.from(body));
        handler();
      }
      return this;
    },
    destroy() {},
  };
}

function response() {
  return {
    statusCode: 0,
    headers: {},
    body: null,
    setHeader(key, value) { this.headers[key.toLowerCase()] = value; },
    end(payload) { this.body = payload; },
  };
}

async function invoke(handler, options) {
  const res = response();
  await handler(request(options), res);
  return { status: res.statusCode, payload: JSON.parse(res.body), headers: res.headers };
}

test('el gate LOCAL exige las cinco condiciones y todas fallan cerrado', () => {
  assert.equal(resolveQaRoleBridgeGate(LOCAL_ENV).enabled, true);
  assert.equal(resolveQaRoleBridgeGate(LOCAL_ENV).expectedOrigin, EXPECTED_ORIGIN);

  const cases = [
    [{ REACT_APP_TORNEOS_QA_ROLE_SWITCHER: 'false' }, /QA_ROLE_SWITCHER/],
    [{ REACT_APP_TORNEOS_QA_ROLE_SWITCHER: '' }, /QA_ROLE_SWITCHER/],
    [{ REACT_APP_TORNEOS_DATA_ENV: 'staging' }, /DATA_ENV/],
    [{ NODE_ENV: 'production' }, /NODE_ENV/],
    [{ REACT_APP_DEPLOY_ENV: 'production' }, /DEPLOY_ENV/],
    [{ REACT_APP_DEPLOY_ENV: 'preview' }, /DEPLOY_ENV/],
    [{ HOST: '0.0.0.0' }, /HOST/],
    [{ REACT_APP_SUPABASE_ANON_KEY: '' }, /anon key/],
  ];
  for (const [override, pattern] of cases) {
    const gate = resolveQaRoleBridgeGate({ ...LOCAL_ENV, ...override });
    assert.equal(gate.enabled, false, JSON.stringify(override));
    assert.match(gate.failures.join(' | '), pattern);
  }
});

test('Production y Staging no montan el puente ni con el flag puesto', () => {
  const production = resolveQaRoleBridgeGate({
    ...LOCAL_ENV,
    NODE_ENV: 'production',
    REACT_APP_DEPLOY_ENV: 'production',
    REACT_APP_TORNEOS_DATA_ENV: 'production',
    REACT_APP_SUPABASE_URL: 'https://rcyuuoaqfwcembdajcss.supabase.co',
  });
  assert.equal(production.enabled, false);

  const staging = resolveQaRoleBridgeGate({
    ...LOCAL_ENV,
    REACT_APP_TORNEOS_DATA_ENV: 'staging',
    REACT_APP_SUPABASE_URL: 'https://hhyvmhgpapyuzjgxfnqv.supabase.co',
    REACT_APP_TORNEOS_STAGING_PROJECT_REF: 'hhyvmhgpapyuzjgxfnqv',
  });
  assert.equal(staging.enabled, false);
  assert.match(staging.failures.join(' | '), /loopback|remoto/);

  const noMount = { used: false };
  const app = { use() { noMount.used = true; } };
  bridge.mountQaRoleBridge(app, { repoRoot: '/nowhere', env: { ...LOCAL_ENV, NODE_ENV: 'production' } });
  assert.equal(noMount.used, false);
});

test('un backend que no es loopback deja el puente sin montar', () => {
  for (const url of [
    'https://hhyvmhgpapyuzjgxfnqv.supabase.co',
    'http://10.0.0.5:57321',
    'https://app.arma2.com.ar',
    'not-a-url',
  ]) {
    const gate = resolveQaRoleBridgeGate({ ...LOCAL_ENV, REACT_APP_SUPABASE_URL: url });
    assert.equal(gate.enabled, false, url);
  }
  const mounted = [];
  bridge.mountQaRoleBridge({ use: (...args) => mounted.push(args) }, {
    repoRoot: '/nowhere',
    env: { ...LOCAL_ENV, REACT_APP_SUPABASE_URL: 'https://hhyvmhgpapyuzjgxfnqv.supabase.co' },
  });
  assert.deepEqual(mounted, []);
});

test('la clave de sesión se deriva igual que en supabase-js', () => {
  assert.equal(storageKeyForSupabaseUrl('http://127.0.0.1:57321'), 'sb-127-auth-token');
});

test('un rol desconocido es rechazado sin tocar el disco', async () => {
  const repoRoot = temporaryRepo();
  const gate = resolveQaRoleBridgeGate(LOCAL_ENV);
  const handler = createQaRoleBridgeHandler({
    repoRoot, env: LOCAL_ENV, gate, fetchImpl: fakeAuth(),
  });

  for (const role of ['root', '', 'OWNER', '../../etc/passwd', 'owner.json', null]) {
    const result = await invoke(handler, {
      url: '/session',
      body: JSON.stringify({ role }),
    });
    assert.equal(result.status, 400, JSON.stringify(role));
    assert.match(result.payload.error, /Rol QA desconocido/);
  }
});

test('el rol nunca se convierte en un path arbitrario', () => {
  const repoRoot = temporaryRepo();
  const gate = resolveQaRoleBridgeGate(LOCAL_ENV);
  const outside = path.join(repoRoot, 'leak.json');
  fs.writeFileSync(outside, JSON.stringify({ origins: [] }), { mode: 0o600 });
  assert.throws(
    () => readStorageState(repoRoot, '../leak', gate),
    /Rol QA desconocido/,
  );
  assert.throws(
    () => readStorageState(repoRoot, path.join('..', '..', 'etc', 'passwd'), gate),
    /Rol QA desconocido/,
  );
});

test('el puente exige POST, origen exacto, header propio y socket de loopback', () => {
  const gate = resolveQaRoleBridgeGate(LOCAL_ENV);
  assert.equal(assertTrustedRequest(request(), gate), true);

  const rejections = [
    [{ method: 'GET' }, /Método/],
    [{ headers: { origin: 'http://evil.example' } }, /Origen no permitido/],
    [{ headers: { origin: 'http://localhost:3100' } }, /Origen no permitido/],
    [{ headers: { origin: undefined } }, /Origen no permitido/],
    [{ headers: { [REQUEST_HEADER]: undefined } }, /marca del selector/],
    [{ headers: { [REQUEST_HEADER]: '0' } }, /marca del selector/],
  ];
  for (const [override, pattern] of rejections) {
    assert.throws(() => assertTrustedRequest(request(override), gate), pattern);
  }

  const remote = request();
  remote.socket.remoteAddress = '10.0.0.9';
  assert.throws(() => assertTrustedRequest(remote, gate), /Origen de red/);
});

test('el puente no emite cabeceras CORS en ninguna respuesta', async () => {
  const repoRoot = temporaryRepo();
  const handler = createQaRoleBridgeHandler({
    repoRoot, env: LOCAL_ENV, gate: resolveQaRoleBridgeGate(LOCAL_ENV), fetchImpl: fakeAuth(),
  });
  for (const url of ['/roles', '/session']) {
    const result = await invoke(handler, { url, body: JSON.stringify({ role: 'owner' }) });
    const names = Object.keys(result.headers).join(' ');
    assert.equal(/access-control-allow/i.test(names), false);
    assert.equal(result.headers['cache-control'], 'no-store');
  }
});

test('el catálogo publica los seis roles sin tokens ni paths', async () => {
  const repoRoot = temporaryRepo();
  const gate = resolveQaRoleBridgeGate(LOCAL_ENV);
  const roles = await listRoles({
    repoRoot, gate, anonKey: 'local-anon-key', fetchImpl: fakeAuth(),
  });
  assert.deepEqual(roles.map((entry) => entry.role), QA_ROLES);
  assert.equal(roles.every((entry) => entry.available), true);
  const serialized = JSON.stringify(roles);
  assert.equal(serialized.includes('local-token-'), false);
  assert.equal(serialized.includes('.secrets'), false);
  assert.equal(serialized.includes(repoRoot), false);
  assert.equal(QA_ROLE_CATALOG.length, 6);
});

test('una sesión que Auth LOCAL no reconoce no se entrega', async () => {
  const repoRoot = temporaryRepo();
  const gate = resolveQaRoleBridgeGate(LOCAL_ENV);
  const handler = createQaRoleBridgeHandler({
    repoRoot,
    env: LOCAL_ENV,
    gate,
    fetchImpl: fakeAuth({ recognized: ['owner'] }),
  });

  const accepted = await invoke(handler, { url: '/session', body: JSON.stringify({ role: 'owner' }) });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.payload.role, 'owner');
  assert.equal(accepted.payload.identity.qaRole, 'owner');
  assert.equal(accepted.payload.session.access_token, 'local-token-owner');

  const rejected = await invoke(handler, { url: '/session', body: JSON.stringify({ role: 'admin' }) });
  assert.equal(rejected.status, 409);
  assert.equal(rejected.payload.session, undefined);
  assert.equal(JSON.stringify(rejected.payload).includes('local-token'), false);
});

test('permisos laxos, origen ajeno o archivo faltante fallan cerrado', () => {
  const gate = resolveQaRoleBridgeGate(LOCAL_ENV);

  const laxo = writeStates(fs.mkdtempSync(path.join(os.tmpdir(), 'qa-lax-')), { mode: 0o644 });
  assert.throws(() => readStorageState(laxo, 'owner', gate), /permisos 0600/);

  const ajeno = writeStates(fs.mkdtempSync(path.join(os.tmpdir(), 'qa-origin-')), {
    origin: 'http://127.0.0.1:3000',
  });
  assert.throws(() => readStorageState(ajeno, 'owner', gate), /no fue emitida para este origen/);

  const parcial = writeStates(fs.mkdtempSync(path.join(os.tmpdir(), 'qa-partial-')), {
    roles: ['owner'],
  });
  assert.throws(() => readStorageState(parcial, 'admin', gate), /no está preparada/);
});

test('los mensajes de error nunca llevan rutas del disco', async () => {
  const repoRoot = writeStates(fs.mkdtempSync(path.join(os.tmpdir(), 'qa-empty-')), { roles: [] });
  const gate = resolveQaRoleBridgeGate(LOCAL_ENV);
  const handler = createQaRoleBridgeHandler({
    repoRoot, env: LOCAL_ENV, gate, fetchImpl: fakeAuth(),
  });
  const result = await invoke(handler, { url: '/session', body: JSON.stringify({ role: 'owner' }) });
  assert.equal(result.status, 409);
  assert.equal(result.payload.error.includes(repoRoot), false);
  assert.equal(result.payload.error.includes('.secrets'), false);
});

test('el punto de montaje es fijo y no depende del request', () => {
  assert.equal(MOUNT_PATH, '/__qa/role-switcher');
  const mounted = [];
  const gate = bridge.mountQaRoleBridge({ use: (...args) => mounted.push(args) }, {
    repoRoot: temporaryRepo(), env: LOCAL_ENV, fetchImpl: fakeAuth(),
  });
  assert.equal(gate.enabled, true);
  assert.equal(mounted.length, 1);
  assert.equal(mounted[0][0], MOUNT_PATH);
});
