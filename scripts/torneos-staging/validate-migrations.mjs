#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { MIGRATIONS } from './manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIGRATIONS_DIR = path.join(ROOT, 'supabase', 'migrations');
const failures = [];
const seenVersions = new Set();

for (const [index, migration] of MIGRATIONS.entries()) {
  const migrationPath = path.join(MIGRATIONS_DIR, migration.file);
  const expectedVersion = migration.file.split('_', 1)[0];

  if (migration.version !== expectedVersion) {
    failures.push(`${migration.file}: versión del manifiesto inconsistente`);
  }
  if (seenVersions.has(migration.version)) {
    failures.push(`${migration.file}: versión duplicada`);
  }
  seenVersions.add(migration.version);
  if (index > 0 && MIGRATIONS[index - 1].version >= migration.version) {
    failures.push(`${migration.file}: orden no creciente`);
  }
  for (const dependency of migration.dependsOn) {
    if (!MIGRATIONS.slice(0, index).some(({ version }) => version === dependency)) {
      failures.push(`${migration.file}: dependencia ausente o posterior ${dependency}`);
    }
  }
  if (!fs.existsSync(migrationPath)) {
    failures.push(`${migration.file}: archivo ausente`);
    continue;
  }
  const digest = crypto
    .createHash('sha256')
    .update(fs.readFileSync(migrationPath))
    .digest('hex');
  if (digest !== migration.sha256) {
    failures.push(`${migration.file}: SHA-256 cambió (${digest})`);
  }
}

const torneosFiles = fs.readdirSync(MIGRATIONS_DIR)
  .filter((name) => /^\d{14}_tournament_.*\.sql$/.test(name))
  .sort();
const manifestFiles = MIGRATIONS.map(({ file }) => file);
if (JSON.stringify(torneosFiles) !== JSON.stringify(manifestFiles)) {
  failures.push(
    `inventario divergente\n  disco: ${torneosFiles.join(', ')}\n  manifiesto: ${manifestFiles.join(', ')}`,
  );
}

if (failures.length) {
  console.error(`STAGING_MIGRATIONS_INVALID\n- ${failures.join('\n- ')}`);
  process.exit(1);
}

console.log(`STAGING_MIGRATIONS_OK count=${MIGRATIONS.length}`);
for (const migration of MIGRATIONS) {
  console.log(`${migration.version} ${migration.sha256} ${migration.file}`);
}
