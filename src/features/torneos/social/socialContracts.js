/**
 * Typed snapshot contracts for the Estudio Social.
 *
 * A snapshot is the ONLY thing a template is allowed to draw. It is versioned,
 * validated on arrival, and it separates two kinds of data that must never be
 * confused:
 *
 *   - `official`: comes from the published projections, is never edited, and
 *     carries the revision it was built from so a piece can be traced back;
 *   - `editorial`: the human's title, subtitle, note and manual selections.
 *
 * Validation is hand-rolled rather than pulled from a schema library. The
 * shapes are small and fixed, and a rejected snapshot must fail loudly with a
 * reason rather than render half a graphic.
 */

export const SOCIAL_SNAPSHOT_SCHEMA_VERSION = 1;

export const SOCIAL_FORMATS = Object.freeze({
  portrait: Object.freeze({
    id: 'portrait', label: 'Feed 4:5', width: 1080, height: 1350,
  }),
  story: Object.freeze({
    id: 'story', label: 'Historia 9:16', width: 1080, height: 1920,
  }),
});

export const SOCIAL_FORMAT_IDS = Object.freeze(Object.keys(SOCIAL_FORMATS));

/**
 * The piece registry. Adding a format later means adding an entry to
 * `SOCIAL_FORMATS` and a layout band to the renderer — not duplicating eleven
 * templates.
 */
export const SOCIAL_PIECES = Object.freeze([
  {
    id: 'next_fixture',
    label: 'Próxima fecha',
    collection: 'matches',
    requiresRound: true,
    requiresHumanSelection: false,
    defaults: { title: 'Próxima fecha', subtitle: '' },
  },
  {
    id: 'round_results',
    label: 'Resultados de la fecha',
    collection: 'matches',
    requiresRound: true,
    requiresHumanSelection: false,
    defaults: { title: 'Resultados', subtitle: '' },
  },
  {
    id: 'standings',
    label: 'Tabla de posiciones',
    collection: 'rows',
    requiresRound: false,
    requiresHumanSelection: false,
    defaults: { title: 'Tabla de posiciones', subtitle: '' },
  },
  {
    id: 'scorers',
    label: 'Goleadores',
    collection: 'players',
    requiresRound: false,
    requiresHumanSelection: false,
    defaults: { title: 'Goleadores', subtitle: '' },
  },
  {
    id: 'discipline',
    label: 'Sancionados',
    collection: 'players',
    requiresRound: false,
    requiresHumanSelection: false,
    defaults: { title: 'Disciplina', subtitle: '' },
  },
  {
    id: 'best_eleven',
    label: 'Equipo ideal',
    collection: 'candidates',
    requiresRound: false,
    requiresHumanSelection: true,
    selectionSize: 11,
    defaults: { title: 'Equipo ideal', subtitle: 'Selección de la fecha' },
  },
  {
    id: 'mvp',
    label: 'Figura',
    collection: 'candidates',
    requiresRound: false,
    requiresHumanSelection: true,
    selectionSize: 1,
    defaults: { title: 'Figura de la fecha', subtitle: '' },
  },
  {
    id: 'round_summary',
    label: 'Resumen de fecha',
    collection: 'matches',
    requiresRound: true,
    requiresHumanSelection: false,
    defaults: { title: 'Resumen de la fecha', subtitle: '' },
  },
  {
    id: 'semifinals',
    label: 'Semifinales',
    collection: 'matches',
    requiresRound: true,
    requiresHumanSelection: false,
    defaults: { title: 'Semifinales', subtitle: '' },
  },
  {
    id: 'final',
    label: 'Final',
    collection: 'matches',
    requiresRound: true,
    requiresHumanSelection: false,
    defaults: { title: 'La final', subtitle: '' },
  },
  {
    id: 'champion',
    label: 'Campeón',
    collection: 'candidates',
    requiresRound: false,
    requiresHumanSelection: true,
    selectionSize: 1,
    defaults: { title: 'Campeón', subtitle: '' },
  },
]);

export const SOCIAL_PIECE_IDS = Object.freeze(SOCIAL_PIECES.map((piece) => piece.id));

export function findSocialPiece(pieceId) {
  return SOCIAL_PIECES.find((piece) => piece.id === pieceId) || null;
}

export const SOCIAL_ACCENTS = Object.freeze([
  { id: 'violeta', label: 'Violeta', value: '#9D7BFF' },
  { id: 'electrico', label: 'Azul eléctrico', value: '#3B82F6' },
  { id: 'cyan', label: 'Cyan', value: '#63EED0' },
  { id: 'ambar', label: 'Ámbar', value: '#FDB022' },
]);

export const SOCIAL_TEXT_LIMITS = Object.freeze({
  title: 48,
  subtitle: 64,
  note: 180,
  cta: 40,
});

