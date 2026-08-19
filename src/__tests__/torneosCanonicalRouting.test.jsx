import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import TorneosFeatureGate from '../features/torneos/TorneosFeatureGate';
import { getCapabilitiesForRole } from '../features/torneos/domain/capabilities';
import {
  organizationTournaments,
  tournamentDiscipline,
  tournamentFixture,
  tournamentMatches,
  tournamentSchedule,
  tournamentStatistics,
  tournamentTable,
} from '../features/torneos/routing/canonicalRoutes';

jest.mock('../components/global-header/GlobalHeader', () => () => (
  <header data-testid="global-header" />
));

const ORG = 'b1000000-0000-4000-8000-000000000001';
const OTHER_ORG = 'b1000000-0000-4000-8000-000000000009';
const TOURNAMENT_A = 'b2000000-0000-4000-8000-00000000000a';
const TOURNAMENT_B = 'b2000000-0000-4000-8000-00000000000b';
const CATEGORY_A = 'b3000000-0000-4000-8000-00000000000a';
const CATEGORY_A2 = 'b3000000-0000-4000-8000-00000000000c';
const CATEGORY_B = 'b3000000-0000-4000-8000-00000000000b';
const SEASON = 'b4000000-0000-4000-8000-000000000001';

function tournament(id, name, categories) {
  return {
    id,
    organizationId: ORG,
    seasonId: SEASON,
    name,
    slug: name.toLowerCase().replace(/\s+/g, '-'),
    status: 'active',
    sportModality: 'football_7',
    competitionFormat: 'league',
    categories,
  };
}

// La preferencia del servidor apunta a B a propósito: todo test que abra una
// URL canónica de A demuestra que la URL gana, no la preferencia.
function competition(overrides = {}) {
  return {
    preference: {
      organizationId: ORG,
      activeSeasonId: SEASON,
      activeTournamentId: TOURNAMENT_B,
    },
    seasons: [{ id: SEASON, name: 'Apertura 2030', status: 'active' }],
    tournaments: [
      tournament(TOURNAMENT_A, 'Copa Alfa', [
        { id: CATEGORY_A, name: 'Primera', status: 'active', sortOrder: 0 },
        { id: CATEGORY_A2, name: 'Reserva', status: 'active', sortOrder: 1 },
      ]),
      tournament(TOURNAMENT_B, 'Copa Beta', [
        { id: CATEGORY_B, name: 'Única', status: 'active', sortOrder: 0 },
      ]),
    ],
    modalities: [],
    formats: [],
    ...overrides,
  };
}

function createService({ role = 'owner', competitionPayload = competition() } = {}) {
  const organization = {
    id: ORG,
    name: 'Liga Devoto',
    slug: 'liga-devoto',
    role,
    status: 'active',
    capabilities: getCapabilitiesForRole(role),
  };
  return {
    loadContext: jest.fn().mockResolvedValue({
      preference: { workspaceType: 'tournament_organization', activeOrganizationId: ORG },
      organizations: [organization],
    }),
    setPreference: jest.fn().mockResolvedValue({ activeOrganizationId: ORG }),
    loadCompetitionContext: jest.fn().mockResolvedValue(competitionPayload),
    setTournamentContext: jest.fn().mockResolvedValue({}),
    loadFixtureContext: jest.fn().mockResolvedValue({
      phases: [{ id: 'phase-a', fixtureVersionId: 'version-a', phaseType: 'league' }],
      groups: [],
      versions: [],
    }),
    loadScheduleContext: jest.fn().mockResolvedValue({}),
    loadOrganizationVenues: jest.fn().mockResolvedValue({ venues: [], courts: [] }),
    loadMatchOperations: jest.fn().mockResolvedValue({ matches: [] }),
    loadMatchOperation: jest.fn(),
    loadMatchSquad: jest.fn(),
    loadStandings: jest.fn().mockResolvedValue({ standings: [], revision: null }),
    loadStatistics: jest.fn().mockResolvedValue({ players: [], teams: [], discipline: [] }),
    loadTeamsContext: jest.fn().mockResolvedValue({ settings: {}, entries: [] }),
    listMembers: jest.fn().mockResolvedValue([]),
    createIdempotencyKey: jest.fn(() => 'request-key'),
  };
}

