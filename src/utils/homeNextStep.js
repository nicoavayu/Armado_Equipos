// Pure logic for the Home "Tu próximo paso" card.
//
// The card surfaces ONE truly actionable step. Instead of re-deriving match
// state, it reuses the already-validated Recent Activity items (buildActivityFeed
// filters completed surveys, closed votings, ineligible rosters, cancelled
// matches, etc.) and applies its own priority + validity rules on top:
//  - results-type actions ("Ver resumen") additionally require the match id to
//    be in the validated results list (real survey_results with enough votes),
//  - payment actions are only built from verified payment rows, never from a
//    notification alone.
// No DB access here: everything is injected so it can be unit-tested.

import { summarizePayments } from './paymentStatus';

export const NEXT_STEP_RESULTS_TYPES = new Set(['survey_results_ready', 'awards_ready']);

// "Faltan lugares" urgency gate. A half-empty roster is information, not an
// action, so it only earns the highlighted card when the user can actually do
// something about it NOW:
//  - the match is today or tomorrow (further out it stays in Recent Activity),
//  - AND the user is the match admin (can invite/complete the roster) OR the
//    roster is nearly complete (anyone sharing the invite can realistically
//    close the gap).
// Items without structured urgency meta (e.g. generic backend notifications)
// never qualify: they keep living in Recent Activity / Mis partidos.
export const FALTA_JUGADORES_MAX_DAY_OFFSET = 1;
export const FALTA_JUGADORES_NEAR_COMPLETE_THRESHOLD = 2;

export const resolveFaltaJugadoresUrgency = (item, { now = new Date() } = {}) => {
  const meta = item?.nextStepMeta;
  if (!meta || typeof meta !== 'object') return null;

  const missing = Number(meta.missingCount);
  if (!Number.isFinite(missing) || missing <= 0) return null;

  const startsAt = meta.startsAtIso ? new Date(meta.startsAtIso) : null;
  if (!startsAt || !Number.isFinite(startsAt.getTime())) return null;

  const nowDate = now instanceof Date ? now : new Date(now);
  if (startsAt.getTime() <= nowDate.getTime()) return null;

  const startOfToday = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate());
  const startOfMatchDay = new Date(startsAt.getFullYear(), startsAt.getMonth(), startsAt.getDate());
  const dayOffset = Math.round((startOfMatchDay.getTime() - startOfToday.getTime()) / (24 * 60 * 60 * 1000));
  if (dayOffset > FALTA_JUGADORES_MAX_DAY_OFFSET) return null;

  const isAdmin = meta.isMatchAdmin === true;
  if (!isAdmin && missing > FALTA_JUGADORES_NEAR_COMPLETE_THRESHOLD) return null;

  return { missing, isAdmin, dayOffset };
};

// Lower number = more urgent. Mirrors the product priority:
// 1) immediate match actions, 2) post-match (survey/payments), 3) results.
const NEXT_STEP_PRIORITY = {
  falta_jugadores: 10,
  call_to_vote: 11,
  match_invite: 12,
  match_join_request: 13,
  challenge_result_survey: 14,
  challenge_result_pending: 14,
  team_invite: 15,
  survey_start: 20,
  payment_player: 24,
  payment_admin: 25,
  survey_results_ready: 30,
  awards_ready: 30,
};

const quoted = (value) => {
  const text = String(value || '').trim();
  return text ? `"${text}"` : '';
};

// "faltan N lugares" / "falta 1 lugar" — the count is part of the card copy.
const missingSpotsLabel = (missing) => (
  missing === 1 ? 'falta 1 lugar' : `faltan ${missing} lugares`
);

const buildFaltaJugadoresCopy = (item, urgency) => {
  const matchLabel = quoted(item?.matchName);
  // The feed subtitle already carries `"Nombre" · hoy 19:30`; the card adds the
  // missing count / implicit action so it always answers "¿qué hago ahora?".
  const context = String(item?.subtitle || '').trim() || matchLabel;

  if (urgency.isAdmin) {
    return {
      title: 'Completá el partido',
      description: context
        ? `${context} · ${missingSpotsLabel(urgency.missing)}`
        : missingSpotsLabel(urgency.missing),
      ctaLabel: 'Invitar',
      icon: 'Users',
    };
  }

  return {
    title: urgency.missing === 1 ? 'Falta 1 para completar' : 'Faltan jugadores',
    description: context
      ? `${context} · compartí la invitación`
      : 'Compartí la invitación para completar el partido',
    ctaLabel: 'Compartir',
    icon: 'Users',
  };
};

