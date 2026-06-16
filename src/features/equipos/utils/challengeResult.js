// Manual challenge results: the user picks an outcome from their own team's
// perspective (Ganamos / Empatamos / Perdimos) and we translate it to the
// absolute result_status stored in team_matches. team_a is always the
// challenger team and team_b the accepted (rival) team.

export const CHALLENGE_OUTCOME = Object.freeze({
  WON: 'won',
  DRAW: 'draw',
  LOST: 'lost',
});

export const RESULT_STATUS = Object.freeze({
  TEAM_A_WIN: 'team_a_win',
  TEAM_B_WIN: 'team_b_win',
  DRAW: 'draw',
});

export const RESULT_CONFLICT_STATUS = 'conflict';

export const CHALLENGE_OUTCOME_OPTIONS = [
  { value: CHALLENGE_OUTCOME.WON, label: 'Ganamos' },
  { value: CHALLENGE_OUTCOME.DRAW, label: 'Empatamos' },
  { value: CHALLENGE_OUTCOME.LOST, label: 'Perdimos' },
];

// Conflict resolution uses absolute outcomes (the challenge creator is neutral),
// so the options map straight to result_status with real team names as labels.
export const getChallengeResolveOptions = ({ teamAName, teamBName } = {}) => {
  const safeTeamA = String(teamAName || 'Equipo A').trim() || 'Equipo A';
  const safeTeamB = String(teamBName || 'Equipo B').trim() || 'Equipo B';
  return [
    { value: RESULT_STATUS.TEAM_A_WIN, label: `Ganó ${safeTeamA}` },
    { value: RESULT_STATUS.DRAW, label: 'Empataron' },
    { value: RESULT_STATUS.TEAM_B_WIN, label: `Ganó ${safeTeamB}` },
  ];
};

const normalizeId = (value) => String(value ?? '').trim();
const normalizeToken = (value) => String(value ?? '').trim().toLowerCase();

const RESULT_ACTION_CHALLENGE_STATES = new Set(['confirmed', 'completed']);
const RESULT_ACTION_MATCH_STATES = new Set(['confirmed', 'played']);
const RESULT_BLOCKED_CHALLENGE_STATES = new Set(['canceled', 'cancelled', 'rejected', 'rechazado', 'cancelado']);
const RESULT_BLOCKED_MATCH_STATES = new Set(['canceled', 'cancelled', 'rejected', 'rechazado', 'cancelado']);

export const isChallengeResultLoaded = (resultStatus) => (
  resultStatus === RESULT_STATUS.TEAM_A_WIN
  || resultStatus === RESULT_STATUS.TEAM_B_WIN
  || resultStatus === RESULT_STATUS.DRAW
);

export const isChallengeResultConflict = (teamMatchOrStatus) => {
  if (teamMatchOrStatus && typeof teamMatchOrStatus === 'object') {
    return Boolean(teamMatchOrStatus.result_conflict)
      || normalizeToken(teamMatchOrStatus.result_status) === RESULT_CONFLICT_STATUS
      || normalizeToken(teamMatchOrStatus.result_status) === 'disputed';
  }
  const token = normalizeToken(teamMatchOrStatus);
  return token === RESULT_CONFLICT_STATUS || token === 'disputed';
};

export const isChallengeResultConfirmed = (teamMatchOrStatus) => {
  if (teamMatchOrStatus && typeof teamMatchOrStatus === 'object') {
    const resultStatus = teamMatchOrStatus.result_status;
    if (!isChallengeResultLoaded(resultStatus)) return false;
    if (Object.prototype.hasOwnProperty.call(teamMatchOrStatus, 'result_confirmed')) {
      return teamMatchOrStatus.result_confirmed === true;
    }
    return true;
  }
  return isChallengeResultLoaded(teamMatchOrStatus);
};

export const isChallengeResultFinal = (teamMatchOrStatus) => (
  isChallengeResultConflict(teamMatchOrStatus)
  || isChallengeResultConfirmed(teamMatchOrStatus)
);

