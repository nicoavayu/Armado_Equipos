import logger from '../utils/logger';
import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import SurveyStepHeader from '../components/survey/SurveyStepHeader';
import SurveyQuestion from '../components/survey/SurveyQuestion';
import SurveyYesNo from '../components/survey/SurveyYesNo';
import SurveyPlayerGrid from '../components/survey/SurveyPlayerGrid';
import SurveyActionBar, { SurveyRosterStack, SurveySelectionSummary } from '../components/survey/SurveyActionBar';
import SurveySavedCelebration from '../components/survey/SurveySavedCelebration';
import { surveyHaptic } from '../components/survey/surveyHaptics';
import '../components/survey/surveyMotion.css';
import {
  CalendarCheck,
  CalendarDays,
  Check,
  CircleHelp,
  ClipboardX,
  Clock3,
  CloudRain,
  Hand,
  Loader2,
  MapPin,
  ShieldCheck,
  Shuffle,
  Star,
  TriangleAlert,
  Trophy,
  UserX,
  UsersRound,
} from 'lucide-react';
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
import { listChallengeApprovedSquad, listTeamMatchMembers } from '../services/db/teamChallenges';
import { notifyBlockingError } from 'utils/notifyBlockingError';
import { SURVEY_START_DELAY_MS } from '../config/surveyConfig';
import {
  isDuplicateSurveyResponseError,
  resolveSurveySubmitErrorMessage,
  runWithSubmitTimeout,
} from '../utils/surveySubmitGuards';
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
import {
  buildHomonymHints,
  dedupeSurveyRoster,
  fillMissingPlayerFields,
  haveConflictingIdentity,
  resolveSurveyPlayerIdentity,
} from '../utils/surveyRosterIdentity';

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

