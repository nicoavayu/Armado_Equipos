import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../..');
const readDoc = (name) => fs.readFileSync(path.join(REPO, 'docs/operations', name), 'utf8');

test('the docs state the actual Compose secret ownership and mount semantics', () => {
  const secretDoc = readDoc('tournament-media-staging-secret-injection.md');
  const runtimeDoc = readDoc('tournament-media-staging-runtime.md');
  for (const text of [secretDoc, runtimeDoc]) {
    assert.match(text, /root:root[^\n]*0700|0700[^\n]*root:root/i,
      'the host secret directory contract root:root 0700 is missing');
    assert.match(text, /1000:1000[^\n]*0400|0400[^\n]*1000:1000/i,
      'the host secret file contract 1000:1000 0400 is missing');
  }
  assert.match(secretDoc, /read-only bind mount/i);
  const containerRow = secretDoc.split('\n').find((line) => line.startsWith('| container filesystem |'));
  const composeSecretCell = containerRow?.split('|')[3] || '';
  assert.doesNotMatch(composeSecretCell, /tmpfs/i,
    'the Compose file-secret cell incorrectly claims tmpfs semantics');
  assert.match(secretDoc, /host path/i);
  assert.match(secretDoc, /heap|memory/i);
});

test('I1 documents the local fail-closed preflight before networking', () => {
  const runtimeDoc = readDoc('tournament-media-staging-runtime.md');
  const i1 = runtimeDoc.split('### I1')[1]?.split('### I2')[0] || '';
  assert.match(i1, /address-space-preflight\.mjs/);
  assert.match(i1, /before|antes/i);
  assert.match(i1, /UNKNOWN[^\n]*blocks I1/i);
  assert.match(i1, /no Hetzner API/i);
});

test('the docs do not attribute destination isolation to ClamAV firewall rules', () => {
  for (const name of ['tournament-media-staging-runtime.md', 'tournament-media-staging-secret-injection.md']) {
    const text = readDoc(name);
    assert.doesNotMatch(text, /clamd cannot reach Supabase(?: at all| on any port)/i);
  }
  const runtimeDoc = readDoc('tournament-media-staging-runtime.md');
  assert.match(runtimeDoc, /clamd has generic tcp\/80,443/i);
  assert.match(runtimeDoc, /no Supabase credential/i);
});
