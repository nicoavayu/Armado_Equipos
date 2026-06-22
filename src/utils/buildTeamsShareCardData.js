// Pure data builder for the shareable "EQUIPOS ARMADOS" image card.
//
// Keeps every bit of presentation logic out of the React component so the
// shape of the card can be unit-tested without a DOM. The builder never throws
// on missing data: it falls back to "Equipo A" / "Equipo B" names, tolerates
// empty match metadata (format/date/venue) and reports whether there is enough
// data to be worth sharing via `isShareable`.

import { parseLocalDate } from './dateLocal';

export const SHARE_CARD_TITLE = 'EQUIPOS ARMADOS';
export const SHARE_CARD_WEBSITE = 'arma2.com.ar';

const DEFAULT_TEAM_A_NAME = 'Equipo A';
const DEFAULT_TEAM_B_NAME = 'Equipo B';

const cleanText = (value) => String(value ?? '').trim();

// Mirrors the dd/mm/yy format used by the match header (MatchInfoSection).
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

const joinDateTime = (date, time) => {
  if (date && time) return `${date} · ${time}`;
  return date || time || null;
};

const resolveTeamName = (team, fallbackName) => cleanText(team?.name) || fallbackName;

const resolveTeamPlayers = (team, resolvePlayerName) => {
  const ids = Array.isArray(team?.players) ? team.players : [];
  return ids
    .map((id) => {
      const resolved = resolvePlayerName ? resolvePlayerName(id) : id;
      return cleanText(resolved);
    })
    .filter(Boolean);
};

/**
 * Builds the view-model consumed by <ShareableTeamsCard />.
 *
 * @param {Object} match - Match metadata (modalidad/fecha/hora/sede or aliases).
 * @param {Array}  teams - Teams array, e.g. [{ id:'equipoA', name, players:[ids] }, ...].
 * @param {Object} [options]
 * @param {(id:any)=>string} [options.resolvePlayerName] - Maps a player id to a display name.
 * @param {string} [options.fallbackTeamAName]
 * @param {string} [options.fallbackTeamBName]
 * @returns {{
 *   title:string, website:string,
 *   format:?string, date:?string, time:?string, dateTime:?string, venue:?string,
 *   teamA:{name:string, players:string[]}, teamB:{name:string, players:string[]},
 *   totalPlayers:number, maxTeamSize:number, isShareable:boolean
 * }}
 */
export function buildTeamsShareCardData(match = {}, teams = [], options = {}) {
  const {
    resolvePlayerName,
    fallbackTeamAName = DEFAULT_TEAM_A_NAME,
    fallbackTeamBName = DEFAULT_TEAM_B_NAME,
  } = options;

  const list = Array.isArray(teams) ? teams : [];
  const teamARaw = list.find((t) => t?.id === 'equipoA') || list[0] || null;
  const teamBRaw = list.find((t) => t?.id === 'equipoB') || list[1] || null;

  const teamA = {
    name: resolveTeamName(teamARaw, fallbackTeamAName),
    players: resolveTeamPlayers(teamARaw, resolvePlayerName),
  };
  const teamB = {
    name: resolveTeamName(teamBRaw, fallbackTeamBName),
    players: resolveTeamPlayers(teamBRaw, resolvePlayerName),
  };

  const matchObj = match || {};
  const format = cleanText(matchObj.modalidad ?? matchObj.format) || null;
  const date = formatShareDate(matchObj.fecha ?? matchObj.date);
  const time = cleanText(matchObj.hora ?? matchObj.time) || null;
  const venue = cleanText(matchObj.sede ?? matchObj.venue) || null;

  const totalPlayers = teamA.players.length + teamB.players.length;
  const maxTeamSize = Math.max(teamA.players.length, teamB.players.length);
  const isShareable = Boolean(teamARaw && teamBRaw)
    && teamA.players.length > 0
    && teamB.players.length > 0;

  return {
    title: SHARE_CARD_TITLE,
    website: SHARE_CARD_WEBSITE,
    format,
    date,
    time,
    dateTime: joinDateTime(date, time),
    venue,
    teamA,
    teamB,
    totalPlayers,
    maxTeamSize,
    isShareable,
  };
}

export default buildTeamsShareCardData;
