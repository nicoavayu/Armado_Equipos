//
// Guardas del suplemento de revisión y del arranque canónico.
//
// Nada de esto toca la base ni la red: lo que se verifica es que las puertas
// estén cerradas por default y que el arranque no pueda quedarse corto de flags
// sin avisar.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { galleryPhotoPng, playerPortraitPng, sha256Hex, teamCrestPng } from './qa-review-images.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const SEED = path.join(HERE, 'seed-torneos-qa-review-supplement.mjs');
const PLAN_FIXTURE = path.join(HERE, 'seed-torneos-plan-review-fixtures.mjs');
const LAUNCHER = path.join(HERE, 'start-torneos-review-app.mjs');

/** Corre el script con un entorno mínimo y devuelve su salida. */
function run(script, args, env = {}) {
  try {
    return {
      status: 0,
      stdout: execFileSync(process.execPath, [script, ...args], {
        cwd: ROOT,
        encoding: 'utf8',
        env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
      stderr: '',
    };
  } catch (error) {
    return {
      status: error.status ?? 1,
      stdout: String(error.stdout || ''),
      stderr: String(error.stderr || ''),
    };
  }
}

test('sin argumentos el suplemento sólo planifica y no declara escrituras', () => {
  const result = run(SEED, []);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, 'plan');
  assert.equal(payload.writes, false);
  assert.equal(payload.seedKey, 'qa.review.supplement.v1');
});

test('el fixture de planes sólo describe su plan por default', () => {
  const result = run(PLAN_FIXTURE, []);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, 'plan');
  assert.equal(payload.writes, false);
  assert.equal(payload.fixtureKey, 'qa.plans.review.v1');
  assert.equal(payload.freeOrganizationSlug, 'qa-planes-first-free');
});

test('el fixture de planes exige destino LOCAL y habilitación explícita', () => {
  const disabled = run(PLAN_FIXTURE, ['--apply-local']);
  assert.equal(disabled.status, 1);
  assert.match(disabled.stderr, /QA_ALLOW_PLANS_REVIEW_FIXTURE=true/);

  const remote = run(PLAN_FIXTURE, ['--apply-local'], {
    QA_ALLOW_PLANS_REVIEW_FIXTURE: 'true',
    QA_SEED_ENV: 'local',
    QA_SEED_PROJECT_REF: 'local',
    QA_SEED_DATABASE_URL: 'postgresql://postgres:postgres@db.example.com:5432/postgres',
  });
  assert.equal(remote.status, 1);
  assert.match(remote.stderr, /loopback/i);
});

