#!/usr/bin/env node

import process from 'node:process';

import { REQUIRED_SCENARIO_EVIDENCE, SYNTHETIC_USERS } from './manifest.mjs';

const failures = [];
const ids = new Set();
const emails = new Set();
const keys = new Set();

for (const user of SYNTHETIC_USERS) {
  if (!/^97000000-0000-4000-8000-\d{12}$/.test(user.id)) {
    failures.push(`${user.key}: UUID fuera del namespace sintético`);
  }
  if (!/^[a-z0-9]+@example\.invalid$/.test(user.email)) {
    failures.push(`${user.key}: email no usa example.invalid`);
  }
  if (ids.has(user.id)) failures.push(`${user.key}: UUID duplicado`);
  if (emails.has(user.email)) failures.push(`${user.key}: email duplicado`);
  if (keys.has(user.key)) failures.push(`${user.key}: key duplicada`);
  ids.add(user.id);
  emails.add(user.email);
  keys.add(user.key);
}

for (const key of [
  'OwnerA',
  'AdminA',
  'CollaboratorA',
  'CaptainA1',
  'CaptainA2',
  'DelegateA',
  'PhotographerA',
  'PlayerA1',
  'PlayerA2',
  'ProvisionalA',
  'SuspendedA',
  'RemovedManagerA',
  'OwnerB',
  'PlayerB',
  'Outsider',
]) {
  if (!keys.has(key)) failures.push(`identidad requerida ausente: ${key}`);
}

if (REQUIRED_SCENARIO_EVIDENCE.length !== new Set(REQUIRED_SCENARIO_EVIDENCE).size) {
  failures.push('evidencias del escenario duplicadas');
}

if (failures.length) {
  console.error(`STAGING_SYNTHETIC_MANIFEST_INVALID\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(
  `STAGING_SYNTHETIC_MANIFEST_OK identities=${SYNTHETIC_USERS.length}`
  + ` evidence=${REQUIRED_SCENARIO_EVIDENCE.length} pii=none`,
);
