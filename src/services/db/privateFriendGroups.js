import { supabase } from '../../lib/supabaseClient';
import {
  buildInviteStateByUser,
  buildMatchNotificationOrFilter,
} from '../../utils/matchInviteState';

const PRIVATE_GROUP_USER_FIELDS = 'id, nombre, avatar_url, email, localidad';
const PRIVATE_GROUPS_DEBUG_PREFIX = '[AMIGOS_DEBUG][privateFriendGroups]';

const normalizeId = (value) => {
  const normalized = String(value || '').trim();
  return normalized || null;
};

const normalizeIdList = (values = []) => Array.from(new Set(
  (Array.isArray(values) ? values : [values])
    .map(normalizeId)
    .filter(Boolean),
));

const normalizeGroupName = (value) => String(value || '').replace(/\s+/g, ' ').trim();

const isNotFoundError = (error) => error?.code === 'PGRST116';

const buildPrivateGroupError = (message, error) => {
  const nextError = new Error(message);
  if (error && typeof error === 'object') {
    nextError.code = error.code || null;
    nextError.details = error.details || null;
    nextError.hint = error.hint || null;
    nextError.cause = error;
  }
  return nextError;
};

const mapPrivateGroupError = (error) => {
  const code = String(error?.code || '').trim();
  const message = String(error?.message || '').trim();
  const details = String(error?.details || '').trim();
  const hint = String(error?.hint || '').trim();
  const combinedMessage = [message, details, hint].filter(Boolean).join(' | ').toLowerCase();

  if (code === '23505' && combinedMessage.includes('private_friend_groups_owner_name_active_uidx')) {
    return buildPrivateGroupError('Ya tenés un grupo activo con ese nombre.', error);
  }
  if (code === '23505' && combinedMessage.includes('private_friend_group_members_unique_group_friend')) {
    return buildPrivateGroupError('Ese amigo ya está en el grupo.', error);
  }
  if (combinedMessage.includes('private_friend_group_member_must_be_friend')) {
    return buildPrivateGroupError('Solo podés agregar amigos actuales a un grupo.', error);
  }
  if (combinedMessage.includes('private_friend_group_self_member_forbidden')) {
    return buildPrivateGroupError('No podés agregarte a tu propio grupo.', error);
  }
  if (combinedMessage.includes('private_friend_group_archived')) {
    return buildPrivateGroupError('No podés modificar un grupo archivado.', error);
  }
  if (code === '23503' && combinedMessage.includes('owner_user_id')) {
    return buildPrivateGroupError('No se encontró tu perfil para crear el grupo. Cerrá sesión y volvé a entrar.', error);
  }
  if (code === '23503' && combinedMessage.includes('friend_user_id')) {
    return buildPrivateGroupError('Uno de los amigos seleccionados ya no está disponible para este grupo.', error);
  }
  if (code === '23514' && combinedMessage.includes('private_friend_groups_name_not_blank')) {
    return buildPrivateGroupError('El nombre del grupo es obligatorio.', error);
  }
  if (
    code === '42501'
    || combinedMessage.includes('row-level security')
    || combinedMessage.includes('permission denied')
  ) {
    return buildPrivateGroupError('No tenés permisos para crear o modificar este grupo.', error);
  }
  if (
    combinedMessage.includes('auth session missing')
    || combinedMessage.includes('jwt')
    || combinedMessage.includes('not authenticated')
  ) {
    return buildPrivateGroupError('Tu sesión no es válida. Volvé a iniciar sesión e intentá de nuevo.', error);
  }

  if (error instanceof Error && !code && !details && !hint) {
    return error;
  }

  const fallbackMessage = message || details || hint || `No se pudo completar la operación de grupos. Código: ${code || 'desconocido'}`;
  return buildPrivateGroupError(fallbackMessage, error);
};

const ensureGroupName = (value) => {
  const normalized = normalizeGroupName(value);
  if (!normalized) {
    throw new Error('El nombre del grupo es obligatorio.');
  }
  return normalized;
};