/*
 * La ubicación en curso, leída en render y no en un efecto: cuando el provider
 * dispara su carga, este valor ya es el de la URL sobre la que esa carga ocurre.
 * Sirve para atribuir cada request a la dirección que lo pidió, que es la única
 * forma de distinguir un fallback real de una carga legítima posterior a un
 * redirect.
 */
let currentPath = '';

function LocationProbe() {
  const location = useLocation();
  currentPath = `${location.pathname}${location.search}`;
  return null;
}

function renderPath(path, service) {
  currentPath = path;
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LocationProbe />
      <Routes>
        <Route path="/torneos/*" element={<TorneosFeatureGate enabled service={service} />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('canonical tournament routing', () => {
  describe('cold opens under the canonical URL', () => {
    test('fixture resolves the tournament from the URL, not the preference', async () => {
      const api = createService();
      renderPath(tournamentFixture(ORG, TOURNAMENT_A), api);
      await waitFor(() => {
        expect(api.loadFixtureContext).toHaveBeenCalledWith(ORG, TOURNAMENT_A, CATEGORY_A);
      }, { timeout: 5000 });
    });

    test('programacion opens cold on the tournament of the URL', async () => {
      const api = createService();
      renderPath(tournamentSchedule(ORG, TOURNAMENT_A), api);
      expect(await screen.findByRole('heading', { name: 'Programación' }, { timeout: 5000 }))
        .toBeInTheDocument();
      await waitFor(() => {
        expect(api.loadScheduleContext).toHaveBeenCalledWith(ORG, TOURNAMENT_A, CATEGORY_A);
      });
    });

    test('tabla opens cold on the tournament of the URL', async () => {
      const api = createService();
      renderPath(tournamentTable(ORG, TOURNAMENT_A), api);
      await waitFor(() => {
        expect(api.loadStandings).toHaveBeenCalledWith(
          expect.objectContaining({ organizationId: ORG, tournamentId: TOURNAMENT_A }),
        );
      }, { timeout: 5000 });
    });

    test('estadisticas and disciplina mount under the canonical URL', async () => {
      const stats = createService();
      renderPath(tournamentStatistics(ORG, TOURNAMENT_A), stats);
      await waitFor(() => {
        expect(stats.loadStatistics).toHaveBeenCalledWith(
          expect.objectContaining({ tournamentId: TOURNAMENT_A }),
        );
      }, { timeout: 5000 });

      const discipline = createService();
      renderPath(tournamentDiscipline(ORG, TOURNAMENT_A), discipline);
      await waitFor(() => {
        expect(discipline.loadStatistics).toHaveBeenCalledWith(
          expect.objectContaining({ tournamentId: TOURNAMENT_A }),
        );
      }, { timeout: 5000 });
    });

    test('partidos opens cold and scopes the queue to the URL tournament', async () => {
      const api = createService();
      renderPath(tournamentMatches(ORG, TOURNAMENT_A), api);
      expect(await screen.findByRole('heading', { name: 'Partidos' }, { timeout: 5000 }))
        .toBeInTheDocument();
      await waitFor(() => {
        expect(api.loadMatchOperations).toHaveBeenCalledWith(
          expect.objectContaining({ organizationId: ORG, tournamentId: TOURNAMENT_A }),
        );
      });
      expect(api.loadMatchOperations).not.toHaveBeenCalledWith(
        expect.objectContaining({ tournamentId: TOURNAMENT_B }),
      );
    });
  });

  describe('the URL is never overwritten by a preference', () => {
    test('mounting a canonical route does not write activeTournamentId', async () => {
      const api = createService();
      renderPath(tournamentFixture(ORG, TOURNAMENT_A), api);
      await waitFor(() => {
        expect(api.loadFixtureContext).toHaveBeenCalledWith(ORG, TOURNAMENT_A, CATEGORY_A);
      }, { timeout: 5000 });
      expect(api.setTournamentContext).not.toHaveBeenCalled();
    });

    test('two mounted contexts on A and B do not bleed into each other', async () => {
      const apiA = createService();
      const apiB = createService();
      renderPath(tournamentFixture(ORG, TOURNAMENT_A), apiA);
      renderPath(tournamentFixture(ORG, TOURNAMENT_B), apiB);

      await waitFor(() => {
        expect(apiA.loadFixtureContext).toHaveBeenCalledWith(ORG, TOURNAMENT_A, CATEGORY_A);
        expect(apiB.loadFixtureContext).toHaveBeenCalledWith(ORG, TOURNAMENT_B, CATEGORY_B);
      }, { timeout: 5000 });
      expect(apiA.loadFixtureContext).not.toHaveBeenCalledWith(
        ORG, TOURNAMENT_B, expect.anything(),
      );
      expect(apiB.loadFixtureContext).not.toHaveBeenCalledWith(
        ORG, TOURNAMENT_A, expect.anything(),
      );
    });
  });

  describe('invalid ids fail closed', () => {
    test('a tournament that is not in the organization does not fall back', async () => {
      const api = createService();
      const MISSING = 'b2000000-0000-4000-8000-0000000000ff';
      const invalidPath = tournamentFixture(ORG, MISSING);
      // Cada carga de fixture queda atribuida a la URL desde la que se pidió.
      // El contrato no es «B no se carga nunca» --- después del redirect, en una
      // superficie de organización, la preferencia vuelve a ser el default
      // legítimo--- sino «bajo la URL canónica inválida no se carga ningún
      // torneo». Afirmar lo primero ata el test al momento en que se mira.
      const fixtureCalls = [];
      api.loadFixtureContext.mockImplementation((organizationId, tournamentId, categoryId) => {
        fixtureCalls.push({ organizationId, tournamentId, categoryId, path: currentPath });
        return Promise.resolve({
          phases: [{ id: 'phase-a', fixtureVersionId: 'version-a', phaseType: 'league' }],
          groups: [],
          versions: [],
        });
      });

      renderPath(invalidPath, api);

      // El guard sale de esa ruta: no se queda mostrando nada bajo ella.
      await waitFor(() => {
        expect(currentPath).toBe(organizationTournaments(ORG));
      }, { timeout: 5000 });
      expect(await screen.findByRole('heading', { name: /torneos/i }, { timeout: 5000 }))
        .toBeInTheDocument();

      // Ninguna carga se originó bajo la dirección inválida, ni de B ni de nadie.
      expect(fixtureCalls.filter((call) => call.path === invalidPath)).toEqual([]);
      // Y el torneo inexistente jamás se pidió como si existiera.
      expect(api.loadFixtureContext).not.toHaveBeenCalledWith(
        ORG, MISSING, expect.anything(),
      );
      expect(screen.queryByText('Copa Alfa · Recorrido completo del fixture.'))
        .not.toBeInTheDocument();
    });

    test('a tournament requested under the wrong organization fails closed', async () => {
      const api = createService();
      renderPath(tournamentFixture(OTHER_ORG, TOURNAMENT_A), api);
      // La organización de la URL no es una a la que tengamos acceso: el guard
      // de organización cierra antes de que el de torneo llegue a mirar nada.
      await waitFor(() => {
        expect(screen.queryByText('Copa Alfa · Recorrido completo del fixture.'))
          .not.toBeInTheDocument();
      }, { timeout: 5000 });
      expect(api.loadFixtureContext).not.toHaveBeenCalled();
    });
  });

  describe('a resource is not trusted just because the URL names it', () => {
    test('an operation from tournament B never renders under tournament A', async () => {
      const api = createService();
      const MATCH = 'b5000000-0000-4000-8000-000000000001';
      api.loadMatchOperations.mockResolvedValue({
        matches: [{
          id: MATCH,
          categoryId: CATEGORY_A,
          matchNumber: 1,
          homeTeamEntryId: 'home',
          awayTeamEntryId: 'away',
          homeName: 'Napoli',
          awayName: 'Belgrano',
          operationId: 'operation-a',
          operationStatus: 'draft',
        }],
      });
      // El RPC autoriza la lectura pero no recibe torneo: devuelve una
      // operación que pertenece a B.
      api.loadMatchOperation.mockResolvedValue({
        operation: {
          id: 'operation-a',
          tournament_id: TOURNAMENT_B,
          organization_id: ORG,
          status: 'draft',
          home_team_entry_id: 'home',
          away_team_entry_id: 'away',
          home_team_snapshot: { name: 'Napoli' },
          away_team_snapshot: { name: 'Belgrano' },
        },
        outcome: null,
        score: null,
        events: [],
        players: [],
        reviews: [],
      });

      renderPath(`${tournamentMatches(ORG, TOURNAMENT_A)}/${MATCH}/acta`, api);
      expect(await screen.findByText(
        /no pertenece al torneo de esta dirección/i,
        {},
        { timeout: 5000 },
      )).toBeInTheDocument();
    });

    test('an operation of the URL tournament renders normally', async () => {
      const api = createService();
      const MATCH = 'b5000000-0000-4000-8000-000000000002';
      api.loadMatchOperations.mockResolvedValue({
        matches: [{
          id: MATCH,
          categoryId: CATEGORY_A,
          matchNumber: 1,
          homeTeamEntryId: 'home',
          awayTeamEntryId: 'away',
          homeName: 'Napoli',
          awayName: 'Belgrano',
          operationId: 'operation-b',
          operationStatus: 'draft',
        }],
      });
      api.loadMatchOperation.mockResolvedValue({
        operation: {
          id: 'operation-b',
          tournament_id: TOURNAMENT_A,
          organization_id: ORG,
          status: 'draft',
          home_team_entry_id: 'home',
          away_team_entry_id: 'away',
          home_team_snapshot: { name: 'Napoli' },
          away_team_snapshot: { name: 'Belgrano' },
        },
        outcome: null,
        score: null,
        events: [],
        players: [],
        reviews: [],
      });

      renderPath(`${tournamentMatches(ORG, TOURNAMENT_A)}/${MATCH}/acta`, api);
      await waitFor(() => {
        expect(api.loadMatchOperation).toHaveBeenCalled();
      }, { timeout: 5000 });
      expect(screen.queryByText(/no pertenece al torneo de esta dirección/i))
        .not.toBeInTheDocument();
    });
  });

  describe('?categoria= is the reproducible category', () => {
    test('a valid category from the URL wins over the default', async () => {
      const api = createService();
      renderPath(tournamentFixture(ORG, TOURNAMENT_A, { categoryId: CATEGORY_A2 }), api);
      await waitFor(() => {
        expect(api.loadFixtureContext).toHaveBeenCalledWith(ORG, TOURNAMENT_A, CATEGORY_A2);
      }, { timeout: 5000 });
      expect(api.loadFixtureContext).not.toHaveBeenCalledWith(ORG, TOURNAMENT_A, CATEGORY_A);
    });

    test('a category belonging to another tournament fails closed', async () => {
      const api = createService();
      renderPath(tournamentFixture(ORG, TOURNAMENT_A, { categoryId: CATEGORY_B }), api);
      expect(await screen.findByRole('heading', { name: /torneos/i }, { timeout: 5000 }))
        .toBeInTheDocument();
      expect(api.loadFixtureContext).not.toHaveBeenCalledWith(
        ORG, TOURNAMENT_A, CATEGORY_B,
      );
      expect(api.loadFixtureContext).not.toHaveBeenCalledWith(
        ORG, TOURNAMENT_A, CATEGORY_A,
      );
    });

    test('no query keeps the default category for UX', async () => {
      const api = createService();
      renderPath(tournamentFixture(ORG, TOURNAMENT_A), api);
      await waitFor(() => {
        expect(api.loadFixtureContext).toHaveBeenCalledWith(ORG, TOURNAMENT_A, CATEGORY_A);
      }, { timeout: 5000 });
    });
  });
});
