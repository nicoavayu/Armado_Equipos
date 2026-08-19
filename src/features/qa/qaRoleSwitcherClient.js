//
// Lado navegador del cambio de rol. Un clic hace exactamente cinco cosas, en
// este orden: pedir la sesión al puente, comprobarla contra Auth LOCAL, limpiar
// el estado que caduca con el usuario, escribir la sesión nueva y recargar.
//
// El access token pasa por acá y no sale a ningún otro lado: no se imprime, no
// se loguea, no se guarda en el estado de React y no viaja por la URL.
//
import {
  QA_ROLE_BRIDGE_HEADER,
  QA_ROLE_BRIDGE_PATH,
  QA_SAFE_FALLBACK_PATH,
  clearSessionScopedState,
  isOrganizationScopedPath,
} from './qaRoleSwitcher';

async function callBridge(route, body, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(`${QA_ROLE_BRIDGE_PATH}${route}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [QA_ROLE_BRIDGE_HEADER]: '1',
    },
    body: JSON.stringify(body || {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || `El puente QA respondió ${response.status}.`);
  }
  return payload;
}

export function fetchQaRoles(options) {
  return callBridge('/roles', {}, options);
}

export function fetchQaSession(role, options) {
  return callBridge('/session', { role }, options);
}

function readStoredAccessToken(storage, storageKey) {
  try {
    const raw = storage?.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.access_token || null;
  } catch {
    return null;
  }
}

/**
 * La verdad sobre "quién soy" no es `localStorage`: es lo que Auth LOCAL
 * reconoce para el token que hay guardado. Si el token está vencido o es de
 * otro stack, esto devuelve null y la pantalla lo dice.
 */
export async function resolveCurrentIdentity({
  supabaseUrl,
  anonKey,
  storage,
  storageKey,
  fetchImpl = fetch,
}) {
  const accessToken = readStoredAccessToken(storage, storageKey);
  if (!accessToken) return null;
  try {
    const response = await fetchImpl(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: anonKey, authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;
    const user = await response.json();
    return {
      id: user?.id || null,
      email: user?.email || null,
      qaRole: user?.app_metadata?.qa_role || null,
    };
  } catch {
    return null;
  }
}

async function hasRow({ supabaseUrl, anonKey, accessToken, table, column, userId, fetchImpl }) {
  const query = `${supabaseUrl}/rest/v1/${table}`
    + `?select=${encodeURIComponent(column)}&${column}=eq.${encodeURIComponent(userId)}&limit=1`;
  try {
    const response = await fetchImpl(query, {
      headers: { apikey: anonKey, authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return false;
    const rows = await response.json();
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    return false;
  }
}

/**
 * Decide a dónde volver ya con la identidad nueva puesta. Para una superficie
 * de organización se pregunta con el token nuevo —o sea, bajo RLS— si esa
 * identidad tiene algún vínculo: membresía, dirección de equipo o plantel. Si
 * no lo tiene, no se la manda a una pantalla que no le corresponde: cae en la
 * superficie segura.
 */
export async function resolveReturnTarget({
  supabaseUrl,
  anonKey,
  accessToken,
  userId,
  returnTo,
  fetchImpl = fetch,
}) {
  if (!returnTo) return { path: QA_SAFE_FALLBACK_PATH, fellBack: false };
  if (!isOrganizationScopedPath(returnTo)) return { path: returnTo, fellBack: false };
  if (!userId || !accessToken) return { path: QA_SAFE_FALLBACK_PATH, fellBack: true };

  const probes = await Promise.all([
    hasRow({
      supabaseUrl, anonKey, accessToken, userId, fetchImpl,
      table: 'tournament_organization_members', column: 'user_id',
    }),
    hasRow({
      supabaseUrl, anonKey, accessToken, userId, fetchImpl,
      table: 'tournament_team_managers', column: 'user_id',
    }),
    hasRow({
      supabaseUrl, anonKey, accessToken, userId, fetchImpl,
      table: 'tournament_roster_players', column: 'arma2_user_id',
    }),
  ]);

  if (probes.some(Boolean)) return { path: returnTo, fellBack: false };
  return { path: QA_SAFE_FALLBACK_PATH, fellBack: true };
}

/**
 * El cambio completo. Devuelve el destino; recargar es responsabilidad de quien
 * llama, para que los tests puedan afirmar el destino sin navegar.
 */
export async function switchQaRole({
  role,
  supabaseUrl,
  anonKey,
  storage,
  sessionStorage: viewStorage,
  returnTo,
  fetchImpl = fetch,
}) {
  const payload = await fetchQaSession(role, { fetchImpl });
  const storageKey = payload?.storageKey;
  const session = payload?.session;
  if (!storageKey || !session?.access_token) {
    throw new Error('El puente QA no devolvió una sesión utilizable.');
  }

  const identity = await resolveCurrentIdentityFromToken({
    supabaseUrl, anonKey, accessToken: session.access_token, fetchImpl,
  });
  if (!identity || identity.qaRole !== role) {
    throw new Error(`Auth LOCAL no reconoció la sesión de ${role}.`);
  }

  clearSessionScopedState(storage, { preserveKeys: [storageKey] });
  if (viewStorage && typeof viewStorage.clear === 'function') viewStorage.clear();
  storage.setItem(storageKey, JSON.stringify(session));

  const target = await resolveReturnTarget({
    supabaseUrl,
    anonKey,
    accessToken: session.access_token,
    userId: identity.id,
    returnTo,
    fetchImpl,
  });
  return { ...target, identity };
}

async function resolveCurrentIdentityFromToken({ supabaseUrl, anonKey, accessToken, fetchImpl }) {
  try {
    const response = await fetchImpl(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: anonKey, authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;
    const user = await response.json();
    return {
      id: user?.id || null,
      email: user?.email || null,
      qaRole: user?.app_metadata?.qa_role || null,
    };
  } catch {
    return null;
  }
}
