import { supabase } from '../../lib/supabaseClient';

export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const AWARD_TYPE_ALIASES = {
  mvp: ['mvp'],
  best_gk: [
    'best_gk',
    'guante_dorado',
    'guante dorado',
    'goalkeeper',
    'golden_glove',
    'golden glove',
    'best_goalkeeper',
    'best goalkeeper',
    'mejor_arquero',
    'mejor arquero',
  ],
  red_card: [
    'red_card',
    'red card',
    'red_cards',
    'tarjeta_roja',
    'tarjeta roja',
    'tarjetas_rojas',
    'tarjetas rojas',
    'negative_fair_play',
    'dirty_player',
    'dirty player',
    'player_dirty',
    'mas_sucio',
    'mas sucio',
    'sucio',
  ],
};

export const normalizeIdentityValue = (value) => {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
};

export const normalizeIdentityToken = (value) => {
  const normalized = normalizeIdentityValue(value);
  return normalized ? normalized.toLowerCase() : null;
};

export const isUuidLike = (value) => {
  const normalized = normalizeIdentityValue(value);
  return Boolean(normalized) && UUID_REGEX.test(normalized);
};

export const normalizeAwardType = (value) => {
  const token = normalizeIdentityToken(value);
  if (!token) return null;

  return Object.entries(AWARD_TYPE_ALIASES).find(([, aliases]) => aliases.includes(token))?.[0] || null;
};

export const getAwardCounterField = (awardType) => {
  const normalized = normalizeAwardType(awardType);
  if (normalized === 'mvp') return 'mvps';
  if (normalized === 'best_gk') return 'guantes_dorados';
  if (normalized === 'red_card') return 'tarjetas_rojas';
  return null;
};

export const resolveStablePlayerRef = (player) => {
  if (!player || typeof player !== 'object') return normalizeIdentityValue(player);

  const userId = normalizeIdentityValue(
    player.usuario_id || player.user_id || player.auth_id,
  );
  if (userId) return userId;

  const rosterUuid = normalizeIdentityValue(player.uuid);
  if (rosterUuid) return rosterUuid;

  const playerId = Number(player.id);
  if (Number.isFinite(playerId) && playerId > 0) return String(playerId);

  return null;
};

export const getEntityIdentityValues = (entity) => {
  if (entity === null || entity === undefined) return [];
  if (typeof entity !== 'object') {
    const normalized = normalizeIdentityValue(entity);
    return normalized ? [normalized] : [];
  }

  return [
    entity.usuario_id,
    entity.user_id,
    entity.uuid,
    entity.auth_id,
    entity.player_id,
    entity.jugador_id,
    entity.ref,
    entity.id,
    entity.email,
    entity.nombre,
  ]
    .map(normalizeIdentityValue)
    .filter(Boolean);
};

export const createIdentityTokenSet = (values = []) => new Set(
  (Array.isArray(values) ? values : [values])
    .flatMap((value) => getEntityIdentityValues(value))
    .map(normalizeIdentityToken)
    .filter(Boolean),
);

export const buildUserIdentityTokenSet = ({ user = null, aliasRefs = [] } = {}) => createIdentityTokenSet([
  ...(Array.isArray(aliasRefs) ? aliasRefs : []),
  user?.id,
  user?.email,
  user?.user_metadata?.email,
  user?.user_metadata?.name,
  user?.user_metadata?.full_name,
]);

export const entityMatchesIdentitySet = (entity, identityTokenSet) => {
  if (!(identityTokenSet instanceof Set) || identityTokenSet.size === 0) return false;
  return getEntityIdentityValues(entity)
    .map(normalizeIdentityToken)
    .filter(Boolean)
    .some((token) => identityTokenSet.has(token));
};

export const buildCanonicalAwardCounts = (awardRows = []) => {
  const counts = {
    mvps: 0,
    guantes_dorados: 0,
    tarjetas_rojas: 0,
  };

  (Array.isArray(awardRows) ? awardRows : []).forEach((row) => {
    const normalizedType = normalizeAwardType(row?.award_type ?? row);
    if (normalizedType === 'mvp') counts.mvps += 1;
    if (normalizedType === 'best_gk') counts.guantes_dorados += 1;
    if (normalizedType === 'red_card') counts.tarjetas_rojas += 1;
  });

  return counts;
};

export const listRegisteredUserIdentityRefs = async (userId, client = supabase) => {
  const normalizedUserId = normalizeIdentityValue(userId);
  if (!normalizedUserId) return [];

  const refs = new Set([normalizedUserId]);

  const { data, error } = await client
    .from('jugadores')
    .select('uuid')
    .eq('usuario_id', normalizedUserId)
    .not('uuid', 'is', null);

  if (error) throw error;

  (data || [])
    .map((row) => normalizeIdentityValue(row?.uuid))
    .filter(Boolean)
    .forEach((ref) => refs.add(ref));

  return Array.from(refs);
};

export const resolveRegisteredUserIdFromPlayerRef = async (playerRef, client = supabase) => {
  const normalizedRef = normalizeIdentityValue(playerRef);
  if (!normalizedRef) return null;

  if (isUuidLike(normalizedRef)) {
    const { data: userAliasRows, error: userAliasError } = await client
      .from('jugadores')
      .select('uuid')
      .eq('usuario_id', normalizedRef)
      .not('uuid', 'is', null)
      .limit(1);

    if (userAliasError) throw userAliasError;
    if (Array.isArray(userAliasRows) && userAliasRows.length > 0) {
      return normalizedRef;
    }

    const { data: rosterRows, error: rosterError } = await client
      .from('jugadores')
      .select('usuario_id')
      .eq('uuid', normalizedRef)
      .not('usuario_id', 'is', null)
      .limit(1);

    if (rosterError) throw rosterError;

    const resolved = normalizeIdentityValue(rosterRows?.[0]?.usuario_id);
    return resolved || null;
  }

  return null;
};

export const resolveAwardIdentityRefs = async (playerRef, client = supabase) => {
  const normalizedRef = normalizeIdentityValue(playerRef);
  if (!normalizedRef) return [];

  const resolvedUserId = await resolveRegisteredUserIdFromPlayerRef(normalizedRef, client);
  if (resolvedUserId) {
    return listRegisteredUserIdentityRefs(resolvedUserId, client);
  }

  return [normalizedRef];
};

export const fetchAwardCountsForIdentityRefs = async (identityRefs = [], client = supabase) => {
  const refs = Array.from(new Set((Array.isArray(identityRefs) ? identityRefs : [identityRefs])
    .map(normalizeIdentityValue)
    .filter(Boolean)));

  if (refs.length === 0) {
    return {
      mvps: 0,
      guantes_dorados: 0,
      tarjetas_rojas: 0,
      refs: [],
    };
  }

  const { data, error } = await client
    .from('player_awards')
    .select('award_type')
    .in('jugador_id', refs);

  if (error) throw error;

  return {
    ...buildCanonicalAwardCounts(data || []),
    refs,
  };
};

export const fetchRegisteredUserAwardCounts = async (userId, client = supabase) => {
  const refs = await listRegisteredUserIdentityRefs(userId, client);
  return fetchAwardCountsForIdentityRefs(refs, client);
};

export const fetchAwardCountsForPlayerRef = async (playerRef, client = supabase) => {
  const refs = await resolveAwardIdentityRefs(playerRef, client);
  return fetchAwardCountsForIdentityRefs(refs, client);
};
