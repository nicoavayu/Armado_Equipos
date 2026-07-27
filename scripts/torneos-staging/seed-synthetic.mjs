#!/usr/bin/env node

import process from 'node:process';

if (process.argv.some((argument) => argument.startsWith('--target=')
  && argument !== '--target=embedded-local')) {
  console.error('STAGING_SEED_GUARD: este artefacto sólo admite --target=embedded-local');
  process.exit(2);
}

await import('./run-synthetic-scenario.mjs');
