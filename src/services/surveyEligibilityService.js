import { listChallengeApprovedSquad, listTeamMatchMembers } from './db/teamChallenges';
import { normalizeIdentityRef, resolvePersistRef } from './surveyTeamsService';

const normalizeUserId = (value) => String(value || '').trim();
const normalizeTeamId = (value) => String(value || '').trim();
const normalizeRosterRef = (value) => normalizeIdentityRef(value);
const normalizeUserIdSetInput = (values = []) => {
  const input = values instanceof Set
    ? Array.from(values)
    : (Array.isArray(values) ? values : [values]);

  return new Set(input.map((value) => normalizeUserId(value)).filter(Boolean));
};

export const isChallengeLikeSurveyMatch = (teamMatchRow) => {
  const originType = String(teamMatchRow?.origin_type || '').trim().toLowerCase();
  return originType === 'challenge' || Boolean(teamMatchRow?.challenge_id);
};

export const buildEligibleRosterMap = (rows = [], options = {}) => {
  const byPlayerId = new Map();
  const eligibleUserIds = new Set();
  const allowedUserIds = normalizeUserIdSetInput(options?.eligibleUserIds || []);

  (rows || []).forEach((row) => {
    const playerId = Number(row?.id);
    const userId = normalizeUserId(row?.usuario_id);
    if (!Number.isFinite(playerId) || !userId) return;
    if (allowedUserIds.size > 0 && !allowedUserIds.has(userId)) return;
    byPlayerId.set(playerId, userId);
    eligibleUserIds.add(userId);
  });

  return {
    byPlayerId,
    eligibleUserIds,
    expectedVoters: eligibleUserIds.size,
  };
};

const parsePersistedTeamsPayload = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (typeof payload === 'string') {
    try {
      const parsed = JSON.parse(payload);
      return Array.isArray(parsed) ? parsed : null;
    } catch (_error) {
      return null;
    }
  }
  return null;
};

const pushRosterRef = (bucket, value) => {
  const token = normalizeRosterRef(value);
  if (token) bucket.add(token);
};

const collectRosterRefsFromParticipantRows = (rows = []) => {
  const refs = new Set();

  (rows || []).forEach((row) => {
    const player = row?.jugador && typeof row.jugador === 'object' ? row.jugador : row;
    [
      resolvePersistRef(player),
      row?.user_id,
      player?.usuario_id,
      player?.uuid,
      player?.id,
      player?.nombre,
    ].forEach((value) => pushRosterRef(refs, value));
  });

  return refs;
};

const collectRosterRefsFromTeamsPayload = (payload) => {
  const refs = new Set();
  const normalized = parsePersistedTeamsPayload(payload);
  if (!Array.isArray(normalized) || normalized.length === 0) return refs;

  normalized.forEach((team) => {
    const players = Array.isArray(team?.players) ? team.players : [];
    players.forEach((playerRef) => {
      if (playerRef && typeof playerRef === 'object') {
        [
          resolvePersistRef(playerRef),
          playerRef?.usuario_id,
          playerRef?.uuid,
          playerRef?.id,
          playerRef?.nombre,
        ].forEach((value) => pushRosterRef(refs, value));
        return;
      }

      pushRosterRef(refs, playerRef);
    });
  });

  return refs;
};

const getChallengeTeamBuckets = ({ byTeamId = {}, teamAId = null, teamBId = null } = {}) => {
  const teamAKey = normalizeTeamId(teamAId);
  const teamBKey = normalizeTeamId(teamBId);
  if (!teamAKey || !teamBKey) return null;

  const teamA = Array.isArray(byTeamId?.[teamAKey]) ? byTeamId[teamAKey] : [];
  const teamB = Array.isArray(byTeamId?.[teamBKey]) ? byTeamId[teamBKey] : [];
  if (teamA.length === 0 || teamB.length === 0) return null;

  return { teamA, teamB };
};

const collectUserIdsFromParticipants = (rows = []) => {
  const userIds = new Set();

  (rows || []).forEach((row) => {
    const userId = normalizeUserId(
      row?.user_id
      || row?.jugador?.usuario_id
      || row?.usuario_id,
    );
    if (userId) userIds.add(userId);
  });

  return userIds;
};

const resolveApprovedSquadEligibleUsers = ({
  approvedByTeamId = null,
  teamAId = null,
  teamBId = null,
} = {}) => {
  const buckets = getChallengeTeamBuckets({
    byTeamId: approvedByTeamId || {},
    teamAId,
    teamBId,
  });
  if (!buckets) return null;

  return {
    source: 'approved_squad',
    eligibleUserIds: collectUserIdsFromParticipants([
      ...buckets.teamA,
      ...buckets.teamB,
    ]),
  };
};

