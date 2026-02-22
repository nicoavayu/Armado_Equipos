import { supabase } from '../../lib/supabaseClient';
import { normalizeTeamMode, normalizeTeamSkillLevel } from '../../features/equipos/config';

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
const TEAM_SELECT_WITH_MODE = `${TEAM_SELECT},mode`;

const CHALLENGE_SELECT_BASE = `
  id,
  created_by_user_id,
  challenger_team_id,
  status,
  accepted_team_id,
  accepted_by_user_id,
  scheduled_at,
  mode,
  location,
  location_name,
  location_place_id,
  cancha_cost,
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
  mode,
  location,
  location_name,
  location_place_id,
  cancha_cost,
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

const CHALLENGE_SELECT_LEGACY = `
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

const TEAM_MEMBER_SELECT_BASE = `
  id,
  team_id,
  jugador_id,
  user_id,
  permissions_role,
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
  user_id,
  permissions_role,
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

const TEAM_INVITATION_SELECT = `
  id,
  team_id,
  invited_user_id,
  invited_by_user_id,
  status,
  created_at,
  updated_at,
  responded_at,
  team:teams!team_invitations_team_id_fkey(${TEAM_SELECT}),
  invited_user:usuarios!team_invitations_invited_user_id_fkey(
    id,
    nombre,
    avatar_url
  ),
  invited_by_user:usuarios!team_invitations_invited_by_user_id_fkey(
    id,
    nombre,
    avatar_url
  )
`;

const TEAM_CHAT_MESSAGE_SELECT = `
  id,
  team_id,
  user_id,
  autor,
  mensaje,
  timestamp,
  created_at
`;

const TEAM_MATCH_SELECT = `
  id,
  origin_type,
  challenge_id,
  team_a_id,
  team_b_id,
  format,
  mode,
  scheduled_at,
  played_at,
  location,
  location_name,
  cancha_cost,
  score_a,
  score_b,
  status,
  is_format_combined,
  created_at,
  updated_at,
  team_a:teams!team_matches_team_a_id_fkey(${TEAM_SELECT}),
  team_b:teams!team_matches_team_b_id_fkey(${TEAM_SELECT}),
  challenge:challenges!team_matches_challenge_id_fkey(
    id,
    format,
    status
  )
