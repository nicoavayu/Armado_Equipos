import logger from '../utils/logger';
import { supabase } from '../supabase';
import {
  canTeamReportChallengeResult,
  isChallengeResultActionState,
  isChallengeResultFinal,
  isChallengeResultPromptEligible,
} from '../features/equipos/utils/challengeResult';
import { listMyManageableTeams, listMyTeamMatches } from './db/teamChallenges';
import { requestImmediatePushDispatchSafe } from './pushDispatchService';

export const CHALLENGE_RESULT_SURVEY_TYPE = 'challenge_result_survey';

const ENSURE_TTL_MS = 60 * 1000;
const lastEnsureByUserId = new Map();

const normalizeId = (value) => String(value ?? '').trim();
const normalizeToken = (value) => String(value ?? '').trim().toLowerCase();

const isAcceptedChallengeMatch = (match) => Boolean(
  match?.challenge_id
  && match?.team_a_id
  && match?.team_b_id
  && normalizeToken(match?.status) !== 'cancelled'
  && normalizeToken(match?.status) !== 'canceled'
);

const resolveRivalForUser = (match, manageableTeamIds = new Set()) => {
  const teamAId = normalizeId(match?.team_a_id);
  const teamBId = normalizeId(match?.team_b_id);
  const managedA = Boolean(teamAId && manageableTeamIds.has(teamAId));
  const managedB = Boolean(teamBId && manageableTeamIds.has(teamBId));

  // listMyTeamMatches only returns matches for the user's accessible teams and
  // canManage means owner/admin/captain-style permissions on at least one side.
  const perspectiveIsTeamA = managedA && !managedB
    ? true
    : managedB && !managedA
      ? false
      : true;

  if (perspectiveIsTeamA) {
    return {
      rivalTeamId: teamBId,
      rivalName: match?.team_b?.name || 'el rival',
      managedTeamId: teamAId,
      challengerTeamId: teamAId,
      acceptedTeamId: teamBId,
    };
  }

  return {
    rivalTeamId: teamAId,
    rivalName: match?.team_a?.name || 'el rival',
    managedTeamId: teamBId,
    challengerTeamId: teamAId,
    acceptedTeamId: teamBId,
  };
};

const buildNotificationPayload = ({ match, userId, manageableTeamIds }) => {
  const teamMatchId = normalizeId(match?.id);
  const challengeId = normalizeId(match?.challenge_id);
  const { rivalTeamId, rivalName, managedTeamId, challengerTeamId, acceptedTeamId } = resolveRivalForUser(match, manageableTeamIds);
  const route = `/desafios/equipos/partidos/${encodeURIComponent(teamMatchId)}?action=open_challenge_result_modal`;

  return {
    user_id: userId,
    type: CHALLENGE_RESULT_SURVEY_TYPE,
    title: 'Resultado pendiente',
    message: `¿Cómo salió el desafío vs ${rivalName}?`,
    partido_id: match?.partido_id || null,
    match_ref: match?.partido_id || null,
    status: 'sent',
    read: false,
    send_at: new Date().toISOString(),
    data: {
      source: 'team_challenge',
      action: 'open_challenge_result_modal',
      team_match_id: teamMatchId,
      teamMatchId: teamMatchId,
      challenge_id: challengeId,
      challengeId: challengeId,
      partido_id: match?.partido_id || null,
      partidoId: match?.partido_id || null,
      managed_team_id: managedTeamId || null,
      reporting_team_id: managedTeamId || null,
      challenger_team_id: challengerTeamId || null,
      accepted_team_id: acceptedTeamId || null,
      rival_team_id: rivalTeamId || null,
      rival_name: rivalName,
      team_a_name: match?.team_a?.name || null,
      team_b_name: match?.team_b?.name || null,
      target_path: route,
      route,
      link: route,
    },
  };
};

const resolveManagedTeamIdForMatch = (match, manageableTeamIds = new Set()) => {
  const teamAId = normalizeId(match?.team_a_id);
  const teamBId = normalizeId(match?.team_b_id);
  if (teamAId && manageableTeamIds.has(teamAId) && !(teamBId && manageableTeamIds.has(teamBId))) return teamAId;
  if (teamBId && manageableTeamIds.has(teamBId) && !(teamAId && manageableTeamIds.has(teamAId))) return teamBId;
  return teamAId && manageableTeamIds.has(teamAId) ? teamAId : null;
};

const isEligiblePendingResultMatch = (match, manageableTeamIds = new Set()) => {
  if (!isAcceptedChallengeMatch(match)) return false;
  if (!match?.canManage) return false;
  if (isChallengeResultFinal(match)) return false;

  const managedTeamId = resolveManagedTeamIdForMatch(match, manageableTeamIds);
  if (!managedTeamId || !canTeamReportChallengeResult(match, managedTeamId)) return false;

  const scheduledAt = match?.scheduled_at || match?.played_at;

  // Foreground fanout mirrors the backend cron: only auto-create a prompt once
  // the match is 60 minutes past kickoff and still inside the recent window, so
  // opening the app never re-creates fresh notifications for very old matches.
  if (!isChallengeResultPromptEligible({ scheduledAt })) return false;

  return isChallengeResultActionState({
    challengeStatus: match?.challenge?.status,
    matchStatus: match?.status,
    scheduledAt,
  });
};