const listAcceptedFriendUserIds = async (ownerUserId, client = supabase) => {
  const normalizedOwnerUserId = normalizeId(ownerUserId);
  if (!normalizedOwnerUserId) return [];

  const [
    { data: directRows, error: directError },
    { data: reverseRows, error: reverseError },
  ] = await Promise.all([
    client
      .from('amigos')
      .select('friend_id')
      .eq('user_id', normalizedOwnerUserId)
      .eq('status', 'accepted'),
    client
      .from('amigos')
      .select('user_id')
      .eq('friend_id', normalizedOwnerUserId)
      .eq('status', 'accepted'),
  ]);

  if (directError) throw directError;
  if (reverseError) throw reverseError;

  return normalizeIdList([
    ...(directRows || []).map((row) => row?.friend_id),
    ...(reverseRows || []).map((row) => row?.user_id),
  ]).filter((userId) => userId !== normalizedOwnerUserId);
};

const fetchUsersById = async (userIds = [], client = supabase, debugMeta = {}) => {
  const normalizedUserIds = normalizeIdList(userIds);
  if (normalizedUserIds.length === 0) return new Map();

  console.info(`${PRIVATE_GROUPS_DEBUG_PREFIX}[users][start]`, {
    requestId: debugMeta?.requestId || null,
    count: normalizedUserIds.length,
  });

  const { data, error } = await client
    .from('usuarios')
    .select(PRIVATE_GROUP_USER_FIELDS)
    .in('id', normalizedUserIds);

  if (error) throw error;

  console.info(`${PRIVATE_GROUPS_DEBUG_PREFIX}[users][end]`, {
    requestId: debugMeta?.requestId || null,
    count: Array.isArray(data) ? data.length : 0,
  });

  return new Map((data || []).map((row) => [normalizeId(row?.id), row]).filter(([id]) => Boolean(id)));
};

const fetchBasePrivateGroupsByOwner = async (ownerUserId, options = {}, client = supabase) => {
  const normalizedOwnerUserId = normalizeId(ownerUserId);
  if (!normalizedOwnerUserId) return [];

  const debugRequestId = options?.debugRequestId || null;
  const debugSource = options?.debugSource || null;
  const includeArchived = options?.includeArchived === true;

  console.info(`${PRIVATE_GROUPS_DEBUG_PREFIX}[raw-query][start]`, {
    requestId: debugRequestId,
    source: debugSource,
    ownerUserId: normalizedOwnerUserId,
    includeArchived,
  });

  let query = client
    .from('private_friend_groups')
    .select('id, owner_user_id, name, created_at, updated_at, archived_at')
    .eq('owner_user_id', normalizedOwnerUserId)
    .order('updated_at', { ascending: false });

  if (!includeArchived) {
    query = query.is('archived_at', null);
  }

  const { data, error } = await query;
  if (error) throw mapPrivateGroupError(error);

  const groupRows = data || [];
  console.info(`${PRIVATE_GROUPS_DEBUG_PREFIX}[raw-query][resolved]`, {
    requestId: debugRequestId,
    source: debugSource,
    rawRowCount: groupRows.length,
  });

  return groupRows;
};

const getOwnedGroupRecord = async ({
  groupId,
  ownerUserId,
  requireActive = false,
}, client = supabase) => {
  const normalizedGroupId = normalizeId(groupId);
  const normalizedOwnerUserId = normalizeId(ownerUserId);
  if (!normalizedGroupId || !normalizedOwnerUserId) return null;

  let query = client
    .from('private_friend_groups')
    .select('id, owner_user_id, archived_at')
    .eq('id', normalizedGroupId)
    .eq('owner_user_id', normalizedOwnerUserId);

  if (requireActive) {
    query = query.is('archived_at', null);
  }

  const { data, error } = await query.maybeSingle();
  if (error && !isNotFoundError(error)) throw mapPrivateGroupError(error);
  return data || null;
};

