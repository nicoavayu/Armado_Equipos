import { supabase } from '../../lib/supabaseClient';

const ABSENCE_CONFIRMATION_THRESHOLD = 2;
const NO_SHOW_PENALTY_AMOUNT = -0.5;
const NO_SHOW_RECOVERY_STEP = 0.2;

const toPlayerIdNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const isMatchPlayedFromSurveys = (surveys = []) => {
  const playedVotes = (surveys || []).filter((survey) => survey?.se_jugo === true).length;
  const notPlayedVotes = (surveys || []).filter((survey) => survey?.se_jugo === false).length;
  if (playedVotes === 0 && notPlayedVotes > 0) return false;
  return true;
};

const buildAbsentConfirmMap = (surveys = []) => {
  const confirmMap = new Map();

  for (const survey of (surveys || [])) {
    if (survey?.se_jugo === false) continue;

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
export async function applyNoShowPenalties(matchId) {
  const id = Number(matchId);
  // 1) read surveys for this match
  const { data: surveys, error: surveysErr } = await supabase
    .from('post_match_surveys')
    .select('votante_id, se_jugo, jugadores_ausentes')
    .eq('partido_id', id);
  if (surveysErr) return { data: [], error: surveysErr };
  if (!surveys || surveys.length === 0) return { data: [], error: null };
  if (!isMatchPlayedFromSurveys(surveys)) return { data: [], error: null };

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
      await supabase.rpc('dec_numeric', { p_table: table, p_column: 'ranking', p_id: uid, p_amount: rankingDelta });
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
      await supabase.rpc('inc_numeric', { p_table: 'usuarios', p_column: 'partidos_abandonados', p_id: uid, p_amount: 1 });
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
export async function applyNoShowRecoveries(matchId) {
  const id = Number(matchId);

  // 1) get all survey rows to derive played flag and confirmed absences
  const { data: surveyRows, error: surveyErr } = await supabase
    .from('post_match_surveys')
    .select('votante_id, se_jugo, jugadores_ausentes')
    .eq('partido_id', id);
  if (surveyErr) {
    return { data: [], error: surveyErr };
  }
  if (!surveyRows || surveyRows.length === 0) return { data: [], error: null };
  if (!isMatchPlayedFromSurveys(surveyRows)) {
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
      await supabase.rpc('inc_numeric', { p_table: table, p_column: 'ranking', p_id: userId, p_amount: recoverAmount });
    } catch (rpcError) {
      try {
        const { data: curr } = await supabase.from(table).select('ranking').eq('id', userId).single();
        const newVal = Number(curr?.ranking ?? 0) + recoverAmount;
        await supabase.from(table).update({ ranking: newVal }).eq('id', userId);
      } catch (updateErr) {
        console.error('[NO_SHOW_RECOVERY] failed to apply rating increment for', userId, updateErr);
      }
    }

    console.log('[NO_SHOW_RECOVERY] applied', { userId, cycle_index: cycleIndex });
    applied.push(userId);
  }

  return { data: applied, error: null };
}