const fetchExistingPendingKeys = async ({ userId, matchIds, challengeIds }) => {
  const existingKeys = new Set();
  const clauses = [
    ...matchIds.map((id) => `data->>team_match_id.eq.${id}`),
    ...challengeIds.map((id) => `data->>challenge_id.eq.${id}`),
  ];
  if (clauses.length === 0) return existingKeys;

  const { data, error } = await supabase
    .from('notifications')
    .select('id, data')
    .eq('user_id', userId)
    .eq('type', CHALLENGE_RESULT_SURVEY_TYPE)
    .or(clauses.join(','));

  if (error) throw error;

  (data || []).forEach((row) => {
    const dataPayload = row?.data || {};
    const teamMatchId = normalizeId(dataPayload?.team_match_id || dataPayload?.teamMatchId);
    const challengeId = normalizeId(dataPayload?.challenge_id || dataPayload?.challengeId);
    if (teamMatchId) existingKeys.add(`tm:${teamMatchId}`);
    if (challengeId) existingKeys.add(`ch:${challengeId}`);
  });

  return existingKeys;
};

export const ensureChallengeResultSurveyNotificationsForUser = async (userId, { force = false } = {}) => {
  const normalizedUserId = normalizeId(userId);
  if (!normalizedUserId) return { inserted: 0, skipped: true, reason: 'missing_user' };

  const now = Date.now();
  const lastEnsure = lastEnsureByUserId.get(normalizedUserId) || 0;
  if (!force && now - lastEnsure < ENSURE_TTL_MS) {
    return { inserted: 0, skipped: true, reason: 'throttled' };
  }
  lastEnsureByUserId.set(normalizedUserId, now);

  const [matches, manageableTeams] = await Promise.all([
    listMyTeamMatches(normalizedUserId, {
      statuses: ['accepted', 'confirmed', 'played', 'completed'],
    }),
    listMyManageableTeams(normalizedUserId),
  ]);
  const manageableTeamIds = new Set((manageableTeams || []).map((team) => normalizeId(team?.id)).filter(Boolean));
  const pendingMatches = (matches || []).filter((match) => (
    isEligiblePendingResultMatch(match, manageableTeamIds)
  ));
  if (pendingMatches.length === 0) return { inserted: 0, skipped: true, reason: 'none_pending' };

  const matchIds = pendingMatches.map((match) => normalizeId(match?.id)).filter(Boolean);
  const challengeIds = pendingMatches.map((match) => normalizeId(match?.challenge_id)).filter(Boolean);
  const existingKeys = await fetchExistingPendingKeys({
    userId: normalizedUserId,
    matchIds,
    challengeIds,
  });

  const rowsToInsert = pendingMatches
    .filter((match) => {
      const teamMatchId = normalizeId(match?.id);
      const challengeId = normalizeId(match?.challenge_id);
      return !existingKeys.has(`tm:${teamMatchId}`) && !existingKeys.has(`ch:${challengeId}`);
    })
    .map((match) => buildNotificationPayload({ match, userId: normalizedUserId, manageableTeamIds }));

  if (rowsToInsert.length === 0) return { inserted: 0, skipped: true, reason: 'already_exists' };

  const { data, error } = await supabase
    .from('notifications')
    .insert(rowsToInsert)
    .select('id, data');

  if (error) throw error;

  (data || []).forEach((row) => {
    const payload = row?.data || {};
    const teamMatchId = normalizeId(payload?.team_match_id || payload?.teamMatchId);
    if (!teamMatchId) return;
    requestImmediatePushDispatchSafe({
      eventType: CHALLENGE_RESULT_SURVEY_TYPE,
      requestId: teamMatchId,
      recipientUserId: normalizedUserId,
      limit: 10,
    });
  });

  return { inserted: data?.length || rowsToInsert.length };
};

export const filterResolvedChallengeResultSurveyNotifications = async (
  notifications = [],
  { supabaseClient = supabase } = {},
) => {
  const rows = Array.isArray(notifications) ? notifications : [];
  const candidateIds = [...new Set(
    rows
      .filter((notification) => notification?.type === CHALLENGE_RESULT_SURVEY_TYPE)
      .map((notification) => normalizeId(notification?.data?.team_match_id || notification?.data?.teamMatchId))
      .filter(Boolean),
  )];

  if (!supabaseClient || candidateIds.length === 0) return rows;

  try {
    let response = await supabaseClient
      .from('team_matches')
      .select('id, result_status, result_confirmed, result_conflict')
      .in('id', candidateIds);
    if (response.error) {
      response = await supabaseClient
        .from('team_matches')
        .select('id, result_status')
        .in('id', candidateIds);
    }
    if (response.error) throw response.error;

    const loadedIds = new Set(
      (response.data || [])
        .filter((row) => isChallengeResultFinal(row))
        .map((row) => normalizeId(row?.id))
        .filter(Boolean),
    );

    if (loadedIds.size === 0) return rows;

    return rows.filter((notification) => {
      if (notification?.type !== CHALLENGE_RESULT_SURVEY_TYPE) return true;
      const teamMatchId = normalizeId(notification?.data?.team_match_id || notification?.data?.teamMatchId);
      return !loadedIds.has(teamMatchId);
    });
  } catch (error) {
    logger.warn('[CHALLENGE_RESULT_NOTIFICATIONS] resolved filter failed:', error);
    return rows;
  }
};
