//
// Validación recurso ↔ torneo para las URLs canónicas.
//
// Que una ruta traiga dos ids no es razón para confiar en los dos. En
//
//   /torneos/organizacion/:organizationId/torneo/:tournamentId/partidos/:matchId/acta
//
// el `:matchId` lo elige quien escribe la URL, así que antes de renderizar hay
// que poder afirmar que ese recurso es de ese torneo. Cuando no se puede
// afirmar, no se cae al default —eso mostraría otro recurso bajo una URL que
// dice una cosa distinta— sino que se cierra.
//
// Esto NO reemplaza la autorización: el servidor ya decide qué puede leer cada
// persona vía RLS y capabilities. Esto decide qué se puede *renderizar bajo
// esta URL*, que es una pregunta distinta y del cliente.
//

const TOURNAMENT_KEYS = ['tournamentId', 'tournament_id'];
const ORGANIZATION_KEYS = ['organizationId', 'organization_id'];
const CATEGORY_KEYS = ['categoryId', 'category_id'];

function readKey(resource, keys) {
  if (!resource || typeof resource !== 'object') return null;
  for (const key of keys) {
    const value = resource[key];
    if (typeof value === 'string' && value) return value;
  }
  return null;
}

export function readResourceTournamentId(resource) {
  return readKey(resource, TOURNAMENT_KEYS);
}

export function readResourceOrganizationId(resource) {
  return readKey(resource, ORGANIZATION_KEYS);
}

export function readResourceCategoryId(resource) {
  return readKey(resource, CATEGORY_KEYS);
}

/**
 * ¿Este recurso pertenece al torneo de la URL?
 *
 * Un recurso que no declara torneo devuelve `false` con `strict` (el default):
 * no poder comprobarlo no es lo mismo que haberlo comprobado. Los recursos que
 * legítimamente no llevan `tournament_id` —sedes, canchas— no pasan por acá:
 * son de la organización y viven fuera del nesting de torneo.
 */
export function resourceBelongsToTournament(resource, tournamentId, { strict = true } = {}) {
  if (!tournamentId) return false;
  const resourceTournamentId = readResourceTournamentId(resource);
  if (!resourceTournamentId) return !strict;
  return resourceTournamentId === tournamentId;
}

export function resourceBelongsToOrganization(resource, organizationId, { strict = true } = {}) {
  if (!organizationId) return false;
  const resourceOrganizationId = readResourceOrganizationId(resource);
  if (!resourceOrganizationId) return !strict;
  return resourceOrganizationId === organizationId;
}

/**
 * La comprobación completa de una ruta canónica: el recurso tiene que ser del
 * torneo Y de la organización que la URL nombra.
 */
export function resourceMatchesCanonicalScope(resource, { organizationId, tournamentId }) {
  return resourceBelongsToTournament(resource, tournamentId)
    && resourceBelongsToOrganization(resource, organizationId, { strict: false });
}

export const RESOURCE_SCOPE_MESSAGE = 'Ese recurso no pertenece al torneo de esta dirección.';

/**
 * Encuentra un recurso por id dentro de una colección YA acotada al torneo.
 *
 * Devuelve `{ found, resource, outOfScope }`. La diferencia entre "no lo pedí"
 * y "lo pedí y no es de acá" es la que decide si se muestra el default o se
 * cierra, y por eso se devuelve explícita en vez de colapsarla en un null.
 */
export function resolveScopedResource(collection, requestedId) {
  const items = Array.isArray(collection) ? collection : [];
  if (!requestedId) return { found: false, resource: null, outOfScope: false };
  const resource = items.find((item) => item?.id === requestedId) || null;
  return { found: Boolean(resource), resource, outOfScope: !resource };
}

//
// Contrato preparado para el barrido legacy → canónico del hito siguiente.
// Todavía no se usa para redirigir: sólo fija la forma de la decisión.
//
export const LEGACY_RESOLUTION = Object.freeze({
  RESOURCE: 'resource',
  SINGLE_TOURNAMENT: 'single-tournament',
  SELECTOR: 'selector',
});

/**
 * Cómo resolver una URL legacy que no nombra torneo.
 *
 * El orden importa y es deliberado: si el recurso de la URL dice a qué torneo
 * pertenece, esa es la respuesta correcta y no hay nada que preguntar. La
 * preferencia entra sólo como pista para preseleccionar en el selector, nunca
 * como respuesta: es exactamente el caso en el que estaría adivinando.
 */
export function planLegacyResolution({
  resource = null,
  tournaments = [],
  preferredTournamentId = null,
} = {}) {
  const fromResource = readResourceTournamentId(resource);
  if (fromResource) {
    return { kind: LEGACY_RESOLUTION.RESOURCE, tournamentId: fromResource, hint: null };
  }
  const available = Array.isArray(tournaments) ? tournaments : [];
  if (available.length === 1) {
    return {
      kind: LEGACY_RESOLUTION.SINGLE_TOURNAMENT,
      tournamentId: available[0].id,
      hint: null,
    };
  }
  const hint = available.some((tournament) => tournament?.id === preferredTournamentId)
    ? preferredTournamentId
    : null;
  return { kind: LEGACY_RESOLUTION.SELECTOR, tournamentId: null, hint };
}
