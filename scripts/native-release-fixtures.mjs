// Test fixtures for the native release scripts. Placeholder targets only: real ones are read from Production at
// build time, and no test touches the network (fetch, spawn and the build directory are all fakes).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const REF = 'abcdefghijklmnopqrst';

export const validProfile = Object.freeze({
  REACT_APP_PRODUCTION_PROJECT_REF: REF,
  REACT_APP_TORNEOS_DATA_ENV: 'production',
  REACT_APP_TORNEOS_ENABLED: 'true',
  REACT_APP_TORNEOS_GATEWAY_URL: 'https://gateway.example.test/functions/v1/torneos-gateway',
  REACT_APP_TORNEOS_PRODUCTION_ENABLED: 'true',
  REACT_APP_TORNEOS_PUBLIC_PAGES_ENABLED: 'true',
  REACT_APP_TORNEOS_WORKSPACES_ENABLED: 'true',
  REACT_APP_TORNEOS_WORKSPACE_SWITCHER_ENABLED: 'true',
  REACT_APP_TORNEOS_CONNECTED_MODE: 'on',
  REACT_APP_TORNEOS_BRANDING_MODE: 'on',
});

// What the live Production web compiles today: the profile plus the web-only commercial, plan, social and media keys.
export const productionWebEnv = Object.freeze({
  ...validProfile,
  REACT_APP_SUPABASE_URL: `https://${REF}.supabase.co`,
  REACT_APP_TORNEOS_BILLING_MODE: 'production',
  REACT_APP_TORNEOS_PLAN_READ_MODE: 'on',
  REACT_APP_TORNEOS_SOCIAL_GENERATOR_ENABLED: 'true',
  REACT_APP_TORNEOS_MEDIA_MODE: 'on',
  REACT_APP_TORNEOS_MEDIA_ENABLED: 'true',
});

export const bundleWith = (env) => {
  const entries = Object.entries(env).map(([k, v]) => `${k}:${JSON.stringify(v)}`).join(',');
  return `var a=1;const e={NODE_ENV:"production",PUBLIC_URL:"",${entries},REACT_APP_VERCEL_OBSERVABILITY_CLIENT_CONFIG:{"viewEndpoint":"x"}};`;
};

/** A fetch that serves the Production HTML and main bundle from memory and records every URL. */
export function fakeProductionFetch(compiledEnv = productionWebEnv, { mainName = 'main.0123abcd.js' } = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    const body = String(url).endsWith('/torneos')
      ? `<html><script defer src="/static/js/${mainName}"></script></html>`
      : bundleWith(compiledEnv);
    return { text: async () => body };
  };
  return { fetchImpl, calls };
}

/** A temporary `build/` with one main bundle compiled from `env` (and optional extra chunks). */
export function makeBuildDir(env, { extraChunks = {} } = {}) {
  const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-release-'));
  writeBundle(buildDir, env, extraChunks);
  return buildDir;
}

export function writeBundle(buildDir, env, extraChunks = {}) {
  const jsDir = path.join(buildDir, 'static', 'js');
  fs.mkdirSync(jsDir, { recursive: true });
  for (const name of fs.readdirSync(jsDir)) fs.rmSync(path.join(jsDir, name));
  fs.writeFileSync(path.join(jsDir, 'main.abc123.js'), bundleWith(env));
  for (const [name, source] of Object.entries(extraChunks)) fs.writeFileSync(path.join(jsDir, name), source);
}

export const silent = () => {};
