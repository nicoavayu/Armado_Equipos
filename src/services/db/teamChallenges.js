import { supabase } from '../../lib/supabaseClient';
import { normalizeTeamSkillLevel } from '../../features/equipos/config';

const TEAM_SELECT = [
  'id',
  'owner_user_id',
  'name',
  'format',
  'base_zone',
  'skill_level',
  'crest_url',
  'color_primary',
  'color_secondary',
  'color_accent',
  'is_active',
  'created_at',
  'updated_at',
].join(',');

const CHALLENGE_SELECT = `
  id,
  created_by_user_id,
  challenger_team_id,
  status,
  accepted_team_id,
  accepted_by_user_id,
  scheduled_at,
  location_name,
  location_place_id,
  format,
  skill_level,
  price_per_team,
  field_price,
  notes,
  created_at,
  updated_at,
  challenger_team:teams!challenges_challenger_team_id_fkey(${TEAM_SELECT}),
  accepted_team:teams!challenges_accepted_team_id_fkey(${TEAM_SELECT})
`;

const assertAuthenticatedUser = (userId) => {
  if (!userId) {
    throw new Error('Debes iniciar sesion');
  }
};

const unwrapSingle = (response, fallbackMessage) => {
  if (response.error) {
    throw new Error(response.error.message || fallbackMessage);
  }
  return response.data;
};

export const listMyTeams = async (userId) => {
  assertAuthenticatedUser(userId);
  const response = await supabase
    .from('teams')
    .select(TEAM_SELECT)
    .eq('owner_user_id', userId)
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  if (response.error) {
    throw new Error(response.error.message || 'No se pudieron cargar tus equipos');
  }

  return response.data || [];
};

export const getTeamById = async (teamId) => {
  const response = await supabase
    .from('teams')
    .select(TEAM_SELECT)
    .eq('id', teamId)
    .single();

  return unwrapSingle(response, 'No se pudo cargar el equipo');
};

export const createTeam = async (userId, payload) => {
  assertAuthenticatedUser(userId);

  const response = await supabase
    .from('teams')
    .insert({
      owner_user_id: userId,
      name: payload.name,
      format: payload.format,
      base_zone: payload.base_zone || null,
      skill_level: normalizeTeamSkillLevel(payload.skill_level),
      crest_url: payload.crest_url || null,
      color_primary: payload.color_primary || null,
      color_secondary: payload.color_secondary || null,
      color_accent: payload.color_accent || null,
      is_active: payload.is_active ?? true,
    })
    .select(TEAM_SELECT)
    .single();

  return unwrapSingle(response, 'No se pudo crear el equipo');
};

export const updateTeam = async (teamId, payload) => {
  const response = await supabase
    .from('teams')
    .update({
      name: payload.name,
      format: payload.format,
      base_zone: payload.base_zone || null,
      skill_level: normalizeTeamSkillLevel(payload.skill_level),
      crest_url: payload.crest_url || null,
      color_primary: payload.color_primary || null,
      color_secondary: payload.color_secondary || null,
      color_accent: payload.color_accent || null,
      is_active: payload.is_active ?? true,
    })
    .eq('id', teamId)
    .select(TEAM_SELECT)
    .single();

  return unwrapSingle(response, 'No se pudo actualizar el equipo');
};

export const softDeleteTeam = async (teamId) => {
  const response = await supabase
    .from('teams')
    .update({ is_active: false })
    .eq('id', teamId)
    .select('id')
    .single();

  return unwrapSingle(response, 'No se pudo desactivar el equipo');
};

