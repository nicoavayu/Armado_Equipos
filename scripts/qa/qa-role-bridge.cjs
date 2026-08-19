//
// Puente QA LOCAL para cambiar de rol desde el navegador.
//
// Las seis sesiones QA viven como storage states 0600 en `.secrets/torneos-review-auth/`.
// El navegador no puede leer un archivo del disco, así que hace falta algo que se lo
// entregue. Ese "algo" no es un servidor nuevo: es el dev-server que la revisión ya
// levanta. CRA carga `src/setupProxy.js` y le pasa su propio Express, de modo que el
// puente vive en el mismo origen que la app (`http://127.0.0.1:3100`), muere con ella,
// no abre otro puerto, no necesita CORS y no agrega un segundo comando.
//
// Todo lo demás es fail-closed:
//
//   * el puente ni se monta si alguna condición LOCAL no se cumple;
//   * cada request revalida origen, header propio y socket de loopback;
//   * el rol viaja como nombre y se resuelve contra una allowlist fija: nunca se
//     construye un path con texto del cliente;
//   * el contenido de las sesiones no se loguea ni se imprime jamás.
//
const fs = require('node:fs');
const path = require('node:path');

const MOUNT_PATH = '/__qa/role-switcher';
const REQUEST_HEADER = 'x-qa-role-switcher';
const REQUEST_HEADER_VALUE = '1';
const AUTH_STATE_DIRECTORY = path.join('.secrets', 'torneos-review-auth');
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const MAX_STATE_BYTES = 256 * 1024;

// Las seis identidades QA existentes. La lista es cerrada a propósito: es la
// allowlist contra la que se valida el rol pedido y, a la vez, el único origen
// de los nombres de archivo que este módulo llega a abrir.
const QA_ROLE_CATALOG = Object.freeze([
  Object.freeze({
    role: 'owner',
    label: 'Owner',
    description: 'Dueño de la organización: configuración, multimedia, social y plan.',
  }),
  Object.freeze({
    role: 'admin',
    label: 'Admin',
    description: 'Administra la competencia y valida actas, sin gobierno de la organización.',
  }),
  Object.freeze({
    role: 'collaborator',
    label: 'Colaborador',
    description: 'Miembro de la organización con alcance mayormente de lectura.',
  }),
  Object.freeze({
    role: 'delegate',
    label: 'Delegado',
    description: 'Delegado de BNO: su equipo y su plantel, no los ajenos.',
  }),
  Object.freeze({
    role: 'player',
    label: 'Jugador',
    description: 'Jugador del plantel de BNO: espacio personal, sin administración.',
  }),
  Object.freeze({
    role: 'outsider',
    label: 'Outsider',
    description: 'Usuario autenticado sin vínculo con la organización privada.',
  }),
]);

const QA_ROLES = Object.freeze(QA_ROLE_CATALOG.map((entry) => entry.role));

function normalized(value) {
  return String(value ?? '').trim();
}

/**
 * La misma derivación que hace supabase-js: la primera etiqueta del hostname.
 * Para `http://127.0.0.1:57321` da `sb-127-auth-token`, que es exactamente la
 * clave que escribe el generador canónico de storage states.
 */
function storageKeyForSupabaseUrl(supabaseUrl) {
  return `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;
}

function isLoopbackHost(hostname) {
  return LOOPBACK_HOSTS.has(normalized(hostname).toLowerCase());
}

function isLoopbackAddress(address) {
  const clean = normalized(address).replace(/^::ffff:/i, '');
  return clean === '127.0.0.1' || clean === '::1' || clean === 'localhost';
}

function hasRemoteProjectRef(env) {
  return [
    'REACT_APP_SUPABASE_URL',
    'SUPABASE_URL',
    'QA_SUPABASE_URL',
    'REACT_APP_TORNEOS_STAGING_PROJECT_REF',
    'SUPABASE_DB_URL',
    'DATABASE_URL',
  ].some((key) => /[a-z0-9]{16,}\.supabase\.(co|net)/i.test(normalized(env[key])));
}

/**
 * Las condiciones duras. Ninguna alcanza sola y ninguna es cosmética: si el
 * arranque no es el de revisión LOCAL, `enabled` sale en false y el puente no
 * llega a montarse. Las razones se devuelven para poder imprimirlas y afirmarlas
 * en los tests, nunca para relajarlas.
 */
function resolveQaRoleBridgeGate(env = process.env) {
  const failures = [];

  if (normalized(env.REACT_APP_TORNEOS_QA_ROLE_SWITCHER) !== 'true') {
    failures.push('REACT_APP_TORNEOS_QA_ROLE_SWITCHER no es "true"');
  }
  if (normalized(env.REACT_APP_TORNEOS_DATA_ENV).toLowerCase() !== 'local') {
    failures.push('REACT_APP_TORNEOS_DATA_ENV no es "local"');
  }
  if (normalized(env.NODE_ENV).toLowerCase() === 'production') {
    failures.push('NODE_ENV es "production"');
  }
  const deployEnvironment = normalized(env.REACT_APP_DEPLOY_ENV).toLowerCase();
  if (deployEnvironment && deployEnvironment !== 'development' && deployEnvironment !== 'test') {
    failures.push(`REACT_APP_DEPLOY_ENV "${deployEnvironment}" no es un deploy local`);
  }

  let supabaseUrl = null;
  try {
    const parsed = new URL(normalized(env.REACT_APP_SUPABASE_URL));
    if (parsed.protocol !== 'http:' || !isLoopbackHost(parsed.hostname)) {
      failures.push('REACT_APP_SUPABASE_URL no es un backend Supabase de loopback');
    } else {
      supabaseUrl = parsed.origin;
    }
  } catch {
    failures.push('REACT_APP_SUPABASE_URL no es una URL válida');
  }

  const host = normalized(env.HOST);
  if (!isLoopbackHost(host)) {
    failures.push('HOST del dev-server no es loopback');
  }
  const port = normalized(env.PORT);
  if (!/^\d{2,5}$/.test(port)) {
    failures.push('PORT del dev-server no está fijado');
  }
  if (hasRemoteProjectRef(env)) {
    failures.push('el entorno declara un proyecto Supabase remoto');
  }
  if (!normalized(env.REACT_APP_SUPABASE_ANON_KEY)) {
    failures.push('falta la anon key LOCAL para verificar las sesiones');
  }

  return Object.freeze({
    enabled: failures.length === 0,
    failures: Object.freeze(failures),
    supabaseUrl,
    storageKey: supabaseUrl ? storageKeyForSupabaseUrl(supabaseUrl) : null,
    expectedOrigin: failures.length === 0 ? `http://${host}:${port}` : null,
  });
}

