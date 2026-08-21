//
// Capa única de construcción de rutas canónicas de Torneos.
//
// El contrato aprobado en el CHECKPOINT 4 es:
//
//   /torneos/organizacion/:organizationId/torneo/:tournamentId/...
//   ?categoria=:categoryId
//
// La razón de que esto sea una capa y no una plantilla copiada es que la URL
// es la fuente de verdad del torneo: cada string suelto es una oportunidad de
// perder el `:tournamentId` o de tirar `?categoria=` sin que nadie lo note.
// Por eso los builders son la única forma soportada de escribir estas rutas, y
// por eso validan: un id vacío o no-string no produce una ruta rota, tira.
//
// Los recursos que pertenecen a la organización y no al torneo —sedes,
// canchas, equipos, miembros— viven fuera de `torneo/:tournamentId`. Eso no es
// una omisión: `tournament_venues` y `tournament_courts` no tienen
// `tournament_id`, así que meterlas bajo el torneo inventaría una pertenencia
// que el modelo no tiene.
//

export const TORNEOS_ROOT = '/torneos';
export const CATEGORY_QUERY_PARAM = 'categoria';
export const STEP_QUERY_PARAM = 'step';

// Patrón para `useMatch`: identifica que una ubicación está bajo una ruta
// canónica de torneo, y expone los dos ids sin que el padre tenga que parsear
// el pathname a mano.
export const CANONICAL_TOURNAMENT_ROUTE_PATTERN = '/torneos/organizacion/:organizationId/torneo/:tournamentId/*';

const UUID_LIKE = /^[a-z0-9][a-z0-9-]*$/i;

function requireId(value, label) {
  const candidate = typeof value === 'string' ? value.trim() : '';
  if (!candidate) {
    throw new Error(`canonicalRoutes: falta ${label}.`);
  }
  // Un id sólo puede ser un segmento. Cualquier `/`, `?`, `#` o `..` cambiaría
  // la ruta a la que estamos apuntando, así que se rechaza antes de componer.
  if (!UUID_LIKE.test(candidate)) {
    throw new Error(`canonicalRoutes: ${label} inválido.`);
  }
  return encodeURIComponent(candidate);
}

/**
 * Devuelve el `?categoria=` normalizado, o '' cuando no corresponde.
 * Un id inválido no se cuela en la URL: se descarta.
 */
export function categoryQuery(categoryId) {
  const candidate = typeof categoryId === 'string' ? categoryId.trim() : '';
  if (!candidate || !UUID_LIKE.test(candidate)) return '';
  return `?${CATEGORY_QUERY_PARAM}=${encodeURIComponent(candidate)}`;
}

/**
 * Lee `?categoria=` de un search string o de un URLSearchParams.
 * Devuelve null cuando no está presente o no es un id válido.
 */
export function readCategoryId(search) {
  if (!search) return null;
  let params;
  if (typeof search === 'string') {
    params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  } else if (typeof search.get === 'function') {
    params = search;
  } else {
    return null;
  }
  const raw = params.get(CATEGORY_QUERY_PARAM);
  const candidate = typeof raw === 'string' ? raw.trim() : '';
  if (!candidate || !UUID_LIKE.test(candidate)) return null;
  return candidate;
}

function organizationBase(organizationId) {
  return `${TORNEOS_ROOT}/organizacion/${requireId(organizationId, 'organizationId')}`;
}

function tournamentBase(organizationId, tournamentId) {
  return `${organizationBase(organizationId)}/torneo/${requireId(tournamentId, 'tournamentId')}`;
}

/**
 * La query de una ruta canónica es una allowlist, no un passthrough.
 *
 * `categoria` es contexto reproducible del torneo; `step` es la posición dentro
 * del asistente de configuración. Cualquier otra clave se descarta acá y no en
 * cada llamada, que es la única forma de que un `?token=` no termine en un link
 * por descuido. El orden es fijo para que dos builds de la misma ubicación
 * produzcan exactamente el mismo string.
 */
