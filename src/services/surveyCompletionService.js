import { supabase } from '../supabase';
import { db } from '../api/supabaseWrapper';
import { getResultsUrl } from '../utils/routes';
import { toBigIntId } from '../utils';
import { grantAwardsForMatch } from './db/awards';
import { applyNoShowPenalties } from './db/penalties';

// Calcula y persiste premios (MVP, Mejor Arquero y Tarjeta Roja) en survey_results.awards
export async function computeAndPersistAwards(partidoId) {
  const idNum = Number(partidoId);
  let surveys;
  try {
    surveys = await db.fetchMany('post_match_surveys', { partido_id: idNum });
  } catch (error) {
    console.error(error);
    return null;
  }

  const count = (arr, key) => arr.reduce((m, v) => {
    const id = v[key]; if (!id) return m; m[id] = (m[id] || 0) + 1; return m;
  }, {});
  const countArray = (arr, key) => {
    const map = {};
    arr.forEach(v => {
      const ids = v[key];
      if (Array.isArray(ids)) {
        ids.forEach(id => { if (id) map[id] = (map[id] || 0) + 1; });
      } else if (ids) {
        map[ids] = (map[ids] || 0) + 1;
      }
    });
    return map;
  };
  const pickWinner = (map) => {
    const entries = Object.entries(map);
    if (!entries.length) return null;
    entries.sort((a,b) => b[1]-a[1] || Number(a[0]) - Number(b[0]));
    const [player_id, votes] = entries[0];
    const total = entries.reduce((s, [,v]) => s+v, 0) || 1;
    const pct = Math.round((votes*100)/total);
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
      mvp: Object.values(mvpMap).reduce((a,b)=>a+b,0), 
      gk: Object.values(gkMap).reduce((a,b)=>a+b,0),
      red: Object.values(redMap).reduce((a,b)=>a+b,0)
    }
  };

  const { error: upErr } = await supabase
    .from('survey_results')
    .update({ awards, results_ready: true, updated_at: new Date().toISOString() })
    .eq('partido_id', idNum);
  if (upErr) { console.error(upErr); }
  
  // Grant awards to registered players only
  try {
    await grantAwardsForMatch(idNum, awards);
  } catch (awardError) {
    console.error('Error granting awards:', awardError);
  }
  
  // Apply no-show penalties to registered players
  try {
    await applyNoShowPenalties(idNum);
  } catch (penaltyError) {
    console.error('Error applying no-show penalties:', penaltyError);
  }
  
  return awards;
}

export async function finalizeIfComplete(partidoId) {
  // 1) jugadores del partido
  const { count: playersCount, error: playersErr } = await supabase
    .from('jugadores')
    .select('id', { count: 'exact', head: true })
    .eq('partido_id', partidoId);
  if (playersErr) throw playersErr;

  // 2) encuestas distintas por votante
  const { data: surveysRows, error: surveysErr } = await supabase
    .from('post_match_surveys')
    .select('votante_id')
    .eq('partido_id', partidoId);
  if (surveysErr) throw surveysErr;
  const distinctVoters = new Set((surveysRows || []).map(r => r.votante_id));
  const surveysCount = distinctVoters.size;

  if (!playersCount || surveysCount < playersCount) {
    return { done: false, playersCount, surveysCount };
  }

  // 3) calcular resultados (stub o real)
  const results = await computeResultsAverages(partidoId);

  const qs = new URLSearchParams(window.location.search);
  const FAST = qs.get('fastResults') === '1' || localStorage.getItem('SURVEY_RESULTS_TEST_FAST') === '1';
  console.log('[FAST_MODE] URL params:', window.location.search);
  console.log('[FAST_MODE] fastResults param:', qs.get('fastResults'));
  console.log('[FAST_MODE] localStorage FAST:', localStorage.getItem('SURVEY_RESULTS_TEST_FAST'));
  console.log('[FAST_MODE] FAST mode enabled:', FAST);
  const now = new Date();
  const nowIso = now.toISOString();
  const readyAt = FAST
    ? new Date(now.getTime() + 30 * 1000).toISOString()
    : new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString();
  console.log('[FAST_MODE] Notification scheduled for:', readyAt, FAST ? '(30 seconds)' : '(6 hours)');

  // 4) upsert survey_results
  const { error: upsertErr } = await supabase
    .from('survey_results')
    .upsert({
      partido_id: partidoId,
      ...results,
      ready_at: readyAt,
      results_ready: false,
      updated_at: nowIso,
    });
  if (upsertErr) throw upsertErr;

  // 5) programar notificación - crear una por cada jugador del partido
  let jugadores;
  try {
    jugadores = await db.fetchMany('jugadores', { partido_id: partidoId });
    // Filter out null usuario_id
    jugadores = jugadores.filter(j => j.usuario_id != null);
  } catch (error) {
    throw error;
  }

  if (jugadores && jugadores.length > 0) {
    const idNum = toBigIntId(partidoId);
    const notificationPayloads = jugadores.map(j => ({
      user_id: j.usuario_id,
      type: 'survey_results_ready',
      send_at: readyAt,
      status: 'pending',
      title: 'Resultados listos',
      message: 'Los resultados de la encuesta del partido están listos.',
      data: { matchId: idNum, resultsUrl: `${getResultsUrl(idNum)}?showAwards=1` },
      created_at: nowIso,
    }));
    
    console.log('[DEBUG insert notification][surveyCompletionService]', notificationPayloads);
    const { error: notifErr } = await supabase
      .from('notifications')
      .insert(notificationPayloads);
    if (notifErr) {
      console.error('[surveyCompletionService] insert notifications error:', notifErr);
      throw notifErr;
    }
  }

  return { done: true, playersCount, surveysCount, readyAt };
}

