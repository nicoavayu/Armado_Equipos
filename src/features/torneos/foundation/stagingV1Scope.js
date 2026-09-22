// Exact Phase 2D scope snapshot at 2058da03; guards verify equality.
// This is a client restriction, never a replacement for gateway ACL/RLS.
const features = {
  "organizations_workspaces": [
    "create_tournament_organization",
    "update_tournament_organization",
    "is_tournament_organization_slug_available",
    "is_tournament_organization_member",
    "has_tournament_organization_capability",
    "has_tournament_capability",
    "tournament_role_capabilities",
    "get_my_tournament_memberships",
    "get_tournament_workspace_context",
    "set_tournament_workspace_preference",
    "set_active_tournament_context"
  ],
  "collaborators": [
    "assign_tournament_season_member",
    "remove_tournament_season_member_assignment",
    "list_tournament_season_member_assignments",
    "has_tournament_season_access",
    "has_tournament_season_capability"
  ],
  "seasons": [
    "create_tournament_season",
    "update_tournament_season"
  ],
  "tournaments": [
    "create_tournament_with_defaults",
    "update_tournament_configuration",
    "change_tournament_status",
    "save_tournament_category",
    "get_tournament_competition_context",
    "get_tournament_creation_eligibility",
    "has_organization_consumed_free_tournament"
  ],
  "team_registration_basic_roster": [
    "create_tournament_team_entry",
    "update_tournament_team_entry",
    "submit_tournament_team_entry",
    "withdraw_tournament_team_entry",
    "archive_tournament_team_entry",
    "get_team_registration_context",
    "get_tournament_teams_context",
    "can_read_tournament_team_entry",
    "is_tournament_team_manager",
    "add_tournament_roster_player",
    "update_tournament_roster_player",
    "remove_tournament_roster_player",
    "create_tournament_provisional_player",
    "search_tournament_players"
  ],
  "invitations": [
    "invite_tournament_team_manager",
    "accept_tournament_team_invitation"
  ],
  "core_team_import": [
    "search_tournament_arma2_teams"
  ],
  "team_entry_review": [
    "review_tournament_team_entry"
  ]
};

export const stagingV1Scope = Object.freeze(Object.fromEntries(
  Object.entries(features).map(([feature, operations]) => [feature, Object.freeze(operations)]),
));
const permitted = new Set(Object.values(stagingV1Scope).flat());
export const isStagingV1Operation = (name) => typeof name === 'string' && permitted.has(name);
