import fs from 'fs';
import path from 'path';

const repoRoot = process.cwd();
const rootMigrationsDir = path.join(repoRoot, 'migrations');
const supabaseMigrationsDir = path.join(repoRoot, 'supabase', 'migrations');
const allowlistPath = path.join(rootMigrationsDir, 'ROOT_SQL_ALLOWLIST.txt');
const expectedCanonicalMigrations = [
  '20260727090000_arma2_canonical_baseline.sql',
  '20260727215106_canonical_core_rls_contracts.sql',
  '20260801090000_tournament_context_reads_are_pure.sql',
  '20260802090000_tournament_media_upload_pipeline.sql',
  '20260802120000_tournament_media_trusted_processing.sql',
  '20260803090000_tournament_social_studio.sql',
  '20260809232508_tournament_media_free_mvp.sql',
  '20260810160355_tournament_entitlements_foundation.sql',
  '20260810215224_tournament_public_pages.sql',
  '20260812120000_tournament_competition_lifecycle.sql',
  '20260813120000_rank_standings_safeupdate_guard.sql',
  '20260813121000_match_open_window_is_a_client_error.sql',
  '20260813122000_lifecycle_business_rules_are_client_errors.sql',
  '20260813123000_match_already_official_is_a_client_error.sql',
  '20260813124000_core_flow_business_rules_are_client_errors.sql',
  '20260814053900_fix_tournament_social_snapshot_nullable_round.sql',
  '20260815234340_tournament_media_storage_readiness_and_delete.sql',
  '20260817062612_tournament_branding_assets.sql',
  '20260817220554_tournament_player_portraits_foundation.sql',
  '20260818120000_tournament_player_portrait_ux.sql',
  '20260818210000_tournament_team_visual_self_management.sql',
  '20260820120000_tournament_media_publication_is_processing_aware.sql',
  '20260821120000_media_restore_respects_closed_galleries.sql',
  '20260821180000_tournament_team_photo_moderated_lifecycle.sql',
  '20260821213918_plans_entitlements_foundation_v2.sql',
  '20260821230000_active_tournament_phase_append.sql',
  '20260823120000_tournament_social_team_contract.sql',
  '20260825194025_tournament_commercial_checkout_foundation.sql',
  '20260827001443_tournament_mercadopago_checkout_pro_test.sql',
  '20260827012000_align_tournament_premium_catalog.sql',
  '20260828163326_tournament_season_commercial_domain.sql',
  '20260828163328_tournament_season_member_scope.sql',
  '20260828163329_tournament_season_media_social_branding.sql',
  '20260828165314_remove_legacy_media_subquotas.sql',
  '20260828172000_prune_legacy_media_subquota_work.sql',
  '20260828174500_harden_season_rpc_execute_grants.sql',
];

const exitWithError = (message) => {
  console.error(`[migrations:guard] ${message}`);
  process.exit(1);
};

if (!fs.existsSync(rootMigrationsDir)) {
  exitWithError('Missing `migrations/` directory.');
}

if (!fs.existsSync(supabaseMigrationsDir)) {
  exitWithError('Missing `supabase/migrations/` directory.');
}

if (!fs.existsSync(allowlistPath)) {
  exitWithError('Missing `migrations/ROOT_SQL_ALLOWLIST.txt` allowlist file.');
}

const allowlist = new Set(
  fs.readFileSync(allowlistPath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#')),
);

const rootSqlFiles = fs.readdirSync(rootMigrationsDir)
  .filter((file) => file.endsWith('.sql'))
  .sort();

const unexpectedRootSql = rootSqlFiles.filter((file) => !allowlist.has(file));
if (unexpectedRootSql.length > 0) {
  exitWithError(
    [
      'Detected new SQL files under `migrations/` (legacy archive).',
      'Add new migrations only under `supabase/migrations/`.',
      `Unexpected files: ${unexpectedRootSql.join(', ')}`,
    ].join(' '),
  );
}

const canonicalSqlFiles = fs.readdirSync(supabaseMigrationsDir)
  .filter((file) => file.endsWith('.sql'))
  .sort();

if (
  canonicalSqlFiles.length !== expectedCanonicalMigrations.length
  || canonicalSqlFiles.some(
    (file, index) => file !== expectedCanonicalMigrations[index],
  )
) {
  exitWithError(
    [
      'Canonical migration set must contain exactly the approved files.',
      `Expected: ${expectedCanonicalMigrations.join(', ')}`,
      `Found: ${canonicalSqlFiles.join(', ') || '(none)'}`,
    ].join(' '),
  );
}

console.log('[migrations:guard] OK. Exactly the approved canonical migrations are present.');
