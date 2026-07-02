// Pure helpers for the shareable "RESUMEN DEL PARTIDO" image card.
//
// Mirrors buildTeamsShareCardData: everything here is presentation-agnostic
// data derivation so it can be unit-tested without a DOM and reused from the
// results view, Mis partidos and Home without duplicating visibility rules.
//
// The share/visibility gate is intentionally strict: a summary only "exists"
// when the survey produced real results (results_ready) AND the awards flow
// reached "ready" (not_eligible means there were not enough votes).

import { isAwardsReadyStatus, hasAnyAwardData } from './awardsReadiness';
import { formatVenueShort } from './venueFormat';
import { SHARE_CARD_WEBSITE } from './buildTeamsShareCardData';
import { parseLocalDate } from './dateLocal';

export const MATCH_SUMMARY_CARD_TITLE = 'RESUMEN DEL PARTIDO';
export const MATCH_SUMMARY_VENUE_MAX_LEN = 30;

const cleanText = (value) => String(value ?? '').trim();

const normalizeToken = (value) => cleanText(value).toLowerCase();

// Normalizers kept in sync with services/surveyCompletionService (not imported
// from there to keep this module free of the supabase client).
export const normalizeWinnerTeam = (value) => {
  const token = normalizeToken(value);
  if (!token) return null;
  if (['a', 'equipo_a', 'team_a', 'gano_a', 'winner_a'].includes(token)) return 'A';
  if (['b', 'equipo_b', 'team_b', 'gano_b', 'winner_b'].includes(token)) return 'B';
  return null;
};

export const normalizeResultStatus = (value) => {
  const token = normalizeToken(value);
  if (!token) return null;
  if (['finished', 'played', 'jugo', 'jugado', 'se_jugo'].includes(token)) return 'finished';
  if (['draw', 'empate', 'drawn', 'tie'].includes(token)) return 'draw';
  if (['not_played', 'cancelled', 'canceled', 'cancelado', 'no_jugado', 'notplayed'].includes(token)) return 'not_played';
  if (['pending', 'pendiente'].includes(token)) return 'pending';
  return null;
};

/**
 * True only when the survey summary can really be generated/shared:
 * closed survey with real results and awards resolved as ready (enough votes).
 * A `not_eligible` awards status (insufficient voters) always returns false.
 *
 * @param {Object|null} resultsRow - survey_results row
 */
export const canShareMatchSummary = (resultsRow) => Boolean(
  resultsRow
  && resultsRow.results_ready === true
  && isAwardsReadyStatus(resultsRow)
  && hasAnyAwardData(resultsRow),
);

/**
 * Alias with clearer intent for "should this results entry point exist at all"
 * (Home card, Mis partidos actions). Same rule as sharing: no real results,
 * no CTA.
 */
export const canShowSurveyResultsSummary = canShareMatchSummary;

/**
 * Short venue label for shareable pieces: prefers a proper place name and
 * falls back to the first meaningful block of a long address. Returns null
 * when nothing usable exists (never a raw long address).
 */
export const getShortVenueLabel = (partido = {}, { maxLen = MATCH_SUMMARY_VENUE_MAX_LEN } = {}) => (
  formatVenueShort({
    name: partido?.venue_name || partido?.place_name || '',
    formattedAddress: partido?.sede || partido?.sede_direccion_normalizada || '',
    address: partido?.sede_direccion_normalizada || '',
  }, { maxLen }) || null
);

// dd/mm/yy, mirroring the match header + teams share card.
const formatShareDate = (rawFecha) => {
  const fecha = cleanText(rawFecha);
  if (!fecha) return null;
  const normalized = fecha.slice(0, 10);
  try {
    const d = parseLocalDate(normalized);
    if (!d || !Number.isFinite(d.getTime())) return normalized;
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yy = String(d.getFullYear()).slice(-2);
    return `${dd}/${mm}/${yy}`;
  } catch (_error) {
    return normalized;
  }
};

const IDENTITY_KEYS = ['uuid', 'usuario_id', 'user_id', 'auth_id', 'id'];

const identityTokensFor = (player) => IDENTITY_KEYS
  .map((key) => normalizeToken(player?.[key]))
  .filter(Boolean);

const buildRosterIndex = (jugadores = []) => {
  const byToken = new Map();
  (Array.isArray(jugadores) ? jugadores : []).forEach((player) => {
    identityTokensFor(player).forEach((token) => {
      if (!byToken.has(token)) byToken.set(token, player);
    });
  });
  return byToken;
};

const findPlayerByRef = (rosterIndex, ref) => {
  const token = normalizeToken(ref);
  if (!token) return null;
  return rosterIndex.get(token) || null;
};

const resolveTeamPlayerNames = (refs, rosterIndex) => {
  const names = [];
  const seen = new Set();
  (Array.isArray(refs) ? refs : []).forEach((ref) => {
    const player = findPlayerByRef(rosterIndex, ref);
    const name = cleanText(player?.nombre);
    if (!name) return;
    const key = normalizeToken(name);
    if (seen.has(key)) return;
    seen.add(key);
    names.push(name);
  });
  return names;
};

