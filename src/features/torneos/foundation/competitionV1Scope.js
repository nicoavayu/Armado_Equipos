// COMPETITION-V1 scope snapshot of the gateway contract (torneos-gateway/competition-v1-rpc-allowlist.json,
// backend/torneos/competition-v1/contract.json); guards verify equality.
//
//   • `features`: RPCs of the authenticated gateway route, on top of the staging-v1 scope;
//   • `public`: RPCs of the anonymous public read-only route (POST /torneos/public/v1/rpc/<name>).
//
// Like the staging-v1 scope this only restricts the client; the gateway allowlist and the database ACL
// (00000000000004_competition_v1_rpc_exposure.sql) decide what is actually served.
const features = {
  "fixtures": [
    "get_tournament_fixture_context",
    "get_tournament_schedule_context",
    "freeze_tournament_participants",
    "reopen_tournament_participants",
    "save_tournament_draw_pots",
    "execute_tournament_group_draw",
    "generate_tournament_fixture",
    "create_manual_fixture_version",
    "update_draft_fixture",
    "validate_tournament_fixture",
    "publish_tournament_fixture",
    "append_tournament_playoff_phase",
    "supersede_tournament_fixture",
    "create_tournament_venue",
    "create_tournament_court",
    "save_tournament_schedule_windows",
    "validate_tournament_match_schedule",
    "schedule_tournament_match",
    "reschedule_tournament_match",
    "auto_schedule_tournament_matches"
  ],
  "match_operations": [
    "get_player_tournament_matches",
    "get_managed_tournament_matches",
    "respond_match_availability",
    "get_tournament_match_operations_context",
    "get_tournament_match_operation_context",
    "get_match_squad_context",
    "get_my_managed_match_squad_context",
    "save_match_squad",
    "submit_match_squad",
    "open_tournament_match_operation",
    "set_tournament_match_outcome",
    "set_tournament_match_score",
    "add_tournament_match_event",
    "void_tournament_match_event",
    "submit_tournament_match_operation",
    "review_tournament_match_operation",
    "validate_tournament_match_operation",
    "make_tournament_match_official",
    "request_tournament_match_correction",
    "create_tournament_match_correction"
  ],
  "standings": [
    "get_tournament_standings_context",
    "get_tournament_statistics_context",
    "rebuild_tournament_standings",
    "publish_tournament_standings_revision",
    "resolve_tournament_qualification"
  ],
  "lifecycle_actions": [
    "start_tournament_competition",
    "finish_tournament_competition",
    "reopen_tournament_competition"
  ],
  "participant_withdrawal": [
    "withdraw_tournament_competition_participant"
  ],
  "participant_hub": [
    "get_tournament_participant_hub",
    "set_my_tournament_hub_category",
    "get_published_tournament_matches",
    "get_tournament_participant_match",
    "get_published_tournament_teams",
    "get_published_tournament_standings",
    "get_published_tournament_statistics"
  ],
  "communications": [
    "get_tournament_communications_inbox",
    "get_tournament_announcement",
    "mark_tournament_announcement_read",
    "get_published_tournament_documents",
    "acknowledge_tournament_document",
    "get_tournament_communications_admin_context",
    "create_tournament_announcement_draft",
    "update_tournament_announcement_draft",
    "replace_tournament_announcement_audience",
    "set_tournament_announcement_link",
    "preview_tournament_announcement_audience",
    "publish_tournament_announcement",
    "create_tournament_document",
    "publish_tournament_document_version"
  ],
  "notifications": [
    "get_my_tournament_notification_preferences",
    "update_my_tournament_notification_preferences"
  ],
  "public_pages": [
    "get_tournament_public_page_settings",
    "set_tournament_public_page_published"
  ]
};

const publicFeatures = {
  "public_pages": [
    "get_public_tournament_page"
  ]
};

const freeze = (map) => Object.freeze(Object.fromEntries(
  Object.entries(map).map(([feature, operations]) => [feature, Object.freeze(operations)]),
));
export const competitionV1Scope = freeze(features);
export const competitionV1PublicScope = freeze(publicFeatures);
const permitted = new Set(Object.values(competitionV1Scope).flat());
const permittedPublic = new Set(Object.values(competitionV1PublicScope).flat());
export const isCompetitionV1Operation = (name) => typeof name === 'string' && permitted.has(name);
export const isCompetitionV1PublicOperation = (name) => typeof name === 'string' && permittedPublic.has(name);