const buildCopyForItem = (item, { faltaJugadoresUrgency = null } = {}) => {
  const matchLabel = quoted(item?.matchName);

  switch (item?.type) {
    case 'falta_jugadores':
      if (!faltaJugadoresUrgency) return null;
      return buildFaltaJugadoresCopy(item, faltaJugadoresUrgency);
    case 'call_to_vote':
      return {
        title: 'Faltan votos',
        description: item.subtitle || (matchLabel ? `Votá en ${matchLabel} para armar equipos parejos` : 'Calificá a los jugadores para armar equipos parejos'),
        ctaLabel: 'Ir a votar',
        icon: 'Vote',
      };
    case 'match_invite':
      return {
        title: 'Invitación pendiente',
        description: item.title || (matchLabel ? `Te invitaron a ${matchLabel}` : 'Confirmá tu asistencia'),
        ctaLabel: 'Responder',
        icon: 'CalendarClock',
      };
    case 'match_join_request':
      return {
        title: 'Solicitudes para aprobar',
        description: item.title || (matchLabel ? `Solicitud pendiente para ${matchLabel}` : 'Revisá quién quiere sumarse'),
        ctaLabel: 'Revisar',
        icon: 'UserPlus',
      };
    case 'challenge_result_survey':
    case 'challenge_result_pending':
      return {
        title: 'Cargá el resultado del desafío',
        description: item.subtitle || 'Contanos cómo salió el partido',
        ctaLabel: 'Cargar',
        icon: 'ClipboardList',
      };
    case 'team_invite':
      return {
        title: 'Te invitaron a un equipo',
        description: item.subtitle || item.title || 'Respondé la invitación',
        ctaLabel: 'Responder',
        icon: 'Users',
      };
    case 'survey_start':
      return {
        title: 'Encuesta pendiente',
        description: matchLabel ? `Completá la encuesta de ${matchLabel}` : (item.subtitle || 'Tu voto define premios y promedios'),
        ctaLabel: 'Responder ahora',
        icon: 'ClipboardList',
      };
    case 'survey_results_ready':
    case 'awards_ready':
      return {
        title: 'Resultados listos',
        description: matchLabel ? `Mirá cómo salió ${matchLabel}` : (item.subtitle || 'Premios y resumen del partido'),
        ctaLabel: 'Ver resumen',
        icon: 'Trophy',
      };
    default:
      return null;
  }
};

const toCandidateFromActivityItem = (item, {
  validatedResultsMatchIdSet,
  resultsValidationLoading,
  now,
}) => {
  if (!item || !item.route) return null;
  const priority = NEXT_STEP_PRIORITY[item.type];
  if (priority === undefined) return null;

  if (NEXT_STEP_RESULTS_TYPES.has(item.type)) {
    // Results CTAs must be backed by real, validated results. While the
    // validation is in flight we simply don't offer them (no false CTAs).
    if (resultsValidationLoading) return null;
    const matchKey = item.partidoId !== undefined && item.partidoId !== null
      ? String(item.partidoId)
      : '';
    if (!matchKey || !validatedResultsMatchIdSet.has(matchKey)) return null;
  }

  let faltaJugadoresUrgency = null;
  if (item.type === 'falta_jugadores') {
    faltaJugadoresUrgency = resolveFaltaJugadoresUrgency(item, { now });
    if (!faltaJugadoresUrgency) return null;
  }

  const copy = buildCopyForItem(item, { faltaJugadoresUrgency });
  if (!copy) return null;

  return {
    key: `next-step-${item.type}-${item.partidoId ?? item.id}`,
    type: item.type,
    // Id of the activity item this action was promoted from, so Home can hide
    // that exact row in Recent Activity (the card is the richer version of it).
    sourceActivityId: item.id ?? null,
    partidoId: item.partidoId ?? null,
    route: item.route,
    createdAt: item.createdAt || null,
    priority,
    isResultsAction: NEXT_STEP_RESULTS_TYPES.has(item.type),
    matchName: item.matchName || null,
    ...copy,
  };
};

