// What the awards ceremony shows for each award, from data the backend already
// confirmed. Pure: no I/O, no counters written — watching, replaying or reloading the
// ceremony never changes anyone's collection.

export const CEREMONY_AWARDS = Object.freeze({
  mvp: {
    type: 'mvp',
    positive: true,
    title: 'MVP',
    longTitle: 'MVP del partido',
    icon: '/mvp_award.webp',
    accent: '#FFD24A',
    glow: 'rgba(255,210,74,0.55)',
    counterField: 'mvps',
    counterLabel: () => 'MVP',
  },
  best_gk: {
    type: 'best_gk',
    positive: true,
    title: 'Mejor arquero',
    longTitle: 'Mejor arquero del partido',
    icon: '/goalkeeper_award.webp',
    accent: '#3EE0F2',
    glow: 'rgba(62,224,242,0.5)',
    counterField: 'guantes_dorados',
    counterLabel: (n) => (n === 1 ? 'guante dorado' : 'guantes dorados'),
  },
  red_card: {
    type: 'red_card',
    positive: false,
    title: 'Tarjeta roja',
    longTitle: 'Tarjeta roja del partido',
    icon: '/redcard_award.webp',
    accent: '#F87171',
    glow: 'rgba(248,113,113,0.28)',
    counterField: 'tarjetas_rojas',
    counterLabel: (n) => (n === 1 ? 'tarjeta roja' : 'tarjetas rojas'),
  },
  penalty: {
    type: 'penalty',
    positive: false,
    title: 'Penalización',
    longTitle: 'Penalización por ausencia',
    icon: '/penalizacion.webp',
    accent: '#FDBA74',
    glow: 'rgba(253,186,116,0.26)',
    counterField: null,
    counterLabel: () => '',
  },
});

const toToken = (value) => String(value ?? '').trim().toLowerCase();

const playerAccountId = (player) => {
  const token = toToken(player?.usuario_id);
  return token || null;
};

const sameAward = (row, type, accountId) => (
  toToken(row?.award_type) === toToken(type) && toToken(row?.jugador_id) === accountId
);

const findMatchAwardRow = ({ type, accountId, matchId, awardRows }) => (
  (Array.isArray(awardRows) ? awardRows : []).find((row) => (
    sameAward(row, type, accountId) && String(row?.partido_id) === String(matchId)
  )) || null
);

/**
 * True when player_awards has this award for this player in this match (the backend
 * granted it). Only then the collection counter is shown as including it.
 */
export const isAwardConfirmed = ({ type, player, matchId, awardRows = [] }) => {
  const accountId = playerAccountId(player);
  if (!accountId) return false;
  return Boolean(findMatchAwardRow({ type, accountId, matchId, awardRows }));
};

/**
 * The collection counter for an award: the real total from the player's profile (it
 * already includes this award once the backend granted it). `before` is total - 1 only
 * when this match is the latest award of that kind for the player; for an older match
 * the counter has moved since, so nothing is animated. null for guests (no collection)
 * and for awards the backend has not confirmed — the ceremony never invents a total.
 */
export const resolveAwardCounter = ({ type, player, matchId, awardRows = [] }) => {
  const meta = CEREMONY_AWARDS[type];
  if (!meta?.counterField) return null;
  const accountId = playerAccountId(player);
  if (!accountId) return null;
  const own = findMatchAwardRow({ type, accountId, matchId, awardRows });
  if (!own) return null;
  const total = Number(player?.[meta.counterField]);
  if (!Number.isFinite(total) || total < 1) return null;
  const ownAt = Date.parse(own.created_at || '') || 0;
  const isLatest = !(Array.isArray(awardRows) ? awardRows : []).some((row) => (
    row !== own
    && sameAward(row, type, accountId)
    && String(row?.partido_id) !== String(matchId)
    && (Date.parse(row?.created_at || '') || 0) > ownAt
  ));
  return {
    total,
    before: isLatest ? total - 1 : total,
    isLatest,
    label: meta.counterLabel(total),
  };
};

/** True when the award belongs to the account watching. */
export const isAwardMine = ({ player, currentUserId }) => {
  const accountId = playerAccountId(player);
  return Boolean(accountId && currentUserId && accountId === toToken(currentUserId));
};

/**
 * The label above the award title, from the point of view of the person watching:
 * "Ganaste" only for their own positive awards, "Sanción" for every negative one.
 */
export const resolveAwardChip = ({ type, isMine }) => {
  const meta = CEREMONY_AWARDS[type];
  if (!meta) return '';
  if (!meta.positive) return isMine ? 'Sanción para vos' : 'Sanción';
  return isMine ? 'Ganaste' : 'Premio';
};