export const listRosterCandidates = async () => {
  const playersResponse = await supabase
    .from('jugadores')
    .select('id, usuario_id, nombre, avatar_url, score, created_at')
    .not('usuario_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(800);

  if (playersResponse.error) {
    throw new Error(playersResponse.error.message || 'No se pudo cargar la base de jugadores');
  }

  const dedupByUser = new Map();
  (playersResponse.data || []).forEach((row) => {
    const userId = row?.usuario_id;
    if (!userId || dedupByUser.has(userId)) return;
    dedupByUser.set(userId, row);
  });

  const uniquePlayers = Array.from(dedupByUser.values());
  if (uniquePlayers.length === 0) return [];

  const userIds = uniquePlayers
    .map((row) => row.usuario_id)
    .filter(Boolean);

  const profileResponse = await supabase
    .from('usuarios')
    .select('id, nombre, avatar_url, posicion, ranking')
    .in('id', userIds);

  if (profileResponse.error) {
    throw new Error(profileResponse.error.message || 'No se pudieron cargar perfiles de jugadores');
  }

  const profileMap = new Map((profileResponse.data || []).map((profile) => [profile.id, profile]));

  return uniquePlayers.map((player) => {
    const profile = profileMap.get(player.usuario_id);
    return {
      jugador_id: player.id,
      usuario_id: player.usuario_id,
      nombre: profile?.nombre || player.nombre || 'Jugador',
      avatar_url: profile?.avatar_url || player.avatar_url || null,
      posicion: profile?.posicion || null,
      ranking: profile?.ranking ?? player.score ?? null,
    };
  });
};

export const listTeamMembers = async (teamId) => {
  const response = await supabase
    .from('team_members')
    .select(`
      id,
      team_id,
      jugador_id,
      role,
      is_captain,
      shirt_number,
      created_at,
      jugador:jugadores!team_members_jugador_id_fkey(
        id,
        usuario_id,
        nombre,
        avatar_url,
        score
      )
    `)
    .eq('team_id', teamId)
    .order('is_captain', { ascending: false })
    .order('created_at', { ascending: true });

  if (response.error) {
    throw new Error(response.error.message || 'No se pudo cargar la plantilla');
  }

  return response.data || [];
};

export const addTeamMember = async ({ teamId, jugadorId, role = 'player', isCaptain = false, shirtNumber = null }) => {
  const response = await supabase
    .from('team_members')
    .insert({
      team_id: teamId,
      jugador_id: jugadorId,
      role,
      is_captain: Boolean(isCaptain),
      shirt_number: shirtNumber,
    })
    .select('id')
    .single();

  return unwrapSingle(response, 'No se pudo agregar el jugador al equipo');
};

export const updateTeamMember = async (memberId, updates) => {
  const response = await supabase
    .from('team_members')
    .update({
      role: updates.role,
      is_captain: Boolean(updates.is_captain),
      shirt_number: updates.shirt_number,
    })
    .eq('id', memberId)
    .select('id')
    .single();

  return unwrapSingle(response, 'No se pudo actualizar el miembro del equipo');
};

export const removeTeamMember = async (memberId) => {
  const response = await supabase
    .from('team_members')
    .delete()
    .eq('id', memberId)
    .select('id')
    .single();

  return unwrapSingle(response, 'No se pudo quitar el miembro del equipo');
};

export const listOpenChallenges = async ({ format, zone, skillLevel } = {}) => {
  let query = supabase
    .from('challenges')
    .select(CHALLENGE_SELECT)
    .eq('status', 'open')
    .order('created_at', { ascending: false });

  if (format) {
    query = query.eq('format', Number(format));
  }

  const response = await query;

  if (response.error) {
    throw new Error(response.error.message || 'No se pudieron cargar desafios abiertos');
  }

  let rows = response.data || [];

  if (skillLevel) {
    const normalizedFilter = normalizeTeamSkillLevel(skillLevel);
    rows = rows.filter((row) => normalizeTeamSkillLevel(row?.skill_level) === normalizedFilter);
  }

  if (!zone) return rows;

  const normalizedZone = String(zone).trim().toLowerCase();
  return rows.filter((row) => {
    const challengerZone = row?.challenger_team?.base_zone;
    return typeof challengerZone === 'string' && challengerZone.trim().toLowerCase().includes(normalizedZone);
  });
};

export const listMyChallenges = async (userId) => {
  assertAuthenticatedUser(userId);

  const myTeams = await listMyTeams(userId);
  const myTeamIds = myTeams.map((team) => team.id).filter(Boolean);
  const queries = [
    supabase
      .from('challenges')
      .select(CHALLENGE_SELECT)
      .eq('created_by_user_id', userId),
    supabase
      .from('challenges')
      .select(CHALLENGE_SELECT)
      .eq('accepted_by_user_id', userId),
  ];

  if (myTeamIds.length > 0) {
    queries.push(
      supabase
        .from('challenges')
        .select(CHALLENGE_SELECT)
        .in('challenger_team_id', myTeamIds),
    );

    queries.push(
      supabase
        .from('challenges')
        .select(CHALLENGE_SELECT)
        .in('accepted_team_id', myTeamIds),
    );
  }

  const responses = await Promise.all(queries);
  responses.forEach((response) => {
    if (response.error) {
      throw new Error(response.error.message || 'No se pudieron cargar tus desafios');
    }
  });

  const merged = responses.flatMap((response) => response.data || []);
  const deduplicatedMap = new Map();
  merged.forEach((row) => {
    if (!row?.id) return;
    deduplicatedMap.set(row.id, row);
  });

  return Array.from(deduplicatedMap.values()).sort((a, b) => (
    new Date(b?.created_at || 0).getTime() - new Date(a?.created_at || 0).getTime()
  ));
};

export const createChallenge = async (userId, payload) => {
  assertAuthenticatedUser(userId);

  const response = await supabase
    .from('challenges')
    .insert({
      created_by_user_id: userId,
      challenger_team_id: payload.challenger_team_id,
      status: 'open',
      scheduled_at: payload.scheduled_at || null,
      location_name: payload.location_name || null,
      location_place_id: payload.location_place_id || null,
      format: Number(payload.format),
      skill_level: normalizeTeamSkillLevel(payload.skill_level),
      price_per_team: payload.price_per_team ?? null,
      field_price: payload.field_price ?? null,
      notes: payload.notes || null,
    })
    .select(CHALLENGE_SELECT)
    .single();

  return unwrapSingle(response, 'No se pudo publicar el desafio');
};

export const cancelChallenge = async (challengeId) => {
  const response = await supabase
    .from('challenges')
    .update({ status: 'canceled' })
    .eq('id', challengeId)
    .select(CHALLENGE_SELECT)
    .single();

  return unwrapSingle(response, 'No se pudo cancelar el desafio');
};

export const acceptChallenge = async (challengeId, acceptedTeamId) => {
  const response = await supabase.rpc('rpc_accept_challenge', {
    p_challenge_id: challengeId,
    p_accepted_team_id: acceptedTeamId,
  });

  if (response.error) {
    throw new Error(response.error.message || 'No se pudo aceptar el desafio');
  }

  const challenge = await getChallengeById(challengeId);
  return challenge;
};

export const confirmChallenge = async (challengeId) => {
  const response = await supabase.rpc('rpc_confirm_challenge', {
    p_challenge_id: challengeId,
  });

  if (response.error) {
    throw new Error(response.error.message || 'No se pudo confirmar el desafio');
  }

  const challenge = await getChallengeById(challengeId);
  return challenge;
};

export const completeChallenge = async ({ challengeId, scoreA, scoreB, playedAt }) => {
  const response = await supabase.rpc('rpc_complete_challenge', {
    p_challenge_id: challengeId,
    p_score_a: Number(scoreA),
    p_score_b: Number(scoreB),
    p_played_at: playedAt || new Date().toISOString(),
  });

  if (response.error) {
    throw new Error(response.error.message || 'No se pudo finalizar el desafio');
  }

  return response.data;
};

export const getChallengeById = async (challengeId) => {
  const response = await supabase
    .from('challenges')
    .select(CHALLENGE_SELECT)
    .eq('id', challengeId)
    .single();

  return unwrapSingle(response, 'No se pudo cargar el desafio');
};

export const listTeamHistoryByRival = async (teamId) => {
  const response = await supabase.rpc('rpc_team_history_by_rival', {
    p_team_id: teamId,
  });

  if (response.error) {
    throw new Error(response.error.message || 'No se pudo cargar el historial del equipo');
  }

  return (response.data || []).map((row) => ({
    rivalId: row.rival_id,
    rivalTeam: {
      id: row.rival_id,
      name: row.rival_name,
      format: row.rival_format,
      base_zone: row.rival_base_zone,
      skill_level: row.rival_skill_level,
      crest_url: row.rival_crest_url,
      color_primary: row.rival_color_primary,
      color_secondary: row.rival_color_secondary,
      color_accent: row.rival_color_accent,
    },
    matches: [],
    summary: {
      played: Number(row.played || 0),
      won: Number(row.won || 0),
      draw: Number(row.draw || 0),
      lost: Number(row.lost || 0),
    },
    lastPlayedAt: row.last_played_at || null,
  }));
};
