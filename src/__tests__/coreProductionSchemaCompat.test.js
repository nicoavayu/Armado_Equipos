/**
 * Every Core read/write in src names only tables, columns and RPCs that exist in Core
 * Production's REAL schema (fixtures/core-production-schema.json, names extracted from a
 * pg_dump --schema-only of Production on 2026-10-09). The repository's migrations do not
 * describe Production exactly (partidos has no uuid/admin_id/precio_cancha/equipos_generados
 * there, profiles has no telefono/ciudad/posicion), and one missing column fails a whole
 * PostgREST read with 42703 — which is how main's web broke in Production on 2026-10-09.
 *
 * Static scan (scripts/core-schema/scan.cjs) of `.from('<table>')` chains (literal select
 * lists and filter columns) and `.rpc('<name>')` calls. Reviewed exceptions:
 *   - STACK_RPCS: created by the 20261010* migrations, not yet in Production; every caller
 *     falls back while they are missing (PGRST202/42883), see each service's tests;
 *   - PENDING_TORNEOS_20261006: direct Core calls of Torneos' single-project LOCAL composition;
 *     Production runs the hybrid composition (gateway), so they never reach Core Production;
 *   - PREEXISTING: problems the web live in Production (ffaf131c) already had, regenerated with
 *     `node scripts/core-schema/preexisting.cjs ffaf131c` (they degrade, or are scan artifacts).
 * Anything else fails: fix the code (no explicit column a schema lacks), or justify an entry.
 */
const path = require('path');
const { scan } = require('../../scripts/core-schema/scan.cjs');
const schema = require('./fixtures/core-production-schema.json');

const STACK_RPCS = new Set([
  'get_my_profile',
  'get_public_profiles',
  'get_usuarios_approx_location',
  'search_usuarios',
  'clear_my_profile_fields',
  'get_match_contact_phone',
  'public_get_match_by_code',
  'list_my_pending_survey_finalizations',
  'report_client_build',
  'get_match_access_codes',
  'get_public_match_roster',
  'rpc_create_team_local_player',
]);

// Torneos connected product (#182): the direct Core-client calls of the single-project LOCAL
// composition, backed by 20261006120000 (its LOCAL twin, never applied to Core Production).
// Production runs the HYBRID composition: the connected adapters go through the Torneos gateway
// (see publicCatalogService.js), and the connected screens stay off until CONNECTED_MODE. No Core
// fallback is needed; an entry here must stay a LOCAL-only call.
const PENDING_TORNEOS_20261006 = new Set([
  'src/features/torneos/api/publicCatalogService.js rpc:get_tournament_catalog_entry',
  'src/features/torneos/api/publicCatalogService.js rpc:get_tournament_catalog_facets',
  'src/features/torneos/api/publicCatalogService.js rpc:search_tournament_catalog',
  'src/features/torneos/api/tournamentWorkspaceService.js rpc:get_my_torneos_inbox_summary',
  'src/features/torneos/api/tournamentWorkspaceService.js rpc:get_my_torneos_notifications',
  'src/features/torneos/api/tournamentWorkspaceService.js rpc:get_my_torneos_profile',
  'src/features/torneos/api/tournamentWorkspaceService.js rpc:get_my_tournament_participations',
  'src/features/torneos/api/tournamentWorkspaceService.js rpc:get_my_tournament_registrations',
  'src/features/torneos/api/tournamentWorkspaceService.js rpc:get_tournament_application_inbox',
  'src/features/torneos/api/tournamentWorkspaceService.js rpc:get_tournament_catalog_listing_settings',
  'src/features/torneos/api/tournamentWorkspaceService.js rpc:list_my_core_teams_for_application',
  'src/features/torneos/api/tournamentWorkspaceService.js rpc:mark_my_torneos_notifications_read',
  'src/features/torneos/api/tournamentWorkspaceService.js rpc:save_tournament_catalog_listing',
  'src/features/torneos/api/tournamentWorkspaceService.js rpc:save_tournament_category_capacity',
  'src/features/torneos/api/tournamentWorkspaceService.js rpc:search_my_applicable_core_teams',
  'src/features/torneos/api/tournamentWorkspaceService.js rpc:set_tournament_applications_state',
  'src/features/torneos/api/tournamentWorkspaceService.js rpc:set_tournament_catalog_listing_status',
  'src/features/torneos/api/tournamentWorkspaceService.js rpc:start_tournament_application',
  'src/features/torneos/api/tournamentWorkspaceService.js rpc:update_my_torneos_profile',
]);

