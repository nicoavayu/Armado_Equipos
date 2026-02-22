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

const CHALLENGE_SELECT_BASE = `
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
  notes,
  created_at,
  updated_at,
  challenger_team:teams!challenges_challenger_team_id_fkey(${TEAM_SELECT}),
  accepted_team:teams!challenges_accepted_team_id_fkey(${TEAM_SELECT})
`;

const CHALLENGE_SELECT_WITH_PRICING = `
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

const TEAM_MEMBER_SELECT_BASE = `
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
`;

const TEAM_MEMBER_SELECT_WITH_PHOTO = `
  id,
  team_id,
  jugador_id,
  role,
  is_captain,
  shirt_number,
  photo_url,
  created_at,
  jugador:jugadores!team_members_jugador_id_fkey(
    id,
    usuario_id,
    nombre,
    avatar_url,
    score
  )
`;

const SKILL_TO_LEGACY_TIER = {
  sin_definir: 'sin_definir',
  inicial: 'tranqui',
  intermedio: 'metedor',
  competitivo: 'metedor',
  avanzado: 'picante',
  elite: 'bueno',
};

const SKILL_TO_LEGACY_CORE = {
  sin_definir: 'normal',
  inicial: 'easy',
  intermedio: 'normal',
  competitivo: 'normal',
  avanzado: 'hard',
  elite: 'hard',
};

const ROLE_TO_COMPATIBLE_VALUE = {
  gk: 'gk',
  rb: 'defender',
  cb: 'defender',
  lb: 'defender',
  defender: 'defender',
  dm: 'mid',
  cm: 'mid',
  am: 'mid',
  mid: 'mid',
  rw: 'forward',
  lw: 'forward',
  st: 'forward',
  forward: 'forward',
  player: 'player',
  captain: 'player',
};

const CHALLENGE_STATUS_ALIASES = {
  open: 'open',
  abierto: 'open',
  published: 'open',
  pending: 'open',
  accepted: 'accepted',
  aceptado: 'accepted',
  matched: 'accepted',
  taken: 'accepted',
  confirmed: 'confirmed',
  confirmado: 'confirmed',
  ready: 'confirmed',
  active: 'confirmed',
  completed: 'completed',
  finalizado: 'completed',
  finished: 'completed',
  closed: 'completed',
  canceled: 'canceled',
  cancelled: 'canceled',
  cancelado: 'canceled',
 };

const uniqueValues = (values) => Array.from(new Set(values.filter(Boolean)));

const normalizeMessage = (error) => String(error?.message || error?.details || '').toLowerCase();

const isMissingColumnError = (error, columnName) => {
  const message = normalizeMessage(error);
  return message.includes(String(columnName).toLowerCase())
    && (message.includes('does not exist') || message.includes('could not find') || message.includes('schema cache'));
};

const isSkillLevelConstraintError = (error) => {
  const message = normalizeMessage(error);
  return message.includes('skill_level') || message.includes('teams_skill_level_check') || message.includes('challenges_skill_level_check');
};

const isRoleConstraintError = (error) => {
  const message = normalizeMessage(error);
  return message.includes('team_members_role_check') || message.includes('role');
};

const getSkillCandidates = (rawValue) => {
  const normalized = normalizeTeamSkillLevel(rawValue);
  return uniqueValues([
    normalized,
    SKILL_TO_LEGACY_TIER[normalized],
    SKILL_TO_LEGACY_CORE[normalized],
  ]);
};

const getRoleCandidates = (role) => uniqueValues([
  role || 'player',
  ROLE_TO_COMPATIBLE_VALUE[role] || 'player',
]);

const normalizeChallengeStatus = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return 'open';
  return CHALLENGE_STATUS_ALIASES[normalized] || normalized;
};

const withChallengeCompatibility = (row) => ({
  ...row,
  status: normalizeChallengeStatus(row?.status),
  price_per_team: row?.price_per_team ?? null,
  field_price: row?.field_price ?? null,
});

const upsertChallengeAcceptedNotifications = async ({
  challenge,
  currentUserId = null,
  acceptedTeamName = '',
}) => {
  const challengeId = String(challenge?.id || '').trim();
  if (!challengeId) return;

  const challengerTeamName = String(challenge?.challenger_team?.name || 'tu equipo').trim();
  const rivalTeamName = String(
    challenge?.accepted_team?.name
    || acceptedTeamName
    || 'el equipo rival',
  ).trim();

  const createdByUserId = String(challenge?.created_by_user_id || '').trim();
  const acceptedByUserId = String(
    challenge?.accepted_by_user_id
    || challenge?.accepted_team?.owner_user_id
    || currentUserId
    || '',
  ).trim();

  const nowIso = new Date().toISOString();
  const baseData = {
    challenge_id: challenge.id,
    challenger_team_id: challenge.challenger_team_id,
    accepted_team_id: challenge.accepted_team_id,
    challenger_team_name: challengerTeamName,
    accepted_team_name: rivalTeamName,
    link: '/quiero-jugar',
    source: 'team_challenge',
  };

  const notificationRows = [];

  if (createdByUserId) {
    notificationRows.push({
      user_id: createdByUserId,
      type: 'match_update',
      title: 'Tu desafio fue aceptado',
      message: `${rivalTeamName} acepto el desafio de ${challengerTeamName}.`,
      data: {
        ...baseData,
        actor: 'challenger',
      },
      read: false,
      created_at: nowIso,
    });
  }

  if (acceptedByUserId) {
    notificationRows.push({
      user_id: acceptedByUserId,
      type: 'match_update',
      title: 'Desafio aceptado',
      message: `Confirmaste ${rivalTeamName} para enfrentar a ${challengerTeamName}.`,
      data: {
        ...baseData,
        actor: 'accepted_team',
      },
      read: false,
      created_at: nowIso,
    });
  }

  if (notificationRows.length === 0) return;

  const uniqueByRecipient = new Map();
  notificationRows.forEach((row) => {
    uniqueByRecipient.set(row.user_id, row);
  });

  try {
    const { error } = await supabase
      .from('notifications')
      .insert(Array.from(uniqueByRecipient.values()));
    if (error) {
      console.warn('[TEAM_CHALLENGES] notification insert failed', {
        challengeId,
        code: error.code,
        message: error.message,
      });
    }
  } catch (error) {
    console.warn('[TEAM_CHALLENGES] notification insert exception', {
      challengeId,
      message: error?.message || String(error),
    });
  }
};

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

  const skillCandidates = getSkillCandidates(payload.skill_level);
  let response = null;

  for (const skillCandidate of skillCandidates) {
    response = await supabase
      .from('teams')
      .insert({
        owner_user_id: userId,
        name: payload.name,
        format: payload.format,
        base_zone: payload.base_zone || null,
        skill_level: skillCandidate,
        crest_url: payload.crest_url || null,
        color_primary: payload.color_primary || null,
        color_secondary: payload.color_secondary || null,
        color_accent: payload.color_accent || null,
        is_active: payload.is_active ?? true,
      })
      .select(TEAM_SELECT)
      .single();

    if (!response.error) break;
    if (!isSkillLevelConstraintError(response.error)) break;
  }

  return unwrapSingle(response, 'No se pudo crear el equipo');
};

export const updateTeam = async (teamId, payload) => {
  const updatePayloadBase = {};
  if ('name' in payload) updatePayloadBase.name = payload.name;
  if ('format' in payload) updatePayloadBase.format = payload.format;
  if ('base_zone' in payload) updatePayloadBase.base_zone = payload.base_zone || null;
  if ('crest_url' in payload) updatePayloadBase.crest_url = payload.crest_url || null;
  if ('color_primary' in payload) updatePayloadBase.color_primary = payload.color_primary || null;
  if ('color_secondary' in payload) updatePayloadBase.color_secondary = payload.color_secondary || null;
  if ('color_accent' in payload) updatePayloadBase.color_accent = payload.color_accent || null;
  if ('is_active' in payload) updatePayloadBase.is_active = payload.is_active ?? true;

  const skillCandidates = 'skill_level' in payload
    ? getSkillCandidates(payload.skill_level)
    : [null];

  let response = null;

  for (const skillCandidate of skillCandidates) {
    const updatePayload = { ...updatePayloadBase };
    if (skillCandidate) {
      updatePayload.skill_level = skillCandidate;
    }

    response = await supabase
      .from('teams')
      .update(updatePayload)
      .eq('id', teamId)
      .select(TEAM_SELECT)
      .single();

    if (!response.error) break;
    if (!isSkillLevelConstraintError(response.error)) break;
  }

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

export const ensureRosterCandidateByName = async (rawName) => {
  const trimmedName = String(rawName || '').trim();
  if (!trimmedName) {
    throw new Error('Escribi el nombre del jugador para continuar');
  }

  const existingResponse = await supabase
    .from('jugadores')
    .select('id, usuario_id, nombre, avatar_url, score')
    .ilike('nombre', trimmedName)
    .order('created_at', { ascending: false })
    .limit(1);

  if (existingResponse.error) {
    throw new Error(existingResponse.error.message || 'No se pudo buscar al jugador');
  }

  if (existingResponse.data?.[0]) {
    const existing = existingResponse.data[0];
    return {
      jugador_id: existing.id,
      usuario_id: existing.usuario_id || null,
      nombre: existing.nombre || trimmedName,
      avatar_url: existing.avatar_url || null,
      posicion: null,
      ranking: existing.score ?? null,
    };
  }

  const insertResponse = await supabase
    .from('jugadores')
    .insert({ nombre: trimmedName })
    .select('id, usuario_id, nombre, avatar_url, score')
    .single();

  if (insertResponse.error) {
    throw new Error(insertResponse.error.message || 'No se pudo crear el jugador');
  }

  const created = insertResponse.data;
  return {
    jugador_id: created.id,
    usuario_id: created.usuario_id || null,
    nombre: created.nombre || trimmedName,
    avatar_url: created.avatar_url || null,
    posicion: null,
    ranking: created.score ?? null,
  };
};

export const listTeamMembers = async (teamId) => {
  let response = await supabase
    .from('team_members')
    .select(TEAM_MEMBER_SELECT_WITH_PHOTO)
    .eq('team_id', teamId)
    .order('is_captain', { ascending: false })
    .order('created_at', { ascending: true });

  if (response.error && isMissingColumnError(response.error, 'photo_url')) {
    response = await supabase
      .from('team_members')
      .select(TEAM_MEMBER_SELECT_BASE)
      .eq('team_id', teamId)
      .order('is_captain', { ascending: false })
      .order('created_at', { ascending: true });
  }

  if (response.error) {
    throw new Error(response.error.message || 'No se pudo cargar la plantilla');
  }

  return (response.data || []).map((row) => ({ ...row, photo_url: row?.photo_url || null }));
};

export const addTeamMember = async ({ teamId, jugadorId, role = 'player', isCaptain = false, shirtNumber = null, photoUrl = null }) => {
  const roleCandidates = getRoleCandidates(role);
  let response = null;

  for (const roleCandidate of roleCandidates) {
    const insertPayload = {
      team_id: teamId,
      jugador_id: jugadorId,
      role: roleCandidate,
      is_captain: Boolean(isCaptain),
      shirt_number: shirtNumber,
      photo_url: photoUrl,
    };

    response = await supabase
      .from('team_members')
      .insert(insertPayload)
      .select('id')
      .single();

    if (response.error && isMissingColumnError(response.error, 'photo_url')) {
      const legacyPayload = { ...insertPayload };
      delete legacyPayload.photo_url;
      response = await supabase
        .from('team_members')
        .insert(legacyPayload)
        .select('id')
        .single();
    }

    if (!response.error) break;
    if (!isRoleConstraintError(response.error)) break;
  }

  return unwrapSingle(response, 'No se pudo agregar el jugador al equipo');
};

export const updateTeamMember = async (memberId, updates) => {
  const payloadBase = {};
  if ('is_captain' in updates) payloadBase.is_captain = Boolean(updates.is_captain);
  if ('shirt_number' in updates) payloadBase.shirt_number = updates.shirt_number;
  if ('photo_url' in updates) payloadBase.photo_url = updates.photo_url || null;

  const roleCandidates = 'role' in updates ? getRoleCandidates(updates.role) : [null];
  let response = null;

  for (const roleCandidate of roleCandidates) {
    const payload = { ...payloadBase };
    if (roleCandidate) payload.role = roleCandidate;

    response = await supabase
      .from('team_members')
      .update(payload)
      .eq('id', memberId)
      .select('id')
      .single();

    if (response.error && isMissingColumnError(response.error, 'photo_url')) {
      const legacyPayload = { ...payload };
      delete legacyPayload.photo_url;
      response = await supabase
        .from('team_members')
        .update(legacyPayload)
        .eq('id', memberId)
        .select('id')
        .single();
    }

    if (!response.error) break;
    if (!isRoleConstraintError(response.error)) break;
  }

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
  const execute = async (selectClause) => {
    let query = supabase
      .from('challenges')
      .select(selectClause)
      .eq('status', 'open')
      .order('created_at', { ascending: false });

    if (format) {
      query = query.eq('format', Number(format));
    }

    return query;
  };

  let response = await execute(CHALLENGE_SELECT_WITH_PRICING);
  if (
    response.error
    && (isMissingColumnError(response.error, 'price_per_team') || isMissingColumnError(response.error, 'field_price'))
  ) {
    response = await execute(CHALLENGE_SELECT_BASE);
  }

  if (response.error) {
    throw new Error(response.error.message || 'No se pudieron cargar desafios abiertos');
  }

  let rows = (response.data || []).map(withChallengeCompatibility);

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
  const queryBuilders = [
    (query) => query.eq('created_by_user_id', userId),
    (query) => query.eq('accepted_by_user_id', userId),
  ];

  if (myTeamIds.length > 0) {
    queryBuilders.push((query) => query.in('challenger_team_id', myTeamIds));
    queryBuilders.push((query) => query.in('accepted_team_id', myTeamIds));
  }

  const responses = await Promise.all(queryBuilders.map(async (buildQuery) => {
    let response = await buildQuery(supabase.from('challenges').select(CHALLENGE_SELECT_WITH_PRICING));
    if (
      response.error
      && (isMissingColumnError(response.error, 'price_per_team') || isMissingColumnError(response.error, 'field_price'))
    ) {
      response = await buildQuery(supabase.from('challenges').select(CHALLENGE_SELECT_BASE));
    }
    return response;
  }));

  const successfulResponses = responses.filter((response) => !response.error);

  if (successfulResponses.length === 0) {
    const firstError = responses.find((response) => response.error)?.error;
    throw new Error(firstError?.message || 'No se pudieron cargar tus desafios');
  }

  const failedResponses = responses.filter((response) => response.error);
  if (failedResponses.length > 0) {
    console.warn('[TEAM_CHALLENGES] Some listMyChallenges queries failed', failedResponses.map((response) => ({
      code: response.error?.code,
      message: response.error?.message,
    })));
  }

  const merged = successfulResponses.flatMap((response) => (response.data || []).map(withChallengeCompatibility));
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
  const skillCandidates = getSkillCandidates(payload.skill_level);
  let response = null;

  for (const skillCandidate of skillCandidates) {
    const insertPayload = {
      created_by_user_id: userId,
      challenger_team_id: payload.challenger_team_id,
      status: 'open',
      scheduled_at: payload.scheduled_at || null,
      location_name: payload.location_name || null,
      location_place_id: payload.location_place_id || null,
      format: Number(payload.format),
      skill_level: skillCandidate,
      price_per_team: payload.price_per_team ?? null,
      field_price: payload.field_price ?? null,
      notes: payload.notes || null,
    };

    response = await supabase
      .from('challenges')
      .insert(insertPayload)
      .select(CHALLENGE_SELECT_WITH_PRICING)
      .single();

    if (
      response.error
      && (isMissingColumnError(response.error, 'price_per_team') || isMissingColumnError(response.error, 'field_price'))
    ) {
      const legacyPayload = { ...insertPayload };
      delete legacyPayload.price_per_team;
      delete legacyPayload.field_price;

      response = await supabase
        .from('challenges')
        .insert(legacyPayload)
        .select(CHALLENGE_SELECT_BASE)
        .single();
    }

    if (!response.error) {
      return withChallengeCompatibility(response.data);
    }

    if (!isSkillLevelConstraintError(response.error)) break;
  }

  throw new Error(response?.error?.message || 'No se pudo publicar el desafio');
};

export const cancelChallenge = async (challengeId) => {
  let response = await supabase
    .from('challenges')
    .update({ status: 'canceled' })
    .eq('id', challengeId)
    .select(CHALLENGE_SELECT_WITH_PRICING)
    .single();

  if (
    response.error
    && (isMissingColumnError(response.error, 'price_per_team') || isMissingColumnError(response.error, 'field_price'))
  ) {
    response = await supabase
      .from('challenges')
      .update({ status: 'canceled' })
      .eq('id', challengeId)
      .select(CHALLENGE_SELECT_BASE)
      .single();
  }

  return withChallengeCompatibility(unwrapSingle(response, 'No se pudo cancelar el desafio'));
};

export const acceptChallenge = async (challengeId, acceptedTeamId, options = {}) => {
  const response = await supabase.rpc('rpc_accept_challenge', {
    p_challenge_id: challengeId,
    p_accepted_team_id: acceptedTeamId,
  });

  if (response.error) {
    throw new Error(response.error.message || 'No se pudo aceptar el desafio');
  }

  const challenge = await getChallengeById(challengeId);
  await upsertChallengeAcceptedNotifications({
    challenge,
    currentUserId: options?.currentUserId || null,
    acceptedTeamName: options?.acceptedTeamName || '',
  });
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
  let response = await supabase
    .from('challenges')
    .select(CHALLENGE_SELECT_WITH_PRICING)
    .eq('id', challengeId)
    .single();

  if (
    response.error
    && (isMissingColumnError(response.error, 'price_per_team') || isMissingColumnError(response.error, 'field_price'))
  ) {
    response = await supabase
      .from('challenges')
      .select(CHALLENGE_SELECT_BASE)
      .eq('id', challengeId)
      .single();
  }

  return withChallengeCompatibility(unwrapSingle(response, 'No se pudo cargar el desafio'));
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
