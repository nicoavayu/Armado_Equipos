// Pure helpers for the shareable "RESUMEN DEL PARTIDO" image card.
//
// Mirrors buildTeamsShareCardData: everything here is presentation-agnostic
// data derivation so it can be unit-tested without a DOM and reused from the
// results view, Mis partidos and Home without duplicating visibility rules.
//
// The share/visibility gate is intentionally strict: a summary only "exists"
// when the survey produced real results (results_ready) and contains a real
// award payload. The persisted awards status may lag behind that payload, but
// explicit error/not_eligible states still block sharing.

import {
  AWARDS_STATUS_ERROR,
  AWARDS_STATUS_NOT_ELIGIBLE,
  hasAnyAwardData,
  normalizeAwardsStatus,
} from './awardsReadiness';
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
  && hasAnyAwardData(resultsRow)
  && ![
    AWARDS_STATUS_ERROR,
    AWARDS_STATUS_NOT_ELIGIBLE,
  ].includes(normalizeAwardsStatus(resultsRow?.awards_status)),
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
  if (ref && typeof ref === 'object') {
    const matched = identityTokensFor(ref)
      .map((token) => rosterIndex.get(token))
      .find(Boolean);
    return matched || ref;
  }
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

const parseTeamsPayload = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
};

const resolvePersistedTeams = (partido = {}) => {
  for (const payload of [partido?.equipos_json, partido?.equipos]) {
    const teams = parseTeamsPayload(payload);
    if (teams.length >= 2) return teams;
  }
  return [];
};

const getPersistedTeam = (partido, teamKey) => {
  const teams = resolvePersistedTeams(partido);
  const expectedId = teamKey === 'A' ? 'equipoa' : 'equipob';
  return teams.find((team) => normalizeToken(team?.id).replace(/[^a-z0-9]/g, '') === expectedId)
    || teams[teamKey === 'A' ? 0 : 1]
    || null;
};

const teamRefsFromPersistedTeam = (team) => {
  const candidates = [
    team?.players,
    team?.jugadores,
    team?.playerIds,
    team?.player_ids,
    team?.roster,
  ];
  return candidates.find(Array.isArray) || [];
};

const resolveTeamRefs = (partido = {}) => {
  const surveyA = Array.isArray(partido?.survey_team_a) ? partido.survey_team_a : [];
  const surveyB = Array.isArray(partido?.survey_team_b) ? partido.survey_team_b : [];
  if (surveyA.length > 0 && surveyB.length > 0) return { teamARefs: surveyA, teamBRefs: surveyB };

  const finalA = Array.isArray(partido?.final_team_a) ? partido.final_team_a : [];
  const finalB = Array.isArray(partido?.final_team_b) ? partido.final_team_b : [];
  if (finalA.length > 0 && finalB.length > 0) return { teamARefs: finalA, teamBRefs: finalB };

  const persistedA = teamRefsFromPersistedTeam(getPersistedTeam(partido, 'A'));
  const persistedB = teamRefsFromPersistedTeam(getPersistedTeam(partido, 'B'));
  if (persistedA.length > 0 && persistedB.length > 0) {
    return { teamARefs: persistedA, teamBRefs: persistedB };
  }

  return { teamARefs: [], teamBRefs: [] };
};

const normalizeComparableLabel = (value) => normalizeToken(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, ' ');

const isGenericTeamLabel = (value) => [
  'equipo a',
  'equipo b',
  'team a',
  'team b',
].includes(normalizeComparableLabel(value));

const resolveRealTeamName = (partido, teamKey, persistedTeam) => {
  const directCandidates = teamKey === 'A'
    ? [
      partido?.team_a_name,
      partido?.teamAName,
      partido?.equipo_a_nombre,
      partido?.equipoAName,
    ]
    : [
      partido?.team_b_name,
      partido?.teamBName,
      partido?.equipo_b_nombre,
      partido?.equipoBName,
    ];
  const candidates = [
    ...directCandidates,
    persistedTeam?.name,
    persistedTeam?.nombre,
    persistedTeam?.label,
  ];
  return candidates
    .map(cleanText)
    .find((candidate) => candidate && !isGenericTeamLabel(candidate)) || null;
};

const rosterForTeam = (rosters, teamKey) => {
  if (Array.isArray(rosters)) return rosters;
  if (!rosters || typeof rosters !== 'object') return [];
  const candidates = teamKey === 'A'
    ? [rosters.teamA, rosters.team_a, rosters.equipoA, rosters.equipo_a]
    : [rosters.teamB, rosters.team_b, rosters.equipoB, rosters.equipo_b];
  return candidates.find(Array.isArray) || [];
};

/**
 * Human winner headline for results/stories/share cards.
 * Generic internal labels (Equipo A/B) are never returned as the headline.
 */
