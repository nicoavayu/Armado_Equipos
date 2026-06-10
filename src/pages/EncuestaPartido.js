import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
import { handleError, AppError, ERROR_CODES } from '../lib/errorHandler';
import { useAuth } from '../components/AuthProvider';
import { useNotifications } from '../context/NotificationContext';
import PageLoadingState from '../components/PageLoadingState';
import PageTransition from '../components/PageTransition';
import ConfirmModal from '../components/ConfirmModal';
import TeamsDnDEditor from '../components/TeamsDnDEditor';
import SurveyImportantDisclaimer from '../components/survey/SurveyImportantDisclaimer';
import {
  finalizeIfComplete,
  hasExistingSurveyResponse,
  normalizeSurveyPlayerIds,
  resolveCanonicalSurveyPlayerId,
} from '../services/surveyCompletionService';
import { resolveChallengeSurveyEligibleUsers } from '../services/surveyEligibilityService';
import { useAnimatedNavigation } from '../hooks/useAnimatedNavigation';
import { useScrollResetOnChange } from '../hooks/useScrollReset';
import { useSmartBackNavigation } from '../hooks/useSmartBackNavigation';
import { clearMatchFromList } from '../services/matchFinishService';
import { listChallengeApprovedSquad, listTeamMatchMembers } from '../services/db/teamChallenges';
import { notifyBlockingError } from 'utils/notifyBlockingError';
import { SURVEY_START_DELAY_MS } from '../config/surveyConfig';
import { SURVEY_WINDOW_HOURS } from '../utils/surveyNotificationCopy';
import {
  resolveEffectiveSurveyWindow,
  resolveKickoffAtFromMatch,
  resolveSurveyStartDelayMs,
} from '../utils/surveyWindow';
import {
  resolvePostSubmitCompletionUiState,
  shouldRecheckPostSubmitSubmissionGate,
} from '../utils/surveyPostSubmitUiState';
import { createSurveySubmitTrace } from '../utils/surveySubmitPerformance';
import {
  buildPlayerRefToKeyMap,
  buildSeededInitialTeams,
  lockSurveyTeamsOnce,
  resolvePersistRef,
  resolvePlayerKey,
  toPlayerKeysFromRefs,
} from '../services/surveyTeamsService';
import {
  buildSurveyFlowSteps,
  resolveNextResultGateStep,
  SURVEY_STEPS,
} from '../utils/surveyFlow';
import {
  SURVEY_CHALLENGE_DISABLED_MESSAGE,
  isChallengeLikeTeamMatchRow,
} from '../utils/surveyChallengePolicy';

// Styles are now directly in Tailwind
// import './LegacyVoting.css'; // Removed

