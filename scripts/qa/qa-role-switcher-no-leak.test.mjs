import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

//
// Las sesiones QA son secretos locales. Este archivo afirma que no se filtran a
// nada que se pueda distribuir: ni al código de la app, ni al bundle, ni a los
// source maps, ni a una variable `REACT_APP_*`.
//
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const AUTH_STATE_DIRECTORY = path.join(REPO_ROOT, '.secrets', 'torneos-review-auth');
const BUILD_DIRECTORY = path.join(REPO_ROOT, 'build');
const QA_ROLES = ['owner', 'admin', 'collaborator', 'delegate', 'player', 'outsider'];

function walk(directory, extensions) {
  const found = [];
  const pending = [directory];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        pending.push(full);
        continue;
      }
      if (!extensions || extensions.some((extension) => entry.name.endsWith(extension))) {
        found.push(full);
      }
    }
  }
  return found;
}

function readLocalTokens() {
  if (!fs.existsSync(AUTH_STATE_DIRECTORY)) return [];
  const tokens = [];
  for (const role of QA_ROLES) {
    const file = path.join(AUTH_STATE_DIRECTORY, `${role}.json`);
    if (!fs.existsSync(file)) continue;
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const origin of state.origins || []) {
      for (const entry of origin.localStorage || []) {
        try {
          const session = JSON.parse(entry.value);
          if (session?.access_token) tokens.push(session.access_token);
          if (session?.refresh_token) tokens.push(session.refresh_token);
        } catch {
          // Un storage state ilegible ya lo rechaza el puente.
        }
      }
    }
  }
  return tokens;
}

test('el puente del dev-server no entra en el grafo de módulos de la app', () => {
  const sources = walk(path.join(REPO_ROOT, 'src'), ['.js', '.jsx', '.ts', '.tsx']);
  const importers = sources.filter((file) => {
    if (file.endsWith(path.join('src', 'setupProxy.js'))) return false;
    const contents = fs.readFileSync(file, 'utf8');
    return /setupProxy|qa-role-bridge/.test(contents);
  });
  assert.deepEqual(importers, [], 'ningún módulo de src puede importar el puente');
});

test('el código de la app no nombra el directorio de sesiones QA', () => {
  const offenders = walk(path.join(REPO_ROOT, 'src'), ['.js', '.jsx', '.ts', '.tsx'])
    .filter((file) => /\.secrets[/\\]torneos-review-auth/.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(REPO_ROOT, file));
  assert.deepEqual(offenders, []);
});

test('ninguna variable REACT_APP_* transporta una sesión', () => {
  const tokens = readLocalTokens();
  const suspicious = Object.entries(process.env)
    .filter(([key]) => key.startsWith('REACT_APP_'))
    .filter(([, value]) => tokens.some((token) => String(value || '').includes(token)));
  assert.deepEqual(suspicious, []);

  // El flag explícito es un booleano, jamás un portador de credenciales.
  const flag = String(process.env.REACT_APP_TORNEOS_QA_ROLE_SWITCHER || '');
  assert.equal(['', 'true', 'false'].includes(flag), true);
});

test('el flag del selector no queda encendido en .env.example', () => {
  const example = path.join(REPO_ROOT, '.env.example');
  if (!fs.existsSync(example)) return;
  const contents = fs.readFileSync(example, 'utf8');
  const line = contents.split('\n').find(
    (candidate) => candidate.trim().startsWith('REACT_APP_TORNEOS_QA_ROLE_SWITCHER'),
  );
  if (!line) return;
  assert.equal(/=\s*true\s*$/.test(line), false, 'el flag no puede venir en true por archivo');
});

test('el build compilado no contiene sesiones QA ni el puente', {
  skip: !fs.existsSync(BUILD_DIRECTORY) && 'no hay build/ compilado en este checkout',
}, () => {
  const tokens = readLocalTokens();
  assert.notEqual(tokens.length, 0, 'la verificación necesita las sesiones QA presentes');
  const assets = walk(BUILD_DIRECTORY, null);
  const leaks = [];
  for (const asset of assets) {
    const contents = fs.readFileSync(asset, 'latin1');
    if (tokens.some((token) => contents.includes(token))) leaks.push(`token:${asset}`);
    if (contents.includes('torneos-review-auth')) leaks.push(`path:${asset}`);
    if (contents.includes('mountQaRoleBridge')) leaks.push(`bridge:${asset}`);
  }
  assert.deepEqual(leaks.map((entry) => path.relative(REPO_ROOT, entry)), []);
});
