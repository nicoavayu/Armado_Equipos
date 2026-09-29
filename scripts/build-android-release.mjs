#!/usr/bin/env node
// Android RELEASE web build with Torneos Production enabled.
//
// REACT_APP_* values are compile-time: the bundle `npx cap sync android` copies
// into the AAB only carries what `npm run build` saw. Vercel Production holds the
// 8 Torneos keys below as Production-only env; a local Android build never saw
// them, so 1.1.22 (42) shipped Torneos as "No disponible en este entorno".
//
// Source of the values: the certified Production web bundle itself
// (https://app.arma2.com.ar), read at build time, so the AAB compiles exactly
// what Production compiles and nothing is invented or committed (the frontend
// guard forbids committing targets). Offline, `--env-file <path>` reads the same
// 8 keys from a git-ignored dotenv file instead.
//
//   node scripts/build-android-release.mjs                     values from live Production, build, verify
//   node scripts/build-android-release.mjs --env-file <path>   values from an ignored file, build, verify
//   node scripts/build-android-release.mjs --verify-only       verify build/ against live Production
//
// Debug/local builds keep using plain `npm run build` and their own .env files:
// without this script Torneos stays closed, as before.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { loadBuildEnvironment } from './build-env.mjs';

export const PRODUCTION_WEB_ORIGIN = 'https://app.arma2.com.ar';

// Exactly the Torneos keys Production enables. Commerce, billing, Mercado Pago,
// media and the social generator are deliberately absent and refused.
export const TORNEOS_ANDROID_PRODUCTION_KEYS = Object.freeze([
  'REACT_APP_PRODUCTION_PROJECT_REF',
  'REACT_APP_TORNEOS_DATA_ENV',
  'REACT_APP_TORNEOS_ENABLED',
  'REACT_APP_TORNEOS_GATEWAY_URL',
  'REACT_APP_TORNEOS_PRODUCTION_ENABLED',
  'REACT_APP_TORNEOS_PUBLIC_PAGES_ENABLED',
  'REACT_APP_TORNEOS_WORKSPACES_ENABLED',
  'REACT_APP_TORNEOS_WORKSPACE_SWITCHER_ENABLED',
]);

const FIXED_VALUES = Object.freeze({
  REACT_APP_TORNEOS_DATA_ENV: 'production',
  REACT_APP_TORNEOS_ENABLED: 'true',
  REACT_APP_TORNEOS_PRODUCTION_ENABLED: 'true',
  REACT_APP_TORNEOS_PUBLIC_PAGES_ENABLED: 'true',
  REACT_APP_TORNEOS_WORKSPACES_ENABLED: 'true',
  REACT_APP_TORNEOS_WORKSPACE_SWITCHER_ENABLED: 'true',
});

export const FORBIDDEN_ENV = /^REACT_APP_(TORNEOS_BILLING|TORNEOS_MEDIA|TORNEOS_SOCIAL|.*MERCADO|.*COMMERCE|.*PAYMENT)/;
const FORBIDDEN_BUNDLE_MARKERS = ['APP_USR-', 'api.mercadopago.com'];
const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36';

const fail = (message) => {
  console.error(`build-android-release: ${message}`);
  process.exit(1);
};

/**
 * The REACT_APP_* string entries of the process.env object literal CRA compiles
 * into the bundle. Parsed as data (never evaluated): it reads a downloaded file.
 */
export function readCompiledEnv(bundleSource) {
  const start = bundleSource.indexOf('{NODE_ENV:"production"');
  if (start < 0) return null;
  const env = {};
  const entry = /(REACT_APP_[A-Z0-9_]+):("(?:[^"\\]|\\.)*")/y;
  for (let i = start; i < bundleSource.length && i < start + 20000; i += 1) {
    entry.lastIndex = i;
    const match = entry.exec(bundleSource);
    if (match && !(match[1] in env)) env[match[1]] = JSON.parse(match[2]);
  }
  return env;
}

/** The 8 keys picked from `source`, validated. Throws on any missing or unsafe value. */
export function pickTorneosProductionEnv(source = {}) {
  const env = {};
  for (const key of TORNEOS_ANDROID_PRODUCTION_KEYS) {
    const value = String(source[key] ?? '').trim();
    if (!value) throw new Error(`${key} is missing`);
    if (key in FIXED_VALUES && value !== FIXED_VALUES[key]) throw new Error(`${key} must be ${FIXED_VALUES[key]}`);
    env[key] = value;
  }
  const ref = env.REACT_APP_PRODUCTION_PROJECT_REF;
  if (!/^[a-z]{20}$/.test(ref)) throw new Error('REACT_APP_PRODUCTION_PROJECT_REF is not a project ref');
  const gateway = new URL(env.REACT_APP_TORNEOS_GATEWAY_URL);
  if (gateway.protocol !== 'https:' || gateway.username || gateway.password || gateway.search || gateway.hash) {
    throw new Error('REACT_APP_TORNEOS_GATEWAY_URL must be a plain https URL');
  }
  if (gateway.hostname.toLowerCase().split('.').includes(ref)) {
    throw new Error('REACT_APP_TORNEOS_GATEWAY_URL names the Core Production project');
  }
  return Object.freeze(env);
}

