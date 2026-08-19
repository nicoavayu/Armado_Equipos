import {
  QA_RETURN_TO_ALLOWLIST,
  clearSessionScopedState,
  isOrganizationScopedPath,
  isQaRoleSwitcherEnabled,
  resolveQaRoleSwitcherGate,
  sanitizeReturnTo,
} from '../qaRoleSwitcher';

const LOCAL_ENV = {
  REACT_APP_TORNEOS_QA_ROLE_SWITCHER: 'true',
  REACT_APP_TORNEOS_DATA_ENV: 'local',
  REACT_APP_DEPLOY_ENV: 'development',
  REACT_APP_SUPABASE_URL: 'http://127.0.0.1:57321',
  NODE_ENV: 'development',
};
const LOCAL_LOCATION = { hostname: '127.0.0.1', origin: 'http://127.0.0.1:3100' };

function memoryStorage(entries = {}) {
  const map = new Map(Object.entries(entries));
  return {
    get length() { return map.size; },
    key: (index) => [...map.keys()][index] ?? null,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key),
    snapshot: () => Object.fromEntries(map),
  };
}

describe('gate LOCAL del selector de rol', () => {
  it('habilita solamente con las cinco condiciones puestas', () => {
    expect(isQaRoleSwitcherEnabled(LOCAL_ENV, LOCAL_LOCATION)).toBe(true);
    expect(isQaRoleSwitcherEnabled(LOCAL_ENV, { hostname: 'localhost' })).toBe(true);
  });

  it('no monta en Production aunque el flag esté en true', () => {
    const gate = resolveQaRoleSwitcherGate({
      ...LOCAL_ENV,
      NODE_ENV: 'production',
      REACT_APP_DEPLOY_ENV: 'production',
      REACT_APP_TORNEOS_DATA_ENV: 'production',
      REACT_APP_SUPABASE_URL: 'https://rcyuuoaqfwcembdajcss.supabase.co',
    }, { hostname: 'app.arma2.com.ar' });
    expect(gate.enabled).toBe(false);
    expect(gate.failures).toEqual(
      expect.arrayContaining(['node-env', 'deploy-env', 'data-env', 'host', 'backend']),
    );
  });

  it('no monta en Staging ni en un preview remoto', () => {
    expect(resolveQaRoleSwitcherGate({
      ...LOCAL_ENV,
      REACT_APP_TORNEOS_DATA_ENV: 'staging',
      REACT_APP_SUPABASE_URL: 'https://hhyvmhgpapyuzjgxfnqv.supabase.co',
    }, LOCAL_LOCATION).failures).toEqual(expect.arrayContaining(['data-env', 'backend']));

    expect(resolveQaRoleSwitcherGate({
      ...LOCAL_ENV,
      REACT_APP_DEPLOY_ENV: 'preview',
    }, { hostname: 'arma2-git-branch.vercel.app' }).enabled).toBe(false);
  });

  it('no monta si el backend Supabase no es loopback', () => {
    for (const url of [
      'https://hhyvmhgpapyuzjgxfnqv.supabase.co',
      'http://192.168.1.20:57321',
      '',
    ]) {
      expect(resolveQaRoleSwitcherGate(
        { ...LOCAL_ENV, REACT_APP_SUPABASE_URL: url },
        LOCAL_LOCATION,
      ).failures).toContain('backend');
    }
  });

  it('no monta en un build normal, donde el flag no existe', () => {
    const { REACT_APP_TORNEOS_QA_ROLE_SWITCHER, ...withoutFlag } = LOCAL_ENV;
    expect(resolveQaRoleSwitcherGate(withoutFlag, LOCAL_LOCATION).failures).toContain('flag');
  });
});

describe('returnTo', () => {
  it('acepta rutas internas de la allowlist', () => {
    expect(sanitizeReturnTo('/torneos/equipos/BNO', { origin: LOCAL_LOCATION.origin }))
      .toBe('/torneos/equipos/BNO');
    expect(sanitizeReturnTo('/torneos?tab=plantel', { origin: LOCAL_LOCATION.origin }))
      .toBe('/torneos?tab=plantel');
    for (const prefix of QA_RETURN_TO_ALLOWLIST) {
      expect(sanitizeReturnTo(prefix, { origin: LOCAL_LOCATION.origin })).toBe(prefix);
    }
  });

  it('rechaza cualquier destino externo o fuera de la allowlist', () => {
    for (const candidate of [
      'https://evil.example/torneos',
      '//evil.example/torneos',
      'http://127.0.0.1:3100/torneos',
      '/\\evil.example',
      'javascript:alert(1)',
      '/admin/42',
      '/qa/rol',
      '/qa/rol?returnTo=/torneos',
      '',
      null,
      `/torneos/${'x'.repeat(600)}`,
    ]) {
      expect(sanitizeReturnTo(candidate, { origin: LOCAL_LOCATION.origin })).toBeNull();
    }
  });

  it('distingue las superficies de organización de las públicas', () => {
    expect(isOrganizationScopedPath('/torneos/equipos/BNO')).toBe(true);
    expect(isOrganizationScopedPath('/torneos')).toBe(false);
    expect(isOrganizationScopedPath('/torneos/publico/qa-metropolitana')).toBe(false);
    expect(isOrganizationScopedPath('/profile')).toBe(false);
  });
});

describe('limpieza de estado al cambiar de usuario', () => {
  it('borra el contexto por identidad y conserva el token nuevo', () => {
    const storage = memoryStorage({
      'sb-127-auth-token': 'sesion-nueva',
      'arma2:torneos:last-workspace:v2': '{"organizationId":"org-1"}',
      'arma2:onboarding:v1:usuario-anterior': '{}',
      'local:dev:profile': '{}',
      'auth:returnTo': '/torneos',
      'hasSeenTutorial': 'true',
      'chat_read_42': '1',
      'team_chat_read_7': '1',
      'invited_groups_9': '[]',
      'activity_insight_weekly_matches_v1': '{}',
      'guest_session_id': 'conservado',
    });

    const removed = clearSessionScopedState(storage, { preserveKeys: ['sb-127-auth-token'] });

    expect(removed).toEqual(expect.arrayContaining([
      'arma2:torneos:last-workspace:v2',
      'arma2:onboarding:v1:usuario-anterior',
      'local:dev:profile',
      'auth:returnTo',
      'hasSeenTutorial',
      'chat_read_42',
      'team_chat_read_7',
      'invited_groups_9',
      'activity_insight_weekly_matches_v1',
    ]));
    expect(storage.snapshot()).toEqual({
      'sb-127-auth-token': 'sesion-nueva',
      'guest_session_id': 'conservado',
    });
  });
});
