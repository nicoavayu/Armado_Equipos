import { supabase } from '../supabase';
import { db } from '../api/supabaseWrapper';
import { grantAwardsForMatch } from './db/awards';
import { applyNoShowPenalties, applyNoShowRecoveries } from './db/penalties';
import { handleError } from '../lib/errorHandler';
import { ensureParticipantsSnapshot, ensureSurveyResultsSnapshot } from './historySnapshotService';

import {
  SURVEY_FINALIZE_DELAY_MS,
} from '../config/surveyConfig';
import { getSurveyResultsReadyMessage } from '../utils/surveyNotificationCopy';
import { hasAnyAwardData, isAwardsTrulyReady } from '../utils/awardsReadiness';

const RESULT_STATUS_FINISHED = 'finished';
const RESULT_STATUS_DRAW = 'draw';
const RESULT_STATUS_NOT_PLAYED = 'not_played';
const RESULT_STATUS_PENDING = 'pending';
const SURVEY_STATUS_OPEN = 'open';
const SURVEY_STATUS_CLOSED = 'closed';

const normalizeRef = (value) => String(value || '').trim().toLowerCase();

export const normalizeWinnerTeamValue = (value) => {
  const token = normalizeRef(value);
  if (!token) return null;
  if (['a', 'equipo_a', 'team_a', 'gano_a', 'winner_a'].includes(token)) return 'A';
  if (['b', 'equipo_b', 'team_b', 'gano_b', 'winner_b'].includes(token)) return 'B';
  return null;
};

export const normalizeResultStatusValue = (value) => {
  const token = normalizeRef(value);
  if (!token) return null;

  if ([
    RESULT_STATUS_FINISHED,
    'played',
    'jugo',
    'jugado',
    'se_jugo',
  ].includes(token)) return RESULT_STATUS_FINISHED;
  if ([RESULT_STATUS_DRAW, 'empate', 'drawn', 'tie'].includes(token)) return RESULT_STATUS_DRAW;
  if ([
    RESULT_STATUS_NOT_PLAYED,
    'cancelled',
    'canceled',
    'cancelado',
    'no_jugado',
    'not_played',
    'notplayed',
  ].includes(token)) return RESULT_STATUS_NOT_PLAYED;
  if ([RESULT_STATUS_PENDING, 'pendiente'].includes(token)) return RESULT_STATUS_PENDING;

  return null;
};

export const normalizeSurveyStatusValue = (value) => {
  const token = normalizeRef(value);
  if (!token) return null;
  if (token === SURVEY_STATUS_OPEN || token === 'abierta') return SURVEY_STATUS_OPEN;
  if (token === SURVEY_STATUS_CLOSED || token === 'cerrada') return SURVEY_STATUS_CLOSED;
  return null;
};

export const resolveMonotonicExpectedVoters = ({
  storedExpectedVoters = 0,
  computedEligibleVoters = 0,
}) => {
  const stored = Math.max(0, Math.trunc(Number(storedExpectedVoters) || 0));
  const computed = Math.max(0, Math.trunc(Number(computedEligibleVoters) || 0));
  return Math.max(stored, computed);
};

export const shouldBumpExpectedVoters = ({
  surveyStatus = SURVEY_STATUS_OPEN,
  storedExpectedVoters = 0,
  computedEligibleVoters = 0,
}) => {
  const normalizedStatus = normalizeSurveyStatusValue(surveyStatus) || SURVEY_STATUS_OPEN;
  if (normalizedStatus !== SURVEY_STATUS_OPEN) return false;
  return resolveMonotonicExpectedVoters({
    storedExpectedVoters,
    computedEligibleVoters,
  }) > Math.max(0, Math.trunc(Number(storedExpectedVoters) || 0));
};

export const shouldFinalizeSurveyClosure = ({
  submissionsCount = 0,
  expectedVoters = 0,
  deadlineReached = false,
}) => {
  const submissions = Math.max(0, Math.trunc(Number(submissionsCount) || 0));
  const expected = Math.max(0, Math.trunc(Number(expectedVoters) || 0));
  return submissions >= expected || deadlineReached === true;
};

export const resolveMvpTieBreakWinner = ({
  candidateIds = [],
  resultStatus = RESULT_STATUS_PENDING,
  winnerTeam = null,
  teamAIds = new Set(),
  teamBIds = new Set(),
}) => {
  const normalizedCandidates = [...new Set(
    (candidateIds || [])
      .map((value) => Number(value))
      .filter((id) => Number.isFinite(id)),
  )].sort((a, b) => a - b);

  if (normalizedCandidates.length === 0) return null;
  if (resultStatus === RESULT_STATUS_NOT_PLAYED) return null;
  if (normalizedCandidates.length === 1) return normalizedCandidates[0];

  if (resultStatus === RESULT_STATUS_FINISHED) {
    const winningTeamSet = winnerTeam === 'A'
      ? teamAIds
      : winnerTeam === 'B'
        ? teamBIds
        : null;

    if (winningTeamSet && winningTeamSet.size > 0) {
      const fromWinningTeam = normalizedCandidates.filter((id) => winningTeamSet.has(id));
      if (fromWinningTeam.length > 0) return fromWinningTeam[0];
    }
  }

  // Draw and any fallback path use deterministic lowest jugador_id.
  return normalizedCandidates[0];
};

