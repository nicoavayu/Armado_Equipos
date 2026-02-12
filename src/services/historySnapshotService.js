import { supabase } from '../supabase';

const toIdNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const isArray = (value) => Array.isArray(value);

const stablePlayerRef = (player) => (
  player?.uuid || player?.usuario_id || (player?.id != null ? String(player.id) : null)
);

const buildParticipantsSnapshot = (players = []) => {
  return players.map((p) => ({
    id: p?.id ?? null,
    ref: stablePlayerRef(p),
    uuid: p?.uuid || null,
    usuario_id: p?.usuario_id || null,
    nombre: p?.nombre || 'Jugador',
    avatar_url: p?.avatar_url || p?.foto_url || null,
    score: typeof p?.score === 'number' ? p.score : null,
    is_goalkeeper: Boolean(p?.is_goalkeeper),
  }));
};

async function getSurveyResultsRow(partidoId) {
  try {
    const { data, error } = await supabase
      .from('survey_results')
      .select('partido_id, snapshot_participantes_listo, snapshot_participantes, snapshot_equipos, resultados_encuesta_listos, snapshot_resultados_encuesta, encuesta_cerrada_at, mvp, golden_glove, red_cards, winner_team, scoreline, awards')
      .eq('partido_id', partidoId)
      .maybeSingle();

    if (error) throw error;
    return data || null;
  } catch (error) {
    const msg = String(error?.message || '').toLowerCase();
    const missingColumn = msg.includes('does not exist') || String(error?.code || '') === '42703';
    if (missingColumn) {
      // Migration not applied yet. Keep flow intact.
      return null;
    }
    throw error;
  }
}

async function mapPlayerIdsToStableRefs(partidoId, ids = []) {
  const uniqIds = [...new Set((ids || []).map((v) => Number(v)).filter((n) => Number.isFinite(n)))];
  if (uniqIds.length === 0) return [];

  const { data, error } = await supabase
    .from('jugadores')
    .select('id, uuid, usuario_id')
    .eq('partido_id', partidoId)
    .in('id', uniqIds);

  if (error) throw error;

  const byId = new Map((data || []).map((row) => [Number(row.id), stablePlayerRef(row) || String(row.id)]));
  return uniqIds.map((id) => byId.get(id) || String(id));
}

export async function ensureParticipantsSnapshot(partidoId) {
  const id = toIdNumber(partidoId);
  if (!id) return { ok: false, reason: 'invalid_partido_id' };

  try {
    const existing = await getSurveyResultsRow(id);
    if (existing?.snapshot_participantes_listo && isArray(existing?.snapshot_participantes)) {
      return { ok: true, changed: false, reason: 'already_snapshoted' };
    }

    let players = null;
    let playersError = null;
    ({ data: players, error: playersError } = await supabase
      .from('jugadores')
      .select('id, uuid, usuario_id, nombre, avatar_url, foto_url, score, is_goalkeeper')
      .eq('partido_id', id)
      .order('id', { ascending: true }));

    if (playersError) {
      const msg = String(playersError?.message || '').toLowerCase();
      const missingFotoUrl = msg.includes('foto_url') && msg.includes('does not exist');
      if (!missingFotoUrl) throw playersError;

      const fallback = await supabase
        .from('jugadores')
        .select('id, uuid, usuario_id, nombre, avatar_url, score, is_goalkeeper')
        .eq('partido_id', id)
        .order('id', { ascending: true });
      players = fallback.data || [];
      if (fallback.error) throw fallback.error;
    }

    let participantsSnapshot = buildParticipantsSnapshot(players || []);
    let equiposSnapshot = null;

    // Prefer confirmed snapshot if available.
    try {
      const { data: teamSnapshot, error: teamError } = await supabase
        .from('partido_team_confirmations')
        .select('participants, team_a, team_b, teams_json, confirmed_at')
        .eq('partido_id', id)
        .maybeSingle();

      if (!teamError && teamSnapshot) {
        if (isArray(teamSnapshot.participants) && teamSnapshot.participants.length > 0) {
          participantsSnapshot = teamSnapshot.participants;
        }
        if (isArray(teamSnapshot.team_a) || isArray(teamSnapshot.team_b)) {
          equiposSnapshot = {
            team_a: isArray(teamSnapshot.team_a) ? teamSnapshot.team_a : [],
            team_b: isArray(teamSnapshot.team_b) ? teamSnapshot.team_b : [],
            teams_json: teamSnapshot.teams_json || null,
            confirmed_at: teamSnapshot.confirmed_at || null,
            source: 'partido_team_confirmations',
          };
        }
      }
    } catch (_error) {
      // Optional table/columns on older environments.
    }

    const payload = {
      partido_id: id,
      snapshot_participantes_listo: true,
      snapshot_participantes: participantsSnapshot,
      snapshot_equipos: equiposSnapshot,
      snapshot_participantes_at: new Date().toISOString(),
      resultados_encuesta_listos: existing?.resultados_encuesta_listos === true,
    };

    const { error: upsertError } = await supabase
      .from('survey_results')
      .upsert(payload, { onConflict: 'partido_id' });

    if (upsertError) throw upsertError;

    return { ok: true, changed: true };
  } catch (error) {
    console.warn('[HISTORY_SNAPSHOT] ensureParticipantsSnapshot failed', { partidoId: id, error });
    return { ok: false, reason: 'exception', error };
  }
}

