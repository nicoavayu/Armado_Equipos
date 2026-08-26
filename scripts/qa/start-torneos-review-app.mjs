#!/usr/bin/env node
//
// Arranque canónico de la app para una sesión de revisión de Torneos en LOCAL.
//
// `qa:start:local` ya cerraba una trampa: `.env.local` apunta a un Supabase
// remoto y CRA lo lee salvo que alguien pise la variable en el proceso. Pero
// quedaban dos más, y las dos se manifestaban como "la app no muestra Torneos"
// sin ningún error:
//
//   * `REACT_APP_LOCAL_EDIT_MODE` no venía fijado, así que dependía del archivo;
//   * los quince flags `REACT_APP_TORNEOS_*` había que recordarlos de memoria y
//     escribirlos a mano en la línea de comandos. Olvidar uno de los cinco de
//     readiness apagaba la subida multimedia en silencio.
//
// Acá no hay nada que recordar. El destino LOCAL se resuelve solo desde el
// stack canónico, los quince flags se derivan del contrato que la app misma
// declara en `src/features/torneos/config/featureFlags.js`, y el puerto es fijo.
// Si el stack no está, el arranque falla y explica por qué en vez de levantar
// una app apuntada a otro lado.
//
// Uso:
//   npm run qa:torneos:review            (verifica el destino y no arranca nada)
//   npm run qa:torneos:review -- --start (verifica y arranca la app)
//
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import productionGuard from './production-guard.js';

const { assertSafeQaValue, ProductionGuardError } = productionGuard;

const STACK_PROJECT = 'arma2-torneos-qa-seed';
const API_ORIGIN = 'http://127.0.0.1:57321';
const DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:57322/postgres';
const APP_PORT = '3100';
const APP_HOST = '127.0.0.1';
const REVIEW_SEED_KEY = 'qa.review.supplement.v1';
const AUTH_STATE_DIRECTORY = path.join('.secrets', 'torneos-review-auth');
// Los JWT LOCAL duran seis horas. Renovarlos recién cuando vencen significa
// descubrirlo a mitad de una revisión, con un rol que de golpe no entra. Se
// renuevan cuando les queda menos de una hora: siempre antes, nunca durante.
const AUTH_STATE_MIN_SECONDS_LEFT = 3600;
const QA_ROLES = ['owner', 'admin', 'collaborator', 'delegate', 'player', 'outsider'];

// Los diez flags de producto y los cinco de readiness multimedia. La lista es
// la misma que compila la app: si allá se agrega uno, este arranque lo delata
// porque el chequeo de cobertura de más abajo deja de cerrar.
const TORNEOS_FEATURE_FLAGS = [
  'REACT_APP_TORNEOS_ENABLED',
  'REACT_APP_TORNEOS_WORKSPACES_ENABLED',
  'REACT_APP_TORNEOS_WORKSPACE_SWITCHER_ENABLED',
  'REACT_APP_TORNEOS_DEEP_LINKS_ENABLED',
  'REACT_APP_TORNEOS_NOTIFICATIONS_ENABLED',
  'REACT_APP_TORNEOS_OFFICIAL_STATS_ENABLED',
  'REACT_APP_TORNEOS_PUBLIC_PAGES_ENABLED',
  'REACT_APP_TORNEOS_MEDIA_ENABLED',
  'REACT_APP_TORNEOS_MEDIA_UPLOAD_ENABLED',
  'REACT_APP_TORNEOS_SOCIAL_GENERATOR_ENABLED',
];
const TORNEOS_MEDIA_READINESS = [
  'REACT_APP_TORNEOS_MEDIA_SIGNER_READY',
  'REACT_APP_TORNEOS_MEDIA_WORKER_READY',
  'REACT_APP_TORNEOS_MEDIA_AV_READY',
  'REACT_APP_TORNEOS_MEDIA_CLEANUP_READY',
  'REACT_APP_TORNEOS_MEDIA_OBSERVABILITY_READY',
];