const resolveTeamRefs = (partido = {}) => {
  const surveyA = Array.isArray(partido?.survey_team_a) ? partido.survey_team_a : [];
  const surveyB = Array.isArray(partido?.survey_team_b) ? partido.survey_team_b : [];
  if (surveyA.length > 0 && surveyB.length > 0) return { teamARefs: surveyA, teamBRefs: surveyB };

  const finalA = Array.isArray(partido?.final_team_a) ? partido.final_team_a : [];
  const finalB = Array.isArray(partido?.final_team_b) ? partido.final_team_b : [];
  if (finalA.length > 0 && finalB.length > 0) return { teamARefs: finalA, teamBRefs: finalB };

  return { teamARefs: [], teamBRefs: [] };
};

const AWARD_DEFINITIONS = [
  {
    kind: 'mvp',
    label: 'MVP',
    icon: '/mvp_award.webp',
    color: '#FFD700',
    winnerId: (results) => results?.mvp ?? results?.awards?.mvp?.player_id ?? null,
    winnerName: (results) => results?.mvp_nombre ?? null,
  },
  {
    kind: 'glove',
    label: 'MEJOR ARQUERO',
    icon: '/goalkeeper_award.webp',
    color: '#22d3ee',
    winnerId: (results) => results?.golden_glove ?? results?.awards?.best_gk?.player_id ?? null,
    winnerName: (results) => results?.golden_glove_nombre ?? null,
  },
  {
    kind: 'dirty',
    label: 'MÁS SUCIO',
    icon: '/redcard_award.webp',
    color: '#f87171',
    winnerId: (results) => (
      results?.dirty_player
      ?? (Array.isArray(results?.red_cards) ? results.red_cards[0] : null)
      ?? results?.awards?.red_card?.player_id
      ?? null
    ),
    winnerName: (results) => results?.dirty_player_nombre ?? null,
  },
];

const resolveAwards = (results, rosterIndex) => AWARD_DEFINITIONS
  .map((definition) => {
    const winnerId = definition.winnerId(results);
    if (winnerId === null || winnerId === undefined || cleanText(winnerId) === '') return null;
    const player = findPlayerByRef(rosterIndex, winnerId);
    const playerName = cleanText(definition.winnerName(results)) || cleanText(player?.nombre);
    if (!playerName) return null;
    return {
      kind: definition.kind,
      label: definition.label,
      icon: definition.icon,
      color: definition.color,
      playerName,
    };
  })
  .filter(Boolean);

/**
 * Builds the view-model consumed by <ShareableMatchSummaryCard />.
 * Never throws on missing data; sections without real data are omitted
 * (`result: null`, `awards: []`, `teams: null`) and `isShareable` reports
 * whether the summary is worth generating at all.
 *
 * @param {Object} params
 * @param {Object} params.partido - partidos row (nombre/fecha/hora/modalidad/sede/teams)
 * @param {Object} params.results - survey_results row (canonical, results_ready)
 * @param {Array}  params.jugadores - roster rows (id/uuid/usuario_id/nombre)
 */
export function buildMatchSummaryShareCardData({ partido = {}, results = null, jugadores = [] } = {}) {
  const rosterIndex = buildRosterIndex(jugadores);

  const matchName = cleanText(partido?.nombre || partido?.titulo) || null;
  const format = cleanText(partido?.modalidad) || null;
  const date = formatShareDate(partido?.fecha);
  const time = cleanText(partido?.hora) || null;
  const dateTime = date && time ? `${date} · ${time}` : (date || time || null);
  const venue = getShortVenueLabel(partido);

  const { teamARefs, teamBRefs } = resolveTeamRefs(partido);
  const teamAPlayers = resolveTeamPlayerNames(teamARefs, rosterIndex);
  const teamBPlayers = resolveTeamPlayerNames(teamBRefs, rosterIndex);
  const hasTeams = teamAPlayers.length > 0 && teamBPlayers.length > 0;
  const teams = hasTeams
    ? {
      teamA: { name: 'Equipo A', players: teamAPlayers },
      teamB: { name: 'Equipo B', players: teamBPlayers },
    }
    : null;

  const resultStatus = normalizeResultStatus(results?.result_status ?? partido?.result_status);
  const winnerTeam = normalizeWinnerTeam(results?.winner_team ?? partido?.winner_team);
  const scoreline = cleanText(results?.scoreline) || null;

  // Never invent a winner: only a finished match with a recorded winner (or an
  // explicit draw) produces a result block.
  let result = null;
  if (resultStatus === 'finished' && winnerTeam) {
    result = {
      outcome: 'winner',
      winnerTeam,
      label: `GANÓ EQUIPO ${winnerTeam}`,
      scoreline,
    };
  } else if (resultStatus === 'draw') {
    result = {
      outcome: 'draw',
      winnerTeam: null,
      label: 'EMPATE',
      scoreline,
    };
  }

  const awards = resolveAwards(results, rosterIndex);
  const maxTeamSize = teams
    ? Math.max(teams.teamA.players.length, teams.teamB.players.length)
    : 0;

  const isShareable = canShareMatchSummary(results)
    && (Boolean(result) || awards.length > 0 || hasTeams);

  return {
    title: MATCH_SUMMARY_CARD_TITLE,
    website: SHARE_CARD_WEBSITE,
    matchName,
    format,
    date,
    time,
    dateTime,
    venue,
    result,
    teams,
    maxTeamSize,
    awards,
    isShareable,
  };
}

export default buildMatchSummaryShareCardData;
