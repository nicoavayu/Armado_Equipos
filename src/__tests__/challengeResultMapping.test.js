import {
  CHALLENGE_OUTCOME,
  RESULT_STATUS,
  CHALLENGE_RESULT_PROMPT_DELAY_MS,
  CHALLENGE_RESULT_PROMPT_WINDOW_MS,
  canTeamReportChallengeResult,
  outcomeToResultStatus,
  resultStatusToOutcome,
  resolveChallengePerspective,
  challengeHasAcceptedRival,
  isChallengeResultActionState,
  isChallengeResultConflict,
  isChallengeResultConfirmed,
  isChallengeResultFinal,
  isChallengeResultPromptEligible,
  isChallengeResultPending,
} from '../features/equipos/utils/challengeResult';

describe('challenge manual result mapping', () => {
  describe('outcomeToResultStatus', () => {
    test('challenger perspective maps Ganamos to team_a_win', () => {
      expect(outcomeToResultStatus(CHALLENGE_OUTCOME.WON, { perspectiveIsChallenger: true }))
        .toBe(RESULT_STATUS.TEAM_A_WIN);
      expect(outcomeToResultStatus(CHALLENGE_OUTCOME.LOST, { perspectiveIsChallenger: true }))
        .toBe(RESULT_STATUS.TEAM_B_WIN);
    });

    test('accepted (rival) perspective maps Ganamos to team_b_win', () => {
      expect(outcomeToResultStatus(CHALLENGE_OUTCOME.WON, { perspectiveIsChallenger: false }))
        .toBe(RESULT_STATUS.TEAM_B_WIN);
      expect(outcomeToResultStatus(CHALLENGE_OUTCOME.LOST, { perspectiveIsChallenger: false }))
        .toBe(RESULT_STATUS.TEAM_A_WIN);
    });

    test('Empatamos is always draw regardless of perspective', () => {
      expect(outcomeToResultStatus(CHALLENGE_OUTCOME.DRAW, { perspectiveIsChallenger: true }))
        .toBe(RESULT_STATUS.DRAW);
      expect(outcomeToResultStatus(CHALLENGE_OUTCOME.DRAW, { perspectiveIsChallenger: false }))
        .toBe(RESULT_STATUS.DRAW);
    });
  });

  describe('resultStatusToOutcome (round-trip)', () => {
    test('round-trips for the challenger', () => {
      [CHALLENGE_OUTCOME.WON, CHALLENGE_OUTCOME.DRAW, CHALLENGE_OUTCOME.LOST].forEach((outcome) => {
        const status = outcomeToResultStatus(outcome, { perspectiveIsChallenger: true });
        expect(resultStatusToOutcome(status, { perspectiveIsChallenger: true })).toBe(outcome);
      });
    });

    test('round-trips for the rival', () => {
      [CHALLENGE_OUTCOME.WON, CHALLENGE_OUTCOME.DRAW, CHALLENGE_OUTCOME.LOST].forEach((outcome) => {
        const status = outcomeToResultStatus(outcome, { perspectiveIsChallenger: false });
        expect(resultStatusToOutcome(status, { perspectiveIsChallenger: false })).toBe(outcome);
      });
    });

    test('the same stored status reads inversely for each side', () => {
      // team_a_win = the challenger won, so the rival lost.
      expect(resultStatusToOutcome(RESULT_STATUS.TEAM_A_WIN, { perspectiveIsChallenger: true }))
        .toBe(CHALLENGE_OUTCOME.WON);
      expect(resultStatusToOutcome(RESULT_STATUS.TEAM_A_WIN, { perspectiveIsChallenger: false }))
        .toBe(CHALLENGE_OUTCOME.LOST);
    });
  });

  describe('resolveChallengePerspective', () => {
    const challenge = {
      challenger_team_id: 'team-a',
      accepted_team_id: 'team-b',
      challenger_team: { id: 'team-a', name: 'Los Tigres' },
      accepted_team: { id: 'team-b', name: 'Los Leones' },
    };

    test('identifies the challenger side and uses the accepted team as rival', () => {
      const perspective = resolveChallengePerspective({
        challenge,
        manageableTeamIds: new Set(['team-a']),
      });
      expect(perspective.perspectiveIsChallenger).toBe(true);
      expect(perspective.myTeamId).toBe('team-a');
      expect(perspective.rivalTeamId).toBe('team-b');
      expect(perspective.rivalTeamName).toBe('Los Leones');
      expect(perspective.canIdentifyTeam).toBe(true);
    });

    test('identifies the accepted side', () => {
      const perspective = resolveChallengePerspective({
        challenge,
        manageableTeamIds: ['team-b'],
      });
      expect(perspective.perspectiveIsChallenger).toBe(false);
      expect(perspective.myTeamId).toBe('team-b');
      expect(perspective.rivalTeamId).toBe('team-a');
      expect(perspective.rivalTeamName).toBe('Los Tigres');
    });

    test('falls back to challenger perspective when ambiguous', () => {
      const perspective = resolveChallengePerspective({
        challenge,
        manageableTeamIds: new Set(['team-a', 'team-b']),
      });
      expect(perspective.canIdentifyTeam).toBe(false);
      expect(perspective.perspectiveIsChallenger).toBe(true);
    });
  });

  describe('CTA eligibility', () => {
    test('requires a real accepted rival', () => {
      expect(challengeHasAcceptedRival({
        challenger_team_id: 'team-a',
        accepted_team_id: null,
      })).toBe(false);
      expect(challengeHasAcceptedRival({
        team_a_id: 'team-a',
        team_b_id: 'team-b',
      })).toBe(true);
    });

    test('allows confirmed, completed, played or past challenges', () => {
      expect(isChallengeResultActionState({ challengeStatus: 'confirmed' })).toBe(true);
      expect(isChallengeResultActionState({ challengeStatus: 'completed' })).toBe(true);
      expect(isChallengeResultActionState({ matchStatus: 'played' })).toBe(true);
      expect(isChallengeResultActionState({ scheduledAt: '2026-06-14T20:00:00.000Z' })).toBe(true);
      expect(isChallengeResultActionState({ challengeStatus: 'accepted', scheduledAt: '2026-06-14T20:00:00.000Z' })).toBe(true);
      expect(isChallengeResultActionState({ challengeStatus: 'accepted', matchStatus: 'confirmed', scheduledAt: '2999-06-14T20:00:00.000Z' })).toBe(false);
      expect(isChallengeResultActionState({ challengeStatus: 'open', scheduledAt: '2999-06-14T20:00:00.000Z' })).toBe(false);
      expect(isChallengeResultActionState({ challengeStatus: 'canceled', scheduledAt: '2026-06-14T20:00:00.000Z' })).toBe(false);
      expect(isChallengeResultActionState({ challengeStatus: 'rejected', scheduledAt: '2026-06-14T20:00:00.000Z' })).toBe(false);
      expect(isChallengeResultActionState({ matchStatus: 'cancelled', scheduledAt: '2026-06-14T20:00:00.000Z' })).toBe(false);
    });
  });

  describe('confirmation and conflict state', () => {
    test('treats legacy loaded statuses as final when no confirmation field exists', () => {
      expect(isChallengeResultConfirmed({ result_status: RESULT_STATUS.TEAM_A_WIN })).toBe(true);
      expect(isChallengeResultFinal({ result_status: RESULT_STATUS.TEAM_A_WIN })).toBe(true);
    });

    test('keeps a one-team report pending until confirmed by the rival', () => {
      const teamMatch = {
        status: 'played',
        result_status: RESULT_STATUS.TEAM_A_WIN,
        result_confirmed: false,
        result_conflict: false,
        result_reported_by_team_id: 'team-a',
      };

      expect(isChallengeResultConfirmed(teamMatch)).toBe(false);
      expect(isChallengeResultFinal(teamMatch)).toBe(false);
      expect(canTeamReportChallengeResult(teamMatch, 'team-a')).toBe(false);
      expect(canTeamReportChallengeResult(teamMatch, 'team-b')).toBe(true);
      expect(isChallengeResultPending({
        challenge: { status: 'confirmed', accepted_team_id: 'team-b' },
        teamMatch,
        scheduledAt: '2026-06-14T20:00:00.000Z',
      })).toBe(true);
    });

    test('conflict blocks further automatic result actions', () => {
      const teamMatch = {
        status: 'played',
        result_status: null,
        result_confirmed: false,
        result_conflict: true,
      };

      expect(isChallengeResultConflict(teamMatch)).toBe(true);
      expect(isChallengeResultFinal(teamMatch)).toBe(true);
      expect(canTeamReportChallengeResult(teamMatch, 'team-a')).toBe(false);
      expect(isChallengeResultPending({
        challenge: { status: 'confirmed', accepted_team_id: 'team-b' },
        teamMatch,
        scheduledAt: '2026-06-14T20:00:00.000Z',
      })).toBe(false);
    });
  });

  describe('isChallengeResultPromptEligible (automatic 60-min + recent window)', () => {
    const now = new Date('2026-06-16T12:00:00.000Z').getTime();
    const at = (msAgo) => new Date(now - msAgo).toISOString();

    test('eligible once 60 minutes past the scheduled kickoff', () => {
      expect(isChallengeResultPromptEligible({ scheduledAt: at(CHALLENGE_RESULT_PROMPT_DELAY_MS), now })).toBe(true);
      expect(isChallengeResultPromptEligible({ scheduledAt: at(90 * 60 * 1000), now })).toBe(true);
    });

    test('not eligible before the 60-minute delay', () => {
      expect(isChallengeResultPromptEligible({ scheduledAt: at(30 * 60 * 1000), now })).toBe(false);
      expect(isChallengeResultPromptEligible({ scheduledAt: at(59 * 60 * 1000), now })).toBe(false);
    });

    test('not eligible for a future match', () => {
      expect(isChallengeResultPromptEligible({ scheduledAt: at(-60 * 60 * 1000), now })).toBe(false);
    });

    test('not eligible past the anti-backfill window (very old match)', () => {
      expect(isChallengeResultPromptEligible({ scheduledAt: at(CHALLENGE_RESULT_PROMPT_WINDOW_MS + 60 * 1000), now })).toBe(false);
      expect(isChallengeResultPromptEligible({ scheduledAt: at(7 * 24 * 60 * 60 * 1000), now })).toBe(false);
    });

    test('returns false for a missing or invalid scheduled time', () => {
      expect(isChallengeResultPromptEligible({ scheduledAt: null, now })).toBe(false);
      expect(isChallengeResultPromptEligible({ scheduledAt: 'not-a-date', now })).toBe(false);
    });

    test('old matches stay answerable: pending stays broad even outside the prompt window', () => {
      const veryOld = at(7 * 24 * 60 * 60 * 1000);
      // The automatic prompt is suppressed for very old matches...
      expect(isChallengeResultPromptEligible({ scheduledAt: veryOld, now })).toBe(false);
      // ...but they remain actionable in Recap / Mis Desafíos / detail.
      expect(isChallengeResultPending({
        challenge: { status: 'confirmed', accepted_team_id: 'team-b' },
        teamMatch: { status: 'confirmed', result_status: null },
        scheduledAt: veryOld,
      })).toBe(true);
    });
  });
});
