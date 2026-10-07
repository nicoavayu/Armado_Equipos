import { resolvePlayerKey } from '../services/surveyTeamsService';

// Who is who in a survey roster. Every row of public.jugadores is one roster slot with its
// own id and uuid; a registered player also has usuario_id. Those IDs decide identity.
// The name only helps to join the same person coming from two sources (a team member or an
// approved squad row next to the match roster) when that person carries no ID that says
// otherwise. Two different players may share a name and have no photo: they stay separate.

export const normalizeIdentityToken = (value) => String(value || '').trim().toLowerCase();

const SYNTHETIC_UUID_PREFIXES = ['tm-', 'member-', 'approved-'];

const realUuidToken = (player) => {
  const token = normalizeIdentityToken(player?.uuid);
  if (!token || SYNTHETIC_UUID_PREFIXES.some((prefix) => token.startsWith(prefix))) return '';
  return token;
};

const positiveId = (player) => {
  const id = Number(player?.id || 0);
  return Number.isFinite(id) && id > 0 ? id : null;
};

const strongTokens = (player) => {
  const tokens = [];
  const userToken = normalizeIdentityToken(player?.usuario_id);
  if (userToken) tokens.push(`user:${userToken}`);
  const id = positiveId(player);
  if (id) tokens.push(`id:${id}`);
  const uuidToken = realUuidToken(player);
  if (uuidToken) tokens.push(`uuid:${uuidToken}`);
  const keyToken = normalizeIdentityToken(resolvePlayerKey(player));
  if (keyToken) tokens.push(`key:${keyToken}`);
  return Array.from(new Set(tokens));
};

const nameTokens = (player, includeLooseName) => {
  const nameToken = normalizeIdentityToken(player?.nombre);
  if (!nameToken) return [];
  const avatarToken = normalizeIdentityToken(player?.avatar_url || player?.foto_url || '');
  const tokens = [`name_avatar:${nameToken}|${avatarToken}`];
  if (includeLooseName) tokens.push(`name:${nameToken}`);
  return tokens;
};

/**
 * True when the IDs of both records prove they are different people: two accounts, or two
 * real roster rows (distinct jugadores.uuid). A numeric id alone does not prove it, because
 * team-member and squad records carry the id of the team's own jugadores row.
 */
export const haveConflictingIdentity = (a, b) => {
  const userA = normalizeIdentityToken(a?.usuario_id);
  const userB = normalizeIdentityToken(b?.usuario_id);
  // The same account may come with two jugadores rows (team row and match row).
  if (userA && userB) return userA !== userB;
  const uuidA = realUuidToken(a);
  const uuidB = realUuidToken(b);
  return Boolean(uuidA && uuidB && uuidA !== uuidB);
};

export const fillMissingPlayerFields = (existing, candidate) => ({
  ...existing,
  uuid: existing?.uuid || candidate?.uuid || null,
  usuario_id: existing?.usuario_id || candidate?.usuario_id || null,
  nombre: existing?.nombre || candidate?.nombre || 'Jugador',
  avatar_url: existing?.avatar_url || candidate?.avatar_url || null,
  score: existing?.score ?? candidate?.score ?? null,
  is_goalkeeper: existing?.is_goalkeeper ?? candidate?.is_goalkeeper ?? false,
});

/**
 * Joins records of the same person and keeps every other player apart.
 * - Same usuario_id, roster id, real uuid or player key: same person.
 * - Same name (and photo, or any photo when includeLooseName): same person only when exactly
 *   one earlier record has that name and no ID of the two records contradicts it.
 */
export const dedupeSurveyRoster = (players = [], options = {}) => {
  const includeLooseName = options?.includeLooseName === true;
  const input = Array.isArray(players) ? players : [];
  const deduped = [];
  const strongIndex = new Map();
  const nameIndexes = new Map();

  const register = (index) => {
    const player = deduped[index];
    strongTokens(player).forEach((token) => strongIndex.set(token, index));
    nameTokens(player, includeLooseName).forEach((token) => {
      const bucket = nameIndexes.get(token) || new Set();
      bucket.add(index);
      nameIndexes.set(token, bucket);
    });
  };

  input.forEach((player) => {
    if (!player) return;
    let existingIndex = strongTokens(player).reduce((found, token) => (
      found >= 0 ? found : (strongIndex.has(token) ? strongIndex.get(token) : -1)
    ), -1);

    if (existingIndex >= 0 && haveConflictingIdentity(deduped[existingIndex], player)) {
      existingIndex = -1;
    }

    if (existingIndex < 0) {
      const candidates = new Set();
      nameTokens(player, includeLooseName).forEach((token) => {
        (nameIndexes.get(token) || new Set()).forEach((index) => candidates.add(index));
      });
      const compatible = Array.from(candidates)
        .filter((index) => !haveConflictingIdentity(deduped[index], player));
      if (compatible.length === 1 && candidates.size === 1) existingIndex = compatible[0];
    }

    if (existingIndex >= 0) {
      deduped[existingIndex] = fillMissingPlayerFields(deduped[existingIndex], player);
      register(existingIndex);
      return;
    }

    deduped.push(player);
    register(deduped.length - 1);
  });

  return deduped;
};

/** One identity per record, IDs first; the name only for a record with no ID at all. */
export const resolveSurveyPlayerIdentity = (player) => {
  const userToken = normalizeIdentityToken(player?.usuario_id);
  if (userToken) return `user:${userToken}`;

  const uuidToken = realUuidToken(player);
  if (uuidToken) return `uuid:${uuidToken}`;

  const id = positiveId(player);
  if (id) return `id:${id}`;

  const keyToken = normalizeIdentityToken(resolvePlayerKey(player));
  if (keyToken) return `key:${keyToken}`;

  const nameToken = normalizeIdentityToken(player?.nombre);
  return nameToken ? `name:${nameToken}` : null;
};

/**
 * Players who share a name need something to tell them apart on screen. Returns a map
 * uuid → short hint ("Con cuenta", "Invitado 2") only for repeated names; roster order
 * (the order they were added) numbers the ones that are still alike.
 */
export const buildHomonymHints = (players = []) => {
  const groups = new Map();
  (Array.isArray(players) ? players : []).forEach((player) => {
    const nameToken = normalizeIdentityToken(player?.nombre);
    if (!nameToken || !player?.uuid) return;
    groups.set(nameToken, [...(groups.get(nameToken) || []), player]);
  });

  const hints = new Map();
  groups.forEach((group) => {
    if (group.length < 2) return;
    const byKind = new Map();
    group.forEach((player) => {
      const kind = player?.usuario_id ? 'Con cuenta' : 'Invitado';
      byKind.set(kind, [...(byKind.get(kind) || []), player]);
    });
    byKind.forEach((sameKind, kind) => {
      sameKind.forEach((player, index) => {
        hints.set(player.uuid, sameKind.length > 1 ? `${kind} ${index + 1}` : kind);
      });
    });
  });
  return hints;
};
