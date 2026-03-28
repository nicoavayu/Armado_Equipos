import { supabase } from '../../lib/supabaseClient';

const ABSENCE_CONFIRMATION_THRESHOLD = 2;
const NO_SHOW_PENALTY_AMOUNT = -0.5;
const NO_SHOW_RECOVERY_STEP = 0.2;
const NO_SHOW_PENALTY_NOTIFICATION_TYPE = 'no_show_penalty_applied';
const NO_SHOW_RECOVERY_NOTIFICATION_TYPE = 'no_show_recovery_applied';

const runRpcOrThrow = async (fnName, params) => {
  const { error } = await supabase.rpc(fnName, params);
  if (error) throw error;
};

const formatRankingAmount = (value) => {
  const num = Math.abs(Number(value || 0));
  if (!Number.isFinite(num)) return '0';
  return num.toLocaleString('es-AR', {
    minimumFractionDigits: Number.isInteger(num) ? 0 : 1,
    maximumFractionDigits: 2,
  });
};

const dedupeUserIds = (values = []) => (
  [...new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean))]
);

const resolveMatchName = async (matchId) => {
  try {
    const { data, error } = await supabase
      .from('partidos')
      .select('nombre')
      .eq('id', matchId)
      .maybeSingle();

    if (error) throw error;

    const parsed = String(data?.nombre || '').trim();
    if (parsed) return parsed;
  } catch (_error) {
    // Fallback to generic label when metadata fetch fails.
  }

  return `partido ${matchId}`;
};

const insertPrivateRankingNotification = async ({
  userId,
  type,
  title,
  message,
  matchName,
  amount,
}) => {
  if (!userId) return;

  const payload = {
    user_id: userId,
    type,
    title,
    message,
    data: {
      match_name: matchName,
      ranking_delta: amount,
    },
    read: false,
    created_at: new Date().toISOString(),
  };

  const { error } = await supabase.from('notifications').insert([payload]);
  if (error) {
    throw error;
  }
};

const toPlayerIdNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeNoShowReasonToken = (value) => String(value || '').trim().toLowerCase();

const isAbsenceWithoutNoticeReason = (value) => (
  ['absence_without_notice', 'ausencia_sin_aviso'].includes(normalizeNoShowReasonToken(value))
);

const isSurveyEligibleForNoShowProcessing = (survey) => (
  survey?.se_jugo === true
  || (survey?.se_jugo === false && isAbsenceWithoutNoticeReason(survey?.motivo_no_jugado))
);

const isMatchEligibleForNoShowProcessing = (surveys = []) => (
  (surveys || []).some((survey) => isSurveyEligibleForNoShowProcessing(survey))
);

const buildAbsentConfirmMap = (surveys = []) => {
  const confirmMap = new Map();

  for (const survey of (surveys || [])) {
    if (!isSurveyEligibleForNoShowProcessing(survey)) continue;

    const voterId = survey?.votante_id;
    const absents = Array.isArray(survey?.jugadores_ausentes) ? survey.jugadores_ausentes : [];
    if (!voterId || absents.length === 0) continue;

    for (const absentRaw of absents) {
      const absentId = toPlayerIdNumber(absentRaw);
      if (!absentId) continue;
      if (String(voterId) === String(absentRaw) || String(voterId) === String(absentId)) continue;

      const votersSet = confirmMap.get(absentId) || new Set();
      votersSet.add(String(voterId));
      confirmMap.set(absentId, votersSet);
    }
  }

  return confirmMap;
};

