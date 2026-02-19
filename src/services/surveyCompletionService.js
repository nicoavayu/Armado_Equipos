import { supabase } from '../supabase';
import { db } from '../api/supabaseWrapper';
import { grantAwardsForMatch } from './db/awards';
import { applyNoShowPenalties, applyNoShowRecoveries } from './db/penalties';
import { handleError } from '../lib/errorHandler';
import { ensureParticipantsSnapshot, ensureSurveyResultsSnapshot } from './historySnapshotService';

import {
  SURVEY_FINALIZE_DELAY_MS,
  SURVEY_MIN_VOTERS_FOR_AWARDS,
} from '../config/surveyConfig';
import { getSurveyResultsReadyMessage } from '../utils/surveyNotificationCopy';
// Calcula y persiste premios (MVP, Mejor Arquero y Tarjeta Roja) en survey_results.awards
export async function computeAndPersistAwards(partidoId) {
  const idNum = Number(partidoId);
  let surveys;
  try {
    surveys = await db.fetchMany('post_match_surveys', { partido_id: idNum });
  } catch (error) {
    handleError(error, { showToast: false, onError: () => { } });
    return null;
  }

  const count = (arr, key) => arr.reduce((m, v) => {
    const id = v[key]; if (!id) return m; m[id] = (m[id] || 0) + 1; return m;
  }, {});
  const countArray = (arr, key) => {
    const map = {};
    arr.forEach((v) => {
      const ids = v[key];
      if (Array.isArray(ids)) {
        ids.forEach((id) => { if (id) map[id] = (map[id] || 0) + 1; });
      } else if (ids) {
        map[ids] = (map[ids] || 0) + 1;
      }
    });
    return map;
  };
  const pickWinner = (map) => {
    const entries = Object.entries(map);
    if (!entries.length) return null;
    entries.sort((a, b) => b[1] - a[1] || Number(a[0]) - Number(b[0]));
    const [player_id, votes] = entries[0];
    const total = entries.reduce((s, [, v]) => s + v, 0) || 1;
    const pct = Math.round((votes * 100) / total);
    return { player_id: Number(player_id), votes, pct, total };
  };

  const mvpMap = count(surveys, 'mejor_jugador_eq_a');
  const gkMap = count(surveys, 'mejor_jugador_eq_b');

  // Try multiple red card fields
  let redMap = countArray(surveys, 'jugadores_violentos');
  if (Object.keys(redMap).length === 0) {
    redMap = count(surveys, 'tarjeta_roja') || count(surveys, 'mas_sucio') || count(surveys, 'sucio') || count(surveys, 'player_dirty');
  }

  const awards = {
    mvp: pickWinner(mvpMap),
    best_gk: pickWinner(gkMap),
    red_card: pickWinner(redMap),
    totals: {
      mvp: Object.values(mvpMap).reduce((a, b) => a + b, 0),
      gk: Object.values(gkMap).reduce((a, b) => a + b, 0),
      red: Object.values(redMap).reduce((a, b) => a + b, 0),
    },
  };

  try {
    // Persist survey_results awards and mark results_ready true
    // Use direct supabase update to avoid .single() error if row doesn't exist
    const { error: upErr } = await supabase
      .from('survey_results')
      .update({ awards, results_ready: true, updated_at: new Date().toISOString() })
      .eq('partido_id', idNum);

    if (upErr) throw upErr;
  } catch (upErr) {
    handleError(upErr, { showToast: false, onError: () => { } });
  }

  // Grant awards to registered players only
  try {
    // Idempotency guard: if player_awards already exist for this partido, skip awarding to avoid double increments
    let existingAwards = [];
    try {
      existingAwards = await db.fetchMany('player_awards', { partido_id: idNum });
    } catch (e) {
      // if this check fails, continue to attempt granting (best effort)
      console.warn('[AWARDS] could not check existing player_awards, will attempt grant', e?.message || e);
    }

    if (existingAwards && existingAwards.length > 0) {
      console.log('[AWARDS] player_awards already exist for partido, skipping grantAwardsForMatch to avoid double application', { partidoId: idNum });
    } else {
      await grantAwardsForMatch(idNum, awards);
    }
  } catch (awardError) {
    handleError(awardError, { showToast: false, onError: () => { } });
  }

  // Apply no-show penalties to registered players - REMOVED from here to avoid double application
  // They are applied in finalizeIfComplete now.
  /*
  try {
    await applyNoShowPenalties(idNum);
  } catch (penaltyError) {
    handleError(penaltyError, { showToast: false, onError: () => { } });
  }
  */

  // Mark survey_results awards as applied (idempotent)
  /*
  try {
    await db.update('survey_results', { partido_id: idNum }, { awards_status: 'applied', awards_applied_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  } catch (err) {
    console.warn('[AWARDS] could not mark survey_results awards as applied', err);
  }
  */

  return awards;
}