// Mantener / completar esta función con tu lógica real
export async function computeResultsAverages(partidoId) {
  // 1) encuestas
  const { data: surveys, error: sErr } = await supabase
    .from('post_match_surveys')
    .select('votante_id, mejor_jugador_eq_a, mejor_jugador_eq_b, jugadores_violentos')
    .eq('partido_id', partidoId);
  if (sErr) throw sErr;
  const totalVotantes = new Set((surveys || []).map(s => s.votante_id)).size || 0;

  // 2) recolectar UUIDs para mapear
  const uuidSet = new Set();
  for (const s of (surveys || [])) {
    if (s.mejor_jugador_eq_a && typeof s.mejor_jugador_eq_a === 'string' && !/^\d+$/.test(s.mejor_jugador_eq_a)) {
      uuidSet.add(s.mejor_jugador_eq_a);
    }
    if (s.mejor_jugador_eq_b && typeof s.mejor_jugador_eq_b === 'string' && !/^\d+$/.test(s.mejor_jugador_eq_b)) {
      uuidSet.add(s.mejor_jugador_eq_b);
    }
    (s.jugadores_violentos || []).forEach(val => {
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
    mapRows?.forEach(r => uuidToId.set(r.uuid, r.id));
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
  const normalizeIdArray = (arr=[]) =>
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
    violentNums.forEach(id => violentCount.set(id, (violentCount.get(id) || 0) + 1));
  }

  // 5) helper para elegir ganador
  const pickWinner = (map) => {
    let winner = null, best = -1;
    for (const [id, cnt] of map.entries()) {
      if (cnt > best) { best = cnt; winner = id; }
    }
    return winner;
  };

  const mvpIdNum = pickWinner(mvpCount);
  const gkIdNum  = pickWinner(gkCount);

  // 6) umbral tarjetas rojas (>=25% de votantes)
  const threshold = totalVotantes > 0 ? Math.ceil(totalVotantes * 0.25) : Infinity;
  const redIdsNum = [];
  for (const [id, cnt] of violentCount.entries()) {
    if (cnt >= threshold) redIdsNum.push(id);
  }

  // 7) mapear NUM -> UUID
  const idsToFetch = [...new Set([mvpIdNum, gkIdNum, ...redIdsNum]
    .filter((n) => typeof n === 'number' && Number.isFinite(n)))];
  let idToUuid = new Map();
  if (idsToFetch.length) {
    const { data: jugRows, error: jErr } = await supabase
      .from('jugadores')
      .select('id, uuid')
      .in('id', idsToFetch);
    if (jErr) throw jErr;
    jugRows?.forEach(j => idToUuid.set(j.id, j.uuid));
  }

  return {
    mvp: mvpIdNum ? idToUuid.get(mvpIdNum) || null : null,
    golden_glove: gkIdNum ? idToUuid.get(gkIdNum) || null : null,
    red_cards: redIdsNum.map(id => idToUuid.get(id)).filter(Boolean)
  };
}