const buildRosterRefToUserIds = (rosterRows = []) => {
  const refToUserIds = new Map();

  const pushRef = (ref, userId) => {
    const token = normalizeIdentityRef(ref);
    if (!token || !userId) return;
    const bucket = refToUserIds.get(token) || new Set();
    bucket.add(userId);
    refToUserIds.set(token, bucket);
  };

  (rosterRows || []).forEach((row) => {
    const userId = normalizeUserId(row?.usuario_id);
    if (!userId) return;

    [
      resolvePersistRef(row),
      row?.usuario_id,
      row?.uuid,
      row?.id,
      row?.nombre,
    ].forEach((ref) => pushRef(ref, userId));
  });

  return refToUserIds;
};

const collectUserIdsFromRefs = (refs = [], refToUserIds = new Map()) => {
  const userIds = new Set();

  (Array.isArray(refs) ? refs : []).forEach((ref) => {
    const bucket = refToUserIds.get(normalizeIdentityRef(ref));
    if (!(bucket instanceof Set)) return;
    bucket.forEach((userId) => {
      if (userId) userIds.add(userId);
    });
  });

  return userIds;
};

const resolveConfirmedRosterEligibleUsers = ({
  rosterRows = [],
  confirmationRow = null,
} = {}) => {
  if (!confirmationRow || typeof confirmationRow !== 'object') return null;

  const participants = Array.isArray(confirmationRow?.participants) ? confirmationRow.participants : [];
  const participantUserIds = collectUserIdsFromParticipants(participants);
  const participantRefs = collectRosterRefsFromParticipantRows(participants);
  if (participantUserIds.size > 0) {
    return {
      source: 'confirmed_participants',
      eligibleUserIds: participantUserIds,
      rosterRefs: participantRefs,
      excludeSubstitutesByDefault: false,
    };
  }

  const teamRefs = new Set([
    ...collectRosterRefsFromTeamsPayload(confirmationRow?.teams_json),
    ...(Array.isArray(confirmationRow?.team_a) ? confirmationRow.team_a : []).map((value) => normalizeRosterRef(value)).filter(Boolean),
    ...(Array.isArray(confirmationRow?.team_b) ? confirmationRow.team_b : []).map((value) => normalizeRosterRef(value)).filter(Boolean),
  ]);
  if (teamRefs.size === 0) return null;

  const refToUserIds = buildRosterRefToUserIds(rosterRows);
  const eligibleUserIds = collectUserIdsFromRefs(Array.from(teamRefs), refToUserIds);
  if (eligibleUserIds.size === 0) return null;

  return {
    source: 'confirmed_teams',
    eligibleUserIds,
    rosterRefs: teamRefs,
    excludeSubstitutesByDefault: false,
  };
};

const resolvePersistedMatchRosterEligibleUsers = ({
  rosterRows = [],
  matchRow = null,
} = {}) => {
  const payloadRefs = new Set([
    ...collectRosterRefsFromTeamsPayload(matchRow?.equipos_json),
    ...collectRosterRefsFromTeamsPayload(matchRow?.equipos),
  ]);
  if (payloadRefs.size === 0) return null;

  const refToUserIds = buildRosterRefToUserIds(rosterRows);
  const eligibleUserIds = collectUserIdsFromRefs(Array.from(payloadRefs), refToUserIds);
  if (eligibleUserIds.size === 0) return null;

  return {
    source: 'persisted_match_roster',
    eligibleUserIds,
    rosterRefs: payloadRefs,
    excludeSubstitutesByDefault: false,
  };
};

const resolvePersistedTeamEligibleUsers = ({
  rosterRows = [],
  matchRow = null,
} = {}) => {
  const surveyTeamA = Array.isArray(matchRow?.survey_team_a) ? matchRow.survey_team_a : [];
  const surveyTeamB = Array.isArray(matchRow?.survey_team_b) ? matchRow.survey_team_b : [];
  const finalTeamA = Array.isArray(matchRow?.final_team_a) ? matchRow.final_team_a : [];
  const finalTeamB = Array.isArray(matchRow?.final_team_b) ? matchRow.final_team_b : [];

  const teamARefs = surveyTeamA.length > 0 ? surveyTeamA : finalTeamA;
  const teamBRefs = surveyTeamB.length > 0 ? surveyTeamB : finalTeamB;
  if (teamARefs.length === 0 || teamBRefs.length === 0) return null;

  const refToUserIds = buildRosterRefToUserIds(rosterRows);
  return {
    source: 'persisted_teams',
    eligibleUserIds: new Set([
      ...collectUserIdsFromRefs(teamARefs, refToUserIds),
      ...collectUserIdsFromRefs(teamBRefs, refToUserIds),
    ]),
    rosterRefs: new Set([
      ...teamARefs.map((value) => normalizeRosterRef(value)).filter(Boolean),
      ...teamBRefs.map((value) => normalizeRosterRef(value)).filter(Boolean),
    ]),
    excludeSubstitutesByDefault: false,
  };
};

const resolveTeamMatchMemberEligibleUsers = ({
  membersByTeamId = null,
  teamAId = null,
  teamBId = null,
} = {}) => {
  const buckets = getChallengeTeamBuckets({
    byTeamId: membersByTeamId || {},
    teamAId,
    teamBId,
  });
  if (!buckets) return null;

  return {
    source: 'team_match_members',
    eligibleUserIds: collectUserIdsFromParticipants([
      ...buckets.teamA,
      ...buckets.teamB,
    ]),
    rosterRefs: collectRosterRefsFromParticipantRows([
      ...buckets.teamA,
      ...buckets.teamB,
    ]),
    excludeSubstitutesByDefault: false,
  };
};

