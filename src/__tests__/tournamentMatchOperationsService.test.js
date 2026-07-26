import { supabase } from '../services/api/supabase';
import {
  addTournamentMatchEvent,
  makeTournamentMatchOfficial,
  openTournamentMatchOperation,
  respondTournamentMatchAvailability,
  saveTournamentMatchSquad,
  setTournamentMatchOutcome,
  setTournamentMatchScore,
} from '../features/torneos/api/tournamentWorkspaceService';

jest.mock('../services/api/supabase', () => ({
  supabase: { rpc: jest.fn(), from: jest.fn() },
}));

describe('tournament match operations service contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    supabase.rpc.mockResolvedValue({ data: { ok: true }, error: null });
  });

  test('availability never accepts a client-owned user or roster identity', async () => {
    await respondTournamentMatchAvailability({
      matchId: 'match-a',
      response: 'available',
      comment: 'Llego temprano',
      userId: 'forged-user',
      rosterPlayerId: 'forged-player',
    });
    expect(supabase.rpc).toHaveBeenCalledWith('respond_match_availability', {
      p_match_id: 'match-a',
      p_response: 'available',
      p_comment: 'Llego temprano',
    });
  });

  test('opening an act never accepts teams, fixture or actor from the client', async () => {
    await openTournamentMatchOperation({
      organizationId: 'org-a',
      matchId: 'match-a',
      overrideReason: 'Control previo autorizado',
      homeTeamEntryId: 'forged-home',
      openedBy: 'forged-user',
    });
    expect(supabase.rpc).toHaveBeenCalledWith('open_tournament_match_operation', {
      p_organization_id: 'org-a',
      p_match_id: 'match-a',
      p_override_reason: 'Control previo autorizado',
    });
  });

  test('squad payload remains roster-scoped and is validated by the backend', async () => {
    const players = [{
      rosterPlayerId: 'player-a',
      callupStatus: 'called_up',
      lineupStatus: 'starter',
      isCaptain: true,
    }];
    await saveTournamentMatchSquad({
      organizationId: 'org-a',
      matchId: 'match-a',
      teamEntryId: 'team-a',
      players,
    });
    expect(supabase.rpc).toHaveBeenCalledWith('save_match_squad', {
      p_organization_id: 'org-a',
      p_match_id: 'match-a',
      p_team_entry_id: 'team-a',
      p_players: players,
    });
  });

  test('score, outcome and events use separate authoritative RPCs', async () => {
    await setTournamentMatchOutcome({
      organizationId: 'org-a',
      operationId: 'operation-a',
      outcome: { outcomeType: 'played', countsForPlayerStats: true },
    });
    await setTournamentMatchScore({
      organizationId: 'org-a',
      operationId: 'operation-a',
      score: { homeScore: 2, awayScore: 1, scoreType: 'played' },
    });
    await addTournamentMatchEvent({
      organizationId: 'org-a',
      operationId: 'operation-a',
      event: { eventType: 'goal', teamEntryId: 'team-a' },
    });
    expect(supabase.rpc.mock.calls.map(([name]) => name)).toEqual([
      'set_tournament_match_outcome',
      'set_tournament_match_score',
      'add_tournament_match_event',
    ]);
  });

  test('officialization accepts only scope and operation identity', async () => {
    await makeTournamentMatchOfficial({
      organizationId: 'org-a',
      operationId: 'operation-a',
      score: { home: 99, away: 0 },
      validatedBy: 'forged-user',
    });
    expect(supabase.rpc).toHaveBeenCalledWith('make_tournament_match_official', {
      p_organization_id: 'org-a',
      p_match_operation_id: 'operation-a',
    });
  });
});