export const hasTeamReportedChallengeResult = (teamMatch, teamId) => {
  const normalizedTeamId = normalizeId(teamId);
  if (!normalizedTeamId) return false;
  const reportingTeamId = normalizeId(teamMatch?.result_reported_by_team_id);
  return Boolean(reportingTeamId && reportingTeamId === normalizedTeamId);
};

export const canTeamReportChallengeResult = (teamMatch, teamId) => {
  if (isChallengeResultConflict(teamMatch)) return false;
  if (isChallengeResultConfirmed(teamMatch)) return false;
  return !hasTeamReportedChallengeResult(teamMatch, teamId);
};

// Conflicts are resolved ONLY by the challenge creator (challenges.created_by_user_id),
// never by team captains/admins or common players. Requires an active conflict.
export const canResolveChallengeResult = (
  teamMatchOrChallenge,
  { userId, challengeCreatorUserId } = {},
) => {
  if (!isChallengeResultConflict(teamMatchOrChallenge)) return false;
  const userToken = normalizeId(userId);
  const creatorToken = normalizeId(challengeCreatorUserId);
  return Boolean(userToken && creatorToken && userToken === creatorToken);
};

// Automatic prompt timing. The survey prompt (push / in-app notification /
// activity) must only be generated 60 minutes after the scheduled kickoff, and
// only while the match is still "recent" so the backend cron never spams fresh
// pushes for very old unreported matches (anti-backfill window). Old matches
// stay answerable through the Recap / Mis Desafíos / detail fallbacks, which
// rely on isChallengeResultPending (kept broad on purpose) instead.
export const CHALLENGE_RESULT_PROMPT_DELAY_MS = 60 * 60 * 1000;
export const CHALLENGE_RESULT_PROMPT_WINDOW_MS = 48 * 60 * 60 * 1000;

export const isChallengeResultPromptEligible = ({
  scheduledAt = null,
  now = Date.now(),
} = {}) => {
  const scheduledMs = scheduledAt ? new Date(scheduledAt).getTime() : NaN;
  if (!Number.isFinite(scheduledMs)) return false;
  const elapsed = now - scheduledMs;
  return elapsed >= CHALLENGE_RESULT_PROMPT_DELAY_MS
    && elapsed <= CHALLENGE_RESULT_PROMPT_WINDOW_MS;
};

export const challengeHasAcceptedRival = (challengeOrMatch) => Boolean(
  normalizeId(challengeOrMatch?.accepted_team_id)
  || (
    normalizeId(challengeOrMatch?.team_a_id)
    && normalizeId(challengeOrMatch?.team_b_id)
  )
);

export const isChallengeResultActionState = ({
  challengeStatus = null,
  matchStatus = null,
  scheduledAt = null,
} = {}) => {
  const normalizedChallengeStatus = normalizeToken(challengeStatus);
  const normalizedMatchStatus = normalizeToken(matchStatus);
  const scheduledAtMs = scheduledAt ? new Date(scheduledAt).getTime() : NaN;
  const isPastScheduled = Number.isFinite(scheduledAtMs) && scheduledAtMs <= Date.now();

  if (
    RESULT_BLOCKED_CHALLENGE_STATES.has(normalizedChallengeStatus)
    || RESULT_BLOCKED_MATCH_STATES.has(normalizedMatchStatus)
  ) {
    return false;
  }

  if (RESULT_ACTION_CHALLENGE_STATES.has(normalizedChallengeStatus)) return true;
  if (normalizedChallengeStatus === 'accepted') {
    return normalizedMatchStatus === 'played' || isPastScheduled;
  }
  if (RESULT_ACTION_MATCH_STATES.has(normalizedMatchStatus)) return true;
  if (isPastScheduled) return true;

  return false;
};

export const isChallengeResultPending = ({
  challenge = null,
  teamMatch = null,
  scheduledAt = null,
} = {}) => {
  const resultStatus = teamMatch?.result_status ?? challenge?.result_status ?? null;
  const resultState = teamMatch || challenge || null;
  if (isChallengeResultConflict(resultState)) return false;
  if (isChallengeResultLoaded(resultStatus) && isChallengeResultConfirmed(resultState || resultStatus)) return false;

  return Boolean(
    (challengeHasAcceptedRival(challenge) || challengeHasAcceptedRival(teamMatch))
    && isChallengeResultActionState({
      challengeStatus: challenge?.status,
      matchStatus: teamMatch?.status,
      scheduledAt: scheduledAt || teamMatch?.scheduled_at || challenge?.scheduled_at,
    }),
  );
};