export async function finalizeIfComplete(partidoId, options = {}) {
  const SKIP_SIDE_EFFECTS = options.skipSideEffects === true;
  // ensure we have an anchored now for survey timing
  const now = new Date();
  const nowIso = now.toISOString();
  let partidoNombre = `partido ${partidoId}`;

  try {
    const { data: partidoMeta } = await supabase
      .from('partidos')
      .select('nombre')
      .eq('id', partidoId)
      .maybeSingle();
    if (partidoMeta?.nombre) {
      partidoNombre = partidoMeta.nombre;
    }
  } catch (_partidoMetaError) {
    // Non-blocking: fallback to generic label if metadata fetch fails.
  }

  // Upsert minimal survey_results to record existence (anchors created_at)
  let existingSurvey = null;
  try {
    const { data, error } = await supabase
      .from('survey_results')
      .select('created_at')
      .eq('partido_id', partidoId)
      .maybeSingle();
    if (error) throw error;
    existingSurvey = data || null;
  } catch (e) {
    console.error('[FINALIZE] error fetching survey_results', { partidoId, e });
    existingSurvey = null;
  }

  // Use created_at as the anchor for the deadline
  const surveyOpenedAt = existingSurvey?.created_at || nowIso;
  const computedDeadline = new Date(new Date(surveyOpenedAt).getTime() + SURVEY_FINALIZE_DELAY_MS).toISOString();

  // Phase 1 snapshot (best-effort): keep historical participants/equipos frozen as early as possible.
  try {
    await ensureParticipantsSnapshot(partidoId);
  } catch (_snapshotError) {
    // non-blocking
  }

  // We no longer rely on 'meta' column which seems to be missing in DB
  try {
    // Determine what to upsert.
    // If it doesn't exist, we insert id and updated_at (created_at is auto or we let it be)
    // Actually, to ensure we catch 'created_at' for next time if it didn't exist, we rely on the DB setting created_at on insert,
    // OR we explicitly set it if we can.
    // For now, minimal upsert to ensure row exists.
    const payload = { partido_id: partidoId };

    // Warning: if we don't return 'created_at' from the upsert, we might miss it if we just created it.
    // But we calculated computedDeadline above using 'nowIso' if it didn't exist.
    // The strict deadline logic relies on the row persisting.

    const { error: upsertErr } = await supabase
      .from('survey_results')
      .upsert(payload);

    if (upsertErr) throw upsertErr;
  } catch (e) {
    console.error('[FINALIZE] error upserting survey_results', { partidoId, e });
    // If error is strictly about missing column, we might suppress it, but better minimal payload
    // If even this fails, logic might degrade to sliding deadline, but "meta" error should be gone.
    console.warn('[FINALIZE] continuing despite upsert error (best effort for deadline)');
  }

  // Re-calculate deadline for return
  // If we just created it (existingSurvey is null), use current calculated deadline.
  const deadlineReached = new Date() >= new Date(computedDeadline);

  // 1) jugadores logueados del partido (solo ellos pueden votar encuesta)
  const { count: playersCount, error: playersErr } = await supabase
    .from('jugadores')
    .select('id', { count: 'exact', head: true })
    .eq('partido_id', partidoId)
    .not('usuario_id', 'is', null);
  if (playersErr) {
    console.error('[FINALIZE] error fetching playersCount', { partidoId, playersErr });
    throw playersErr;
  }

  // 2) encuestas distintas por votante
  const { data: surveysRows, error: surveysErr } = await supabase
    .from('post_match_surveys')
    .select('votante_id')
    .eq('partido_id', partidoId);
  if (surveysErr) {
    console.error('[FINALIZE] error fetching surveysRows', { partidoId, surveysErr });
    throw surveysErr;
  }
  const distinctVoters = new Set(
    (surveysRows || [])
      .map((r) => r.votante_id)
      .filter((id) => id != null),
  );
  const surveysCount = distinctVoters.size;

  // Log counts and sample voter ids
  const voterIds = Array.from(distinctVoters);
  console.log('[FINALIZE] counts', { partidoId, playersCount, surveysCount, voterIdsSample: voterIds.slice(0, 10) });

  // determine completion by votes OR by deadline
  const allVoted = Boolean(playersCount) && surveysCount >= playersCount;
  // deadlineReached was calculated earlier (line 169)


  if (!allVoted && !deadlineReached) {
    const msLeft = new Date(computedDeadline).getTime() - Date.now();
    console.log('[FINALIZE] waiting', { partidoId, playersCount, surveysCount, deadlineAt: computedDeadline, msLeft });
    return { done: false, playersCount, surveysCount, deadlineAt: computedDeadline };
  }

  console.log('[FINALIZE] proceeding to compute results and schedule notifications (allVoted || deadlineReached)', {
    partidoId,
    allVoted,
    deadlineReached,
  });
  // Always attempt to apply no-show penalties when finalizing (idempotent implementation should guard double application)
  if (!SKIP_SIDE_EFFECTS) {
    try {
      console.log('[FINALIZE] applying no-show penalties', { partidoId });
      const penaltiesResult = await applyNoShowPenalties(partidoId);
      if (penaltiesResult?.error) {
        throw penaltiesResult.error;
      }
    } catch (penErr) {
      console.error('[FINALIZE] applyNoShowPenalties error', { partidoId, penErr });
    }
    // Always attempt to run no-show recovery processing as well (non-blocking)
    try {
      console.log('[FINALIZE] running no-show recoveries', { partidoId });
      const recoveriesResult = await applyNoShowRecoveries(partidoId);
      if (recoveriesResult?.error) {
        throw recoveriesResult.error;
      }
    } catch (recErr) {
      console.error('[NO_SHOW_RECOVERY] error', recErr);
    }
  }

  // --- Create survey_finished notifications for all players immediately ---
  if (!SKIP_SIDE_EFFECTS) try {
    let jugadoresForNotifs = await db.fetchMany('jugadores', { partido_id: partidoId });
    jugadoresForNotifs = (jugadoresForNotifs || []).filter((j) => j.usuario_id != null);

    // Strict dedupe: fetch existing 'survey_finished' notifications for this match
    // Filters based on match_ref to ensure robustness
    let existingNotifs = [];
    try {
      existingNotifs = await db.fetchMany('notifications', { partido_id: Number(partidoId), type: 'survey_finished' });
    } catch (e) {
      console.warn('[DEBUG] could not fetch existing survey_finished notifications', e?.message || e);
      existingNotifs = [];
    }

    const alreadyNotifiedUserIds = new Set((existingNotifs || []).map((n) => n.user_id).filter(Boolean));
    const jugadoresToInsert = (jugadoresForNotifs || []).filter((j) => !alreadyNotifiedUserIds.has(j.usuario_id));

    if (jugadoresToInsert && jugadoresToInsert.length > 0) {
      // Immediate sending (no delay)
      const notificationPayloads = jugadoresToInsert.map((j) => ({
        user_id: j.usuario_id,
        type: 'survey_finished',
        title: 'Encuesta finalizada',
        message: getSurveyResultsReadyMessage({ matchName: partidoNombre }),
        // match_ref: Number(partidoId), // Generated column, cannot insert manually
        partido_id: Number(partidoId),
        // Canonical data format
        data: {
          match_id: String(partidoId),
          match_name: partidoNombre,
          partido_nombre: partidoNombre,
          link: `/resultados-encuesta/${partidoId}`,
          resultsUrl: `/resultados-encuesta/${partidoId}?showAwards=1`,
        },
        read: false,
        created_at: nowIso,
      }));

      console.log('[FINALIZE] inserting survey_finished notifications', { count: notificationPayloads.length });

      try {
        // Use supabase directly to support bulk insert (db.insert uses .single())
        const { data: insertRes, error: notifErr } = await supabase
          .from('notifications')
          .insert(notificationPayloads)
          .select(); // legitimate usage for bulk

        if (notifErr) throw notifErr;
        console.log('[FINALIZE] insert success', insertRes?.length);
      } catch (notifErr) {
        console.error('[FINALIZE] insert error', notifErr);
        handleError(notifErr, { showToast: false, onError: () => { } });
      }
    } else {
      console.log('[FINALIZE] no new notifications to insert (dedupe active)', { partidoId });
    }
  } catch (e) {
    console.error('[FINALIZE] error processing survey_finished notifications', { partidoId, e });
  }

  // Determine whether we have enough voters to compute and award prizes
  const hasEnoughVotesForAwards = surveysCount >= SURVEY_MIN_VOTERS_FOR_AWARDS;

  if (!hasEnoughVotesForAwards) {
    console.log('[FINALIZE] awards skipped: not enough votes', { partidoId, surveysCount });
    try {
      await ensureSurveyResultsSnapshot(partidoId, {
        encuestaCerradaAt: nowIso,
        closedReason: allVoted ? 'all_voted' : 'deadline',
      });
    } catch (_snapshotError) {
      // non-blocking
    }
    return { done: true, playersCount, surveysCount, awardsSkipped: true };
  }

  // We have enough votes: compute and persist awards (this function is idempotent)
  try {
    console.log('[FINALIZE] computing and persisting awards', { partidoId });
    await computeAndPersistAwards(partidoId);
  } catch (awardErr) {
    console.error('[FINALIZE] computeAndPersistAwards error', { partidoId, awardErr });
    handleError(awardErr, { showToast: false, onError: () => { } });
  }

  // 3) calcular resultados (stub o real)
  const results = await computeResultsAverages(partidoId);

  // 4) upsert survey_results with awards pending state
  // We keep ready_at for compatibility but effective immediately
  const basePayload = {
    partido_id: partidoId,
    ...results,
    results_ready: true,
  };
  const safeUpsert = async (payload) => {
    let res = await supabase.from('survey_results').upsert(payload, { onConflict: 'partido_id' });
    if (res.error && /winner_team|scoreline/i.test(res.error.message || '')) {
      const legacyPayload = { ...payload };
      delete legacyPayload.winner_team;
      delete legacyPayload.scoreline;
      res = await supabase.from('survey_results').upsert(legacyPayload, { onConflict: 'partido_id' });
    }
    return res;
  };

  let upsertRes = await safeUpsert(basePayload);
  if (upsertRes.error) {
    upsertRes = await safeUpsert({
      partido_id: partidoId,
      mvp: results?.mvp ?? null,
      golden_glove: results?.golden_glove ?? null,
      red_cards: Array.isArray(results?.red_cards) ? results.red_cards : [],
      winner_team: results?.winner_team ?? null,
      scoreline: results?.scoreline ?? null,
      results_ready: true,
    });
  }
  if (upsertRes.error) {
    upsertRes = await safeUpsert({
      partido_id: partidoId,
      mvp: results?.mvp ?? null,
      golden_glove: results?.golden_glove ?? null,
      winner_team: results?.winner_team ?? null,
      scoreline: results?.scoreline ?? null,
      results_ready: true,
    });
  }
  if (upsertRes.error) {
    upsertRes = await safeUpsert({
      partido_id: partidoId,
      winner_team: results?.winner_team ?? null,
      scoreline: results?.scoreline ?? null,
      results_ready: true,
    });
  }
  if (upsertRes.error) throw upsertRes.error;

  try {
    await ensureSurveyResultsSnapshot(partidoId, {
      encuestaCerradaAt: nowIso,
      closedReason: allVoted ? 'all_voted' : 'deadline',
    });
  } catch (_snapshotError) {
    // non-blocking
  }

  return { done: true, playersCount, surveysCount };
}

