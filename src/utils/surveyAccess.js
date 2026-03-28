import { SURVEY_START_DELAY_MS } from '../config/surveyConfig';
import { resolveChallengeSurveyEligibleUsers } from '../services/surveyEligibilityService';
import {
  resolveEffectiveSurveyWindow,
  resolveKickoffAtFromMatch,
} from './surveyWindow';

const normalizeIdentityToken = (value) => String(value || '').trim().toLowerCase();
const normalizeSurveyStatusToken = (value) => {
  const token = normalizeIdentityToken(value);
  if (!token) return null;
  if (token === 'closed' || token === 'cerrada') return 'closed';
  if (token === 'open' || token === 'abierta') return 'open';
  return token;
};

const normalizeResultStatusToken = (value) => {
  const token = normalizeIdentityToken(value);
  if (!token) return null;
  if (token === 'finished' || token === 'played') return 'finished';
  if (token === 'draw' || token === 'empate') return 'draw';
  if (token === 'not_played' || token === 'cancelled' || token === 'cancelado' || token === 'no_jugado') return 'not_played';
  if (token === 'pending' || token === 'pendiente') return 'pending';
  return token;
};

const toTimestamp = (value) => {
  const parsed = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

const toReadableMatchDate = (startAt) => {
  if (!(startAt instanceof Date) || Number.isNaN(startAt.getTime())) return null;
  return startAt.toLocaleString('es-AR', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Argentina/Buenos_Aires',
  });
};

const resolveMatchStartAt = ({ partidoRow, teamMatchRow }) => {
  return resolveKickoffAtFromMatch({
    fecha: partidoRow?.fecha || null,
    hora: partidoRow?.hora || null,
    scheduledAt: teamMatchRow?.scheduled_at || null,
  });
};

export const resolveSurveyLifecycleBlock = ({
  partidoRow = null,
  surveyOpenedAt = null,
  surveyClosesAt = null,
  matchStartAt = null,
  now = Date.now(),
} = {}) => {
  const estado = normalizeIdentityToken(partidoRow?.estado);
  const surveyStatus = normalizeSurveyStatusToken(partidoRow?.survey_status);
  const resultStatus = normalizeResultStatusToken(partidoRow?.result_status);
  const openedAtMs = toTimestamp(surveyOpenedAt || partidoRow?.survey_opened_at);
  const closesAtMs = toTimestamp(surveyClosesAt || partidoRow?.survey_closes_at);
  const matchStartMs = toTimestamp(matchStartAt);
  const earliestValidCloseAtMs = openedAtMs !== null
    ? openedAtMs
    : (matchStartMs !== null ? matchStartMs + SURVEY_START_DELAY_MS : null);
  const hasStaleDeadline = closesAtMs !== null
    && earliestValidCloseAtMs !== null
    && closesAtMs <= earliestValidCloseAtMs;
  const deadlineReached = closesAtMs !== null && !hasStaleDeadline && now >= closesAtMs;
  const isMatchUnavailable = ['cancelado', 'cancelled', 'deleted'].includes(estado);
  const hasClosedResult = resultStatus === 'finished' || resultStatus === 'draw' || resultStatus === 'not_played';

  if (isMatchUnavailable) {
    return {
      blocked: true,
      title: 'Encuesta no disponible',
      message: 'Este partido ya no está disponible.',
      reason: 'match_unavailable',
    };
  }

  if (surveyStatus === 'closed' || hasClosedResult || deadlineReached) {
    return {
      blocked: true,
      title: 'Encuesta finalizada',
      message: 'Esta encuesta ya cerró y no acepta más respuestas.',
      reason: 'survey_closed',
    };
  }

  return {
    blocked: false,
    title: '',
    message: '',
    reason: 'ok',
  };
};

