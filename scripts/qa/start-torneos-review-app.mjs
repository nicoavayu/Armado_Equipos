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
import { execFileSync } from 'node:child_process';
import { spawn } from 'node:child_process';
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

function main() {
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

  assertPortIsFree(docker);
  const child = spawn('npx', ['react-scripts', 'start'], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: buildChildEnvironment(anonKey),
  });
  child.on('exit', (code) => process.exit(code ?? 0));
}

try {
  main();
} catch (error) {
  if (error instanceof ReviewStartError || error instanceof ProductionGuardError) {
    console.error(`\n[qa:torneos:review] ${error.message}\n`);
    process.exit(1);
  }
  throw error;
}
