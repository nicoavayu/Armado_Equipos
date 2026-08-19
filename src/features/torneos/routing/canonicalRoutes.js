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
 * Todos los builders de torneo comparten la misma firma:
 *
 *   builder(organizationId, tournamentId, { categoryId } = {})
 *
 * de modo que conservar la categoría nunca dependa de recordar concatenar.
 */
function tournamentRoute(suffix) {
  return (organizationId, tournamentId, options = {}) => (
    `${tournamentBase(organizationId, tournamentId)}${suffix}${categoryQuery(options.categoryId)}`
  );
}

function tournamentResourceRoute(prefix, suffix = '', label = 'resourceId') {
  return (organizationId, tournamentId, resourceId, options = {}) => (
    `${tournamentBase(organizationId, tournamentId)}${prefix}/${requireId(resourceId, label)}${suffix}`
    + `${categoryQuery(options.categoryId)}`
  );
}

// ── Organización ────────────────────────────────────────────────────────────
// Superficies que no migran a `torneo/:tournamentId` porque el recurso
// pertenece a la organización.

export const organizationRoot = (organizationId) => organizationBase(organizationId);
export const organizationHome = (organizationId) => `${organizationBase(organizationId)}/inicio`;
export const organizationTournaments = (organizationId) => `${organizationBase(organizationId)}/torneos`;
export const organizationSeasons = (organizationId) => `${organizationBase(organizationId)}/temporadas`;
export const organizationTeams = (organizationId) => `${organizationBase(organizationId)}/equipos`;
export const organizationMembers = (organizationId) => `${organizationBase(organizationId)}/miembros`;
export const organizationSettings = (organizationId) => `${organizationBase(organizationId)}/configuracion`;
export const organizationCommunications = (organizationId) => `${organizationBase(organizationId)}/comunicaciones`;
export const organizationMedia = (organizationId) => `${organizationBase(organizationId)}/multimedia`;
export const organizationSocialStudio = (organizationId) => `${organizationBase(organizationId)}/estudio-social`;

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
export const organizationTeamEntryRoster = (organizationId, teamEntryId) => (
  `${organizationTeamEntry(organizationId, teamEntryId)}/plantel`
);
export const organizationTeamEntryReview = (organizationId, teamEntryId) => (
  `${organizationTeamEntry(organizationId, teamEntryId)}/revision`
);

// ── Torneo ──────────────────────────────────────────────────────────────────

export const tournamentRoot = tournamentRoute('');
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

export const canonicalRoutes = Object.freeze({
  organizationRoot,
  organizationHome,
  organizationTournaments,
  organizationSeasons,
  organizationTeams,
  organizationMembers,
  organizationSettings,
  organizationCommunications,
  organizationMedia,
  organizationSocialStudio,
  organizationVenues,
  organizationVenue,
  organizationTeamEntry,
  organizationTeamEntryRegistration,
  organizationTeamEntryRoster,
  organizationTeamEntryReview,
  tournamentRoot,
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
});
