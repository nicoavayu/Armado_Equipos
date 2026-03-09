import { lockSurveyTeamsOnce } from '../services/surveyTeamsService';
import { supabase } from '../supabase';

jest.mock('../supabase', () => ({
  supabase: {
    rpc: jest.fn(),
  },
}));

describe('survey team locking (first writer wins)', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('first voter locks teams and second voter cannot overwrite them', async () => {
    supabase.rpc
      .mockResolvedValueOnce({
        data: {
          success: true,
          reason: 'locked',
          teams_source: 'survey',
          teams_locked: true,
          team_a: ['p1', 'p2'],
          team_b: ['p3', 'p4'],
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          success: false,
          reason: 'already_locked',
          locked_by_other: true,
          teams_source: 'survey',
          teams_locked: true,
          team_a: ['p1', 'p2'],
          team_b: ['p3', 'p4'],
        },
        error: null,
      });

    const firstResult = await lockSurveyTeamsOnce({
      matchId: 101,
      teamARefs: ['p1', 'p2'],
      teamBRefs: ['p3', 'p4'],
    });
    const secondResult = await lockSurveyTeamsOnce({
      matchId: 101,
      teamARefs: ['x1', 'x2'],
      teamBRefs: ['x3', 'x4'],
    });

    expect(firstResult.success).toBe(true);
    expect(firstResult.alreadyLocked).toBe(false);

    expect(secondResult.ok).toBe(true);
    expect(secondResult.alreadyLocked).toBe(true);
    expect(secondResult.lockedByOther).toBe(true);
    expect(secondResult.teamARefs).toEqual(['p1', 'p2']);
    expect(secondResult.teamBRefs).toEqual(['p3', 'p4']);
  });
});