const NOT_PLAYED_REASON_ICONS = {
  absence_without_notice: UserX,
  weather_or_pitch: CloudRain,
  organization_issues: ClipboardX,
};

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
  const byPlayerId = new Map();
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

    const playerIdNum = Number(player?.id || 0);
    if (Number.isFinite(playerIdNum) && playerIdNum > 0 && !byPlayerId.has(playerIdNum)) {
      byPlayerId.set(playerIdNum, key);
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

    const memberPlayerId = Number(member?.jugador_id || member?.jugador?.id || 0);
    const playerKey = byPlayerId.get(memberPlayerId);
    if (playerKey && !usedKeys.has(playerKey)) {
      usedKeys.add(playerKey);
      return playerKey;
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

const dedupeChallengeSurveyRoster = dedupeSurveyRoster;
const resolveChallengePlayerIdentity = resolveSurveyPlayerIdentity;

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
    if (nameToken) byName.set(nameToken, new Set([...(byName.get(nameToken) || []), index]));
  };
  // The name joins two records only when one record has it and their IDs do not disagree.
  const indexByName = (nameToken, candidate) => {
    const indexes = Array.from(byName.get(nameToken) || []);
    if (indexes.length !== 1 || haveConflictingIdentity(merged[indexes[0]], candidate)) return -1;
    return indexes[0];
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

      const candidate = {
        id: playerId,
        uuid: jugador?.uuid || jugador?.usuario_id || `approved-${row?.id || playerId || nameToken || 'player'}`,
        usuario_id: jugador?.usuario_id || null,
        nombre: String(jugador?.nombre || 'Jugador').trim() || 'Jugador',
        avatar_url: jugador?.avatar_url || null,
        score: jugador?.score ?? null,
        is_goalkeeper: false,
      };

      let index = -1;
      if (playerId && byPlayerId.has(playerId)) index = byPlayerId.get(playerId);
      else if (userToken && byUserId.has(userToken)) index = byUserId.get(userToken);
      else if (uuidToken && byUuid.has(uuidToken)) index = byUuid.get(uuidToken);
      else if (nameToken) index = indexByName(nameToken, candidate);

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
  // Public web routes (/encuesta/:id) render without a NotificationProvider.
  const { fetchNotifications } = useNotifications() || {};
  const navigate = useNavigate();
  const { navigateWithAnimation: _navigateWithAnimation } = useAnimatedNavigation();
  const navigateBackFromSurvey = useSmartBackNavigation({ fallback: '/' });

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  // Set synchronously on the first tap: a second tap in the same frame cannot start
  // another submission before `submitting` re-renders the button disabled.
  const submitInFlightRef = useRef(false);
  const isMountedRef = useRef(true);
  const [submitError, setSubmitError] = useState('');
  const [submittedNow, setSubmittedNow] = useState(false);
  // SÍ/NO answers show as chosen only after the person taps them (defaults are not answers).
  const [answeredChoices, setAnsweredChoices] = useState({});
  const markAnswered = (field) => setAnsweredChoices((prev) => (prev[field] ? prev : { ...prev, [field]: true }));
  // Steps already answered on this path, to go back and change an answer.
  const [stepHistory, setStepHistory] = useState([]);
  const [stepDirection, setStepDirection] = useState('forward');
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

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

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
      setStepHistory([]);
      setStepDirection('forward');
      setAnsweredChoices({});
      setSubmittedNow(false);
      setSubmitError('');
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
        logger.error('[MARK_NOTIF_READ] Error:', error);
      }
    };

    markNotificationRead();
  }, [id, user?.id, fetchNotifications]);

  const handleInputChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  // Forward moves remember where they came from, so "atrás" returns to the previous
  // question of this path with its answer still selected.
  const goToStep = (nextStep) => {
    setStepHistory((prev) => [...prev, currentStep]);
    setStepDirection('forward');
    setSubmitError('');
    setCurrentStep(nextStep);
  };

  const goBack = () => {
    if (submitInFlightRef.current || stepHistory.length === 0) return;
    const previousStep = stepHistory[stepHistory.length - 1];
    setStepHistory(stepHistory.slice(0, -1));
    setStepDirection('back');
    setSubmitError('');
    setCurrentStep(previousStep);
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
        logger.error('[SURVEY_TEAMS] Direct update fallback failed', {
          code: updateError?.code || null,
          message: updateError?.message || null,
          details: updateError?.details || null,
          hint: updateError?.hint || null,
        });
      }
    } catch (fallbackUpdateError) {
      logger.error('[SURVEY_TEAMS] Direct update fallback exception', fallbackUpdateError);
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
      logger.error('[SURVEY_TEAMS] Fallback read check failed', fallbackReadError);
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
      logger.warn('[SURVEY_TEAMS] Persist blocked: missing refs', {
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
      logger.error('[SURVEY_TEAMS] save_match_final_teams RPC error', {
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
          logger.warn('[SURVEY_TEAMS] save_match_final_teams compat retry non-ok response', retryLockResult);
        }
      } catch (retryRpcError) {
        logger.error('[SURVEY_TEAMS] save_match_final_teams compat retry RPC error', {
          code: retryRpcError?.code || null,
          message: retryRpcError?.message || null,
          details: retryRpcError?.details || null,
          hint: retryRpcError?.hint || null,
        });
      }
    }

    if (!lockResult.ok) {
      logger.warn('[SURVEY_TEAMS] save_match_final_teams non-ok response', lockResult);
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

    // Independent reads: one round trip instead of two.
    const readOrNull = async (query) => {
      try {
        const { data, error } = await query;
        return error ? null : (data || null);
      } catch (_error) {
        return null;
      }
    };
    const [lifecycleRow, lifecycleTeamMatchRow] = await Promise.all([
      readOrNull(supabase
        .from('partidos')
        .select('survey_status, survey_opened_at, survey_closes_at, result_status, finished_at, fecha, hora')
        .eq('id', matchIdNum)
        .maybeSingle()),
      readOrNull(supabase
        .from('team_matches')
        .select('scheduled_at')
        .eq('partido_id', matchIdNum)
        .maybeSingle()),
    ]);

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

  // After the answer is saved: closing the survey and computing results/awards when this
  // was the last voter. It does not change what the person sees (the saved screen), so it
  // runs after showing it instead of keeping the button busy for ~10 more round trips.
  const reconcileSurveyAfterSubmit = async (matchIdNum, trace) => {
    let finalizeResult = null;
    try {
      finalizeResult = await trace.measure(
        'background.finalizeIfComplete',
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
      logger.warn('[finalizeIfComplete] non-blocking error:', e);
      trace.mark('finalizeIfComplete_non_blocking_error', {
        message: e?.message || String(e),
        code: e?.code || null,
      });
    }

    let postSubmitSubmissionGate = null;
    if (shouldRecheckPostSubmitSubmissionGate(finalizeResult)) {
      try {
        postSubmitSubmissionGate = await trace.measure(
          'background.ensureSurveyCanReceiveSubmission',
          () => ensureSurveyCanReceiveSubmission(),
        );
      } catch (_submissionGateError) {
        postSubmitSubmissionGate = null;
      }
    }

    const postSubmitUiState = resolvePostSubmitCompletionUiState({
      finalizeResult,
      submissionGate: postSubmitSubmissionGate,
    });
    if (!isMountedRef.current) return;
    setSurveyClosed(postSubmitUiState.shouldMarkSurveyClosed);
    setSurveyClosedAt(postSubmitUiState.closedAt || null);
    setEncuestaFinalizada(postSubmitUiState.shouldMarkSurveyClosed);
    trace.mark('background.reconciled', {
      shouldMarkSurveyClosed: postSubmitUiState.shouldMarkSurveyClosed,
      closedAt: postSubmitUiState.closedAt || null,
    });

    // NO auto-limpiamos el partido de "Mis partidos" al completar la encuesta.
    // La tarjeta post-partido ahora tiene su propio ciclo de vida (pagos): la
    // visibilidad la decide shouldShowPostMatchCard. Para el admin la tarjeta
    // debe seguir visible hasta que cierre los pagos/partido desde la pantalla
    // de pagos (o se cumpla la ventana de 7 días); para el jugador, sigue
    // visible si tiene un pago pendiente. Limpiar acá ocultaba la gestión de
    // pagos del admin apenas completaba su propia encuesta (bug crítico).
    trace.mark('clearMatchFromList_skipped_post_match_card_owns_lifecycle');
  };

  const continueSubmitFlow = async ({ skipPersistTeams = false, trace: incomingTrace = null } = {}) => {
    const trace = incomingTrace || createSubmitTrace('continueSubmitFlow', { skipPersistTeams });
    let submitStatus = 'unknown';
    setSubmitError('');
    try {
      trace.mark('flow_start', { skipPersistTeams });

      if (alreadySubmitted) {
        logger.info('Ya completaste esta encuesta');
        submitStatus = 'already_submitted';
        return;
      }

      const matchIdNum = Number(id);
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

      // "Is it still open?" and "did I already answer?" are independent reads: one round trip.
      const [submissionGate, hasExistingResponse] = await runWithSubmitTimeout(() => Promise.all([
        trace.measure(
          'pre_validation.ensureSurveyCanReceiveSubmission',
          () => ensureSurveyCanReceiveSubmission(),
        ),
        trace.measure(
          'pre_validation.hasExistingSurveyResponse',
          () => hasExistingSurveyResponse({
            partidoId: matchIdNum,
            playerIds: currentUserSurveyPlayerIds,
          }),
          { playerIdsCount: currentUserSurveyPlayerIds.length },
        ),
      ]));
      if (!submissionGate.canSubmit) {
        enforceSurveyClosedUiState(submissionGate.closedAt);
        submitStatus = 'survey_closed_before_insert';
        return;
      }
      if (hasExistingResponse) {
        setAlreadySubmitted(true);
        setEncuestaFinalizada(true);
        submitStatus = 'existing_response';
        return;
      }

      const outcome = resolveSurveyOutcome();
      if (outcome.seJugo && !skipPersistTeams && (!shouldDisableTeamReorganization || isTeamChallengeSurvey)) {
        const persistResult = await runWithSubmitTimeout(() => trace.measure(
          'pre_validation.persistSurveyTeamsDefinition',
          () => persistSurveyTeamsDefinition(),
        ));
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

      const insertSurvey = (payload, label, details = {}) => runWithSubmitTimeout((signal) => trace.measure(
        label,
        () => {
          const request = supabase.from('post_match_surveys').insert([payload]);
          return signal && typeof request.abortSignal === 'function' ? request.abortSignal(signal) : request;
        },
        details,
      ));

      const insertResult = await insertSurvey(surveyData, 'db.insert_post_match_surveys', {
        seJugo: outcome.seJugo,
        absentCount: ausentesIds.length,
        violentCount: violentosIds.length,
      });
      let insertError = insertResult.error || null;
      let usedLegacySurveyInsert = false;

      // Backward-compatible fallback if DB doesn't have the new columns yet.
      if (insertError && /ganador|resultado/i.test(insertError.message || '')) {
        const legacySurveyData = { ...surveyData };
        delete legacySurveyData.ganador;
        delete legacySurveyData.resultado;
        usedLegacySurveyInsert = true;
        const legacyRes = await insertSurvey(legacySurveyData, 'db.insert_post_match_surveys_legacy_retry');
        insertError = legacyRes.error || null;
      }

      // Unique per match and voter: a double tap or a retry after a lost response is
      // already saved, not an error.
      const alreadyStored = Boolean(insertError) && isDuplicateSurveyResponseError(insertError);
      if (alreadyStored) insertError = null;
      trace.mark('db.insert_post_match_surveys_result', {
        ok: !insertError,
        usedLegacySurveyInsert,
        alreadyStored,
      });

      if (insertError) {
        logger.error('[ENCUESTA] post_match_surveys insert error full:', insertError);
        throw insertError;
      }

      // Saved: show it now. Closing the survey / results continue in the background.
      setSubmittedNow(true);
      setAlreadySubmitted(true);
      trace.mark('visual_state_updated', { savedBeforeReconcile: true });
      submitStatus = 'success';
      reconcileSurveyAfterSubmit(matchIdNum, trace).catch((reconcileError) => {
        logger.warn('[ENCUESTA] post-submit reconcile failed', reconcileError);
      });
    } catch (error) {
      submitStatus = 'error';
      // Nothing was saved: the answers stay on screen and the button allows a retry.
      handleError(error, { showToast: false, onError: () => { } });
      if (isMountedRef.current) setSubmitError(resolveSurveySubmitErrorMessage(error));
    } finally {
      submitInFlightRef.current = false;
      if (isMountedRef.current) setSubmitting(false);
      trace.end({ status: submitStatus });
    }
  };

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    const trace = createSubmitTrace('handleSubmit');
    trace.mark('click_received');

    if (submitInFlightRef.current) {
      trace.end({ status: 'blocked', reason: 'already_processing' });
      return;
    }

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
      logger.info('Ya completaste esta encuesta');
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

    submitInFlightRef.current = true;
    setSubmitting(true);
    await continueSubmitFlow({ trace });
  };

  const handleLockTeamsAndContinue = async () => {
    if (submitInFlightRef.current || submitting || encuestaFinalizada || alreadySubmitted) return;

    if (shouldShowWinnerSelectionInOrganizeStep && !['equipo_a', 'equipo_b', 'empate'].includes(formData.ganador)) {
      openSurveyModal('Elegí quién ganó o marcá empate para finalizar la encuesta.', 'Falta seleccionar resultado');
      return;
    }

    const shouldSubmitFromHere = shouldShowWinnerSelectionInOrganizeStep;
    const trace = shouldSubmitFromHere
      ? createSubmitTrace('handleLockTeamsAndContinue', { skipPersistTeams: true })
      : null;
    trace?.mark('click_received');

    submitInFlightRef.current = true;
    setSubmitting(true);
    setSubmitError('');
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

      goToStep(SURVEY_STEPS.RESULT);
    } catch (error) {
      trace?.end({ status: 'error', reason: 'persist_teams_exception' });
      handleError(error, { showToast: false, onError: () => { } });
      if (isMountedRef.current) setSubmitError(resolveSurveySubmitErrorMessage(error));
    } finally {
      submitInFlightRef.current = false;
      if (isMountedRef.current) setSubmitting(false);
    }
  };

  const handleNotPlayedPrimaryAction = async () => {
    if (!selectedNotPlayedReason || submitInFlightRef.current || submitting || encuestaFinalizada) return;

    if (selectedNotPlayedReason.value === 'absence_without_notice') {
      goToStep(SURVEY_STEPS.NOT_PLAYED_ABSENTS);
      return;
    }

    const trace = createSubmitTrace('handleNotPlayedPrimaryAction', {
      selectedNotPlayedReason: selectedNotPlayedReason.value,
    });
    trace.mark('click_received');
    submitInFlightRef.current = true;
    setSubmitting(true);
    await continueSubmitFlow({ trace });
  };

  const formatFecha = (fechaStr) => {
    try {
      // 'YYYY-MM-DD' is a calendar day: parsed as UTC it showed the previous day in Argentina.
      const calendarDay = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(fechaStr || '').trim());
      const fecha = calendarDay
        ? new Date(Number(calendarDay[1]), Number(calendarDay[2]) - 1, Number(calendarDay[3]))
        : new Date(fechaStr);
      if (Number.isNaN(fecha.getTime())) return fechaStr || 'Fecha no disponible';
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
  const progressGapClass = `w-full shrink-0 ${isTightLayout ? 'h-4 sm:h-5' : isCompressedLayout ? 'h-5 sm:h-6' : 'h-7 sm:h-8'}`;
  const progressActionsClass = `w-full shrink-0 flex items-start justify-end ${isTightLayout ? 'h-9 pt-1.5 sm:h-10' : isCompressedLayout ? 'h-10 pt-2 sm:h-11' : 'h-11 pt-2.5 sm:h-12'}`;
  const logoRowClass = 'hidden';
  const titleClass = `font-bebas text-white font-bold text-center uppercase drop-shadow-[0_8px_18px_rgba(6,9,36,0.42)] break-words w-full px-1 ${isTightLayout ? 'text-[clamp(24px,5.6vw,42px)] tracking-[0.04em] leading-[0.95]' : isCompressedLayout ? 'text-[clamp(26px,6vw,48px)] tracking-[0.045em] leading-[0.95]' : 'text-[clamp(28px,6.2vw,54px)] tracking-[0.05em] leading-[0.95]'}`;
  const surveyBtnBaseClass = `w-full border border-[rgba(148,134,255,0.35)] bg-white/[0.08] text-white font-bebas text-center cursor-pointer transition-[opacity,background-color,border-color,transform] duration-200 ease-out hover:bg-white/[0.14] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/85 focus-visible:ring-offset-2 focus-visible:ring-offset-[#1c1442] flex items-center justify-center rounded-2xl tracking-[0.08em] shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_12px_30px_rgba(8,6,30,0.32)] disabled:opacity-55 disabled:cursor-not-allowed ${isTightLayout ? 'text-[18px] sm:text-[20px] py-2 min-h-[46px]' : isCompressedLayout ? 'text-[19px] sm:text-[22px] py-2 min-h-[48px]' : 'text-[20px] sm:text-[24px] py-2.5 min-h-[52px]'}`;
  const btnClass = `${surveyBtnBaseClass} font-bold uppercase !border-white/20 !bg-cta-gradient hover:!brightness-105 !shadow-cta`;
  const optionBtnClass = `${surveyBtnBaseClass} uppercase`;
  const optionBtnSelectedClass = '!bg-[rgba(106,67,255,0.42)] !border-[#a78bfa] shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_16px_30px_rgba(54,32,140,0.45),0_0_18px_rgba(106,67,255,0.3)]';
  const resultSecondaryBtnClass = `${optionBtnClass} !w-auto ${isTightLayout ? '!min-h-[44px] !py-1.5 !px-4 sm:!px-5' : isCompressedLayout ? '!min-h-[46px] !py-2 !px-4 sm:!px-5' : '!min-h-[48px] !py-2 !px-5 sm:!px-6'}`;
  const centeredSummaryStackClass = `w-full flex-1 min-h-0 flex flex-col items-center justify-center ${isCompressedLayout ? 'gap-4 sm:gap-5' : 'gap-5 sm:gap-6'}`;
  const centeredSummaryButtonWrapClass = 'w-full max-w-[460px] sm:max-w-[500px] mx-auto';
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
  const canGoBack = stepHistory.length > 0 && !submitting && currentStep !== SURVEY_STEPS.DONE;

  const surveyMatchLabel = (isTeamChallengeSurvey && challengeSurveyName) ? challengeSurveyName : (partido?.nombre || '');

  const renderExitSurveyButton = ({ immediate = false, inline = false } = {}) => {
    if (!immediate && currentStep === SURVEY_STEPS.DONE) {
      return null;
    }

    const button = (
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
        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-transparent text-[28px] leading-none text-white/78 transition-colors duration-150 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 sm:text-[30px]"
      >
        <span className="-mt-[2px]" aria-hidden="true">×</span>
      </button>
    );
    if (inline) return button;

    return (
      <div className={progressActionsClass}>
        {button}
      </div>
    );
  };

  // Busy label for the buttons that save: the tap is acknowledged at once, and nothing
  // says "done" until the answer is stored.
  const renderSaveButtonLabel = (label) => (submitting ? (
    <span className="inline-flex items-center justify-center gap-2">
      <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
      GUARDANDO…
    </span>
  ) : label);

  // Nothing was saved: say so next to the button that retries; the answers stay as chosen.
  const renderSubmitError = () => (submitError ? (
    <p role="alert" className="mt-2 text-center font-oswald text-[14px] leading-snug text-[#ffb3cf]">
      {submitError}
    </p>
  ) : null);

  const surveyStepPlayer = (uuid) => (uuid ? jugadores.find((player) => player.uuid === uuid) || null : null);

  // What was saved, said back on the final screen (only what this path asked).
  const buildSurveyRecap = () => {
    const recap = [];
    const outcome = resolveSurveyOutcome();
    const absentCount = (formData.jugadores_ausentes || []).length;
    if (!outcome.seJugo) {
      recap.push({ label: '¿Se jugó?', value: 'No' });
      if (selectedNotPlayedReason) recap.push({ label: 'Motivo', value: selectedNotPlayedReason.label });
      if (absentCount > 0) recap.push({ label: 'Faltaron', value: `${absentCount} ${absentCount === 1 ? 'jugador' : 'jugadores'}` });
      return recap;
    }
    const homonymHints = buildHomonymHints(jugadores);
    const shownName = (player) => [player.nombre, homonymHints.get(player.uuid)].filter(Boolean).join(' · ');
    const mvpPlayer = surveyStepPlayer(formData.mvp_id);
    if (mvpPlayer) recap.push({ label: 'Mejor jugador', value: shownName(mvpPlayer), player: mvpPlayer });
    const goalkeeper = surveyStepPlayer(formData.arquero_id);
    if (goalkeeper) recap.push({ label: 'Mejor arquero', value: shownName(goalkeeper), player: goalkeeper });
    else if (formData.sin_arquero_fijo) recap.push({ label: 'Mejor arquero', value: 'No hubo' });
    if (absentCount > 0) recap.push({ label: 'Faltaron', value: `${absentCount} ${absentCount === 1 ? 'jugador' : 'jugadores'}` });
    if (mvpPlayer || goalkeeper || formData.sin_arquero_fijo) {
      const dirtyCount = (formData.jugadores_violentos || []).length;
      recap.push({
        label: 'Partido limpio',
        value: formData.partido_limpio || dirtyCount === 0 ? 'Sí' : `No · ${dirtyCount} ${dirtyCount === 1 ? 'marcado' : 'marcados'}`,
      });
    }
    const teamALabel = isTeamChallengeSurvey ? challengeSurveyTeamLabels.teamA : 'Equipo A';
    const teamBLabel = isTeamChallengeSurvey ? challengeSurveyTeamLabels.teamB : 'Equipo B';
    if (formData.ganador === 'equipo_a') recap.push({ label: 'Resultado', value: `Ganó ${teamALabel}` });
    else if (formData.ganador === 'equipo_b') recap.push({ label: 'Resultado', value: `Ganó ${teamBLabel}` });
    else if (formData.ganador === 'empate') recap.push({ label: 'Resultado', value: 'Empate' });
    return recap;
  };

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
              <div className={`${centeredSummaryStackClass} a2-rise`}>
                <div className="w-full">
                  <h1 id="survey-step-title" className={titleClass}>
                    ENCUESTA NO DISPONIBLE
                  </h1>
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
              <div className={`${centeredSummaryStackClass} a2-rise`}>
                <div className="w-full">
                  <h1 id="survey-step-title" className={titleClass}>
                    ENCUESTA CERRADA
                  </h1>
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
            <div className="mx-auto flex h-full w-full max-w-[520px] flex-col overflow-y-auto px-3.5 pb-4">
              <SurveyStepHeader
                matchLabel={surveyMatchLabel}
                stepNumber={progressTotalSteps}
                stepCount={progressTotalSteps}
                isDone
                onClose={() => navigateBackFromSurvey()}
              />
              {submittedNow ? (
                <SurveySavedCelebration
                  justSaved
                  title="¡GRACIAS POR CALIFICAR!"
                  message="Tus respuestas quedaron guardadas."
                  detail={`Los resultados se publicarán en ~${SURVEY_WINDOW_HOURS} horas.`}
                  recap={buildSurveyRecap()}
                  onHome={() => navigate('/')}
                  buttonClassName={btnClass}
                />
              ) : (
                <SurveySavedCelebration
                  title={<>YA COMPLETASTE<br />LA ENCUESTA</>}
                  message="¡Gracias por tu participación!"
                  onHome={() => navigate('/')}
                  buttonClassName={btnClass}
                />
              )}
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
              <div className={`${centeredSummaryStackClass} a2-rise`}>
                <div className="w-full">
                  <h1 id="survey-step-title" className={titleClass}>
                    ENCUESTA NO DISPONIBLE
                  </h1>
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

  const surveyShellClass = 'mx-auto flex h-full w-full max-w-[520px] flex-col px-3.5';
  const stepContentClass = 'flex min-h-0 flex-1 flex-col';
  // Long lists scroll under a soft fade instead of a hard edge above the buttons.
  const scrollAreaClass = 'min-h-0 flex-1 overflow-y-auto overscroll-contain px-0.5 pb-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [mask-image:linear-gradient(to_bottom,#000_calc(100%-32px),transparent)]';
  const secondaryActionClass = `${optionBtnClass} !w-auto shrink-0 !px-5`;
  const questionTopClass = isCompressedLayout ? 'shrink-0 pt-3.5' : 'shrink-0 pt-5';
  const sectionsForGrid = challengeSurveyPlayerSections.length > 0 ? challengeSurveyPlayerSections : null;

  const renderPlayersStep = ({
    icon,
    title,
    hint,
    isSelected,
    onSelect,
    multiple = false,
    selectedPlayers = [],
    emptyLabel,
    actions,
    withError = false,
  }) => (
    <>
      <div className={questionTopClass}>
        <SurveyQuestion icon={icon} title={title} hint={hint} compact />
      </div>
      <div className={`${scrollAreaClass} pt-4`}>
        <SurveyPlayerGrid
          players={jugadores}
          sections={sectionsForGrid}
          isSelected={isSelected}
          onSelect={onSelect}
          multiple={multiple}
        />
      </div>
      <SurveyActionBar
        summary={(
          <SurveySelectionSummary
            players={selectedPlayers}
            emptyLabel={emptyLabel}
            hints={buildHomonymHints(jugadores)}
          />
        )}
        error={withError ? renderSubmitError() : null}
      >
        {actions}
      </SurveyActionBar>
    </>
  );

  const renderStepBody = () => {
    switch (currentStep) {
      case SURVEY_STEPS.PLAYED:
        return (
          <>
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 overflow-y-auto pt-2">
              <SurveyQuestion
                icon={CalendarCheck}
                title="¿SE JUGÓ EL PARTIDO?"
                hint="Son pocos pasos y tu voto define los premios del partido."
                compact={isCompressedLayout}
              >
                {isTeamChallengeSurvey && challengeSurveyName ? (
                  <p className="mt-1 font-oswald text-[15px] text-white/90">Desafío: {challengeSurveyName}</p>
                ) : null}
              </SurveyQuestion>
              <div className="a2-survey-rise surface-card w-full max-w-[420px] px-4 py-3" style={{ animationDelay: '120ms' }}>
                <dl className="flex flex-col gap-2 font-oswald text-[14px] text-white/90">
                  <div className="flex items-center gap-2.5">
                    <dt className="sr-only">Fecha</dt>
                    <CalendarDays size={17} className="shrink-0 text-[#b9a6ff]" aria-hidden="true" />
                    <dd className="first-letter:uppercase">{formatFecha(partido.fecha)}</dd>
                  </div>
                  {partido.hora ? (
                    <div className="flex items-center gap-2.5">
                      <dt className="sr-only">Hora</dt>
                      <Clock3 size={17} className="shrink-0 text-[#b9a6ff]" aria-hidden="true" />
                      <dd>{partido.hora}</dd>
                    </div>
                  ) : null}
                  <div className="flex items-center gap-2.5">
                    <dt className="sr-only">Lugar</dt>
                    <MapPin size={17} className="shrink-0 text-[#b9a6ff]" aria-hidden="true" />
                    <dd className="min-w-0 truncate">{partido.sede ? partido.sede.split(/[,(]/)[0].trim() : 'Sin ubicación'}</dd>
                  </div>
                </dl>
              </div>
              <SurveyImportantDisclaimer variant="survey" className="a2-survey-rise w-full max-w-[420px]" />
            </div>
            <SurveyActionBar>
              <SurveyYesNo
                value={answeredChoices.se_jugo ? (formData.se_jugo ? 'yes' : 'no') : null}
                onYes={() => {
                  markAnswered('se_jugo');
                  handleInputChange('se_jugo', true);
                  handleInputChange('motivo_no_jugado', '');
                  if (formData.ganador === 'no_jugado') {
                    handleInputChange('ganador', '');
                  }
                  goToStep(
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
                onNo={() => {
                  markAnswered('se_jugo');
                  handleInputChange('se_jugo', false);
                  handleInputChange('ganador', 'no_jugado');
                  handleInputChange('motivo_no_jugado', '');
                  handleInputChange('jugadores_ausentes', []);
                  goToStep(SURVEY_STEPS.NOT_PLAYED_REASON);
                }}
              />
            </SurveyActionBar>
          </>
        );

      case SURVEY_STEPS.ATTENDANCE:
        return (
          <>
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center">
              <SurveyQuestion
                icon={UsersRound}
                title="¿ASISTIERON TODOS?"
                hint="Si faltó alguien, lo marcás en el paso siguiente."
                compact={isCompressedLayout}
              />
              <div className="mt-6">
                <SurveyRosterStack players={jugadores} />
              </div>
            </div>
            <SurveyActionBar>
              <SurveyYesNo
                value={answeredChoices.asistieron_todos ? (formData.asistieron_todos ? 'yes' : 'no') : null}
                onYes={() => {
                  markAnswered('asistieron_todos');
                  handleInputChange('asistieron_todos', true);
                  // Coming back to change NO → SÍ: nobody is absent anymore.
                  handleInputChange('jugadores_ausentes', []);
                  goToStep(SURVEY_STEPS.MVP);
                }}
                onNo={() => {
                  markAnswered('asistieron_todos');
                  handleInputChange('asistieron_todos', false);
                  goToStep(SURVEY_STEPS.ABSENTS);
                }}
              />
            </SurveyActionBar>
          </>
        );

      case SURVEY_STEPS.MVP:
        return renderPlayersStep({
          icon: Star,
          title: '¿QUIÉN FUE EL MEJOR JUGADOR?',
          hint: 'Elegí uno. Podés cambiarlo antes de seguir.',
          isSelected: (uuid) => formData.mvp_id === uuid,
          onSelect: (uuid) => handleInputChange('mvp_id', uuid),
          selectedPlayers: [surveyStepPlayer(formData.mvp_id)],
          emptyLabel: 'Tocá a un jugador',
          actions: (
            <button
              type="button"
              className={btnClass}
              onClick={() => goToStep(SURVEY_STEPS.GOALKEEPER)}
              disabled={!formData.mvp_id}
            >
              SIGUIENTE
            </button>
          ),
        });

      case SURVEY_STEPS.GOALKEEPER:
        return renderPlayersStep({
          icon: Hand,
          title: '¿QUIÉN FUE EL MEJOR ARQUERO?',
          hint: 'Elegí uno, o «No hubo» si no hubo arquero fijo.',
          isSelected: (uuid) => formData.arquero_id === uuid,
          onSelect: (uuid) => {
            handleInputChange('arquero_id', uuid);
            handleInputChange('sin_arquero_fijo', false);
          },
          selectedPlayers: [surveyStepPlayer(formData.arquero_id)],
          emptyLabel: 'Tocá a un jugador',
          actions: (
            <>
              <button
                type="button"
                className={`${secondaryActionClass} ${formData.sin_arquero_fijo && !formData.arquero_id ? optionBtnSelectedClass : ''}`}
                onClick={() => {
                  handleInputChange('arquero_id', '');
                  handleInputChange('sin_arquero_fijo', true);
                  goToStep(SURVEY_STEPS.CLEAN_MATCH);
                }}
              >
                NO HUBO
              </button>
              <button
                type="button"
                className={btnClass}
                onClick={() => goToStep(SURVEY_STEPS.CLEAN_MATCH)}
                disabled={!formData.arquero_id && !formData.sin_arquero_fijo}
              >
                SIGUIENTE
              </button>
            </>
          ),
        });

      case SURVEY_STEPS.CLEAN_MATCH:
        return (
          <>
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center">
              <SurveyQuestion
                icon={ShieldCheck}
                title="¿FUE UN PARTIDO LIMPIO?"
                hint="Si respondés NO, marcás quién jugó sucio."
                compact={isCompressedLayout}
              />
            </div>
            <SurveyActionBar>
              <SurveyYesNo
                value={answeredChoices.partido_limpio ? (formData.partido_limpio ? 'yes' : 'no') : null}
                onYes={() => {
                  markAnswered('partido_limpio');
                  handleInputChange('partido_limpio', true);
                  // Coming back to change NO → SÍ: nobody is marked as dirty anymore.
                  handleInputChange('jugadores_violentos', []);
                  goToStep(resolveNextResultGateStep({
                    teamsConfirmed,
                    teamsLocked,
                    forceOrganizeTeamsStep: shouldForceOrganizeTeamsStep,
                    disableOrganizeTeamsStep: shouldDisableTeamReorganization,
                  }));
                }}
                onNo={() => {
                  markAnswered('partido_limpio');
                  handleInputChange('partido_limpio', false);
                  goToStep(SURVEY_STEPS.DIRTY_PLAYERS);
                }}
              />
            </SurveyActionBar>
          </>
        );

      case SURVEY_STEPS.RESULT:
        return (
          <>
            <div className={`${scrollAreaClass} pt-2`}>
              <SurveyQuestion
                icon={Trophy}
                title="¿QUIÉN GANÓ?"
                hint={finalTeams.teamA.length > 0 && finalTeams.teamB.length > 0
                  ? 'Tocá el equipo que ganó o marcá empate.'
                  : 'Marcá el resultado del partido.'}
                compact
              >
                {!isTeamChallengeSurvey ? (
                  <p className="mt-1 max-w-[34ch] font-oswald text-[12.5px] leading-snug text-white/58">{teamsContextLabel}</p>
                ) : null}
              </SurveyQuestion>
              <div className="mt-4 w-full">
                {finalTeams.teamA.length > 0 && finalTeams.teamB.length > 0 ? (
                  <TeamsDnDEditor
                    teamA={finalTeams.teamA}
                    teamB={finalTeams.teamB}
                    playersByKey={playersByKey}
                    teamALabel={isTeamChallengeSurvey ? challengeSurveyTeamLabels.teamA : 'Equipo A'}
                    teamBLabel={isTeamChallengeSurvey ? challengeSurveyTeamLabels.teamB : 'Equipo B'}
                    selectedWinner={formData.ganador}
                    onWinnerChange={(winner) => {
                      surveyHaptic('light');
                      handleInputChange('ganador', winner);
                      handleInputChange('se_jugo', true);
                      closeSurveyModal();
                    }}
                    allowWinnerSelectionWhenDisabled={finalTeamsValidation.ok}
                    disabled={true}
                    onChange={() => {}}
                  />
                ) : null}
                <div className="mt-4 flex items-center justify-center">
                  <button
                    type="button"
                    aria-pressed={formData.ganador === 'empate'}
                    className={`${resultSecondaryBtnClass} ${formData.ganador === 'empate' ? `${optionBtnSelectedClass} a2-survey-pop` : ''}`}
                    onClick={() => {
                      surveyHaptic('light');
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
            <SurveyActionBar error={renderSubmitError()}>
              <button
                type="button"
                className={btnClass}
                onClick={handleSubmit}
                disabled={submitting || encuestaFinalizada || !formData.ganador}
                aria-busy={submitting}
              >
                {renderSaveButtonLabel('FINALIZAR ENCUESTA')}
              </button>
            </SurveyActionBar>
          </>
        );

      case SURVEY_STEPS.DIRTY_PLAYERS:
        return renderPlayersStep({
          icon: TriangleAlert,
          title: '¿QUIÉN JUGÓ SUCIO?',
          hint: 'Podés marcar más de uno.',
          isSelected: (uuid) => formData.jugadores_violentos.includes(uuid),
          onSelect: (uuid) => toggleJugadorViolento(uuid),
          multiple: true,
          selectedPlayers: formData.jugadores_violentos.map(surveyStepPlayer),
          emptyLabel: 'Marcá a uno o más jugadores',
          actions: (
            <button
              type="button"
              className={btnClass}
              onClick={() => {
                goToStep(resolveNextResultGateStep({
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
          ),
        });

      case SURVEY_STEPS.ORGANIZE_TEAMS:
        return (
          <>
            <div className={`${scrollAreaClass} pt-2`}>
              <SurveyQuestion
                icon={shouldShowWinnerSelectionInOrganizeStep ? Trophy : Shuffle}
                title={shouldShowWinnerSelectionInOrganizeStep ? '¿Quién ganó el partido?' : 'ARMÁ LOS EQUIPOS COMO FINALMENTE SE JUGÓ'}
                hint={shouldShowWinnerSelectionInOrganizeStep ? friendlyOrganizeAndResultHelperText : organizeTeamsHelperText}
                compact
              />
              <div className="mt-4 w-full">
                <TeamsDnDEditor
                  teamA={finalTeams.teamA}
                  teamB={finalTeams.teamB}
                  playersByKey={playersByKey}
                  teamALabel={isTeamChallengeSurvey ? challengeSurveyTeamLabels.teamA : 'Equipo A'}
                  teamBLabel={isTeamChallengeSurvey ? challengeSurveyTeamLabels.teamB : 'Equipo B'}
                  selectedWinner={shouldShowWinnerSelectionInOrganizeStep ? formData.ganador : ''}
                  onWinnerChange={(winner) => {
                    if (!shouldShowWinnerSelectionInOrganizeStep) return;
                    surveyHaptic('light');
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
                  <div className="mt-4 flex items-center justify-center">
                    <button
                      type="button"
                      aria-pressed={formData.ganador === 'empate'}
                      className={`${resultSecondaryBtnClass} !min-w-[170px] ${formData.ganador === 'empate' ? `${optionBtnSelectedClass} a2-survey-pop` : ''}`}
                      onClick={() => {
                        surveyHaptic('light');
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
            <SurveyActionBar error={renderSubmitError()}>
              <button
                type="button"
                className={btnClass}
                onClick={handleLockTeamsAndContinue}
                aria-busy={submitting}
                disabled={
                  submitting
                  || encuestaFinalizada
                  || (shouldShowWinnerSelectionInOrganizeStep && !['equipo_a', 'equipo_b', 'empate'].includes(formData.ganador))
                }
              >
                {renderSaveButtonLabel(shouldShowWinnerSelectionInOrganizeStep ? 'FINALIZAR ENCUESTA' : 'CONTINUAR')}
              </button>
            </SurveyActionBar>
          </>
        );

      case SURVEY_STEPS.NOT_PLAYED_REASON:
        return (
          <>
            <div className={`${scrollAreaClass} pt-4`}>
              <SurveyQuestion
                icon={CircleHelp}
                title="¿QUÉ PASÓ?"
                hint="Elegí el motivo para cerrar la encuesta."
                compact
              />
              <div className="mt-5 flex w-full flex-col gap-2.5" role="radiogroup" aria-labelledby="survey-step-title">
                {NOT_PLAYED_REASON_OPTIONS.map((option, index) => {
                  const isSelected = selectedNotPlayedReason?.value === option.value;
                  const OptionIcon = NOT_PLAYED_REASON_ICONS[option.value] || CircleHelp;
                  return (
                    <div key={option.value} className="a2-survey-rise" style={{ animationDelay: `${80 + (index * 60)}ms` }}>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={isSelected}
                        className={`flex w-full items-center gap-3.5 rounded-[20px] border px-4 py-4 text-left transition-[transform,background-color,border-color,box-shadow] duration-200 ease-out active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/85 ${
                          isSelected
                            ? 'a2-survey-pop border-[#b9a6ff] bg-[rgba(106,67,255,0.34)] shadow-[0_0_0_1px_rgba(185,166,255,0.6),0_14px_30px_rgba(54,32,140,0.45)]'
                            : 'border-[rgba(148,134,255,0.24)] bg-surface-gradient shadow-elev-1'
                        }`}
                        onClick={() => {
                          surveyHaptic('light');
                          handleNotPlayedReasonSelect(option.value);
                        }}
                      >
                        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] border ${isSelected ? 'border-white/40 bg-white/20' : 'border-white/12 bg-white/[0.06]'}`} aria-hidden="true">
                          <OptionIcon size={22} strokeWidth={2.2} className="text-white" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-bebas text-[22px] leading-none tracking-[0.05em] text-white">{option.label}</span>
                          <span className={`mt-1 block font-oswald text-[13px] leading-snug ${isSelected ? 'text-white/90' : 'text-white/64'}`}>{option.description}</span>
                        </span>
                        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${isSelected ? 'border-accent bg-accent' : 'border-white/30'}`} aria-hidden="true">
                          {isSelected ? <Check size={14} strokeWidth={3.2} className="text-white" /> : null}
                        </span>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
            <SurveyActionBar error={renderSubmitError()}>
              <button
                type="button"
                className={btnClass}
                onClick={handleNotPlayedPrimaryAction}
                disabled={!selectedNotPlayedReason || submitting || encuestaFinalizada}
                aria-busy={submitting}
              >
                {renderSaveButtonLabel(notPlayedPrimaryButtonLabel)}
              </button>
            </SurveyActionBar>
          </>
        );

      case SURVEY_STEPS.NOT_PLAYED_ABSENTS:
        return renderPlayersStep({
          icon: UserX,
          title: '¿QUIÉNES FALTARON?',
          hint: 'Marcá uno o varios ausentes sin aviso. Después de confirmar, la encuesta termina.',
          isSelected: (uuid) => formData.jugadores_ausentes.includes(uuid),
          onSelect: (uuid) => toggleJugadorAusente(uuid),
          multiple: true,
          selectedPlayers: formData.jugadores_ausentes.map(surveyStepPlayer),
          emptyLabel: 'Marcá a quienes faltaron',
          withError: true,
          actions: (
            <button
              type="button"
              className={btnClass}
              onClick={handleSubmit}
              disabled={submitting || encuestaFinalizada || formData.jugadores_ausentes.length === 0}
              aria-busy={submitting}
            >
              {renderSaveButtonLabel('FINALIZAR')}
            </button>
          ),
        });

      case SURVEY_STEPS.ABSENTS:
        return renderPlayersStep({
          icon: UserX,
          title: '¿QUIÉNES FALTARON?',
          hint: 'Podés marcar varios.',
          isSelected: (uuid) => formData.jugadores_ausentes.includes(uuid),
          onSelect: (uuid) => toggleJugadorAusente(uuid),
          multiple: true,
          selectedPlayers: formData.jugadores_ausentes.map(surveyStepPlayer),
          emptyLabel: 'Marcá a quienes faltaron',
          actions: (
            <button
              type="button"
              className={btnClass}
              onClick={() => goToStep(SURVEY_STEPS.MVP)}
              disabled={formData.jugadores_ausentes.length === 0}
            >
              SIGUIENTE
            </button>
          ),
        });

      case SURVEY_STEPS.DONE:
        return (
          <SurveySavedCelebration
            justSaved
            title="¡GRACIAS POR CALIFICAR!"
            message="Tus respuestas quedaron guardadas."
            detail={`Los resultados se publicarán en ~${SURVEY_WINDOW_HOURS} horas.`}
            recap={buildSurveyRecap()}
            onHome={() => navigate('/')}
            buttonClassName={btnClass}
          />
        );

      default:
        return null;
    }
  };

  return (
    <PageTransition>
      <div className="relative h-[100dvh] w-full overflow-hidden">
        <div className="absolute inset-0 overflow-hidden" style={screenBackgroundStyle} />
        <div className="relative z-[1] h-full w-full overflow-hidden" style={safeAreaStyle}>
          <div className={surveyShellClass}>
            <SurveyStepHeader
              matchLabel={surveyMatchLabel}
              stepNumber={progressCurrentStep}
              stepCount={progressTotalSteps}
              isDone={currentStep === SURVEY_STEPS.DONE}
              onBack={canGoBack ? goBack : null}
              onClose={currentStep === SURVEY_STEPS.DONE ? null : () => setExitSurveyModalOpen(true)}
            />
            <div
              key={currentStep}
              className={`${stepContentClass} ${stepDirection === 'back' ? 'a2-survey-step-back' : 'a2-survey-step-forward'}`}
            >
              {renderStepBody()}
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
