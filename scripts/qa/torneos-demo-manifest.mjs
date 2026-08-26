import { createHash } from 'node:crypto';

import { stableUuid } from './torneos-demo-dataset.mjs';
import * as legacyV3 from './torneos-demo-v3-manifest.mjs';
import { canonicalJson } from './torneos-qa-identity-map.mjs';

export const SEED_KEY = 'torneos-demo-v4';
export const PREVIOUS_SEED_KEY = legacyV3.SEED_KEY;
export const SEED_VERSION = 4;
export const SEED_ORGANIZATION_SLUG = legacyV3.SEED_ORGANIZATION_SLUG;
export const FIXED_NOW = legacyV3.FIXED_NOW;
export const QA_USER_ROLES = legacyV3.QA_USER_ROLES;

export const {
  deriveQAIdentityRelations,
  validateQAIdentityRelations,
} = legacyV3;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function manifestHashInput(operations) {
  return operations.map((operation) => ({
    table: operation.table,
    identity: operation.identity,
    rows: operation.rows,
  }));
}

function rowsFor(manifest, table) {
  return manifest.operations
    .filter((operation) => operation.table === table)
    .flatMap((operation) => operation.rows);
}

function applyV4Corrections(baseManifest) {
  const suspensions = rowsFor(baseManifest, 'tournament_player_suspensions');
  const directRedSuspensions = suspensions.filter((row) => row.source_type === 'direct_red');
  if (directRedSuspensions.length !== 1) {
    throw new Error('V4 requires exactly one direct-red suspension in the frozen V3 dataset.');
  }
  const directRedPlayerId = directRedSuspensions[0].roster_player_id;
  const ledgers = rowsFor(baseManifest, 'tournament_discipline_ledgers');
  const directRedLedger = ledgers.find((row) => row.roster_player_id === directRedPlayerId);
  if (!directRedLedger || directRedLedger.direct_reds !== 1) {
    throw new Error('V4 could not identify the direct-red discipline ledger.');
  }
  if (directRedLedger.automatic_suspensions !== 0) {
    throw new Error('Frozen V3 no longer contains the known automatic_suspensions = 0 value.');
  }
  directRedLedger.automatic_suspensions = 1;

  // V3 froze six synthetic SVG paths. Branding provisioning replaces BNO
  // with a real raster object; the other five never existed and produced 400s.
  // V4 removes those five reproducibly and lets every consumer use its
  // existing monogram fallback.
  const entries = rowsFor(baseManifest, 'tournament_team_entries');
  const clearedTeamIds = new Set(entries.filter((row) => (
    row.short_name !== 'BNO' && /^qa\/shields\/[a-z0-9-]+\.svg$/.test(row.shield_path || '')
  )).map((row) => {
    row.shield_path = null;
    return row.id;
  }));
  if (clearedTeamIds.size !== 5) {
    throw new Error(`V4 branding cleanup expected five legacy QA shields, got ${clearedTeamIds.size}.`);
  }
  const participants = rowsFor(baseManifest, 'tournament_competition_participants');
  let clearedSnapshots = 0;
  for (const participant of participants) {
    if (clearedTeamIds.has(participant.team_entry_id)) {
      participant.snapshot_shield_path = null;
      clearedSnapshots += 1;
    }
  }
  if (clearedSnapshots !== 5) {
    throw new Error(`V4 branding cleanup expected five participant snapshots, got ${clearedSnapshots}.`);
  }
}

export function buildBaseManifest() {
  const baseManifest = structuredClone(legacyV3.buildBaseManifest());
  applyV4Corrections(baseManifest);
  baseManifest.seedKey = SEED_KEY;
  baseManifest.seedVersion = SEED_VERSION;
  baseManifest.datasetVersion = SEED_VERSION;
  baseManifest.seedRegistryId = stableUuid(`seed-registry:${SEED_KEY}`);
  baseManifest.acceptedAuthSeedKeys = Object.freeze([
    SEED_KEY,
    legacyV3.SEED_KEY,
    legacyV3.PREVIOUS_SEED_KEY,
  ]);
  baseManifest.legacySeedKeys = Object.freeze([legacyV3.SEED_KEY]);
  baseManifest.baseManifestHash = sha256(canonicalJson(manifestHashInput(baseManifest.operations)));
  return baseManifest;
}

export function resolveCanonicalManifest({
  baseManifest = buildBaseManifest(),
  identityMap,
  createdAt = new Date().toISOString(),
} = {}) {
  return legacyV3.resolveCanonicalManifest({ baseManifest, identityMap, createdAt });
}

export function buildCanonicalManifest({ identityMap, createdAt = FIXED_NOW } = {}) {
  if (!identityMap) {
    throw new Error('buildCanonicalManifest requires a resolved QAIdentityMap.');
  }
  return resolveCanonicalManifest({ identityMap, createdAt });
}

export function validateCanonicalManifest(manifest) {
  if (manifest.seedKey !== SEED_KEY || manifest.seedVersion !== SEED_VERSION) {
    throw new Error('Current tournament manifest must be torneos-demo-v4 / dataset version 4.');
  }
  const summary = legacyV3.validateCanonicalManifest(manifest);
  const events = rowsFor(manifest, 'tournament_match_events');
  const suspensions = rowsFor(manifest, 'tournament_player_suspensions');
  const ledgers = rowsFor(manifest, 'tournament_discipline_ledgers');
  const redEvents = events.filter((row) => row.event_type === 'red_card');
  const directRedSuspensions = suspensions.filter((row) => row.source_type === 'direct_red');
  if (redEvents.length !== 1 || directRedSuspensions.length !== 1) {
    throw new Error('V4 requires exactly one red-card event and one direct-red suspension.');
  }
  const redEvent = redEvents[0];
  const redSuspension = directRedSuspensions[0];
  const redLedger = ledgers.find((row) => row.roster_player_id === redEvent.roster_player_id);
  if (
    redSuspension.roster_player_id !== redEvent.roster_player_id
    || redSuspension.source_event_id !== redEvent.id
    || redSuspension.total_matches !== 2
    || redSuspension.served_matches !== 0
    || redSuspension.status !== 'active'
    || redLedger?.direct_reds !== 1
    || redLedger?.automatic_suspensions !== 1
  ) {
    throw new Error('V4 direct-red discipline contract is incoherent.');
  }
  const served = suspensions.find((row) => row.status === 'served');
  const servedLedger = ledgers.find((row) => row.roster_player_id === served?.roster_player_id);
  const servedYellows = events.filter((row) => (
    row.roster_player_id === served?.roster_player_id && row.event_type === 'yellow_card'
  ));
  if (
    !served
    || servedYellows.length !== 5
    || served.total_matches !== served.served_matches
    || servedLedger?.automatic_suspensions !== 1
  ) {
    throw new Error('V4 served yellow-accumulation discipline contract is incoherent.');
  }
  return summary;
}
