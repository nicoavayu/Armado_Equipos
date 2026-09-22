import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { KNOWN_DECOY_HOSTS, KNOWN_EVIDENCE_JWTS, scanRepository, scanText } from './static-guard.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const JWT = /eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}/g;
const RUNTIME_FILE = 'config/runtime.js';
const [DECOY] = KNOWN_DECOY_HOSTS;
const DECOY_URL = 'https://abcdefghijklmnopqrst.supabase.co';
const [EVIDENCE] = KNOWN_EVIDENCE_JWTS;

test('tracked non-test files contain no credential or unknown Supabase host', () => {
  assert.deepEqual(scanRepository(ROOT), []);
});

test('scanner catches real-shaped credentials and unknown project hosts', () => {
  assert.ok(scanText(
    'eyJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJ0ZXN0LXByb2plY3QifQ.signaturevalue123456',
    RUNTIME_FILE,
  ).includes('JWT-like credential'));
  assert.ok(scanText(
    'https://unknownremoteproject.supabase.co',
    RUNTIME_FILE,
  ).some((finding) => finding.includes('unknown Supabase host')));
});

test('a .com domain is not read as a .supabase.co project host', () => {
  assert.deepEqual(scanText('[OpenAPI](https://api.supabase.com/api/v1-json)', 'docs/x.md'), []);
  // A real .supabase.co ref is still caught whatever follows it.
  for (const suffix of ['', '/rest/v1', ':443', '"', ')', '.attacker.example']) {
    assert.deepEqual(scanText(`https://qwertyuiopasdfghjklz.supabase.co${suffix}`, 'docs/x.md'),
      ['unknown Supabase host qwertyuiopasdfghjklz.supabase.co'], `suffix ${JSON.stringify(suffix)}`);
  }
});

test('the R4 decoy host is exempt only in its harness literal', () => {
  const harness = fs.readFileSync(path.join(ROOT, DECOY.file), 'utf8');
  assert.ok(harness.includes(DECOY.literal), 'decoy literal must still exist in the harness');
  assert.deepEqual(scanText(harness, DECOY.file), []);

  const unknown = [`unknown Supabase host ${new URL(DECOY_URL).host}`];
  // Same host outside the literal, in the same file.
  assert.deepEqual(scanText(`${harness}\nfetch('${DECOY_URL}/rest/v1')`, DECOY.file), unknown);
  // Same literal in any other file.
  assert.deepEqual(scanText(DECOY.literal, RUNTIME_FILE), unknown);
  assert.deepEqual(scanText(DECOY.literal, 'backend/torneos/phase3b/r4/harness/other.ts'), unknown);
  // A different real-shaped ref in the harness file.
  assert.deepEqual(scanText(`${harness}\n['x','https://zyxwvutsrqponmlkjihg.supabase.co']`, DECOY.file),
    ['unknown Supabase host zyxwvutsrqponmlkjihg.supabase.co']);
});

test('the certified lab anon JWT is exempt only in its evidence file', () => {
  const evidence = fs.readFileSync(path.join(ROOT, EVIDENCE.file), 'utf8');
  const tokens = [...new Set(evidence.match(JWT))];
  assert.equal(tokens.length, 1, 'evidence must hold exactly the one pinned token');
  assert.deepEqual(scanText(evidence, EVIDENCE.file), []);

  const [labToken] = tokens;
  const other = 'eyJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJ1bmV4cGVjdGVkIn0.anothersignature123456';
  // Pinned token anywhere else, including elsewhere under evidence/.
  assert.deepEqual(scanText(labToken, RUNTIME_FILE), ['JWT-like credential']);
  assert.deepEqual(scanText(labToken, 'integration/torneos-sso/evidence/app-results.json'), ['JWT-like credential']);
  // An unexpected JWT next to the pinned one in the evidence file.
  assert.deepEqual(scanText(`${evidence}\n${other}`, EVIDENCE.file), ['JWT-like credential']);
  // A one-character change to the pinned token.
  const tampered = labToken.slice(0, -1) + (labToken.endsWith('A') ? 'B' : 'A');
  assert.deepEqual(scanText(tampered, EVIDENCE.file), ['JWT-like credential']);
});

test('new credentials are still caught, including in exempted files', () => {
  // Built at runtime so this file never carries a scanner-shaped secret.
  const secretKey = `sb_${'secret'}_${'Q'.repeat(32)}`;
  const privateKey = `-----BEGIN ${'PRIVATE'} KEY-----\n${'M'.repeat(64)}\n-----END ${'PRIVATE'} KEY-----`;
  for (const file of [RUNTIME_FILE, DECOY.file, EVIDENCE.file]) {
    assert.deepEqual(scanText(secretKey, file), ['Supabase secret key value'], file);
    assert.deepEqual(scanText(privateKey, file), ['private-key payload'], file);
  }
});
