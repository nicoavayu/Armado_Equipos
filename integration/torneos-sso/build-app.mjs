import { spawnSync } from 'node:child_process';
import { readFile, readdir, cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { config } from './lab.mjs';
const app = fileURLToPath(new URL('../../', import.meta.url));
// CRA reads .env files implicitly; fail before building if any runtime env exists.
if ((await readdir(app)).some(name => /^\.env($|\.(local|production|development|test)(\.|$))/.test(name))) {
  throw new Error('Remove runtime .env files from this isolated worktree before building');
}
const cfg = await config();
const env = {
  PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR || '/tmp',
  NODE_ENV: 'production', GENERATE_SOURCEMAP: 'false', DISABLE_ESLINT_PLUGIN: 'true',
  REACT_APP_DEPLOY_ENV: 'test', REACT_APP_LOCAL_EDIT_MODE: 'false',
  REACT_APP_TORNEOS_ISOLATED_SSO: 'true',
  REACT_APP_SUPABASE_URL: 'http://127.0.0.1:58410', REACT_APP_SUPABASE_ANON_KEY: cfg.anonKey,
  REACT_APP_AUTH_REDIRECT_URL: 'http://127.0.0.1:58410/auth/callback',
  REACT_APP_NETLOG: 'false', REACT_APP_SENTRY_ENABLED: 'false', REACT_APP_POSTHOG_ENABLED: 'false',
};
const result = spawnSync(process.execPath, ['node_modules/react-scripts/bin/react-scripts.js', 'build'], {
  cwd: app, env, stdio: 'inherit',
});
if (result.status !== 0) throw new Error('Isolated app build failed');
await mkdir(new URL('dist/', import.meta.url), { recursive: true });
await cp(`${app}build`, fileURLToPath(new URL('dist/', import.meta.url)), { recursive: true });
// Never inject credentials, test hooks, or fixtures into the application bundle.
console.log('Real Core app built with loopback-only configuration');