const Utils_formatTime = (iso) => {
  if (!iso) return '??';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const DEFAULT_FORM_DATA = {
  se_jugo: true,
  partido_limpio: true,
  asistieron_todos: true,
  jugadores_ausentes: [],
  jugadores_violentos: [],
  mvp_id: '',
  arquero_id: '',
  sin_arquero_fijo: false,
  motivo_no_jugado: '',
  ganador: '',
  resultado: '',
};

const NOT_PLAYED_REASON_OPTIONS = [
  {
    value: 'absence_without_notice',
    label: 'Ausencia sin aviso',
    description: 'Seleccioná quiénes faltaron y cerrá la encuesta.',
  },
  {
    value: 'weather_or_pitch',
    label: 'Clima / cancha',
    description: 'Se suspende sin pasos extra ni penalizaciones.',
  },
  {
    value: 'organization_issues',
    label: 'Problemas de organización',
    description: 'Cierra la encuesta sin continuar el flujo del partido jugado.',
  },
];

const getViewportMetrics = () => {
  if (typeof window === 'undefined') {
    return { width: 390, height: 844 };
  }

  const visualViewport = window.visualViewport;
  return {
    width: Math.max(Math.round(visualViewport?.width || window.innerWidth || 390), 1),
    height: Math.max(Math.round(visualViewport?.height || window.innerHeight || 844), 1),
  };
};

const normalizeIdentityToken = (value) => String(value || '').trim().toLowerCase();

const normalizeRosterRef = (value) => String(value || '').trim().toLowerCase();

const normalizeSurveyStatusToken = (value) => {
  const token = normalizeIdentityToken(value);
  if (!token) return null;
  if (token === 'closed' || token === 'cerrada') return 'closed';
  if (token === 'open' || token === 'abierta') return 'open';
  return null;
};

const normalizeResultStatusToken = (value) => {
  const token = normalizeIdentityToken(value);
  if (!token) return null;
  if (token === 'finished' || token === 'played') return 'finished';
  if (token === 'draw' || token === 'empate') return 'draw';
  if (token === 'not_played' || token === 'cancelled' || token === 'cancelado' || token === 'no_jugado') return 'not_played';
  if (token === 'pending' || token === 'pendiente') return 'pending';
  return null;
};

const resolveSurveyClosedState = ({
  surveyStatus,
  resultStatus,
  surveyOpenedAt = null,
  surveyClosesAt,
  finishedAt,
  matchStartAt = null,
  now = Date.now(),
}) => {
  const normalizedSurveyStatus = normalizeSurveyStatusToken(surveyStatus);
  const normalizedResultStatus = normalizeResultStatusToken(resultStatus);
  const opensAtMs = surveyOpenedAt ? new Date(surveyOpenedAt).getTime() : NaN;
  const closesAtMs = surveyClosesAt ? new Date(surveyClosesAt).getTime() : NaN;
  const finishedAtMs = finishedAt ? new Date(finishedAt).getTime() : NaN;
  const matchStartMs = matchStartAt ? new Date(matchStartAt).getTime() : NaN;
  const earliestValidCloseAtMs = Number.isFinite(opensAtMs)
    ? opensAtMs
    : (Number.isFinite(matchStartMs) ? matchStartMs + SURVEY_START_DELAY_MS : NaN);
  const hasStaleDeadline = Number.isFinite(closesAtMs)
    && Number.isFinite(earliestValidCloseAtMs)
    && closesAtMs <= earliestValidCloseAtMs;
  const deadlineReached = Number.isFinite(closesAtMs) && !hasStaleDeadline && now >= closesAtMs;
  const hasClosedResult = normalizedResultStatus === 'finished'
    || normalizedResultStatus === 'draw'
    || normalizedResultStatus === 'not_played';

  if (normalizedSurveyStatus === 'closed' || hasClosedResult || deadlineReached) {
    return {
      closed: true,
      normalizedSurveyStatus,
      normalizedResultStatus,
      closedByDeadline: deadlineReached,
      closesAt: Number.isFinite(closesAtMs) ? new Date(closesAtMs).toISOString() : null,
      finishedAt: Number.isFinite(finishedAtMs) ? new Date(finishedAtMs).toISOString() : null,
    };
  }

  return {
    closed: false,
    normalizedSurveyStatus,
    normalizedResultStatus,
    closedByDeadline: false,
    closesAt: Number.isFinite(closesAtMs) ? new Date(closesAtMs).toISOString() : null,
    finishedAt: Number.isFinite(finishedAtMs) ? new Date(finishedAtMs).toISOString() : null,
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

const extractTeamRefsFromPersistedTeams = (payload) => {
  const normalized = parsePersistedTeamsPayload(payload);
  if (!Array.isArray(normalized) || normalized.length === 0) return new Set();

  const refs = new Set();
  normalized.forEach((team) => {
    const players = Array.isArray(team?.players) ? team.players : [];
    players.forEach((playerRef) => {
      const token = normalizeRosterRef(playerRef);
      if (token) refs.add(token);
    });
  });
  return refs;
};

const extractTeamNamesFromPersistedTeams = (payload) => {
  const normalized = parsePersistedTeamsPayload(payload);
  if (!Array.isArray(normalized) || normalized.length === 0) return [];

  return normalized
    .map((team) => String(
      team?.name
      || team?.nombre
      || team?.team_name
      || team?.title
      || team?.label
      || '',
    ).trim())
    .filter(Boolean);
};

const playerMatchesRefSet = (player, refSet) => {
  if (!player || !(refSet instanceof Set) || refSet.size === 0) return false;
  const candidates = [resolvePersistRef(player), player?.id, player?.uuid, player?.usuario_id, player?.nombre]
    .map((value) => normalizeRosterRef(value))
    .filter(Boolean);
  return candidates.some((candidate) => refSet.has(candidate));
};

const resolveTeamMatchFixedTeams = ({
  players = [],
  membersByTeamId = {},
  teamAId = null,
  teamBId = null,
}) => {
  const roster = Array.isArray(players) ? players : [];
  const teamAIdKey = String(teamAId || '').trim();
  const teamBIdKey = String(teamBId || '').trim();
  if (!teamAIdKey || !teamBIdKey) return { teamA: [], teamB: [] };

  const membersA = Array.isArray(membersByTeamId?.[teamAIdKey]) ? membersByTeamId[teamAIdKey] : [];
  const membersB = Array.isArray(membersByTeamId?.[teamBIdKey]) ? membersByTeamId[teamBIdKey] : [];
  if (membersA.length === 0 || membersB.length === 0) return { teamA: [], teamB: [] };

  const byUserId = new Map();
  const byName = new Map();
  const allRosterKeys = [];

  roster.forEach((player) => {
    const key = resolvePlayerKey(player);
    if (!key) return;
    allRosterKeys.push(key);

    const userToken = normalizeIdentityToken(player?.usuario_id);
    if (userToken && !byUserId.has(userToken)) {
      byUserId.set(userToken, key);
    }

    const nameToken = normalizeIdentityToken(player?.nombre);
    if (nameToken) {
      const existing = byName.get(nameToken) || [];
      existing.push(key);
      byName.set(nameToken, existing);
    }
  });

  const usedKeys = new Set();
  const pullKeyForMember = (member) => {
    const userToken = normalizeIdentityToken(member?.user_id || member?.jugador?.usuario_id);
    if (userToken) {
      const userKey = byUserId.get(userToken);
      if (userKey && !usedKeys.has(userKey)) {
        usedKeys.add(userKey);
        return userKey;
      }
    }

    const nameToken = normalizeIdentityToken(member?.jugador?.nombre);
    if (nameToken) {
      const bucket = byName.get(nameToken) || [];
      while (bucket.length > 0) {
        const candidateKey = bucket.shift();
        if (candidateKey && !usedKeys.has(candidateKey)) {
          usedKeys.add(candidateKey);
          byName.set(nameToken, bucket);
          return candidateKey;
        }
      }
    }

    return null;
  };

  const teamA = membersA.map((member) => pullKeyForMember(member)).filter(Boolean);
  const teamB = membersB.map((member) => pullKeyForMember(member)).filter(Boolean);

  const remainingKeys = allRosterKeys.filter((key) => !usedKeys.has(key));
  remainingKeys.forEach((key) => {
    if (teamA.length <= teamB.length) teamA.push(key);
    else teamB.push(key);
  });

  const dedupTeamA = Array.from(new Set(teamA));
  const dedupTeamB = Array.from(new Set(teamB.filter((key) => !dedupTeamA.includes(key))));
  if (dedupTeamA.length === 0 || dedupTeamB.length === 0) return { teamA: [], teamB: [] };

  return { teamA: dedupTeamA, teamB: dedupTeamB };
};

const fillMissingPlayerFields = (existing, candidate) => ({
  ...existing,
  uuid: existing?.uuid || candidate?.uuid || null,
  usuario_id: existing?.usuario_id || candidate?.usuario_id || null,
  nombre: existing?.nombre || candidate?.nombre || 'Jugador',
  avatar_url: existing?.avatar_url || candidate?.avatar_url || null,
  score: existing?.score ?? candidate?.score ?? null,
  is_goalkeeper: existing?.is_goalkeeper ?? candidate?.is_goalkeeper ?? false,
});

const dedupeChallengeSurveyRoster = (players = [], options = {}) => {
  const includeLooseName = options?.includeLooseName === true;
  const input = Array.isArray(players) ? players : [];
  const deduped = [];
  const tokenToIndex = new Map();

  const buildIdentityTokens = (player) => {
    const tokens = [];
    const userToken = normalizeIdentityToken(player?.usuario_id);
    if (userToken) tokens.push(`user:${userToken}`);

    const numericId = Number(player?.id || 0);
    if (Number.isFinite(numericId) && numericId > 0) tokens.push(`id:${numericId}`);

    const uuidToken = normalizeIdentityToken(player?.uuid);
    if (uuidToken && !uuidToken.startsWith('tm-') && !uuidToken.startsWith('member-')) {
      tokens.push(`uuid:${uuidToken}`);
    }

    const nameToken = normalizeIdentityToken(player?.nombre);
    if (nameToken) {
      const avatarToken = normalizeIdentityToken(player?.avatar_url || player?.foto_url || '');
      tokens.push(`name_avatar:${nameToken}|${avatarToken}`);
      if (includeLooseName) {
        tokens.push(`name:${nameToken}`);
      }
    }
    return Array.from(new Set(tokens.filter(Boolean)));
  };

  input.forEach((player) => {
    const keyToken = normalizeIdentityToken(resolvePlayerKey(player));
    const identityTokens = buildIdentityTokens(player);
    if (keyToken) identityTokens.push(`key:${keyToken}`);

    const existingIndex = identityTokens.reduce((found, token) => (
      found >= 0 ? found : (tokenToIndex.has(token) ? tokenToIndex.get(token) : -1)
    ), -1);

    if (existingIndex >= 0) {
      deduped[existingIndex] = fillMissingPlayerFields(deduped[existingIndex], player);
      const mergedTokens = buildIdentityTokens(deduped[existingIndex]);
      const mergedKeyToken = normalizeIdentityToken(resolvePlayerKey(deduped[existingIndex]));
      if (mergedKeyToken) mergedTokens.push(`key:${mergedKeyToken}`);
      mergedTokens.forEach((token) => tokenToIndex.set(token, existingIndex));
      return;
    }

    deduped.push(player);
    const nextIndex = deduped.length - 1;
    identityTokens.forEach((token) => tokenToIndex.set(token, nextIndex));
  });

  return deduped;
};

const resolveChallengePlayerIdentity = (player) => {
  const userToken = normalizeIdentityToken(player?.usuario_id);
  if (userToken) return `user:${userToken}`;

  const uuidToken = normalizeIdentityToken(player?.uuid);
  if (uuidToken && !uuidToken.startsWith('tm-') && !uuidToken.startsWith('member-')) {
    return `uuid:${uuidToken}`;
  }

  const nameToken = normalizeIdentityToken(player?.nombre);
  if (nameToken) return `name:${nameToken}`;

  const idNum = Number(player?.id || 0);
  if (Number.isFinite(idNum) && idNum > 0) return `id:${idNum}`;

  const keyToken = normalizeIdentityToken(resolvePlayerKey(player));
  return keyToken ? `key:${keyToken}` : null;
};

const sanitizeTeamKeysByIdentity = ({
  teamKeys = [],
  playersByKey = {},
  blockedIdentities = new Set(),
}) => {
  const keys = [];
  const identities = new Set(blockedIdentities || []);

  (Array.isArray(teamKeys) ? teamKeys : []).forEach((key) => {
    const player = playersByKey?.[key];
    const identity = resolveChallengePlayerIdentity(player) || `key:${String(key || '')}`;
    if (!identity || identities.has(identity)) return;
    identities.add(identity);
    keys.push(key);
  });

  return { keys, identities };
};

const mergeChallengeTeamMembersIntoRoster = ({ roster = [], membersByTeamId = {} }) => {
  const merged = Array.isArray(roster) ? [...roster] : [];
  const byPlayerId = new Map();
  const byUserId = new Map();

  merged.forEach((player, index) => {
    const idNum = Number(player?.id);
    if (Number.isFinite(idNum) && idNum > 0 && !byPlayerId.has(idNum)) {
      byPlayerId.set(idNum, index);
    }
    const userToken = normalizeIdentityToken(player?.usuario_id);
    if (userToken && !byUserId.has(userToken)) {
      byUserId.set(userToken, index);
    }
  });

  Object.values(membersByTeamId || {}).forEach((members) => {
    (members || []).forEach((member) => {
      const rawJugadorId = Number(member?.jugador_id || member?.jugador?.id || 0);
      const jugadorId = Number.isFinite(rawJugadorId) && rawJugadorId > 0 ? rawJugadorId : null;
      const userId = member?.user_id || member?.jugador?.usuario_id || null;
      const userToken = normalizeIdentityToken(userId);
      const fallbackRef = String(member?.id || jugadorId || member?.jugador?.nombre || 'member').trim();

      const candidate = {
        id: jugadorId,
        uuid: userToken || `tm-${fallbackRef}`,
        usuario_id: userId || null,
        nombre: String(member?.jugador?.nombre || 'Jugador').trim() || 'Jugador',
        avatar_url: member?.photo_url || member?.jugador?.avatar_url || null,
        score: member?.jugador?.score ?? null,
        is_goalkeeper: normalizeIdentityToken(member?.role) === 'gk',
      };

      if (jugadorId && byPlayerId.has(jugadorId)) {
        const index = byPlayerId.get(jugadorId);
        merged[index] = fillMissingPlayerFields(merged[index], candidate);
        if (userToken && !byUserId.has(userToken)) {
          byUserId.set(userToken, index);
        }
        return;
      }

      if (userToken && byUserId.has(userToken)) {
        const index = byUserId.get(userToken);
        merged[index] = fillMissingPlayerFields(merged[index], candidate);
        if (jugadorId && !byPlayerId.has(jugadorId)) {
          byPlayerId.set(jugadorId, index);
        }
        return;
      }

      merged.push(candidate);
      const newIndex = merged.length - 1;
      if (jugadorId && !byPlayerId.has(jugadorId)) {
        byPlayerId.set(jugadorId, newIndex);
      }
      if (userToken && !byUserId.has(userToken)) {
        byUserId.set(userToken, newIndex);
      }
    });
  });

  return merged;
};

const mergeApprovedChallengeSquadIntoRoster = ({ roster = [], approvedByTeamId = {} }) => {
  const merged = Array.isArray(roster) ? [...roster] : [];
  const byPlayerId = new Map();
  const byUserId = new Map();
  const byUuid = new Map();
  const byName = new Map();

  const registerIndex = (player, index) => {
    const playerIdNum = Number(player?.id || 0);
    if (Number.isFinite(playerIdNum) && playerIdNum > 0 && !byPlayerId.has(playerIdNum)) {
      byPlayerId.set(playerIdNum, index);
    }
    const userToken = normalizeIdentityToken(player?.usuario_id);
    if (userToken && !byUserId.has(userToken)) byUserId.set(userToken, index);
    const uuidToken = normalizeIdentityToken(player?.uuid);
    if (uuidToken && !byUuid.has(uuidToken)) byUuid.set(uuidToken, index);
    const nameToken = normalizeIdentityToken(player?.nombre);
    if (nameToken && !byName.has(nameToken)) byName.set(nameToken, index);
  };

  merged.forEach((player, index) => registerIndex(player, index));

  Object.values(approvedByTeamId || {}).forEach((rows) => {
    (rows || []).forEach((row) => {
      const jugador = row?.jugador || {};
      const rawId = Number(row?.player_id || jugador?.id || 0);
      const playerId = Number.isFinite(rawId) && rawId > 0 ? rawId : null;
      const userToken = normalizeIdentityToken(jugador?.usuario_id);
      const uuidToken = normalizeIdentityToken(jugador?.uuid);
      const nameToken = normalizeIdentityToken(jugador?.nombre);

      let index = -1;
      if (playerId && byPlayerId.has(playerId)) index = byPlayerId.get(playerId);
      else if (userToken && byUserId.has(userToken)) index = byUserId.get(userToken);
      else if (uuidToken && byUuid.has(uuidToken)) index = byUuid.get(uuidToken);
      else if (nameToken && byName.has(nameToken)) index = byName.get(nameToken);

      const candidate = {
        id: playerId,
        uuid: jugador?.uuid || jugador?.usuario_id || `approved-${row?.id || playerId || nameToken || 'player'}`,
        usuario_id: jugador?.usuario_id || null,
        nombre: String(jugador?.nombre || 'Jugador').trim() || 'Jugador',
        avatar_url: jugador?.avatar_url || null,
        score: jugador?.score ?? null,
        is_goalkeeper: false,
      };

      if (index >= 0) {
        merged[index] = fillMissingPlayerFields(merged[index], candidate);
        registerIndex(merged[index], index);
        return;
      }

      merged.push(candidate);
      registerIndex(candidate, merged.length - 1);
    });
  });

  return merged;
};

const resolveChallengeTeamsFromApprovedSquad = ({
  players = [],
  approvedByTeamId = {},
  teamAId = null,
  teamBId = null,
}) => {
  const teamAIdKey = String(teamAId || '').trim();
  const teamBIdKey = String(teamBId || '').trim();
  if (!teamAIdKey || !teamBIdKey) {
    return { teamA: [], teamB: [], selectedKeys: new Set() };
  }

  const approvedTeamA = Array.isArray(approvedByTeamId?.[teamAIdKey]) ? approvedByTeamId[teamAIdKey] : [];
  const approvedTeamB = Array.isArray(approvedByTeamId?.[teamBIdKey]) ? approvedByTeamId[teamBIdKey] : [];
  if (approvedTeamA.length === 0 || approvedTeamB.length === 0) {
    return { teamA: [], teamB: [], selectedKeys: new Set() };
  }

  const byUserId = new Map();
  const byPlayerId = new Map();
  const byUuid = new Map();
  const byName = new Map();
  const pushToken = (map, token, key) => {
    const normalizedToken = normalizeIdentityToken(token);
    if (!normalizedToken || !key) return;
    const bucket = map.get(normalizedToken) || [];
    bucket.push(key);
    map.set(normalizedToken, bucket);
  };

  (players || []).forEach((player) => {
    const key = resolvePlayerKey(player);
    if (!key) return;
    pushToken(byPlayerId, player?.id, key);
    pushToken(byUserId, normalizeIdentityToken(player?.usuario_id), key);
    pushToken(byUuid, normalizeIdentityToken(player?.uuid), key);
    pushToken(byName, normalizeIdentityToken(player?.nombre), key);
  });

  const usedKeys = new Set();
  const pullByToken = (map, token) => {
    const normalizedToken = normalizeIdentityToken(token);
    if (!normalizedToken) return null;
    const bucket = map.get(normalizedToken) || [];
    while (bucket.length > 0) {
      const candidate = bucket.shift();
      if (candidate && !usedKeys.has(candidate)) {
        map.set(normalizedToken, bucket);
        usedKeys.add(candidate);
        return candidate;
      }
    }
    map.set(normalizedToken, bucket);
    return null;
  };

  const resolveRowToKey = (row) => {
    const player = row?.jugador || {};
    return (
      pullByToken(byPlayerId, row?.player_id || player?.id)
      || pullByToken(byUserId, player?.usuario_id)
      || pullByToken(byUuid, player?.uuid)
      || pullByToken(byName, player?.nombre)
      || null
    );
  };

  const teamA = approvedTeamA
    .map((row) => resolveRowToKey(row))
    .filter(Boolean);
  const teamB = approvedTeamB
    .map((row) => resolveRowToKey(row))
    .filter(Boolean);

  if (teamA.length === 0 || teamB.length === 0) {
    return { teamA: [], teamB: [], selectedKeys: new Set() };
  }

  return {
    teamA: Array.from(new Set(teamA)),
    teamB: Array.from(new Set(teamB)),
    selectedKeys: usedKeys,
  };
};

const resolveSurveyMatchStartAt = ({ partidoRow, teamMatchRow }) => {
  return resolveKickoffAtFromMatch({
    fecha: partidoRow?.fecha || null,
    hora: partidoRow?.hora || null,
    scheduledAt: teamMatchRow?.scheduled_at || null,
  });
};

const resolveEffectiveSurveyWindowState = ({
  partidoRow,
  teamMatchRow,
  surveyOpenedAt = null,
  surveyClosesAt = null,
  fallbackNowIso = null,
}) => resolveEffectiveSurveyWindow({
  surveyOpenedAt,
  surveyClosesAt,
  fecha: partidoRow?.fecha || null,
  hora: partidoRow?.hora || null,
  scheduledAt: teamMatchRow?.scheduled_at || null,
  fallbackNowIso,
  surveyStartDelayMs: resolveSurveyStartDelayMs({ teamMatchRow }),
});

const attachSurveyAliasPlayerIds = (player, playerIds = []) => {
  if (!player || typeof player !== 'object') return player;
  const normalizedPlayerIds = normalizeSurveyPlayerIds([player?.id, playerIds]);
  if (normalizedPlayerIds.length === 0) return player;
  return {
    ...player,
    survey_alias_player_ids: normalizedPlayerIds,
  };
};

const resolveSurveyAliasPlayerIds = ({
  userId,
  primaryPlayerId = null,
  aliasPlayerIds = [],
  rosterPlayers = [],
}) => {
  const normalizedUserId = normalizeIdentityToken(userId);
  const rosterPlayerIds = (rosterPlayers || [])
    .filter((player) => (
      normalizedUserId
      && normalizeIdentityToken(player?.usuario_id) === normalizedUserId
    ))
    .map((player) => player?.id);

  return normalizeSurveyPlayerIds([
    primaryPlayerId,
    aliasPlayerIds,
    rosterPlayerIds,
  ]);
};

const ensureLinkedPlayerForSurvey = async ({ matchId, user }) => {
  const matchIdNum = Number(matchId);
  if (!Number.isFinite(matchIdNum) || matchIdNum <= 0 || !user?.id) {
    return null;
  }

  const playerFields = 'id, partido_id, usuario_id, uuid, nombre, avatar_url, score, is_goalkeeper';

  const fetchLinkedRows = async () => {
    const { data, error } = await supabase
      .from('jugadores')
      .select(playerFields)
      .eq('partido_id', matchIdNum)
      .eq('usuario_id', user.id)
      .order('id', { ascending: true });
    if (error) throw error;
    return data || [];
  };

  let linkedRows = await fetchLinkedRows();
  if (linkedRows.length > 1) {
    return attachSurveyAliasPlayerIds(linkedRows[0], linkedRows.map((row) => row?.id));
  }

  if (linkedRows.length === 1) {
    return attachSurveyAliasPlayerIds(linkedRows[0], linkedRows.map((row) => row?.id));
  }

  // Read-only fallback: resolve the deterministic manual row without mutating roster identity.
  try {
    const { data: rosterRows, error: rosterError } = await supabase
      .from('jugadores')
      .select(playerFields)
      .eq('partido_id', matchIdNum)
      .order('id', { ascending: true });
    if (rosterError) throw rosterError;

    const normalizedUserId = normalizeIdentityToken(user.id);
    const deterministicManualCandidates = (rosterRows || []).filter((row) => (
      !row?.usuario_id && normalizeIdentityToken(row?.uuid) === normalizedUserId
    ));

    if (deterministicManualCandidates.length === 1) {
      return attachSurveyAliasPlayerIds(deterministicManualCandidates[0], [
        deterministicManualCandidates[0]?.id,
      ]);
    }
  } catch (_manualLinkError) {
    // Non-blocking fallback.
  }

  // Never auto-create jugadores rows from survey entry.
  // If there is no deterministic link, this user is not an eligible voter for this match.
  return null;
};

const EncuestaPartido = () => {
  const { partidoId, matchId } = useParams();
  const id = partidoId ?? matchId;
  const { user } = useAuth();
  const { fetchNotifications } = useNotifications();
  const navigate = useNavigate();
  const { navigateWithAnimation: _navigateWithAnimation } = useAnimatedNavigation();
  const navigateBackFromSurvey = useSmartBackNavigation({ fallback: '/' });

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [partido, setPartido] = useState(null);
  const [teamsConfirmed, setTeamsConfirmed] = useState(false);
  const [confirmedTeams, setConfirmedTeams] = useState({ teamA: [], teamB: [] });
  const [finalTeams, setFinalTeams] = useState({ teamA: [], teamB: [] });
  const [teamsLocked, setTeamsLocked] = useState(false);
  const [teamsSource, setTeamsSource] = useState(null);
  const [teamsLockedByUserId, setTeamsLockedByUserId] = useState(null);
  const [teamsLockedAt, setTeamsLockedAt] = useState(null);
  const [teamsFinalizedBySurvey, setTeamsFinalizedBySurvey] = useState(false);
  const [isTeamChallengeSurvey, setIsTeamChallengeSurvey] = useState(false);
  const [challengeSurveyName, setChallengeSurveyName] = useState('');
  const [challengeSurveyTeamLabels, setChallengeSurveyTeamLabels] = useState({ teamA: 'Equipo A', teamB: 'Equipo B' });
  const [currentStep, setCurrentStep] = useState(SURVEY_STEPS.PLAYED);
  const [alreadySubmitted, setAlreadySubmitted] = useState(false);
  const [linkedPlayerId, setLinkedPlayerId] = useState(null);
  const [linkedPlayerIds, setLinkedPlayerIds] = useState([]);
  const [loggedRosterCount, setLoggedRosterCount] = useState(0);
  const [surveyClosed, setSurveyClosed] = useState(false);
  const [surveyClosedAt, setSurveyClosedAt] = useState(null);
  const [surveyUnavailableMessage, setSurveyUnavailableMessage] = useState('');

  const [formData, setFormData] = useState(DEFAULT_FORM_DATA);
  const [jugadores, setJugadores] = useState([]);
  const [yaCalificado, _setYaCalificado] = useState(false);
  const [encuestaFinalizada, setEncuestaFinalizada] = useState(false);
  const [surveyModal, setSurveyModal] = useState({
    isOpen: false,
    title: '',
    message: '',
  });
  const [exitSurveyModalOpen, setExitSurveyModalOpen] = useState(false);
  const [surveyExitRoute, setSurveyExitRoute] = useState(null);
  const [viewportMetrics, setViewportMetrics] = useState(getViewportMetrics);
  const viewportRatio = viewportMetrics.width / Math.max(viewportMetrics.height, 1);
  const viewportHeight = viewportMetrics.height;

  useScrollResetOnChange(currentStep);

  const closeSurveyModal = () => {
    setSurveyModal({ isOpen: false, title: '', message: '' });
    const routeToExit = surveyExitRoute;
    setSurveyExitRoute(null);
    if (routeToExit) {
      navigate(routeToExit, { replace: true });
    }
  };
  const openSurveyModal = (message, title = 'Aviso', options = {}) => {
    if (options?.exitRoute) {
      setSurveyExitRoute(options.exitRoute);
    }
    setSurveyModal({
      isOpen: true,
      title,
      message: String(message || 'No se pudo completar la acción.'),
    });
  };

  const closeExitSurveyModal = () => {
    setExitSurveyModalOpen(false);
  };

  const confirmExitSurvey = () => {
    setExitSurveyModalOpen(false);
    navigateBackFromSurvey();
  };

  const getSurveyClosedMessage = (closedAtIso = null) => {
    if (!closedAtIso) {
      return 'Esta encuesta ya cerró y no se puede completar.';
    }
    try {
      const closedDate = new Date(closedAtIso);
      if (Number.isNaN(closedDate.getTime())) {
        return 'Esta encuesta ya cerró y no se puede completar.';
      }
      const fecha = closedDate.toLocaleDateString('es-ES');
      const hora = Utils_formatTime(closedAtIso);
      return `Esta encuesta ya cerró y no se puede completar. Cerró el ${fecha} a las ${hora}.`;
    } catch (_error) {
      return 'Esta encuesta ya cerró y no se puede completar.';
    }
  };

  const enforceSurveyClosedUiState = (closedAtIso = null, options = {}) => {
    setSurveyClosed(true);
    setSurveyClosedAt(closedAtIso || null);
    setEncuestaFinalizada(true);
    if (options?.showModal !== false) {
      openSurveyModal(
        getSurveyClosedMessage(closedAtIso),
        'Encuesta cerrada',
        { exitRoute: options?.exitRoute || '/' },
      );
    }
  };

  useEffect(() => {
    const updateViewportMetrics = () => {
      setViewportMetrics(getViewportMetrics());
    };

    updateViewportMetrics();
    window.addEventListener('resize', updateViewportMetrics);
    window.visualViewport?.addEventListener('resize', updateViewportMetrics);

    return () => {
      window.removeEventListener('resize', updateViewportMetrics);
      window.visualViewport?.removeEventListener('resize', updateViewportMetrics);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const resetSurveyState = () => {
      setSurveyModal({ isOpen: false, title: '', message: '' });
      setExitSurveyModalOpen(false);
      setPartido(null);
      setJugadores([]);
      setAlreadySubmitted(false);
      setEncuestaFinalizada(false);
      setTeamsConfirmed(false);
      setConfirmedTeams({ teamA: [], teamB: [] });
      setFinalTeams({ teamA: [], teamB: [] });
      setTeamsLocked(false);
      setTeamsSource(null);
      setTeamsLockedByUserId(null);
      setTeamsLockedAt(null);
      setTeamsFinalizedBySurvey(false);
      setIsTeamChallengeSurvey(false);
      setChallengeSurveyName('');
      setChallengeSurveyTeamLabels({ teamA: 'Equipo A', teamB: 'Equipo B' });
      setCurrentStep(SURVEY_STEPS.PLAYED);
      setFormData({ ...DEFAULT_FORM_DATA });
      setLinkedPlayerId(null);
      setLinkedPlayerIds([]);
      setLoggedRosterCount(0);
      setSurveyClosed(false);
      setSurveyClosedAt(null);
      setSurveyUnavailableMessage('');
      setSurveyExitRoute(null);
    };

    const fetchPartidoData = async () => {
      try {
        if (!id || !user) {
          if (!cancelled) navigate('/');
          return;
        }

        const matchIdNum = Number(id);
        if (!Number.isFinite(matchIdNum) || matchIdNum <= 0) {
          throw new AppError('Partido inválido', ERROR_CODES.VALIDATION_ERROR);
        }

        setLoading(true);

        let preflightTeamMatchRow = null;
        try {
          const { data: teamMatchRow } = await supabase
            .from('team_matches')
            .select('id, origin_type, challenge_id')
            .eq('partido_id', matchIdNum)
            .maybeSingle();
          preflightTeamMatchRow = teamMatchRow || null;
        } catch (_teamMatchPreflightError) {
          preflightTeamMatchRow = null;
        }

        if (isChallengeLikeTeamMatchRow(preflightTeamMatchRow)) {
          setSurveyUnavailableMessage(SURVEY_CHALLENGE_DISABLED_MESSAGE);
          setPartido({ id: matchIdNum });
          setJugadores([]);
          setLoading(false);
          return;
        }

        // Ensure exactly one linked jugadores row for the authenticated user in this match.
        const currentUserPlayer = await ensureLinkedPlayerForSurvey({
          matchId: matchIdNum,
          user,
        });

        if (cancelled) return;

        const { data: partidoData, error: partidoError } = await supabase
          .from('partidos_view')
          .select('*')
          .eq('id', id)
          .single();

        if (partidoError) throw partidoError;
        if (!partidoData) {
          throw new AppError('Partido no encontrado', ERROR_CODES.NOT_FOUND);
        }

        // teams_* metadata may come from partidos_view or public.partidos depending on environment.
        let teamsConfirmedValue = Boolean(partidoData?.teams_confirmed);
        let teamsLockedValue = false;
        let teamsSourceValue = teamsConfirmedValue ? 'admin' : null;
        let teamsLockedByValue = null;
        let teamsLockedAtValue = null;
        let persistedSurveyTeamA = [];
        let persistedSurveyTeamB = [];
        let persistedTeamsPayload = null;
        let matchRowForEligibility = null;
        let isTeamChallengeValue = false;
        let challengeTeamMatchContext = null;
        let challengeMembersByTeamId = null;
        let challengeApprovedSquadByTeamId = null;
        let confirmationRow = null;
        let challengeSurveyNameValue = '';
        let challengeSurveyTeamLabelsValue = { teamA: 'Equipo A', teamB: 'Equipo B' };
        let surveyStatusValue = partidoData?.survey_status || null;
        let surveyOpenedAtValue = partidoData?.survey_opened_at || null;
        let surveyClosesAtValue = partidoData?.survey_closes_at || null;
        let resultStatusValue = partidoData?.result_status || null;
        let finishedAtValue = partidoData?.finished_at || null;
        try {
          const { data: pRow, error: pErr } = await supabase
            .from('partidos')
            .select(
              'teams_confirmed, teams_locked, teams_source, teams_locked_by_user_id, teams_locked_at, survey_team_a, survey_team_b, final_team_a, final_team_b, equipos_json, equipos, survey_status, survey_opened_at, survey_closes_at, result_status, finished_at',
            )
            .eq('id', matchIdNum)
            .maybeSingle();
          if (!pErr && pRow) {
            matchRowForEligibility = pRow;
            if (typeof pRow.teams_confirmed === 'boolean') {
              teamsConfirmedValue = pRow.teams_confirmed;
            }
            teamsLockedValue = Boolean(pRow.teams_locked);
            teamsSourceValue = pRow.teams_source || (teamsConfirmedValue ? 'admin' : null);
            teamsLockedByValue = pRow.teams_locked_by_user_id || null;
            teamsLockedAtValue = pRow.teams_locked_at || null;
            surveyStatusValue = pRow.survey_status || surveyStatusValue;
            surveyOpenedAtValue = pRow.survey_opened_at || surveyOpenedAtValue;
            surveyClosesAtValue = pRow.survey_closes_at || surveyClosesAtValue;
            resultStatusValue = pRow.result_status || resultStatusValue;
            finishedAtValue = pRow.finished_at || finishedAtValue;
            persistedSurveyTeamA = Array.isArray(pRow.survey_team_a)
              ? pRow.survey_team_a
              : (Array.isArray(pRow.final_team_a) ? pRow.final_team_a : []);
            persistedSurveyTeamB = Array.isArray(pRow.survey_team_b)
              ? pRow.survey_team_b
              : (Array.isArray(pRow.final_team_b) ? pRow.final_team_b : []);
            persistedTeamsPayload = pRow?.equipos_json ?? pRow?.equipos ?? null;
          }
        } catch (_e) {
          // Non-blocking fallback.
        }

        try {
          const { data: teamMatchRow, error: teamMatchError } = preflightTeamMatchRow?.id
            ? { data: preflightTeamMatchRow, error: null }
            : await supabase
              .from('team_matches')
              .select('id, team_a_id, team_b_id, challenge_id, origin_type, scheduled_at')
              .eq('partido_id', matchIdNum)
              .maybeSingle();

          if (!teamMatchError && teamMatchRow?.id) {
            const originType = normalizeIdentityToken(teamMatchRow?.origin_type);
            isTeamChallengeValue = originType === 'challenge' || Boolean(teamMatchRow?.challenge_id);
            challengeTeamMatchContext = teamMatchRow;
          }
        } catch (_teamMatchLookupError) {
          // Non-blocking fallback.
        }

        if (
          isTeamChallengeValue
          && challengeTeamMatchContext?.team_a_id
          && challengeTeamMatchContext?.team_b_id
        ) {
          const fallbackNames = extractTeamNamesFromPersistedTeams(persistedTeamsPayload);
          try {
            const teamIds = [
              String(challengeTeamMatchContext.team_a_id),
              String(challengeTeamMatchContext.team_b_id),
            ].filter(Boolean);
            const { data: teamsRows, error: teamsError } = await supabase
              .from('teams')
              .select('id, name')
              .in('id', teamIds);
            if (!teamsError && Array.isArray(teamsRows) && teamsRows.length > 0) {
              const byId = new Map(
                (teamsRows || []).map((team) => [String(team?.id || '').trim(), team]),
              );
              const teamA = byId.get(String(challengeTeamMatchContext.team_a_id).trim());
              const teamB = byId.get(String(challengeTeamMatchContext.team_b_id).trim());
              const teamAName = String(teamA?.name || fallbackNames?.[0] || 'Equipo A').trim() || 'Equipo A';
              const teamBName = String(teamB?.name || fallbackNames?.[1] || 'Equipo B').trim() || 'Equipo B';
              challengeSurveyNameValue = `${teamAName} vs ${teamBName}`;
              challengeSurveyTeamLabelsValue = { teamA: teamAName, teamB: teamBName };
            } else if (fallbackNames.length >= 2) {
              const teamAName = fallbackNames[0];
              const teamBName = fallbackNames[1];
              challengeSurveyNameValue = `${teamAName} vs ${teamBName}`;
              challengeSurveyTeamLabelsValue = { teamA: teamAName, teamB: teamBName };
            } else {
              challengeSurveyNameValue = 'Equipo A vs Equipo B';
              challengeSurveyTeamLabelsValue = { teamA: 'Equipo A', teamB: 'Equipo B' };
            }
          } catch (_challengeNameError) {
            if (fallbackNames.length >= 2) {
              const teamAName = fallbackNames[0];
              const teamBName = fallbackNames[1];
              challengeSurveyNameValue = `${teamAName} vs ${teamBName}`;
              challengeSurveyTeamLabelsValue = { teamA: teamAName, teamB: teamBName };
            } else {
              challengeSurveyNameValue = 'Equipo A vs Equipo B';
              challengeSurveyTeamLabelsValue = { teamA: 'Equipo A', teamB: 'Equipo B' };
            }
          }
        }

        const matchStartAt = resolveSurveyMatchStartAt({
          partidoRow: partidoData,
          teamMatchRow: challengeTeamMatchContext,
        });
        const surveyWindow = resolveEffectiveSurveyWindowState({
          partidoRow: partidoData,
          teamMatchRow: challengeTeamMatchContext,
          surveyOpenedAt: surveyOpenedAtValue,
          surveyClosesAt: surveyClosesAtValue,
        });
        const surveyOpensAtMs = surveyWindow?.openedAtIso ? new Date(surveyWindow.openedAtIso).getTime() : NaN;
        if (Number.isFinite(surveyOpensAtMs) && Date.now() < surveyOpensAtMs) {
          const scheduledLabel = matchStartAt
            ? matchStartAt.toLocaleString('es-AR', {
              weekday: 'short',
              day: '2-digit',
              month: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
              timeZone: 'America/Argentina/Buenos_Aires',
            })
            : null;
          openSurveyModal(
            scheduledLabel
              ? `La encuesta se habilita al finalizar el partido. Está programado para ${scheduledLabel}.`
              : 'La encuesta se habilita al finalizar el partido.',
            'Encuesta no disponible',
            { exitRoute: '/' },
          );
          setPartido(partidoData || null);
          setJugadores([]);
          setLoading(false);
          return;
        }

        if (persistedTeamsPayload == null) {
          persistedTeamsPayload = partidoData?.equipos_json ?? partidoData?.equipos ?? null;
        }

        let jugadoresPartido = [];
        let rosterRowsForEligibility = [];
        try {
          const { data: rosterRows, error: rosterError } = await supabase
            .from('jugadores')
            .select('*')
            .eq('partido_id', matchIdNum)
            .order('id', { ascending: true });
          if (rosterError) throw rosterError;
          jugadoresPartido = Array.isArray(rosterRows) ? rosterRows : [];
          rosterRowsForEligibility = Array.isArray(rosterRows) ? rosterRows : [];
        } catch (_rosterFetchError) {
          jugadoresPartido = partidoData.jugadores && Array.isArray(partidoData.jugadores)
            ? partidoData.jugadores
            : [];
          rosterRowsForEligibility = Array.isArray(jugadoresPartido) ? jugadoresPartido : [];
        }

        try {
          const { data: teamConfirmationRow, error: teamConfirmationError } = await supabase
            .from('partido_team_confirmations')
            .select('participants, team_a, team_b, teams_json')
            .eq('partido_id', matchIdNum)
            .maybeSingle();
          if (!teamConfirmationError) {
            confirmationRow = teamConfirmationRow || null;
          }
        } catch (_confirmationFetchError) {
          confirmationRow = null;
        }

        jugadoresPartido = dedupeChallengeSurveyRoster(jugadoresPartido, {
          includeLooseName: isTeamChallengeValue,
        });

        const persistedTeamRefs = extractTeamRefsFromPersistedTeams(persistedTeamsPayload);
        if (persistedTeamRefs.size > 0) {
          const rosterFilteredByPersistedTeams = (jugadoresPartido || [])
            .filter((player) => playerMatchesRefSet(player, persistedTeamRefs));
          if (rosterFilteredByPersistedTeams.length > 0) {
            jugadoresPartido = rosterFilteredByPersistedTeams;
          }
        }

        if (
          isTeamChallengeValue
          && challengeTeamMatchContext?.id
          && challengeTeamMatchContext?.team_a_id
          && challengeTeamMatchContext?.team_b_id
        ) {
          try {
            challengeMembersByTeamId = await listTeamMatchMembers({
              matchId: challengeTeamMatchContext.id,
              teamIds: [challengeTeamMatchContext.team_a_id, challengeTeamMatchContext.team_b_id],
            });
            jugadoresPartido = mergeChallengeTeamMembersIntoRoster({
              roster: jugadoresPartido,
              membersByTeamId: challengeMembersByTeamId,
            });
            jugadoresPartido = dedupeChallengeSurveyRoster(jugadoresPartido, {
              includeLooseName: true,
            });
          } catch (_teamMembersError) {
            challengeMembersByTeamId = null;
          }
        }

        let approvedSquadFixedTeams = { teamA: [], teamB: [] };
        if (
          isTeamChallengeValue
          && challengeTeamMatchContext?.challenge_id
          && challengeTeamMatchContext?.team_a_id
          && challengeTeamMatchContext?.team_b_id
        ) {
          try {
            const approvedSquad = await listChallengeApprovedSquad({
              challengeId: challengeTeamMatchContext.challenge_id,
              teamIds: [challengeTeamMatchContext.team_a_id, challengeTeamMatchContext.team_b_id],
            });

            challengeApprovedSquadByTeamId = approvedSquad?.byTeamId || null;
            const approvedTeamA = Array.isArray(challengeApprovedSquadByTeamId?.[String(challengeTeamMatchContext.team_a_id)]) ? challengeApprovedSquadByTeamId[String(challengeTeamMatchContext.team_a_id)] : [];
            const approvedTeamB = Array.isArray(challengeApprovedSquadByTeamId?.[String(challengeTeamMatchContext.team_b_id)]) ? challengeApprovedSquadByTeamId[String(challengeTeamMatchContext.team_b_id)] : [];

            if (approvedTeamA.length > 0 && approvedTeamB.length > 0) {
              jugadoresPartido = mergeApprovedChallengeSquadIntoRoster({
                roster: [],
                approvedByTeamId: challengeApprovedSquadByTeamId || {},
              });
              jugadoresPartido = dedupeChallengeSurveyRoster(jugadoresPartido, {
                includeLooseName: true,
              });
            }

            const resolvedApprovedTeams = resolveChallengeTeamsFromApprovedSquad({
              players: jugadoresPartido,
              approvedByTeamId: challengeApprovedSquadByTeamId || {},
              teamAId: challengeTeamMatchContext.team_a_id,
              teamBId: challengeTeamMatchContext.team_b_id,
            });

            if (
              resolvedApprovedTeams.teamA.length > 0
              && resolvedApprovedTeams.teamB.length > 0
              && resolvedApprovedTeams.selectedKeys.size > 0
            ) {
              jugadoresPartido = jugadoresPartido.filter((player) => (
                resolvedApprovedTeams.selectedKeys.has(resolvePlayerKey(player))
              ));
              jugadoresPartido = dedupeChallengeSurveyRoster(jugadoresPartido, {
                includeLooseName: true,
              });

              approvedSquadFixedTeams = {
                teamA: resolvedApprovedTeams.teamA,
                teamB: resolvedApprovedTeams.teamB,
              };
            }
          } catch (_approvedSquadError) {
            challengeApprovedSquadByTeamId = null;
          }
        }

        jugadoresPartido = dedupeChallengeSurveyRoster(jugadoresPartido, {
          includeLooseName: isTeamChallengeValue,
        });

        const surveyEligibility = await resolveChallengeSurveyEligibleUsers({
          matchId: challengeTeamMatchContext?.id || null,
          rosterRows: rosterRowsForEligibility,
          teamMatchRow: challengeTeamMatchContext,
          matchRow: matchRowForEligibility,
          confirmationRow,
          approvedByTeamId: challengeApprovedSquadByTeamId,
          membersByTeamId: challengeMembersByTeamId,
        });
        const surveyEligibleUserIds = surveyEligibility?.eligibleUserIds || new Set();
        const loggedRosterPlayers = (jugadoresPartido || []).filter((player) => Boolean(player?.usuario_id));
        const normalizedCurrentUserId = normalizeIdentityToken(user.id);
        const loggedCount = surveyEligibleUserIds.size;
        const filteredCurrentUserPlayer = currentUserPlayer?.id
          ? (jugadoresPartido || []).find((row) => Number(row?.id) === Number(currentUserPlayer.id))
          : loggedRosterPlayers.find((row) => normalizeIdentityToken(row?.usuario_id) === normalizedCurrentUserId);
        const currentUserEligiblePlayer = surveyEligibleUserIds.has(String(user.id || '').trim())
          ? (filteredCurrentUserPlayer || currentUserPlayer || null)
          : null;
        const currentUserSurveyPlayerIds = resolveSurveyAliasPlayerIds({
          userId: user.id,
          primaryPlayerId: currentUserEligiblePlayer?.id || currentUserPlayer?.id || null,
          aliasPlayerIds: currentUserPlayer?.survey_alias_player_ids || [],
          rosterPlayers: loggedRosterPlayers,
        });

        if (cancelled) return;
        setIsTeamChallengeSurvey(isTeamChallengeValue);
        setChallengeSurveyName(challengeSurveyNameValue);
        setChallengeSurveyTeamLabels(challengeSurveyTeamLabelsValue);
        setLoggedRosterCount(loggedCount);

        if (loggedCount === 0) {
          openSurveyModal(
            'Este partido se jugó sin jugadores con cuenta registrada, por eso no se generaron datos para la encuesta.',
            'Encuesta no disponible',
            { exitRoute: '/' },
          );
          setPartido(partidoData || null);
          setJugadores([]);
          setLoading(false);
          return;
        }

        if (!currentUserEligiblePlayer?.id) {
          openSurveyModal(
            'Esta encuesta solo está disponible para jugadores con cuenta registrada que participaron de este partido.',
            'Encuesta no disponible',
            { exitRoute: '/' },
          );
          setPartido(partidoData || null);
          setJugadores([]);
          setLoading(false);
          return;
        }

        setLinkedPlayerId(currentUserEligiblePlayer.id);
        setLinkedPlayerIds(currentUserSurveyPlayerIds);

        const hasSubmitted = await hasExistingSurveyResponse({
          partidoId: matchIdNum,
          playerIds: currentUserSurveyPlayerIds,
        });
        if (cancelled) return;
        setAlreadySubmitted(hasSubmitted);

        const closedState = resolveSurveyClosedState({
          surveyStatus: surveyStatusValue,
          resultStatus: resultStatusValue,
          surveyOpenedAt: surveyWindow.openedAtIso,
          surveyClosesAt: surveyWindow.closesAtIso,
          finishedAt: finishedAtValue,
          matchStartAt,
          now: Date.now(),
        });

        if (!hasSubmitted && closedState.closed) {
          let closedAt = closedState.finishedAt || closedState.closesAt || null;
          try {
            const finalizeRes = await finalizeIfComplete(matchIdNum);
            closedAt = finalizeRes?.closedAt || finalizeRes?.deadlineAt || closedAt;
          } catch (_finalizeError) {
            // Non-blocking.
          }

          if (cancelled) return;
          setPartido(partidoData || null);
          setJugadores(jugadoresPartido);
          enforceSurveyClosedUiState(closedAt, { showModal: true, exitRoute: '/' });
          setLoading(false);
          return;
        }

        if (!isTeamChallengeValue) {
          const effectiveRosterRefs = surveyEligibility?.rosterRefs instanceof Set
            ? surveyEligibility.rosterRefs
            : new Set();
          if (effectiveRosterRefs.size > 0) {
            const filteredRoster = (jugadoresPartido || []).filter((player) => playerMatchesRefSet(player, effectiveRosterRefs));
            if (filteredRoster.length > 0) {
              jugadoresPartido = filteredRoster;
            }
          } else if (surveyEligibility?.excludeSubstitutesByDefault) {
            const starterRoster = (jugadoresPartido || []).filter((player) => player?.is_substitute !== true);
            if (starterRoster.length > 0) {
              jugadoresPartido = starterRoster;
            }
          }
        }

        const playerRefToKey = buildPlayerRefToKeyMap(jugadoresPartido);
        let challengeFixedTeams = { ...approvedSquadFixedTeams };
        if (
          isTeamChallengeValue
          && challengeTeamMatchContext?.id
          && challengeTeamMatchContext?.team_a_id
          && challengeTeamMatchContext?.team_b_id
          && !(approvedSquadFixedTeams.teamA.length > 0 && approvedSquadFixedTeams.teamB.length > 0)
        ) {
          try {
            const membersByTeamId = challengeMembersByTeamId || await listTeamMatchMembers({
              matchId: challengeTeamMatchContext.id,
              teamIds: [challengeTeamMatchContext.team_a_id, challengeTeamMatchContext.team_b_id],
            });

            challengeFixedTeams = resolveTeamMatchFixedTeams({
              players: jugadoresPartido,
              membersByTeamId,
              teamAId: challengeTeamMatchContext.team_a_id,
              teamBId: challengeTeamMatchContext.team_b_id,
            });
          } catch (_teamMembersError) {
            challengeFixedTeams = { teamA: [], teamB: [] };
          }
        }
        let resolvedTeamA = [];
        let resolvedTeamB = [];

        try {
          if (confirmationRow) {
            resolvedTeamA = toPlayerKeysFromRefs({
              refs: Array.isArray(confirmationRow.team_a) ? confirmationRow.team_a : [],
              refToKeyMap: playerRefToKey,
            });
            resolvedTeamB = toPlayerKeysFromRefs({
              refs: Array.isArray(confirmationRow.team_b) ? confirmationRow.team_b : [],
              refToKeyMap: playerRefToKey,
            });
          }
        } catch (_confirmationFetchError) {
          // Non-blocking fallback.
        }

        if (
          resolvedTeamA.length === 0
          && resolvedTeamB.length === 0
          && challengeFixedTeams.teamA.length > 0
          && challengeFixedTeams.teamB.length > 0
        ) {
          resolvedTeamA = challengeFixedTeams.teamA;
          resolvedTeamB = challengeFixedTeams.teamB;
        }

        if (isTeamChallengeValue && resolvedTeamA.length > 0 && resolvedTeamB.length > 0) {
          const rosterPlayersByKey = {};
          (jugadoresPartido || []).forEach((player) => {
            const key = resolvePlayerKey(player);
            if (key && !rosterPlayersByKey[key]) {
              rosterPlayersByKey[key] = player;
            }
          });

          const sanitizedA = sanitizeTeamKeysByIdentity({
            teamKeys: resolvedTeamA,
            playersByKey: rosterPlayersByKey,
          });
          const sanitizedB = sanitizeTeamKeysByIdentity({
            teamKeys: resolvedTeamB,
            playersByKey: rosterPlayersByKey,
            blockedIdentities: sanitizedA.identities,
          });

          if (sanitizedA.keys.length > 0 && sanitizedB.keys.length > 0) {
            resolvedTeamA = sanitizedA.keys;
            resolvedTeamB = sanitizedB.keys;
            const allowedKeys = new Set([...resolvedTeamA, ...resolvedTeamB]);
            jugadoresPartido = jugadoresPartido.filter((player) => (
              allowedKeys.has(resolvePlayerKey(player))
            ));
          }

          jugadoresPartido = dedupeChallengeSurveyRoster(jugadoresPartido, {
            includeLooseName: true,
          });
        }

        if (cancelled) return;

        setJugadores(jugadoresPartido);

        const resolvedConfirmedTeams = resolvedTeamA.length > 0 && resolvedTeamB.length > 0;
        if (resolvedConfirmedTeams) {
          teamsConfirmedValue = true;
        }

        const lockedTeamA = toPlayerKeysFromRefs({
          refs: persistedSurveyTeamA,
          refToKeyMap: playerRefToKey,
        });
        const lockedTeamB = toPlayerKeysFromRefs({
          refs: persistedSurveyTeamB,
          refToKeyMap: playerRefToKey,
        });
        const resolvedLockedTeams = lockedTeamA.length > 0 && lockedTeamB.length > 0;
        const hasPersistedSurveyLockedTeams = !isTeamChallengeValue && resolvedLockedTeams;
        const initialTeams = buildSeededInitialTeams({
          playerKeys: jugadoresPartido.map((player) => resolvePlayerKey(player)).filter(Boolean),
          seed: matchIdNum,
        });

        if (resolvedConfirmedTeams) {
          setTeamsConfirmed(true);
          setPartido({ ...partidoData, teams_confirmed: true });
          setConfirmedTeams({ teamA: resolvedTeamA, teamB: resolvedTeamB });
          if (hasPersistedSurveyLockedTeams) {
            setFinalTeams({ teamA: lockedTeamA, teamB: lockedTeamB });
            setTeamsSource(teamsSourceValue || 'survey');
            setTeamsLocked(true);
            setTeamsLockedByUserId(teamsLockedByValue || null);
            setTeamsLockedAt(teamsLockedAtValue || null);
            setTeamsFinalizedBySurvey(true);
          } else {
            setFinalTeams({ teamA: resolvedTeamA, teamB: resolvedTeamB });
            setTeamsSource(isTeamChallengeValue ? 'team_challenge' : 'admin');
            setTeamsLocked(true);
            setTeamsLockedByUserId(null);
            setTeamsLockedAt(null);
            setTeamsFinalizedBySurvey(false);
          }
        } else {
          setConfirmedTeams({ teamA: [], teamB: [] });

          // Safety fallback: if confirmed/locked teams can't be reconstructed, allow re-selection.
          const shouldAllowManualRecovery = (teamsConfirmedValue || teamsLockedValue) && !resolvedLockedTeams;
          if (teamsLockedValue && resolvedLockedTeams) {
            setTeamsConfirmed(false);
            setPartido({ ...partidoData, teams_confirmed: false });
            setFinalTeams({ teamA: lockedTeamA, teamB: lockedTeamB });
            setTeamsLocked(true);
            setTeamsSource(teamsSourceValue || 'survey');
            setTeamsLockedByUserId(teamsLockedByValue);
            setTeamsLockedAt(teamsLockedAtValue);
            setTeamsFinalizedBySurvey(!isTeamChallengeValue);
          } else if (shouldAllowManualRecovery) {
            setTeamsConfirmed(false);
            setPartido({ ...partidoData, teams_confirmed: false });
            setFinalTeams(initialTeams);
            setTeamsLocked(false);
            setTeamsSource('survey');
            setTeamsLockedByUserId(null);
            setTeamsLockedAt(null);
            setTeamsFinalizedBySurvey(false);
          } else {
            setTeamsConfirmed(false);
            setPartido({ ...partidoData, teams_confirmed: false });
            setFinalTeams(initialTeams);
            setTeamsLocked(false);
            setTeamsSource('survey');
            setTeamsLockedByUserId(null);
            setTeamsLockedAt(null);
            setTeamsFinalizedBySurvey(false);
          }
        }

      } catch (error) {
        if (!cancelled) {
          handleError(error, { showToast: true, onError: () => { } });
          navigate('/');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    resetSurveyState();
    if (id && user) {
      fetchPartidoData();
    } else {
      setLoading(false);
    }

    return () => {
      cancelled = true;
    };
  }, [id, user, navigate]);

  // Mark survey related notifications as read when entering survey page
  useEffect(() => {
    const markNotificationRead = async () => {
      if (!id || !user?.id) return;
      try {
        const partidoIdNum = Number(id);

        await Promise.all([
          supabase.from('notifications')
            .update({ read: true })
            .eq('user_id', user.id)
            .in('type', ['survey_start', 'post_match_survey'])
            .eq('partido_id', partidoIdNum),

          supabase.from('notifications')
            .update({ read: true })
            .eq('user_id', user.id)
            .in('type', ['survey_start', 'post_match_survey'])
            .contains('data', { match_id: String(id) }),
        ]);

        try {
          await fetchNotifications?.();
        } catch (_e) {
          // Intentionally ignored: notification refresh failure shouldn't block survey.
        }
      } catch (error) {
        console.error('[MARK_NOTIF_READ] Error:', error);
      }
    };

    markNotificationRead();
  }, [id, user?.id, fetchNotifications]);

  const handleInputChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const toggleJugadorAusente = (jugadorId) => {
    setFormData((prev) => {
      const ausentes = [...prev.jugadores_ausentes];
      const index = ausentes.indexOf(jugadorId);

      if (index === -1) {
        ausentes.push(jugadorId);
      } else {
        ausentes.splice(index, 1);
      }

      return { ...prev, jugadores_ausentes: ausentes };
    });
  };

  const toggleJugadorViolento = (jugadorId) => {
    setFormData((prev) => {
      const violentos = [...prev.jugadores_violentos];
      const index = violentos.indexOf(jugadorId);

      if (index === -1) {
        violentos.push(jugadorId);
      } else {
        violentos.splice(index, 1);
      }

      return { ...prev, jugadores_violentos: violentos };
    });
  };

  const handleNotPlayedReasonSelect = (reasonValue) => {
    setFormData((prev) => ({
      ...prev,
      motivo_no_jugado: reasonValue,
      asistieron_todos: reasonValue !== 'absence_without_notice',
      jugadores_ausentes: reasonValue === 'absence_without_notice' ? prev.jugadores_ausentes : [],
    }));
  };

  const playersByKey = useMemo(() => {
    const map = {};
    (jugadores || []).forEach((player) => {
      const key = resolvePlayerKey(player);
      if (!key) return;
      map[key] = player;
    });
    return map;
  }, [jugadores]);

  const allPlayerKeys = useMemo(() => (
    Object.keys(playersByKey)
  ), [playersByKey]);
  const playerRefToKeyMap = useMemo(() => buildPlayerRefToKeyMap(jugadores), [jugadores]);
  const challengeSurveyPlayerSections = useMemo(() => {
    if (!isTeamChallengeSurvey) return [];

    const fallbackTeamA = Array.isArray(confirmedTeams?.teamA) ? confirmedTeams.teamA : [];
    const fallbackTeamB = Array.isArray(confirmedTeams?.teamB) ? confirmedTeams.teamB : [];
    const teamAKeys = Array.isArray(finalTeams?.teamA) && finalTeams.teamA.length > 0
      ? finalTeams.teamA
      : fallbackTeamA;
    const teamBKeys = Array.isArray(finalTeams?.teamB) && finalTeams.teamB.length > 0
      ? finalTeams.teamB
      : fallbackTeamB;

    if (teamAKeys.length === 0 || teamBKeys.length === 0) return [];

    const buildPlayersForTeam = (teamKeys = []) => {
      const teamPlayers = [];
      const seenKeys = new Set();

      (teamKeys || []).forEach((key) => {
        if (!key || seenKeys.has(key)) return;
        seenKeys.add(key);
        const player = playersByKey?.[key];
        if (player) {
          teamPlayers.push(player);
        }
      });

      return teamPlayers;
    };

    const teamAPlayers = buildPlayersForTeam(teamAKeys);
    const teamBPlayers = buildPlayersForTeam(teamBKeys);
    if (teamAPlayers.length === 0 || teamBPlayers.length === 0) return [];

    const assignedKeys = new Set([...teamAKeys, ...teamBKeys].filter(Boolean));
    const allPlayersCovered = (jugadores || []).every((player) => {
      const key = resolvePlayerKey(player);
      return key ? assignedKeys.has(key) : false;
    });

    if (!allPlayersCovered) return [];

    return [
      {
        key: 'team-a',
        label: String(challengeSurveyTeamLabels?.teamA || 'Equipo A').trim() || 'Equipo A',
        players: teamAPlayers,
      },
      {
        key: 'team-b',
        label: String(challengeSurveyTeamLabels?.teamB || 'Equipo B').trim() || 'Equipo B',
        players: teamBPlayers,
      },
    ];
  }, [
    challengeSurveyTeamLabels,
    confirmedTeams,
    finalTeams,
    isTeamChallengeSurvey,
    jugadores,
    playersByKey,
  ]);
  const compactFlowMode = loggedRosterCount > 0 && loggedRosterCount < 3;
  const shouldDisableTeamReorganization = isTeamChallengeSurvey || teamsFinalizedBySurvey;
  const shouldForceOrganizeTeamsStep = !shouldDisableTeamReorganization;
  const shouldShowWinnerSelectionInOrganizeStep = !shouldDisableTeamReorganization;

  const hasConfirmedTeams = teamsConfirmed && confirmedTeams.teamA.length > 0 && confirmedTeams.teamB.length > 0;
  const teamsContextLabel = useMemo(() => {
    if (isTeamChallengeSurvey) {
      return 'Equipos fijos del desafío';
    }
    if (teamsFinalizedBySurvey) {
      return 'Estos son los equipos finales del partido. Solo falta confirmar el resultado.';
    }
    if (hasConfirmedTeams || teamsSource === 'admin') {
      return 'Equipos confirmados (podés corregirlos si hubo cambios de último momento)';
    }
    if (teamsLockedByUserId || teamsLockedAt || teamsLocked || teamsSource === 'survey') {
      return 'Equipos finales cargados por jugadores (editable)';
    }
    return 'Equipos a definir en encuesta';
  }, [hasConfirmedTeams, isTeamChallengeSurvey, teamsFinalizedBySurvey, teamsLocked, teamsLockedAt, teamsLockedByUserId, teamsSource]);

  const organizeTeamsHelperText = useMemo(() => {
    if (isTeamChallengeSurvey) {
      return 'Los equipos del desafío son fijos. Elegí quién ganó o marcá empate para continuar.';
    }
    if (teamsFinalizedBySurvey) {
      return 'Los equipos ya fueron definidos por el primer jugador que respondió la encuesta.';
    }
    if (hasConfirmedTeams || teamsSource === 'admin') {
      return 'Armá los equipos finales como finalmente se jugó el partido.';
    }
    return 'Armá o ajustá los equipos finales según cómo se jugó realmente el partido.';
  }, [hasConfirmedTeams, isTeamChallengeSurvey, teamsFinalizedBySurvey, teamsSource]);
  const friendlyOrganizeAndResultHelperText = 'Ajustá los equipos si hubo cambios de último momento: arrastrá jugadores entre equipos para reflejar cómo se jugó realmente.';

  const finalTeamsValidation = useMemo(() => {
    const teamA = Array.isArray(finalTeams?.teamA) ? finalTeams.teamA : [];
    const teamB = Array.isArray(finalTeams?.teamB) ? finalTeams.teamB : [];
    const expectedKeys = new Set(allPlayerKeys);

    if (teamA.length === 0 || teamB.length === 0) {
      return { ok: false, message: 'Los equipos finales quedaron inconsistentes. Revisá que todos los jugadores estén en un equipo.' };
    }

    const uniqueFinal = new Set([...teamA, ...teamB]);
    if (uniqueFinal.size !== teamA.length + teamB.length) {
      return { ok: false, message: 'Los equipos finales quedaron inconsistentes. Revisá que todos los jugadores estén en un equipo.' };
    }

    if (expectedKeys.size > 0 && uniqueFinal.size !== expectedKeys.size) {
      return { ok: false, message: 'Los equipos finales quedaron inconsistentes. Revisá que todos los jugadores estén en un equipo.' };
    }

    for (const key of uniqueFinal) {
      if (expectedKeys.size > 0 && !expectedKeys.has(key)) {
        return { ok: false, message: 'Los equipos finales quedaron inconsistentes. Revisá que todos los jugadores estén en un equipo.' };
      }
    }

    return { ok: true, message: '' };
  }, [allPlayerKeys, finalTeams]);

  const hydrateTeamsFromRefs = ({ teamARefs = [], teamBRefs = [] }) => {
    const teamA = toPlayerKeysFromRefs({ refs: teamARefs, refToKeyMap: playerRefToKeyMap });
    const teamB = toPlayerKeysFromRefs({ refs: teamBRefs, refToKeyMap: playerRefToKeyMap });
    if (teamA.length > 0 && teamB.length > 0) {
      setFinalTeams({ teamA, teamB });
      return true;
    }
    return false;
  };

  const persistTeamsDirectFallback = async ({ matchIdNum, teamARefs, teamBRefs }) => {
    const lockTimestamp = new Date().toISOString();
    const updatePayload = {
      survey_team_a: teamARefs,
      survey_team_b: teamBRefs,
      final_team_a: teamARefs,
      final_team_b: teamBRefs,
      teams_locked: true,
      teams_source: 'survey',
      teams_locked_by_user_id: user?.id || null,
      teams_locked_at: lockTimestamp,
    };

    try {
      const { data: updatedRow, error: updateError } = await supabase
        .from('partidos')
        .update(updatePayload)
        .eq('id', matchIdNum)
        .or('teams_locked.is.null,teams_locked.eq.false')
        .select('teams_locked, teams_source, teams_locked_by_user_id, teams_locked_at, survey_team_a, survey_team_b, final_team_a, final_team_b')
        .maybeSingle();

      if (!updateError && updatedRow) {
        const savedA = Array.isArray(updatedRow.survey_team_a) && updatedRow.survey_team_a.length > 0
          ? updatedRow.survey_team_a
          : (Array.isArray(updatedRow.final_team_a) ? updatedRow.final_team_a : []);
        const savedB = Array.isArray(updatedRow.survey_team_b) && updatedRow.survey_team_b.length > 0
          ? updatedRow.survey_team_b
          : (Array.isArray(updatedRow.final_team_b) ? updatedRow.final_team_b : []);

        return {
          ok: savedA.length > 0 && savedB.length > 0,
          alreadyLocked: false,
          lockedByOther: false,
          teamsLocked: Boolean(updatedRow.teams_locked),
          teamsSource: String(updatedRow.teams_source || 'survey'),
          teamsLockedByUserId: updatedRow.teams_locked_by_user_id || null,
          teamsLockedAt: updatedRow.teams_locked_at || lockTimestamp,
          teamARefs: savedA,
          teamBRefs: savedB,
          reason: 'direct_update',
        };
      }

      if (updateError) {
        console.error('[SURVEY_TEAMS] Direct update fallback failed', {
          code: updateError?.code || null,
          message: updateError?.message || null,
          details: updateError?.details || null,
          hint: updateError?.hint || null,
        });
      }
    } catch (fallbackUpdateError) {
      console.error('[SURVEY_TEAMS] Direct update fallback exception', fallbackUpdateError);
    }

    try {
      const { data: currentRow, error: currentError } = await supabase
        .from('partidos')
        .select('teams_locked, teams_source, teams_locked_by_user_id, teams_locked_at, survey_team_a, survey_team_b, final_team_a, final_team_b')
        .eq('id', matchIdNum)
        .maybeSingle();

      if (!currentError && currentRow) {
        const persistedA = Array.isArray(currentRow.survey_team_a) && currentRow.survey_team_a.length > 0
          ? currentRow.survey_team_a
          : (Array.isArray(currentRow.final_team_a) ? currentRow.final_team_a : []);
        const persistedB = Array.isArray(currentRow.survey_team_b) && currentRow.survey_team_b.length > 0
          ? currentRow.survey_team_b
          : (Array.isArray(currentRow.final_team_b) ? currentRow.final_team_b : []);

        if (persistedA.length > 0 && persistedB.length > 0) {
          return {
            ok: true,
            alreadyLocked: true,
            lockedByOther: true,
            teamsLocked: Boolean(currentRow.teams_locked),
            teamsSource: String(currentRow.teams_source || 'survey'),
            teamsLockedByUserId: currentRow.teams_locked_by_user_id || null,
            teamsLockedAt: currentRow.teams_locked_at || null,
            teamARefs: persistedA,
            teamBRefs: persistedB,
            reason: 'already_persisted',
          };
        }
      }
    } catch (fallbackReadError) {
      console.error('[SURVEY_TEAMS] Fallback read check failed', fallbackReadError);
    }

    return { ok: false, reason: 'direct_fallback_failed' };
  };

  const persistSurveyTeamsDefinition = async ({ deferTeamsFinalizedUi = false } = {}) => {
    if (shouldDisableTeamReorganization && !isTeamChallengeSurvey) {
      return { ok: true, message: '' };
    }

    if (!finalTeamsValidation.ok) {
      return { ok: false, message: finalTeamsValidation.message };
    }

    const buildPersistRefs = (teamKeys = [], options = {}) => {
      const includeAliases = options?.includeAliases === true;
      const refs = [];
      const seen = new Set();
      const pushRef = (value) => {
        const ref = String(value || '').trim();
        if (!ref) return;
        const token = ref.toLowerCase();
        if (seen.has(token)) return;
        seen.add(token);
        refs.push(ref);
      };

      (teamKeys || []).forEach((key) => {
        const player = playersByKey[key];
        if (!player) return;

        const orderedRefs = [
          player?.usuario_id,
          player?.uuid,
          player?.id,
          player?.user_id,
          player?.auth_id,
          player?.player_id,
          player?.email,
          normalizeIdentityToken(player?.nombre),
          resolvePersistRef(player),
        ];

        if (includeAliases) {
          orderedRefs.forEach(pushRef);
        } else {
          pushRef(orderedRefs.find((ref) => String(ref || '').trim().length > 0) || null);
        }
      });

      return refs;
    };

    const teamARefs = buildPersistRefs(finalTeams.teamA);
    const teamBRefs = buildPersistRefs(finalTeams.teamB);
    const teamACompatRefs = buildPersistRefs(finalTeams.teamA, { includeAliases: true });
    const teamBCompatRefs = buildPersistRefs(finalTeams.teamB, { includeAliases: true });

    if (teamARefs.length === 0 || teamBRefs.length === 0) {
      console.warn('[SURVEY_TEAMS] Persist blocked: missing refs', {
        matchId: Number(id),
        teamARefsCount: teamARefs.length,
        teamBRefsCount: teamBRefs.length,
      });
      return {
        ok: false,
        message: 'No se pudieron guardar los equipos finales (faltan referencias de jugadores).',
      };
    }

    const matchIdNum = Number(id);
    if (!Number.isFinite(matchIdNum) || matchIdNum <= 0) {
      return {
        ok: false,
        message: 'No se pudieron guardar los equipos finales (partido inválido).',
      };
    }

    try {
      const { data: currentRow, error: currentError } = await supabase
        .from('partidos')
        .select('teams_locked, teams_source, teams_locked_by_user_id, teams_locked_at, survey_team_a, survey_team_b, final_team_a, final_team_b')
        .eq('id', matchIdNum)
        .maybeSingle();

      if (!currentError && currentRow) {
        const persistedA = Array.isArray(currentRow.survey_team_a) && currentRow.survey_team_a.length > 0
          ? currentRow.survey_team_a
          : (Array.isArray(currentRow.final_team_a) ? currentRow.final_team_a : []);
        const persistedB = Array.isArray(currentRow.survey_team_b) && currentRow.survey_team_b.length > 0
          ? currentRow.survey_team_b
          : (Array.isArray(currentRow.final_team_b) ? currentRow.final_team_b : []);

        if (persistedA.length > 0 && persistedB.length > 0) {
          setTeamsLocked(Boolean(currentRow.teams_locked));
          setTeamsSource(String(currentRow.teams_source || 'survey'));
          setTeamsLockedByUserId(currentRow.teams_locked_by_user_id || null);
          setTeamsLockedAt(currentRow.teams_locked_at || null);
          if (!deferTeamsFinalizedUi) {
            setTeamsFinalizedBySurvey(true);
          }
          hydrateTeamsFromRefs({ teamARefs: persistedA, teamBRefs: persistedB });

          return {
            ok: true,
            message: '',
            alreadyLocked: true,
            lockedByOther: Boolean(currentRow.teams_locked_by_user_id && currentRow.teams_locked_by_user_id !== user?.id),
          };
        }
      }
    } catch (_preflightReadError) {
      // Non-blocking: continue with lock RPC.
    }

    let lockResult;
    try {
      lockResult = await lockSurveyTeamsOnce({
        matchId: matchIdNum,
        teamARefs,
        teamBRefs,
      });
    } catch (rpcError) {
      console.error('[SURVEY_TEAMS] save_match_final_teams RPC error', {
        code: rpcError?.code || null,
        message: rpcError?.message || null,
        details: rpcError?.details || null,
        hint: rpcError?.hint || null,
      });
      lockResult = { ok: false, reason: rpcError?.message || 'rpc_error' };
    }

    const initialLockReason = String(lockResult?.reason || '').trim().toLowerCase();
    if (
      !lockResult.ok
      && initialLockReason === 'inconsistent_roster_count'
      && (teamACompatRefs.length !== teamARefs.length || teamBCompatRefs.length !== teamBRefs.length)
    ) {
      try {
        const retryLockResult = await lockSurveyTeamsOnce({
          matchId: matchIdNum,
          teamARefs: teamACompatRefs,
          teamBRefs: teamBCompatRefs,
        });
        if (retryLockResult.ok) {
          lockResult = retryLockResult;
        } else {
          console.warn('[SURVEY_TEAMS] save_match_final_teams compat retry non-ok response', retryLockResult);
        }
      } catch (retryRpcError) {
        console.error('[SURVEY_TEAMS] save_match_final_teams compat retry RPC error', {
          code: retryRpcError?.code || null,
          message: retryRpcError?.message || null,
          details: retryRpcError?.details || null,
          hint: retryRpcError?.hint || null,
        });
      }
    }

    if (!lockResult.ok) {
      console.warn('[SURVEY_TEAMS] save_match_final_teams non-ok response', lockResult);
      const fallbackResult = await persistTeamsDirectFallback({ matchIdNum, teamARefs, teamBRefs });
      if (!fallbackResult.ok) {
        const reason = String(lockResult?.reason || fallbackResult?.reason || 'desconocido');
        return {
          ok: false,
          message: `No se pudieron guardar los equipos finales. Motivo: ${reason}.`,
        };
      }
      lockResult = fallbackResult;
    }

    setTeamsLocked(lockResult.teamsLocked || lockResult.alreadyLocked || lockResult.success);
    setTeamsSource(lockResult.teamsSource || 'survey');
    setTeamsLockedByUserId(lockResult.teamsLockedByUserId || null);
    setTeamsLockedAt(lockResult.teamsLockedAt || null);
    if (!deferTeamsFinalizedUi) {
      setTeamsFinalizedBySurvey(true);
    }

    if (lockResult.teamARefs.length > 0 && lockResult.teamBRefs.length > 0) {
      hydrateTeamsFromRefs({
        teamARefs: lockResult.teamARefs,
        teamBRefs: lockResult.teamBRefs,
      });
    }

    return {
      ok: true,
      message: '',
      alreadyLocked: lockResult.alreadyLocked,
      lockedByOther: lockResult.lockedByOther,
    };
  };

  const ensureSurveyCanReceiveSubmission = async () => {
    const matchIdNum = Number(id);
    if (!Number.isFinite(matchIdNum) || matchIdNum <= 0) {
      return { canSubmit: false, closedAt: null };
    }

    let lifecycleRow = null;
    try {
      const { data, error } = await supabase
        .from('partidos')
        .select('survey_status, survey_opened_at, survey_closes_at, result_status, finished_at, fecha, hora')
        .eq('id', matchIdNum)
        .maybeSingle();
      if (!error) lifecycleRow = data || null;
    } catch (_error) {
      lifecycleRow = null;
    }

    let lifecycleTeamMatchRow = null;
    try {
      const { data, error } = await supabase
        .from('team_matches')
        .select('scheduled_at')
        .eq('partido_id', matchIdNum)
        .maybeSingle();
      if (!error) lifecycleTeamMatchRow = data || null;
    } catch (_teamMatchError) {
      lifecycleTeamMatchRow = null;
    }

    const lifecycleMatchStartAt = resolveSurveyMatchStartAt({
      partidoRow: lifecycleRow,
      teamMatchRow: lifecycleTeamMatchRow,
    });
    const lifecycleSurveyWindow = resolveEffectiveSurveyWindowState({
      partidoRow: lifecycleRow,
      teamMatchRow: lifecycleTeamMatchRow,
      surveyOpenedAt: lifecycleRow?.survey_opened_at || null,
      surveyClosesAt: lifecycleRow?.survey_closes_at || null,
    });

    const closure = resolveSurveyClosedState({
      surveyStatus: lifecycleRow?.survey_status,
      resultStatus: lifecycleRow?.result_status,
      surveyOpenedAt: lifecycleSurveyWindow.openedAtIso,
      surveyClosesAt: lifecycleSurveyWindow.closesAtIso,
      finishedAt: lifecycleRow?.finished_at,
      matchStartAt: lifecycleMatchStartAt,
      now: Date.now(),
    });

    if (closure.closed) {
      try {
        await finalizeIfComplete(matchIdNum);
      } catch (_finalizeError) {
        // Non-blocking.
      }
      return { canSubmit: false, closedAt: closure.finishedAt || closure.closesAt || null };
    }

    return { canSubmit: true, closedAt: null };
  };

  const resolveCurrentUserSurveyPlayerIds = (primaryPlayerId = null) => resolveSurveyAliasPlayerIds({
    userId: user?.id,
    primaryPlayerId: primaryPlayerId ?? linkedPlayerId,
    aliasPlayerIds: linkedPlayerIds,
    rosterPlayers: jugadores,
  });

  const resolveSurveyOutcome = () => {
    const winner = String(formData.ganador || '').trim();
    if (winner === 'equipo_a') {
      return { seJugo: true, ganador: 'A', resultado: 'finished' };
    }
    if (winner === 'equipo_b') {
      return { seJugo: true, ganador: 'B', resultado: 'finished' };
    }
    if (winner === 'empate') {
      return { seJugo: true, ganador: 'DRAW', resultado: 'draw' };
    }
    if (winner === 'no_jugado') {
      return { seJugo: false, ganador: 'NOT_PLAYED', resultado: 'not_played' };
    }
    if (formData.se_jugo === false) {
      return { seJugo: false, ganador: 'NOT_PLAYED', resultado: 'not_played' };
    }
    return { seJugo: true, ganador: null, resultado: 'pending' };
  };

  const createSubmitTrace = (entrypoint, context = {}) => createSurveySubmitTrace({
    scope: 'EncuestaPartido.submit',
    partidoId: id,
    context: {
      entrypoint,
      currentStep,
      isTeamChallengeSurvey,
      ...context,
    },
  });

  const continueSubmitFlow = async ({ skipPersistTeams = false, trace: incomingTrace = null } = {}) => {
    const trace = incomingTrace || createSubmitTrace('continueSubmitFlow', { skipPersistTeams });
    let submitStatus = 'unknown';
    try {
      trace.mark('flow_start', { skipPersistTeams });

      if (alreadySubmitted) {
        console.info('Ya completaste esta encuesta');
        submitStatus = 'already_submitted';
        return;
      }

      const matchIdNum = Number(id);
      const submissionGate = await trace.measure(
        'pre_validation.ensureSurveyCanReceiveSubmission',
        () => ensureSurveyCanReceiveSubmission(),
      );
      if (!submissionGate.canSubmit) {
        enforceSurveyClosedUiState(submissionGate.closedAt);
        submitStatus = 'survey_closed_before_insert';
        return;
      }

      const currentUserSurveyPlayerIds = resolveCurrentUserSurveyPlayerIds();
      const canonicalSurveyPlayerId = resolveCanonicalSurveyPlayerId({
        primaryPlayerId: linkedPlayerId,
        playerIds: currentUserSurveyPlayerIds,
      });
      if (!Number.isFinite(canonicalSurveyPlayerId) || canonicalSurveyPlayerId <= 0) {
        openSurveyModal('Solo jugadores con cuenta registrada pueden completar esta encuesta.', 'No podés completar la encuesta');
        submitStatus = 'invalid_survey_player';
        return;
      }
      const hasExistingResponse = await trace.measure(
        'pre_validation.hasExistingSurveyResponse',
        () => hasExistingSurveyResponse({
          partidoId: matchIdNum,
          playerIds: currentUserSurveyPlayerIds,
        }),
        { playerIdsCount: currentUserSurveyPlayerIds.length },
      );
      if (hasExistingResponse) {
        setAlreadySubmitted(true);
        setEncuestaFinalizada(true);
        submitStatus = 'existing_response';
        return;
      }

      const outcome = resolveSurveyOutcome();
      if (outcome.seJugo && !skipPersistTeams && (!shouldDisableTeamReorganization || isTeamChallengeSurvey)) {
        const persistResult = await trace.measure(
          'pre_validation.persistSurveyTeamsDefinition',
          () => persistSurveyTeamsDefinition(),
        );
        if (!persistResult.ok) {
          openSurveyModal(persistResult.message, 'No se pudieron guardar los equipos');
          submitStatus = 'persist_teams_failed';
          return;
        }
      }

      const mvpPlayer = outcome.seJugo && formData.mvp_id
        ? jugadores.find((j) => j.uuid === formData.mvp_id)
        : null;
      const arqueroPlayer = outcome.seJugo && formData.arquero_id
        ? jugadores.find((j) => j.uuid === formData.arquero_id)
        : null;

      const uuidToId = new Map(jugadores.map((j) => [j.uuid, Number(j?.id)]));
      const violentosIds = (outcome.seJugo ? formData.jugadores_violentos : [])
        .map((u) => uuidToId.get(u))
        .filter((value) => Number.isFinite(value) && value > 0);
      const ausentesIds = (formData.jugadores_ausentes || [])
        .map((u) => uuidToId.get(u))
        .filter((value) => Number.isFinite(value) && value > 0);

      const surveyData = {
        partido_id: matchIdNum,
        // Persist new responses against the stable primary row when present; otherwise use the lowest alias id.
        votante_id: canonicalSurveyPlayerId,
        se_jugo: outcome.seJugo,
        motivo_no_jugado: outcome.seJugo ? null : (formData.motivo_no_jugado || null),
        asistieron_todos: formData.asistieron_todos,
        jugadores_ausentes: ausentesIds,
        partido_limpio: outcome.seJugo ? formData.partido_limpio : true,
        jugadores_violentos: violentosIds,
        mejor_jugador_eq_a: mvpPlayer?.id || null,
        mejor_jugador_eq_b: arqueroPlayer?.id || null, // Usamos este campo para el arquero
        ganador: outcome.ganador,
        resultado: outcome.resultado || null,
        created_at: new Date().toISOString(),
      };

      const insertResult = await trace.measure(
        'db.insert_post_match_surveys',
        () => supabase
          .from('post_match_surveys')
          .insert([surveyData]),
        {
          seJugo: outcome.seJugo,
          absentCount: ausentesIds.length,
          violentCount: violentosIds.length,
        },
      );
      let insertError = insertResult.error || null;
      let usedLegacySurveyInsert = false;

      // Backward-compatible fallback if DB doesn't have the new columns yet.
      if (insertError && /ganador|resultado/i.test(insertError.message || '')) {
        const legacySurveyData = { ...surveyData };
        delete legacySurveyData.ganador;
        delete legacySurveyData.resultado;
        usedLegacySurveyInsert = true;
        const legacyRes = await trace.measure(
          'db.insert_post_match_surveys_legacy_retry',
          () => supabase.from('post_match_surveys').insert([legacySurveyData]),
        );
        insertError = legacyRes.error || null;
      }
      trace.mark('db.insert_post_match_surveys_result', {
        ok: !insertError,
        usedLegacySurveyInsert,
      });

      if (insertError) {
        console.error('[ENCUESTA] post_match_surveys insert error full:', insertError);
        throw insertError;
      }

      let finalizeResult = null;
      try {
        finalizeResult = await trace.measure(
          'finalizeIfComplete',
          () => finalizeIfComplete(matchIdNum, { trace }),
        );
        trace.mark('finalizeIfComplete_result', {
          done: finalizeResult?.done === true,
          alreadyClosed: finalizeResult?.alreadyClosed === true,
          closedByThisCall: finalizeResult?.closedByThisCall === true,
          surveyStatus: finalizeResult?.survey_status || null,
          expectedVoters: finalizeResult?.expectedVoters ?? null,
          submissionsCount: finalizeResult?.submissionsCount ?? null,
          remainingVotes: finalizeResult?.remainingVotes ?? null,
          deadlineReached: finalizeResult?.deadlineReached === true,
          allEligibleVoted: finalizeResult?.allEligibleVoted === true,
          triggeredByLastVoter: finalizeResult?.triggeredByLastVoter === true,
        });
      } catch (e) {
        console.warn('[finalizeIfComplete] non-blocking error:', e);
        trace.mark('finalizeIfComplete_non_blocking_error', {
          message: e?.message || String(e),
          code: e?.code || null,
        });
      }

      let postSubmitSubmissionGate = null;
      if (shouldRecheckPostSubmitSubmissionGate(finalizeResult)) {
        try {
          postSubmitSubmissionGate = await trace.measure(
            'post_validation.ensureSurveyCanReceiveSubmission',
            () => ensureSurveyCanReceiveSubmission(),
          );
        } catch (_submissionGateError) {
          postSubmitSubmissionGate = null;
        }
      } else {
        trace.mark('post_validation.ensureSurveyCanReceiveSubmission_skipped', {
          reason: 'finalize_result_definitive',
          surveyStatus: finalizeResult?.survey_status || null,
        });
      }

      const postSubmitUiState = resolvePostSubmitCompletionUiState({
        finalizeResult,
        submissionGate: postSubmitSubmissionGate,
      });

      setAlreadySubmitted(true);
      setSurveyClosed(postSubmitUiState.shouldMarkSurveyClosed);
      setSurveyClosedAt(postSubmitUiState.closedAt || null);
      setEncuestaFinalizada(postSubmitUiState.shouldMarkSurveyClosed);
      if (postSubmitUiState.shouldMarkSurveyClosed) {
        setCurrentStep(SURVEY_STEPS.DONE);
      }
      trace.mark('visual_state_updated', {
        shouldMarkSurveyClosed: postSubmitUiState.shouldMarkSurveyClosed,
        closedAt: postSubmitUiState.closedAt || null,
      });

      // Keep upcoming-list cleanup best-effort so the survey completion UI does not wait on it.
      void trace.measure(
        'clearMatchFromList',
        () => clearMatchFromList(user.id, matchIdNum),
        { blockingVisualCompletion: false },
      ).catch((clearError) => {
        trace.mark('clearMatchFromList_non_blocking_error', {
          message: clearError?.message || String(clearError),
          code: clearError?.code || null,
        });
      });
      trace.mark('clearMatchFromList_dispatched', { blockingVisualCompletion: false });
      submitStatus = 'success';

    } catch (error) {
      submitStatus = 'error';
      handleError(error, { showToast: true, onError: () => { } });
    } finally {
      setSubmitting(false);
      trace.end({ status: submitStatus });
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trace = createSubmitTrace('handleSubmit');
    trace.mark('click_received');

    if (!user || !id) {
      notifyBlockingError('Debes iniciar sesión para calificar un partido');
      trace.end({ status: 'blocked', reason: 'missing_user_or_match' });
      return;
    }

    if (surveyClosed) {
      enforceSurveyClosedUiState(surveyClosedAt, { showModal: true, exitRoute: '/' });
      trace.end({ status: 'blocked', reason: 'survey_already_closed' });
      return;
    }

    if (alreadySubmitted) {
      console.info('Ya completaste esta encuesta');
      trace.end({ status: 'blocked', reason: 'already_submitted' });
      return;
    }

    if (currentStep === SURVEY_STEPS.RESULT && !formData.ganador) {
      openSurveyModal('Elegí el resultado: Equipo A, Equipo B o Empate.', 'Falta seleccionar resultado');
      trace.end({ status: 'blocked', reason: 'missing_result' });
      return;
    }

    const needsValidTeamsForResult = currentStep === SURVEY_STEPS.RESULT
      && (formData.ganador === 'equipo_a' || formData.ganador === 'equipo_b');
    if (needsValidTeamsForResult && !finalTeamsValidation.ok) {
      openSurveyModal(finalTeamsValidation.message, 'Equipos incompletos');
      trace.end({ status: 'blocked', reason: 'invalid_final_teams' });
      return;
    }

    if (submitting || encuestaFinalizada) {
      trace.end({ status: 'blocked', reason: 'already_processing_or_finalized' });
      return;
    }

    setSubmitting(true);
    await continueSubmitFlow({ trace });
  };

  const handleLockTeamsAndContinue = async () => {
    if (submitting || encuestaFinalizada || alreadySubmitted) return;

    if (shouldShowWinnerSelectionInOrganizeStep && !['equipo_a', 'equipo_b', 'empate'].includes(formData.ganador)) {
      openSurveyModal('Elegí quién ganó o marcá empate para finalizar la encuesta.', 'Falta seleccionar resultado');
      return;
    }

    const shouldSubmitFromHere = shouldShowWinnerSelectionInOrganizeStep;
    const trace = shouldSubmitFromHere
      ? createSubmitTrace('handleLockTeamsAndContinue', { skipPersistTeams: true })
      : null;
    trace?.mark('click_received');

    setSubmitting(true);
    try {
      const persistResult = trace
        ? await trace.measure(
          'pre_submit.persistSurveyTeamsDefinition',
          () => persistSurveyTeamsDefinition({
            deferTeamsFinalizedUi: shouldSubmitFromHere,
          }),
        )
        : await persistSurveyTeamsDefinition({
          deferTeamsFinalizedUi: shouldSubmitFromHere,
        });
      if (!persistResult.ok) {
        openSurveyModal(persistResult.message, 'No se pudieron guardar los equipos');
        trace?.end({ status: 'blocked', reason: 'persist_teams_failed' });
        return;
      }

      if (shouldSubmitFromHere) {
        await continueSubmitFlow({ skipPersistTeams: true, trace });
        return;
      }

      setCurrentStep(SURVEY_STEPS.RESULT);
    } catch (error) {
      trace?.end({ status: 'error', reason: 'persist_teams_exception' });
      throw error;
    } finally {
      setSubmitting(false);
    }
  };

  const handleNotPlayedPrimaryAction = async () => {
    if (!selectedNotPlayedReason || submitting || encuestaFinalizada) return;

    if (selectedNotPlayedReason.value === 'absence_without_notice') {
      setCurrentStep(SURVEY_STEPS.NOT_PLAYED_ABSENTS);
      return;
    }

    const trace = createSubmitTrace('handleNotPlayedPrimaryAction', {
      selectedNotPlayedReason: selectedNotPlayedReason.value,
    });
    trace.mark('click_received');
    setSubmitting(true);
    await continueSubmitFlow({ trace });
  };

  const formatFecha = (fechaStr) => {
    try {
      const fecha = new Date(fechaStr);
      return fecha.toLocaleDateString('es-ES', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
    } catch (e) {
      return fechaStr || 'Fecha no disponible';
    }
  };

  // Helper classes for consistency
  const screenBackgroundStyle = {
    background:
      'radial-gradient(circle at 50% -12%, rgba(139,92,255,0.36) 0%, rgba(36,30,128,0) 48%), radial-gradient(circle at 88% 108%, rgba(236,0,125,0.1) 0%, rgba(11,14,54,0) 55%), linear-gradient(165deg, #241c52 0%, #1c1442 42%, #120e2e 100%)',
  };
  const isCompressedLayout = viewportHeight <= 860 || (viewportRatio >= 0.95 && viewportHeight <= 720);
  const isTightLayout = viewportHeight <= 760 || (viewportRatio >= 0.95 && viewportHeight <= 640);
  const safeAreaStyle = {
    paddingTop: 'max(env(safe-area-inset-top), 0px)',
    paddingBottom: 'max(env(safe-area-inset-bottom), 0px)',
    boxSizing: 'border-box',
  };
  const cardClass = `w-full max-w-[1180px] mx-auto h-full min-h-0 px-2.5 sm:px-4 ${isCompressedLayout ? 'pb-3 sm:pb-4' : 'pb-5 sm:pb-6'} flex flex-col overflow-hidden`;
  const stepClass = `w-full flex-1 min-h-0 flex flex-col items-center justify-center ${isTightLayout ? 'gap-1 sm:gap-1.5 pb-0 sm:pb-0.5' : isCompressedLayout ? 'gap-1.5 sm:gap-2 pb-1 sm:pb-1.5' : 'gap-2 sm:gap-3 pb-1.5 sm:pb-2'}`;
  const playerStepClass = `w-full flex-1 min-h-0 flex flex-col items-center justify-between gap-0 ${isCompressedLayout ? 'pb-0 sm:pb-1' : 'pb-1 sm:pb-1.5'}`;
  const questionRowClass = 'w-full shrink-0 flex items-center justify-center pt-0';
  const progressRowClass = `sticky top-0 z-40 w-full shrink-0 ${isCompressedLayout ? 'pt-1 sm:pt-1.5' : 'pt-1.5 sm:pt-2'}`;
  const progressGapClass = `w-full shrink-0 ${isTightLayout ? 'h-4 sm:h-5' : isCompressedLayout ? 'h-5 sm:h-6' : 'h-7 sm:h-8'}`;
  const progressActionsClass = `w-full shrink-0 flex items-start justify-end ${isTightLayout ? 'h-9 pt-1.5 sm:h-10' : isCompressedLayout ? 'h-10 pt-2 sm:h-11' : 'h-11 pt-2.5 sm:h-12'}`;
  const contentRowClass = 'w-full flex-1 min-h-0 flex items-center justify-center overflow-visible';
  const playerContentRowClass = `w-full flex-1 min-h-0 flex items-center justify-center overflow-visible ${isTightLayout ? 'pt-2 sm:pt-3 pb-1 sm:pb-1.5' : isCompressedLayout ? 'pt-3 sm:pt-4 pb-2 sm:pb-3' : 'pt-5 sm:pt-6 pb-3 sm:pb-4'}`;
  const actionRowClass = `w-full shrink-0 flex items-center justify-center ${isTightLayout ? 'pt-1.5 sm:pt-2' : isCompressedLayout ? 'pt-2 sm:pt-3' : 'pt-3 sm:pt-4'}`;
  const playerActionRowClass = `w-full shrink-0 flex items-center justify-center ${isTightLayout ? 'pt-1.5 sm:pt-2' : isCompressedLayout ? 'pt-2 sm:pt-2.5' : 'pt-2.5 sm:pt-3.5'}`;
  const logoRowClass = 'hidden';
  const titleClass = `font-bebas text-white font-bold text-center uppercase drop-shadow-[0_8px_18px_rgba(6,9,36,0.42)] break-words w-full px-1 ${isTightLayout ? 'text-[clamp(24px,5.6vw,52px)] tracking-[0.04em] leading-[0.88]' : isCompressedLayout ? 'text-[clamp(28px,6vw,62px)] tracking-[0.048em] leading-[0.9]' : 'text-[clamp(30px,6.2vw,74px)] tracking-[0.055em] leading-[0.92]'}`;
  const surveyBtnBaseClass = `w-full border border-[rgba(148,134,255,0.35)] bg-white/[0.08] text-white font-bebas text-center cursor-pointer transition-[opacity,background-color,border-color] duration-220 ease-out hover:bg-white/[0.14] flex items-center justify-center rounded-2xl tracking-[0.08em] shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_12px_30px_rgba(8,6,30,0.32)] disabled:opacity-55 disabled:cursor-not-allowed ${isTightLayout ? 'text-[18px] sm:text-[20px] py-2 min-h-[46px]' : isCompressedLayout ? 'text-[19px] sm:text-[22px] py-2 min-h-[48px]' : 'text-[20px] sm:text-[24px] py-2.5 min-h-[52px]'}`;
  const btnClass = `${surveyBtnBaseClass} font-bold uppercase`;
  const optionBtnClass = `${surveyBtnBaseClass} uppercase`;
  const optionBtnSelectedClass = 'bg-[rgba(106,67,255,0.42)] border-[#a78bfa] shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_16px_30px_rgba(54,32,140,0.45),0_0_18px_rgba(106,67,255,0.3)]';
  const compactPrimaryBtnClass = `${btnClass} !w-auto ${isTightLayout ? '!min-w-[128px] sm:!min-w-[150px] !px-4 sm:!px-5' : isCompressedLayout ? '!min-w-[136px] sm:!min-w-[160px] !px-4 sm:!px-5' : '!min-w-[146px] sm:!min-w-[176px] !px-5 sm:!px-6'}`;
  const compactSecondaryBtnClass = `${optionBtnClass} !w-full !min-h-[50px] !py-2 !px-4 bg-white/[0.07] border-white/24 shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_8px_16px_rgba(7,10,35,0.22)]`;
  const resultSecondaryBtnClass = `${optionBtnClass} !w-auto ${isTightLayout ? '!min-h-[44px] !py-1.5 !px-4 sm:!px-5' : isCompressedLayout ? '!min-h-[46px] !py-2 !px-4 sm:!px-5' : '!min-h-[48px] !py-2 !px-5 sm:!px-6'}`;
  const compactButtonRowClass = 'w-full max-w-[760px] mx-auto flex items-center justify-center';
  const compactDualButtonRowClass = `w-full max-w-[760px] mx-auto flex items-center justify-center ${isCompressedLayout ? 'gap-2 sm:gap-2.5' : 'gap-2.5 sm:gap-3'}`;
  const gridClass = `grid grid-cols-2 w-full max-w-[920px] mx-auto ${isCompressedLayout ? 'gap-2 sm:gap-2.5' : 'gap-3'}`;
  const textClass = `text-white font-oswald text-center font-normal tracking-wide ${isCompressedLayout ? 'text-[16px] md:text-[18px]' : 'text-[18px] md:text-[20px]'}`;
  const actionDockClass = 'w-full max-w-[980px] mx-auto flex flex-col gap-1';
  const centeredSummaryStackClass = `w-full flex-1 min-h-0 flex flex-col items-center justify-center ${isCompressedLayout ? 'gap-4 sm:gap-5' : 'gap-5 sm:gap-6'}`;
  const centeredSummaryButtonWrapClass = 'w-full max-w-[460px] sm:max-w-[500px] mx-auto';
  const miniCardsStageClass = `w-full h-full min-h-0 overflow-visible flex items-center justify-center ${isTightLayout ? 'px-1.5 sm:px-2 pb-1 sm:pb-1.5' : isCompressedLayout ? 'px-2 sm:px-2.5 pb-1.5 sm:pb-2' : 'px-2 sm:px-3 pb-2 sm:pb-3'}`;
  const notPlayedReasonListClass = `w-full max-w-[760px] mx-auto flex flex-col ${isCompressedLayout ? 'gap-2 sm:gap-2.5' : 'gap-3 sm:gap-3.5'}`;
  const selectedNotPlayedReason = NOT_PLAYED_REASON_OPTIONS.find((option) => option.value === formData.motivo_no_jugado) || null;
  const notPlayedPrimaryButtonLabel = selectedNotPlayedReason?.value === 'absence_without_notice' ? 'Continuar' : 'Finalizar';

  const SurveyFooterLogo = () => null;

  const flowSteps = useMemo(() => buildSurveyFlowSteps({
    currentStep,
    seJugo: formData.se_jugo,
    asistieronTodos: formData.asistieron_todos,
    partidoLimpio: formData.partido_limpio,
    teamsConfirmed,
    teamsLocked,
    compactFlowMode,
    forceOrganizeTeamsStep: shouldForceOrganizeTeamsStep,
    disableOrganizeTeamsStep: shouldDisableTeamReorganization,
  }), [
    currentStep,
    formData.se_jugo,
    formData.asistieron_todos,
    formData.partido_limpio,
    teamsConfirmed,
    teamsLocked,
    compactFlowMode,
    shouldForceOrganizeTeamsStep,
    shouldDisableTeamReorganization,
  ]);

  const progressTotalSteps = Math.max(flowSteps.length, 1);
  const currentFlowIndex = flowSteps.indexOf(currentStep);
  const progressCurrentStep = currentStep === SURVEY_STEPS.DONE
    ? progressTotalSteps
    : Math.max(currentFlowIndex + 1, 1);
  const progressFillScale = Math.min(Math.max(progressCurrentStep / progressTotalSteps, 0), 1);
  const progressFillPercent = Math.round(progressFillScale * 100);
  const [animatedProgressPercent, setAnimatedProgressPercent] = useState(progressFillPercent);

  useEffect(() => {
    const animationFrame = window.requestAnimationFrame(() => {
      setAnimatedProgressPercent(progressFillPercent);
    });

    return () => window.cancelAnimationFrame(animationFrame);
  }, [progressFillPercent]);

  const renderStepProgress = () => (
    <div className={progressRowClass}>
      <div className="w-full">
        <div className="h-[2px] w-full overflow-hidden rounded-full bg-white/18 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.16)]">
          <div
            className="h-full origin-left rounded-full transition-[width] duration-[280ms] ease-out"
            style={{
              width: `${animatedProgressPercent}%`,
              background:
                'linear-gradient(90deg, rgba(139,92,255,0.9) 0%, rgba(176,160,255,0.85) 55%, rgba(236,0,125,0.85) 100%)',
              boxShadow: '0 0 8px rgba(139,92,255,0.35)',
            }}
          />
        </div>
      </div>
    </div>
  );

  const renderExitSurveyButton = ({ immediate = false } = {}) => {
    if (!immediate && currentStep === SURVEY_STEPS.DONE) {
      return null;
    }

    return (
      <div className={progressActionsClass}>
        <button
          type="button"
          aria-label="Cerrar encuesta"
          onClick={() => {
            if (immediate) {
              navigateBackFromSurvey();
              return;
            }
            setExitSurveyModalOpen(true);
          }}
          className="inline-flex h-9 w-9 items-center justify-center bg-transparent text-[28px] leading-none text-white/78 transition-all duration-150 hover:text-white active:scale-[0.98] sm:h-10 sm:w-10 sm:text-[30px]"
        >
          <span className="-mt-[2px]">×</span>
        </button>
      </div>
    );
  };

  const resolveAdaptiveGridConfig = (playerCount, ratio, height) => {
    const safeCount = Math.max(playerCount || 1, 1);
    const safeHeight = Math.max(height || 0, 1);
    const isWideViewport = ratio >= 0.95;
    const isShortViewport = safeHeight <= 860;
    const isVeryShortViewport = safeHeight <= 760;
    let columns;
    let rows;

    if (safeCount <= 10) {
      columns = isWideViewport ? 4 : 3;
      if (!isWideViewport && isShortViewport && safeCount >= 8) {
        columns += 1;
      }
      rows = Math.ceil(safeCount / columns);
    } else if (safeCount <= 14) {
      columns = isWideViewport ? 5 : 4;
      if (!isWideViewport && isShortViewport) {
        columns += 1;
      }
      rows = Math.max(isVeryShortViewport ? 2 : 3, Math.ceil(safeCount / columns));
    } else if (safeCount <= 22) {
      columns = isWideViewport ? 6 : 5;
      if (!isWideViewport && isShortViewport) {
        columns += 1;
      }
      rows = Math.max(isVeryShortViewport ? 3 : 4, Math.ceil(safeCount / columns));
    } else {
      columns = isWideViewport ? 7 : 6;
      if (!isWideViewport && isVeryShortViewport) {
        columns += 1;
      }
      rows = Math.ceil(safeCount / columns);
    }

    while (rows * columns < safeCount) {
      rows += 1;
    }

    const gap = isVeryShortViewport
      ? safeCount >= 22 ? 4 : safeCount >= 14 ? 5 : 6
      : isShortViewport
        ? safeCount >= 22 ? 5 : safeCount >= 14 ? 6 : 7
        : safeCount >= 22 ? 6 : safeCount >= 14 ? 8 : 9;
    const nameSizeClass = safeCount >= 22 || isVeryShortViewport
      ? 'text-[8px] sm:text-[9px]'
      : safeCount >= 14 || isShortViewport
        ? 'text-[9px] sm:text-[10px]'
        : 'text-[11px] sm:text-[12px]';
    const silhouetteSizeClass = safeCount >= 22 || isVeryShortViewport
      ? 'h-[38%] w-[38%]'
      : safeCount >= 14 || isShortViewport
        ? 'h-[44%] w-[44%]'
        : 'h-[54%] w-[54%]';
    const gridMaxWidth = safeCount <= 10
      ? (isWideViewport ? 980 : isShortViewport ? 860 : 760)
      : safeCount <= 14
        ? (isWideViewport ? 1060 : isShortViewport ? 940 : 840)
        : (isWideViewport ? 1160 : isShortViewport ? 1020 : 920);
    const gridPadding = isVeryShortViewport ? '2px' : isShortViewport ? '3px 2px' : '4px 3px';

    return {
      rows,
      columns,
      gap,
      nameSizeClass,
      silhouetteSizeClass,
      gridMaxWidth,
      gridPadding,
    };
  };

  const PlayerPhotoFallback = ({ silhouetteSizeClass }) => (
    <div className="relative h-full w-full overflow-hidden bg-[linear-gradient(160deg,#3b2f7a_0%,#2c2362_45%,#1c1644_100%)]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_18%,rgba(207,196,255,0.24)_0%,rgba(44,35,98,0)_66%)]" />
      <svg
        viewBox="0 0 160 160"
        aria-hidden="true"
        className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-[46%] text-white/34 ${silhouetteSizeClass}`}
      >
        <path
          fill="currentColor"
          d="M80 68c14 0 25-11 25-25S94 18 80 18 55 29 55 43s11 25 25 25Zm0 10c-24 0-44 14-50 36a8 8 0 0 0 8 10h84a8 8 0 0 0 8-10c-6-22-26-36-50-36Z"
        />
      </svg>
    </div>
  );

  const renderMiniPlayerCards = ({
    isSelected,
    onSelect,
  }) => {
    const playerCount = jugadores.length;
    const adaptiveGrid = resolveAdaptiveGridConfig(playerCount, viewportRatio, viewportHeight);
    const hasSelection = jugadores.some((candidate) => isSelected(candidate.uuid));
    const renderGrid = ({
      players,
      gridConfig,
      keyPrefix,
      rowMinHeight = null,
      maxHeight = '100%',
      gridMaxWidth = gridConfig.gridMaxWidth,
    }) => (
      <div
        className="mx-auto grid h-full w-full place-content-center overflow-visible"
        style={{
          gridTemplateColumns: `repeat(${gridConfig.columns}, minmax(0, 1fr))`,
          gridTemplateRows: rowMinHeight
            ? `repeat(${gridConfig.rows}, minmax(${rowMinHeight}px, auto))`
            : `repeat(${gridConfig.rows}, minmax(0, 1fr))`,
          gap: `${gridConfig.gap}px`,
          maxWidth: `${gridMaxWidth}px`,
          maxHeight,
          minHeight: 0,
          padding: gridConfig.gridPadding,
        }}
      >
        {players.map((jugador, index) => {
          const selected = isSelected(jugador.uuid);
          const hasPhoto = Boolean(jugador.avatar_url || jugador.foto_url);
          return (
            <button
              key={`${keyPrefix}${jugador.uuid}`}
              type="button"
              onClick={() => onSelect(jugador.uuid)}
              className={`group relative h-full min-h-0 min-w-0 transform-gpu overflow-visible rounded-xl border bg-[linear-gradient(168deg,rgba(106,67,255,0.28),rgba(22,16,55,0.9))] transition-[transform,opacity,filter] duration-[260ms] ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 will-change-transform ${
                selected
                  ? `z-20 -translate-y-[2px] ${isTightLayout ? 'scale-[1.015]' : isCompressedLayout ? 'scale-[1.022]' : 'scale-[1.035]'}`
                  : 'z-10 translate-y-0 scale-100'
              } ${
                hasSelection && !selected ? 'saturate-[0.74]' : ''
              }`}
              style={{
                borderColor: selected ? 'rgba(216,206,255,0.85)' : 'rgba(148,134,255,0.26)',
                opacity: hasSelection && !selected ? 0.45 : 1,
                boxShadow: selected
                  ? '0 0 0 1px rgba(199,184,255,0.85), 0 0 22px rgba(139,92,255,0.4), 0 16px 26px rgba(7,5,28,0.5)'
                  : '0 10px 18px rgba(8,6,30,0.4)',
              }}
            >
              {selected ? (
                <div className="pointer-events-none absolute -inset-1 rounded-[12px] bg-[radial-gradient(circle,rgba(176,160,255,0.5)_0%,rgba(176,160,255,0.16)_46%,rgba(176,160,255,0)_78%)] blur-[8px]" />
              ) : null}
              <div
                className="relative flex h-full w-full flex-col overflow-hidden rounded-xl"
                style={{
                  animation: 'cardIn 420ms cubic-bezier(0.22,1,0.36,1) both',
                  animationDelay: `${Math.min(index * 16, 160)}ms`,
                }}
              >
                <div className="relative h-[75%] w-full overflow-hidden bg-[#161038]">
                  {hasPhoto ? (
                    <img
                      src={jugador.avatar_url || jugador.foto_url}
                      alt={jugador.nombre}
                      className="h-full w-full object-contain object-center bg-[#151037]"
                      loading="lazy"
                    />
                  ) : (
                    <PlayerPhotoFallback
                      silhouetteSizeClass={gridConfig.silhouetteSizeClass}
                    />
                  )}
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[46%] bg-gradient-to-t from-[#0a0722]/94 via-[#120d33]/55 to-transparent" />
                </div>
                <div className="relative flex h-[25%] w-full items-center justify-center px-1.5 bg-[linear-gradient(180deg,rgba(34,26,74,0.96)_0%,rgba(22,16,52,0.98)_100%)]">
                  <span
                    className={`w-full truncate text-center font-oswald font-semibold tracking-[0.035em] text-white ${gridConfig.nameSizeClass}`}
                  >
                    {jugador.nombre}
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    );

    if (challengeSurveyPlayerSections.length > 0) {
      return (
        <div className={`${miniCardsStageClass} items-stretch`}>
          <div className="w-full h-full min-h-0 max-w-[980px] overflow-y-auto overscroll-contain pr-1">
            <div className={`mx-auto flex min-h-full w-full flex-col ${isTightLayout ? 'gap-2.5' : isCompressedLayout ? 'gap-3' : 'gap-4'}`}>
              {challengeSurveyPlayerSections.map((section, index) => {
                const sectionGrid = resolveAdaptiveGridConfig(
                  section.players.length,
                  viewportRatio,
                  Math.max(viewportHeight - (isTightLayout ? 300 : isCompressedLayout ? 340 : 380), 360),
                );
                const rowMinHeight = isTightLayout
                  ? 90
                  : isCompressedLayout
                    ? 98
                    : 110;

                return (
                  <div key={section.key} className="w-full min-h-0">
                    <div className={`flex items-center gap-3 ${index > 0 ? 'pt-1' : ''}`}>
                      <span className={`shrink-0 font-bebas uppercase tracking-[0.08em] text-white/88 ${isTightLayout ? 'text-[16px]' : isCompressedLayout ? 'text-[17px]' : 'text-[18px]'}`}>
                        {section.label}
                      </span>
                      <span className="h-px flex-1 bg-white/14" />
                    </div>
                    <div className={isTightLayout ? 'pt-1.5' : isCompressedLayout ? 'pt-2' : 'pt-2.5'}>
                      {renderGrid({
                        players: section.players,
                        gridConfig: sectionGrid,
                        keyPrefix: `${section.key}-`,
                        rowMinHeight,
                        maxHeight: 'none',
                        gridMaxWidth: Math.min(sectionGrid.gridMaxWidth, 880),
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className={miniCardsStageClass}>
        {renderGrid({
          players: jugadores,
          gridConfig: adaptiveGrid,
          keyPrefix: 'all-',
        })}
      </div>
    );
  };

  // Animation style
  const animationStyle = `
    @keyframes slideIn {
      from { transform: translateY(14px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
    @keyframes cardIn {
      from { transform: translateY(12px) scale(0.96); opacity: 0; }
      to { transform: translateY(0) scale(1); opacity: 1; }
    }
  `;

  if (loading) {
    return (
      <PageTransition>
        <div className="relative h-[100dvh] w-full overflow-hidden">
          <div className="absolute inset-0 overflow-hidden" style={screenBackgroundStyle} />
          <div className="relative z-[1] h-full w-full overflow-hidden" style={safeAreaStyle}>
            <div className={cardClass}>
              <div className="flex h-full flex-col items-center justify-center gap-5">
                <PageLoadingState
                  title="CARGANDO ENCUESTA"
                  description="Estamos preparando los datos del partido."
                />
                <SurveyFooterLogo />
              </div>
            </div>
          </div>
        </div>
      </PageTransition>
    );
  }

  if (surveyUnavailableMessage) {
    return (
      <PageTransition>
        <div className="relative h-[100dvh] w-full overflow-hidden">
          <div className="absolute inset-0 overflow-hidden" style={screenBackgroundStyle} />
          <div className="relative z-[1] h-full w-full overflow-hidden" style={safeAreaStyle}>
            <div className={cardClass}>
              {renderExitSurveyButton({ immediate: true }) || <div className={progressGapClass} />}
              <div className={`${centeredSummaryStackClass} animate-[slideIn_0.42s_cubic-bezier(0.22,1,0.36,1)_forwards]`}>
                <div className="w-full">
                  <div className={titleClass}>
                    ENCUESTA NO DISPONIBLE
                  </div>
                </div>
                <div className="text-white text-[18px] md:text-[22px] font-oswald text-center font-normal tracking-wide leading-[1.25]">
                  {surveyUnavailableMessage}
                </div>
                <div className={centeredSummaryButtonWrapClass}>
                  <button className={btnClass} onClick={() => navigate('/')}>
                    VOLVER AL INICIO
                  </button>
                </div>
                <div className={logoRowClass}>
                  <SurveyFooterLogo />
                </div>
              </div>
            </div>
          </div>
        </div>
      </PageTransition>
    );
  }

  if (surveyClosed && !alreadySubmitted) {
    return (
      <PageTransition>
        <div className="relative h-[100dvh] w-full overflow-hidden">
          <div className="absolute inset-0 overflow-hidden" style={screenBackgroundStyle} />
          <div className="relative z-[1] h-full w-full overflow-hidden" style={safeAreaStyle}>
            <div className={cardClass}>
              {renderExitSurveyButton({ immediate: true }) || <div className={progressGapClass} />}
              <div className={`${centeredSummaryStackClass} animate-[slideIn_0.42s_cubic-bezier(0.22,1,0.36,1)_forwards]`}>
                <div className="w-full">
                  <div className={titleClass}>
                    ENCUESTA CERRADA
                  </div>
                </div>
                <div className="text-white text-[18px] md:text-[22px] font-oswald text-center font-normal tracking-wide leading-[1.25]">
                  {getSurveyClosedMessage(surveyClosedAt)}
                </div>
                <div className={centeredSummaryButtonWrapClass}>
                  <button className={btnClass} onClick={() => navigate('/')}>
                    VOLVER AL INICIO
                  </button>
                </div>
                <div className={logoRowClass}>
                  <SurveyFooterLogo />
                </div>
              </div>
            </div>
          </div>
        </div>
        <ConfirmModal
          isOpen={surveyModal.isOpen}
          title={surveyModal.title}
          message={surveyModal.message}
          confirmText="Aceptar"
          singleButton={true}
          onConfirm={closeSurveyModal}
          onCancel={closeSurveyModal}
          actionsAlign="center"
        />
      </PageTransition>
    );
  }

  if (yaCalificado || alreadySubmitted) {
    return (
      <PageTransition>
        <div className="relative h-[100dvh] w-full overflow-hidden">
          <div className="absolute inset-0 overflow-hidden" style={screenBackgroundStyle} />
          <div className="relative z-[1] h-full w-full overflow-hidden" style={safeAreaStyle}>
            <div className={cardClass}>
              {renderExitSurveyButton({ immediate: true }) || <div className={progressGapClass} />}
              <div className={`${centeredSummaryStackClass} animate-[slideIn_0.42s_cubic-bezier(0.22,1,0.36,1)_forwards]`}>
                <div className="w-full">
                  <div className="font-bebas text-[30px] md:text-[44px] text-white tracking-[0.04em] font-bold text-center leading-[1.05] uppercase drop-shadow-md break-words w-full">
                    YA COMPLETASTE<br />LA ENCUESTA
                  </div>
                </div>
                <div className="text-white text-[18px] md:text-[22px] font-oswald text-center font-normal tracking-wide leading-[1.25]">
                  ¡Gracias por tu participación!
                </div>
                <div className={centeredSummaryButtonWrapClass}>
                  <button className={btnClass} onClick={() => navigate('/')}>
                    VOLVER AL INICIO
                  </button>
                </div>
                <div className={logoRowClass}>
                  <SurveyFooterLogo />
                </div>
              </div>
            </div>
          </div>
        </div>
      </PageTransition>
    );
  }

  if (!partido) {
    return (
      <PageTransition>
        <div className="relative h-[100dvh] w-full overflow-hidden">
          <div className="absolute inset-0 overflow-hidden" style={screenBackgroundStyle} />
          <div className="relative z-[1] h-full w-full overflow-hidden" style={safeAreaStyle}>
            <div className={cardClass}>
              {renderExitSurveyButton({ immediate: true }) || <div className={progressGapClass} />}
              <div className={`${centeredSummaryStackClass} animate-[slideIn_0.42s_cubic-bezier(0.22,1,0.36,1)_forwards]`}>
                <div className="w-full">
                  <div className={titleClass}>
                    ENCUESTA NO DISPONIBLE
                  </div>
                </div>
                <div className="text-white text-[18px] md:text-[22px] font-oswald text-center font-normal tracking-wide leading-[1.25]">
                  No se pudieron cargar los datos del partido.
                </div>
                <div className={centeredSummaryButtonWrapClass}>
                  <button className={btnClass} onClick={() => navigate('/')}>
                    VOLVER AL INICIO
                  </button>
                </div>
                <div className={logoRowClass}>
                  <SurveyFooterLogo />
                </div>
              </div>
            </div>
          </div>
        </div>
        <ConfirmModal
          isOpen={surveyModal.isOpen}
          title={surveyModal.title}
          message={surveyModal.message}
          confirmText="Aceptar"
          singleButton={true}
          onConfirm={closeSurveyModal}
          onCancel={closeSurveyModal}
          actionsAlign="center"
        />
      </PageTransition>
    );
  }

  return (
    <PageTransition>
      <div className="relative h-[100dvh] w-full overflow-hidden">
        <div className="absolute inset-0 overflow-hidden" style={screenBackgroundStyle} />
        <div className="relative z-[1] h-full w-full overflow-hidden" style={safeAreaStyle}>
          <style>{animationStyle}</style>
          <div className={cardClass}>
            {renderStepProgress()}
            {renderExitSurveyButton() || <div className={progressGapClass} />}
          {/* STEP 0: ¿SE JUGÓ? */}
          {currentStep === SURVEY_STEPS.PLAYED && (
            <div className={`${stepClass} !justify-start animate-[slideIn_0.42s_cubic-bezier(0.22,1,0.36,1)_forwards]`}>
              <div className="w-full flex-1 min-h-0 flex flex-col items-center justify-center">
                <div className={questionRowClass}>
                  <div className="w-full">
                    <div className={titleClass}>
                      ¿SE JUGÓ EL PARTIDO?
                    </div>
                    {isTeamChallengeSurvey && challengeSurveyName ? (
                      <div className={`text-center font-oswald leading-tight text-white ${isCompressedLayout ? 'mt-1 text-[16px] md:text-[18px]' : 'mt-1.5 text-[18px] md:text-[21px]'}`}>
                        Desafío: {challengeSurveyName}
                      </div>
                    ) : null}
                    <div className={`text-white font-oswald text-center font-normal tracking-wide ${isCompressedLayout ? 'mt-1.5 text-[15px] md:text-[18px]' : 'mt-2 text-[17px] md:text-[20px]'}`}>
                      {formatFecha(partido.fecha)}<br />
                      {partido.hora && `${partido.hora} - `}{partido.sede ? partido.sede.split(/[,(]/)[0].trim() : 'Sin ubicación'}
                    </div>
                  </div>
                </div>
                <div className={actionRowClass}>
                  <div className={gridClass}>
                    <button
                      className={`${optionBtnClass} ${formData.se_jugo ? optionBtnSelectedClass : ''}`}
                      onClick={() => {
                        handleInputChange('se_jugo', true);
                        handleInputChange('motivo_no_jugado', '');
                        if (formData.ganador === 'no_jugado') {
                          handleInputChange('ganador', '');
                        }
                        setCurrentStep(
                          compactFlowMode
                            ? resolveNextResultGateStep({
                              teamsConfirmed,
                              teamsLocked,
                              forceOrganizeTeamsStep: shouldForceOrganizeTeamsStep,
                              disableOrganizeTeamsStep: shouldDisableTeamReorganization,
                            })
                            : SURVEY_STEPS.ATTENDANCE,
                        );
                      }}
                      type="button"
                    >
                      SÍ
                    </button>
                    <button
                      className={`${optionBtnClass} ${!formData.se_jugo ? optionBtnSelectedClass : ''}`}
                      onClick={() => {
                        handleInputChange('se_jugo', false);
                        handleInputChange('ganador', 'no_jugado');
                        handleInputChange('motivo_no_jugado', '');
                        handleInputChange('jugadores_ausentes', []);
                        setCurrentStep(SURVEY_STEPS.NOT_PLAYED_REASON);
                      }}
                      type="button"
                    >
                      NO
                    </button>
                  </div>
                </div>
              </div>
              <div className={`w-full shrink-0 ${isCompressedLayout ? 'pt-2 sm:pt-3 pb-0.5 sm:pb-1' : 'pt-3 sm:pt-4 pb-1.5 sm:pb-2'}`}>
                <SurveyImportantDisclaimer className="mx-auto w-full max-w-[820px]" />
              </div>
              <div className={logoRowClass}>
                <SurveyFooterLogo />
              </div>
            </div>
          )}

          {/* STEP 1: ¿ASISTIERON TODOS? */}
          {currentStep === SURVEY_STEPS.ATTENDANCE && (
            <div className={`${stepClass} animate-[slideIn_0.42s_cubic-bezier(0.22,1,0.36,1)_forwards]`}>
              <div className={questionRowClass}>
                <div className={titleClass}>
                  ¿ASISTIERON TODOS?
                </div>
              </div>
              <div className={actionRowClass}>
                <div className={gridClass}>
                  <button
                    className={optionBtnClass}
                    onClick={() => {
                      handleInputChange('asistieron_todos', true);
                      setCurrentStep(SURVEY_STEPS.MVP);
                    }}
                    type="button"
                  >
                    SÍ
                  </button>
                  <button
                    className={optionBtnClass}
                    onClick={() => {
                      handleInputChange('asistieron_todos', false);
                      setCurrentStep(SURVEY_STEPS.ABSENTS);
                    }}
                    type="button"
                  >
                    NO
                  </button>
                </div>
              </div>
              <div className={logoRowClass}>
                <SurveyFooterLogo />
              </div>
            </div>
          )}

          {/* STEP 2: MVP */}
          {currentStep === SURVEY_STEPS.MVP && (
            <div className={`${playerStepClass} animate-[slideIn_0.42s_cubic-bezier(0.22,1,0.36,1)_forwards]`}>
              <div className={questionRowClass}>
                <div className={titleClass}>
                  ¿QUIÉN FUE EL MEJOR JUGADOR?
                </div>
              </div>
              <div className={playerContentRowClass}>
                {renderMiniPlayerCards({
                  isSelected: (uuid) => formData.mvp_id === uuid,
                  onSelect: (uuid) => handleInputChange('mvp_id', uuid),
                })}
              </div>
              <div className={playerActionRowClass}>
                <div className={compactButtonRowClass}>
                  <button
                    className={compactPrimaryBtnClass}
                    onClick={() => setCurrentStep(SURVEY_STEPS.GOALKEEPER)}
                    disabled={!formData.mvp_id}
                  >
                    SIGUIENTE
                  </button>
                </div>
              </div>
              <div className={logoRowClass}>
                <SurveyFooterLogo />
              </div>
            </div>
          )}

          {/* STEP 3: ARQUERO */}
          {currentStep === SURVEY_STEPS.GOALKEEPER && (
            <div className={`${playerStepClass} animate-[slideIn_0.42s_cubic-bezier(0.22,1,0.36,1)_forwards]`}>
              <div className={questionRowClass}>
                <div className={titleClass}>
                  ¿QUIÉN FUE EL MEJOR ARQUERO?
                </div>
              </div>
              <div className={playerContentRowClass}>
                {renderMiniPlayerCards({
                  isSelected: (uuid) => formData.arquero_id === uuid,
                  onSelect: (uuid) => {
                    handleInputChange('arquero_id', uuid);
                    handleInputChange('sin_arquero_fijo', false);
                  },
                })}
              </div>
              <div className={playerActionRowClass}>
                <div className={compactDualButtonRowClass}>
                  <button
                    type="button"
                    className={`${compactPrimaryBtnClass} ${formData.sin_arquero_fijo && !formData.arquero_id ? optionBtnSelectedClass : ''}`}
                    onClick={() => {
                      handleInputChange('arquero_id', '');
                      handleInputChange('sin_arquero_fijo', true);
                      setCurrentStep(SURVEY_STEPS.CLEAN_MATCH);
                    }}
                  >
                    NO HUBO
                  </button>
                  <button
                    className={compactPrimaryBtnClass}
                    onClick={() => setCurrentStep(SURVEY_STEPS.CLEAN_MATCH)}
                    disabled={!formData.arquero_id && !formData.sin_arquero_fijo}
                  >
                    SIGUIENTE
                  </button>
                </div>
              </div>
              <div className={logoRowClass}>
                <SurveyFooterLogo />
              </div>
            </div>
          )}

          {/* STEP 4: ¿PARTIDO LIMPIO? */}
          {currentStep === SURVEY_STEPS.CLEAN_MATCH && (
            <div className={`${stepClass} animate-[slideIn_0.42s_cubic-bezier(0.22,1,0.36,1)_forwards]`}>
              <div className={questionRowClass}>
                <div className={titleClass}>
                  ¿FUE UN PARTIDO LIMPIO?
                </div>
              </div>
              <div className={actionRowClass}>
                <div className={gridClass}>
                  <button
                    className={`${optionBtnClass} ${formData.partido_limpio ? optionBtnSelectedClass : ''}`}
                    onClick={() => {
                      handleInputChange('partido_limpio', true);
                      setCurrentStep(resolveNextResultGateStep({
                        teamsConfirmed,
                        teamsLocked,
                        forceOrganizeTeamsStep: shouldForceOrganizeTeamsStep,
                        disableOrganizeTeamsStep: shouldDisableTeamReorganization,
                      }));
                    }}
                    type="button"
                  >
                    SÍ
                  </button>
                  <button
                    className={`${optionBtnClass} ${!formData.partido_limpio ? optionBtnSelectedClass : ''}`}
                    onClick={() => {
                      handleInputChange('partido_limpio', false);
                      setCurrentStep(SURVEY_STEPS.DIRTY_PLAYERS);
                    }}
                    type="button"
                  >
                    NO
                  </button>
                </div>
              </div>
              <div className={logoRowClass}>
                <SurveyFooterLogo />
              </div>
            </div>
          )}

          {/* STEP 5: ¿QUIÉN GANÓ? */}
          {currentStep === SURVEY_STEPS.RESULT && (
            <div className={`${stepClass} animate-[slideIn_0.42s_cubic-bezier(0.22,1,0.36,1)_forwards]`}>
              <div className={questionRowClass}>
                <div className="w-full">
                  <div className={titleClass}>
                    ¿QUIÉN GANÓ?
                  </div>
                  {!isTeamChallengeSurvey && (
                    <div className="mt-2 text-center font-oswald text-[13px] leading-snug text-white/75 md:text-[14px]">
                      {teamsContextLabel}
                    </div>
                  )}
                </div>
              </div>
              <div className={`${contentRowClass} items-start`}>
                <div className="w-full max-w-[760px] mx-auto">
                  {finalTeams.teamA.length > 0 && finalTeams.teamB.length > 0 ? (
                    <div className="w-full space-y-3">
                      <TeamsDnDEditor
                        teamA={finalTeams.teamA}
                        teamB={finalTeams.teamB}
                        playersByKey={playersByKey}
                        teamALabel={isTeamChallengeSurvey ? challengeSurveyTeamLabels.teamA : 'Equipo A'}
                        teamBLabel={isTeamChallengeSurvey ? challengeSurveyTeamLabels.teamB : 'Equipo B'}
                        selectedWinner={formData.ganador}
                        onWinnerChange={(winner) => {
                          handleInputChange('ganador', winner);
                          handleInputChange('se_jugo', true);
                          closeSurveyModal();
                        }}
                        allowWinnerSelectionWhenDisabled={finalTeamsValidation.ok}
                        disabled={true}
                        onChange={() => {}}
                      />
                    </div>
                  ) : (
                    <div className="h-[2px] w-full" />
                  )}

                  <div className="mt-6 sm:mt-7 flex flex-wrap items-center justify-center gap-2.5 sm:gap-3">
                    <button
                      type="button"
                      className={`${resultSecondaryBtnClass} ${formData.ganador === 'empate' ? optionBtnSelectedClass : ''}`}
                      onClick={() => {
                        handleInputChange('ganador', 'empate');
                        handleInputChange('se_jugo', true);
                        closeSurveyModal();
                      }}
                    >
                      EMPATE
                    </button>
                  </div>
                </div>
              </div>
              <div className={actionRowClass}>
                <div className={actionDockClass}>
                  <button
                    className={btnClass}
                    onClick={handleSubmit}
                    disabled={submitting || encuestaFinalizada || !formData.ganador}
                  >
                    FINALIZAR ENCUESTA
                  </button>
                </div>
              </div>
              <div className={logoRowClass}>
                <SurveyFooterLogo />
              </div>
            </div>
          )}

          {/* STEP 6: JUGADORES VIOLENTOS */}
          {currentStep === SURVEY_STEPS.DIRTY_PLAYERS && (
            <div className={`${playerStepClass} animate-[slideIn_0.42s_cubic-bezier(0.22,1,0.36,1)_forwards]`}>
              <div className={questionRowClass}>
                <div className={titleClass}>
                  ¿QUIÉN JUGÓ SUCIO?
                </div>
              </div>
              <div className={playerContentRowClass}>
                {renderMiniPlayerCards({
                  isSelected: (uuid) => formData.jugadores_violentos.includes(uuid),
                  onSelect: (uuid) => toggleJugadorViolento(uuid),
                })}
              </div>
              <div className={playerActionRowClass}>
                <div className={compactButtonRowClass}>
                  <button
                    className={compactPrimaryBtnClass}
                    onClick={() => {
                      setCurrentStep(resolveNextResultGateStep({
                        teamsConfirmed,
                        teamsLocked,
                        forceOrganizeTeamsStep: shouldForceOrganizeTeamsStep,
                        disableOrganizeTeamsStep: shouldDisableTeamReorganization,
                      }));
                    }}
                    disabled={formData.jugadores_violentos.length === 0}
                  >
                    SIGUIENTE
                  </button>
                </div>
              </div>
              <div className={logoRowClass}>
                <SurveyFooterLogo />
              </div>
            </div>
          )}

          {/* STEP 7: ORGANIZAR EQUIPOS */}
          {currentStep === SURVEY_STEPS.ORGANIZE_TEAMS && (
            <div className={`${stepClass} !justify-start ${isCompressedLayout ? 'pt-1 sm:pt-2' : 'pt-2 sm:pt-4'} animate-[slideIn_0.42s_cubic-bezier(0.22,1,0.36,1)_forwards]`}>
              <div className={questionRowClass}>
                <div className="w-full">
                  <div className={titleClass}>
                    {shouldShowWinnerSelectionInOrganizeStep ? '¿Quién ganó el partido?' : 'ARMÁ LOS EQUIPOS COMO FINALMENTE SE JUGÓ'}
                  </div>
                  <div className={`text-center font-oswald leading-snug text-white/75 ${isCompressedLayout ? 'mt-1.5 text-[12px] md:text-[13px]' : 'mt-2 text-[13px] md:text-[14px]'}`}>
                    {shouldShowWinnerSelectionInOrganizeStep ? friendlyOrganizeAndResultHelperText : organizeTeamsHelperText}
                  </div>
                </div>
              </div>
              <div className={`w-full flex-1 min-h-0 flex items-center justify-center ${isCompressedLayout ? 'pt-1.5 sm:pt-2' : 'pt-2 sm:pt-3'}`}>
                <div className="w-full max-w-[760px] mx-auto">
                  <TeamsDnDEditor
                    teamA={finalTeams.teamA}
                    teamB={finalTeams.teamB}
                    playersByKey={playersByKey}
                    teamALabel={isTeamChallengeSurvey ? challengeSurveyTeamLabels.teamA : 'Equipo A'}
                    teamBLabel={isTeamChallengeSurvey ? challengeSurveyTeamLabels.teamB : 'Equipo B'}
                    selectedWinner={shouldShowWinnerSelectionInOrganizeStep ? formData.ganador : ''}
                    onWinnerChange={(winner) => {
                      if (!shouldShowWinnerSelectionInOrganizeStep) return;
                      handleInputChange('ganador', winner);
                      handleInputChange('se_jugo', true);
                      closeSurveyModal();
                    }}
                    onChange={(next) => {
                      if (shouldDisableTeamReorganization) return;
                      setFinalTeams(next);
                      closeSurveyModal();
                    }}
                    disabled={shouldDisableTeamReorganization}
                  />

                  {shouldShowWinnerSelectionInOrganizeStep ? (
                    <div className={`w-full flex items-center justify-center ${isCompressedLayout ? 'pt-3 sm:pt-4' : 'pt-4 sm:pt-5'}`}>
                      <button
                        type="button"
                        className={`${resultSecondaryBtnClass} !min-w-[170px] ${formData.ganador === 'empate' ? optionBtnSelectedClass : ''}`}
                        onClick={() => {
                          handleInputChange('ganador', 'empate');
                          handleInputChange('se_jugo', true);
                          closeSurveyModal();
                        }}
                      >
                        Empate
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
              <div className={`w-full shrink-0 flex items-center justify-center ${isCompressedLayout ? 'pb-1 sm:pb-1.5' : 'pb-2 sm:pb-2.5'} ${shouldShowWinnerSelectionInOrganizeStep ? (isCompressedLayout ? 'pt-5 sm:pt-6' : 'pt-8 sm:pt-10') : (isCompressedLayout ? 'pt-1.5 sm:pt-2' : 'pt-2 sm:pt-3')}`}>
                <div className={actionDockClass}>
                  <button
                    className={btnClass}
                    onClick={handleLockTeamsAndContinue}
                    disabled={
                      submitting
                      || encuestaFinalizada
                      || (shouldShowWinnerSelectionInOrganizeStep && !['equipo_a', 'equipo_b', 'empate'].includes(formData.ganador))
                    }
                  >
                    {shouldShowWinnerSelectionInOrganizeStep ? 'FINALIZAR ENCUESTA' : 'CONTINUAR'}
                  </button>
                </div>
              </div>
              <div className={logoRowClass}>
                <SurveyFooterLogo />
              </div>
            </div>
          )}

          {/* STEP 10: MOTIVO NO JUGADO */}
          {currentStep === SURVEY_STEPS.NOT_PLAYED_REASON && (
            <div className={`${stepClass} animate-[slideIn_0.42s_cubic-bezier(0.22,1,0.36,1)_forwards]`}>
              <div className={questionRowClass}>
                <div className="w-full">
                  <div className={titleClass}>
                    ¿QUÉ PASÓ?
                  </div>
                  <div className={`${textClass} ${isCompressedLayout ? 'mt-2 sm:mt-2.5' : 'mt-2.5 sm:mt-3'} text-white/82`}>
                    Elegí el motivo para cerrar la encuesta.
                  </div>
                </div>
              </div>
              <div className={contentRowClass}>
                <div className={notPlayedReasonListClass}>
                  {NOT_PLAYED_REASON_OPTIONS.map((option) => {
                    const isSelected = selectedNotPlayedReason?.value === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        className={`
                          w-full text-left rounded-[16px] border transition-all duration-200
                          ${isCompressedLayout ? 'px-4 py-4 sm:px-5 sm:py-4.5' : 'px-5 py-5 sm:px-6 sm:py-5.5'}
                          ${isSelected
                            ? 'border-[#a78bfa] bg-[rgba(106,67,255,0.35)] shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_16px_32px_rgba(54,32,140,0.4),0_0_18px_rgba(106,67,255,0.25)]'
                            : 'border-[rgba(148,134,255,0.22)] bg-white/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_10px_24px_rgba(8,6,30,0.25)] hover:bg-white/[0.1] hover:border-[rgba(148,134,255,0.4)]'}
                        `}
                        onClick={() => handleNotPlayedReasonSelect(option.value)}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <div className={`font-bebas tracking-[0.05em] ${isCompressedLayout ? 'text-[24px] sm:text-[26px]' : 'text-[26px] sm:text-[30px]'} ${isSelected ? 'text-white' : 'text-white/92'}`}>
                              {option.label}
                            </div>
                            <div className={`font-oswald leading-relaxed ${isCompressedLayout ? 'mt-1 text-[14px] sm:text-[15px]' : 'mt-1.5 text-[15px] sm:text-[16px]'} ${isSelected ? 'text-white/90' : 'text-white/68'}`}>
                              {option.description}
                            </div>
                          </div>
                          <div className={`mt-0.5 h-5 w-5 shrink-0 rounded-full border ${isSelected ? 'border-[#ec007d] bg-[#ec007d] shadow-[0_0_0_4px_rgba(236,0,125,0.18)]' : 'border-white/26 bg-transparent'}`} />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className={actionRowClass}>
                <div className={actionDockClass}>
                  <button
                    className={btnClass}
                    type="button"
                    onClick={handleNotPlayedPrimaryAction}
                    disabled={!selectedNotPlayedReason || submitting || encuestaFinalizada}
                  >
                    {notPlayedPrimaryButtonLabel}
                  </button>
                </div>
              </div>
              <div className={logoRowClass}>
                <SurveyFooterLogo />
              </div>
            </div>
          )}

          {/* STEP 11: AUSENTES SIN AVISO (PARTIDO NO JUGADO) */}
          {currentStep === SURVEY_STEPS.NOT_PLAYED_ABSENTS && (
            <div className={`${playerStepClass} animate-[slideIn_0.42s_cubic-bezier(0.22,1,0.36,1)_forwards]`}>
              <div className={questionRowClass}>
                <div className="w-full">
                  <div className={titleClass}>
                    ¿QUIÉNES FALTARON?
                  </div>
                  <div className={`${textClass} ${isCompressedLayout ? 'mt-2 sm:mt-2.5' : 'mt-2.5 sm:mt-3'} text-white/82`}>
                    Marcá uno o varios ausentes sin aviso. Después de confirmar, la encuesta termina.
                  </div>
                </div>
              </div>
              <div className={playerContentRowClass}>
                {renderMiniPlayerCards({
                  isSelected: (uuid) => formData.jugadores_ausentes.includes(uuid),
                  onSelect: (uuid) => toggleJugadorAusente(uuid),
                })}
              </div>
              <div className={playerActionRowClass}>
                <div className={actionDockClass}>
                  <button
                    className={btnClass}
                    onClick={handleSubmit}
                    disabled={formData.jugadores_ausentes.length === 0}
                  >
                    FINALIZAR
                  </button>
                </div>
              </div>
              <div className={logoRowClass}>
                <SurveyFooterLogo />
              </div>
            </div>
          )}

          {/* STEP 12: AUSENTES (PARTIDO JUGADO) */}
          {currentStep === SURVEY_STEPS.ABSENTS && (
            <div className={`${playerStepClass} animate-[slideIn_0.42s_cubic-bezier(0.22,1,0.36,1)_forwards]`}>
              <div className={questionRowClass}>
                <div className={titleClass}>
                  ¿QUIÉNES FALTARON?
                </div>
              </div>
              <div className={playerContentRowClass}>
                {renderMiniPlayerCards({
                  isSelected: (uuid) => formData.jugadores_ausentes.includes(uuid),
                  onSelect: (uuid) => toggleJugadorAusente(uuid),
                })}
              </div>
              <div className={playerActionRowClass}>
                <div className={compactButtonRowClass}>
                  <button
                    className={compactPrimaryBtnClass}
                    onClick={() => setCurrentStep(SURVEY_STEPS.MVP)}
                    disabled={formData.jugadores_ausentes.length === 0}
                  >
                    SIGUIENTE
                  </button>
                </div>
              </div>
              <div className={logoRowClass}>
                <SurveyFooterLogo />
              </div>
            </div>
          )}

          {/* STEP 99: FINAL */}
          {currentStep === SURVEY_STEPS.DONE && (
            <div className={`${centeredSummaryStackClass} animate-[slideIn_0.42s_cubic-bezier(0.22,1,0.36,1)_forwards]`}>
              <div className="w-full">
                <div className={titleClass}>
                  ¡GRACIAS POR CALIFICAR!
                </div>
              </div>
              <div className={`${textClass} text-[26px] !mb-0`}>
                Los resultados se publicarán en ~{SURVEY_WINDOW_HOURS} horas.
              </div>
              <div className={centeredSummaryButtonWrapClass}>
                <button
                  className={btnClass}
                  onClick={() => navigate('/')}
                >
                  VOLVER AL INICIO
                </button>
              </div>
              <div className={logoRowClass}>
                <SurveyFooterLogo />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
    <ConfirmModal
      isOpen={surveyModal.isOpen}
      title={surveyModal.title}
      message={surveyModal.message}
      confirmText="Aceptar"
      singleButton={true}
      onConfirm={closeSurveyModal}
      onCancel={closeSurveyModal}
      actionsAlign="center"
    />
    <ConfirmModal
      isOpen={exitSurveyModalOpen}
      title="Cerrar encuesta"
      message="Si salís ahora, la encuesta va a quedar pendiente y vas a poder volver más tarde para completarla."
      confirmText="Salir"
      cancelText="Cancelar"
      onConfirm={confirmExitSurvey}
      onCancel={closeExitSurveyModal}
      actionsAlign="center"
    />
    </PageTransition>
  );
};

export default EncuestaPartido;