export const aggregateSurveyResult = (surveys = []) => {
  const statusCount = new Map();
  const winnerCount = new Map();
  const statusPriority = [
    RESULT_STATUS_FINISHED,
    RESULT_STATUS_DRAW,
    RESULT_STATUS_NOT_PLAYED,
    RESULT_STATUS_PENDING,
  ];

  (surveys || []).forEach((survey) => {
    const normalizedStatusFromResult = normalizeResultStatusValue(survey?.resultado);
    const normalizedWinner = normalizeWinnerTeamValue(survey?.ganador);

    let status = normalizedStatusFromResult;
    if (!status) {
      if (normalizedWinner) status = RESULT_STATUS_FINISHED;
      else if (normalizeRef(survey?.ganador) === 'draw' || normalizeRef(survey?.ganador) === 'empate') status = RESULT_STATUS_DRAW;
      else if (normalizeRef(survey?.ganador) === 'not_played' || normalizeRef(survey?.ganador) === 'no_jugado' || normalizeRef(survey?.ganador) === 'cancelled') status = RESULT_STATUS_NOT_PLAYED;
      else if (survey?.se_jugo === false) status = RESULT_STATUS_NOT_PLAYED;
      else status = RESULT_STATUS_PENDING;
    }

    statusCount.set(status, (statusCount.get(status) || 0) + 1);

    if (status === RESULT_STATUS_FINISHED && normalizedWinner) {
      winnerCount.set(normalizedWinner, (winnerCount.get(normalizedWinner) || 0) + 1);
    }
  });

  let resultStatus = RESULT_STATUS_PENDING;
  let statusBest = -1;
  statusPriority.forEach((status) => {
    const cnt = statusCount.get(status) || 0;
    if (cnt > statusBest) {
      statusBest = cnt;
      resultStatus = status;
    }
  });

  let winnerTeam = null;
  if (resultStatus === RESULT_STATUS_FINISHED) {
    const countA = winnerCount.get('A') || 0;
    const countB = winnerCount.get('B') || 0;
    if (countA > 0 || countB > 0) {
      winnerTeam = countA >= countB ? 'A' : 'B';
    }
  }

  return { resultStatus, winnerTeam };
};

const extractAwardEntries = (awards) => (
  [
    ['mvp', awards?.mvp],
    ['best_gk', awards?.best_gk],
    ['red_card', awards?.red_card],
  ].filter(([, award]) => Number.isFinite(Number(award?.player_id)))
);

const fetchSurveyResultsRowForMatch = async (partidoId) => {
  const idNum = Number(partidoId);
  if (!Number.isFinite(idNum) || idNum <= 0) return null;

  const { data, error } = await supabase
    .from('survey_results')
    .select('*')
    .eq('partido_id', idNum)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
};