export class SocialSnapshotError extends Error {
  constructor(code, detail = '') {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'SocialSnapshotError';
    this.code = code;
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Validates a snapshot as it arrives from the backend.
 *
 * Anything unexpected is a hard failure: an unknown schema version, a piece
 * that is not in the registry, a scope whose tenant does not match the one the
 * studio is open on, or official data that is not the shape the template
 * expects. A template must never have to defend itself against malformed data.
 */
export function validateSocialSnapshot(snapshot, { organizationId } = {}) {
  if (!isPlainObject(snapshot)) {
    throw new SocialSnapshotError('SNAPSHOT_MALFORMED', 'not an object');
  }
  if (snapshot.schemaVersion !== SOCIAL_SNAPSHOT_SCHEMA_VERSION) {
    throw new SocialSnapshotError(
      'SNAPSHOT_VERSION_UNSUPPORTED', String(snapshot.schemaVersion),
    );
  }
  const piece = findSocialPiece(snapshot.piece);
  if (!piece) {
    throw new SocialSnapshotError('SNAPSHOT_PIECE_UNKNOWN', String(snapshot.piece));
  }
  if (!isPlainObject(snapshot.source) || !isPlainObject(snapshot.competition)) {
    throw new SocialSnapshotError('SNAPSHOT_MALFORMED', 'missing source or competition');
  }
  // Cross-tenant mixing is a correctness bug the moment it happens, not later.
  if (organizationId && snapshot.source.organizationId !== organizationId) {
    throw new SocialSnapshotError(
      'SNAPSHOT_TENANT_MISMATCH',
      `${snapshot.source.organizationId} vs ${organizationId}`,
    );
  }
  if (!snapshot.source.fixtureVersionId) {
    throw new SocialSnapshotError('SNAPSHOT_UNPUBLISHED', 'no published fixture version');
  }
  const official = snapshot.official;
  if (!isPlainObject(official)) {
    throw new SocialSnapshotError('SNAPSHOT_MALFORMED', 'missing official payload');
  }
  const collection = official[piece.collection];
  if (!Array.isArray(collection)) {
    throw new SocialSnapshotError(
      'SNAPSHOT_MALFORMED', `official.${piece.collection} is not a list`,
    );
  }
  if (piece.requiresHumanSelection && official.requiresHumanSelection !== true) {
    throw new SocialSnapshotError(
      'SNAPSHOT_CURATION_CONTRACT_BROKEN', piece.id,
    );
  }
  return snapshot;
}

/** Keys the studio must never receive, let alone draw. */
const FORBIDDEN_KEYS = [
  'auditLog', 'notes', 'internalNotes', 'availability', 'rivalAvailability',
  'draft', 'unpublished', 'moderation', 'reporterId', 'internalPath', 'bucket',
  'checksum', 'token',
];

/**
 * Second line of defence. The backend already refuses to project any of this,
 * but a template is a rendering surface and a leak into a PNG is permanent.
 */
export function assertNoPrivateData(snapshot) {
  const seen = new Set();
  const walk = (value, path) => {
    if (!value || typeof value !== 'object') return;
    if (seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach((entry, index) => walk(entry, `${path}[${index}]`));
      return;
    }
    for (const [key, entry] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.includes(key)) {
        throw new SocialSnapshotError('SNAPSHOT_PRIVATE_DATA', `${path}.${key}`);
      }
      walk(entry, `${path}.${key}`);
    }
  };
  walk(snapshot, 'snapshot');
  return snapshot;
}

function clampText(value, limit) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

/**
 * The editable layer. Deliberately small: this is a template studio, not a
 * free-form canvas. Everything a user can change is in here, and nothing here
 * can alter the official data.
 */
export function createEditorialState(snapshot, overrides = {}) {
  const piece = findSocialPiece(snapshot?.piece);
  const defaults = piece?.defaults || { title: '', subtitle: '' };
  return {
    format: SOCIAL_FORMAT_IDS.includes(overrides.format) ? overrides.format : 'portrait',
    accent: SOCIAL_ACCENTS.some((entry) => entry.id === overrides.accent)
      ? overrides.accent : 'violeta',
    title: clampText(overrides.title ?? defaults.title, SOCIAL_TEXT_LIMITS.title),
    subtitle: clampText(
      overrides.subtitle ?? snapshot?.competition?.roundName ?? defaults.subtitle,
      SOCIAL_TEXT_LIMITS.subtitle,
    ),
    note: clampText(overrides.note ?? '', SOCIAL_TEXT_LIMITS.note),
    cta: clampText(overrides.cta ?? 'arma2.com.ar', SOCIAL_TEXT_LIMITS.cta),
    showArma2Logo: overrides.showArma2Logo !== false,
    photoAssetId: overrides.photoAssetId || null,
    photoOffsetY: Number.isFinite(overrides.photoOffsetY) ? overrides.photoOffsetY : 0.5,
    selection: Array.isArray(overrides.selection) ? overrides.selection : [],
  };
}

/**
 * A piece is ready to export when its human curation is done. The studio never
 * fills these in automatically — that is the whole point of the requirement.
 */
export function describeCurationGap(snapshot, editorial) {
  const piece = findSocialPiece(snapshot?.piece);
  if (!piece?.requiresHumanSelection) return null;
  const needed = piece.selectionSize || 1;
  const chosen = (editorial?.selection || []).filter(Boolean).length;
  if (chosen >= needed) return null;
  if (piece.id === 'best_eleven') {
    return `Elegí ${needed} jugadores para el equipo ideal (${chosen}/${needed}).`;
  }
  if (piece.id === 'mvp') return 'Elegí a la figura de la fecha.';
  if (piece.id === 'champion') {
    return snapshot?.official?.officialChampion
      ? 'Confirmá el campeón para generar la placa.'
      : 'Todavía no hay un campeón oficial. Confirmá manualmente quién es.';
  }
  return 'Falta una selección manual.';
}

/** `Copa Horizonte · Fecha 6 · tabla` → `copa-horizonte-fecha-6-tabla.png` */
export function socialFileName(snapshot, editorial) {
  const parts = [
    snapshot?.competition?.tournamentName,
    snapshot?.competition?.categoryName,
    snapshot?.competition?.roundName,
    findSocialPiece(snapshot?.piece)?.label,
    editorial?.format,
  ];
  const slug = parts
    .filter(Boolean)
    .join(' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
  return `${slug || 'arma2-torneos'}.png`;
}