test('el fixture de planes usa el contrato comercial vigente por temporada', () => {
  const source = fs.readFileSync(PLAN_FIXTURE, 'utf8');
  assert.match(source, /resolve_effective_tournament_entitlements_at/);
  assert.match(source, /create_fake_tournament_season_purchase/);
  assert.match(source, /apply_fake_tournament_payment_status/);
  assert.match(source, /tournament_season_plan_grants/);
  assert.match(source, /assignmentSource === 'default_free'/);
  assert.match(source, /assignmentSource === 'purchase'/);
  assert.doesNotMatch(source, /grant_tournament_premium\(/);
  assert.doesNotMatch(source, /plan_code = 'FREE' and grant_row\.source = 'first_free'/);
});

test('aplicar sin la habilitación explícita falla', () => {
  const result = run(SEED, ['--apply-local']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /QA_ALLOW_REVIEW_SUPPLEMENT=true/);
});

test('limpiar exige habilitación y confirmación, las dos', () => {
  const onlyAllow = run(SEED, ['--cleanup-local'], { QA_ALLOW_REVIEW_SUPPLEMENT_CLEANUP: 'true' });
  assert.equal(onlyAllow.status, 1);
  assert.match(onlyAllow.stderr, /QA_CONFIRM_REVIEW_SUPPLEMENT=true/);
});

test('con la habilitación puesta, un destino no loopback sigue siendo rechazado', () => {
  const result = run(SEED, ['--apply-local'], {
    QA_ALLOW_REVIEW_SUPPLEMENT: 'true',
    QA_SEED_ENV: 'local',
    QA_SEED_PROJECT_REF: 'local',
    QA_SEED_DATABASE_URL: 'postgresql://postgres:postgres@db.example.com:5432/postgres',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /loopback/i);
});

test('el suplemento no acepta dos modos a la vez', () => {
  const result = run(SEED, ['--apply-local', '--cleanup-local']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /exactly one of/);
});

test('las imágenes QA son determinísticas y son PNG válidos', () => {
  for (const make of [
    () => teamCrestPng('BNO'),
    () => playerPortraitPng('VIL:1'),
    () => galleryPhotoPng('saque-inicial'),
  ]) {
    const first = make();
    const second = make();
    assert.equal(sha256Hex(first), sha256Hex(second), 'la misma etiqueta debe dar los mismos bytes');
    assert.deepEqual([...first.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x08 + 2]);
    assert.equal(first.subarray(12, 16).toString('ascii'), 'IHDR');
    assert.equal(first.subarray(first.length - 8, first.length - 4).toString('ascii'), 'IEND');
  }
  assert.notEqual(
    sha256Hex(teamCrestPng('BNO')),
    sha256Hex(teamCrestPng('VIL')),
    'dos equipos distintos no pueden compartir escudo',
  );
});

test('el fixture QA declara cinco fotos determinísticas y distintas', () => {
  const source = fs.readFileSync(SEED, 'utf8');
  const declaration = source.match(/const GALLERY_PHOTOS = \[([^\]]*)\]/);
  assert.ok(declaration, 'el suplemento tiene que declarar sus etiquetas de galería');
  const labels = [...declaration[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
  assert.equal(labels.length, 5, 'la pantalla se revisa con cinco fotos: cuatro aprobadas y una pendiente');
  const checksums = labels.map((label) => sha256Hex(galleryPhotoPng(label)));
  assert.equal(new Set(checksums).size, 5, 'dos fotos del fixture no pueden compartir bytes');
  for (const label of labels) {
    assert.equal(
      sha256Hex(galleryPhotoPng(label)),
      sha256Hex(galleryPhotoPng(label)),
      `${label} tiene que dar siempre los mismos bytes`,
    );
  }
});

test('sembrar multimedia no termina sin verificar el contrato de procesamiento', () => {
  const source = fs.readFileSync(SEED, 'utf8');
  const seedMedia = source.slice(
    source.indexOf('async function seedMedia('),
    source.indexOf('// 4 y 5. Convocatoria y acta completa'),
  );
  assert.match(
    seedMedia,
    /await assertSeededMediaContract\(client, scope\);[\s\S]*return \{/,
    'la guarda tiene que correr ANTES de devolver el resultado del sembrado',
  );
  // El informe diagnostica en vez de morir: si el dataset arrastra fotos
  // inválidas hay que poder listarlas, no perderlas en una excepción.
  assert.match(source, /mvp_simple_contract_violations: contract\.violations/);
});

test('el cleanup multimedia sólo elimina sesiones parciales inequívocas del fixture', () => {
  const source = fs.readFileSync(SEED, 'utf8');
  const cleanup = source.slice(
    source.indexOf('async function cleanup('),
    source.indexOf('// ---------------------------------------------------------------------------\n// Entrada'),
  );
  assert.match(cleanup, /GALLERY_PHOTOS\.map[\s\S]*uuid\(`media-session:\$\{label\}`\)/);
  assert.match(cleanup, /expected\.idempotency_key = session\.idempotency_key/);
  assert.match(cleanup, /expected\.requested_size = session\.requested_size/);
  for (const predicate of [
    'session.organization_id = $1',
    'session.tournament_id = $2',
    'session.requested_by = $3',
    'session.gallery_id = $4',
    "session.processing_tier = 'mvp_simple'",
    "session.requested_mime = 'image/png'",
    'session.asset_id is null',
    'session.consumed_at is null',
  ]) {
    assert.ok(cleanup.includes(predicate), `falta el scope QA: ${predicate}`);
  }
  assert.match(cleanup, /removed\.partialMediaSessions = deletedPartialSessions\.rowCount/);
  assert.match(cleanup, /new Set\(\[[\s\S]*seededPartialSessions/,
    'los paths parciales se purgan sin duplicar nombres');
});

test('la guarda del fixture nombra cada condición que el producto exige a mvp_simple', () => {
  const guard = (() => {
    const source = fs.readFileSync(SEED, 'utf8');
    return source.slice(
      source.indexOf('async function inspectSeededMediaContract('),
      source.indexOf('/** La misma guarda, pero fail-closed'),
    );
  })();

  // La autoridad es la readiness del producto, así que la guarda la consulta
  // directamente: el veredicto no puede desfasarse aunque los campos cambien.
  assert.match(guard, /tournament_media_asset_publication_ready/);

  // Y además nombra campo por campo, que es lo que vuelve legible el
  // diagnóstico. Si la migración agrega una condición al tier y acá no está,
  // este test la delata en vez de dejar un motivo mudo.
  const readiness = fs.readFileSync(
    path.join(ROOT, 'supabase', 'migrations',
      '20260820120000_tournament_media_publication_is_processing_aware.sql'), 'utf8',
  );
  const branch = readiness.slice(
    readiness.indexOf("WHEN 'mvp_simple' THEN"),
    readiness.indexOf('ELSE false'),
  );
  const columns = new Set(
    [...branch.matchAll(/asset\.([a-z0-9_]+)/g)].map((match) => match[1]),
  );
  assert.ok(columns.size >= 8, 'el tier simple exige varias condiciones, no una');
  for (const column of columns) {
    assert.ok(
      guard.includes(`asset.${column}`),
      `la guarda del fixture no mira asset.${column}`,
    );
  }

  // Procesamiento terminado y aprobación editorial son preguntas distintas:
  // el fixture necesita una foto en `pending_review` y eso no es una violación.
  assert.equal(
    /status\s*=\s*'approved'/.test(guard),
    false,
    'la guarda no puede exigir moderación aprobada',
  );
  assert.match(guard, /status <> 'revoked'/);
});

test('el arranque canónico fija los quince flags que la app declara', () => {
  const source = fs.readFileSync(LAUNCHER, 'utf8');
  // `DATA_ENV`, `STAGING_PROJECT_REF` y el habilitador de Production describen
  // el entorno, no una superficie: el arranque LOCAL no las cuenta como flags.
  const environmentContractKeys = [
    'REACT_APP_TORNEOS_DATA_ENV',
    'REACT_APP_TORNEOS_STAGING_PROJECT_REF',
    'REACT_APP_TORNEOS_PRODUCTION_ENABLED',
  ];
  const declared = new Set(
    (fs.readFileSync(
      path.join(ROOT, 'src', 'features', 'torneos', 'config', 'featureFlags.js'), 'utf8',
    ).match(/REACT_APP_TORNEOS_[A-Z0-9_]+/g) || [])
      .filter((key) => !environmentContractKeys.includes(key)),
  );
  assert.equal(declared.size, 15, 'la app declara quince flags de Torneos');
  for (const key of declared) {
    assert.ok(source.includes(key), `el arranque no fija ${key}`);
  }
  assert.match(source, /REACT_APP_LOCAL_EDIT_MODE: 'false'/);
  assert.match(source, /REACT_APP_TORNEOS_DATA_ENV: 'local'/);
});

test('el arranque no imprime la anon key en ninguna rama', () => {
  const source = fs.readFileSync(LAUNCHER, 'utf8');
  const logsAnonKey = /console\.log\([^)]*\banonKey\b/.test(source);
  assert.equal(logsAnonKey, false, 'la anon key no puede llegar a la salida');
  assert.match(source, /no se imprime/);
});

test('un ref de Supabase remoto heredado aborta el arranque', () => {
  const result = run(LAUNCHER, [], {
    REACT_APP_TORNEOS_STAGING_PROJECT_REF: 'hhyvmhgpapyuzjgxfnqv.supabase.co',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /remoto/i);
});

test('el arranque enciende el selector de rol y es el único lugar que lo hace', () => {
  const source = fs.readFileSync(LAUNCHER, 'utf8');
  assert.match(source, /REACT_APP_TORNEOS_QA_ROLE_SWITCHER: 'true'/);

  // El flag no puede venir de un archivo: si estuviera en .env* alcanzaría con
  // arrancar CRA a mano para tener el selector, y eso es exactamente lo que el
  // gate explícito viene a impedir.
  const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((file) => /(^|\/)\.env/.test(file) && fs.existsSync(path.join(ROOT, file)));
  for (const file of tracked) {
    const contents = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const line = contents.split('\n').find(
      (candidate) => candidate.trim().startsWith('REACT_APP_TORNEOS_QA_ROLE_SWITCHER'),
    );
    assert.equal(
      Boolean(line && /=\s*true\s*$/.test(line)),
      false,
      `${file} no puede dejar el selector encendido`,
    );
  }
});

test('el arranque prepara, verifica y renueva las seis sesiones QA', () => {
  const source = fs.readFileSync(LAUNCHER, 'utf8');

  // Las cuatro condiciones de la renovación: faltante, permisos, origen ajeno y
  // vencimiento próximo. Ninguna se descubre recién al cambiar de rol.
  assert.match(source, /AUTH_STATE_MIN_SECONDS_LEFT = 3600/);
  assert.match(source, /faltan?|falta/);
  assert.match(source, /permisos más laxos que 0600/);
  assert.match(source, /storage state ilegible o de otro origen/);
  assert.match(source, /vencida/);

  // La verificación es contra Auth LOCAL, no contra el archivo.
  assert.match(source, /auth\/v1\/user/);
  assert.match(source, /app_metadata\?\.qa_role !== role/);

  // Se reutiliza el generador canónico: no hay refresh tokens inventados.
  assert.match(source, /prepare-torneos-local-auth-states\.mjs/);
  assert.equal(/refresh_token\s*:/.test(source), false);

  // Y el arranque falla si después de regenerar siguen sin servir.
  assert.match(source, /siguen sin ser utilizables después de regenerarlas/);
});

test('el arranque no imprime el secreto JWT ni el contenido de las sesiones', () => {
  const source = fs.readFileSync(LAUNCHER, 'utf8');
  assert.equal(/console\.log\([^)]*\b(jwtSecret|access_token|session\.)/.test(source), false);
  assert.equal(/console\.log\([^)]*GOTRUE_JWT_SECRET/.test(source), false);
  assert.match(source, /No se puede resolver|No se pudo resolver el secreto JWT/);
});
