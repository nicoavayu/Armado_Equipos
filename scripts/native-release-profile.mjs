// The Torneos release profile shared by the native (Capacitor) builds: Android and iOS compile exactly the same keys.
//
// REACT_APP_* values are compile-time: the bundle `npx cap sync <platform>` copies into the binary only carries what
// `npm run build` saw. The values are read from the certified Production web bundle itself
// (https://app.arma2.com.ar, the compiled `process.env` literal), so a native build compiles what Production compiles
// and nothing is invented or committed (the frontend guard forbids committing targets). Offline, `--env-file <path>`
// reads the same keys from a git-ignored dotenv file instead.
//
// The native apps are a free companion of the paid web tool (Apple 3.1.3(f), Google Play «consumption-only»): no price,
// no purchase, no Premium upsell inside the app. Phase 1 adds the connected product and logos/shields to the 8 keys
// the Android release already carried; billing, Mercado Pago, commerce, payments, the plan read («Mi plan», the FREE vs
// PREMIUM table), the Estudio Social and the media galleries stay out and are refused anywhere in the build.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { loadBuildEnvironment } from './build-env.mjs';

export const PRODUCTION_WEB_ORIGIN = 'https://app.arma2.com.ar';

export const TORNEOS_NATIVE_PRODUCTION_KEYS = Object.freeze([
  'REACT_APP_PRODUCTION_PROJECT_REF',
  'REACT_APP_TORNEOS_DATA_ENV',
  'REACT_APP_TORNEOS_ENABLED',
  'REACT_APP_TORNEOS_GATEWAY_URL',
  'REACT_APP_TORNEOS_PRODUCTION_ENABLED',
  'REACT_APP_TORNEOS_PUBLIC_PAGES_ENABLED',
  'REACT_APP_TORNEOS_WORKSPACES_ENABLED',
  'REACT_APP_TORNEOS_WORKSPACE_SWITCHER_ENABLED',
  // Phase 1: the connected product (Explorar, solicitudes, Tus avisos, perfil) and logo/shield uploads. Neither carries
  // money or a file download; both must match the gateway's own modes, which is why they are read from Production too.
  'REACT_APP_TORNEOS_CONNECTED_MODE',
  'REACT_APP_TORNEOS_BRANDING_MODE',
]);

export const NATIVE_FIXED_VALUES = Object.freeze({
  REACT_APP_TORNEOS_DATA_ENV: 'production',
  REACT_APP_TORNEOS_ENABLED: 'true',
  REACT_APP_TORNEOS_PRODUCTION_ENABLED: 'true',
  REACT_APP_TORNEOS_PUBLIC_PAGES_ENABLED: 'true',
  REACT_APP_TORNEOS_WORKSPACES_ENABLED: 'true',
  REACT_APP_TORNEOS_WORKSPACE_SWITCHER_ENABLED: 'true',
  REACT_APP_TORNEOS_CONNECTED_MODE: 'on',
  REACT_APP_TORNEOS_BRANDING_MODE: 'on',
});

// Present with ANY value (even `false`/`off`) these keys fail the build: a native binary never compiles them.
//   BILLING / MERCADO / COMMERCE / PAYMENT: buying a digital good outside the stores' billing.
//   PLAN_READ: «Mi plan», «Ver Premium» and the FREE vs PREMIUM table — an upsell with nothing to buy in the app.
//   SOCIAL: the Studio exports through `<a download>` + Web Share, which the WebViews do not provide (phase 2).
//   MEDIA: galleries download photos the same way and add photo UGC (phase 3).
export const FORBIDDEN_ENV = /^REACT_APP_(TORNEOS_BILLING|TORNEOS_MEDIA|TORNEOS_SOCIAL|TORNEOS_PLAN_READ|.*MERCADO|.*COMMERCE|.*PAYMENT)/;
export const FORBIDDEN_BUNDLE_MARKERS = Object.freeze(['APP_USR-', 'api.mercadopago.com']);
const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36';

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

/** The forbidden keys `env` sets, with any value. */
export function findForbiddenEnv(env = {}) {
  return Object.keys(env || {}).filter((key) => FORBIDDEN_ENV.test(key)).sort();
}

/** Throws when `env` sets any forbidden key. `where` names the source in the message. */
export function assertNoForbiddenEnv(env, where = 'environment') {
  const forbidden = findForbiddenEnv(env);
  if (forbidden.length) throw new Error(`${where} sets ${forbidden.join(', ')}: a native release never compiles them`);
}

/**
 * The profile keys picked from `source` (a full compiled env may carry the web's billing/social/media keys: they are
 * simply not picked), validated. Throws on any missing or unsafe value.
 */