export async function setMatchAwardsStatus(partidoId, status) {
  const idNum = Number(partidoId);
  if (!Number.isFinite(idNum) || idNum <= 0) {
    return { ok: false, reason: 'invalid_partido_id' };
  }

  const normalizedStatus = String(status || '').trim();
  if (!normalizedStatus) {
    return { ok: false, reason: 'invalid_status' };
  }

  try {
    const { error: surveyResultsError } = await supabase
      .from('survey_results')
      .update({ awards_status: normalizedStatus })
      .eq('partido_id', idNum);

    if (surveyResultsError) {
      if (isMissingColumnError(surveyResultsError, ['awards_status'])) {
        return { ok: false, reason: 'missing_awards_status_column', unsupported: true };
      }
      throw surveyResultsError;
    }
  } catch (error) {
    return { ok: false, reason: 'survey_results_update_failed', error };
  }

  // Best-effort mirror for any codepath still reading partidos.awards_status.
  try {
    const { error: partidoError } = await supabase
      .from('partidos')
      .update({ awards_status: normalizedStatus })
      .eq('id', idNum);

    if (partidoError && !isMissingColumnError(partidoError, ['awards_status'])) {
      console.warn('[AWARDS_STATUS] could not mirror status into partidos', { partidoId: idNum, normalizedStatus, partidoError });
    }
  } catch (partidoMirrorErr) {
    console.warn('[AWARDS_STATUS] partidos mirror failed', { partidoId: idNum, normalizedStatus, partidoMirrorErr });
  }

  return { ok: true };
}
// Calcula y persiste premios (MVP, Mejor Arquero y Tarjeta Roja) en survey_results.awards
export async function computeAndPersistAwards(partidoId, options = {}) {
  const idNum = Number(partidoId);
  if (!Number.isFinite(idNum) || idNum <= 0) {
    return {
      persisted: false,
      reason: 'invalid_partido_id',
      awardsCount: 0,
    };
  }

  const mvpOverridePlayerId = Number(options?.mvpOverridePlayerId);
  const shouldOverrideMvp = Number.isFinite(mvpOverridePlayerId) && mvpOverridePlayerId > 0;
  const skipMvp = options?.skipMvp === true;
  let surveys;
  try {
    surveys = await db.fetchMany('post_match_surveys', { partido_id: idNum });
  } catch (error) {
    handleError(error, { showToast: false, onError: () => { } });
    return {
      persisted: false,
      reason: 'surveys_fetch_failed',
      awardsCount: 0,
      error,
    };
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

  if (skipMvp) {
    awards.mvp = null;
  } else if (shouldOverrideMvp) {
    const mvpKey = String(mvpOverridePlayerId);
    const votesFromMap = Number(mvpMap[mvpKey] || 0);
    const totalVotes = Number(awards?.totals?.mvp || 0);
    const fallbackVotes = Math.max(...Object.values(mvpMap).map((v) => Number(v) || 0), 0);
    const resolvedVotes = votesFromMap > 0 ? votesFromMap : fallbackVotes;
    const denominator = totalVotes > 0 ? totalVotes : Math.max(resolvedVotes, 1);

    awards.mvp = {
      player_id: mvpOverridePlayerId,
      votes: resolvedVotes,
      pct: Math.round((resolvedVotes * 100) / denominator),
      total: denominator,
    };
  }

  const awardEntries = extractAwardEntries(awards);
  const awardsCount = awardEntries.length;
  let surveyResultsUpdated = false;

  try {
    // Persist survey_results awards and mark results_ready true
    // and verify that at least one row was affected.
    const { data: updatedRows, error: upErr } = await supabase
      .from('survey_results')
      .update({ awards, results_ready: true, updated_at: new Date().toISOString() })
      .eq('partido_id', idNum)
      .select('partido_id');

    if (upErr) throw upErr;
    if (!Array.isArray(updatedRows) || updatedRows.length === 0) {
      throw new Error('survey_results_row_not_updated');
    }
    surveyResultsUpdated = true;
  } catch (upErr) {
    handleError(upErr, { showToast: false, onError: () => { } });
    return {
      persisted: false,
      reason: 'survey_results_update_failed',
      awardsCount,
      surveyResultsUpdated: false,
      playerAwardsPersisted: false,
      error: upErr,
      awards,
    };
  }

  if (awardsCount === 0 || !hasAnyAwardData(awards)) {
    return {
      persisted: false,
      reason: 'no_valid_awards_generated',
      awardsCount,
      surveyResultsUpdated,
      playerAwardsPersisted: false,
      awards,
    };
  }

  let grantResult = null;
  // Grant awards to registered players only.
  // Idempotency is enforced at DB level via UNIQUE(partido_id, award_type) + ON CONFLICT DO NOTHING.
  try {
    grantResult = await grantAwardsForMatch(idNum, awards);
  } catch (awardError) {
    handleError(awardError, { showToast: false, onError: () => { } });
    return {
      persisted: false,
      reason: 'player_awards_persist_failed',
      awardsCount,
      surveyResultsUpdated,
      playerAwardsPersisted: false,
      error: awardError,
      awards,
    };
  }

  const expectedRegisteredAwards = Number(grantResult?.expectedRegisteredAwards || 0);
  const persistedRegisteredAwards = Number(grantResult?.persistedRegisteredAwards || 0);
  const skippedReasons = Array.isArray(grantResult?.skipped) ? grantResult.skipped : [];
  const hasHardPersistError = Boolean(grantResult?.error)
    || skippedReasons.some((reason) => String(reason || '').toLowerCase().includes('database error'));
  const playerAwardsPersisted = expectedRegisteredAwards === 0
    || (!hasHardPersistError && persistedRegisteredAwards >= expectedRegisteredAwards);

  if (!playerAwardsPersisted) {
    return {
      persisted: false,
      reason: 'player_awards_incomplete',
      awardsCount,
      surveyResultsUpdated,
      playerAwardsPersisted: false,
      expectedRegisteredAwards,
      persistedRegisteredAwards,
      grantResult,
      awards,
    };
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

  return {
    persisted: true,
    reason: 'ok',
    awardsCount,
    surveyResultsUpdated,
    playerAwardsPersisted: true,
    expectedRegisteredAwards,
    persistedRegisteredAwards,
    grantResult,
    awards,
  };
}

const toNumericIdFromRef = (value, refToIdMap) => {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;

  const token = String(value).trim();
  if (!token) return null;
  if (/^\d+$/.test(token)) return Number(token);

  const mapped = refToIdMap.get(normalizeRef(token));
  return Number.isFinite(mapped) ? mapped : null;
};

const resolveScorelineFromSurveys = (surveys = []) => {
  const scorelineCount = new Map();
  (surveys || []).forEach((survey) => {
    const token = String(survey?.resultado || '').trim();
    if (!/^\d+\s*-\s*\d+$/.test(token)) return;
    scorelineCount.set(token, (scorelineCount.get(token) || 0) + 1);
  });

  let winner = null;
  let best = -1;
  Array.from(scorelineCount.entries()).forEach(([scoreline, count]) => {
    if (count > best) {
      winner = scoreline;
      best = count;
    }
  });

  return winner;
};

const buildPlayerIdentityMapsForMatch = async (partidoId) => {
  const { data: rows, error } = await supabase
    .from('jugadores')
    .select('id, uuid, usuario_id')
    .eq('partido_id', partidoId);

  if (error) throw error;

  const refToIdMap = new Map();
  const idToPlayerRef = new Map();
  (rows || []).forEach((row) => {
    const id = Number(row?.id);
    if (!Number.isFinite(id)) return;

    const stableRef = row?.uuid || row?.usuario_id || String(id);
    idToPlayerRef.set(id, stableRef);

    [row?.uuid, row?.usuario_id, row?.id, stableRef]
      .map((value) => normalizeRef(value))
      .filter(Boolean)
      .forEach((ref) => refToIdMap.set(ref, id));
  });

  return { refToIdMap, idToPlayerRef };
};

const mapTeamRefsToIdSet = (refs = [], refToIdMap) => {
  const ids = new Set();

  (Array.isArray(refs) ? refs : []).forEach((value) => {
    const id = toNumericIdFromRef(value, refToIdMap);
    if (Number.isFinite(id)) ids.add(id);
  });

  return ids;
};

const resolveEffectiveTeamIdSets = async (partidoId, refToIdMap) => {
  let matchRow = null;
  try {
    const { data, error } = await supabase
      .from('partidos')
      .select('teams_confirmed, teams_source, survey_team_a, survey_team_b, final_team_a, final_team_b')
      .eq('id', partidoId)
      .maybeSingle();
    if (!error) {
      matchRow = data || null;
    }
  } catch (_error) {
    matchRow = null;
  }

  let source = 'survey';
  let teamARefs = [];
  let teamBRefs = [];

  const surveyTeamA = Array.isArray(matchRow?.survey_team_a) ? matchRow.survey_team_a : [];
  const surveyTeamB = Array.isArray(matchRow?.survey_team_b) ? matchRow.survey_team_b : [];
  const finalTeamA = Array.isArray(matchRow?.final_team_a) ? matchRow.final_team_a : [];
  const finalTeamB = Array.isArray(matchRow?.final_team_b) ? matchRow.final_team_b : [];

  if (surveyTeamA.length > 0 && surveyTeamB.length > 0) {
    source = String(matchRow?.teams_source || 'survey');
    teamARefs = surveyTeamA;
    teamBRefs = surveyTeamB;
  } else if (finalTeamA.length > 0 && finalTeamB.length > 0) {
    source = 'final';
    teamARefs = finalTeamA;
    teamBRefs = finalTeamB;
  } else if (matchRow?.teams_confirmed === true) {
    source = 'admin';
    try {
      const { data: confirmationRow, error: confirmationError } = await supabase
        .from('partido_team_confirmations')
        .select('team_a, team_b')
        .eq('partido_id', partidoId)
        .maybeSingle();
      if (!confirmationError && confirmationRow) {
        teamARefs = Array.isArray(confirmationRow.team_a) ? confirmationRow.team_a : [];
        teamBRefs = Array.isArray(confirmationRow.team_b) ? confirmationRow.team_b : [];
      }
    } catch (_error) {
      // Non-blocking fallback.
    }
  }

  return {
    source,
    teamAIds: mapTeamRefsToIdSet(teamARefs, refToIdMap),
    teamBIds: mapTeamRefsToIdSet(teamBRefs, refToIdMap),
  };
};

const resolvePlayerIdFromStableRef = async (partidoId, stableRef) => {
  const token = normalizeRef(stableRef);
  if (!token) return null;

  const { data: rows, error } = await supabase
    .from('jugadores')
    .select('id, uuid, usuario_id')
    .eq('partido_id', partidoId);

  if (error) throw error;

  for (const row of (rows || [])) {
    const id = Number(row?.id);
    if (!Number.isFinite(id)) continue;
    const refs = [
      row?.uuid,
      row?.usuario_id,
      row?.id,
      row?.uuid || row?.usuario_id || String(id),
    ].map((value) => normalizeRef(value));
    if (refs.includes(token)) return id;
  }

  return null;
};

const toSafeInt = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.trunc(parsed));
};

