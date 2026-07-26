import { supabase } from '../services/api/supabase';
import {
  executeTournamentGroupDraw,
  freezeTournamentParticipants,
  generateTournamentFixture,
  rescheduleTournamentMatch,
  saveTournamentScheduleWindows,
  scheduleTournamentMatch,
} from '../features/torneos/api/tournamentWorkspaceService';

jest.mock('../services/api/supabase', () => ({
  supabase: { rpc: jest.fn(), from: jest.fn() },
}));

const scope = {
  organizationId: 'org-a',
  tournamentId: 'tournament-a',
  categoryId: 'category-a',
};

describe('tournament fixture service contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    supabase.rpc.mockResolvedValue({ data: { ok: true }, error: null });
  });

  test('freezes participants without accepting client-owned identity fields', async () => {
    await freezeTournamentParticipants({
      ...scope,
      idempotencyKey: 'request-a',
      userId: 'forged-user',
      participantIds: ['forged-participant'],
    });
    expect(supabase.rpc).toHaveBeenCalledWith('freeze_tournament_participants', {
      p_organization_id: 'org-a',
      p_tournament_id: 'tournament-a',
      p_category_id: 'category-a',
      p_idempotency_key: 'request-a',
    });
  });

  test('sends deterministic draw and fixture configuration to authoritative RPCs', async () => {
    await executeTournamentGroupDraw({
      ...scope,
      groupCount: 4,
      seed: 'apertura-2026',
      publish: true,
    });
    await generateTournamentFixture({
      ...scope,
      seed: 'fixture-v1',
      configuration: { minimumRestMinutes: 720 },
      idempotencyKey: 'request-b',
    });
    expect(supabase.rpc).toHaveBeenNthCalledWith(1, 'execute_tournament_group_draw', {
      p_organization_id: 'org-a',
      p_tournament_id: 'tournament-a',
      p_category_id: 'category-a',
      p_group_count: 4,
      p_seed: 'apertura-2026',
      p_publish: true,
    });
    expect(supabase.rpc).toHaveBeenNthCalledWith(2, 'generate_tournament_fixture', {
      p_organization_id: 'org-a',
      p_tournament_id: 'tournament-a',
      p_category_id: 'category-a',
      p_seed: 'fixture-v1',
      p_configuration: { minimumRestMinutes: 720 },
      p_idempotency_key: 'request-b',
    });
  });

  test('persists scheduling windows with tournament scope', async () => {
    const windows = [{
      dayOfWeek: 6,
      startsAt: '09:00',
      endsAt: '18:00',
      slotDurationMinutes: 60,
    }];
    await saveTournamentScheduleWindows({ ...scope, windows });
    expect(supabase.rpc).toHaveBeenCalledWith('save_tournament_schedule_windows', {
      p_organization_id: 'org-a',
      p_tournament_id: 'tournament-a',
      p_windows: windows,
    });
  });

  test('requires scheduling overrides and reasons to be explicit', async () => {
    const assignment = {
      ...scope,
      matchId: 'match-a',
      scheduledAt: '2030-06-01T15:00:00.000Z',
      venueId: 'venue-a',
      courtId: 'court-a',
      durationMinutes: 60,
      overrideWarnings: true,
      overrideReason: 'Aceptado por organización',
    };
    await scheduleTournamentMatch(assignment);
    await rescheduleTournamentMatch({
      ...assignment,
      scheduledAt: '2030-06-01T18:00:00.000Z',
      reason: 'Cambio de cancha',
    });
    expect(supabase.rpc).toHaveBeenNthCalledWith(1, 'schedule_tournament_match', {
      p_organization_id: 'org-a',
      p_match_id: 'match-a',
      p_scheduled_at: '2030-06-01T15:00:00.000Z',
      p_venue_id: 'venue-a',
      p_court_id: 'court-a',
      p_duration_minutes: 60,
      p_override_warnings: true,
      p_override_reason: 'Aceptado por organización',
    });
    expect(supabase.rpc).toHaveBeenNthCalledWith(2, 'reschedule_tournament_match', {
      p_organization_id: 'org-a',
      p_match_id: 'match-a',
      p_scheduled_at: '2030-06-01T18:00:00.000Z',
      p_venue_id: 'venue-a',
      p_court_id: 'court-a',
      p_duration_minutes: 60,
      p_reason: 'Cambio de cancha',
      p_override_warnings: true,
    });
  });
});