const resolveStarterRosterEligibleUsers = ({
  rosterRows = [],
} = {}) => {
  const starterRows = (rosterRows || []).filter((row) => row?.is_substitute !== true);
  const effectiveRows = starterRows.length > 0 ? starterRows : (Array.isArray(rosterRows) ? rosterRows : []);
  const starterEligible = buildEligibleRosterMap(effectiveRows);

  return {
    source: starterRows.length > 0 ? 'starter_roster' : 'roster',
    eligibleUserIds: starterEligible.eligibleUserIds,
    rosterRefs: new Set(),
    excludeSubstitutesByDefault: starterRows.length > 0,
  };
};

export const resolveChallengeSurveyEligibleUsers = async ({
  matchId = null,
  rosterRows = [],
  teamMatchRow = null,
  matchRow = null,
  confirmationRow = null,
  approvedByTeamId = null,
  membersByTeamId = null,
} = {}) => {
  if (!isChallengeLikeSurveyMatch(teamMatchRow)) {
    const confirmedEligibility = resolveConfirmedRosterEligibleUsers({
      rosterRows,
      confirmationRow,
    });
    if (confirmedEligibility) {
      return {
        ...confirmedEligibility,
        approvedByTeamId: approvedByTeamId || null,
        membersByTeamId: membersByTeamId || null,
      };
    }

    const persistedMatchEligibility = resolvePersistedMatchRosterEligibleUsers({
      rosterRows,
      matchRow,
    });
    if (persistedMatchEligibility) {
      return {
        ...persistedMatchEligibility,
        approvedByTeamId: approvedByTeamId || null,
        membersByTeamId: membersByTeamId || null,
      };
    }

    const persistedEligibility = resolvePersistedTeamEligibleUsers({
      rosterRows,
      matchRow,
    });
    if (persistedEligibility) {
      return {
        ...persistedEligibility,
        approvedByTeamId: approvedByTeamId || null,
        membersByTeamId: membersByTeamId || null,
      };
    }

    const starterEligibility = resolveStarterRosterEligibleUsers({
      rosterRows,
    });
    return {
      ...starterEligibility,
      approvedByTeamId: approvedByTeamId || null,
      membersByTeamId: membersByTeamId || null,
    };
  }

  const teamIds = [
    teamMatchRow?.team_a_id,
    teamMatchRow?.team_b_id,
  ].filter(Boolean);

  let resolvedApprovedByTeamId = approvedByTeamId || null;
  if (!resolvedApprovedByTeamId && teamMatchRow?.challenge_id && teamIds.length === 2) {
    try {
      const approvedSquad = await listChallengeApprovedSquad({
        challengeId: teamMatchRow.challenge_id,
        teamIds,
      });
      resolvedApprovedByTeamId = approvedSquad?.byTeamId || null;
    } catch (_approvedSquadError) {
      resolvedApprovedByTeamId = null;
    }
  }

  const approvedEligibility = resolveApprovedSquadEligibleUsers({
    approvedByTeamId: resolvedApprovedByTeamId,
    teamAId: teamMatchRow?.team_a_id,
    teamBId: teamMatchRow?.team_b_id,
  });
  if (approvedEligibility) {
    return {
      ...approvedEligibility,
      approvedByTeamId: resolvedApprovedByTeamId,
      membersByTeamId: membersByTeamId || null,
    };
  }

  const persistedEligibility = resolvePersistedTeamEligibleUsers({
    rosterRows,
    matchRow,
  });
  if (persistedEligibility) {
    return {
      ...persistedEligibility,
      approvedByTeamId: resolvedApprovedByTeamId,
      membersByTeamId: membersByTeamId || null,
    };
  }

  let resolvedMembersByTeamId = membersByTeamId || null;
  if (!resolvedMembersByTeamId && matchId && teamIds.length === 2) {
    try {
      resolvedMembersByTeamId = await listTeamMatchMembers({
        matchId,
        teamIds,
      });
    } catch (_membersError) {
      resolvedMembersByTeamId = null;
    }
  }

  const membersEligibility = resolveTeamMatchMemberEligibleUsers({
    membersByTeamId: resolvedMembersByTeamId,
    teamAId: teamMatchRow?.team_a_id,
    teamBId: teamMatchRow?.team_b_id,
  });
  if (membersEligibility) {
    return {
      ...membersEligibility,
      approvedByTeamId: resolvedApprovedByTeamId,
      membersByTeamId: resolvedMembersByTeamId,
    };
  }

  return {
    ...resolveStarterRosterEligibleUsers({ rosterRows }),
    approvedByTeamId: resolvedApprovedByTeamId,
    membersByTeamId: resolvedMembersByTeamId,
  };
};
