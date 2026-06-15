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

export const CHALLENGE_OUTCOME_OPTIONS = [
  { value: CHALLENGE_OUTCOME.WON, label: 'Ganamos' },
  { value: CHALLENGE_OUTCOME.DRAW, label: 'Empatamos' },
  { value: CHALLENGE_OUTCOME.LOST, label: 'Perdimos' },
];

const normalizeId = (value) => String(value ?? '').trim();

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