export function pickTorneosProductionEnv(source = {}) {
  const env = {};
  for (const key of TORNEOS_NATIVE_PRODUCTION_KEYS) {
    const value = String(source[key] ?? '').trim();
    if (!value) throw new Error(`${key} is missing`);
    if (key in NATIVE_FIXED_VALUES && value !== NATIVE_FIXED_VALUES[key]) {
      throw new Error(`${key} must be ${NATIVE_FIXED_VALUES[key]}`);
    }
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
  assertNoForbiddenEnv(env, 'profile');
  return Object.freeze(env);
}

export function diffProfile(compiledEnv, profile) {
  return Object.entries(profile)
    .filter(([key, value]) => compiledEnv?.[key] !== value)
    .map(([key, value]) => `${key}: expected ${JSON.stringify(value)}, got ${JSON.stringify(compiledEnv?.[key])}`);
}

const profileCount = () => `${TORNEOS_NATIVE_PRODUCTION_KEYS.length}/${TORNEOS_NATIVE_PRODUCTION_KEYS.length}`;

/** Reads the profile from the live Production web bundle. `fetchImpl` is injectable: tests never hit the network. */
export async function readLiveProductionEnv({ fetchImpl = fetch, log = console.log, label = 'native-release' } = {}) {
  // The web access gate serves a landing to desktop agents and the SPA to mobile ones.
  const headers = { 'user-agent': MOBILE_UA };
  const html = await (await fetchImpl(`${PRODUCTION_WEB_ORIGIN}/torneos`, { headers })).text();
  const mainPath = html.match(/\/static\/js\/main\.[a-f0-9]+\.js/)?.[0];
  if (!mainPath) throw new Error('could not find the Production main bundle');
  const compiled = readCompiledEnv(await (await fetchImpl(`${PRODUCTION_WEB_ORIGIN}${mainPath}`, { headers })).text());
  if (!compiled) throw new Error(`${mainPath} has no compiled env`);
  const env = pickTorneosProductionEnv(compiled);
  log(`${label}: Torneos Production profile read from ${PRODUCTION_WEB_ORIGIN}${mainPath} (${profileCount()})`);
  return env;
}

export function readEnvFile(file, { log = console.log, label = 'native-release' } = {}) {
  if (!file || !fs.existsSync(file)) throw new Error(`--env-file ${file} not found`);
  const env = pickTorneosProductionEnv(dotenv.parse(fs.readFileSync(file)));
  log(`${label}: Torneos Production profile read from ${file} (${profileCount()})`);
  return env;
}

/** Verifies a finished web build: it carries the profile and nothing commercial. Throws on any drift. */
export function verifyBuild(profile, { buildDir = 'build', log = console.log, label = 'native-release' } = {}) {
  const jsDir = path.join(buildDir, 'static', 'js');
  const main = fs.existsSync(jsDir) && fs.readdirSync(jsDir).find((name) => /^main\.[a-f0-9]+\.js$/.test(name));
  if (!main) throw new Error(`verify: ${jsDir}/main.*.js not found`);
  const compiled = readCompiledEnv(fs.readFileSync(path.join(jsDir, main), 'utf8')) || {};
  const drift = diffProfile(compiled, profile);
  if (drift.length) throw new Error(`verify: ${main} does not carry the profile\n  ${drift.join('\n  ')}`);
  const forbiddenKeys = findForbiddenEnv(compiled);
  if (forbiddenKeys.length) throw new Error(`verify: ${main} carries ${forbiddenKeys.join(', ')}`);
  const allJs = fs.readdirSync(jsDir).filter((name) => name.endsWith('.js'))
    .map((name) => fs.readFileSync(path.join(jsDir, name), 'utf8')).join('\n');
  const markers = FORBIDDEN_BUNDLE_MARKERS.filter((marker) => allJs.includes(marker));
  if (markers.length) throw new Error(`verify: bundle contains ${markers.join(', ')}`);
  log(`${label}: ${main} carries the Torneos native profile (${profileCount()}), no commerce/billing/MP/plan/social/media`);
  return main;
}

/**
 * The common release flow: read the profile, refuse a mixed environment, `npm run build` with the profile injected,
 * verify the bundle, then the platform's own steps (`postBuildSteps`: never archive, sign or upload).
 * Every side effect is injectable so the flow is tested without network, build or native tooling.
 */
export async function runNativeRelease({
  label,
  argv = process.argv.slice(2),
  env = process.env,
  postBuildSteps = [],
  fetchImpl = fetch,
  spawn = spawnSync,
  loadEnvironment = loadBuildEnvironment,
  buildDir = 'build',
  log = console.log,
} = {}) {
  const envFileIndex = argv.indexOf('--env-file');
  const profile = envFileIndex >= 0
    ? readEnvFile(argv[envFileIndex + 1] || '', { log, label })
    : await readLiveProductionEnv({ fetchImpl, log, label });

  if (argv.includes('--verify-only')) {
    verifyBuild(profile, { buildDir, log, label });
    return { profile, steps: [] };
  }

  // The profile must be the only source of these keys: a stray value in the
  // shell environment or a .env file would otherwise be mixed in.
  loadEnvironment();
  const conflicts = Object.entries(profile)
    .filter(([key, value]) => env[key] !== undefined && env[key] !== value)
    .map(([key]) => key);
  if (conflicts.length) throw new Error(`environment already sets ${conflicts.join(', ')} to another value`);
  // react-scripts loads the same .env files: a forbidden key there would be compiled in. Refuse before building.
  assertNoForbiddenEnv(env, 'the shell or a .env file');

  // Torneos Production only opens when Core is exactly the certified project.
  const expectedCore = `https://${profile.REACT_APP_PRODUCTION_PROJECT_REF}.supabase.co`;
  if (String(env.REACT_APP_SUPABASE_URL || '').trim().replace(/\/$/, '') !== expectedCore) {
    throw new Error('REACT_APP_SUPABASE_URL is not the Core Production project; refusing a mixed build');
  }

  const steps = [];
  const run = (command, args, extraEnv = {}) => {
    steps.push([command, ...args].join(' '));
    const result = spawn(command, args, { stdio: 'inherit', env: { ...env, ...profile, ...extraEnv } });
    if (result?.status !== 0) {
      const error = new Error(`${[command, ...args].join(' ')} failed`);
      error.exitCode = result?.status ?? 1;
      throw error;
    }
  };

  run('npm', ['run', 'build']);
  verifyBuild(profile, { buildDir, log, label });
  for (const step of postBuildSteps) run(step.command, step.args, step.env);
  return { profile, steps };
}

/** Runs `runNativeRelease` as a CLI: any refusal prints `label: message` and exits non-zero. */
export function runNativeReleaseCli(options) {
  return runNativeRelease(options).catch((error) => {
    console.error(`${options.label}: ${error.message}`);
    process.exit(error.exitCode ?? 1);
  });
}