const upsertRecoveryStreak = async (userId, streak) => {
  return supabase
    .from('no_show_recovery_state')
    .upsert(
      {
        user_id: userId,
        current_streak: Number(streak) || 0,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );
};

/**
 * Get match players for penalty calculation
 * @param {number} partidoId - Match ID
 * @returns {Promise<{data, error}>} Players data
 */
const _getMatchPlayers = async (partidoId) => {
  const { data, error } = await supabase
    .from('partidos_jugadores')
    .select('jugador_id')
    .eq('partido_id', partidoId);

  if (error) throw error;
  return data?.map((p) => p.jugador_id) ?? [];
};

/**
 * Apply no-show penalties to registered players only
 * @param {number} matchId - Match ID
 * @returns {Promise<{data, error}>} Result with penalized players
 */
export async function applyNoShowPenalties(matchId, options = {}) {
  const id = Number(matchId);
  const matchName = await resolveMatchName(id);
  const emitNotifications = options.emitNotifications !== false;
  // 1) read surveys for this match
  const { data: surveys, error: surveysErr } = await supabase
    .from('post_match_surveys')
    .select('votante_id, se_jugo, motivo_no_jugado, jugadores_ausentes')
    .eq('partido_id', id);
  if (surveysErr) return { data: [], error: surveysErr };
  if (!surveys || surveys.length === 0) return { data: [], error: null };
  if (!isMatchEligibleForNoShowProcessing(surveys)) return { data: [], error: null };

  // 2) build confirm map: absentPlayerId -> Set of distinct votante_ids
  const confirmMap = buildAbsentConfirmMap(surveys);

  // 3) select players that reached threshold (>=2)
  const toPenalizePlayerIds = Array.from(confirmMap.entries())
    .filter(([, votersSet]) => votersSet.size >= ABSENCE_CONFIRMATION_THRESHOLD)
    .map(([playerId]) => Number(playerId))
    .filter((playerId) => Number.isFinite(playerId));
  if (!toPenalizePlayerIds.length) return { data: [], error: null };

  // 4) fetch jugadores to map player_id -> usuario_id
  const { data: jugadoresRows, error: jugadoresErr } = await supabase
    .from('jugadores')
    .select('id, usuario_id')
    .in('id', toPenalizePlayerIds);
  if (jugadoresErr) return { data: [], error: jugadoresErr };

  const playerIdToUsuario = new Map();
  jugadoresRows?.forEach((r) => { if (r.usuario_id) playerIdToUsuario.set(Number(r.id), r.usuario_id); });

  // 5) prepare adjustments for insertion with usuario_id
  const adjustments = toPenalizePlayerIds.map((pid) => {
    const uid = playerIdToUsuario.get(pid);
    return uid ? {
      user_id: uid,
      partido_id: id,
      type: 'no_show_penalty',
      amount: NO_SHOW_PENALTY_AMOUNT,
      meta: {
        reason: 'absence_without_notice',
        confirmations: Array.from(confirmMap.get(pid) || []),
        confirmation_count: (confirmMap.get(pid) || new Set()).size,
      },
      created_at: new Date().toISOString(),
    } : null;
  }).filter(Boolean);

  if (!adjustments.length) return { data: [], error: null };

  // 6) find already applied adjustments for these users
  const userIds = adjustments.map((a) => a.user_id);
  const { data: existing, error: existingErr } = await supabase
    .from('rating_adjustments')
    .select('user_id')
    .eq('partido_id', id)
    .in('user_id', userIds)
    .eq('type', 'no_show_penalty');
  if (existingErr) return { data: [], error: existingErr };

  const alreadyAppliedSet = new Set((existing || []).map((r) => r.user_id));

  const toInsert = adjustments.filter((a) => !alreadyAppliedSet.has(a.user_id));
  const appliedUserIds = [];

  if (toInsert.length) {
    const { data: insertRes, error: insertErr } = await supabase
      .from('rating_adjustments')
      .insert(toInsert)
      .select('user_id');
    if (insertErr) return { data: [], error: insertErr };
    // collect applied user_ids from insertRes
    (insertRes || []).forEach((r) => appliedUserIds.push(r.user_id));
  }

  // 7) apply ranking decrement only for newly applied adjustments
  const table = 'usuarios';
  const rankingDelta = Math.abs(NO_SHOW_PENALTY_AMOUNT);
  await Promise.allSettled((appliedUserIds || []).map(async (uid) => {
    try {
      await runRpcOrThrow('dec_numeric', {
        p_table: table,
        p_column: 'ranking',
        p_id: uid,
        p_amount: rankingDelta,
      });
      console.log('[NO_SHOW_PENALTY] applied', { partidoId: id, userId: uid });
    } catch (rpcError) {
      try {
        const { data: curr } = await supabase.from(table).select('ranking').eq('id', uid).single();
        const newVal = Number(curr?.ranking ?? 0) - rankingDelta;
        await supabase.from(table).update({ ranking: newVal }).eq('id', uid);
        console.log('[NO_SHOW_PENALTY] applied', { partidoId: id, userId: uid });
      } catch (updateErr) {
        console.error('[NO_SHOW_PENALTY] failed to apply ranking for', uid, updateErr);
      }
    }
    // Also increment partidos_abandonados on usuarios for this user (only when penalty was newly applied)
    try {
      // Try RPC to increment numeric column on usuarios
      await runRpcOrThrow('inc_numeric', {
        p_table: 'usuarios',
        p_column: 'partidos_abandonados',
        p_id: uid,
        p_amount: 1,
      });
      console.log('[NO_SHOW_PENALTY] incremented partidos_abandonados', { partidoId: id, userId: uid });
    } catch (incRpcErr) {
      try {
        // Fallback: read current value and update
        const { data: currU } = await supabase.from('usuarios').select('partidos_abandonados').eq('id', uid).single();
        const newValU = (currU?.partidos_abandonados ?? 0) + 1;
        await supabase.from('usuarios').update({ partidos_abandonados: newValU }).eq('id', uid);
        console.log('[NO_SHOW_PENALTY] incremented partidos_abandonados', { partidoId: id, userId: uid });
      } catch (incErr) {
        console.error('[NO_SHOW_PENALTY] failed to increment partidos_abandonados for', uid, incErr);
      }
    }

    if (emitNotifications) {
      try {
        await insertPrivateRankingNotification({
          userId: uid,
          type: NO_SHOW_PENALTY_NOTIFICATION_TYPE,
          title: 'Perdiste ranking por inasistencia',
          message: `Perdiste ${formatRankingAmount(rankingDelta)} puntos de ranking por faltar al partido "${matchName}".`,
          matchName,
          amount: -rankingDelta,
        });
      } catch (notificationErr) {
        console.error('[NO_SHOW_PENALTY] failed to insert private notification for', uid, notificationErr);
      }
    }
  }));

  // 8) log skips for users already applied
  (adjustments || []).forEach((a) => {
    if (alreadyAppliedSet.has(a.user_id)) {
      console.log('[NO_SHOW_PENALTY] skipped (already applied)', { partidoId: id, userId: a.user_id });
    }
  });

  return { data: appliedUserIds, error: null };
}

/**
 * Apply no-show recoveries for players who attended the match
 * @param {number} matchId - Match ID
 * @returns {Promise<{data, error}>} Result with recovered players
 */
export async function applyNoShowRecoveries(matchId, options = {}) {
  const id = Number(matchId);
  const matchName = await resolveMatchName(id);
  const emitNotifications = options.emitNotifications !== false;

  // 1) get all survey rows to derive played flag and confirmed absences
  const { data: surveyRows, error: surveyErr } = await supabase
    .from('post_match_surveys')
    .select('votante_id, se_jugo, motivo_no_jugado, jugadores_ausentes')
    .eq('partido_id', id);
  if (surveyErr) {
    return { data: [], error: surveyErr };
  }
  if (!surveyRows || surveyRows.length === 0) return { data: [], error: null };
  if (!isMatchEligibleForNoShowProcessing(surveyRows)) {
    // no action if match not played
    return { data: [], error: null };
  }

  const absentConfirmMap = buildAbsentConfirmMap(surveyRows);
  const absentPlayerIds = new Set(
    Array.from(absentConfirmMap.entries())
      .filter(([, votersSet]) => votersSet.size >= ABSENCE_CONFIRMATION_THRESHOLD)
      .map(([playerId]) => Number(playerId))
      .filter((playerId) => Number.isFinite(playerId)),
  );

  // 2) get players for match
  const { data: jugadores, error: jugadoresErr } = await supabase
    .from('jugadores')
    .select('id, usuario_id')
    .eq('partido_id', id);
  if (jugadoresErr) return { data: [], error: jugadoresErr };

  const applied = [];

  for (const p of (jugadores || [])) {
    const playerId = Number(p.id);
    const userId = p.usuario_id;
    if (!userId) continue;

    // 3) determine asistencia from confirmed absences
    const asistio = !absentPlayerIds.has(playerId);

    if (!asistio) {
      // upsert reset
      const { error: upsertErr } = await upsertRecoveryStreak(userId, 0);
      if (upsertErr) return { data: applied, error: upsertErr };
      console.log('[NO_SHOW_RECOVERY] reset streak', { userId });
      continue;
    }

    // 4) compute outstanding no-show debt for this user
    const { data: adjustmentRows, error: adjustmentErr } = await supabase
      .from('rating_adjustments')
      .select('type, amount')
      .eq('user_id', userId)
      .in('type', ['no_show_penalty', 'no_show_recovery']);
    if (adjustmentErr) return { data: applied, error: adjustmentErr };

    const totalPenalized = (adjustmentRows || [])
      .filter((row) => row.type === 'no_show_penalty')
      .reduce((sum, row) => sum + Math.abs(Number(row.amount || 0)), 0);
    const totalRecovered = (adjustmentRows || [])
      .filter((row) => row.type === 'no_show_recovery')
      .reduce((sum, row) => sum + Math.max(0, Number(row.amount || 0)), 0);
    const remainingDebt = Math.max(0, totalPenalized - totalRecovered);

    if (remainingDebt <= 0) {
      // Avoid accumulating streak for users with no pending penalty debt.
      const { error: resetErr } = await upsertRecoveryStreak(userId, 0);
      if (resetErr) return { data: applied, error: resetErr };
      continue;
    }

    // 5) read existing streak
    const { data: stateRows, error: stateErr } = await supabase
      .from('no_show_recovery_state')
      .select('current_streak')
      .eq('user_id', userId)
      .limit(1);
    if (stateErr) return { data: applied, error: stateErr };

    const existingState = (stateRows && stateRows[0]) || null;
    let newStreak = existingState ? Number(existingState.current_streak || 0) : 0;

    // asistio true and still has debt
    newStreak = newStreak + 1;
    const { error: upsertErr2 } = await upsertRecoveryStreak(userId, newStreak);
    if (upsertErr2) return { data: applied, error: upsertErr2 };

    // 6) if cycle reached (every 3 assists)
    if (newStreak % 3 !== 0) continue;

    const cycleIndex = Math.floor(newStreak / 3);

    // check if adjustment for this match already exists
    const { data: existsRows, error: existsErr } = await supabase
      .from('rating_adjustments')
      .select('id')
      .eq('user_id', userId)
      .eq('partido_id', id)
      .eq('type', 'no_show_recovery')
      .limit(1);
    if (existsErr) return { data: applied, error: existsErr };
    if (existsRows && existsRows.length > 0) {
      console.log('[NO_SHOW_RECOVERY] skipped (already applied)', { partidoId: id, userId });
      continue;
    }

    const recoverAmount = Number(Math.min(NO_SHOW_RECOVERY_STEP, remainingDebt).toFixed(2));
    if (recoverAmount <= 0) continue;

    // attempt insert
    const adjustment = {
      user_id: userId,
      partido_id: id,
      type: 'no_show_recovery',
      amount: recoverAmount,
      meta: { cycle_index: cycleIndex, source_partido_id: id },
      created_at: new Date().toISOString(),
    };

    const { data: insRes, error: insErr } = await supabase
      .from('rating_adjustments')
      .insert([adjustment])
      .select('id');
    if (insErr) return { data: applied, error: insErr };
    if (!insRes || !Array.isArray(insRes) || !insRes[0]) {
      // insertion didn't create a row (possible conflict)
      console.log('[NO_SHOW_RECOVERY] skipped (already applied)', { partidoId: id, userId });
      continue;
    }

    // apply recovery increment to user's ranking
    const table = 'usuarios';
    try {
      await runRpcOrThrow('inc_numeric', {
        p_table: table,
        p_column: 'ranking',
        p_id: userId,
        p_amount: recoverAmount,
      });
    } catch (rpcError) {
      try {
        const { data: curr } = await supabase.from(table).select('ranking').eq('id', userId).single();
        const newVal = Number(curr?.ranking ?? 0) + recoverAmount;
        await supabase.from(table).update({ ranking: newVal }).eq('id', userId);
      } catch (updateErr) {
        console.error('[NO_SHOW_RECOVERY] failed to apply rating increment for', userId, updateErr);
      }
    }

    if (emitNotifications) {
      try {
        await insertPrivateRankingNotification({
          userId,
          type: NO_SHOW_RECOVERY_NOTIFICATION_TYPE,
          title: 'Recuperaste ranking',
          message: `Recuperaste ${formatRankingAmount(recoverAmount)} puntos de ranking por cumplir 3 partidos sin faltar. Último partido contabilizado: "${matchName}".`,
          matchName,
          amount: recoverAmount,
        });
      } catch (notificationErr) {
        console.error('[NO_SHOW_RECOVERY] failed to insert private notification for', userId, notificationErr);
      }
    }

    console.log('[NO_SHOW_RECOVERY] applied', { userId, cycle_index: cycleIndex });
    applied.push(userId);
  }

  return { data: applied, error: null };
}

export async function listMatchNoShowSummary(matchId) {
  const id = Number(matchId);
  if (!Number.isFinite(id) || id <= 0) {
    return { data: [], error: new Error('invalid_match_id') };
  }

  const { data: surveyRows, error: surveyErr } = await supabase
    .from('post_match_surveys')
    .select('votante_id, se_jugo, motivo_no_jugado, jugadores_ausentes')
    .eq('partido_id', id);
  if (surveyErr) return { data: [], error: surveyErr };
  if (!surveyRows || surveyRows.length === 0) return { data: [], error: null };
  if (!isMatchEligibleForNoShowProcessing(surveyRows)) {
    return { data: [], error: null };
  }

  const absentConfirmMap = buildAbsentConfirmMap(surveyRows);
  const confirmedPlayerIds = Array.from(absentConfirmMap.entries())
    .filter(([, votersSet]) => votersSet.size >= ABSENCE_CONFIRMATION_THRESHOLD)
    .map(([playerId]) => Number(playerId))
    .filter((playerId) => Number.isFinite(playerId));
  if (confirmedPlayerIds.length === 0) return { data: [], error: null };

  const { data: jugadoresRows, error: jugadoresErr } = await supabase
    .from('jugadores')
    .select('id, usuario_id')
    .in('id', confirmedPlayerIds);
  if (jugadoresErr) return { data: [], error: jugadoresErr };

  const playerRowsById = new Map(
    (jugadoresRows || [])
      .map((row) => [Number(row?.id), row])
      .filter(([playerId]) => Number.isFinite(playerId)),
  );

  const registeredUserIds = dedupeUserIds(
    (jugadoresRows || []).map((row) => row?.usuario_id).filter(Boolean),
  );

  let adjustmentRows = [];
  if (registeredUserIds.length > 0) {
    const { data, error } = await supabase
      .from('rating_adjustments')
      .select('user_id, type')
      .eq('partido_id', id)
      .in('user_id', registeredUserIds)
      .in('type', ['no_show_penalty', 'no_show_recovery']);
    if (error) return { data: [], error };
    adjustmentRows = data || [];
  }

  const penalizedUserIds = new Set(
    (adjustmentRows || [])
      .filter((row) => row?.type === 'no_show_penalty')
      .map((row) => String(row?.user_id || '').trim())
      .filter(Boolean),
  );
  const recoveredUserIds = new Set(
    (adjustmentRows || [])
      .filter((row) => row?.type === 'no_show_recovery')
      .map((row) => String(row?.user_id || '').trim())
      .filter(Boolean),
  );

  const summary = confirmedPlayerIds.map((playerId) => {
    const playerRow = playerRowsById.get(playerId) || null;
    const userId = String(playerRow?.usuario_id || '').trim() || null;
    const confirmationCount = (absentConfirmMap.get(playerId) || new Set()).size;

    return {
      playerId,
      userId,
      confirmationCount,
      penaltyApplied: Boolean(userId && penalizedUserIds.has(userId)),
      penaltyAmount: Boolean(userId && penalizedUserIds.has(userId)) ? NO_SHOW_PENALTY_AMOUNT : 0,
      recoveryApplied: Boolean(userId && recoveredUserIds.has(userId)),
    };
  });

  summary.sort((left, right) => {
    if (left.penaltyApplied !== right.penaltyApplied) {
      return left.penaltyApplied ? -1 : 1;
    }
    if (left.confirmationCount !== right.confirmationCount) {
      return right.confirmationCount - left.confirmationCount;
    }
    return left.playerId - right.playerId;
  });

  return { data: summary, error: null };
}

const fetchNoShowAdjustmentRowsForUsers = async (userIds) => {
  const ids = dedupeUserIds(userIds);
  if (!ids.length) return { data: [], error: null };

  return supabase
    .from('rating_adjustments')
    .select('user_id, partido_id, type, amount, created_at')
    .in('user_id', ids)
    .in('type', ['no_show_penalty', 'no_show_recovery'])
    .order('created_at', { ascending: true });
};

const fetchRegisteredUserIdsForMatch = async (matchId) => {
  const id = Number(matchId);
  if (!Number.isFinite(id) || id <= 0) return { data: [], error: null };

  const { data, error } = await supabase
    .from('jugadores')
    .select('usuario_id')
    .eq('partido_id', id)
    .not('usuario_id', 'is', null);

  if (error) return { data: [], error };

  return { data: dedupeUserIds((data || []).map((row) => row?.usuario_id)), error: null };
};

const captureNoShowUserAggregateBases = async (userIds) => {
  const ids = dedupeUserIds(userIds);
  const baseMap = new Map();
  if (!ids.length) return { data: baseMap, error: null };

  const [usersRes, adjustmentsRes] = await Promise.all([
    supabase
      .from('usuarios')
      .select('id, ranking, partidos_abandonados')
      .in('id', ids),
    fetchNoShowAdjustmentRowsForUsers(ids),
  ]);

  if (usersRes.error) return { data: baseMap, error: usersRes.error };
  if (adjustmentsRes.error) return { data: baseMap, error: adjustmentsRes.error };

  const summaryByUser = new Map();
  (adjustmentsRes.data || []).forEach((row) => {
    const userId = String(row?.user_id || '').trim();
    if (!userId) return;

    const current = summaryByUser.get(userId) || { delta: 0, penaltyCount: 0 };
    const amount = Number(row?.amount || 0);
    current.delta = Number((current.delta + amount).toFixed(2));
    if (row?.type === 'no_show_penalty') current.penaltyCount += 1;
    summaryByUser.set(userId, current);
  });

  (usersRes.data || []).forEach((row) => {
    const userId = String(row?.id || '').trim();
    if (!userId) return;

    const summary = summaryByUser.get(userId) || { delta: 0, penaltyCount: 0 };
    const currentRanking = Number(row?.ranking ?? 0);
    const currentAbandoned = Number(row?.partidos_abandonados ?? 0);

    baseMap.set(userId, {
      ranking: Number((currentRanking - summary.delta).toFixed(2)),
      partidosAbandonados: Math.max(0, currentAbandoned - summary.penaltyCount),
    });
  });

  return { data: baseMap, error: null };
};

const buildCurrentRecoveryStates = async (userIds, adjustmentRows = []) => {
  const ids = dedupeUserIds(userIds);
  const stateMap = new Map(ids.map((userId) => [userId, { debt: 0, streak: 0 }]));
  if (!ids.length) return { data: stateMap, error: null };

  const { data: playerRows, error: playerErr } = await supabase
    .from('jugadores')
    .select('id, partido_id, usuario_id')
    .in('usuario_id', ids);
  if (playerErr) return { data: stateMap, error: playerErr };

  const partidoIds = [...new Set(
    (playerRows || [])
      .map((row) => Number(row?.partido_id))
      .filter((partidoId) => Number.isFinite(partidoId) && partidoId > 0),
  )];

  if (!partidoIds.length) return { data: stateMap, error: null };

  const [resultsRes, surveysRes] = await Promise.all([
    supabase
      .from('survey_results')
      .select('partido_id, encuesta_cerrada_at, finished_at, created_at, updated_at, results_ready')
      .in('partido_id', partidoIds)
      .eq('results_ready', true),
    supabase
      .from('post_match_surveys')
      .select('partido_id, votante_id, se_jugo, motivo_no_jugado, jugadores_ausentes')
      .in('partido_id', partidoIds),
  ]);

  if (resultsRes.error) return { data: stateMap, error: resultsRes.error };
  if (surveysRes.error) return { data: stateMap, error: surveysRes.error };

  const closedRows = resultsRes.data || [];
  const closedMatchIds = new Set(closedRows.map((row) => Number(row?.partido_id)).filter(Number.isFinite));

  const playersByMatch = new Map();
  (playerRows || []).forEach((row) => {
    const partidoId = Number(row?.partido_id);
    if (!closedMatchIds.has(partidoId)) return;
    const userId = String(row?.usuario_id || '').trim();
    if (!userId) return;

    const current = playersByMatch.get(partidoId) || [];
    current.push({
      playerId: Number(row?.id),
      userId,
    });
    playersByMatch.set(partidoId, current);
  });

  const surveysByMatch = new Map();
  (surveysRes.data || []).forEach((row) => {
    const partidoId = Number(row?.partido_id);
    if (!closedMatchIds.has(partidoId)) return;
    const current = surveysByMatch.get(partidoId) || [];
    current.push(row);
    surveysByMatch.set(partidoId, current);
  });

  const absentUsersByMatch = new Map();
  const eligibleMatchIds = new Set();
  for (const [partidoId, surveys] of surveysByMatch.entries()) {
    if (!isMatchEligibleForNoShowProcessing(surveys)) continue;
    eligibleMatchIds.add(partidoId);

    const confirmedPlayerIds = new Set(
      Array.from(buildAbsentConfirmMap(surveys).entries())
        .filter(([, votersSet]) => votersSet.size >= ABSENCE_CONFIRMATION_THRESHOLD)
        .map(([playerId]) => Number(playerId))
        .filter((playerId) => Number.isFinite(playerId)),
    );

    const absentUsers = new Set();
    (playersByMatch.get(partidoId) || []).forEach((row) => {
      if (confirmedPlayerIds.has(row.playerId)) absentUsers.add(row.userId);
    });
    absentUsersByMatch.set(partidoId, absentUsers);
  }

  const adjustmentsByUserAndMatch = new Map();
  (adjustmentRows || []).forEach((row) => {
    const userId = String(row?.user_id || '').trim();
    const partidoId = Number(row?.partido_id);
    if (!userId || !Number.isFinite(partidoId)) return;

    const byMatch = adjustmentsByUserAndMatch.get(userId) || new Map();
    const current = byMatch.get(partidoId) || { penalty: 0, recovery: 0 };
    const amount = Number(row?.amount || 0);

    if (row?.type === 'no_show_penalty') {
      current.penalty = Number((current.penalty + Math.abs(amount)).toFixed(2));
    }
    if (row?.type === 'no_show_recovery') {
      current.recovery = Number((current.recovery + Math.max(0, amount)).toFixed(2));
    }

    byMatch.set(partidoId, current);
    adjustmentsByUserAndMatch.set(userId, byMatch);
  });

  const orderedClosedMatches = [...closedRows]
    .filter((row) => eligibleMatchIds.has(Number(row?.partido_id)))
    .sort((left, right) => {
    const leftAt = new Date(
      left?.encuesta_cerrada_at
      || left?.finished_at
      || left?.updated_at
      || left?.created_at
      || 0,
    ).getTime();
    const rightAt = new Date(
      right?.encuesta_cerrada_at
      || right?.finished_at
      || right?.updated_at
      || right?.created_at
      || 0,
    ).getTime();

    if (leftAt !== rightAt) return leftAt - rightAt;
    return Number(left?.partido_id || 0) - Number(right?.partido_id || 0);
    });

  orderedClosedMatches.forEach((match) => {
    const partidoId = Number(match?.partido_id);
    const absentUsers = absentUsersByMatch.get(partidoId) || new Set();

    (playersByMatch.get(partidoId) || []).forEach((row) => {
      const current = stateMap.get(row.userId) || { debt: 0, streak: 0 };
      const matchAdjustments = adjustmentsByUserAndMatch.get(row.userId)?.get(partidoId) || { penalty: 0, recovery: 0 };

      if (absentUsers.has(row.userId)) {
        stateMap.set(row.userId, {
          debt: Number((current.debt + matchAdjustments.penalty).toFixed(2)),
          streak: 0,
        });
        return;
      }

      if (current.debt <= 0) {
        stateMap.set(row.userId, {
          debt: Number(Math.max(0, current.debt - matchAdjustments.recovery).toFixed(2)),
          streak: 0,
        });
        return;
      }

      stateMap.set(row.userId, {
        debt: Number(Math.max(0, current.debt - matchAdjustments.recovery).toFixed(2)),
        streak: current.streak + 1,
      });
    });
  });

  return { data: stateMap, error: null };
};

export async function reconcileNoShowUserAggregates(userIds, options = {}) {
  const ids = dedupeUserIds(userIds);
  if (!ids.length) return { data: [], error: null };

  let baseSnapshot = options.baseSnapshot instanceof Map ? options.baseSnapshot : null;
  if (!(baseSnapshot instanceof Map)) {
    const baseRes = await captureNoShowUserAggregateBases(ids);
    if (baseRes.error) return { data: [], error: baseRes.error };
    baseSnapshot = baseRes.data;
  }

  const adjustmentsRes = await fetchNoShowAdjustmentRowsForUsers(ids);
  if (adjustmentsRes.error) return { data: [], error: adjustmentsRes.error };

  const adjustmentsByUser = new Map();
  (adjustmentsRes.data || []).forEach((row) => {
    const userId = String(row?.user_id || '').trim();
    if (!userId) return;

    const current = adjustmentsByUser.get(userId) || { delta: 0, penaltyCount: 0 };
    current.delta = Number((current.delta + Number(row?.amount || 0)).toFixed(2));
    if (row?.type === 'no_show_penalty') current.penaltyCount += 1;
    adjustmentsByUser.set(userId, current);
  });

  const recoveryStatesRes = await buildCurrentRecoveryStates(ids, adjustmentsRes.data || []);
  if (recoveryStatesRes.error) return { data: [], error: recoveryStatesRes.error };

  const touchedUsers = [];

  for (const userId of ids) {
    const base = baseSnapshot.get(userId) || { ranking: 0, partidosAbandonados: 0 };
    const summary = adjustmentsByUser.get(userId) || { delta: 0, penaltyCount: 0 };
    const nextRanking = Number((Number(base.ranking || 0) + Number(summary.delta || 0)).toFixed(2));
    const nextAbandonados = Math.max(0, Number(base.partidosAbandonados || 0) + Number(summary.penaltyCount || 0));

    const { error: updateErr } = await supabase
      .from('usuarios')
      .update({
        ranking: nextRanking,
        partidos_abandonados: nextAbandonados,
      })
      .eq('id', userId);

    if (updateErr) return { data: touchedUsers, error: updateErr };
    touchedUsers.push(userId);
  }

  const streakPayloads = ids.map((userId) => ({
    user_id: userId,
    current_streak: Number(recoveryStatesRes.data.get(userId)?.streak || 0),
    updated_at: new Date().toISOString(),
  }));

  const { error: streakErr } = await supabase
    .from('no_show_recovery_state')
    .upsert(streakPayloads, { onConflict: 'user_id' });
  if (streakErr) return { data: touchedUsers, error: streakErr };

  return {
    data: touchedUsers,
    error: null,
  };
}

export async function ensureNoShowRanking(matchId, options = {}) {
  const id = Number(matchId);
  if (!Number.isFinite(id) || id <= 0) {
    return { data: [], error: new Error('invalid_match_id') };
  }

  const emitNotifications = options.emitNotifications !== false;
  const userIdsRes = await fetchRegisteredUserIdsForMatch(id);
  if (userIdsRes.error) return { data: [], error: userIdsRes.error };

  const trackedUserIds = dedupeUserIds(userIdsRes.data || []);
  if (!trackedUserIds.length) return { data: [], error: null };

  const baseRes = await captureNoShowUserAggregateBases(trackedUserIds);
  if (baseRes.error) return { data: [], error: baseRes.error };

  const penaltiesRes = await applyNoShowPenalties(id, { emitNotifications });
  if (penaltiesRes.error) return { data: [], error: penaltiesRes.error };

  const recoveriesRes = await applyNoShowRecoveries(id, { emitNotifications });
  if (recoveriesRes.error) return { data: [], error: recoveriesRes.error };

  const reconcileRes = await reconcileNoShowUserAggregates(trackedUserIds, {
    baseSnapshot: baseRes.data,
  });
  if (reconcileRes.error) return { data: [], error: reconcileRes.error };

  return {
    data: trackedUserIds,
    error: null,
    penaltiesApplied: penaltiesRes.data || [],
    recoveriesApplied: recoveriesRes.data || [],
    reconciledUsers: reconcileRes.data || [],
  };
}
