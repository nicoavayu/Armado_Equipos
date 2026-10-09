#!/usr/bin/env node
// Compares two outputs of catalog.sql (structure only): what the repository schema has at
// Production's ledger point vs what Production really has. Prints every difference, and marks
// the ones that touch an object the #193 stack (20261010120000…) creates, changes or reads.
//   node docs/database/core-review/runbook/catalog-diff.mjs <expected.json> <production.json>
// Exit code 1 when a difference touches the stack (review it before applying), 0 otherwise.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const [expectedPath, actualPath] = process.argv.slice(2);
if (!expectedPath || !actualPath) {
  console.error('usage: catalog-diff.mjs <expected.json> <production.json>');
  process.exit(2);
}
const load = (path) => JSON.parse(readFileSync(path, 'utf8').trim().split('\n').find((line) => line.startsWith('{')));
const expected = load(expectedPath);
const actual = load(actualPath);

// Objects the stack names (public.x / app_private.x: tables, views, functions), from the migration files.
// Note: a dump/restore round trip also shows cosmetic differences (CHECK texts with other
// parentheses, an owner-only ACL written out vs left default); those are not drift.
const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const stackDir = `${repo}supabase/migrations/`;
const stackNames = new Set();
for (const file of readdirSync(stackDir).filter((f) => /^20261010\d{6}_.*\.sql$/.test(f))) {
  const source = readFileSync(stackDir + file, 'utf8').replace(/--[^\n]*/g, '');
  for (const m of source.matchAll(/\b(?:public|app_private)\.([a-z_][a-z0-9_]*)/g)) stackNames.add(m[1]);
}
// Keys are schema.object[.column|.constraint|.trigger|(args)]: the object decides.
const touchesStack = (key) => stackNames.has((key.split('.')[1] || '').split('(')[0]);

const sections = ['columns', 'relations', 'constraints', 'indexes', 'policies', 'triggers', 'functions', 'roles', 'extensions', 'publications', 'schemas'];
let relevant = 0;
let total = 0;
for (const section of sections) {
  const a = expected[section] || {};
  const b = actual[section] || {};
  const lines = [];
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const left = JSON.stringify(a[key] ?? null);
    const right = JSON.stringify(b[key] ?? null);
    if (left === right) continue;
    const kind = a[key] === undefined ? 'ONLY IN PRODUCTION' : b[key] === undefined ? 'MISSING IN PRODUCTION' : 'DIFFERENT';
    const hit = touchesStack(key);
    total += 1;
    if (hit) relevant += 1;
    lines.push(`${hit ? '!!' : '  '} ${kind.padEnd(21)} ${key}${kind === 'DIFFERENT' ? `\n        repo: ${left}\n        prod: ${right}` : ''}`);
  }
  if (lines.length) console.log(`\n## ${section} (${lines.length})\n${lines.sort().join('\n')}`);
}
console.log(`\nledger: repo ${JSON.stringify(expected.ledger?.slice(-6))} / prod ${JSON.stringify(actual.ledger?.slice(-6))}`);
console.log(`\n${total} differences, ${relevant} touching objects the #193 stack uses (marked !!).`);
process.exit(relevant ? 1 : 0);
