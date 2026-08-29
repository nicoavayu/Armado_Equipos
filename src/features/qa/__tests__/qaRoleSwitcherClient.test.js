import {
  resolveCurrentIdentity,
  resolveReturnTarget,
  switchQaRole,
} from '../qaRoleSwitcherClient';

const SUPABASE_URL = 'http://127.0.0.1:57321';
const ANON_KEY = 'local-anon-key';
const STORAGE_KEY = 'sb-127-auth-token';

const IDENTITIES = {
  owner: { id: 'uid-owner', email: 'qa-owner@localhost.invalid', linked: true },
  delegate: { id: 'uid-delegate', email: 'qa-delegate@localhost.invalid', linked: true },
  outsider: { id: 'uid-outsider', email: 'qa-outsider@localhost.invalid', linked: false },
};

function memoryStorage(entries = {}) {
  const map = new Map(Object.entries(entries));
  return {
    get length() { return map.size; },
    key: (index) => [...map.keys()][index] ?? null,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key),
    clear: () => map.clear(),
    snapshot: () => Object.fromEntries(map),
  };
}

function sessionFor(role) {
  return {
    access_token: `token-${role}`,
    expires_at: Math.floor(Date.now() / 1000) + 21_600,
    refresh_token: `qa-local-non-refreshing-${role}`,
    user: { id: IDENTITIES[role].id },
  };
}

function fakeNetwork({ calls = [] } = {}) {
  return async (url, init = {}) => {
    const target = String(url);
    calls.push({ url: target, method: init.method || 'GET' });

    if (target.endsWith('/__qa/role-switcher/session')) {
      const role = JSON.parse(init.body).role;
      if (!IDENTITIES[role]) {
        return { ok: false, status: 400, json: async () => ({ error: 'Rol QA desconocido.' }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ role, storageKey: STORAGE_KEY, session: sessionFor(role) }),
      };
    }

    if (target.includes('/auth/v1/user')) {
      const role = String(init.headers.authorization).replace('Bearer token-', '');
      const identity = IDENTITIES[role];
      if (!identity) return { ok: false, status: 401, json: async () => ({}) };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: identity.id,
          email: identity.email,
          app_metadata: { qa_role: role },
        }),
      };
    }

    if (target.includes('/rest/v1/')) {
      const role = String(init.headers.authorization).replace('Bearer token-', '');
      const linked = IDENTITIES[role]?.linked;
      return { ok: true, status: 200, json: async () => (linked ? [{ user_id: role }] : []) };
    }

    return { ok: false, status: 404, json: async () => ({}) };
  };
}

describe('rol actual', () => {
  it('sale de la identidad que Auth local reconoce, no de una marca en localStorage', async () => {
    const storage = memoryStorage({
      [STORAGE_KEY]: JSON.stringify(sessionFor('owner')),
      qaRole: 'admin',
    });
    const identity = await resolveCurrentIdentity({
      supabaseUrl: SUPABASE_URL,
      anonKey: ANON_KEY,
      storage,
      storageKey: STORAGE_KEY,
      fetchImpl: fakeNetwork(),
    });
    expect(identity).toEqual({
      id: 'uid-owner',
      email: 'qa-owner@localhost.invalid',
      qaRole: 'owner',
    });
  });

  it('sin sesión reconocida devuelve null', async () => {
    const identity = await resolveCurrentIdentity({
      supabaseUrl: SUPABASE_URL,
      anonKey: ANON_KEY,
      storage: memoryStorage({ [STORAGE_KEY]: JSON.stringify({ access_token: 'token-fantasma' }) }),
      storageKey: STORAGE_KEY,
      fetchImpl: fakeNetwork(),
    });
    expect(identity).toBeNull();
  });
});

