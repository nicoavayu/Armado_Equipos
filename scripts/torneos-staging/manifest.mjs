export const KNOWN_PRODUCTION_PROJECT_REFS = Object.freeze([
  'rcyuuoaqfwcembdajcss',
]);

export const MIGRATIONS = Object.freeze([
  {
    version: '20260724233000',
    file: '20260724233000_tournament_organization_workspaces.sql',
    sha256: '4dadf2d6c2f7aad71e0a80572e2552a4f98088c0481aef2b1e43376205c0f6b7',
    dependsOn: [],
  },
  {
    version: '20260725120000',
    file: '20260725120000_tournament_competition_core.sql',
    sha256: '159a68396605295c5f8c2c6cddccae16e21705ed907da43a1207e7a675fb0c77',
    dependsOn: ['20260724233000'],
  },
  {
    version: '20260725210000',
    file: '20260725210000_tournament_teams_rosters.sql',
    sha256: '7bc34ad8ce8e6188ccd742411e0cd1398a9b361887316785e9655b42c5b3efa1',
    dependsOn: ['20260725120000'],
  },
  {
    version: '20260726010000',
    file: '20260726010000_tournament_fixture_scheduling.sql',
    sha256: 'c1d8225c0e08d0fdbc4bdb809c470d7b6d77632c22f79145c425bf9ef2969cd7',
    dependsOn: ['20260725210000'],
  },
  {
    version: '20260726150000',
    file: '20260726150000_tournament_match_operations.sql',
    sha256: 'b054de163ba44120c5c4942ae77e3203aa668784697d427fc954f680e636726f',
    dependsOn: ['20260726010000'],
  },
  {
    version: '20260726200000',
    file: '20260726200000_tournament_standings_discipline.sql',
    sha256: '2fb197ba016d0c0f850ed37973772cbbc0e3b711d6b194a865cf5b90c29b80af',
    dependsOn: ['20260726150000'],
  },
  {
    version: '20260726230000',
    file: '20260726230000_tournament_participant_hub.sql',
    sha256: 'd3de773a022618e8ca301506e3ac8a2a0df42e18a7ce6c8c0007cd78bc32d28b',
    dependsOn: ['20260726200000'],
  },
  {
    version: '20260727010000',
    file: '20260727010000_tournament_communications.sql',
    sha256: '5d2644d352fc987ec97a1ec82de30757b6c89e691c2cc4c8c60eac22362bbaea',
    dependsOn: ['20260726230000'],
  },
  {
    version: '20260727060000',
    file: '20260727060000_tournament_media_galleries.sql',
    sha256: 'bb16333b2f18dc7c3a6c080a788a3dbfa5b24678b661afdbf0628441cace99c3',
    dependsOn: ['20260727010000'],
  },
]);

const syntheticUser = (suffix, key, role, organization = 'A') => Object.freeze({
  id: `97000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`,
  email: `${key.toLowerCase()}@example.invalid`,
  key,
  role,
  organization,
});

export const SYNTHETIC_USERS = Object.freeze([
  syntheticUser(1, 'OwnerA', 'owner'),
  syntheticUser(2, 'AdminA', 'admin'),
  syntheticUser(3, 'CollaboratorA', 'collaborator'),
  syntheticUser(4, 'CaptainA1', 'captain'),
  syntheticUser(5, 'CaptainA2', 'captain'),
  syntheticUser(6, 'DelegateA', 'delegate'),
  syntheticUser(7, 'PhotographerA', 'photographer'),
  syntheticUser(8, 'PlayerA1', 'player'),
  syntheticUser(9, 'PlayerA2', 'player'),
  syntheticUser(10, 'ProvisionalA', 'provisional_player'),
  syntheticUser(11, 'SuspendedA', 'suspended_membership'),
  syntheticUser(12, 'RemovedManagerA', 'revoked_manager'),
  syntheticUser(13, 'OwnerB', 'owner', 'B'),
  syntheticUser(14, 'PlayerB', 'player', 'B'),
  syntheticUser(15, 'Outsider', 'outsider', 'none'),
]);

export const REQUIRED_SCENARIO_EVIDENCE = Object.freeze([
  'two-organizations-and-seasons',
  'league-groups-knockout-and-playoffs',
  'teams-rosters-provisional-player-and-delegate',
  'deterministic-fixture-and-draw',
  'scheduled-postponed-and-rescheduled-match',
  'submitted-squads-and-availability',
  'goals-assists-yellow-second-yellow-and-direct-red',
  'suspended-result-walkover-and-corrected-official-operation',
  'published-standings-manual-points-adjustment-and-changed-qualifier',
  'yellow-accumulation-and-suspended-player',
  'urgent-announcement-and-versioned-document',
  'published-gallery-four-variants-private-report-and-consent-denial',
  'champion-resolution',
  'cross-tenant-role-and-revocation-matrix',
]);

export const STAGING_READINESS_SUITES = Object.freeze([
  'torneos-workspaces.mjs',
  'torneos-competition-core.mjs',
  'torneos-teams-rosters.mjs',
  'torneos-fixture-scheduling.mjs',
  'torneos-match-operations.mjs',
  'torneos-standings-discipline.mjs',
  'torneos-participant-hub.mjs',
  'torneos-communications.mjs',
  'torneos-media-galleries.mjs',
  'torneos-staging-evidence.mjs',
]);

export const REQUIRED_RUNTIME_ENV = Object.freeze([
  'REACT_APP_DEPLOY_ENV',
  'REACT_APP_TORNEOS_DATA_ENV',
  'REACT_APP_TORNEOS_STAGING_PROJECT_REF',
  'REACT_APP_SUPABASE_URL',
  'REACT_APP_SUPABASE_ANON_KEY',
]);

export const TOGGLE_ENV = Object.freeze([
  'REACT_APP_TORNEOS_ENABLED',
  'REACT_APP_TORNEOS_WORKSPACES_ENABLED',
  'REACT_APP_TORNEOS_WORKSPACE_SWITCHER_ENABLED',
  'REACT_APP_TORNEOS_DEEP_LINKS_ENABLED',
  'REACT_APP_TORNEOS_NOTIFICATIONS_ENABLED',
  'REACT_APP_TORNEOS_OFFICIAL_STATS_ENABLED',
  'REACT_APP_TORNEOS_PUBLIC_PAGES_ENABLED',
  'REACT_APP_TORNEOS_MEDIA_ENABLED',
  'REACT_APP_TORNEOS_MEDIA_UPLOAD_ENABLED',
  'REACT_APP_TORNEOS_SOCIAL_GENERATOR_ENABLED',
]);
