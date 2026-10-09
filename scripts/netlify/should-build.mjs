import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Netlify `ignore` command: exit 0 cancels the build (no deploy, no credits), exit 1 builds. On the Free plan every
// production deploy costs 15 of the 300 monthly credits, so a merge that changes nothing the web bundle or its
// edge/serverless layer is built from must not publish. Anything not listed here builds: an unknown path, a missing
// or shallow history, or an empty diff all fall through to a build rather than risk skipping a real change.
const NON_WEB = [
  /^backend\//,
  /^supabase\//,
  /^docs\//,
  /^android\//,
  /^ios\//,
  /^integration\//,
  /^\.github\//,
  /^scripts\/(ops|db-integration|qa|torneos-frontend)\//,
  /^[^/]+\.md$/,
];

export function onlyNonWebChanges(files) {
  const changed = files.map((file) => file.trim()).filter(Boolean);
  return changed.length > 0 && changed.every((file) => NON_WEB.some((pattern) => pattern.test(file)));
}

export function decide({ from, to, git = (args) => execFileSync('git', args, { encoding: 'utf8' }) } = {}) {
  if (!from || !to || from === to) return { skip: false, reason: 'no previous build to compare with' };
  let files;
  try {
    files = git(['diff', '--name-only', from, to]).split('\n');
  } catch {
    return { skip: false, reason: 'history unavailable' };
  }
  return onlyNonWebChanges(files)
    ? { skip: true, reason: 'only non-web paths changed' }
    : { skip: false, reason: 'web paths changed' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = decide({ from: process.env.CACHED_COMMIT_REF, to: process.env.COMMIT_REF });
  console.log(`netlify ignore: ${result.skip ? 'skip' : 'build'} (${result.reason})`);
  process.exit(result.skip ? 0 : 1);
}
