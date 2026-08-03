import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { scanRepository, scanText } from './static-guard.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('tracked non-test files contain no credential or unknown Supabase host', () => {
  assert.deepEqual(scanRepository(ROOT), []);
});

test('scanner catches real-shaped credentials and unknown project hosts', () => {
  assert.ok(scanText(
    'eyJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJ0ZXN0LXByb2plY3QifQ.signaturevalue123456',
    'config/runtime.js',
  ).includes('JWT-like credential'));
  assert.ok(scanText(
    'https://unknownremoteproject.supabase.co',
    'config/runtime.js',
  ).some((finding) => finding.includes('unknown Supabase host')));
});
