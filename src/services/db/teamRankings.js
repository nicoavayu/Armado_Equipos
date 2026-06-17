import { supabase } from '../../lib/supabaseClient';

// Read-only access to the team ranking / challengeable-teams directory RPCs.
// These RPCs are additive (migration 20260616193000). If a client runs against
// a database where they are not deployed yet, we degrade gracefully to an empty
// list instead of throwing, so the rest of Desafios keeps working.

const normalizeMessage = (error) => String(error?.message || error?.details || '').toLowerCase();

const isMissingFunctionError = (error, functionName) => {
  const message = normalizeMessage(error);
  const normalizedFn = String(functionName || '').toLowerCase();
  return (
    message.includes('could not find the function')
    || (normalizedFn && message.includes(normalizedFn) && message.includes('does not exist'))
  );
};

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeTeamRankingRow = (row) => ({
  team_id: row?.team_id ?? null,
  team_name: row?.team_name || 'Equipo',
  avatar_url: row?.avatar_url || null,
  format: row?.format ?? null,
  zone: row?.zone || null,
  skill_level: row?.skill_level || null,
  color_primary: row?.color_primary || null,
  color_secondary: row?.color_secondary || null,
  color_accent: row?.color_accent || null,
  played_count: toNumber(row?.played_count, 0),
  wins: toNumber(row?.wins, 0),
  draws: toNumber(row?.draws, 0),
  losses: toNumber(row?.losses, 0),
  win_rate: toNumber(row?.win_rate, 0),
  last_played_at: row?.last_played_at || null,
});

const cleanParam = (value) => {
  const normalized = String(value ?? '').trim();
  return normalized || null;
};

// p_sort: 'played' (mas jugaron) | 'wins' (mas ganaron).
// p_period: 'all' | '90d'.
export const getTeamChallengeRankings = async ({
  format = null,
  zone = null,
  sort = 'played',
  limit = 50,
  period = 'all',
} = {}) => {
  const { data, error } = await supabase.rpc('rpc_get_team_challenge_rankings', {
    p_format: cleanParam(format),
    p_zone: cleanParam(zone),
    p_sort: sort === 'wins' ? 'wins' : 'played',
    p_limit: limit,
    p_period: period === '90d' ? '90d' : 'all',
  });

  if (error) {
    if (isMissingFunctionError(error, 'rpc_get_team_challenge_rankings')) return [];
    throw new Error(error.message || 'No se pudo cargar el ranking de equipos');
  }

  return (data || []).map(normalizeTeamRankingRow);
};

export const searchChallengeableTeams = async ({
  query = null,
  format = null,
  zone = null,
  limit = 50,
} = {}) => {
  const { data, error } = await supabase.rpc('rpc_search_challengeable_teams', {
    p_query: cleanParam(query),
    p_format: cleanParam(format),
    p_zone: cleanParam(zone),
    p_limit: limit,
  });

  if (error) {
    if (isMissingFunctionError(error, 'rpc_search_challengeable_teams')) return [];
    throw new Error(error.message || 'No se pudo cargar el directorio de equipos');
  }

  return (data || []).map(normalizeTeamRankingRow);
};
