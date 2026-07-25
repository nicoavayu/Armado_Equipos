import { supabase } from '../services/api/supabase';
import {
  addTournamentRosterPlayer,
  createTournamentTeamEntry,
  inviteTournamentTeamManager,
  loadTeamRegistrationContext,
  reviewTournamentTeamEntry,
  searchTournamentPlayers,
} from '../features/torneos/api/tournamentWorkspaceService';

jest.mock('../services/api/supabase', () => ({
  supabase: { rpc: jest.fn(), from: jest.fn() },
}));

describe('tournament teams service contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    supabase.rpc.mockResolvedValue({ data: { ok: true }, error: null });
  });

  test('loads a relational registration through a scoped context RPC', async () => {
    await loadTeamRegistrationContext('org-a', 'entry-a');
    expect(supabase.rpc).toHaveBeenCalledWith('get_team_registration_context', {
      p_organization_id: 'org-a',
      p_team_entry_id: 'entry-a',
    });
  });

  test('does not accept forged creator, status or organization fields', async () => {
    await createTournamentTeamEntry({
      organizationId: 'org-a',
      tournamentId: 'tournament-a',
      categoryId: 'category-a',
      name: 'Napoli',
      registrationSource: 'provisional',
      managerEmail: 'captain@example.test',
      managerDisplayName: 'Capitán',
      idempotencyKey: 'request-a',
      createdBy: 'forged',
      status: 'approved',
    });
    expect(supabase.rpc).toHaveBeenCalledWith(
      'create_tournament_team_entry',
      expect.not.objectContaining({
        p_created_by: expect.anything(),
        p_status: expect.anything(),
      }),
    );
  });

  test('sends exactly one roster identity source', async () => {
    await addTournamentRosterPlayer({
      organizationId: 'org-a',
      teamEntryId: 'entry-a',
      rosterId: 'roster-a',
      provisionalPlayerId: 'provisional-a',
      displayName: 'Jugador sin app',
      shirtNumber: 7,
      primaryPosition: 'DEL',
    });
    expect(supabase.rpc).toHaveBeenCalledWith('add_tournament_roster_player', {
      p_organization_id: 'org-a',
      p_team_entry_id: 'entry-a',
      p_roster_id: 'roster-a',
      p_arma2_user_id: null,
      p_provisional_player_id: 'provisional-a',
      p_display_name: 'Jugador sin app',
      p_avatar_url: null,
      p_shirt_number: 7,
      p_primary_position: 'DEL',
      p_secondary_position: null,
      p_is_goalkeeper: false,
    });
  });

  test('search sends a bounded query without private projection fields', async () => {
    await searchTournamentPlayers({
      organizationId: 'org-a',
      tournamentId: 'tournament-a',
      query: 'nico',
    });
    expect(supabase.rpc).toHaveBeenCalledWith('search_tournament_players', {
      p_organization_id: 'org-a',
      p_tournament_id: 'tournament-a',
      p_query: 'nico',
      p_limit: 8,
    });
  });

  test('review and invitation use dedicated state-changing RPCs', async () => {
    await reviewTournamentTeamEntry({
      organizationId: 'org-a',
      teamEntryId: 'entry-a',
      decision: 'changes_requested',
      reason: 'Corregir dorsal.',
    });
    await inviteTournamentTeamManager({
      organizationId: 'org-a',
      teamEntryId: 'entry-a',
      email: 'captain@example.test',
      displayName: 'Capitán',
    });
    expect(supabase.rpc).toHaveBeenNthCalledWith(1, 'review_tournament_team_entry', {
      p_organization_id: 'org-a',
      p_team_entry_id: 'entry-a',
      p_decision: 'changes_requested',
      p_reason: 'Corregir dorsal.',
      p_issues: [],
    });
    expect(supabase.rpc).toHaveBeenNthCalledWith(2, 'invite_tournament_team_manager', {
      p_organization_id: 'org-a',
      p_team_entry_id: 'entry-a',
      p_email: 'captain@example.test',
      p_display_name: 'Capitán',
      p_role: 'captain',
    });
  });
});