/**
 * Picks the single most relevant pending action for Home, or null when there
 * is nothing genuinely actionable (in that case the card is not rendered).
 *
 * @param {Object} params
 * @param {Array}  params.activityItems - items from buildActivityFeed (already validated/routed)
 * @param {Array}  params.validatedResultsMatchIds - match ids whose survey results were verified as real
 * @param {boolean} params.resultsValidationLoading - true while results validation is in flight
 * @param {Object|null} params.paymentAction - candidate from buildPaymentsNextStepAction
 */
export const getNextHomeAction = ({
  activityItems = [],
  validatedResultsMatchIds = [],
  resultsValidationLoading = false,
  paymentAction = null,
  now = new Date(),
} = {}) => {
  const validatedResultsMatchIdSet = new Set(
    (Array.isArray(validatedResultsMatchIds) ? validatedResultsMatchIds : [])
      .map((id) => String(id))
      .filter(Boolean),
  );

  const candidates = (Array.isArray(activityItems) ? activityItems : [])
    .map((item) => toCandidateFromActivityItem(item, {
      validatedResultsMatchIdSet,
      resultsValidationLoading,
      now,
    }))
    .filter(Boolean);

  if (paymentAction && paymentAction.route) {
    candidates.push({
      priority: NEXT_STEP_PRIORITY[paymentAction.type] ?? NEXT_STEP_PRIORITY.payment_admin,
      isResultsAction: false,
      createdAt: null,
      ...paymentAction,
    });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    const aTs = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bTs = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return bTs - aTs;
  });

  return candidates[0];
};

const PAYMENT_CANDIDATE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // matches admin post-match window