// Mantener / completar esta función con tu lógica real
export async function computeResultsAverages(partidoId) {
  // 1) encuestas
  let surveys = null;
  try {
    const { data, error } = await supabase
      .from('post_match_surveys')
      .select('votante_id, mejor_jugador_eq_a, mejor_jugador_eq_b, jugadores_violentos, ganador, resultado')
      .eq('partido_id', partidoId);
    if (error) throw error;
    surveys = data || [];
  } catch (e) {
    // Backward-compatible fallback if ganador/resultado columns don't exist yet
    const { data, error } = await supabase
      .from('post_match_surveys')
      .select('votante_id, mejor_jugador_eq_a, mejor_jugador_eq_b, jugadores_violentos')
      .eq('partido_id', partidoId);
    if (error) throw error;
    surveys = data || [];
  }
  const totalVotantes = new Set((surveys || []).map((s) => s.votante_id)).size || 0;

  // 2) recolectar UUIDs para mapear
  const uuidSet = new Set();
  for (const s of (surveys || [])) {
    if (s.mejor_jugador_eq_a && typeof s.mejor_jugador_eq_a === 'string' && !/^\d+$/.test(s.mejor_jugador_eq_a)) {
      uuidSet.add(s.mejor_jugador_eq_a);
    }
    if (s.mejor_jugador_eq_b && typeof s.mejor_jugador_eq_b === 'string' && !/^\d+$/.test(s.mejor_jugador_eq_b)) {
      uuidSet.add(s.mejor_jugador_eq_b);
    }
    (s.jugadores_violentos || []).forEach((val) => {
      if (val && typeof val === 'string' && !/^\d+$/.test(val)) {
        uuidSet.add(val);
      }
    });
  }

  let uuidToId = new Map();
  if (uuidSet.size) {
    const { data: mapRows } = await supabase
      .from('jugadores')
      .select('id, uuid')
      .in('uuid', Array.from(uuidSet));
    mapRows?.forEach((r) => uuidToId.set(r.uuid, r.id));
  }

  // 3) helpers de normalización
  const toNumId = (val) => {
    if (val == null) return null;
    if (typeof val === 'number' && Number.isFinite(val)) return val;
    if (typeof val === 'string') {
      if (/^\d+$/.test(val)) return parseInt(val, 10);
      return uuidToId.get(val) ?? null;
    }
    return null;
  };
  const normalizeIdArray = (arr = []) =>
    arr.map(toNumId).filter((n) => typeof n === 'number' && Number.isFinite(n));

  // 4) contadores por jugadorId NUMÉRICO
  const mvpCount = new Map();
  const gkCount = new Map();
  const violentCount = new Map();

  for (const s of (surveys || [])) {
    const mvpId = toNumId(s.mejor_jugador_eq_a);
    if (mvpId) mvpCount.set(mvpId, (mvpCount.get(mvpId) || 0) + 1);
    const gkId = toNumId(s.mejor_jugador_eq_b);
    if (gkId) gkCount.set(gkId, (gkCount.get(gkId) || 0) + 1);
    const violentNums = normalizeIdArray(s.jugadores_violentos || []);
    violentNums.forEach((id) => violentCount.set(id, (violentCount.get(id) || 0) + 1));
  }

  // 5) helper para elegir ganador
  const pickWinner = (map) => {
    let winner = null, best = -1;
    // Use Array.from to avoid downlevelIteration TS issues
    Array.from(map.entries()).forEach(([id, cnt]) => {
      if (cnt > best) { best = cnt; winner = id; }
    });
    return winner;
  };

  const mvpIdNum = pickWinner(mvpCount);
  const gkIdNum = pickWinner(gkCount);

  // 6) umbral tarjetas rojas (>=25% de votantes)
  const threshold = totalVotantes > 0 ? Math.ceil(totalVotantes * 0.25) : Infinity;
  const redIdsNum = [];
  Array.from(violentCount.entries()).forEach(([id, cnt]) => {
    if (cnt >= threshold) redIdsNum.push(id);
  });

  // 7) mapear NUM -> identificador estable del jugador
  // Preferencia: uuid -> usuario_id -> id (string)
  const idsToFetch = Array.from(new Set([mvpIdNum, gkIdNum, ...redIdsNum]
    .filter((n) => typeof n === 'number' && Number.isFinite(n))));
  let idToPlayerRef = new Map();
  if (idsToFetch.length) {
    const { data: jugRows, error: jErr } = await supabase
      .from('jugadores')
      .select('id, uuid, usuario_id')
      .in('id', idsToFetch);
    if (jErr) throw jErr;
    jugRows?.forEach((j) => {
      const playerRef = j.uuid || j.usuario_id || String(j.id);
      idToPlayerRef.set(j.id, playerRef);
    });
  }

  // 8) ganador + resultado por mayoría (cuando exista)
  const ganadorCount = new Map();
  const resultadoCount = new Map();
  (surveys || []).forEach((s) => {
    const g = typeof s?.ganador === 'string' ? s.ganador.trim() : '';
    if (g) ganadorCount.set(g, (ganadorCount.get(g) || 0) + 1);
    const r = typeof s?.resultado === 'string' ? s.resultado.trim() : '';
    if (r) resultadoCount.set(r, (resultadoCount.get(r) || 0) + 1);
  });
  const pickStringWinner = (map) => {
    let winner = null;
    let best = -1;
    Array.from(map.entries()).forEach(([k, cnt]) => {
      if (cnt > best) { best = cnt; winner = k; }
    });
    return winner;
  };
  const winner_team = pickStringWinner(ganadorCount);
  const scoreline = pickStringWinner(resultadoCount);

  return {
    mvp: mvpIdNum ? idToPlayerRef.get(mvpIdNum) || String(mvpIdNum) : null,
    golden_glove: gkIdNum ? idToPlayerRef.get(gkIdNum) || String(gkIdNum) : null,
    red_cards: redIdsNum.map((id) => idToPlayerRef.get(id) || String(id)).filter(Boolean),
    winner_team: winner_team || null,
    scoreline: scoreline || null,
  };
}
