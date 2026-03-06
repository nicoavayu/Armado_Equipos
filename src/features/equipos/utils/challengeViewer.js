const normalizeIdToken = (value) => String(value ?? '').trim();

const resolveMemberUserToken = (member = {}) => normalizeIdToken(
  member?.user_id
  || member?.jugador?.usuario_id
  || null,
);

const isViewerInTeam = ({
  team,
  teamId,
  teamMembersByTeamId = {},
  challengeSquadDisplayByTeamId = {},
  userToken = '',
}) => {
  if (!teamId || !userToken) return false;

  const isOwner = normalizeIdToken(team?.owner_user_id) === userToken;
  if (isOwner) return true;

  const memberRows = teamMembersByTeamId?.[teamId] || [];
  const inTeamMembers = memberRows.some((member) => resolveMemberUserToken(member) === userToken);
  if (inTeamMembers) return true;

  const squadRows = challengeSquadDisplayByTeamId?.[teamId] || [];
  const inChallengeSquad = squadRows.some((row) => resolveMemberUserToken(row) === userToken);
  return inChallengeSquad;
};

export const getViewerChallengeTeam = ({
  match,
  userId,
  teamMembersByTeamId = {},
  challengeSquadDisplayByTeamId = {},
}) => {
  const teamAId = String(match?.team_a_id || '').trim();
  const teamBId = String(match?.team_b_id || '').trim();
  const userToken = normalizeIdToken(userId);

  const baseResult = {
    myTeamId: null,
    myTeam: null,
    rivalTeamId: null,
    rivalTeam: null,
    isParticipant: false,
    isAmbiguous: false,
  };

  if (!teamAId || !teamBId || !userToken) return baseResult;

  const inTeamA = isViewerInTeam({
    team: match?.team_a,
    teamId: teamAId,
    teamMembersByTeamId,
    challengeSquadDisplayByTeamId,
    userToken,
  });

  const inTeamB = isViewerInTeam({
    team: match?.team_b,
    teamId: teamBId,
    teamMembersByTeamId,
    challengeSquadDisplayByTeamId,
    userToken,
  });

  if (!inTeamA && !inTeamB) {
    return baseResult;
  }

  if (inTeamA && inTeamB) {
    const ownerInA = normalizeIdToken(match?.team_a?.owner_user_id) === userToken;
    const ownerInB = normalizeIdToken(match?.team_b?.owner_user_id) === userToken;
    if (ownerInA !== ownerInB) {
      if (ownerInA) {
        return {
          myTeamId: teamAId,
          myTeam: match?.team_a || null,
          rivalTeamId: teamBId,
          rivalTeam: match?.team_b || null,
          isParticipant: true,
          isAmbiguous: false,
        };
      }
      return {
        myTeamId: teamBId,
        myTeam: match?.team_b || null,
        rivalTeamId: teamAId,
        rivalTeam: match?.team_a || null,
        isParticipant: true,
        isAmbiguous: false,
      };
    }

    return {
      ...baseResult,
      isParticipant: true,
      isAmbiguous: true,
    };
  }

  if (inTeamA) {
    return {
      myTeamId: teamAId,
      myTeam: match?.team_a || null,
      rivalTeamId: teamBId,
      rivalTeam: match?.team_b || null,
      isParticipant: true,
      isAmbiguous: false,
    };
  }

  return {
    myTeamId: teamBId,
    myTeam: match?.team_b || null,
    rivalTeamId: teamAId,
    rivalTeam: match?.team_a || null,
    isParticipant: true,
    isAmbiguous: false,
  };
};

export const resolveChallengeSquadViewState = ({
  isChallengeMatch = false,
  viewerChallengeTeam = null,
  myChallengeTeamId = null,
  canManageMyChallengeSquad = false,
}) => {
  const isParticipant = Boolean(viewerChallengeTeam?.isParticipant);
  const isAmbiguous = Boolean(viewerChallengeTeam?.isAmbiguous);
  const hasMyTeam = Boolean(String(myChallengeTeamId || '').trim());
  const showOperationalModule = Boolean(isChallengeMatch && isParticipant && hasMyTeam && !isAmbiguous);

  return {
    showAmbiguousNotice: Boolean(isChallengeMatch && isAmbiguous),
    showOperationalModule,
    showMyAvailability: showOperationalModule,
    showMySquadManagement: Boolean(showOperationalModule && canManageMyChallengeSquad),
  };
};

export default getViewerChallengeTeam;