const addDurationMs = (isoString, durationMs) => {
  const baseTime = new Date(isoString).getTime();
  if (!Number.isFinite(baseTime)) return new Date(Date.now() + durationMs).toISOString();
  return new Date(baseTime + durationMs).toISOString();
};

const isMissingColumnError = (error, columns = []) => {
  const message = String(error?.message || '').toLowerCase();
  if (!message) return false;
  if (columns.length === 0) {
    return message.includes('does not exist') || String(error?.code || '') === '42703';
  }
  return columns.some((column) => message.includes(String(column).toLowerCase()));
};

const isMissingRpcFunctionError = (error, fnName) => {
  const token = String(fnName || '').trim().toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  const details = String(error?.details || '').toLowerCase();
  const hint = String(error?.hint || '').toLowerCase();
  const code = String(error?.code || '').toUpperCase();
  const combined = `${message} ${details} ${hint}`;

  if (code === 'PGRST202' || code === '42883') return true;
  if (!token) return combined.includes('could not find the function') || combined.includes('does not exist');
  return (
    combined.includes('could not find the function')
    || combined.includes('does not exist')
    || combined.includes(token)
  );
};

const closeSurveyLifecycleViaRpc = async ({
  partidoId,
  openedAt,
  closesAt,
  expectedVoters,
  resultStatus,
  winnerTeam,
  finishedAt,
}) => {
  const rpcName = 'finalize_match_survey_closure';
  const { data, error } = await supabase.rpc(rpcName, {
    p_partido_id: partidoId,
    p_opened_at: openedAt || null,
    p_closes_at: closesAt || null,
    p_expected_voters: Number.isFinite(Number(expectedVoters))
      ? Math.max(0, Math.trunc(Number(expectedVoters)))
      : 0,
    p_result_status: resultStatus || RESULT_STATUS_PENDING,
    p_winner_team: winnerTeam || null,
    p_finished_at: finishedAt || null,
  });

  if (error) {
    if (isMissingRpcFunctionError(error, rpcName)) {
      return { supported: false, reason: 'missing_rpc_function', error };
    }
    throw error;
  }

  const payload = (data && typeof data === 'object') ? data : {};
  if (payload.success !== true) {
    return {
      supported: true,
      success: false,
      reason: payload.reason || 'rpc_failed',
      payload,
    };
  }

  return {
    supported: true,
    success: true,
    closedByThisCall: payload.closed_by_this_call === true,
    alreadyClosed: payload.already_closed === true,
    lifecycle: {
      survey_status: payload.survey_status || null,
      result_status: payload.result_status || null,
      winner_team: payload.winner_team || null,
      finished_at: payload.finished_at || null,
    },
  };
};

const buildEligibleRosterMap = (rows = []) => {
  const byPlayerId = new Map();
  const eligibleUserIds = new Set();

  (rows || []).forEach((row) => {
    const playerId = Number(row?.id);
    const userId = row?.usuario_id || null;
    if (!Number.isFinite(playerId) || !userId) return;
    byPlayerId.set(playerId, userId);
    eligibleUserIds.add(String(userId));
  });

  return {
    byPlayerId,
    expectedVoters: eligibleUserIds.size,
  };
};

const getDistinctSubmittedEligibleVoters = async (partidoId, eligibleByPlayerId = new Map()) => {
  const { data: surveysRows, error: surveysErr } = await supabase
    .from('post_match_surveys')
    .select('votante_id')
    .eq('partido_id', partidoId);

  if (surveysErr) {
    console.error('[FINALIZE] error fetching surveysRows', { partidoId, surveysErr });
    throw surveysErr;
  }

  const submittedUsers = new Set();
  (surveysRows || []).forEach((row) => {
    const voterId = Number(row?.votante_id);
    if (!Number.isFinite(voterId)) return;
    const userId = eligibleByPlayerId.get(voterId);
    if (!userId) return;
    submittedUsers.add(String(userId));
  });

  return submittedUsers;
};