export const resolveSurveyAccess = async ({ supabaseClient, matchId, userId }) => {
  const matchIdNum = Number(matchId);
  if (!supabaseClient || !Number.isFinite(matchIdNum) || matchIdNum <= 0 || !userId) {
    return {
      allowed: false,
      title: 'Encuesta no disponible',
      message: 'No se pudo validar esta encuesta en este momento.',
      reason: 'invalid_params',
    };
  }

  try {
    let partidoRow = null;
    try {
      const { data } = await supabaseClient
        .from('partidos')
        .select('id, fecha, hora, estado, survey_status, survey_opened_at, survey_closes_at, result_status, finished_at, survey_team_a, survey_team_b, final_team_a, final_team_b')
        .eq('id', matchIdNum)
        .maybeSingle();
      partidoRow = data || null;
    } catch (_partidoError) {
      partidoRow = null;
    }

    try {
      const { data } = await supabaseClient
        .from('partidos')
        .select('equipos_json, equipos')
        .eq('id', matchIdNum)
        .maybeSingle();
      if (data) {
        partidoRow = { ...(partidoRow || {}), ...data };
      }
    } catch (_partidoRosterError) {
      // Non-blocking fallback.
    }

    let teamMatchRow = null;
    try {
      const { data } = await supabaseClient
        .from('team_matches')
        .select('id, team_a_id, team_b_id, challenge_id, origin_type, scheduled_at')
        .eq('partido_id', matchIdNum)
        .maybeSingle();
      teamMatchRow = data || null;
    } catch (_teamMatchError) {
      teamMatchRow = null;
    }

    const matchStartAt = resolveMatchStartAt({ partidoRow, teamMatchRow });
    const surveyWindow = resolveEffectiveSurveyWindow({
      surveyOpenedAt: partidoRow?.survey_opened_at || null,
      surveyClosesAt: partidoRow?.survey_closes_at || null,
      fecha: partidoRow?.fecha || null,
      hora: partidoRow?.hora || null,
      scheduledAt: teamMatchRow?.scheduled_at || null,
    });

    const lifecycleBlock = resolveSurveyLifecycleBlock({
      partidoRow,
      surveyOpenedAt: surveyWindow.openedAtIso,
      surveyClosesAt: surveyWindow.closesAtIso,
      matchStartAt,
      now: Date.now(),
    });
    if (lifecycleBlock.blocked) {
      return {
        allowed: false,
        title: lifecycleBlock.title,
        message: lifecycleBlock.message,
        reason: lifecycleBlock.reason,
      };
    }

    const surveyOpensAtMs = toTimestamp(surveyWindow.openedAtIso);
    if (surveyOpensAtMs !== null && Date.now() < surveyOpensAtMs) {
      const readableStart = toReadableMatchDate(matchStartAt);
      return {
        allowed: false,
        title: 'Encuesta no disponible',
        message: readableStart
          ? `La encuesta se habilita al finalizar el partido. Está programado para ${readableStart}.`
          : 'La encuesta se habilita al finalizar el partido.',
        reason: 'survey_not_open_yet',
      };
    }

    let rosterRows = [];
    try {
      const { data, error: rosterError } = await supabaseClient
        .from('jugadores')
        .select('id, usuario_id, uuid, nombre, is_substitute')
        .eq('partido_id', matchIdNum);

      if (rosterError) throw rosterError;
      rosterRows = Array.isArray(data) ? data : [];
    } catch (_rosterError) {
      rosterRows = [];
    }

    let confirmationRow = null;
    try {
      const { data } = await supabaseClient
        .from('partido_team_confirmations')
        .select('participants, team_a, team_b, teams_json')
        .eq('partido_id', matchIdNum)
        .maybeSingle();
      confirmationRow = data || null;
    } catch (_confirmationError) {
      confirmationRow = null;
    }

    const eligibility = await resolveChallengeSurveyEligibleUsers({
      matchId: teamMatchRow?.id || null,
      rosterRows,
      teamMatchRow,
      matchRow: partidoRow,
      confirmationRow,
    });
    const eligibleUserIds = eligibility?.eligibleUserIds || new Set();

    if (eligibleUserIds.size === 0) {
      return {
        allowed: false,
        title: 'Encuesta no disponible',
        message: 'Este partido se jugó sin jugadores con cuenta registrada, por eso no se generaron datos para la encuesta.',
        reason: 'no_logged_players',
      };
    }

    if (!eligibleUserIds.has(String(userId))) {
      return {
        allowed: false,
        title: 'Encuesta no disponible',
        message: 'Esta encuesta solo está disponible para jugadores con cuenta registrada que participaron de este partido.',
        reason: 'user_not_participant',
      };
    }

    return {
      allowed: true,
      title: '',
      message: '',
      reason: 'ok',
    };
  } catch (_error) {
    return {
      allowed: false,
      title: 'Encuesta no disponible',
      message: 'No se pudo validar esta encuesta en este momento.',
      reason: 'query_error',
    };
  }
};