export function diffProfile(compiledEnv, profile) {
  return Object.entries(profile)
    .filter(([key, value]) => compiledEnv?.[key] !== value)
    .map(([key, value]) => `${key}: expected ${JSON.stringify(value)}, got ${JSON.stringify(compiledEnv?.[key])}`);
}

async function readLiveProductionEnv() {
  // The web access gate serves a landing to desktop agents and the SPA to mobile ones.
  const headers = { 'user-agent': MOBILE_UA };
  const html = await (await fetch(`${PRODUCTION_WEB_ORIGIN}/torneos`, { headers })).text();
  const mainPath = html.match(/\/static\/js\/main\.[a-f0-9]+\.js/)?.[0];
  if (!mainPath) fail('could not find the Production main bundle');
  const compiled = readCompiledEnv(await (await fetch(`${PRODUCTION_WEB_ORIGIN}${mainPath}`, { headers })).text());
  if (!compiled) fail(`${mainPath} has no compiled env`);
  const env = pickTorneosProductionEnv(compiled);
  console.log(`build-android-release: Torneos Production profile read from ${PRODUCTION_WEB_ORIGIN}${mainPath} (8/8)`);
  return env;
}

function readEnvFile(file) {
  if (!fs.existsSync(file)) fail(`--env-file ${file} not found`);
  const env = pickTorneosProductionEnv(dotenv.parse(fs.readFileSync(file)));
  console.log(`build-android-release: Torneos Production profile read from ${file} (8/8)`);
  return env;
}

function verifyBuild(profile) {
  const jsDir = path.join('build', 'static', 'js');
  const main = fs.readdirSync(jsDir).find((name) => /^main\.[a-f0-9]+\.js$/.test(name));
  if (!main) fail('verify: build/static/js/main.*.js not found');
  const compiled = readCompiledEnv(fs.readFileSync(path.join(jsDir, main), 'utf8')) || {};
  const drift = diffProfile(compiled, profile);
  if (drift.length) fail(`verify: ${main} does not carry the profile\n  ${drift.join('\n  ')}`);
  const forbiddenKeys = Object.keys(compiled).filter((key) => FORBIDDEN_ENV.test(key));
  if (forbiddenKeys.length) fail(`verify: ${main} carries ${forbiddenKeys.join(', ')}`);
  const allJs = fs.readdirSync(jsDir).filter((name) => name.endsWith('.js'))
    .map((name) => fs.readFileSync(path.join(jsDir, name), 'utf8')).join('\n');
  const markers = FORBIDDEN_BUNDLE_MARKERS.filter((marker) => allJs.includes(marker));
  if (markers.length) fail(`verify: bundle contains ${markers.join(', ')}`);
  console.log(`build-android-release: ${main} carries the Torneos Production profile (8/8), no commerce/billing/MP`);
}

async function main() {
  const args = process.argv.slice(2);
  const envFileIndex = args.indexOf('--env-file');
  const profile = envFileIndex >= 0 ? readEnvFile(args[envFileIndex + 1] || '') : await readLiveProductionEnv();

  if (args.includes('--verify-only')) {
    verifyBuild(profile);
    return;
  }

  // The profile must be the only source of these keys: a stray value in the
  // shell environment or a .env file would otherwise be mixed in.
  loadBuildEnvironment();
  const conflicts = Object.entries(profile)
    .filter(([key, value]) => process.env[key] !== undefined && process.env[key] !== value)
    .map(([key]) => key);
  if (conflicts.length) fail(`environment already sets ${conflicts.join(', ')} to another value`);

  // Torneos Production only opens when Core is exactly the certified project.
  const expectedCore = `https://${profile.REACT_APP_PRODUCTION_PROJECT_REF}.supabase.co`;
  if (String(process.env.REACT_APP_SUPABASE_URL || '').trim().replace(/\/$/, '') !== expectedCore) {
    fail('REACT_APP_SUPABASE_URL is not the Core Production project; refusing a mixed build');
  }

  const result = spawnSync('npm', ['run', 'build'], {
    stdio: 'inherit',
    env: { ...process.env, ...profile },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
  verifyBuild(profile);
}

const isMain = process.argv[1] && new URL(`file://${process.argv[1]}`).href === import.meta.url;
if (isMain) {
  main().catch((error) => fail(error.message));
}