const fetchSurveyLifecycleRow = async (partidoId) => {
  try {
    const { data, error } = await supabase
      .from('partidos')
      .select('survey_status, survey_opened_at, survey_closes_at, survey_expected_voters, result_status, winner_team, finished_at')
      .eq('id', partidoId)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  } catch (error) {
    if (isMissingColumnError(error, ['survey_status', 'survey_opened_at', 'survey_closes_at', 'survey_expected_voters'])) {
      return null;
    }
    throw error;
  }
};

export async function ensureSurveyWindowOpen(partidoId, options = {}) {
  const idNum = Number(partidoId);
  if (!Number.isFinite(idNum) || idNum <= 0) {
    return {
      openedAt: null,
      closesAt: null,
      expectedVoters: 0,
      submittedVoters: 0,
      remainingVotes: 0,
      surveyStatus: SURVEY_STATUS_OPEN,
      eligibleByPlayerId: new Map(),
      deadlineReached: false,
      allEligibleVoted: true,
    };
  }

  const nowIso = options?.nowIso || new Date().toISOString();
  const { data: rosterRows, error: rosterErr } = await supabase
    .from('jugadores')
    .select('id, usuario_id')
    .eq('partido_id', idNum);

  if (rosterErr) {
    console.error('[FINALIZE] error fetching roster rows', { partidoId: idNum, rosterErr });
    throw rosterErr;
  }

  const eligibleRoster = buildEligibleRosterMap(rosterRows || []);
  const lifecycleRow = await fetchSurveyLifecycleRow(idNum);
  const normalizedStatus = normalizeSurveyStatusValue(lifecycleRow?.survey_status);

  const openedAt = lifecycleRow?.survey_opened_at || nowIso;
  const closesAt = lifecycleRow?.survey_closes_at || addDurationMs(openedAt, SURVEY_FINALIZE_DELAY_MS);
  const storedExpectedVoters = Number.isFinite(Number(lifecycleRow?.survey_expected_voters))
    ? toSafeInt(lifecycleRow.survey_expected_voters, 0)
    : 0;
  const computedEligibleNow = toSafeInt(eligibleRoster.expectedVoters, 0);
  const expectedVoters = resolveMonotonicExpectedVoters({
    storedExpectedVoters,
    computedEligibleVoters: computedEligibleNow,
  });

  // Initialize survey metadata once at survey start.
  const shouldPersistOpenWindow = normalizeSurveyStatusValue(lifecycleRow?.survey_status) !== SURVEY_STATUS_CLOSED
    && (
      !lifecycleRow
      || !lifecycleRow?.survey_opened_at
      || !lifecycleRow?.survey_closes_at
      || !Number.isFinite(Number(lifecycleRow?.survey_expected_voters))
      || !normalizeSurveyStatusValue(lifecycleRow?.survey_status)
    );

  if (shouldPersistOpenWindow) {
    try {
      await supabase
        .from('partidos')
        .update({
          survey_status: SURVEY_STATUS_OPEN,
          survey_opened_at: openedAt,
          survey_closes_at: closesAt,
          survey_expected_voters: expectedVoters,
        })
        .eq('id', idNum)
        .neq('survey_status', SURVEY_STATUS_CLOSED);
    } catch (_persistError) {
      // Non-blocking fallback for environments that don't have survey lifecycle columns yet.
    }
  } else if (shouldBumpExpectedVoters({
    surveyStatus: normalizedStatus,
    storedExpectedVoters,
    computedEligibleVoters: computedEligibleNow,
  })) {
    // Keep expected voters monotonic upward while open.
    // We never touch closes_at here and never decrease expected.
    try {
      await supabase
        .from('partidos')
        .update({
          survey_expected_voters: expectedVoters,
        })
        .eq('id', idNum)
        .eq('survey_status', SURVEY_STATUS_OPEN)
        .lt('survey_expected_voters', expectedVoters);
    } catch (_bumpError) {
      // Non-blocking.
    }
  }

  const submittedUsers = await getDistinctSubmittedEligibleVoters(idNum, eligibleRoster.byPlayerId);
  const submittedVoters = submittedUsers.size;
  const remainingVotes = Math.max(expectedVoters - submittedVoters, 0);
  const deadlineReached = Date.now() >= new Date(closesAt).getTime();
  const allEligibleVoted = submittedVoters >= expectedVoters;

  return {
    openedAt,
    closesAt,
    expectedVoters,
    submittedVoters,
    remainingVotes,
    surveyStatus: normalizedStatus || SURVEY_STATUS_OPEN,
    eligibleByPlayerId: eligibleRoster.byPlayerId,
    deadlineReached,
    allEligibleVoted,
  };
}