export async function ensureSurveyResultsSnapshot(partidoId, meta = {}) {
  const id = toIdNumber(partidoId);
  if (!id) return { ok: false, reason: 'invalid_partido_id' };

  try {
    const existing = await getSurveyResultsRow(id);
    if (existing?.resultados_encuesta_listos && existing?.snapshot_resultados_encuesta) {
      return { ok: true, changed: false, reason: 'already_snapshoted' };
    }

    const { data: surveys, error: surveysError } = await supabase
      .from('post_match_surveys')
      .select('jugadores_ausentes, jugadores_violentos')
      .eq('partido_id', id);

    if (surveysError) throw surveysError;

    const absentIds = new Set();
    const dirtyIds = new Set();

    (surveys || []).forEach((s) => {
      (s?.jugadores_ausentes || []).forEach((pid) => absentIds.add(Number(pid)));
      (s?.jugadores_violentos || []).forEach((pid) => dirtyIds.add(Number(pid)));
    });

    const ausentesRefs = await mapPlayerIdsToStableRefs(id, [...absentIds]);
    const suciosRefsFromSurvey = await mapPlayerIdsToStableRefs(id, [...dirtyIds]);
    const redCardsFromResults = isArray(existing?.red_cards) ? existing.red_cards : [];
    const suciosRefs = [...new Set([...suciosRefsFromSurvey, ...redCardsFromResults].filter(Boolean))];

    const snapshot = {
      version: 1,
      mvp: existing?.mvp ?? existing?.awards?.mvp ?? null,
      mas_sucio: existing?.awards?.red_card ?? (suciosRefs[0] || null),
      ausentes: ausentesRefs,
      red_cards: suciosRefs,
      golden_glove: existing?.golden_glove ?? existing?.awards?.best_gk ?? null,
      winner_team: existing?.winner_team || null,
      scoreline: existing?.scoreline || null,
      total_surveys: (surveys || []).length,
      encuesta_cerrada_at: meta?.encuestaCerradaAt || new Date().toISOString(),
      closed_reason: meta?.closedReason || null,
      generated_at: new Date().toISOString(),
    };

    const updatePayload = {
      resultados_encuesta_listos: true,
      snapshot_resultados_encuesta: snapshot,
      encuesta_cerrada_at: snapshot.encuesta_cerrada_at,
      snapshot_resultados_at: new Date().toISOString(),
    };

    const { error: updateError } = await supabase
      .from('survey_results')
      .update(updatePayload)
      .eq('partido_id', id);

    if (updateError) throw updateError;

    return { ok: true, changed: true, snapshot };
  } catch (error) {
    console.warn('[HISTORY_SNAPSHOT] ensureSurveyResultsSnapshot failed', { partidoId: id, error });
    return { ok: false, reason: 'exception', error };
  }
}