function routeQuery(options = {}) {
  const parts = [];
  const categoryId = typeof options.categoryId === 'string' ? options.categoryId.trim() : '';
  if (categoryId && UUID_LIKE.test(categoryId)) {
    parts.push(`${CATEGORY_QUERY_PARAM}=${encodeURIComponent(categoryId)}`);
  }
  // `null`, `undefined` y `''` no son el paso 0: sin paso pedido no hay clave.
  const rawStep = options.step;
  if (rawStep !== null && rawStep !== undefined && rawStep !== '') {
    const step = Number(rawStep);
    if (Number.isInteger(step) && step >= 0 && step <= 99) {
      parts.push(`${STEP_QUERY_PARAM}=${step}`);
    }
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

/**
 * Todos los builders de torneo comparten la misma firma:
 *
 *   builder(organizationId, tournamentId, { categoryId, step } = {})
 *
 * de modo que conservar la categoría nunca dependa de recordar concatenar.
 */
function tournamentRoute(suffix) {
  return (organizationId, tournamentId, options = {}) => (
    `${tournamentBase(organizationId, tournamentId)}${suffix}${routeQuery(options)}`
  );
}

function tournamentResourceRoute(prefix, suffix = '', label = 'resourceId') {
  return (organizationId, tournamentId, resourceId, options = {}) => (
    `${tournamentBase(organizationId, tournamentId)}${prefix}/${requireId(resourceId, label)}${suffix}`
    + `${routeQuery(options)}`
  );
}

function organizationRoute(suffix) {
  return (organizationId, options = {}) => (
    `${organizationBase(organizationId)}${suffix}${routeQuery(options)}`
  );
}

// ── Organización ────────────────────────────────────────────────────────────
// Superficies que no migran a `torneo/:tournamentId` porque el recurso
// pertenece a la organización.

export const organizationRoot = (organizationId) => organizationBase(organizationId);
export const organizationHome = organizationRoute('/inicio');
export const organizationTournaments = organizationRoute('/torneos');
export const organizationTournamentNew = organizationRoute('/torneos/nuevo');
export const organizationSeasons = organizationRoute('/temporadas');
export const organizationSeasonNew = organizationRoute('/temporadas/nueva');
export const organizationSeason = (organizationId, seasonId) => (
  `${organizationBase(organizationId)}/temporadas/${requireId(seasonId, 'seasonId')}`
);
export const organizationMembers = organizationRoute('/miembros');
export const organizationSettings = organizationRoute('/configuracion');
export const organizationSettingsPlan = organizationRoute('/configuracion/plan');
export const organizationCommunications = organizationRoute('/comunicaciones');
export const organizationMedia = organizationRoute('/multimedia');
export const organizationSocialStudio = organizationRoute('/estudio-social');

// El listado de equipos es del torneo —`loadTeamsContext` pide `tournamentId`—
// así que su ruta canónica vive bajo el torneo. Lo que queda organization-scoped
// es la inscripción ya creada, más abajo, y por una razón distinta.
export const organizationTeams = organizationRoute('/equipos');

// Sedes y canchas: organization-scoped por modelo, no por conveniencia.
export const organizationVenues = (organizationId) => `${organizationBase(organizationId)}/sedes`;
export const organizationVenue = (organizationId, venueId) => (
  `${organizationBase(organizationId)}/sedes/${requireId(venueId, 'venueId')}`
);

// Team entries: quedan fuera del nesting de torneo para preservar el acceso
// relacional de capitán/delegado, que no pasa por el guard de torneo.
export const organizationTeamEntry = (organizationId, teamEntryId) => (
  `${organizationBase(organizationId)}/equipos/${requireId(teamEntryId, 'teamEntryId')}`
);
export const organizationTeamEntryRegistration = (organizationId, teamEntryId) => (
  `${organizationTeamEntry(organizationId, teamEntryId)}/inscripcion`
);
export const organizationTeamEntryVisualIdentity = (organizationId, teamEntryId) => (
  `${organizationTeamEntry(organizationId, teamEntryId)}/identidad-visual`
);
export const organizationTeamEntryRoster = (organizationId, teamEntryId) => (
  `${organizationTeamEntry(organizationId, teamEntryId)}/plantel`
);
export const organizationTeamEntryReview = (organizationId, teamEntryId) => (
  `${organizationTeamEntry(organizationId, teamEntryId)}/revision`
);

// ── Torneo ──────────────────────────────────────────────────────────────────

export const tournamentRoot = tournamentRoute('');
export const tournamentTeams = tournamentRoute('/equipos');
export const tournamentTeamNew = tournamentRoute('/equipos/nuevo');
export const tournamentConfiguration = tournamentRoute('/configuracion');

export const tournamentFixture = tournamentRoute('/fixture');
export const tournamentFixtureParticipants = tournamentRoute('/fixture/participantes');
export const tournamentFixturePots = tournamentRoute('/fixture/bombos');
export const tournamentFixtureDraw = tournamentRoute('/fixture/sorteo');
export const tournamentFixtureGroups = tournamentRoute('/fixture/grupos');
export const tournamentFixtureGenerate = tournamentRoute('/fixture/generar');
export const tournamentFixtureRounds = tournamentRoute('/fixture/jornadas');
export const tournamentFixtureBracket = tournamentRoute('/fixture/llave');
export const tournamentFixtureRound = tournamentResourceRoute('/fixture/jornadas', '', 'roundId');
export const tournamentFixtureVersion = tournamentResourceRoute('/fixture/version', '', 'fixtureVersionId');
// El partido resaltado dentro de las jornadas: es la vista del fixture, no la
// operación del partido, y por eso no colapsa contra `tournamentMatch`.
export const tournamentFixtureMatch = tournamentResourceRoute('/fixture/partidos', '', 'matchId');

export const tournamentSchedule = tournamentRoute('/programacion');

export const tournamentMatches = tournamentRoute('/partidos');
export const tournamentMatch = tournamentResourceRoute('/partidos', '', 'matchId');
export const tournamentMatchSquads = tournamentResourceRoute('/partidos', '/convocatorias', 'matchId');
export const tournamentMatchReport = tournamentResourceRoute('/partidos', '/acta', 'matchId');
export const tournamentMatchReview = tournamentResourceRoute('/partidos', '/revision', 'matchId');
export const tournamentMatchHistory = tournamentResourceRoute('/partidos', '/historial', 'matchId');

export const tournamentTable = tournamentRoute('/competencia/tabla');
export const tournamentStatistics = tournamentRoute('/competencia/estadisticas');
export const tournamentQualification = tournamentRoute('/competencia/clasificacion');
export const tournamentDiscipline = tournamentRoute('/competencia/disciplina');

//
// Qué superficie del torneo es una ruta relativa.
//
// Se usa para cambiar de torneo sin cambiar de sección: quien está mirando la
// tabla de un torneo y elige otro espera la tabla del otro. Lo que NO se
// conserva es el recurso —un `:matchId` o un `:roundId` pertenecen al torneo
// que se está dejando— ni `?categoria=`, por la misma razón.
//
export function tournamentSectionRoute(relativePath = '') {
  const clean = String(relativePath || '').replace(/^\/+/, '');
  if (clean.startsWith('equipos')) return tournamentTeams;
  if (clean.startsWith('fixture')) return tournamentFixture;
  if (clean.startsWith('programacion')) return tournamentSchedule;
  if (clean.startsWith('partidos')) return tournamentMatches;
  if (clean.startsWith('competencia/estadisticas')) return tournamentStatistics;
  if (clean.startsWith('competencia/clasificacion')) return tournamentQualification;
  if (clean.startsWith('competencia/disciplina')) return tournamentDiscipline;
  if (clean.startsWith('competencia')) return tournamentTable;
  if (clean.startsWith('configuracion')) return tournamentConfiguration;
  return tournamentRoot;
}

export const canonicalRoutes = Object.freeze({
  organizationRoot,
  organizationHome,
  organizationTournaments,
  organizationTournamentNew,
  organizationSeasons,
  organizationSeasonNew,
  organizationSeason,
  organizationTeams,
  organizationMembers,
  organizationSettings,
  organizationSettingsPlan,
  organizationCommunications,
  organizationMedia,
  organizationSocialStudio,
  organizationVenues,
  organizationVenue,
  organizationTeamEntry,
  organizationTeamEntryRegistration,
  organizationTeamEntryVisualIdentity,
  organizationTeamEntryRoster,
  organizationTeamEntryReview,
  tournamentRoot,
  tournamentTeams,
  tournamentTeamNew,
  tournamentConfiguration,
  tournamentFixture,
  tournamentFixtureParticipants,
  tournamentFixturePots,
  tournamentFixtureDraw,
  tournamentFixtureGroups,
  tournamentFixtureGenerate,
  tournamentFixtureRounds,
  tournamentFixtureBracket,
  tournamentFixtureRound,
  tournamentFixtureVersion,
  tournamentFixtureMatch,
  tournamentSchedule,
  tournamentMatches,
  tournamentMatch,
  tournamentMatchSquads,
  tournamentMatchReport,
  tournamentMatchReview,
  tournamentMatchHistory,
  tournamentTable,
  tournamentStatistics,
  tournamentQualification,
  tournamentDiscipline,
  tournamentSectionRoute,
});