export async function finalizeIfComplete(partidoId, options = {}) {
  const SKIP_SIDE_EFFECTS = options.skipSideEffects === true;
  const idNum = Number(partidoId);
  if (!Number.isFinite(idNum) || idNum <= 0) {
    throw new Error('invalid_partido_id');
  }

  const nowIso = new Date().toISOString();
  let partidoNombre = `partido ${idNum}`;

  try {
    const { data: partidoMeta } = await supabase
      .from('partidos')
      .select('nombre')
      .eq('id', idNum)
      .maybeSingle();
    if (partidoMeta?.nombre) {
      partidoNombre = partidoMeta.nombre;
    }
  } catch (_partidoMetaError) {
    // Non-blocking fallback.
  }

  // Phase 1 snapshot (best-effort): keep historical participants/equipos frozen as early as possible.
  try {
    await ensureParticipantsSnapshot(idNum);
  } catch (_snapshotError) {
    // Non-blocking.
  }

  const surveyWindow = await ensureSurveyWindowOpen(idNum, { nowIso });
  const {
    openedAt,
    closesAt,
    expectedVoters,
    submittedVoters,
    remainingVotes,
    surveyStatus,
    deadlineReached,
    allEligibleVoted,
  } = surveyWindow;

  if (surveyStatus === SURVEY_STATUS_CLOSED) {
    const lifecycle = await fetchSurveyLifecycleRow(idNum);
    return {
      done: true,
      alreadyClosed: true,
      expectedVoters,
      submissionsCount: submittedVoters,
      remainingVotes: 0,
      deadlineAt: closesAt,
      closedAt: lifecycle?.finished_at || null,
      result_status: normalizeResultStatusValue(lifecycle?.result_status) || RESULT_STATUS_PENDING,
      winner_team: normalizeWinnerTeamValue(lifecycle?.winner_team) || null,
      survey_status: SURVEY_STATUS_CLOSED,
    };
  }

  if (!shouldFinalizeSurveyClosure({
    submissionsCount: submittedVoters,
    expectedVoters,
    deadlineReached,
  })) {
    return {
      done: false,
      expectedVoters,
      submissionsCount: submittedVoters,
      remainingVotes,
      deadlineAt: closesAt,
      survey_status: SURVEY_STATUS_OPEN,
    };
  }

  const results = await computeResultsAverages(idNum);
  const computedStatus = normalizeResultStatusValue(results?.result_status) || RESULT_STATUS_PENDING;
  const computedWinner = normalizeWinnerTeamValue(results?.winner_team) || null;
  const computedFinishedAt = computedStatus === RESULT_STATUS_PENDING
    ? null
    : (results?.finished_at || nowIso);

  let closedByThisCall = false;
  let lifecycleAfterClose = null;
  try {
    const rpcClose = await closeSurveyLifecycleViaRpc({
      partidoId: idNum,
      openedAt: openedAt || nowIso,
      closesAt: closesAt || addDurationMs(nowIso, SURVEY_FINALIZE_DELAY_MS),
      expectedVoters,
      resultStatus: computedStatus,
      winnerTeam: computedWinner,
      finishedAt: computedFinishedAt,
    });

    if (rpcClose?.supported === true) {
      if (rpcClose?.success !== true) {
        throw new Error(`finalize_match_survey_closure_failed:${rpcClose?.reason || 'unknown'}`);
      }
      closedByThisCall = rpcClose.closedByThisCall === true;
      lifecycleAfterClose = rpcClose.lifecycle || null;
    } else {
      const closePayload = {
        survey_status: SURVEY_STATUS_CLOSED,
        survey_opened_at: openedAt || nowIso,
        survey_closes_at: closesAt || addDurationMs(nowIso, SURVEY_FINALIZE_DELAY_MS),
        survey_expected_voters: expectedVoters,
        result_status: computedStatus,
        winner_team: computedWinner,
        finished_at: computedFinishedAt,
      };

      const { data: closeRow, error: closeErr } = await supabase
        .from('partidos')
        .update(closePayload)
        .eq('id', idNum)
        .eq('survey_status', SURVEY_STATUS_OPEN)
        .select('id')
        .maybeSingle();

      if (closeErr) {
        const missingLifecycleCols = isMissingColumnError(closeErr, [
          'survey_status',
          'survey_opened_at',
          'survey_closes_at',
          'survey_expected_voters',
        ]);
        if (!missingLifecycleCols) throw closeErr;

        // Legacy fallback (non-atomic): keep closure fields coherent where new columns are unavailable.
        const { error: legacyCloseErr } = await supabase
          .from('partidos')
          .update({
            result_status: computedStatus,
            winner_team: computedWinner,
            finished_at: computedFinishedAt,
          })
          .eq('id', idNum)
          .is('finished_at', null);
        if (legacyCloseErr && !isMissingColumnError(legacyCloseErr, ['result_status', 'winner_team', 'finished_at'])) {
          throw legacyCloseErr;
        }
        closedByThisCall = true;
      } else {
        closedByThisCall = Boolean(closeRow?.id);
      }
    }
  } catch (error) {
    console.error('[FINALIZE] close guard failed', { partidoId: idNum, error });
    throw error;
  }

  if (!closedByThisCall) {
    const lifecycle = lifecycleAfterClose || await fetchSurveyLifecycleRow(idNum);
    const latestStatus = normalizeSurveyStatusValue(lifecycle?.survey_status);
    if (latestStatus === SURVEY_STATUS_CLOSED) {
      return {
        done: true,
        alreadyClosed: true,
        expectedVoters,
        submissionsCount: submittedVoters,
        remainingVotes: 0,
        deadlineAt: closesAt,
        closedAt: lifecycle?.finished_at || null,
        result_status: normalizeResultStatusValue(lifecycle?.result_status) || RESULT_STATUS_PENDING,
        winner_team: normalizeWinnerTeamValue(lifecycle?.winner_team) || null,
        survey_status: SURVEY_STATUS_CLOSED,
      };
    }

    return {
      done: false,
      expectedVoters,
      submissionsCount: submittedVoters,
      remainingVotes,
      deadlineAt: closesAt,
      survey_status: SURVEY_STATUS_OPEN,
    };
  }

  // Persist survey_results closure payload after atomic close is won.
  const basePayload = {
    partido_id: idNum,
    mvp: results?.mvp ?? null,
    golden_glove: results?.golden_glove ?? null,
    red_cards: Array.isArray(results?.red_cards) ? results.red_cards : [],
    winner_team: computedWinner,
    scoreline: results?.scoreline ?? null,
    result_status: computedStatus,
    finished_at: computedFinishedAt,
    results_ready: true,
  };

  const safeUpsert = async (payload) => {
    const firstTry = await supabase.from('survey_results').upsert(payload, { onConflict: 'partido_id' });
    if (!firstTry.error) return firstTry;

    const message = String(firstTry.error?.message || '');
    const legacyPayload = { ...payload };
    if (/winner_team|scoreline/i.test(message)) {
      delete legacyPayload.winner_team;
      delete legacyPayload.scoreline;
    }
    if (/result_status/i.test(message)) {
      delete legacyPayload.result_status;
    }
    if (/finished_at/i.test(message)) {
      delete legacyPayload.finished_at;
    }

    const removedColumns = Object.keys(payload).length !== Object.keys(legacyPayload).length;
    if (!removedColumns) return firstTry;
    return supabase.from('survey_results').upsert(legacyPayload, { onConflict: 'partido_id' });
  };

  const payloadVariants = [
    basePayload,
    {
      partido_id: idNum,
      mvp: results?.mvp ?? null,
      golden_glove: results?.golden_glove ?? null,
      winner_team: computedWinner,
      result_status: computedStatus,
      finished_at: computedFinishedAt,
      results_ready: true,
    },
    {
      partido_id: idNum,
      winner_team: computedWinner,
      result_status: computedStatus,
      finished_at: computedFinishedAt,
      results_ready: true,
    },
    {
      partido_id: idNum,
      result_status: computedStatus,
      finished_at: computedFinishedAt,
      results_ready: true,
    },
    { partido_id: idNum, results_ready: true },
  ];

  let upsertRes = null;
  for (const payload of payloadVariants) {
    upsertRes = await safeUpsert(payload);
    if (!upsertRes.error) break;
  }
  if (upsertRes?.error) throw upsertRes.error;

  // Side effects run only for the process that successfully closed the survey.
  if (!SKIP_SIDE_EFFECTS) {
    try {
      const penaltiesResult = await applyNoShowPenalties(idNum);
      if (penaltiesResult?.error) throw penaltiesResult.error;
    } catch (penErr) {
      console.error('[FINALIZE] applyNoShowPenalties error', { partidoId: idNum, penErr });
    }

    try {
      const recoveriesResult = await applyNoShowRecoveries(idNum);
      if (recoveriesResult?.error) throw recoveriesResult.error;
    } catch (recErr) {
      console.error('[NO_SHOW_RECOVERY] error', recErr);
    }
  }

  let awardsSkipped = computedStatus === RESULT_STATUS_NOT_PLAYED;
  let awardsPendingRetry = false;
  let awardsPersistResult = null;
  let finalAwardsStatus = null;

  if (computedStatus === RESULT_STATUS_NOT_PLAYED) {
    finalAwardsStatus = 'skipped_not_played';
    const statusRes = await setMatchAwardsStatus(idNum, finalAwardsStatus);
    if (!statusRes?.ok && !statusRes?.unsupported) {
      console.warn('[FINALIZE] failed to persist skipped_not_played awards status', { partidoId: idNum, statusRes });
    }
  } else {
    try {
      const mvpOverridePlayerId = await resolvePlayerIdFromStableRef(idNum, results?.mvp);
      awardsPersistResult = await computeAndPersistAwards(idNum, {
        mvpOverridePlayerId,
        skipMvp: false,
      });
      if (awardsPersistResult?.persisted !== true) {
        console.error('[FINALIZE] computeAndPersistAwards returned non-persisted result', {
          partidoId: idNum,
          awardsPersistResult,
        });
      }
    } catch (awardErr) {
      console.error('[FINALIZE] computeAndPersistAwards exception', { partidoId: idNum, awardErr });
      handleError(awardErr, { showToast: false, onError: () => { } });
      awardsPersistResult = {
        persisted: false,
        reason: 'compute_exception',
        awardsCount: 0,
      };
    }

    let awardsRow = null;
    try {
      awardsRow = await fetchSurveyResultsRowForMatch(idNum);
    } catch (awardsRowErr) {
      console.error('[FINALIZE] could not refetch survey_results for awards validation', { partidoId: idNum, awardsRowErr });
    }

    const awardsReadyNow = isAwardsTrulyReady(awardsRow);
    if (awardsReadyNow) {
      finalAwardsStatus = 'ready';
    } else {
      finalAwardsStatus = 'pending_retry';
      awardsPendingRetry = true;
      console.warn('[FINALIZE] awards not ready after close; pending retry', {
        partidoId: idNum,
        persistResult: awardsPersistResult,
      });
    }

    const statusRes = await setMatchAwardsStatus(idNum, finalAwardsStatus);
    if (!statusRes?.ok && !statusRes?.unsupported) {
      console.warn('[FINALIZE] failed to persist awards status', { partidoId: idNum, finalAwardsStatus, statusRes });
    }
  }

  if (!SKIP_SIDE_EFFECTS) {
    try {
      let jugadoresForNotifs = await db.fetchMany('jugadores', { partido_id: idNum });
      jugadoresForNotifs = (jugadoresForNotifs || []).filter((j) => j.usuario_id != null);

      let existingNotifs = [];
      try {
        existingNotifs = await db.fetchMany('notifications', { partido_id: idNum, type: 'survey_finished' });
      } catch (_notifReadErr) {
        existingNotifs = [];
      }

      const alreadyNotifiedUserIds = new Set((existingNotifs || []).map((n) => n.user_id).filter(Boolean));
      const jugadoresToInsert = (jugadoresForNotifs || []).filter((j) => !alreadyNotifiedUserIds.has(j.usuario_id));

      if (jugadoresToInsert.length > 0) {
        const notificationPayloads = jugadoresToInsert.map((j) => ({
          user_id: j.usuario_id,
          type: 'survey_finished',
          title: 'Encuesta finalizada',
          message: getSurveyResultsReadyMessage({ matchName: partidoNombre }),
          partido_id: idNum,
          data: {
            match_id: String(idNum),
            match_name: partidoNombre,
            partido_nombre: partidoNombre,
            link: `/resultados-encuesta/${idNum}`,
            resultsUrl: `/resultados-encuesta/${idNum}?showAwards=1`,
          },
          read: false,
          created_at: nowIso,
        }));

        const { error: notifErr } = await supabase
          .from('notifications')
          .insert(notificationPayloads);
        if (notifErr) throw notifErr;
      }
    } catch (notifErr) {
      console.error('[FINALIZE] notification side effects error', { partidoId: idNum, notifErr });
    }
  }

  try {
    await ensureSurveyResultsSnapshot(idNum, {
      encuestaCerradaAt: nowIso,
      closedReason: allEligibleVoted ? 'all_voted' : 'deadline',
    });
  } catch (_snapshotError) {
    // Non-blocking.
  }

  return {
    done: true,
    expectedVoters,
    submissionsCount: submittedVoters,
    remainingVotes: 0,
    deadlineAt: closesAt,
    awardsSkipped,
    awardsPendingRetry,
    awards_status: finalAwardsStatus,
    awardsPersisted: Boolean(awardsPersistResult?.persisted),
    awardsPersistReason: awardsPersistResult?.reason || null,
    result_status: computedStatus,
    winner_team: computedWinner,
    survey_status: SURVEY_STATUS_CLOSED,
  };
}