const ensureOwnedGroupRecord = async ({
  groupId,
  ownerUserId,
  requireActive = false,
  missingMessage = 'No se encontró el grupo o no tenés permisos para modificarlo.',
}, client = supabase) => {
  const groupRecord = await getOwnedGroupRecord({
    groupId,
    ownerUserId,
    requireActive,
  }, client);

  if (!groupRecord) {
    throw new Error(missingMessage);
  }

  return groupRecord;
};

const fetchGroupMembersByGroupId = async (groupIds = [], client = supabase, debugMeta = {}) => {
  const normalizedGroupIds = normalizeIdList(groupIds);
  if (normalizedGroupIds.length === 0) {
    console.info(`${PRIVATE_GROUPS_DEBUG_PREFIX}[members][skip-empty-groups]`, {
      requestId: debugMeta?.requestId || null,
    });
    return new Map();
  }

  console.info(`${PRIVATE_GROUPS_DEBUG_PREFIX}[members][start]`, {
    requestId: debugMeta?.requestId || null,
    groupCount: normalizedGroupIds.length,
  });

  const { data: memberRows, error: memberError } = await client
    .from('private_friend_group_members')
    .select('id, group_id, friend_user_id, created_at')
    .in('group_id', normalizedGroupIds)
    .order('created_at', { ascending: true });

  if (memberError) throw memberError;

  console.info(`${PRIVATE_GROUPS_DEBUG_PREFIX}[members][rows-fetched]`, {
    requestId: debugMeta?.requestId || null,
    memberRowCount: Array.isArray(memberRows) ? memberRows.length : 0,
  });

  const profileById = await fetchUsersById(
    (memberRows || []).map((row) => row?.friend_user_id),
    client,
    debugMeta,
  );

  const membersByGroupId = new Map();
  (memberRows || []).forEach((row) => {
    const groupId = normalizeId(row?.group_id);
    if (!groupId) return;

    const friendUserId = normalizeId(row?.friend_user_id);
    const bucket = membersByGroupId.get(groupId) || [];
    bucket.push({
      id: row?.id || null,
      group_id: groupId,
      friend_user_id: friendUserId,
      created_at: row?.created_at || null,
      profile: friendUserId ? (profileById.get(friendUserId) || null) : null,
    });
    membersByGroupId.set(groupId, bucket);
  });

  membersByGroupId.forEach((members, groupId) => {
    membersByGroupId.set(
      groupId,
      [...members].sort((left, right) => {
        const a = String(left?.profile?.nombre || '').trim();
        const b = String(right?.profile?.nombre || '').trim();
        return a.localeCompare(b, 'es', { sensitivity: 'base' });
      }),
    );
  });

  console.info(`${PRIVATE_GROUPS_DEBUG_PREFIX}[members][end]`, {
    requestId: debugMeta?.requestId || null,
    resolvedGroupCount: membersByGroupId.size,
  });

  return membersByGroupId;
};

const mapGroupRow = (row, membersByGroupId) => {
  const groupId = normalizeId(row?.id);
  const members = membersByGroupId.get(groupId) || [];

  return {
    id: groupId,
    owner_user_id: normalizeId(row?.owner_user_id),
    name: row?.name || 'Grupo',
    created_at: row?.created_at || null,
    updated_at: row?.updated_at || null,
    archived_at: row?.archived_at || null,
    members,
    member_count: members.length,
  };
};

const mapRawGroupRow = (row) => ({
  id: normalizeId(row?.id),
  owner_user_id: normalizeId(row?.owner_user_id),
  name: row?.name || 'Grupo',
  created_at: row?.created_at || null,
  updated_at: row?.updated_at || null,
  archived_at: row?.archived_at || null,
  members: [],
  member_count: 0,
  raw_only: true,
});