// Translate the viewer's outcome into the absolute stored result_status.
export const outcomeToResultStatus = (outcome, { perspectiveIsChallenger }) => {
  if (outcome === CHALLENGE_OUTCOME.DRAW) return RESULT_STATUS.DRAW;
  if (outcome === CHALLENGE_OUTCOME.WON) {
    return perspectiveIsChallenger ? RESULT_STATUS.TEAM_A_WIN : RESULT_STATUS.TEAM_B_WIN;
  }
  if (outcome === CHALLENGE_OUTCOME.LOST) {
    return perspectiveIsChallenger ? RESULT_STATUS.TEAM_B_WIN : RESULT_STATUS.TEAM_A_WIN;
  }
  return null;
};

// Translate a stored result_status back into the viewer's outcome.
export const resultStatusToOutcome = (resultStatus, { perspectiveIsChallenger }) => {
  if (resultStatus === RESULT_STATUS.DRAW) return CHALLENGE_OUTCOME.DRAW;
  if (resultStatus === RESULT_STATUS.TEAM_A_WIN) {
    return perspectiveIsChallenger ? CHALLENGE_OUTCOME.WON : CHALLENGE_OUTCOME.LOST;
  }
  if (resultStatus === RESULT_STATUS.TEAM_B_WIN) {
    return perspectiveIsChallenger ? CHALLENGE_OUTCOME.LOST : CHALLENGE_OUTCOME.WON;
  }
  return null;
};

export const outcomeLabel = (outcome) => {
  const match = CHALLENGE_OUTCOME_OPTIONS.find((option) => option.value === outcome);
  return match ? match.label : null;
};

export const getChallengeResultOutcomeLabel = (resultStatus, { perspectiveIsChallenger }) => {
  const outcome = resultStatusToOutcome(resultStatus, { perspectiveIsChallenger });
  return outcomeLabel(outcome);
};

// Resolve which side of the challenge the viewer manages, so the modal can map
// "Ganamos/Perdimos" correctly and we never rely on a manual text rival.
export const resolveChallengePerspective = ({ challenge, manageableTeamIds = null, userId = null }) => {
  const challengerId = normalizeId(challenge?.challenger_team_id || challenge?.challenger_team?.id);
  const acceptedId = normalizeId(challenge?.accepted_team_id || challenge?.accepted_team?.id);

  const ids = manageableTeamIds instanceof Set
    ? manageableTeamIds
    : new Set((manageableTeamIds || []).map((value) => normalizeId(value)).filter(Boolean));

  const token = normalizeId(userId);
  const managesChallenger = (challengerId && ids.has(challengerId))
    || (token && normalizeId(challenge?.created_by_user_id) === token);
  const managesAccepted = (acceptedId && ids.has(acceptedId))
    || (token && normalizeId(challenge?.accepted_by_user_id) === token);

  let perspectiveIsChallenger;
  if (managesChallenger && !managesAccepted) {
    perspectiveIsChallenger = true;
  } else if (managesAccepted && !managesChallenger) {
    perspectiveIsChallenger = false;
  } else {
    // Ambiguous or unknown: default to challenger perspective for labelling.
    perspectiveIsChallenger = true;
  }

  return {
    perspectiveIsChallenger,
    myTeamId: perspectiveIsChallenger ? challengerId : acceptedId,
    myTeamName: perspectiveIsChallenger
      ? (challenge?.challenger_team?.name || 'Mi equipo')
      : (challenge?.accepted_team?.name || 'Mi equipo'),
    rivalTeamId: perspectiveIsChallenger ? acceptedId : challengerId,
    rivalTeamName: perspectiveIsChallenger
      ? (challenge?.accepted_team?.name || 'Rival')
      : (challenge?.challenger_team?.name || 'Rival'),
    canIdentifyTeam: managesChallenger !== managesAccepted,
  };
};
