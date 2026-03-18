import { SURVEY_START_DELAY_MS } from '../config/surveyConfig';
import { listTeamMatchMembers } from '../services/db/teamChallenges';
import { parseLocalDateTime } from './dateLocal';

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
  const localStart = parseLocalDateTime(partidoRow?.fecha || null, partidoRow?.hora || null);
  if (localStart && !Number.isNaN(localStart.getTime())) return localStart;

  const scheduledAt = teamMatchRow?.scheduled_at || null;
  if (!scheduledAt) return null;

  const parsedScheduled = new Date(scheduledAt);
  if (Number.isNaN(parsedScheduled.getTime())) return null;
  return parsedScheduled;
};

const isChallengeLikeTeamMatch = (teamMatchRow) => {
  if (!teamMatchRow) return false;
  const originType = normalizeIdentityToken(teamMatchRow?.origin_type);
  return originType === 'challenge' || Boolean(teamMatchRow?.challenge_id);
};

export const resolveSurveyLifecycleBlock = ({ partidoRow = null, matchStartAt = null, now = Date.now() } = {}) => {
  const estado = normalizeIdentityToken(partidoRow?.estado);
  const surveyStatus = normalizeSurveyStatusToken(partidoRow?.survey_status);
  const resultStatus = normalizeResultStatusToken(partidoRow?.result_status);
  const closesAtMs = toTimestamp(partidoRow?.survey_closes_at);
  const matchStartMs = toTimestamp(matchStartAt);
  const earliestValidCloseAtMs = matchStartMs !== null ? matchStartMs + SURVEY_START_DELAY_MS : null;
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
        .select('id, fecha, hora, estado, survey_status, survey_closes_at, result_status, finished_at')
        .eq('id', matchIdNum)
        .maybeSingle();
      partidoRow = data || null;
    } catch (_partidoError) {
      partidoRow = null;
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

    const lifecycleBlock = resolveSurveyLifecycleBlock({
      partidoRow,
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

    if (matchStartAt) {
      const surveyOpenAtMs = matchStartAt.getTime() + SURVEY_START_DELAY_MS;
      if (Date.now() < surveyOpenAtMs) {
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
    }

    const eligibleUserIds = new Set();

    try {
      const { data: rosterRows, error: rosterError } = await supabaseClient
        .from('jugadores')
        .select('usuario_id')
        .eq('partido_id', matchIdNum)
        .not('usuario_id', 'is', null);

      if (rosterError) throw rosterError;
      (rosterRows || []).forEach((row) => {
        const token = String(row?.usuario_id || '').trim();
        if (token) eligibleUserIds.add(token);
      });
    } catch (_rosterError) {
      // Non-blocking fallback: we still try to validate via team match members.
    }

    if (
      isChallengeLikeTeamMatch(teamMatchRow)
      && teamMatchRow?.id
      && teamMatchRow?.team_a_id
      && teamMatchRow?.team_b_id
    ) {
      try {
        const membersByTeamId = await listTeamMatchMembers({
          matchId: teamMatchRow.id,
          teamIds: [teamMatchRow.team_a_id, teamMatchRow.team_b_id],
        });
        Object.values(membersByTeamId || {}).forEach((members) => {
          (members || []).forEach((member) => {
            const token = String(member?.user_id || member?.jugador?.usuario_id || '').trim();
            if (token) eligibleUserIds.add(token);
          });
        });
      } catch (_membersError) {
        // Non-blocking fallback to jugadores-based eligibility.
      }
    }

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
