import { supabase } from '../services/api/supabase';
import {
  createTournamentDisciplinaryOverride,
  createTournamentPointsAdjustment,
  loadTournamentStandings,
  loadTournamentStatistics,
  publishTournamentStandings,
  rebuildTournamentStandings,
  resolveTournamentQualification,
} from '../features/torneos/api/tournamentWorkspaceService';

jest.mock('../services/api/supabase', () => ({
  supabase: { rpc: jest.fn(), from: jest.fn() },
}));

const scope = {
  organizationId: 'org',
  tournamentId: 'tournament',
  categoryId: 'category',
  phaseId: 'phase',
  groupId: null,
};

describe('tournament standings and discipline service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    supabase.rpc.mockResolvedValue({ data: { ok: true }, error: null });
  });

  test.each([
    ['get_tournament_standings_context', loadTournamentStandings],
    ['get_tournament_statistics_context', loadTournamentStatistics],
  ])('loads %s with the complete composite scope', async (rpc, operation) => {
    await operation(scope);
    expect(supabase.rpc).toHaveBeenCalledWith(rpc, {
      p_organization_id: 'org',
      p_tournament_id: 'tournament',
      p_category_id: 'category',
      p_phase_id: 'phase',
      p_group_id: null,
    });
  });

  test('rebuild sends reason and caller-stable idempotency key without identity fields', async () => {
    await rebuildTournamentStandings({
      ...scope,
      reason: 'Actas verificadas',
      idempotencyKey: 'request-key',
      userId: 'forged',
    });
    expect(supabase.rpc).toHaveBeenCalledWith('rebuild_tournament_standings', {
      p_organization_id: 'org',
      p_tournament_id: 'tournament',
      p_category_id: 'category',
      p_phase_id: 'phase',
      p_group_id: null,
      p_reason: 'Actas verificadas',
      p_idempotency_key: 'request-key',
    });
  });

  test('publication and qualification use only the immutable revision id and reason', async () => {
    await publishTournamentStandings({ revisionId: 'revision', reason: 'Publicación revisada' });
    expect(supabase.rpc).toHaveBeenLastCalledWith(
      'publish_tournament_standings_revision',
      { p_revision_id: 'revision', p_reason: 'Publicación revisada' },
    );
    await resolveTournamentQualification({ revisionId: 'revision', reason: 'Fase completa' });
    expect(supabase.rpc).toHaveBeenLastCalledWith(
      'resolve_tournament_qualification',
      { p_revision_id: 'revision', p_reason: 'Fase completa' },
    );
  });

  test('disciplinary override is explicit, reasoned and idempotent', async () => {
    await createTournamentDisciplinaryOverride({
      suspensionId: 'suspension',
      action: 'reduce',
      matches: 1,
      reason: 'Fallo del tribunal',
      idempotencyKey: 'discipline-key',
    });
    expect(supabase.rpc).toHaveBeenCalledWith(
      'create_tournament_disciplinary_override',
      {
        p_suspension_id: 'suspension',
        p_action: 'reduce',
        p_matches: 1,
        p_reason: 'Fallo del tribunal',
        p_idempotency_key: 'discipline-key',
      },
    );
  });

  test('points adjustment carries the complete authoritative scope', async () => {
    await createTournamentPointsAdjustment({
      organizationId: 'org',
      fixtureVersionId: 'fixture',
      phaseId: 'phase',
      groupId: 'group',
      participantId: 'participant',
      points: -3,
      reason: 'Sanción administrativa',
      idempotencyKey: 'points-key',
    });
    expect(supabase.rpc).toHaveBeenCalledWith('create_tournament_points_adjustment', {
      p_organization_id: 'org',
      p_fixture_version_id: 'fixture',
      p_phase_id: 'phase',
      p_group_id: 'group',
      p_participant_id: 'participant',
      p_points: -3,
      p_reason: 'Sanción administrativa',
      p_idempotency_key: 'points-key',
    });
  });

  test('maps a stale revision to a safe corrective action', async () => {
    supabase.rpc.mockResolvedValue({
      data: null,
      error: { code: '55000', message: 'TORNEOS_STANDINGS_STALE' },
    });
    await expect(publishTournamentStandings({
      revisionId: 'revision',
      reason: 'Publicación revisada',
    })).rejects.toEqual(expect.objectContaining({
      code: 'TORNEOS_STANDINGS_STALE',
      message: 'Los resultados oficiales cambiaron. Recalculá antes de publicar.',
    }));
  });
});