`;

const TEAM_MATCH_SELECT_LEGACY = `
  id,
  challenge_id,
  team_a_id,
  team_b_id,
  format,
  played_at,
  location_name,
  score_a,
  score_b,
  status,
  created_at,
  team_a:teams!team_matches_team_a_id_fkey(${TEAM_SELECT}),
  team_b:teams!team_matches_team_b_id_fkey(${TEAM_SELECT}),
  challenge:challenges!team_matches_challenge_id_fkey(
    id,
    format,
    status
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

const TEAM_MATCH_STATUS_ALIASES = {
  pending: 'pending',
  confirmado: 'confirmed',
  confirmed: 'confirmed',
  played: 'played',
  jugado: 'played',
  canceled: 'cancelled',
  cancelled: 'cancelled',
  cancelado: 'cancelled',
};

const uniqueValues = (values) => Array.from(new Set(values.filter(Boolean)));

const normalizeMessage = (error) => String(error?.message || error?.details || '').toLowerCase();

const isMissingColumnError = (error, columnName) => {
  const message = normalizeMessage(error);
  return message.includes(String(columnName).toLowerCase())
    && (message.includes('does not exist') || message.includes('could not find') || message.includes('schema cache'));
};

const isOrderedSetModeError = (error) => (
  normalizeMessage(error).includes('within group is required for ordered-set aggregate mode')
);

const hasAnyMissingColumns = (error, columns) => (
  columns.some((columnName) => isMissingColumnError(error, columnName))
);

const isChallengeSelectCompatibilityError = (error) => (
  isOrderedSetModeError(error)
  || hasAnyMissingColumns(error, ['mode', 'location', 'cancha_cost', 'price_per_team', 'field_price'])
);

const isChallengeWriteCompatibilityError = (error) => (
  hasAnyMissingColumns(error, ['mode', 'location', 'cancha_cost', 'price_per_team', 'field_price'])
);

const isTeamMatchSelectCompatibilityError = (error) => (
  isOrderedSetModeError(error)
  || hasAnyMissingColumns(error, [
    'origin_type',
    'mode',
    'scheduled_at',
    'location',
    'cancha_cost',
    'is_format_combined',
    'updated_at',
  ])
);

const runChallengeSelectWithFallback = async (queryFactory, preferred = CHALLENGE_SELECT_WITH_PRICING) => {
  const fallbackClauses = preferred === CHALLENGE_SELECT_BASE
    ? [CHALLENGE_SELECT_BASE, CHALLENGE_SELECT_LEGACY]
    : preferred === CHALLENGE_SELECT_LEGACY
      ? [CHALLENGE_SELECT_LEGACY]
      : [CHALLENGE_SELECT_WITH_PRICING, CHALLENGE_SELECT_BASE, CHALLENGE_SELECT_LEGACY];

  let lastResponse = null;
  for (const selectClause of fallbackClauses) {
    const response = await queryFactory(selectClause);
    if (!response.error) return response;
    lastResponse = response;
    if (!isChallengeSelectCompatibilityError(response.error)) return response;
  }
  return lastResponse;
};

const runTeamMatchSelectWithFallback = async (queryFactory, preferred = TEAM_MATCH_SELECT) => {
  const fallbackClauses = preferred === TEAM_MATCH_SELECT_LEGACY
    ? [TEAM_MATCH_SELECT_LEGACY]
    : [TEAM_MATCH_SELECT, TEAM_MATCH_SELECT_LEGACY];

  let lastResponse = null;
  for (const selectClause of fallbackClauses) {
    const response = await queryFactory(selectClause);
    if (!response.error) return response;
    lastResponse = response;
    if (!isTeamMatchSelectCompatibilityError(response.error)) return response;
  }
  return lastResponse;
};

const runTeamSelectWithModeFallback = async (queryFactory) => {
  let response = await queryFactory(TEAM_SELECT_WITH_MODE);
  if (response.error && isMissingColumnError(response.error, 'mode')) {
    response = await queryFactory(TEAM_SELECT);
  }
  return response;
};

const challengePayloadToKey = (payload) => Object.keys(payload)
  .sort((a, b) => a.localeCompare(b))
  .map((key) => `${key}:${JSON.stringify(payload[key])}`)
  .join('|');

const buildChallengeInsertPayloadVariants = (payload) => {
  const fullPayload = { ...payload };
  const noPricingPayload = { ...fullPayload };
  delete noPricingPayload.field_price;
  delete noPricingPayload.price_per_team;

  const legacyPayload = { ...noPricingPayload };
  delete legacyPayload.mode;
  delete legacyPayload.location;
  delete legacyPayload.cancha_cost;

  const uniqueVariants = new Map();
  [fullPayload, noPricingPayload, legacyPayload].forEach((candidate) => {
    uniqueVariants.set(challengePayloadToKey(candidate), candidate);
  });

  return Array.from(uniqueVariants.values());
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

const normalizeTeamMatchStatus = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return 'pending';
  return TEAM_MATCH_STATUS_ALIASES[normalized] || normalized;
};

const withChallengeCompatibility = (row) => ({
  ...row,
  status: normalizeChallengeStatus(row?.status),
  mode: row?.mode ?? null,
  location: row?.location ?? row?.location_name ?? null,
  cancha_cost: row?.cancha_cost ?? row?.field_price ?? null,
  price_per_team: row?.price_per_team ?? null,
  field_price: row?.field_price ?? null,
});

const withTeamMatchCompatibility = (row) => ({
  ...row,
  status: normalizeTeamMatchStatus(row?.status),
  origin_type: row?.origin_type || (row?.challenge_id ? 'challenge' : 'individual'),
  location: row?.location ?? row?.location_name ?? null,
  cancha_cost: row?.cancha_cost ?? null,
  is_format_combined: Boolean(row?.is_format_combined),
});

const withTeamCompatibility = (row) => ({
  ...row,
  mode: normalizeTeamMode(row?.mode),
});

export const upsertChallengeAcceptedNotifications = async ({
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
  const response = await runTeamSelectWithModeFallback(
    (selectClause) => supabase
      .from('teams')
      .select(selectClause)
      .eq('owner_user_id', userId)
      .eq('is_active', true)
      .order('created_at', { ascending: false }),
  );

  if (response.error) {
    throw new Error(response.error.message || 'No se pudieron cargar tus equipos');
  }

  return (response.data || []).map(withTeamCompatibility);
};

export const listAccessibleTeams = async (userId) => {
  assertAuthenticatedUser(userId);

  const ownTeamsResponse = await runTeamSelectWithModeFallback(
    (selectClause) => supabase
      .from('teams')
      .select(selectClause)
      .eq('owner_user_id', userId)
      .eq('is_active', true)
      .order('created_at', { ascending: false }),
  );

  if (ownTeamsResponse.error) {
    throw new Error(ownTeamsResponse.error.message || 'No se pudieron cargar tus equipos');
  }

  const memberTeamIds = new Set();

  let teamMembersByUserResponse = await supabase
    .from('team_members')
    .select('team_id')
    .eq('user_id', userId);

  if (teamMembersByUserResponse.error && isMissingColumnError(teamMembersByUserResponse.error, 'user_id')) {
    teamMembersByUserResponse = { data: [], error: null };
  } else if (teamMembersByUserResponse.error) {
    throw new Error(teamMembersByUserResponse.error.message || 'No se pudieron cargar tus membresias');
  }

  (teamMembersByUserResponse.data || []).forEach((row) => {
    if (row?.team_id) memberTeamIds.add(row.team_id);
  });

  if (memberTeamIds.size === 0) {
    const playerRowsResponse = await supabase
      .from('jugadores')
      .select('id')
      .eq('usuario_id', userId)
      .order('id', { ascending: false });

    if (playerRowsResponse.error) {
      throw new Error(playerRowsResponse.error.message || 'No se pudieron cargar tus jugadores');
    }

    const jugadorIds = (playerRowsResponse.data || [])
      .map((row) => row?.id)
      .filter(Boolean);

    if (jugadorIds.length > 0) {
      const memberRowsResponse = await supabase
        .from('team_members')
        .select('team_id')
        .in('jugador_id', jugadorIds);

      if (memberRowsResponse.error) {
        throw new Error(memberRowsResponse.error.message || 'No se pudieron cargar tus membresias');
      }

      (memberRowsResponse.data || []).forEach((row) => {
        if (row?.team_id) memberTeamIds.add(row.team_id);
      });
    }
  }

  const acceptedInvitationsResponse = await supabase
    .from('team_invitations')
    .select('team_id')
    .eq('invited_user_id', userId)
    .eq('status', 'accepted');

  if (!acceptedInvitationsResponse.error) {
    (acceptedInvitationsResponse.data || []).forEach((row) => {
      if (row?.team_id) memberTeamIds.add(row.team_id);
    });
  }

  const ownTeamIds = new Set((ownTeamsResponse.data || []).map((team) => team.id));
  const extraTeamIds = Array.from(memberTeamIds).filter((teamId) => !ownTeamIds.has(teamId));

  let memberTeams = [];
  if (extraTeamIds.length > 0) {
    const memberTeamsResponse = await runTeamSelectWithModeFallback(
      (selectClause) => supabase
        .from('teams')
        .select(selectClause)
        .in('id', extraTeamIds)
        .eq('is_active', true),
    );

    if (memberTeamsResponse.error) {
      throw new Error(memberTeamsResponse.error.message || 'No se pudieron cargar equipos invitados');
    }

    memberTeams = memberTeamsResponse.data || [];
  }

  const dedup = new Map();
  [...(ownTeamsResponse.data || []), ...memberTeams].forEach((team) => {
    if (!team?.id) return;
    dedup.set(team.id, team);
  });

  return Array.from(dedup.values()).sort((a, b) => (
    new Date(b?.created_at || 0).getTime() - new Date(a?.created_at || 0).getTime()
  )).map(withTeamCompatibility);
};

export const listMyManageableTeams = async (userId) => {
  assertAuthenticatedUser(userId);

  const teams = await listAccessibleTeams(userId);
  const teamIds = (teams || []).map((team) => team?.id).filter(Boolean);
  if (teamIds.length === 0) return [];

  const adminTeamIds = await resolveUserAdminTeamIds({
    userId,
    teamIds,
    teamRows: teams,
  });

  return teams.filter((team) => adminTeamIds.has(team?.id));
};

export const getTeamById = async (teamId) => {
  const response = await runTeamSelectWithModeFallback(
    (selectClause) => supabase
      .from('teams')
      .select(selectClause)
      .eq('id', teamId)
      .single(),
  );

  return withTeamCompatibility(unwrapSingle(response, 'No se pudo cargar el equipo'));
};

export const createTeam = async (userId, payload) => {
  assertAuthenticatedUser(userId);

  const skillCandidates = getSkillCandidates(payload.skill_level);
  let response = null;
  const teamMode = normalizeTeamMode(payload?.mode);

  for (const skillCandidate of skillCandidates) {
    const baseInsertPayload = {
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
    };

    const runInsert = (includeMode) => runTeamSelectWithModeFallback(
      (selectClause) => supabase
        .from('teams')
        .insert({
          ...baseInsertPayload,
          ...(includeMode ? { mode: teamMode } : {}),
        })
        .select(selectClause)
        .single(),
    );

    response = await runInsert(true);
    if (response.error && isMissingColumnError(response.error, 'mode')) {
      response = await runInsert(false);
    }

    if (!response.error) break;
    if (!isSkillLevelConstraintError(response.error)) break;
  }

  return withTeamCompatibility(unwrapSingle(response, 'No se pudo crear el equipo'));
};

export const updateTeam = async (teamId, payload) => {
  const updatePayloadBase = {};
  if ('name' in payload) updatePayloadBase.name = payload.name;
  if ('format' in payload) updatePayloadBase.format = payload.format;
  if ('mode' in payload) updatePayloadBase.mode = normalizeTeamMode(payload.mode);
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

    const runUpdate = (payloadForUpdate) => runTeamSelectWithModeFallback(
      (selectClause) => supabase
        .from('teams')
        .update(payloadForUpdate)
        .eq('id', teamId)
        .select(selectClause)
        .single(),
    );

    response = await runUpdate(updatePayload);
    if (response.error && isMissingColumnError(response.error, 'mode') && 'mode' in updatePayload) {
      const modeLessPayload = { ...updatePayload };
      delete modeLessPayload.mode;
      response = await runUpdate(modeLessPayload);
    }

    if (!response.error) break;
    if (!isSkillLevelConstraintError(response.error)) break;
  }

  return withTeamCompatibility(unwrapSingle(response, 'No se pudo actualizar el equipo'));
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

export const ensureLocalTeamPlayerByName = async ({ teamId, displayName }) => {
  const trimmedName = String(displayName || '').trim();
  if (!teamId) {
    throw new Error('Equipo invalido para crear jugador local');
  }
  if (!trimmedName) {
    throw new Error('Escribi el nombre del jugador para continuar');
  }

  const existingLocalResponse = await supabase
    .from('team_members')
    .select(`
      id,
      jugador:jugadores!team_members_jugador_id_fkey(
        id,
        nombre,
        usuario_id,
        avatar_url,
        score
      )
    `)
    .eq('team_id', teamId);

  if (existingLocalResponse.error) {
    throw new Error(existingLocalResponse.error.message || 'No se pudo validar la plantilla local');
  }

  const normalizedTarget = trimmedName.toLowerCase();
  const existingLocal = (existingLocalResponse.data || []).find((row) => {
    const jugador = row?.jugador;
    if (!jugador || jugador.usuario_id) return false;
    return String(jugador.nombre || '').trim().toLowerCase() === normalizedTarget;
  });

  if (existingLocal?.jugador?.id) {
    return {
      jugador_id: existingLocal.jugador.id,
      usuario_id: null,
      nombre: existingLocal.jugador.nombre || trimmedName,
      avatar_url: existingLocal.jugador.avatar_url || null,
      posicion: null,
      ranking: existingLocal.jugador.score ?? null,
    };
  }

  const insertResponse = await supabase
    .from('jugadores')
    .insert({
      nombre: trimmedName,
      usuario_id: null,
    })
    .select('id, usuario_id, nombre, avatar_url, score')
    .single();

  if (insertResponse.error) {
    throw new Error(insertResponse.error.message || 'No se pudo crear el jugador local');
  }

  const created = insertResponse.data;
  return {
    jugador_id: created.id,
    usuario_id: null,
    nombre: created.nombre || trimmedName,
    avatar_url: created.avatar_url || null,
    posicion: null,
    ranking: created.score ?? null,
  };
};

export const listTeamMembers = async (teamId) => {
  const legacyMemberSelect = `
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

  const executeSelect = async (selectClause) => supabase
    .from('team_members')
    .select(selectClause)
    .eq('team_id', teamId)
    .order('is_captain', { ascending: false })
    .order('created_at', { ascending: true });

  let response = await executeSelect(TEAM_MEMBER_SELECT_WITH_PHOTO);
  if (response.error && isMissingColumnError(response.error, 'photo_url')) {
    response = await executeSelect(TEAM_MEMBER_SELECT_BASE);
  }
  if (
    response.error
    && (isMissingColumnError(response.error, 'user_id') || isMissingColumnError(response.error, 'permissions_role'))
  ) {
    response = await executeSelect(legacyMemberSelect);
  }

  if (response.error) {
    throw new Error(response.error.message || 'No se pudo cargar la plantilla');
  }

  return (response.data || []).map((row) => ({
    ...row,
    user_id: row?.user_id || row?.jugador?.usuario_id || null,
    permissions_role: row?.permissions_role || 'member',
    photo_url: row?.photo_url || null,
  }));
};

export const listTeamPendingInvitations = async (teamId) => {
  const response = await supabase
    .from('team_invitations')
    .select(TEAM_INVITATION_SELECT)
    .eq('team_id', teamId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  if (response.error) {
    throw new Error(response.error.message || 'No se pudieron cargar las invitaciones del equipo');
  }

  return response.data || [];
};

export const listIncomingTeamInvitations = async (userId) => {
  assertAuthenticatedUser(userId);

  const response = await supabase
    .from('team_invitations')
    .select(TEAM_INVITATION_SELECT)
    .eq('invited_user_id', userId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  if (response.error) {
    throw new Error(response.error.message || 'No se pudieron cargar las invitaciones pendientes');
  }

  return response.data || [];
};

export const sendTeamInvitation = async ({ teamId, invitedUserId }) => {
  const response = await supabase.rpc('rpc_send_team_invitation', {
    p_team_id: teamId,
    p_invited_user_id: invitedUserId,
  });

  if (response.error) {
    throw new Error(response.error.message || 'No se pudo enviar la invitacion');
  }

  return response.data;
};

export const acceptTeamInvitation = async (invitationId) => {
  const response = await supabase.rpc('rpc_accept_team_invitation', {
    p_invitation_id: invitationId,
  });

  if (response.error) {
    throw new Error(response.error.message || 'No se pudo aceptar la invitacion');
  }

  return response.data;
};

export const rejectTeamInvitation = async (invitationId) => {
  const response = await supabase.rpc('rpc_reject_team_invitation', {
    p_invitation_id: invitationId,
  });

  if (response.error) {
    throw new Error(response.error.message || 'No se pudo rechazar la invitacion');
  }

  return response.data;
};

export const revokeTeamInvitation = async (invitationId) => {
  const response = await supabase.rpc('rpc_revoke_team_invitation', {
    p_invitation_id: invitationId,
  });

  if (response.error) {
    throw new Error(response.error.message || 'No se pudo revocar la invitacion');
  }

  return response.data;
};

export const addTeamMember = async ({
  teamId,
  jugadorId,
  userId = null,
  permissionsRole = 'member',
  role = 'player',
  isCaptain = false,
  shirtNumber = null,
  photoUrl = null,
}) => {
  const roleCandidates = getRoleCandidates(role);
  let response = null;

  for (const roleCandidate of roleCandidates) {
    const insertPayload = {
      team_id: teamId,
      jugador_id: jugadorId,
      user_id: userId,
      permissions_role: permissionsRole,
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

    if (
      response.error
      && (isMissingColumnError(response.error, 'user_id') || isMissingColumnError(response.error, 'permissions_role'))
    ) {
      const compatibilityPayload = { ...insertPayload };
      delete compatibilityPayload.user_id;
      delete compatibilityPayload.permissions_role;
      response = await supabase
        .from('team_members')
        .insert(compatibilityPayload)
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
  if ('permissions_role' in updates) payloadBase.permissions_role = updates.permissions_role;

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

    if (response.error && isMissingColumnError(response.error, 'permissions_role')) {
      const compatibilityPayload = { ...payload };
      delete compatibilityPayload.permissions_role;
      response = await supabase
        .from('team_members')
        .update(compatibilityPayload)
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

  const response = await runChallengeSelectWithFallback(execute);

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
    const queryFactory = (selectClause) => buildQuery(supabase.from('challenges').select(selectClause));
    return runChallengeSelectWithFallback(queryFactory);
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
      mode: payload.mode || null,
      location: payload.location || payload.location_name || null,
      location_name: payload.location_name || null,
      location_place_id: payload.location_place_id || null,
      format: Number(payload.format),
      skill_level: skillCandidate,
      cancha_cost: payload.cancha_cost ?? payload.field_price ?? null,
      field_price: payload.field_price ?? null,
      notes: payload.notes || null,
    };

    const payloadVariants = buildChallengeInsertPayloadVariants(insertPayload);
    for (const payloadVariant of payloadVariants) {
      response = await supabase
        .from('challenges')
        .insert(payloadVariant)
        .select(CHALLENGE_SELECT_WITH_PRICING)
        .single();

      if (response.error && isChallengeSelectCompatibilityError(response.error)) {
        response = await runChallengeSelectWithFallback(
          (selectClause) => supabase
            .from('challenges')
            .insert(payloadVariant)
            .select(selectClause)
            .single(),
          CHALLENGE_SELECT_BASE,
        );
      }

      if (!response.error) {
        return withChallengeCompatibility(response.data);
      }

      if (isSkillLevelConstraintError(response.error)) {
        break;
      }

      if (!(isChallengeWriteCompatibilityError(response.error) || isChallengeSelectCompatibilityError(response.error))) {
        break;
      }
    }

    if (!isSkillLevelConstraintError(response.error)) break;
  }

  throw new Error(response?.error?.message || 'No se pudo publicar el desafio');
};

export const cancelChallenge = async (challengeId) => {
  const response = await runChallengeSelectWithFallback(
    (selectClause) => supabase
      .from('challenges')
      .update({ status: 'canceled' })
      .eq('id', challengeId)
      .select(selectClause)
      .single(),
  );

  return withChallengeCompatibility(unwrapSingle(response, 'No se pudo cancelar el desafio'));
};

export const acceptChallenge = async (challengeId, acceptedTeamId, _options = {}) => {
  const response = await supabase.rpc('rpc_accept_challenge', {
    p_challenge_id: challengeId,
    p_accepted_team_id: acceptedTeamId,
  });

  if (response.error) {
    const message = String(response.error.message || '').trim();
    const details = String(response.error.details || '').trim();
    const hint = String(response.error.hint || '').trim();
    const normalized = normalizeMessage(response.error);

    if (normalized.includes('formato invalido para aceptar challenge')) {
      throw new Error('La base no permite formato combinado todavia. Ejecuta la ultima migracion y reintenta.');
    }

    // If another request accepted it first, recover by opening the existing match.
    if (normalized.includes('estado open')) {
      try {
        const existingMatch = await getTeamMatchByChallengeId(challengeId);
        if (existingMatch?.id) {
          const challenge = await getChallengeById(challengeId);
          return {
            challenge,
            matchId: existingMatch.id,
            recovered: true,
          };
        }
      } catch (_) {
        // keep original error path
      }
    }

    const combinedMessage = [message, details, hint].filter(Boolean).join(' · ');
    throw new Error(combinedMessage || 'No se pudo aceptar el desafio');
  }

  const rpcRow = Array.isArray(response.data) ? response.data[0] : response.data;
  const matchId = rpcRow?.match_id || rpcRow?.matchId || null;
  const challenge = await getChallengeById(challengeId);
  return {
    challenge,
    matchId,
  };
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
  const response = await runChallengeSelectWithFallback(
    (selectClause) => supabase
      .from('challenges')
      .select(selectClause)
      .eq('id', challengeId)
      .single(),
  );

  return withChallengeCompatibility(unwrapSingle(response, 'No se pudo cargar el desafio'));
};

const resolveUserAdminTeamIds = async ({ userId, teamIds, teamRows = [] }) => {
  const adminTeamIds = new Set(
    (teamRows || [])
      .filter((team) => String(team?.owner_user_id || '') === String(userId || ''))
      .map((team) => team.id)
      .filter(Boolean),
  );

  if (!userId || !Array.isArray(teamIds) || teamIds.length === 0) {
    return adminTeamIds;
  }

  let response = await supabase
    .from('team_members')
    .select('team_id, permissions_role')
    .in('team_id', teamIds)
    .eq('user_id', userId);

  if (response.error && isMissingColumnError(response.error, 'user_id')) {
    const jugadoresResponse = await supabase
      .from('jugadores')
      .select('id')
      .eq('usuario_id', userId);

    if (jugadoresResponse.error) {
      throw new Error(jugadoresResponse.error.message || 'No se pudieron cargar tus jugadores');
    }

    const jugadorIds = (jugadoresResponse.data || []).map((row) => row?.id).filter(Boolean);
    if (jugadorIds.length > 0) {
      response = await supabase
        .from('team_members')
        .select('team_id, permissions_role')
        .in('team_id', teamIds)
        .in('jugador_id', jugadorIds);
    } else {
      response = { data: [], error: null };
    }
  }

  if (response.error && isMissingColumnError(response.error, 'permissions_role')) {
    response = { data: response.data || [], error: null };
  }

  if (response.error) {
    throw new Error(response.error.message || 'No se pudieron cargar tus permisos de equipos');
  }

  (response.data || []).forEach((row) => {
    const role = String(row?.permissions_role || '').toLowerCase();
    if (role === 'owner' || role === 'admin') {
      adminTeamIds.add(row.team_id);
    }
  });

  return adminTeamIds;
};

export const getTeamMatchById = async (matchId) => {
  if (!matchId) throw new Error('Partido invalido');

  const response = await runTeamMatchSelectWithFallback(
    (selectClause) => supabase
      .from('team_matches')
      .select(selectClause)
      .eq('id', matchId)
      .single(),
  );

  if (response.error) {
    throw new Error(response.error.message || 'No se pudo cargar el partido');
  }

  return withTeamMatchCompatibility(response.data);
};

export const getTeamMatchByChallengeId = async (challengeId) => {
  if (!challengeId) return null;

  const response = await runTeamMatchSelectWithFallback(
    (selectClause) => supabase
      .from('team_matches')
      .select(selectClause)
      .eq('challenge_id', challengeId)
      .maybeSingle(),
  );

  if (response.error) {
    throw new Error(response.error.message || 'No se pudo cargar el partido del desafio');
  }

  if (!response.data) return null;
  return withTeamMatchCompatibility(response.data);
};

export const canManageTeamMatch = async (matchId) => {
  if (!matchId) return false;

  const response = await supabase.rpc('rpc_can_manage_team_match', {
    p_match_id: matchId,
  });

  if (response.error) {
    throw new Error(response.error.message || 'No se pudo validar permisos del partido');
  }

  return Boolean(response.data);
};

export const updateTeamMatchDetails = async ({
  matchId,
  scheduledAt = null,
  location = null,
  canchaCost = null,
  mode = null,
}) => {
  if (!matchId) throw new Error('Partido invalido');

  const response = await supabase.rpc('rpc_update_team_match_details', {
    p_match_id: matchId,
    p_scheduled_at: scheduledAt,
    p_location: location,
    p_cancha_cost: canchaCost,
    p_mode: mode,
  });

  if (response.error) {
    throw new Error(response.error.message || 'No se pudo actualizar el partido');
  }

  return withTeamMatchCompatibility(response.data);
};

export const cancelTeamMatch = async (matchId) => {
  if (!matchId) throw new Error('Partido invalido');

  const response = await supabase.rpc('rpc_cancel_team_match', {
    p_match_id: matchId,
  });

  if (response.error) {
    throw new Error(response.error.message || 'No se pudo cancelar el partido');
  }

  return withTeamMatchCompatibility(response.data);
};

export const listMyTeamMatches = async (userId, options = {}) => {
  assertAuthenticatedUser(userId);

  const statuses = Array.isArray(options?.statuses)
    ? options.statuses.map((status) => normalizeTeamMatchStatus(status))
    : ['pending', 'confirmed'];

  const teams = await listAccessibleTeams(userId);
  const teamIds = (teams || []).map((team) => team.id).filter(Boolean);
  if (teamIds.length === 0) return [];

  const queryByTeamColumn = async (columnName) => {
    const execute = (selectClause, orderColumn) => {
      let query = supabase
        .from('team_matches')
        .select(selectClause)
        .in(columnName, teamIds);

      if (statuses.length > 0) {
        query = query.in('status', statuses);
      }

      return query.order(orderColumn, { ascending: true, nullsFirst: false });
    };

    let response = await runTeamMatchSelectWithFallback(
      (selectClause) => execute(selectClause, 'scheduled_at'),
    );

    if (response.error && isMissingColumnError(response.error, 'scheduled_at')) {
      response = await runTeamMatchSelectWithFallback(
        (selectClause) => execute(selectClause, 'played_at'),
      );
    }

    return response;
  };

  const [asTeamA, asTeamB] = await Promise.all([
    queryByTeamColumn('team_a_id'),
    queryByTeamColumn('team_b_id'),
  ]);

  if (asTeamA.error && asTeamB.error) {
    throw new Error(asTeamA.error.message || asTeamB.error.message || 'No se pudieron cargar tus partidos de equipos');
  }

  const mergedRows = [...(asTeamA.data || []), ...(asTeamB.data || [])];
  const dedup = new Map();
  mergedRows.forEach((row) => {
    if (!row?.id) return;
    dedup.set(row.id, withTeamMatchCompatibility(row));
  });

  const adminTeamIds = await resolveUserAdminTeamIds({
    userId,
    teamIds,
    teamRows: teams,
  });

  return Array.from(dedup.values())
    .map((match) => {
      const canManage = adminTeamIds.has(match?.team_a_id)
        || adminTeamIds.has(match?.team_b_id)
        || String(match?.team_a?.owner_user_id || '') === String(userId)
        || String(match?.team_b?.owner_user_id || '') === String(userId);

      return {
        ...match,
        canManage,
      };
    })
    .sort((a, b) => {
      const timeA = a?.scheduled_at ? new Date(a.scheduled_at).getTime() : Number.MAX_SAFE_INTEGER;
      const timeB = b?.scheduled_at ? new Date(b.scheduled_at).getTime() : Number.MAX_SAFE_INTEGER;
      if (timeA !== timeB) return timeA - timeB;
      return new Date(b?.created_at || 0).getTime() - new Date(a?.created_at || 0).getTime();
    });
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

export const listTeamMatchHistory = async (teamId) => {
  if (!teamId) return [];

  const response = await supabase
    .from('team_matches')
    .select(`
      id,
      team_a_id,
      team_b_id,
      played_at,
      location_name,
      score_a,
      score_b,
      status,
      created_at,
      team_a:teams!team_matches_team_a_id_fkey(${TEAM_SELECT}),
      team_b:teams!team_matches_team_b_id_fkey(${TEAM_SELECT})
    `)
    .or(`team_a_id.eq.${teamId},team_b_id.eq.${teamId}`)
    .eq('status', 'played')
    .order('played_at', { ascending: false });

  if (response.error) {
    throw new Error(response.error.message || 'No se pudo cargar el historial de partidos');
  }

  const targetTeamId = String(teamId);

  return (response.data || []).map((row) => {
    const isTeamA = String(row?.team_a_id) === targetTeamId;
    const goalsFor = Number(isTeamA ? row?.score_a : row?.score_b) || 0;
    const goalsAgainst = Number(isTeamA ? row?.score_b : row?.score_a) || 0;
    const result = goalsFor > goalsAgainst ? 'W' : goalsFor < goalsAgainst ? 'L' : 'D';

    return {
      id: row.id,
      playedAt: row.played_at || null,
      createdAt: row.created_at || null,
      locationName: row.location || row.location_name || null,
      scoreFor: goalsFor,
      scoreAgainst: goalsAgainst,
      result,
      status: row.status || 'played',
      opponentTeam: isTeamA ? row?.team_b || null : row?.team_a || null,
    };
  });
};

export const canAccessTeamChat = async ({ teamId, userId }) => {
  assertAuthenticatedUser(userId);
  if (!teamId) return false;

  const teamResponse = await supabase
    .from('teams')
    .select('id, owner_user_id')
    .eq('id', teamId)
    .eq('is_active', true)
    .maybeSingle();

  if (teamResponse.error) {
    throw new Error(teamResponse.error.message || 'No se pudo validar el equipo');
  }

  if (!teamResponse.data) return false;
  if (String(teamResponse.data.owner_user_id || '') === String(userId)) return true;

  let memberResponse = await supabase
    .from('team_members')
    .select('id')
    .eq('team_id', teamId)
    .eq('user_id', userId)
    .limit(1);

  if (memberResponse.error && isMissingColumnError(memberResponse.error, 'user_id')) {
    memberResponse = await supabase
      .from('team_members')
      .select(`
        id,
        jugador:jugadores!team_members_jugador_id_fkey(
          usuario_id
        )
      `)
      .eq('team_id', teamId);

    if (memberResponse.error) {
      throw new Error(memberResponse.error.message || 'No se pudo validar la membresia del equipo');
    }

    return Boolean(
      (memberResponse.data || []).some(
        (row) => String(row?.jugador?.usuario_id || '') === String(userId),
      ),
    );
  }

  if (memberResponse.error) {
    throw new Error(memberResponse.error.message || 'No se pudo validar la membresia del equipo');
  }

  return Boolean((memberResponse.data || [])[0]?.id);
};

export const listTeamChatMessages = async (teamId) => {
  if (!teamId) return [];

  let response = await supabase
    .from('team_chat_messages')
    .select(TEAM_CHAT_MESSAGE_SELECT)
    .eq('team_id', teamId)
    .order('timestamp', { ascending: true });

  if (response.error && isMissingColumnError(response.error, 'timestamp')) {
    response = await supabase
      .from('team_chat_messages')
      .select(TEAM_CHAT_MESSAGE_SELECT)
      .eq('team_id', teamId)
      .order('created_at', { ascending: true });
  }

  if (response.error) {
    throw new Error(response.error.message || 'No se pudieron cargar los mensajes del equipo');
  }

  return (response.data || []).map((row) => ({
    ...row,
    timestamp: row?.timestamp || row?.created_at || null,
  }));
};

export const sendTeamChatMessage = async ({ teamId, author, message }) => {
  const trimmedMessage = String(message || '').trim();
  if (!teamId) throw new Error('Equipo invalido');
  if (!trimmedMessage) throw new Error('Mensaje vacio');

  const response = await supabase.rpc('send_team_chat_message', {
    p_team_id: teamId,
    p_autor: String(author || '').trim(),
    p_mensaje: trimmedMessage,
  });

  if (!response.error) return true;

  const missingRpc = response.error.code === '42883'
    || normalizeMessage(response.error).includes('send_team_chat_message');

  if (!missingRpc) {
    throw new Error(response.error.message || 'No se pudo enviar el mensaje');
  }

  const insertPayload = {
    team_id: teamId,
    autor: String(author || '').trim() || 'Usuario',
    mensaje: trimmedMessage,
  };

  const insertResponse = await supabase
    .from('team_chat_messages')
    .insert(insertPayload)
    .select('id')
    .single();

  unwrapSingle(insertResponse, 'No se pudo enviar el mensaje');
  return true;
};
