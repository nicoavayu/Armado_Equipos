import { supabase } from '../services/api/supabase';
import {
  changeTournamentCompetitionStatus,
  createTournamentCompetition,
  createTournamentSeason,
  loadTournamentCompetitionContext,
  saveTournamentCategory,
  setActiveTournamentContext,
  updateTournamentCompetition,
  updateTournamentSeason,
} from '../features/torneos/api/tournamentWorkspaceService';

jest.mock('../services/api/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
    from: jest.fn(),
  },
}));

describe('tournament competition service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    supabase.rpc.mockResolvedValue({ data: { ok: true }, error: null });
  });

  test('loads only the organization-scoped authoritative snapshot', async () => {
    await loadTournamentCompetitionContext('org-a');
    expect(supabase.rpc).toHaveBeenCalledWith(
      'get_tournament_competition_context',
      { p_organization_id: 'org-a' },
    );
  });

  test('creates a season without accepting a forged user id or status', async () => {
    await createTournamentSeason({
      organizationId: 'org-a',
      name: 'Apertura 2027',
      slug: 'apertura-2027',
      startDate: '2027-03-01',
      endDate: '2027-07-01',
      idempotencyKey: 'request-key',
      userId: 'forged-user',
      status: 'active',
    });
    expect(supabase.rpc).toHaveBeenCalledWith('create_tournament_season', {
      p_organization_id: 'org-a',
      p_name: 'Apertura 2027',
      p_slug: 'apertura-2027',
      p_start_date: '2027-03-01',
      p_end_date: '2027-07-01',
      p_idempotency_key: 'request-key',
    });
  });

  test('creates a tournament through the all-or-nothing defaults RPC', async () => {
    await createTournamentCompetition({
      organizationId: 'org-a',
      seasonId: 'season-a',
      name: 'Copa Apertura',
      slug: 'copa-apertura',
      description: '',
      sportModality: 'football_7',
      competitionFormat: 'league',
      genderCategory: 'open',
      idempotencyKey: 'request-key',
    });
    expect(supabase.rpc).toHaveBeenCalledWith(
      'create_tournament_with_defaults',
      expect.objectContaining({
        p_organization_id: 'org-a',
        p_season_id: 'season-a',
        p_sport_modality: 'football_7',
        p_competition_format: 'league',
        p_idempotency_key: 'request-key',
      }),
    );
  });

  test('distinguishes clearing optional season dates from leaving them unchanged', async () => {
    await updateTournamentSeason({
      organizationId: 'org-a',
      seasonId: 'season-a',
      startDate: '',
      endDate: '',
    });
    expect(supabase.rpc).toHaveBeenCalledWith('update_tournament_season', {
      p_organization_id: 'org-a',
      p_season_id: 'season-a',
      p_name: null,
      p_slug: null,
      p_start_date: null,
      p_end_date: null,
      p_status: null,
      p_clear_start_date: true,
      p_clear_end_date: true,
    });
  });

  test('persists structured rule patches without direct table writes', async () => {
    const patch = {
      scoring: { pointsWin: 3, pointsDraw: 1, pointsLoss: 0 },
      tiebreaks: ['goal_difference', 'goals_for'],
    };
    await updateTournamentCompetition({
      organizationId: 'org-a',
      tournamentId: 'tournament-a',
      patch,
    });
    expect(supabase.rpc).toHaveBeenCalledWith(
      'update_tournament_configuration',
      {
        p_organization_id: 'org-a',
        p_tournament_id: 'tournament-a',
        p_patch: patch,
      },
    );
  });

  test('sends every category scope field to the guarded RPC', async () => {
    await saveTournamentCategory({
      organizationId: 'org-a',
      tournamentId: 'tournament-a',
      name: 'Primera',
      slug: 'primera',
      sortOrder: 0,
    });
    expect(supabase.rpc).toHaveBeenCalledWith(
      'save_tournament_category',
      expect.objectContaining({
        p_organization_id: 'org-a',
        p_tournament_id: 'tournament-a',
        p_category_id: null,
        p_name: 'Primera',
        p_status: 'active',
      }),
    );
  });

  test('uses dedicated RPCs for lifecycle and active context', async () => {
    await changeTournamentCompetitionStatus({
      organizationId: 'org-a',
      tournamentId: 'tournament-a',
      status: 'registration',
    });
    await setActiveTournamentContext({
      organizationId: 'org-a',
      seasonId: 'season-a',
      tournamentId: 'tournament-a',
    });
    expect(supabase.rpc).toHaveBeenNthCalledWith(1, 'change_tournament_status', {
      p_organization_id: 'org-a',
      p_tournament_id: 'tournament-a',
      p_status: 'registration',
    });
    expect(supabase.rpc).toHaveBeenNthCalledWith(2, 'set_active_tournament_context', {
      p_organization_id: 'org-a',
      p_season_id: 'season-a',
      p_tournament_id: 'tournament-a',
    });
  });

  test('maps incomplete registration to a safe product message', async () => {
    supabase.rpc.mockResolvedValue({
      data: null,
      error: { message: 'TORNEOS_REGISTRATION_INCOMPLETE' },
    });
    await expect(changeTournamentCompetitionStatus({
      organizationId: 'org-a',
      tournamentId: 'tournament-a',
      status: 'registration',
    })).rejects.toEqual(expect.objectContaining({
      code: 'TORNEOS_REGISTRATION_INCOMPLETE',
      message: 'Completá los requisitos antes de preparar la inscripción.',
    }));
  });
});