describe('cambio de rol en un clic', () => {
  it('instala la sesión, cambia el usuario autenticado y limpia el contexto anterior', async () => {
    const storage = memoryStorage({
      [STORAGE_KEY]: JSON.stringify(sessionFor('owner')),
      'arma2:torneos:last-workspace:v2': '{"organizationId":"org-owner"}',
    });
    const viewStorage = memoryStorage({ 'quiero-jugar-tab': 'equipos' });

    const before = await resolveCurrentIdentity({
      supabaseUrl: SUPABASE_URL, anonKey: ANON_KEY, storage, storageKey: STORAGE_KEY,
      fetchImpl: fakeNetwork(),
    });

    const result = await switchQaRole({
      role: 'delegate',
      supabaseUrl: SUPABASE_URL,
      anonKey: ANON_KEY,
      storage,
      sessionStorage: viewStorage,
      returnTo: '/torneos/equipos/BNO',
      fetchImpl: fakeNetwork(),
    });

    const after = await resolveCurrentIdentity({
      supabaseUrl: SUPABASE_URL, anonKey: ANON_KEY, storage, storageKey: STORAGE_KEY,
      fetchImpl: fakeNetwork(),
    });

    expect(before.id).toBe('uid-owner');
    expect(after.id).toBe('uid-delegate');
    expect(after.qaRole).toBe('delegate');
    expect(result.path).toBe('/torneos/equipos/BNO');
    expect(result.fellBack).toBe(false);
    expect(storage.snapshot()['arma2:torneos:last-workspace:v2']).toBeUndefined();
    expect(viewStorage.snapshot()).toEqual({});
  });

  it('un rol desconocido no llega a tocar la sesión guardada', async () => {
    const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify(sessionFor('owner')) });
    await expect(switchQaRole({
      role: 'root',
      supabaseUrl: SUPABASE_URL,
      anonKey: ANON_KEY,
      storage,
      returnTo: null,
      fetchImpl: fakeNetwork(),
    })).rejects.toThrow(/Rol QA desconocido/);
    expect(JSON.parse(storage.getItem(STORAGE_KEY)).access_token).toBe('token-owner');
  });
});

describe('returnTo cuando el rol nuevo no tiene acceso', () => {
  it('vuelve a la pantalla si la identidad nueva tiene vínculo', async () => {
    const target = await resolveReturnTarget({
      supabaseUrl: SUPABASE_URL,
      anonKey: ANON_KEY,
      accessToken: 'token-delegate',
      userId: 'uid-delegate',
      returnTo: '/torneos/equipos/BNO',
      fetchImpl: fakeNetwork(),
    });
    expect(target).toEqual({ path: '/torneos/equipos/BNO', fellBack: false });
  });

  it('cae en una superficie segura, sin pantalla rota ni loop', async () => {
    const target = await resolveReturnTarget({
      supabaseUrl: SUPABASE_URL,
      anonKey: ANON_KEY,
      accessToken: 'token-outsider',
      userId: 'uid-outsider',
      returnTo: '/torneos/equipos/BNO',
      fetchImpl: fakeNetwork(),
    });
    expect(target).toEqual({ path: '/torneos', fellBack: true });
  });

  it('sin returnTo entra por la superficie segura', async () => {
    const target = await resolveReturnTarget({
      supabaseUrl: SUPABASE_URL,
      anonKey: ANON_KEY,
      accessToken: 'token-owner',
      userId: 'uid-owner',
      returnTo: null,
      fetchImpl: fakeNetwork(),
    });
    expect(target).toEqual({ path: '/torneos', fellBack: false });
  });

  it('no consulta la organización para una superficie pública', async () => {
    const calls = [];
    const target = await resolveReturnTarget({
      supabaseUrl: SUPABASE_URL,
      anonKey: ANON_KEY,
      accessToken: 'token-outsider',
      userId: 'uid-outsider',
      returnTo: '/torneos/publico/qa-metropolitana',
      fetchImpl: fakeNetwork({ calls }),
    });
    expect(target.path).toBe('/torneos/publico/qa-metropolitana');
    expect(calls.filter((call) => call.url.includes('/rest/v1/'))).toEqual([]);
  });
});

describe('el token nunca se expone', () => {
  it('no viaja por la URL ni queda en el resultado del cambio', async () => {
    const calls = [];
    const storage = memoryStorage();
    const result = await switchQaRole({
      role: 'owner',
      supabaseUrl: SUPABASE_URL,
      anonKey: ANON_KEY,
      storage,
      returnTo: '/torneos',
      fetchImpl: fakeNetwork({ calls }),
    });
    expect(JSON.stringify(result).includes('token-owner')).toBe(false);
    expect(calls.every((call) => !call.url.includes('token-'))).toBe(true);
    expect(JSON.parse(storage.getItem(STORAGE_KEY)).access_token).toBe('token-owner');
  });
});
