// Pure, side-effect-free helpers for the team ranking / directory UI.
// Kept framework-agnostic so they can be unit tested in isolation.

export const ZONE_UNDEFINED_LABEL = 'Zona no definida';

// win_rate = wins / played * 100, rounded. 0 when no confirmed matches.
export const computeWinRate = (wins, played) => {
  const w = Number(wins);
  const p = Number(played);
  if (!Number.isFinite(p) || p <= 0) return 0;
  if (!Number.isFinite(w) || w <= 0) return 0;
  return Math.round((w / p) * 100);
};

// Free-text barrio/zone for a team. Falls back to a premium "Zona no definida".
export const formatZoneLabel = (zone) => {
  const normalized = String(zone ?? '').trim();
  return normalized || ZONE_UNDEFINED_LABEL;
};

export const hasDefinedZone = (zone) => String(zone ?? '').trim().length > 0;

// Format badge label: F5 / F6 / F7 / F8 / F9 / F11. Defaults to F- when unknown.
export const formatFormatLabel = (format) => {
  const normalized = String(format ?? '').replace(/\D/g, '');
  return `F${normalized || '-'}`;
};

// Subtle highlight for the top of the ranking. Only #1/#2/#3 get an accent;
// everything else stays in the regular premium palette.
export const getRankAccent = (position) => {
  const pos = Number(position);
  if (pos === 1) return '#f5c451'; // gold
  if (pos === 2) return '#cbd5f5'; // silver
  if (pos === 3) return '#e0975a'; // bronze
  return null;
};

// Compact one-line stats summary: "12 PJ · 8G · 2E · 2P · 67%".
export const formatStatsLine = ({ played, wins, draws, losses } = {}) => {
  const pj = Number(played) || 0;
  const g = Number(wins) || 0;
  const e = Number(draws) || 0;
  const p = Number(losses) || 0;
  const rate = computeWinRate(g, pj);
  return `${pj} PJ · ${g}G · ${e}E · ${p}P · ${rate}%`;
};

// ---------------------------------------------------------------------------
// País / bandera
// ---------------------------------------------------------------------------
// The ranking/directory RPCs do not expose a country column yet, so teams come
// without country data. The product is AR-first today, so we fall back to a
// safe 🇦🇷 flag. The helper still reads team.country_code / team.country when
// present, so the day the backend exposes it nothing else has to change here.
export const DEFAULT_COUNTRY_CODE = 'AR';

// ISO 3166-1 alpha-2 -> regional-indicator emoji (e.g. "AR" -> 🇦🇷).
export const countryCodeToFlag = (code) => {
  const normalized = String(code ?? '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) return '';
  const A = 0x1f1e6; // regional indicator "A"
  return String.fromCodePoint(
    A + (normalized.charCodeAt(0) - 65),
    A + (normalized.charCodeAt(1) - 65),
  );
};

// Resolve a team's country code from whatever the backend happens to expose,
// falling back to Argentina so the flag never disappears on AR-only data.
export const getTeamCountryCode = (team) => {
  const raw = String(team?.country_code ?? team?.countryCode ?? team?.country ?? '').trim();
  if (/^[A-Za-z]{2}$/.test(raw)) return raw.toUpperCase();
  return DEFAULT_COUNTRY_CODE;
};

// Emoji flag for a team. Always returns something (AR fallback) so the location
// line in the cards/rows reads "🇦🇷 Devoto" / "🇦🇷 Zona no definida".
export const getTeamFlag = (team) => countryCodeToFlag(getTeamCountryCode(team));

// ---------------------------------------------------------------------------
// Ordenamiento client-side de la tabla de Ranking
// ---------------------------------------------------------------------------
// The ranking RPC only supports its own "played"/"wins" ordering, so every
// sortable column (PJ/G/E/P/%/F/Equipo) is sorted on the client over the rows
// the RPC already returned. No backend / counting rule is touched by this.
export const RANKING_SORT_KEYS = Object.freeze([
  'name',
  'format',
  'played',
  'wins',
  'draws',
  'losses',
  'winRate',
]);

// Columns whose most useful first view is "highest first".
const DESC_DEFAULT_KEYS = new Set(['played', 'wins', 'draws', 'losses', 'winRate']);

// Sensible initial direction when a column becomes active: stats start high→low,
// text/format start low→high (A→Z, F5→F11).
export const defaultSortDir = (key) => (DESC_DEFAULT_KEYS.has(key) ? 'desc' : 'asc');

const numericField = (team, key) => {
  switch (key) {
    case 'format':
      return Number(String(team?.format ?? '').replace(/\D/g, '')) || 0;
    case 'played':
      return Number(team?.played_count) || 0;
    case 'wins':
      return Number(team?.wins) || 0;
    case 'draws':
      return Number(team?.draws) || 0;
    case 'losses':
      return Number(team?.losses) || 0;
    case 'winRate':
      return computeWinRate(team?.wins, team?.played_count);
    default:
      return 0;
  }
};

// Tie-breakers keep the table stable & meaningful: after the active column we
// fall back to played desc, then win rate desc, then name asc.
const compareTie = (a, b) => {
  const byPlayed = (Number(b?.played_count) || 0) - (Number(a?.played_count) || 0);
  if (byPlayed) return byPlayed;
  const byRate = computeWinRate(b?.wins, b?.played_count) - computeWinRate(a?.wins, a?.played_count);
  if (byRate) return byRate;
  return String(a?.team_name || '').localeCompare(String(b?.team_name || ''), 'es', { sensitivity: 'base' });
};

export const compareTeams = (a, b, key, dir = 'desc') => {
  let primary;
  if (key === 'name') {
    primary = String(a?.team_name || '').localeCompare(
      String(b?.team_name || ''),
      'es',
      { sensitivity: 'base', numeric: true },
    );
  } else {
    primary = numericField(a, key) - numericField(b, key);
  }
  if (dir === 'desc') primary = -primary;
  if (primary) return primary;
  return compareTie(a, b);
};

// Returns a NEW sorted array; never mutates the input rows.
export const sortRankingRows = (rows, key, dir = 'desc') => {
  if (!Array.isArray(rows)) return [];
  if (!RANKING_SORT_KEYS.includes(key)) return [...rows];
  return [...rows].sort((a, b) => compareTeams(a, b, key, dir));
};

// Header tap behaviour: tapping a new column activates it in its default
// direction; tapping the active column toggles desc <-> asc.
export const nextSort = (current, key) => {
  if (current?.key === key) {
    return { key, dir: current.dir === 'desc' ? 'asc' : 'desc' };
  }
  return { key, dir: defaultSortDir(key) };
};