const DOCKER_CANDIDATES = [
  'docker',
  '/Applications/Docker.app/Contents/Resources/bin/docker',
  '/usr/local/bin/docker',
  '/opt/homebrew/bin/docker',
];

class ReviewStartError extends Error {}

function fail(message, remedy) {
  throw new ReviewStartError(remedy ? `${message}\n\n${remedy}` : message);
}

function resolveDocker() {
  for (const candidate of DOCKER_CANDIDATES) {
    try {
      execFileSync(candidate, ['version', '--format', '{{.Server.Version}}'], {
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return candidate;
    } catch {
      // Sigue con el próximo candidato.
    }
  }
  return fail(
    'No se encontró un Docker con daemon activo.',
    'Abrí Docker Desktop. El binario se busca en el PATH y en\n'
    + '  /Applications/Docker.app/Contents/Resources/bin/docker',
  );
}

function dockerOut(docker, args) {
  return execFileSync(docker, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function assertStackIsUp(docker) {
  const running = dockerOut(docker, [
    'ps', '--filter', `name=${STACK_PROJECT}`, '--format', '{{.Names}}',
  ]).split('\n').filter(Boolean);
  const required = ['db', 'kong', 'rest', 'auth', 'storage'].map(
    (service) => `supabase_${service}_${STACK_PROJECT}`,
  );
  const missing = required.filter((name) => !running.includes(name));
  if (missing.length > 0) {
    fail(
      `El stack canónico "${STACK_PROJECT}" no está arriba.`
      + `\nFaltan: ${missing.join(', ')}`,
      `Levantalo con:\n  docker start ${required.join(' ')}`,
    );
  }
  return running.length;
}

/**
 * Resuelve la anon key del stack LOCAL.
 *
 * Se prefiere la variable del proceso si ya está; si no, se lee del container
 * de Storage del stack canónico. En ningún caso se imprime: sólo viaja al
 * proceso hijo.
 */
function resolveAnonKey(docker) {
  const fromEnv = String(process.env.QA_SUPABASE_ANON_KEY || '').trim();
  if (fromEnv) return { anonKey: fromEnv, source: 'proceso' };
  try {
    const anonKey = dockerOut(docker, [
      'exec', `supabase_storage_${STACK_PROJECT}`, 'printenv', 'ANON_KEY',
    ]);
    if (!anonKey) throw new Error('empty');
    return { anonKey, source: `container supabase_storage_${STACK_PROJECT}` };
  } catch {
    return fail(
      'No se pudo resolver la anon key del stack LOCAL.',
      'Pasala en el proceso si el container no la expone:\n'
      + '  QA_SUPABASE_ANON_KEY=<anon key local> npm run qa:torneos:review -- --start',
    );
  }
}

function assertLoopbackTarget(supabaseUrl) {
  assertSafeQaValue(supabaseUrl, 'destino Supabase');
  const url = new URL(supabaseUrl);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    fail(`El destino ${url.host} no es loopback. Una revisión LOCAL no arranca contra otra cosa.`);
  }
  return url;
}

/**
 * Ningún ref remoto puede colarse por el entorno heredado. El destino ya está
 * fijado, pero una variable suelta (`REACT_APP_TORNEOS_STAGING_PROJECT_REF`,
 * por ejemplo) alcanzaría para que la app crea que puede hablar con Staging.
 */
function assertNoRemoteProjectRef(env) {
  const suspects = [
    'REACT_APP_SUPABASE_URL', 'SUPABASE_URL', 'QA_SUPABASE_URL',
    'REACT_APP_TORNEOS_STAGING_PROJECT_REF', 'SUPABASE_DB_URL', 'DATABASE_URL',
  ];
  for (const key of suspects) {
    const raw = String(env[key] || '').trim();
    if (!raw) continue;
    assertSafeQaValue(raw, key, env);
    if (/[a-z0-9]{16,}\.supabase\.(co|net)/i.test(raw)) {
      fail(
        `La variable heredada ${key} apunta a un proyecto Supabase remoto.`,
        'Sacala del entorno antes de arrancar la revisión LOCAL.',
      );
    }
  }
}

function assertPortIsFree(docker) {
  let holder = '';
  try {
    holder = execFileSync('lsof', ['-nP', `-iTCP:${APP_PORT}`, '-sTCP:LISTEN', '-Fn'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return; // lsof sin resultados sale distinto de cero: el puerto está libre.
  }
  if (holder) {
    fail(
      `El puerto ${APP_PORT} ya está ocupado.`,
      'La revisión usa un puerto fijo a propósito: descubrir el puerto cada vez\n'
      + 'es justamente lo que este comando viene a evitar. Bajá el proceso que lo\n'
      + `tiene tomado y volvé a arrancar:\n  lsof -nP -iTCP:${APP_PORT} -sTCP:LISTEN`,
    );
  }
}

function dbValue(docker, sql) {
  return dockerOut(docker, [
    'exec', '-i', `supabase_db_${STACK_PROJECT}`,
    'psql', '-U', 'postgres', '-d', 'postgres', '-Atc', sql,
  ]);
}

function describeDataset(docker) {
  const head = dbValue(docker, 'select max(version) from supabase_migrations.schema_migrations;');
  const ledger = dbValue(docker, 'select count(*) from supabase_migrations.schema_migrations;');
  const reviewSeed = dbValue(
    docker,
    "select exists(select 1 from public.tournament_audit_log"
    + " where action = 'qa.review.supplement_applied');",
  ) === 't';
  const profile = dbValue(docker, `
    select concat_ws(' · ',
      'orgs=' || (select count(*) from public.tournament_organizations),
      'torneos=' || (select count(*) from public.tournaments),
      'partidos=' || (select count(*) from public.tournament_matches),
      'escudos=' || (select count(*) from public.tournament_team_entries where shield_path is not null),
      'retratos=' || (select count(*) from public.tournament_player_portraits where lifecycle_status='active'),
      'fotos=' || (select count(*) from public.tournament_media_assets),
      'convocatorias=' || (select count(*) from public.tournament_match_squads),
      'arma2=' || (select count(*) from public.partidos where deleted_at is null));
  `.replace(/\s+/g, ' ').trim());
  const publicSlug = dbValue(
    docker,
    "select coalesce(max(public_slug),'(ninguna)') from public.tournament_public_pages"
    + " where status = 'published';",
  );
  return { head, ledger, reviewSeed, profile, publicSlug };
}

function describeCheckout(repoRoot) {
  try {
    const git = (args) => execFileSync('git', args, {
      cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return {
      branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
      head: git(['rev-parse', '--short', 'HEAD']),
      dirty: git(['status', '--porcelain']).length > 0,
    };
  } catch {
    return { branch: '(desconocida)', head: '(desconocido)', dirty: false };
  }
}

function buildChildEnvironment(anonKey) {
  const enabled = Object.fromEntries(
    [...TORNEOS_FEATURE_FLAGS, ...TORNEOS_MEDIA_READINESS].map((key) => [key, 'true']),
  );
  return {
    ...process.env,
    // Destino: resuelto, no heredado. CRA no vuelve a mirar los archivos .env*.
    REACT_APP_SUPABASE_URL: API_ORIGIN,
    REACT_APP_SUPABASE_ANON_KEY: anonKey,
    // Las dos trampas que este comando cierra.
    REACT_APP_LOCAL_EDIT_MODE: 'false',
    REACT_APP_TORNEOS_DATA_ENV: 'local',
    // El gate exige un deploy no productivo además del backend aislado.
    REACT_APP_DEPLOY_ENV: 'development',
    REACT_APP_TORNEOS_STAGING_PROJECT_REF: '',
    // El único lugar donde este flag se pone en true. No está en .env.example ni
    // en ningún archivo: sin este arranque, el selector de rol no existe.
    REACT_APP_TORNEOS_QA_ROLE_SWITCHER: 'true',
    REACT_APP_PUBLIC_APP_URL: `http://${APP_HOST}:${APP_PORT}`,
    REACT_APP_AUTH_REDIRECT_URL: `http://${APP_HOST}:${APP_PORT}/auth/callback`,
    ...enabled,
    PORT: APP_PORT,
    HOST: APP_HOST,
    BROWSER: 'none',
  };
}

/**
 * La app compila su propia lista de flags. Si alguien agrega uno allá y no acá,
 * la revisión arrancaría con esa superficie apagada y sin decir nada: este
 * chequeo convierte ese silencio en un error de arranque.
 */
function assertFlagCoverage(repoRoot) {
  const flagsFile = path.join(repoRoot, 'src', 'features', 'torneos', 'config', 'featureFlags.js');
  if (!fs.existsSync(flagsFile)) return { checked: false, covered: 0 };
  const declared = new Set(
    (fs.readFileSync(flagsFile, 'utf8').match(/REACT_APP_TORNEOS_[A-Z0-9_]+/g) || [])
      .filter((key) => key !== 'REACT_APP_TORNEOS_DATA_ENV'
        && key !== 'REACT_APP_TORNEOS_STAGING_PROJECT_REF'),
  );
  const covered = new Set([...TORNEOS_FEATURE_FLAGS, ...TORNEOS_MEDIA_READINESS]);
  const missing = [...declared].filter((key) => !covered.has(key)).sort();
  if (missing.length > 0) {
    fail(
      'La app declara flags de Torneos que este arranque no fija:\n  '
      + missing.join('\n  '),
      `Agregalos en ${path.relative(repoRoot, flagsFile)} y en este script.`,
    );
  }
  return { checked: true, covered: covered.size };
}


/**
 * Resuelve el secreto JWT del stack LOCAL desde el propio container de Auth.
 * No se imprime nunca: sólo viaja al proceso que firma los tokens QA.
 */
function resolveLocalJwtSecret(docker) {
  try {
    const secret = dockerOut(docker, [
      'exec', `supabase_auth_${STACK_PROJECT}`, 'printenv', 'GOTRUE_JWT_SECRET',
    ]);
    if (!secret) throw new Error('empty');
    return secret;
  } catch {
    return fail(
      'No se pudo resolver el secreto JWT del stack LOCAL.',
      'El container de Auth del stack canónico tiene que exponer GOTRUE_JWT_SECRET.',
    );
  }
}

/**
 * Una sesión QA sirve si el archivo está, si tiene los permisos correctos, si
 * fue emitida para este origen y si a su token le queda vida suficiente. Lo que
 * se devuelve es el diagnóstico: el contenido del archivo no sale de acá.
 */
function inspectAuthStates(repoRoot) {
  const directory = path.join(repoRoot, AUTH_STATE_DIRECTORY);
  const expectedOrigin = `http://${APP_HOST}:${APP_PORT}`;
  const now = Math.floor(Date.now() / 1000);
  const problems = [];
  let soonestSecondsLeft = Infinity;

  for (const role of QA_ROLES) {
    const file = path.join(directory, `${role}.json`);
    let stats;
    try {
      stats = fs.lstatSync(file);
    } catch {
      problems.push(`${role}: falta`);
      continue;
    }
    if (!stats.isFile() || stats.isSymbolicLink()) {
      problems.push(`${role}: no es un archivo regular`);
      continue;
    }
    if ((stats.mode & 0o077) !== 0) {
      problems.push(`${role}: permisos más laxos que 0600`);
      continue;
    }
    let session;
    try {
      const state = JSON.parse(fs.readFileSync(file, 'utf8'));
      const origin = (state.origins || []).find((entry) => entry.origin === expectedOrigin);
      const stored = (origin?.localStorage || []).find(
        (entry) => entry.name === 'sb-127-auth-token',
      );
      session = JSON.parse(stored.value);
    } catch {
      problems.push(`${role}: storage state ilegible o de otro origen`);
      continue;
    }
    const secondsLeft = Number(session.expires_at || 0) - now;
    if (secondsLeft < AUTH_STATE_MIN_SECONDS_LEFT) {
      problems.push(secondsLeft <= 0 ? `${role}: vencida` : `${role}: vence en breve`);
      continue;
    }
    soonestSecondsLeft = Math.min(soonestSecondsLeft, secondsLeft);
  }

  return {
    directory,
    ok: problems.length === 0,
    problems,
    soonestSecondsLeft: Number.isFinite(soonestSecondsLeft) ? soonestSecondsLeft : 0,
  };
}

/**
 * Verifica contra Auth LOCAL, que es la única autoridad: un archivo bien formado
 * con un token que el stack no reconoce no es una sesión.
 */
async function verifyAuthStates(repoRoot, anonKey) {
  const directory = path.join(repoRoot, AUTH_STATE_DIRECTORY);
  const rejected = [];
  for (const role of QA_ROLES) {
    try {
      const state = JSON.parse(fs.readFileSync(path.join(directory, `${role}.json`), 'utf8'));
      const stored = state.origins[0].localStorage.find(
        (entry) => entry.name === 'sb-127-auth-token',
      );
      const session = JSON.parse(stored.value);
      const response = await fetch(`${API_ORIGIN}/auth/v1/user`, {
        headers: { apikey: anonKey, authorization: `Bearer ${session.access_token}` },
      });
      if (!response.ok) {
        rejected.push(`${role}: Auth LOCAL respondió ${response.status}`);
        continue;
      }
      const user = await response.json();
      if (user?.app_metadata?.qa_role !== role) {
        rejected.push(`${role}: Auth LOCAL reconoce otra identidad`);
      }
    } catch {
      rejected.push(`${role}: no se pudo verificar contra Auth LOCAL`);
    }
  }
  return rejected;
}

/**
 * Regenera las seis sesiones con el generador canónico. No se inventa ningún
 * refresh: se vuelven a firmar tokens de seis horas contra las identidades QA
 * que ya existen en el stack.
 */
function regenerateAuthStates(repoRoot, docker, anonKey) {
  const childEnvironment = { ...process.env };
  // El generador rechaza URLs de base de datos en conflicto: el destino LOCAL
  // tiene que ser el único que el proceso declara.
  delete childEnvironment.DATABASE_URL;
  delete childEnvironment.SUPABASE_DB_URL;
  delete childEnvironment.ARMA2_TARGET_DATABASE_URL;
  delete childEnvironment.QA_SUPABASE_URL;

  const result = spawnSync(process.execPath, [
    path.join('scripts', 'qa', 'prepare-torneos-local-auth-states.mjs'), '--write-local',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...childEnvironment,
      QA_ALLOW_LOCAL_AUTH_STATES: 'true',
      QA_SEED_ENV: 'local',
      QA_SEED_PROJECT_REF: 'local',
      QA_SEED_DATABASE_URL: DATABASE_URL,
      QA_SUPABASE_URL: API_ORIGIN,
      QA_SUPABASE_ANON_KEY: anonKey,
      QA_LOCAL_JWT_SECRET: resolveLocalJwtSecret(docker),
      QA_BASE_URL: `http://${APP_HOST}:${APP_PORT}`,
      QA_AUTH_STATE_DIR: AUTH_STATE_DIRECTORY,
    },
  });
  if (result.status !== 0) {
    fail(
      'No se pudieron regenerar las sesiones QA.',
      `El generador canónico salió con código ${result.status}.\n`
      + `${String(result.stderr || '').trim().slice(0, 400)}`,
    );
  }
}

/**
 * Deja las seis sesiones utilizables o falla. Nunca se llega a la app con
 * sesiones a medias: descubrir el vencimiento al cambiar de rol es exactamente
 * lo que este paso viene a evitar.
 */
async function ensureAuthStates(repoRoot, docker, anonKey) {
  let inspection = inspectAuthStates(repoRoot);
  let rejected = inspection.ok ? await verifyAuthStates(repoRoot, anonKey) : [];
  const reasons = [...inspection.problems, ...rejected];

  if (reasons.length === 0) {
    return { regenerated: false, secondsLeft: inspection.soonestSecondsLeft, reasons: [] };
  }

  regenerateAuthStates(repoRoot, docker, anonKey);
  inspection = inspectAuthStates(repoRoot);
  rejected = inspection.ok ? await verifyAuthStates(repoRoot, anonKey) : [];
  if (!inspection.ok || rejected.length > 0) {
    fail(
      'Las sesiones QA siguen sin ser utilizables después de regenerarlas.',
      [...inspection.problems, ...rejected].join('\n  '),
    );
  }
  return { regenerated: true, secondsLeft: inspection.soonestSecondsLeft, reasons };
}

async function main() {
  const repoRoot = process.cwd();
  const shouldStart = process.argv.includes('--start');

  assertNoRemoteProjectRef(process.env);
  const target = assertLoopbackTarget(API_ORIGIN);
  const docker = resolveDocker();
  const containers = assertStackIsUp(docker);
  const { anonKey, source } = resolveAnonKey(docker);
  const coverage = assertFlagCoverage(repoRoot);
  const dataset = describeDataset(docker);
  const checkout = describeCheckout(repoRoot);

  console.log('[qa:torneos:review] destino verificado');
  console.log(`  stack            ${STACK_PROJECT} (${containers} containers arriba)`);
  console.log(`  Supabase API     ${target.origin}`);
  console.log(`  Supabase DB      ${DATABASE_URL.replace(/\/\/[^@]*@/, '//<oculto>@')}`);
  console.log(`  anon key         resuelta desde ${source} (no se imprime)`);
  console.log(`  migration head   ${dataset.head} (${dataset.ledger} migraciones en el ledger)`);
  console.log(`  dataset          ${dataset.profile}`);
  console.log(`  review seed      ${dataset.reviewSeed ? 'aplicado' : 'NO aplicado'}`);
  console.log(`  página pública   ${dataset.publicSlug}`);
  console.log(`  branch / HEAD    ${checkout.branch} @ ${checkout.head}${checkout.dirty ? ' (working tree sucio)' : ''}`);
  console.log(`  flags Torneos    ${coverage.covered} en true, DATA_ENV=local, LOCAL_EDIT_MODE=false`);
  console.log(`  app              http://${APP_HOST}:${APP_PORT}`);
  console.log(`  selector de rol  http://${APP_HOST}:${APP_PORT}/qa/rol (puente en /__qa/role-switcher)`);

  if (!dataset.reviewSeed) {
    console.log('');
    console.log('  Aviso: el suplemento de revisión no está aplicado. Escudos, retratos,');
    console.log('  multimedia, convocatoria y acta completa van a verse vacíos.');
    console.log('  Plan y requisitos:  npm run qa:torneos:review:seed');
  }

  if (!shouldStart) {
    console.log('\nRevisión solamente. Agregá --start para arrancar la app.');
    return;
  }

  const sessions = await ensureAuthStates(repoRoot, docker, anonKey);
  const hoursLeft = (sessions.secondsLeft / 3600).toFixed(1);
  if (sessions.regenerated) {
    console.log(`  sesiones QA      regeneradas (${QA_ROLES.length} roles, ~${hoursLeft} h de vida)`);
    console.log(`                   motivo: ${sessions.reasons.join('; ')}`);
  } else {
    console.log(`  sesiones QA      ${QA_ROLES.length} válidas (~${hoursLeft} h de vida)`);
  }

  assertPortIsFree(docker);
  const child = spawn('npx', ['react-scripts', 'start'], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: buildChildEnvironment(anonKey),
  });
  child.on('exit', (code) => process.exit(code ?? 0));
}

main().catch((error) => {
  if (error instanceof ReviewStartError || error instanceof ProductionGuardError) {
    console.error(`\n[qa:torneos:review] ${error.message}\n`);
    process.exit(1);
  }
  throw error;
});
