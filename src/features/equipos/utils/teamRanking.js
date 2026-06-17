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
