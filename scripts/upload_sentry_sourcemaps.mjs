import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const buildStaticDir = path.resolve(process.cwd(), 'build/static');
const requiredUploadEnvNames = [
  'REACT_APP_SENTRY_RELEASE',
  'SENTRY_AUTH_TOKEN',
  'SENTRY_ORG',
  'SENTRY_PROJECT',
];

const getEnvValue = (name) => String(process.env[name] || '').trim();

const missingUploadEnvNames = requiredUploadEnvNames.filter((name) => !getEnvValue(name));

if (missingUploadEnvNames.length > 0) {
  console.warn(
    `[sentry:sourcemaps] Upload skipped. Missing envs: ${missingUploadEnvNames.join(', ')}`,
  );
  process.exit(0);
}

if (!existsSync(buildStaticDir)) {
  console.error(
    `[sentry:sourcemaps] Missing build output at ${buildStaticDir}. Run npm run build:web:release first.`,
  );
  process.exit(1);
}

const hasSourceMapFiles = (directory) => {
  const entries = readdirSync(directory, { withFileTypes: true });

  return entries.some((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return hasSourceMapFiles(entryPath);
    return entry.isFile() && entry.name.endsWith('.map');
  });
};

if (!hasSourceMapFiles(buildStaticDir)) {
  console.error(
    '[sentry:sourcemaps] No .map files found under build/static. Build must be created with GENERATE_SOURCEMAP=true.',
  );
  process.exit(1);
}

const release = getEnvValue('REACT_APP_SENTRY_RELEASE');
const org = getEnvValue('SENTRY_ORG');
const project = getEnvValue('SENTRY_PROJECT');
const cliCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const runCli = (args, { allowFailure = false } = {}) => {
  const result = spawnSync(
    cliCommand,
    ['sentry-cli', '--org', org, '--project', project, ...args],
    {
      stdio: 'inherit',
      env: process.env,
    },
  );

  if (result.status !== 0 && !allowFailure) {
    process.exit(result.status ?? 1);
  }

  return result.status ?? 1;
};

console.info(`[sentry:sourcemaps] Ensuring release exists: ${release}`);

const releaseExists = runCli(['releases', 'info', release], { allowFailure: true }) === 0;
if (!releaseExists) {
  runCli(['releases', 'new', release]);
}

console.info(`[sentry:sourcemaps] Uploading sourcemaps for release ${release}`);

runCli([
  'sourcemaps',
  'upload',
  '--release',
  release,
  '--url-prefix',
  '~/static',
  '--validate',
  '--wait',
  buildStaticDir,
]);

console.info('[sentry:sourcemaps] Upload complete');