const fetchPendingInviteStateByUserId = async ({
  matchId,
  userIds,
  client = supabase,
}) => {
  const normalizedUserIds = normalizeIdList(userIds);
  const matchIdText = normalizeId(matchId);
  if (!matchIdText || normalizedUserIds.length === 0) return new Map();

  const { data: extRows, error: extError } = await client
    .from('notifications_ext')
    .select('user_id, type, data, send_at, created_at')
    .eq('match_id_text', matchIdText)
    .in('type', ['match_invite', 'match_kicked'])
    .in('user_id', normalizedUserIds);

  if (!extError) {
    return buildInviteStateByUser(extRows || []);
  }

  if (extError.code !== '42P01') {
    throw extError;
  }

  let fallbackQuery = client
    .from('notifications')
    .select('user_id, type, data, send_at, created_at, partido_id, match_ref')
    .in('type', ['match_invite', 'match_kicked'])
    .in('user_id', normalizedUserIds);

  const matchFilter = buildMatchNotificationOrFilter(matchId);
  if (matchFilter) {
    fallbackQuery = fallbackQuery.or(matchFilter);
  }

  const { data: fallbackRows, error: fallbackError } = await fallbackQuery;
  if (fallbackError) throw fallbackError;

  return buildInviteStateByUser(fallbackRows || []);
};

const fetchMatchMemberUserIds = async (matchId, userIds = [], client = supabase) => {
  const normalizedMatchId = Number(matchId);
  const normalizedUserIds = normalizeIdList(userIds);
  if (!Number.isFinite(normalizedMatchId) || normalizedMatchId <= 0 || normalizedUserIds.length === 0) {
    return new Set();
  }

  const { data, error } = await client
    .from('jugadores')
    .select('usuario_id')
    .eq('partido_id', normalizedMatchId)
    .not('usuario_id', 'is', null)
    .in('usuario_id', normalizedUserIds);

  if (error) throw error;

  return new Set(
    (data || [])
      .map((row) => normalizeId(row?.usuario_id))
      .filter(Boolean),
  );
};

const fetchProfilesForResolver = async (userIds = [], client = supabase) => {
  const normalizedUserIds = normalizeIdList(userIds);
  if (normalizedUserIds.length === 0) return new Map();

  const { data, error } = await client
    .from('usuarios')
    .select('id, nombre, avatar_url, acepta_invitaciones')
    .in('id', normalizedUserIds);

  if (error) throw error;

  return new Map((data || []).map((row) => [normalizeId(row?.id), row]).filter(([id]) => Boolean(id)));
};

const toInviteUserSummary = (userId, profileById) => {
  const normalizedUserId = normalizeId(userId);
  const profile = normalizedUserId ? (profileById.get(normalizedUserId) || null) : null;

  return {
    id: normalizedUserId,
    user_id: normalizedUserId,
    nombre: profile?.nombre || 'Usuario',
    avatar_url: profile?.avatar_url || null,
  };
};

export const getPrivateGroupsByOwner = async (ownerUserId, options = {}, client = supabase) => {
  const normalizedOwnerUserId = normalizeId(ownerUserId);
  if (!normalizedOwnerUserId) return [];
  const debugRequestId = options?.debugRequestId || null;
  const debugSource = options?.debugSource || null;

  console.info(`${PRIVATE_GROUPS_DEBUG_PREFIX}[groups][start]`, {
    requestId: debugRequestId,
    source: debugSource,
    ownerUserId: normalizedOwnerUserId,
    rawOnly: options?.rawOnly === true,
  });

  const groupRows = await fetchBasePrivateGroupsByOwner(ownerUserId, options, client);
  console.info(`${PRIVATE_GROUPS_DEBUG_PREFIX}[groups][query-finished]`, {
    requestId: debugRequestId,
    groupCount: groupRows.length,
    rawOnly: options?.rawOnly === true,
  });

  if (options?.rawOnly === true) {
    const rawGroups = groupRows.map(mapRawGroupRow);
    console.info(`${PRIVATE_GROUPS_DEBUG_PREFIX}[groups][raw-only-bypass-enrichment]`, {
      requestId: debugRequestId,
      rawRowCount: rawGroups.length,
    });
    return rawGroups;
  }

  const membersByGroupId = await fetchGroupMembersByGroupId(
    groupRows.map((row) => row?.id),
    client,
    {
      requestId: debugRequestId,
      ownerUserId: normalizedOwnerUserId,
    },
  );

  const mappedGroups = groupRows.map((row) => mapGroupRow(row, membersByGroupId));
  console.info(`${PRIVATE_GROUPS_DEBUG_PREFIX}[groups][end]`, {
    requestId: debugRequestId,
    groupCount: mappedGroups.length,
  });

  return mappedGroups;
};

