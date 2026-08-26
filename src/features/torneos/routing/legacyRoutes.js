//
// Las direcciones anteriores al modelo canónico.
//
// Siguen montadas: nadie pierde un link, un favorito ni un mensaje viejo. Lo
// que cambió es que ya no renderizan contenido propio —resuelven al equivalente
// canónico— porque lo que mostraban dependía de `activeTournamentId`, una
// preferencia que la dirección no nombra.
//
// Están acá y no en `canonicalRoutes` a propósito: mezclarlas volvería difusa
// la pregunta "¿cuál es la forma correcta de escribir esta ruta?", que es
// justamente lo que esa capa existe para responder. Importar de este módulo es
// la señal explícita de que se está tocando compatibilidad.
//

import { canonicalRoutes, organizationRoot } from './canonicalRoutes';

const surface = (suffix) => (organizationId) => `${organizationRoot(organizationId)}${suffix}`;
const resourceSurface = (prefix, suffix = '') => (organizationId, resourceId) => (
  `${organizationRoot(organizationId)}${prefix}/${resourceId}${suffix}`
);

// Superficies que eran del torneo pero se escribían sin nombrarlo.
export const legacyOrganizationTeams = surface('/equipos');
export const legacyOrganizationTeamNew = surface('/equipos/nuevo');
export const legacyOrganizationFixture = surface('/fixture');
export const legacyOrganizationSchedule = surface('/programacion');
export const legacyOrganizationMatches = surface('/partidos');
export const legacyOrganizationCompetition = surface('/competencia');

// El torneo sí estaba nombrado acá, sólo que bajo el plural de la colección.
// Por eso ésta resuelve sin preguntar nada.
export const legacyTournamentConfiguration = (organizationId, tournamentId) => (
  `${organizationRoot(organizationId)}/torneos/${tournamentId}/configuracion`
);

//
// La equivalencia, indexada por el nombre del builder canónico.
//
// Una sola tabla en vez de un `if` por call site: cuando una superficie no
// tiene torneo en la URL, todos los lugares que la enlazan tienen que caer en
// la MISMA dirección vieja, o la resolución que hace `LegacyTournamentRoute`
// pasa a depender de por dónde se entró.
//
const LEGACY_EQUIVALENT = Object.freeze({
  tournamentRoot: legacyOrganizationFixture,
  tournamentConfiguration: (organizationId) => canonicalRoutes.organizationTournaments(organizationId),
  tournamentTeams: legacyOrganizationTeams,
  tournamentTeamNew: legacyOrganizationTeamNew,
  tournamentFixture: legacyOrganizationFixture,
  tournamentFixtureParticipants: surface('/fixture/participantes'),
  tournamentFixturePots: surface('/fixture/bombos'),
  tournamentFixtureDraw: surface('/fixture/sorteo'),
  tournamentFixtureGroups: surface('/fixture/grupos'),
  tournamentFixtureGenerate: surface('/fixture/generar'),
  tournamentFixtureRounds: surface('/fixture/jornadas'),
  tournamentFixtureBracket: surface('/fixture/llave'),
  tournamentFixtureRound: resourceSurface('/fixture/jornadas'),
  tournamentFixtureVersion: resourceSurface('/fixture/version'),
  tournamentFixtureMatch: resourceSurface('/fixture/partidos'),
  tournamentSchedule: legacyOrganizationSchedule,
  tournamentMatches: legacyOrganizationMatches,
  tournamentMatch: resourceSurface('/partidos'),
  tournamentMatchSquads: resourceSurface('/partidos', '/convocatorias'),
  tournamentMatchReport: resourceSurface('/partidos', '/acta'),
  tournamentMatchReview: resourceSurface('/partidos', '/revision'),
  tournamentMatchHistory: resourceSurface('/partidos', '/historial'),
  tournamentTable: surface('/competencia/tabla'),
  tournamentStatistics: surface('/competencia/estadisticas'),
  tournamentQualification: surface('/competencia/clasificacion'),
  tournamentDiscipline: surface('/competencia/disciplina'),
});

/**
 * La dirección de una superficie del torneo, elegida por la URL.
 *
 * Con torneo, la canónica y con su `?categoria=`. Sin torneo, la vieja, que
 * resuelve sola cuando hay un solo torneo y pregunta cuando hay varios. Es un
 * único punto de decisión a propósito: dejarla en cada componente es cómo se
 * cuelan las direcciones que pierden el torneo.
 */
export function tournamentSurface(builderName, organizationId, tournamentId, options = {}) {
  if (tournamentId) {
    return canonicalRoutes[builderName](organizationId, tournamentId, options);
  }
  const legacy = LEGACY_EQUIVALENT[builderName];
  return legacy
    ? legacy(organizationId)
    : canonicalRoutes.organizationTournaments(organizationId);
}

/**
 * Igual que `tournamentSurface`, para las superficies que además nombran un
 * recurso —un partido, una jornada, una versión—.
 */
export function tournamentResourceSurface(
  builderName,
  organizationId,
  tournamentId,
  resourceId,
  options = {},
) {
  if (tournamentId) {
    return canonicalRoutes[builderName](organizationId, tournamentId, resourceId, options);
  }
  const legacy = LEGACY_EQUIVALENT[builderName];
  return legacy
    ? legacy(organizationId, resourceId)
    : canonicalRoutes.organizationTournaments(organizationId);
}

export const legacyRoutes = Object.freeze({
  legacyOrganizationTeams,
  legacyOrganizationTeamNew,
  legacyOrganizationFixture,
  legacyOrganizationSchedule,
  legacyOrganizationMatches,
  legacyOrganizationCompetition,
  legacyTournamentConfiguration,
  tournamentSurface,
  tournamentResourceSurface,
});