class BridgeError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * El rol nunca se concatena a un path: se busca en la allowlist y el nombre del
 * archivo sale del catálogo, no del request.
 */
function resolveStateFile(repoRoot, requestedRole) {
  const entry = QA_ROLE_CATALOG.find((candidate) => candidate.role === requestedRole);
  if (!entry) throw new BridgeError(400, 'Rol QA desconocido.');
  return path.join(repoRoot, AUTH_STATE_DIRECTORY, `${entry.role}.json`);
}

function readStorageState(repoRoot, role, { storageKey, expectedOrigin }) {
  const file = resolveStateFile(repoRoot, role);
  const stats = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!stats || !stats.isFile() || stats.isSymbolicLink()) {
    throw new BridgeError(409, `La sesión QA de ${role} no está preparada.`);
  }
  if ((stats.mode & 0o077) !== 0) {
    throw new BridgeError(409, `La sesión QA de ${role} debe tener permisos 0600.`);
  }
  if (stats.size > MAX_STATE_BYTES) {
    throw new BridgeError(409, `La sesión QA de ${role} tiene un tamaño inesperado.`);
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw new BridgeError(409, `La sesión QA de ${role} no es un storage state legible.`);
  }
  const origins = Array.isArray(parsed?.origins) ? parsed.origins : [];
  const origin = origins.find((candidate) => candidate?.origin === expectedOrigin);
  if (!origin) {
    throw new BridgeError(409, `La sesión QA de ${role} no fue emitida para este origen.`);
  }
  const entries = Array.isArray(origin.localStorage) ? origin.localStorage : [];
  const stored = entries.find((candidate) => candidate?.name === storageKey);
  if (!stored?.value) {
    throw new BridgeError(409, `La sesión QA de ${role} no contiene una sesión Supabase.`);
  }
  let session;
  try {
    session = JSON.parse(stored.value);
  } catch {
    throw new BridgeError(409, `La sesión QA de ${role} está corrupta.`);
  }
  if (!normalized(session?.access_token)) {
    throw new BridgeError(409, `La sesión QA de ${role} no tiene access token.`);
  }
  return session;
}

/**
 * La sesión no se entrega por existir: se entrega porque Auth LOCAL la reconoce
 * y porque el usuario que reconoce es el del rol pedido.
 */
async function verifySession({ supabaseUrl, anonKey, accessToken, role, fetchImpl = fetch }) {
  let response;
  try {
    response = await fetchImpl(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: anonKey, authorization: `Bearer ${accessToken}` },
    });
  } catch {
    throw new BridgeError(502, 'Auth LOCAL no respondió.');
  }
  if (!response.ok) {
    throw new BridgeError(409, `Auth LOCAL rechazó la sesión de ${role} (${response.status}).`);
  }
  const user = await response.json();
  const recognized = normalized(user?.app_metadata?.qa_role);
  if (recognized !== role) {
    throw new BridgeError(409, `Auth LOCAL reconoce otro rol para esa sesión.`);
  }
  return user;
}

function describeSessionFreshness(session) {
  const expiresAt = Number(session?.expires_at) || 0;
  return {
    expiresAt,
    secondsLeft: Math.max(0, expiresAt - Math.floor(Date.now() / 1000)),
  };
}

