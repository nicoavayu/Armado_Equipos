import { DEFAULT_SOCIAL_TIMEZONE } from '../socialDateTime';

export const BASE_FORMAT_IDS = Object.freeze({
  portrait: '4:5',
  story: '9:16',
});

export const BASE_PIECE_IDS = Object.freeze({
  round_results: 'resultados',
  next_fixture: 'proximos',
  mvp: 'figura',
  best_eleven: 'equipo',
  standings: 'tabla',
  scorers: 'goleadores',
  discipline: 'sancionados',
  round_summary: 'resumen',
  semifinals: 'semis',
  final: 'final',
  champion: 'campeon',
});

export const BASE_TOURNAMENT_LOGO_KEY = '__base_tournament_logo__';
export const BASE_PLAYER_PHOTO_KEY = '__base_player_photo__';

const POSITION_LABELS = Object.freeze({
  ARQ: 'Arquero',
  DEF: 'Defensor',
  MED: 'Mediocampista',
  DEL: 'Delantero',
});

function safeNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function teamOf(value) {
  const source = value?.team || value || {};
  return {
    id: source.teamEntryId || source.participantId || source.id || null,
    name: source.name || source.teamName || source.shortName || 'Equipo',
    crest: source.shieldPath || null,
    color: source.primaryColor || null,
  };
}

function dateParts(value, timezone = DEFAULT_SOCIAL_TIMEZONE) {
  if (!value) return { date: null, time: null };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: null, time: null };
  const zone = timezone || DEFAULT_SOCIAL_TIMEZONE;
  try {
    const day = new Intl.DateTimeFormat('es-AR', {
      weekday: 'short', day: '2-digit', month: 'short', timeZone: zone,
    }).format(date).replace(/[.,]/g, '').toUpperCase();
    const time = new Intl.DateTimeFormat('es-AR', {
      hour: '2-digit', minute: '2-digit', hour12: false, timeZone: zone,
    }).format(date);
    return { date: day, time: `${time} HS` };
  } catch {
    return dateParts(value, DEFAULT_SOCIAL_TIMEZONE);
  }
}

function matchOf(match, competition) {
  const timezone = match?.timezone || competition?.timezone || DEFAULT_SOCIAL_TIMEZONE;
  const schedule = dateParts(match?.scheduledAt, timezone);
  return {
    home: teamOf(match?.home),
    away: teamOf(match?.away),
    homeScore: match?.result?.homeScore ?? null,
    awayScore: match?.result?.awayScore ?? null,
    date: schedule.date,
    time: schedule.time,
    venue: match?.venueName || null,
  };
}

function playerTeamOf(player) {
  if (player?.team) return teamOf(player.team);
  if (player?.teamName || player?.shieldPath) return teamOf(player);
  return null;
}

function playerOf(player, { photo = false } = {}) {
  const stats = player?.stats || {};
  const position = player?.position ?? stats.position ?? null;
  return {
    name: player?.name || 'Jugador',
    position: POSITION_LABELS[position] || position || 'Jugador',
    pos: position || (player?.isGoalkeeper ? 'ARQ' : 'DEF'),
    isGoalkeeper: player?.isGoalkeeper === true || position === 'ARQ',
    team: playerTeamOf(player) || teamOf({ name: 'Equipo' }),
    goals: player?.goals ?? stats.goals ?? null,
    assists: player?.assists ?? stats.assists ?? null,
    appearances: player?.appearances ?? stats.appearances ?? null,
    starts: player?.starts ?? stats.starts ?? null,
    captaincies: player?.captaincies ?? stats.captaincies ?? null,
    photo: photo ? BASE_PLAYER_PHOTO_KEY : null,
  };
}

function suspensionMatches(player) {
  if (Number.isFinite(Number(player?.matchesLeft))) return Number(player.matchesLeft);
  return (player?.suspensions || []).reduce(
    (total, suspension) => total + safeNumber(suspension?.remainingMatches),
    0,
  );
}

function selectedCandidates(snapshot, editorial) {
  const ids = new Set(editorial?.selection || []);
  return (snapshot?.official?.candidates || []).filter((candidate) => (
    ids.has(candidate.rosterPlayerId || candidate.participantId)
  ));
}

function championOf(snapshot, editorial) {
  const selected = selectedCandidates(snapshot, editorial)[0];
  const source = selected || snapshot?.official?.officialChampion;
  return source ? teamOf(source) : null;
}

function modalityLabel(snapshot) {
  const size = snapshot?.official?.teamSize || snapshot?.competition?.teamSize;
  return size ? `Fútbol ${size}` : (snapshot?.official?.sportModality || 'Fútbol');
}

/**
 * Production boundary for the approved Base renderer. The ZIP fixtures never
 * cross this file: every value comes from the validated Social snapshot or the
 * existing editorial selection.
 */
export function adaptSnapshotToBasePiece(snapshot, editorial, branding = {}) {
  const competition = snapshot?.competition || {};
  const matches = (snapshot?.official?.matches || []).map(
    (match) => matchOf(match, competition),
  );
  const selected = selectedCandidates(snapshot, editorial);
  const common = {
    tournament: competition.tournamentName || branding.tournamentName || 'Torneo',
    category: competition.categoryName || competition.phaseName || '',
    round: competition.roundName || '',
    tournamentLogo: branding.tournamentLogo ? BASE_TOURNAMENT_LOGO_KEY : null,
    showArma2Branding: branding.showArma2Branding !== false,
  };

  switch (snapshot?.piece) {
    case 'round_results':
    case 'next_fixture':
    case 'semifinals':
    case 'final':
      return { ...common, matches };
    case 'mvp':
      return {
        ...common,
        player: playerOf(selected[0], { photo: Boolean(editorial?.photoAssetId) }),
      };
    case 'best_eleven':
      return {
        ...common,
        modality: modalityLabel(snapshot),
        players: selected.map((player) => playerOf(player)),
      };
    case 'standings':
      return {
        ...common,
        rows: (snapshot.official.rows || []).map((row, index) => ({
          team: teamOf(row),
          pos: safeNumber(row.position, index + 1),
          pj: safeNumber(row.played),
          pg: safeNumber(row.won),
          pe: safeNumber(row.drawn),
          pp: safeNumber(row.lost),
          gf: safeNumber(row.goalsFor),
          gc: safeNumber(row.goalsAgainst),
          dg: safeNumber(row.goalDifference),
          pts: safeNumber(row.points),
        })),
      };
    case 'scorers':
      return {
        ...common,
        players: (snapshot.official.players || []).map((player) => playerOf(player)),
      };
    case 'discipline':
      return {
        ...common,
        players: (snapshot.official.players || []).map((player) => ({
          ...playerOf(player),
          yellows: safeNumber(player.yellowCards),
          reds: safeNumber(player.directReds ?? player.redCards),
          matchesLeft: suspensionMatches(player),
        })),
      };
    case 'round_summary':
      return {
        ...common,
        matches,
        leaders: (snapshot.official.leaders || []).map((player) => playerOf(player)),
      };
    case 'champion':
      return { ...common, team: championOf(snapshot, editorial) };
    default:
      return common;
  }
}

export function baseAssetMap(assets) {
  const map = new Map(Object.entries(assets?.shields || {}));
  map.set(BASE_TOURNAMENT_LOGO_KEY, assets?.branding?.tournamentLogo || null);
  map.set(BASE_PLAYER_PHOTO_KEY, assets?.photo || null);
  return map;
}
