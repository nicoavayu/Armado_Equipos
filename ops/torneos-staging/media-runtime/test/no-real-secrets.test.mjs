/**
 * Nothing this change adds may contain a real credential.
 *
 * The scan is over every file the change introduces, not only the manifests: a
 * runbook is exactly where a working example gets pasted, and a `.example` file
 * is exactly where someone fills in a real value "just to test it".
 *
 * It looks for credential SHAPES rather than for a list of known values, so it
 * catches a key nobody has told it about. That is also why it has to be
 * careful: `hhyvmhgpapyuzjgxfnqv` is a project ref, twenty lowercase
 * alphanumerics, and a naive high-entropy rule would flag it on every line.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../..');
const RUNTIME = path.join(HERE, '..');

/** Every file this change adds. */
const SCANNED = [
  ...walk(RUNTIME),
  path.join(REPO, 'workers/tournament-media-signer-renewer/Dockerfile'),
  path.join(REPO, 'docs/operations/tournament-media-staging-runtime.md'),
  path.join(REPO, 'docs/operations/tournament-media-staging-secret-injection.md'),
  path.join(REPO, 'docs/operations/tournament-media-staging-rollback.md'),
];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const PATTERNS = [
  // A JWT: three base64url segments, and a header that decodes to something
  // starting `{"alg"`. The gateway credential and the legacy anon/service keys
  // are all this shape.
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, 'a JWT'],
  // Supabase's current key formats.
  [/\bsb_secret_[A-Za-z0-9_-]{8,}/, 'a Supabase secret key'],
  [/\bsb_publishable_[A-Za-z0-9_-]{8,}/, 'a Supabase publishable key'],
  // A PEM private key of any flavour.
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key'],
  // A Hetzner API token: 64 mixed-case alphanumerics.
  [/\b[A-Za-z0-9]{64}\b/, 'a 64-character API token'],
];

test('no file this change adds contains anything shaped like a credential', () => {
  for (const file of SCANNED) {
    const text = fs.readFileSync(file, 'utf8');
    for (const [pattern, what] of PATTERNS) {
      const hit = pattern.exec(text);
      assert.equal(hit, null,
        `${path.relative(REPO, file)} contains ${what}: ${String(hit?.[0]).slice(0, 12)}…`);
    }
  }
});

test('no credential-shaped assignment appears in the example environment', () => {
  const env = fs.readFileSync(path.join(RUNTIME, 'env.example'), 'utf8');
  for (const line of env.split('\n')) {
    if (!/^[A-Z][A-Z0-9_]*=/.test(line)) continue;
    const [key, ...rest] = line.split('=');
    const value = rest.join('=');
    // A credential-shaped NAME may not appear here at all: this file becomes
    // the container environment, which `docker inspect` prints.
    assert.ok(!/(SERVICE_ROLE|_SECRET|_KEY|JWT|TOKEN|PASSWORD)$/.test(key),
      `env.example assigns ${key}, which belongs in the secrets block`);
    assert.ok(value.length < 96, `${key} carries an implausibly long value`);
  }
});

test('the secret files are named but never created by this repository', () => {
  // The repository must not contain the directory the manifest expects, or a
  // reviewer running `docker compose` locally could pick up placeholder files
  // and believe the stack is configured.
  for (const candidate of ['secrets', 'secret', '.secrets']) {
    assert.ok(!fs.existsSync(path.join(RUNTIME, candidate)),
      `${candidate}/ exists inside the runtime directory`);
  }
});

test('git tracks no file under the runtime directory that looks like a secret drop', () => {
  const tracked = walk(RUNTIME).map((f) => path.relative(RUNTIME, f));
  for (const file of tracked) {
    assert.ok(!/\.env$|\.pem$|\.key$|\.p12$|credentials?$/i.test(file),
      `${file} is the kind of file a credential gets left in`);
  }
});