const resolvePaymentNotificationMatchId = (notification) => {
  const raw = notification?.partido_id
    ?? notification?.data?.match_id
    ?? notification?.data?.matchId
    ?? null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

/**
 * Extracts candidate match ids for payment actions from internal payment
 * notifications. These are only *candidates*: the caller must verify against
 * real payment rows before showing anything.
 *
 * @returns {{ adminMatchIds:number[], playerMatchIds:number[] }}
 */
export const derivePaymentNotificationCandidates = (notifications = [], { now = Date.now() } = {}) => {
  const adminMatchIds = [];
  const playerMatchIds = [];
  const seenAdmin = new Set();
  const seenPlayer = new Set();

  (Array.isArray(notifications) ? notifications : []).forEach((notification) => {
    const type = String(notification?.type || '').trim().toLowerCase();
    if (type !== 'payment_reported' && type !== 'payment_reminder') return;

    const createdTs = notification?.created_at ? new Date(notification.created_at).getTime() : 0;
    if (!createdTs || (now - createdTs) > PAYMENT_CANDIDATE_WINDOW_MS) return;

    const matchId = resolvePaymentNotificationMatchId(notification);
    if (!matchId) return;

    if (type === 'payment_reported' && !seenAdmin.has(matchId)) {
      seenAdmin.add(matchId);
      adminMatchIds.push(matchId);
    }
    if (type === 'payment_reminder' && !seenPlayer.has(matchId)) {
      seenPlayer.add(matchId);
      playerMatchIds.push(matchId);
    }
  });

  return { adminMatchIds, playerMatchIds };
};

/**
 * Builds the payment next-step candidate from VERIFIED payment state.
 * - Admin: a match with reports awaiting confirmation ("Avisó pago").
 * - Player: my own payment still pending.
 * Closed payment rounds never produce an action.
 *
 * @param {Object} params
 * @param {number[]} params.adminMatchIds - candidate matches where I'm admin
 * @param {number[]} params.playerMatchIds - candidate matches where I play
 * @param {Object} params.adminRowsByMatch - { [matchId]: [{status}] } payment rows
 * @param {Object} params.myStatusByMatch - { [matchId]: status } my payment status
 * @param {Object} params.settingsByMatch - { [matchId]: { is_closed } }
 */
export const buildPaymentsNextStepAction = ({
  adminMatchIds = [],
  playerMatchIds = [],
  adminRowsByMatch = {},
  myStatusByMatch = {},
  settingsByMatch = {},
} = {}) => {
  const isClosed = (matchId) => Boolean(settingsByMatch?.[String(matchId)]?.is_closed);

  for (const matchId of adminMatchIds) {
    if (isClosed(matchId)) continue;
    const summary = summarizePayments(adminRowsByMatch?.[String(matchId)] || []);
    if (summary.reported > 0) {
      return {
        key: `next-step-payment-admin-${matchId}`,
        type: 'payment_admin',
        partidoId: matchId,
        route: `/pagos/${matchId}`,
        title: 'Tenés pagos por confirmar',
        description: summary.reported === 1
          ? '1 jugador avisó que pagó'
          : `${summary.reported} jugadores avisaron que pagaron`,
        ctaLabel: 'Ver pagos',
        icon: 'Wallet',
      };
    }
  }

  for (const matchId of playerMatchIds) {
    if (isClosed(matchId)) continue;
    const myStatus = String(myStatusByMatch?.[String(matchId)] || '');
    if (myStatus === 'pending') {
      return {
        key: `next-step-payment-player-${matchId}`,
        type: 'payment_player',
        partidoId: matchId,
        route: `/pagos/${matchId}`,
        title: 'Tenés un pago pendiente',
        description: 'Saldá tu parte del último partido',
        ctaLabel: 'Ver pagos',
        icon: 'Wallet',
      };
    }
  }

  return null;
};

/**
 * Async orchestrator: derives payment candidates from notifications and
 * verifies them against real payment rows before building an action.
 * The supabase client is injected (same pattern as buildActivityFeed) so this
 * module stays import-safe for unit tests.
 *
 * @returns {Promise<Object|null>} candidate for getNextHomeAction's paymentAction
 */
export const resolvePaymentsNextStepAction = async ({
  supabaseClient = null,
  userId = null,
  notifications = [],
  now = Date.now(),
} = {}) => {
  if (!supabaseClient || !userId) return null;

  const { adminMatchIds, playerMatchIds } = derivePaymentNotificationCandidates(notifications, { now });
  if (adminMatchIds.length === 0 && playerMatchIds.length === 0) return null;

  const allIds = [...new Set([...adminMatchIds, ...playerMatchIds])];

  const [adminRowsRes, myRowsRes, settingsRes] = await Promise.all([
    adminMatchIds.length
      ? supabaseClient.from('match_player_payments').select('partido_id, status').in('partido_id', adminMatchIds)
      : Promise.resolve({ data: [] }),
    playerMatchIds.length
      ? supabaseClient.from('match_player_payments').select('partido_id, status').eq('user_id', userId).in('partido_id', playerMatchIds)
      : Promise.resolve({ data: [] }),
    supabaseClient.from('match_payment_settings').select('partido_id, is_closed').in('partido_id', allIds),
  ]);

  if (adminRowsRes?.error) throw adminRowsRes.error;
  if (myRowsRes?.error) throw myRowsRes.error;
  if (settingsRes?.error) throw settingsRes.error;

  const adminRowsByMatch = {};
  (adminRowsRes?.data || []).forEach((row) => {
    const key = String(row?.partido_id ?? '');
    if (!key) return;
    if (!adminRowsByMatch[key]) adminRowsByMatch[key] = [];
    adminRowsByMatch[key].push({ status: row?.status });
  });

  const myStatusByMatch = {};
  (myRowsRes?.data || []).forEach((row) => {
    const key = String(row?.partido_id ?? '');
    if (key) myStatusByMatch[key] = row?.status;
  });

  const settingsByMatch = {};
  (settingsRes?.data || []).forEach((row) => {
    const key = String(row?.partido_id ?? '');
    if (key) settingsByMatch[key] = row;
  });

  return buildPaymentsNextStepAction({
    adminMatchIds,
    playerMatchIds,
    adminRowsByMatch,
    myStatusByMatch,
    settingsByMatch,
  });
};

export default getNextHomeAction;
