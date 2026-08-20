import { canonicalRoutes } from '../canonicalRoutes';
import {
  legacyOrganizationFixture,
  legacyOrganizationMatches,
  legacyOrganizationTeams,
  legacyTournamentConfiguration,
  tournamentResourceSurface,
  tournamentSurface,
} from '../legacyRoutes';

const ORG = '61000000-0000-4000-8000-000000000001';
const TOURNAMENT = '63000000-0000-4000-8000-000000000001';
const CATEGORY = '64000000-0000-4000-8000-000000000001';
const MATCH = '65000000-0000-4000-8000-000000000001';

describe('compatibilidad de rutas viejas', () => {
  test('las direcciones viejas siguen existiendo con su forma exacta', () => {
    expect(legacyOrganizationFixture(ORG)).toBe(`/torneos/organizacion/${ORG}/fixture`);
    expect(legacyOrganizationMatches(ORG)).toBe(`/torneos/organizacion/${ORG}/partidos`);
    expect(legacyOrganizationTeams(ORG)).toBe(`/torneos/organizacion/${ORG}/equipos`);
    expect(legacyTournamentConfiguration(ORG, TOURNAMENT))
      .toBe(`/torneos/organizacion/${ORG}/torneos/${TOURNAMENT}/configuracion`);
  });

  test('con torneo en la URL la superficie es la canónica, con su categoría', () => {
    expect(tournamentSurface('tournamentFixture', ORG, TOURNAMENT, { categoryId: CATEGORY }))
      .toBe(canonicalRoutes.tournamentFixture(ORG, TOURNAMENT, { categoryId: CATEGORY }));
    expect(tournamentResourceSurface('tournamentMatchReport', ORG, TOURNAMENT, MATCH, {
      categoryId: CATEGORY,
    })).toBe(canonicalRoutes.tournamentMatchReport(ORG, TOURNAMENT, MATCH, {
      categoryId: CATEGORY,
    }));
  });

  test('sin torneo cae en la dirección vieja de esa misma superficie', () => {
    // El punto es que NO colapsen todas en `/fixture`: la resolución posterior
    // tiene que devolver a la persona a la sección de la que salió.
    expect(tournamentSurface('tournamentSchedule', ORG, null))
      .toBe(`/torneos/organizacion/${ORG}/programacion`);
    expect(tournamentSurface('tournamentFixtureParticipants', ORG, null))
      .toBe(`/torneos/organizacion/${ORG}/fixture/participantes`);
    expect(tournamentSurface('tournamentDiscipline', ORG, null))
      .toBe(`/torneos/organizacion/${ORG}/competencia/disciplina`);
    expect(tournamentResourceSurface('tournamentMatchReport', ORG, null, MATCH))
      .toBe(`/torneos/organizacion/${ORG}/partidos/${MATCH}/acta`);
  });

  test('toda superficie del torneo tiene equivalencia vieja', () => {
    const tournamentBuilders = Object.keys(canonicalRoutes)
      .filter((name) => name.startsWith('tournament') && name !== 'tournamentSectionRoute');
    tournamentBuilders.forEach((name) => {
      const legacy = tournamentSurface(name, ORG, null);
      expect(legacy.startsWith(`/torneos/organizacion/${ORG}/`)).toBe(true);
      // Sin torneo, la dirección de compatibilidad nunca puede fingir uno.
      expect(legacy).not.toContain('/torneo/');
    });
  });
});