async function listRoles({ repoRoot, gate, anonKey, fetchImpl = fetch }) {
  const roles = [];
  for (const entry of QA_ROLE_CATALOG) {
    try {
      const session = readStorageState(repoRoot, entry.role, gate);
      await verifySession({
        supabaseUrl: gate.supabaseUrl,
        anonKey,
        accessToken: session.access_token,
        role: entry.role,
        fetchImpl,
      });
      roles.push({ ...entry, available: true, ...describeSessionFreshness(session) });
    } catch (error) {
      roles.push({
        ...entry,
        available: false,
        expiresAt: 0,
        secondsLeft: 0,
        // El motivo es una frase acotada de este módulo: no lleva paths ni tokens.
        reason: error instanceof BridgeError ? error.message : 'La sesión QA no está disponible.',
      });
    }
  }
  return roles;
}

function readJsonBody(request, { limit = 4096 } = {}) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new BridgeError(413, 'Cuerpo de request demasiado grande.'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('error', () => reject(new BridgeError(400, 'Request inválido.')));
    request.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve({});
      try {
        return resolve(JSON.parse(raw));
      } catch {
        return reject(new BridgeError(400, 'Cuerpo de request inválido.'));
      }
    });
  });
}

/**
 * Revalidación por request. El gate de arranque dice que el proceso es LOCAL;
 * esto dice que quien golpea la puerta es la app de revisión y no otra página.
 * El header propio obliga a un preflight que nunca se contesta, así que ningún
 * sitio de terceros puede ni emitir la llamada ni leer la respuesta.
 */
function assertTrustedRequest(request, gate) {
  if (request.method !== 'POST') {
    throw new BridgeError(405, 'Método no permitido.');
  }
  if (!isLoopbackAddress(request.socket?.remoteAddress)) {
    throw new BridgeError(403, 'Origen de red no permitido.');
  }
  if (normalized(request.headers?.[REQUEST_HEADER]) !== REQUEST_HEADER_VALUE) {
    throw new BridgeError(403, 'Request sin la marca del selector QA.');
  }
  if (normalized(request.headers?.origin) !== gate.expectedOrigin) {
    throw new BridgeError(403, 'Origen no permitido.');
  }
  return true;
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  response.setHeader('x-content-type-options', 'nosniff');
  // Sin cabeceras CORS: la respuesta sólo es legible desde el propio origen.
  response.end(body);
}

function createQaRoleBridgeHandler({
  repoRoot,
  env = process.env,
  gate = resolveQaRoleBridgeGate(env),
  fetchImpl = fetch,
} = {}) {
  const anonKey = normalized(env.REACT_APP_SUPABASE_ANON_KEY);

  return async function handle(request, response, next) {
    try {
      assertTrustedRequest(request, gate);
      const route = String(request.url || '').split('?')[0].replace(/\/+$/, '');

      if (route === '/roles' || route === '') {
        const roles = await listRoles({ repoRoot, gate, anonKey, fetchImpl });
        return sendJson(response, 200, {
          environment: 'local',
          storageKey: gate.storageKey,
          roles,
        });
      }

      if (route === '/session') {
        const body = await readJsonBody(request);
        const role = normalized(body?.role);
        const session = readStorageState(repoRoot, role, gate);
        const user = await verifySession({
          supabaseUrl: gate.supabaseUrl,
          anonKey,
          accessToken: session.access_token,
          role,
          fetchImpl,
        });
        return sendJson(response, 200, {
          role,
          storageKey: gate.storageKey,
          session,
          identity: {
            id: user.id,
            email: user.email,
            qaRole: user.app_metadata?.qa_role || null,
          },
          ...describeSessionFreshness(session),
        });
      }

      if (typeof next === 'function') return next();
      return sendJson(response, 404, { error: 'No encontrado.' });
    } catch (error) {
      const status = error instanceof BridgeError ? error.status : 500;
      const message = error instanceof BridgeError
        ? error.message
        : 'El puente QA falló.';
      return sendJson(response, status, { error: message });
    }
  };
}

/**
 * Punto de montaje para `src/setupProxy.js`. Si el gate no cierra, no se monta
 * nada: la ruta simplemente no existe y el dev-server devuelve el index de la
 * app, donde el selector tampoco está.
 */
function mountQaRoleBridge(app, { repoRoot, env = process.env, fetchImpl = fetch } = {}) {
  const gate = resolveQaRoleBridgeGate(env);
  if (!gate.enabled) return gate;
  const handler = createQaRoleBridgeHandler({ repoRoot, env, gate, fetchImpl });
  app.use(MOUNT_PATH, (request, response, next) => handler(request, response, next));
  return gate;
}

module.exports = {
  AUTH_STATE_DIRECTORY,
  BridgeError,
  MOUNT_PATH,
  QA_ROLES,
  QA_ROLE_CATALOG,
  REQUEST_HEADER,
  REQUEST_HEADER_VALUE,
  assertTrustedRequest,
  createQaRoleBridgeHandler,
  listRoles,
  mountQaRoleBridge,
  readStorageState,
  resolveQaRoleBridgeGate,
  storageKeyForSupabaseUrl,
  verifySession,
};
