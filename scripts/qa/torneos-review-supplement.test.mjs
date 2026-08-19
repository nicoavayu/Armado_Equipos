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

test('el arranque canónico fija los quince flags que la app declara', () => {
  const source = fs.readFileSync(LAUNCHER, 'utf8');
  const declared = new Set(
    (fs.readFileSync(
      path.join(ROOT, 'src', 'features', 'torneos', 'config', 'featureFlags.js'), 'utf8',
    ).match(/REACT_APP_TORNEOS_[A-Z0-9_]+/g) || [])
      .filter((key) => !['REACT_APP_TORNEOS_DATA_ENV', 'REACT_APP_TORNEOS_STAGING_PROJECT_REF']
        .includes(key)),
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