export const getWinnerDisplayLabel = (match = {}, winnerTeamValue = null, rosters = []) => {
  const winnerTeam = normalizeWinnerTeam(winnerTeamValue);
  if (!winnerTeam) return 'Victoria confirmada';

  const persistedTeam = getPersistedTeam(match, winnerTeam);
  const realTeamName = resolveRealTeamName(match, winnerTeam, persistedTeam);
  if (realTeamName) return `Ganó ${realTeamName}`;

  const rosterIndex = buildRosterIndex(Array.isArray(rosters) ? rosters : [
    ...rosterForTeam(rosters, 'A'),
    ...rosterForTeam(rosters, 'B'),
  ]);
  const { teamARefs, teamBRefs } = resolveTeamRefs(match);
  const winnerRefs = winnerTeam === 'A' ? teamARefs : teamBRefs;
  const explicitRoster = rosterForTeam(rosters, winnerTeam);
  const winnerPlayers = winnerRefs
    .map((ref) => findPlayerByRef(rosterIndex, ref))
    .filter(Boolean);
  const teamPlayers = winnerPlayers.length > 0 ? winnerPlayers : explicitRoster;

  const captainCandidate = (
    persistedTeam?.captain
    ?? persistedTeam?.capitan
    ?? persistedTeam?.captain_id
    ?? persistedTeam?.capitan_id
    ?? null
  );
  const captainPlayer = findPlayerByRef(rosterIndex, captainCandidate);
  const captainName = cleanText(
    persistedTeam?.captain_name
    || persistedTeam?.capitan_nombre
    || captainPlayer?.nombre
    || teamPlayers.find((player) => player?.is_captain || player?.es_capitan)?.nombre,
  );
  if (captainName) return `Victoria del equipo de ${captainName}`;

  const firstPlayerName = cleanText(teamPlayers[0]?.nombre || teamPlayers[0]?.name);
  if (firstPlayerName) return `Victoria del equipo de ${firstPlayerName}`;

  return 'Victoria confirmada';
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

const resolvePlayerAvatarUrl = (player) => (
  cleanText(player?.avatar_url) || cleanText(player?.foto_url) || null
);

const playerInitialFor = (name) => {
  const first = cleanText(name).charAt(0);
  return first ? first.toUpperCase() : '?';
};

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
      playerAvatarUrl: resolvePlayerAvatarUrl(player),
      playerInitial: playerInitialFor(playerName),
    };
  })
  .filter(Boolean);

// No-show sanctions rendered as one more block of the awards mosaic. Only
// entries that really carry an applied penalty (and a name) produce a block.
const resolvePenaltyBlocks = (penalized, rosterIndex) => (Array.isArray(penalized) ? penalized : [])
  .map((entry) => {
    if (!entry || entry.penaltyApplied !== true) return null;
    const player = findPlayerByRef(rosterIndex, entry.usuario_id ?? entry.uuid ?? entry.id) || entry;
    const playerName = cleanText(entry.nombre) || cleanText(player?.nombre);
    if (!playerName) return null;
    return {
      kind: 'penalty',
      label: 'PENALIZACIÓN',
      icon: '/penalizacion.webp',
      color: '#FDBA74',
      playerName,
      playerAvatarUrl: resolvePlayerAvatarUrl(entry) || resolvePlayerAvatarUrl(player),
      playerInitial: playerInitialFor(playerName),
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
 * @param {Array}  [params.penalized] - absence entries with penaltyApplied (optional)
 */
export function buildMatchSummaryShareCardData({ partido = {}, results = null, jugadores = [], penalized = [] } = {}) {
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
  const persistedTeamA = getPersistedTeam(partido, 'A');
  const persistedTeamB = getPersistedTeam(partido, 'B');
  const hasTeams = teamAPlayers.length > 0 && teamBPlayers.length > 0;
  const teams = hasTeams
    ? {
      teamA: { name: resolveRealTeamName(partido, 'A', persistedTeamA) || 'Equipo A', players: teamAPlayers },
      teamB: { name: resolveRealTeamName(partido, 'B', persistedTeamB) || 'Equipo B', players: teamBPlayers },
    }
    : null;

  const resultStatus = normalizeResultStatus(results?.result_status ?? partido?.result_status);
  const winnerTeam = normalizeWinnerTeam(results?.winner_team ?? partido?.winner_team);
  const scoreline = cleanText(results?.scoreline) || null;

  // Never invent a winner: only a finished match with a recorded winner (or an
  // explicit draw) produces a result block.
  let result = null;
  if (resultStatus === 'finished' && winnerTeam) {
    const winnerPlayers = winnerTeam === 'A' ? teamAPlayers : teamBPlayers;
    result = {
      outcome: 'winner',
      winnerTeam,
      heading: winnerPlayers.length > 0 ? 'EQUIPO GANADOR' : null,
      players: winnerPlayers,
      label: winnerPlayers.length > 0 ? winnerPlayers.join(' · ') : 'Victoria confirmada',
      scoreline,
    };
  } else if (resultStatus === 'draw') {
    result = {
      outcome: 'draw',
      winnerTeam: null,
      heading: null,
      players: [],
      label: 'EMPATE',
      scoreline,
    };
  }

  const awards = [
    ...resolveAwards(results, rosterIndex),
    ...resolvePenaltyBlocks(penalized, rosterIndex),
  ];
  const maxTeamSize = teams
    ? Math.max(teams.teamA.players.length, teams.teamB.players.length)
    : 0;

  // The social piece leads with result + award blocks (no roster listing), so
  // a summary is only worth generating when at least one of those exists.
  const isShareable = canShareMatchSummary(results)
    && (Boolean(result) || awards.length > 0);

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
