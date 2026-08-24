import { TORNEOS_URL } from './socialProductConfig';

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

export const SOCIAL_SNAPSHOT_SCHEMA_VERSION = 2;
export const SOCIAL_SNAPSHOT_SUPPORTED_VERSIONS = Object.freeze([1, 2]);
export const SOCIAL_TEAM_SIZES = Object.freeze([5, 6, 7, 8, 9, 11]);
const SOCIAL_PLAYER_POSITIONS = Object.freeze(['ARQ', 'DEF', 'MED', 'DEL']);

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
    requiresRound: false,
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
    label: 'Equipo de la fecha',
    collection: 'candidates',
    requiresRound: false,
    requiresHumanSelection: true,
    defaults: { title: 'Equipo de la fecha', subtitle: 'Selección de la fecha' },
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
  if (!SOCIAL_SNAPSHOT_SUPPORTED_VERSIONS.includes(snapshot.schemaVersion)) {
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
  if (snapshot.schemaVersion === 2 && piece.id === 'best_eleven') {
    if (
      !SOCIAL_TEAM_SIZES.includes(official.teamSize)
      || official.sportModality !== `football_${official.teamSize}`
    ) {
      throw new SocialSnapshotError('SNAPSHOT_TEAM_FORMAT_INVALID', piece.id);
    }
    official.candidates.forEach((candidate) => {
      if (
        !isPlainObject(candidate)
        || !candidate.rosterPlayerId
        || !candidate.teamEntryId
        || typeof candidate.name !== 'string'
        || (candidate.position !== null
          && !SOCIAL_PLAYER_POSITIONS.includes(candidate.position))
        || typeof candidate.isGoalkeeper !== 'boolean'
        || !isPlainObject(candidate.team)
        || candidate.team.teamEntryId !== candidate.teamEntryId
      ) {
        throw new SocialSnapshotError('SNAPSHOT_CANDIDATE_INVALID', piece.id);
      }
    });
  }
  if (snapshot.schemaVersion === 2 && piece.id === 'mvp') {
    official.candidates.forEach((candidate) => {
      if (
        !isPlainObject(candidate)
        || !candidate.rosterPlayerId
        || !candidate.teamEntryId
        || typeof candidate.name !== 'string'
        || (candidate.position !== null
          && !SOCIAL_PLAYER_POSITIONS.includes(candidate.position))
        || typeof candidate.isGoalkeeper !== 'boolean'
        || !isPlainObject(candidate.team)
        || candidate.team.teamEntryId !== candidate.teamEntryId
      ) {
        throw new SocialSnapshotError('SNAPSHOT_CANDIDATE_INVALID', piece.id);
      }
    });
  }
  if (snapshot.schemaVersion === 2 && piece.id === 'next_fixture') {
    if (official.semantics !== 'next_scheduled_unplayed_round') {
      throw new SocialSnapshotError('SNAPSHOT_FIXTURE_SEMANTICS_INVALID', piece.id);
    }
    const generatedAt = new Date(snapshot.generatedAt).getTime();
    if (!Number.isFinite(generatedAt)) {
      throw new SocialSnapshotError('SNAPSHOT_MALFORMED', 'generatedAt');
    }
    const includesPastOrPlayed = official.matches.some((match) => {
      const scheduledAt = new Date(match?.scheduledAt).getTime();
      return !Number.isFinite(scheduledAt)
        || (Number.isFinite(generatedAt) && scheduledAt < generatedAt)
        || match.result;
    });
    if (includesPastOrPlayed) {
      throw new SocialSnapshotError('SNAPSHOT_FIXTURE_NOT_UPCOMING', piece.id);
    }
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
    cta: clampText(overrides.cta ?? TORNEOS_URL, SOCIAL_TEXT_LIMITS.cta),
    showArma2Logo: overrides.showArma2Logo !== false,
    photoAssetId: overrides.photoAssetId || null,
    photoOffsetY: Number.isFinite(overrides.photoOffsetY) ? overrides.photoOffsetY : 0.5,
    selection: Array.isArray(overrides.selection) ? overrides.selection : [],
  };
}

/** Historical V1 snapshots keep the old eleven-player rule. */
export function selectionSizeForSnapshot(snapshot) {
  const piece = findSocialPiece(snapshot?.piece);
  if (!piece?.requiresHumanSelection) return 0;
  if (piece.id === 'best_eleven') {
    return snapshot?.schemaVersion === 2 ? snapshot?.official?.teamSize : 11;
  }
  return piece.selectionSize || 1;
}

export function validateSocialSelection(snapshot, editorial) {
  const piece = findSocialPiece(snapshot?.piece);
  if (!piece?.requiresHumanSelection) return { valid: true, code: null };
  const selection = Array.isArray(editorial?.selection) ? editorial.selection : [];
  const needed = selectionSizeForSnapshot(snapshot);
  if (!Number.isInteger(needed) || needed < 1) {
    return { valid: false, code: 'SELECTION_SIZE_INVALID', needed, chosen: selection.length };
  }
  if (new Set(selection).size !== selection.length) {
    return { valid: false, code: 'SELECTION_DUPLICATED', needed, chosen: selection.length };
  }
  const candidateIds = new Set((snapshot?.official?.candidates || []).map(
    (candidate) => candidate.rosterPlayerId || candidate.participantId,
  ));
  if (selection.some((id) => !candidateIds.has(id))) {
    return { valid: false, code: 'SELECTION_CANDIDATE_INVALID', needed, chosen: selection.length };
  }
  if (selection.length !== needed) {
    return { valid: false, code: 'SELECTION_COUNT_INVALID', needed, chosen: selection.length };
  }
  return { valid: true, code: null, needed, chosen: selection.length };
}

/**
 * A piece is ready to export when its human curation is done. The studio never
 * fills these in automatically — that is the whole point of the requirement.
 */
export function describeCurationGap(snapshot, editorial) {
  const piece = findSocialPiece(snapshot?.piece);
  if (!piece?.requiresHumanSelection) return null;
  const validation = validateSocialSelection(snapshot, editorial);
  if (validation.valid) return null;
  const { needed, chosen } = validation;
  if (validation.code === 'SELECTION_CANDIDATE_INVALID') {
    return 'La selección contiene una opción que ya no pertenece a los candidatos oficiales.';
  }
  if (validation.code === 'SELECTION_DUPLICATED') {
    return 'La selección no puede repetir jugadores.';
  }
  if (piece.id === 'best_eleven') {
    return `Elegí exactamente ${needed} jugadores para el Equipo de la fecha (${chosen}/${needed}).`;
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