export const getPrivateGroupById = async (groupId, ownerUserId, client = supabase) => {
  const normalizedGroupId = normalizeId(groupId);
  const normalizedOwnerUserId = normalizeId(ownerUserId);
  if (!normalizedGroupId || !normalizedOwnerUserId) return null;

  const { data, error } = await client
    .from('private_friend_groups')
    .select('id, owner_user_id, name, created_at, updated_at, archived_at')
    .eq('id', normalizedGroupId)
    .eq('owner_user_id', normalizedOwnerUserId)
    .maybeSingle();

  if (error && !isNotFoundError(error)) throw mapPrivateGroupError(error);
  if (!data) return null;

  const membersByGroupId = await fetchGroupMembersByGroupId([normalizedGroupId], client);
  return mapGroupRow(data, membersByGroupId);
};

export const addFriendsToPrivateGroup = async ({
  groupId,
  ownerUserId,
  friendUserIds = [],
}, client = supabase) => {
  const normalizedGroupId = normalizeId(groupId);
  const normalizedOwnerUserId = normalizeId(ownerUserId);
  const normalizedFriendUserIds = normalizeIdList(friendUserIds);

  if (!normalizedGroupId || !normalizedOwnerUserId || normalizedFriendUserIds.length === 0) {
    return getPrivateGroupById(normalizedGroupId, normalizedOwnerUserId, client);
  }

  try {
    await ensureOwnedGroupRecord({
      groupId: normalizedGroupId,
      ownerUserId: normalizedOwnerUserId,
      requireActive: true,
    }, client);

    const payload = normalizedFriendUserIds.map((friendUserId) => ({
      group_id: normalizedGroupId,
      friend_user_id: friendUserId,
    }));

    const { error } = await client
      .from('private_friend_group_members')
      .insert(payload);

    if (error) throw error;

    return getPrivateGroupById(normalizedGroupId, normalizedOwnerUserId, client);
  } catch (error) {
    throw mapPrivateGroupError(error);
  }
};

export const createPrivateGroup = async ({
  ownerUserId,
  name,
  memberUserIds = [],
}, client = supabase) => {
  const normalizedOwnerUserId = normalizeId(ownerUserId);
  const normalizedName = ensureGroupName(name);
  const normalizedMemberUserIds = normalizeIdList(memberUserIds);

  if (!normalizedOwnerUserId) {
    throw new Error('No se pudo identificar al usuario actual.');
  }

  let createdGroupId = null;

  try {
    const { data, error } = await client
      .from('private_friend_groups')
      .insert([{
        owner_user_id: normalizedOwnerUserId,
        name: normalizedName,
      }])
      .select('id')
      .single();

    if (error) throw error;

    createdGroupId = normalizeId(data?.id);

    if (createdGroupId && normalizedMemberUserIds.length > 0) {
      await addFriendsToPrivateGroup({
        groupId: createdGroupId,
        ownerUserId: normalizedOwnerUserId,
        friendUserIds: normalizedMemberUserIds,
      }, client);
    }

    return getPrivateGroupById(createdGroupId, normalizedOwnerUserId, client);
  } catch (error) {
    if (createdGroupId) {
      await client
        .from('private_friend_groups')
        .delete()
        .eq('id', createdGroupId)
        .eq('owner_user_id', normalizedOwnerUserId);
    }

    throw mapPrivateGroupError(error);
  }
};