const PREEXISTING = new Set([
  'src/components/StatsView.js survey_results.awards_generated',
  'src/components/StatsView.js survey_results.awards_status',
  'src/components/historial/TemplateStatsModal.jsx partidos.from_frequent_match_id',
  'src/features/torneos/api/tournamentWorkspaceService.js rpc:assign_tournament_season_member',
  'src/features/torneos/api/tournamentWorkspaceService.js rpc:authorize_tournament_social_export',
  'src/features/torneos/api/tournamentWorkspaceService.js rpc:cancel_tournament_purchase',
  'src/features/torneos/api/tournamentWorkspaceService.js rpc:get_effective_tournament_season_entitlements',
  'src/features/torneos/api/tournamentWorkspaceService.js rpc:get_tournament_purchase',
  'src/features/torneos/api/tournamentWorkspaceService.js rpc:get_tournament_season_media_usage',
  'src/features/torneos/api/tournamentWorkspaceService.js rpc:list_tournament_season_member_assignments',
  'src/features/torneos/api/tournamentWorkspaceService.js rpc:remove_tournament_season_member_assignment',
  'src/features/torneos/isolated/IsolatedTorneosPage.jsx table:sso_probe',
  'src/hooks/useAdminPanelState.js rpc:send_match_kicked_notification_as_admin',
  'src/pages/TemplateHistoryPage.js partidos.from_frequent_match_id',
  'src/scripts/setupClearedMatches.js rpc:exec_sql',
  'src/scripts/setupDatabase.js rpc:exec_sql',
  'src/services/absenceService.js table:player_absences',
  'src/services/db/availability.js rpc:set_my_global_availability',
  'src/services/db/awards.js rpc:inc_numeric',
  'src/services/db/matchScheduling.js partidos.from_frequent_match_id',
  'src/services/db/matches.js rpc:cancel_partido_as_admin',
  'src/services/db/matches.js rpc:cleanup_voting_access_state_as_admin',
  'src/services/db/matches.js rpc:enqueue_partido_notification_as_actor',
  'src/services/db/penalties.js table:partidos_jugadores',
  'src/services/db/surveys.js partidos.surveys_processed',
  'src/services/db/teamChallenges.js rpc:prepare_challenge_team_squad_as_actor',
  'src/services/db/teamChallenges.js rpc:sync_team_match_to_partido_as_actor',
  'src/services/matchFinishService.js cleared_matches.id',
  'src/services/matchFinishService.js rpc:enqueue_partido_notification_as_actor',
  'src/services/matchJoinNotificationService.js rpc:enqueue_match_participant_notification_as_actor',
  'src/services/matchJoinNotificationService.js rpc:enqueue_partido_notification_as_actor',
  'src/services/matchStatsService.js rpc:inc_numeric',
  'src/utils/createPlayerAwardsTable.js rpc:exec_sql',
  'src/utils/matchStatsManager.js rpc:increment_matches_abandoned',
  'src/utils/matchStatsManager.js rpc:increment_matches_played',
]);

describe('Core reads and writes against Production\'s real schema', () => {
  const problems = scan(path.join(__dirname, '..'), schema, STACK_RPCS);

  test('nothing new names a table, column or RPC that Production lacks', () => {
    expect(problems.filter((problem) => !PREEXISTING.has(problem) && !PENDING_TORNEOS_20261006.has(problem))).toEqual([]);
  });

  test('the exception lists only hold problems that still exist (remove fixed ones)', () => {
    expect([...PREEXISTING, ...PENDING_TORNEOS_20261006].filter((problem) => !problems.includes(problem))).toEqual([]);
  });

  test('a column a schema lacks is caught (scanner self-check)', () => {
    const { selectColumns } = require('../../scripts/core-schema/scan.cjs');
    expect(selectColumns('id, nombre, alias:avatar_url, jugadores(count), usuario:usuarios!inner(nombre, x)')).toEqual(['id', 'nombre', 'avatar_url']);
    expect(schema.tables.partidos).not.toContain('admin_id');
  });

  test('the schema the match reads depend on is the one in the fixture', () => {
    const partidos = new Set(schema.tables.partidos);
    for (const column of ['id', 'codigo', 'creado_por', 'fecha', 'hora', 'sede', 'estado', 'deleted_at',
      'cupo_jugadores', 'falta_jugadores', 'busca_arquero', 'player_invites_enabled', 'tipo_partido',
      'precio_cancha_por_persona', 'survey_status', 'template_id']) {
      expect(partidos.has(column)).toBe(true);
    }
    for (const missing of ['uuid', 'admin_id', 'precio_cancha', 'equipos_generados']) {
      expect(partidos.has(missing)).toBe(false);
    }
    expect(schema.tables.profiles).not.toContain('telefono');
  });
});