export async function computeResultsAverages(partidoId) {
  let surveys = [];
  try {
    const { data, error } = await supabase
      .from('post_match_surveys')
      .select('votante_id, se_jugo, mejor_jugador_eq_a, mejor_jugador_eq_b, jugadores_violentos, ganador, resultado')
      .eq('partido_id', partidoId);
    if (error) throw error;
    surveys = data || [];
  } catch (_error) {
    const { data, error } = await supabase
      .from('post_match_surveys')
      .select('votante_id, se_jugo, mejor_jugador_eq_a, mejor_jugador_eq_b, jugadores_violentos, ganador')
      .eq('partido_id', partidoId);
    if (error) throw error;
    surveys = data || [];
  }

  const totalVotantes = new Set((surveys || []).map((row) => row?.votante_id).filter(Boolean)).size || 0;
  const { resultStatus, winnerTeam } = aggregateSurveyResult(surveys);

  const { refToIdMap, idToPlayerRef } = await buildPlayerIdentityMapsForMatch(partidoId);
  const { teamAIds, teamBIds } = await resolveEffectiveTeamIdSets(partidoId, refToIdMap);

  const toNumId = (value) => toNumericIdFromRef(value, refToIdMap);
  const normalizeIdArray = (values = []) => (
    (Array.isArray(values) ? values : [])
      .map((value) => toNumId(value))
      .filter((id) => Number.isFinite(id))
  );

  const mvpCount = new Map();
  const gkCount = new Map();
  const violentCount = new Map();

  for (const survey of (surveys || [])) {
    const surveySaysNotPlayed = survey?.se_jugo === false
      || normalizeResultStatusValue(survey?.resultado) === RESULT_STATUS_NOT_PLAYED;
    if (surveySaysNotPlayed) continue;

    const mvpId = toNumId(survey?.mejor_jugador_eq_a);
    if (Number.isFinite(mvpId)) {
      mvpCount.set(mvpId, (mvpCount.get(mvpId) || 0) + 1);
    }

    const gkId = toNumId(survey?.mejor_jugador_eq_b);
    if (Number.isFinite(gkId)) {
      gkCount.set(gkId, (gkCount.get(gkId) || 0) + 1);
    }

    normalizeIdArray(survey?.jugadores_violentos || []).forEach((id) => {
      violentCount.set(id, (violentCount.get(id) || 0) + 1);
    });
  }

  const getTopCandidates = (map) => {
    const entries = Array.from(map.entries());
    if (entries.length === 0) return [];
    const maxVotes = Math.max(...entries.map(([, votes]) => Number(votes) || 0));
    return entries
      .filter(([, votes]) => Number(votes) === maxVotes)
      .map(([id]) => Number(id))
      .filter((id) => Number.isFinite(id))
      .sort((a, b) => a - b);
  };

  const topMvpCandidates = getTopCandidates(mvpCount);
  const topGkCandidates = getTopCandidates(gkCount);

  const mvpIdNum = resolveMvpTieBreakWinner({
    candidateIds: topMvpCandidates,
    resultStatus,
    winnerTeam,
    teamAIds,
    teamBIds,
  });

  const gkIdNum = resultStatus === RESULT_STATUS_NOT_PLAYED
    ? null
    : (topGkCandidates[0] || null);

  const threshold = totalVotantes > 0 ? Math.ceil(totalVotantes * 0.25) : Infinity;
  const redIdsNum = resultStatus === RESULT_STATUS_NOT_PLAYED
    ? []
    : Array.from(violentCount.entries())
      .filter(([, count]) => Number(count) >= threshold)
      .map(([id]) => Number(id))
      .filter((id) => Number.isFinite(id))
      .sort((a, b) => a - b);

  const finishedAt = resultStatus === RESULT_STATUS_PENDING ? null : new Date().toISOString();

  return {
    mvp: mvpIdNum ? idToPlayerRef.get(mvpIdNum) || String(mvpIdNum) : null,
    golden_glove: gkIdNum ? idToPlayerRef.get(gkIdNum) || String(gkIdNum) : null,
    red_cards: redIdsNum.map((id) => idToPlayerRef.get(id) || String(id)).filter(Boolean),
    winner_team: winnerTeam || null,
    scoreline: resolveScorelineFromSurveys(surveys),
    result_status: resultStatus,
    finished_at: finishedAt,
  };
}