export const renamePrivateGroup = async ({
  groupId,
  ownerUserId,
  name,
}, client = supabase) => {
  const normalizedGroupId = normalizeId(groupId);
  const normalizedOwnerUserId = normalizeId(ownerUserId);
  const normalizedName = ensureGroupName(name);

  try {
    await ensureOwnedGroupRecord({
      groupId: normalizedGroupId,
      ownerUserId: normalizedOwnerUserId,
      requireActive: true,
    }, client);

    const { data, error } = await client
      .from('private_friend_groups')
      .update({ name: normalizedName })
      .eq('id', normalizedGroupId)
      .eq('owner_user_id', normalizedOwnerUserId)
      .is('archived_at', null)
      .select('id')
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      throw new Error('No se encontró el grupo o no tenés permisos para modificarlo.');
    }

    return getPrivateGroupById(normalizedGroupId, normalizedOwnerUserId, client);
  } catch (error) {
    throw mapPrivateGroupError(error);
  }
};

export const archivePrivateGroup = async ({
  groupId,
  ownerUserId,
}, client = supabase) => {
  const normalizedGroupId = normalizeId(groupId);
  const normalizedOwnerUserId = normalizeId(ownerUserId);

  try {
    await ensureOwnedGroupRecord({
      groupId: normalizedGroupId,
      ownerUserId: normalizedOwnerUserId,
      requireActive: true,
    }, client);

    const { data, error } = await client
      .from('private_friend_groups')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', normalizedGroupId)
      .eq('owner_user_id', normalizedOwnerUserId)
      .is('archived_at', null)
      .select('id')
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      throw new Error('No se encontró el grupo o no tenés permisos para modificarlo.');
    }

    return true;
  } catch (error) {
    throw mapPrivateGroupError(error);
  }
};

export const addFriendToPrivateGroup = async ({
  groupId,
  ownerUserId,
  friendUserId,
}, client = supabase) => addFriendsToPrivateGroup({
  groupId,
  ownerUserId,
  friendUserIds: [friendUserId],
}, client);

export const removeFriendFromPrivateGroup = async ({
  groupId,
  ownerUserId,
  friendUserId,
}, client = supabase) => {
  const normalizedGroupId = normalizeId(groupId);
  const normalizedOwnerUserId = normalizeId(ownerUserId);
  const normalizedFriendUserId = normalizeId(friendUserId);

  try {
    await ensureOwnedGroupRecord({
      groupId: normalizedGroupId,
      ownerUserId: normalizedOwnerUserId,
      requireActive: true,
    }, client);

    const { data, error } = await client
      .from('private_friend_group_members')
      .delete()
      .eq('group_id', normalizedGroupId)
      .eq('friend_user_id', normalizedFriendUserId)
      .select('id');

    if (error) throw error;
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error('Ese amigo no está en este grupo.');
    }

    return getPrivateGroupById(normalizedGroupId, normalizedOwnerUserId, client);
  } catch (error) {
    throw mapPrivateGroupError(error);
  }
};

