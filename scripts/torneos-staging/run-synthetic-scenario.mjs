#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  REQUIRED_SCENARIO_EVIDENCE,
  STAGING_READINESS_SUITES,
  SYNTHETIC_USERS,
} from './manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const startedAt = Date.now();
const suiteOutput = new Map();
const evidenceAssertions = {
  'two-organizations-and-seasons': [
    ['torneos-workspaces.mjs', /owner B sólo puede enumerar su organización/],
    ['torneos-competition-core.mjs', /admin puede crear temporadas en su organización/],
  ],
  'league-groups-knockout-and-playoffs': [
    ['torneos-fixture-scheduling.mjs', /groups_and_playoffs genera la cantidad esperada/],
    ['torneos-fixture-scheduling.mjs', /knockout genera la cantidad esperada/],
  ],
  'teams-rosters-provisional-player-and-delegate': [
    ['torneos-teams-rosters.mjs', /provisional/],
    ['torneos-participant-hub.mjs', /capitán ve sanciones publicadas/],
  ],
  'deterministic-fixture-and-draw': [
    ['torneos-fixture-scheduling.mjs', /sorteo SQL repite exactamente/],
  ],
  'scheduled-postponed-and-rescheduled-match': [
    ['torneos-match-operations.mjs', /reprogramar vuelve a habilitar la operación/],
  ],
  'submitted-squads-and-availability': [
    ['torneos-match-operations.mjs', /ambas convocatorias quedan presentadas/],
  ],
  'goals-assists-yellow-second-yellow-and-direct-red': [
    ['torneos-match-operations.mjs', /segunda amarilla exige/],
    ['torneos-standings-discipline.mjs', /amarillas y roja/],
  ],
  'suspended-result-walkover-and-corrected-official-operation': [
    ['torneos-match-operations.mjs', /suspensión conserva score parcial/],
    ['torneos-match-operations.mjs', /nueva versión queda oficial atómicamente/],
    ['torneos-staging-evidence.mjs', /walkover impacta una vez/],
  ],
  'published-standings-manual-points-adjustment-and-changed-qualifier': [
    ['torneos-standings-discipline.mjs', /ajuste de puntos es idempotente/],
    ['torneos-staging-evidence.mjs', /ajuste oficial cambia el clasificado/],
  ],
  'yellow-accumulation-and-suspended-player': [
    ['torneos-standings-discipline.mjs', /jugador suspendido no puede incorporarse/],
    ['torneos-standings-discipline.mjs', /arrastra amarillas/],
  ],
  'urgent-announcement-and-versioned-document': [
    ['torneos-communications.mjs', /inbox conserva prioridad explícita/],
    ['torneos-communications.mjs', /nueva versión conserva la anterior/],
  ],
  'published-gallery-four-variants-private-report-and-consent-denial': [
    ['torneos-media-galleries.mjs', /original y tres variantes/],
    ['torneos-media-galleries.mjs', /jugador crea un reporte privado/],
    ['torneos-media-galleries.mjs', /revocación canónica prevalece/],
  ],
  'champion-resolution': [
    ['torneos-staging-evidence.mjs', /resuelve un campeón candidato inicial/],
  ],
  'cross-tenant-role-and-revocation-matrix': [
    ['torneos-workspaces.mjs', /conocer el UUID de otra organización no concede lectura/],
    ['torneos-media-galleries.mjs', /revocar fotógrafo corta uploads inmediatamente/],
  ],
};

console.log('ARMA2_TORNEOS_SYNTHETIC_SCENARIO');
console.log(`identities=${SYNTHETIC_USERS.length} pii=synthetic-only target=embedded-local`);

for (const suite of STAGING_READINESS_SUITES) {
  console.log(`\n=== ${suite} ===`);
  const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'db-integration', suite)], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ARMA2_TORNEOS_SYNTHETIC_SEED: '20260727' },
  });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  if (result.status !== 0) {
    console.error(`STAGING_SCENARIO_FAILED suite=${suite} status=${result.status}`);
    process.exit(result.status || 1);
  }
  suiteOutput.set(suite, `${result.stdout || ''}\n${result.stderr || ''}`);
}

for (const evidence of REQUIRED_SCENARIO_EVIDENCE) {
  const assertions = evidenceAssertions[evidence] || [];
  const missing = assertions.filter(
    ([suite, pattern]) => !pattern.test(suiteOutput.get(suite) || ''),
  );
  if (!assertions.length || missing.length) {
    console.error(
      `STAGING_SCENARIO_FAILED evidence=${evidence}`
      + ` missing=${missing.map(([suite, pattern]) => `${suite}:${pattern.source}`).join(',')}`,
    );
    process.exit(1);
  }
  console.log(`EVIDENCE_OK ${evidence}`);
}
console.log(
  `STAGING_SCENARIO_OK suites=${STAGING_READINESS_SUITES.length}`
  + ` evidence=${REQUIRED_SCENARIO_EVIDENCE.length}`
  + ` elapsedMs=${Date.now() - startedAt}`,
);