/** What happened to the collection, in words, without inventing a total. */
export const resolveCollectionNote = ({ type, isMine, isGuest, counter }) => {
  const meta = CEREMONY_AWARDS[type];
  if (!meta || !meta.counterField) return '';
  if (isGuest) return 'Jugó como invitado: el premio queda en este partido';
  if (!counter) return 'Premio de este partido';
  if (!counter.isLatest) return isMine ? 'Ya está en tu colección' : 'Ya está en su colección';
  if (!meta.positive) return isMine ? 'Se suma a tu historial' : 'Se suma a su historial';
  return isMine ? 'Sumado a tu colección' : 'Sumado a su colección';
};

/**
 * What the ceremony shows for each award slide ({ key, type, player, votes, penalty }).
 * `profilesById` holds the winners' public profiles (real counters) keyed by lowercase
 * account id; `hints` tells homonyms apart (uuid → hint).
 */
export const buildCeremonyEntries = ({
  slides = [],
  matchId,
  currentUserId = null,
  awardRows = [],
  profilesById = {},
  hints = new Map(),
}) => (Array.isArray(slides) ? slides : [])
  .filter((slide) => CEREMONY_AWARDS[slide?.type])
  .map((slide) => {
    const player = slide.player || {};
    const accountId = playerAccountId(player);
    const profile = accountId ? profilesById[accountId] : null;
    const isMine = isAwardMine({ player, currentUserId });
    const counter = resolveAwardCounter({
      type: slide.type,
      player: { ...(profile || {}), usuario_id: accountId },
      matchId,
      awardRows,
    });
    const votes = Number(slide.votes) || 0;
    // The winner's card as the app shows it, with the real collection counters when the
    // public profile is known (the roster copy may lag behind).
    const counts = profile ? {
      mvps: Number(profile.mvps) || 0,
      guantes_dorados: Number(profile.guantes_dorados) || 0,
      tarjetas_rojas: Number(profile.tarjetas_rojas) || 0,
    } : {
      mvps: Number(player.mvps ?? player.mvp_badges) || 0,
      guantes_dorados: Number(player.guantes_dorados ?? player.gk_badges) || 0,
      tarjetas_rojas: Number(player.tarjetas_rojas ?? player.red_badges) || 0,
    };
    return {
      key: slide.key || slide.type,
      type: slide.type,
      name: String(player.nombre || '').trim() || 'Jugador',
      avatarUrl: player.avatar_url || player.foto_url || null,
      hint: (player.uuid && hints?.get?.(player.uuid)) || null,
      isMine,
      chip: resolveAwardChip({ type: slide.type, isMine }),
      votesLabel: votes > 0 ? `${votes} ${votes === 1 ? 'voto' : 'votos'}` : '',
      counter,
      collectionNote: resolveCollectionNote({ type: slide.type, isMine, isGuest: !accountId, counter }),
      penalty: slide.penalty || null,
      cardProfile: {
        ...player,
        ...counts,
        mvp_badges: counts.mvps,
        gk_badges: counts.guantes_dorados,
        red_badges: counts.tarjetas_rojas,
      },
    };
  });

/**
 * The card profile at a moment of the ceremony: before the trophy lands, the awarded
 * counter shows the value it had before this award (only when that is known); after,
 * the real total. Other counters never move.
 */
export const cardProfileAt = (entry, landed) => {
  const profile = { ...(entry?.cardProfile || {}) };
  const meta = CEREMONY_AWARDS[entry?.type];
  if (entry?.penalty) {
    return profile;
  }
  if (!meta?.counterField || !entry?.counter) return profile;
  const value = landed ? entry.counter.total : entry.counter.before;
  const alias = { mvps: 'mvp_badges', guantes_dorados: 'gk_badges', tarjetas_rojas: 'red_badges' }[meta.counterField];
  return { ...profile, [meta.counterField]: value, [alias]: value };
};

// The ceremony opens by itself once per account and match; afterwards it is replayed
// from "Ver premiación". Per-device convenience (localStorage), never authoritative.
const SEEN_PREFIX = 'arma2:awards-ceremony-seen:v1';
export const ceremonySeenKey = (userId, matchId) => `${SEEN_PREFIX}:${userId || 'anon'}:${matchId}`;

export const hasSeenCeremony = (userId, matchId) => {
  if (typeof window === 'undefined' || !matchId) return false;
  try {
    return window.localStorage.getItem(ceremonySeenKey(userId, matchId)) === '1';
  } catch (_error) {
    return false;
  }
};

export const markCeremonySeen = (userId, matchId) => {
  if (typeof window === 'undefined' || !matchId) return;
  try {
    window.localStorage.setItem(ceremonySeenKey(userId, matchId), '1');
  } catch (_error) {
    // Storage unavailable: the ceremony may open again next time, nothing else.
  }
};