export const resolveInviteRecipientsFromGroups = async ({
  matchId,
  ownerUserId,
  selectedGroupIds = [],
  selectedFriendIds = [],
}, client = supabase) => {
  const normalizedOwnerUserId = normalizeId(ownerUserId);
  const normalizedSelectedGroupIds = normalizeIdList(selectedGroupIds);
  const normalizedSelectedFriendIds = normalizeIdList(selectedFriendIds);

  if (!normalizedOwnerUserId) {
    throw new Error('No se pudo identificar al usuario actual.');
  }

  if (normalizedSelectedGroupIds.length === 0 && normalizedSelectedFriendIds.length === 0) {
    return {
      recipients: [],
      skipped: {
        already_in_match: [],
        already_invited: [],
        duplicate: [],
        ineligible: [],
      },
    };
  }

  const acceptedFriendIds = await listAcceptedFriendUserIds(normalizedOwnerUserId, client);
  const acceptedFriendIdSet = new Set(acceptedFriendIds);

  let ownedGroupIds = [];
  if (normalizedSelectedGroupIds.length > 0) {
    const { data: groupRows, error: groupError } = await client
      .from('private_friend_groups')
      .select('id')
      .eq('owner_user_id', normalizedOwnerUserId)
      .is('archived_at', null)
      .in('id', normalizedSelectedGroupIds);

    if (groupError) throw mapPrivateGroupError(groupError);
    ownedGroupIds = normalizeIdList((groupRows || []).map((row) => row?.id));
  }

  let groupMemberRows = [];
  if (ownedGroupIds.length > 0) {
    const { data, error } = await client
      .from('private_friend_group_members')
      .select('group_id, friend_user_id')
      .in('group_id', ownedGroupIds);

    if (error) throw mapPrivateGroupError(error);
    groupMemberRows = data || [];
  }

  const occurrenceCountByUserId = new Map();
  const candidateUserIds = [];

  groupMemberRows.forEach((row) => {
    const friendUserId = normalizeId(row?.friend_user_id);
    if (!friendUserId) return;
    occurrenceCountByUserId.set(friendUserId, (occurrenceCountByUserId.get(friendUserId) || 0) + 1);
    candidateUserIds.push(friendUserId);
  });

  normalizedSelectedFriendIds.forEach((friendUserId) => {
    occurrenceCountByUserId.set(friendUserId, (occurrenceCountByUserId.get(friendUserId) || 0) + 1);
    candidateUserIds.push(friendUserId);
  });

  const uniqueCandidateUserIds = normalizeIdList(candidateUserIds);
  const profileById = await fetchProfilesForResolver(uniqueCandidateUserIds, client);

  const duplicate = uniqueCandidateUserIds
    .filter((userId) => (occurrenceCountByUserId.get(userId) || 0) > 1)
    .map((userId) => toInviteUserSummary(userId, profileById));

  const currentFriendCandidateIds = uniqueCandidateUserIds.filter((userId) => acceptedFriendIdSet.has(userId));
  const nonFriendCandidateIds = uniqueCandidateUserIds.filter((userId) => !acceptedFriendIdSet.has(userId));

  const [alreadyInMatchSet, pendingInviteStateByUserId] = await Promise.all([
    fetchMatchMemberUserIds(matchId, currentFriendCandidateIds, client),
    fetchPendingInviteStateByUserId({ matchId, userIds: currentFriendCandidateIds, client }),
  ]);

  const recipients = [];
  const alreadyInMatch = [];
  const alreadyInvited = [];
  const ineligible = [
    ...nonFriendCandidateIds.map((userId) => toInviteUserSummary(userId, profileById)),
  ];

  currentFriendCandidateIds.forEach((userId) => {
    const profile = profileById.get(userId) || null;
    const inviteState = pendingInviteStateByUserId.get(userId);

    if (!profile || profile.acepta_invitaciones === false) {
      ineligible.push(toInviteUserSummary(userId, profileById));
      return;
    }

    if (alreadyInMatchSet.has(userId)) {
      alreadyInMatch.push(toInviteUserSummary(userId, profileById));
      return;
    }

    if (inviteState?.hasPendingInvite) {
      alreadyInvited.push(toInviteUserSummary(userId, profileById));
      return;
    }

    recipients.push(toInviteUserSummary(userId, profileById));
  });

  return {
    recipients,
    skipped: {
      already_in_match: alreadyInMatch,
      already_invited: alreadyInvited,
      duplicate,
      ineligible,
    },
  };
};

export { normalizeGroupName as normalizePrivateGroupName };
