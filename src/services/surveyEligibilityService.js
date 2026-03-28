import { listChallengeApprovedSquad, listTeamMatchMembers } from './db/teamChallenges';
import { normalizeIdentityRef, resolvePersistRef } from './surveyTeamsService';

const normalizeUserId = (value) => String(value || '').trim();
const normalizeTeamId = (value) => String(value || '').trim();
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
  };
};

export const resolveChallengeSurveyEligibleUsers = async ({
  matchId = null,
  rosterRows = [],
  teamMatchRow = null,
  matchRow = null,
  approvedByTeamId = null,
  membersByTeamId = null,
} = {}) => {
  const rosterEligible = buildEligibleRosterMap(rosterRows || []);
  if (!isChallengeLikeSurveyMatch(teamMatchRow)) {
    return {
      source: 'roster',
      eligibleUserIds: rosterEligible.eligibleUserIds,
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
    source: 'roster',
    eligibleUserIds: rosterEligible.eligibleUserIds,
    approvedByTeamId: resolvedApprovedByTeamId,
    membersByTeamId: resolvedMembersByTeamId,
  };
};
