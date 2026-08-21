import React from 'react';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import TorneosFeatureGate from '../features/torneos/TorneosFeatureGate';
import { getCapabilitiesForRole } from '../features/torneos/domain/capabilities';
import {
  organizationTeamEntry,
  organizationTeamEntryVisualIdentity,
  organizationVenues,
  tournamentConfiguration,
  tournamentFixture,
  tournamentMatch,
  tournamentMatchReport,
  tournamentMatches,
  tournamentSchedule,
  tournamentTable,
  tournamentTeams,
} from '../features/torneos/routing/canonicalRoutes';
import {
  legacyOrganizationFixture,
  legacyOrganizationMatches,
  legacyOrganizationTeams,
  legacyTournamentConfiguration,
} from '../features/torneos/routing/legacyRoutes';
import { APP_SPACE, getValidRouteForSpace } from '../features/space-navigation/spaceNavigation';
import { sanitizeReturnTo } from '../features/qa/qaRoleSwitcher';

jest.mock('../components/global-header/GlobalHeader', () => () => (
  <header data-testid="global-header" />
));

const ORG = 'c1000000-0000-4000-8000-000000000001';
const TOURNAMENT_A = 'c2000000-0000-4000-8000-00000000000a';
const TOURNAMENT_B = 'c2000000-0000-4000-8000-00000000000b';
const CATEGORY_A = 'c3000000-0000-4000-8000-00000000000a';
const CATEGORY_A2 = 'c3000000-0000-4000-8000-00000000000c';
const CATEGORY_B = 'c3000000-0000-4000-8000-00000000000b';
const SEASON = 'c4000000-0000-4000-8000-000000000001';
const MATCH = 'c5000000-0000-4000-8000-000000000001';
const ENTRY = 'c6000000-0000-4000-8000-000000000001';

function tournament(id, name, categories) {
  return {
    id,
    organizationId: ORG,
    seasonId: SEASON,
    name,
    slug: name.toLowerCase().replace(/\s+/g, '-'),
    status: 'registration',
    sportModality: 'football_7',
    competitionFormat: 'league',
    categories,
  };
}

const TOURNAMENT_A_ENTITY = tournament(TOURNAMENT_A, 'Copa Alfa', [
  { id: CATEGORY_A, name: 'Primera', status: 'active', sortOrder: 0 },
  { id: CATEGORY_A2, name: 'Reserva', status: 'active', sortOrder: 1 },
]);
const TOURNAMENT_B_ENTITY = tournament(TOURNAMENT_B, 'Copa Beta', [
  { id: CATEGORY_B, name: 'Única', status: 'active', sortOrder: 0 },
]);

// La preferencia apunta a B en todos los casos ambiguos: cualquier test que
// resuelva a A demuestra que la resolución no salió de la preferencia.
function competition({ tournaments = [TOURNAMENT_A_ENTITY, TOURNAMENT_B_ENTITY], activeTournamentId = TOURNAMENT_B } = {}) {
  return {
    preference: {
      organizationId: ORG,
      activeSeasonId: SEASON,
      activeTournamentId,
    },
    seasons: [{ id: SEASON, name: 'Apertura 2030', status: 'active' }],
    tournaments,
    modalities: [],
    formats: [],
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

describe('canonical adoption', () => {
  describe('las direcciones viejas resuelven en vez de renderizar', () => {
    test('con un solo torneo la dirección vieja se traduce sin preguntar', async () => {
      const api = createService({
        competitionPayload: competition({
          tournaments: [TOURNAMENT_A_ENTITY],
          activeTournamentId: null,
        }),
      });
      renderPath(legacyOrganizationFixture(ORG), api);
      await waitFor(() => {
        expect(currentPath).toBe(tournamentFixture(ORG, TOURNAMENT_A));
      }, { timeout: 5000 });
    });

    test('el `?categoria=` de la dirección vieja viaja al destino canónico', async () => {
      const api = createService({
        competitionPayload: competition({
          tournaments: [TOURNAMENT_A_ENTITY],
          activeTournamentId: null,
        }),
      });
      renderPath(`${legacyOrganizationFixture(ORG)}?categoria=${CATEGORY_A2}`, api);
      await waitFor(() => {
        expect(currentPath).toBe(
          tournamentFixture(ORG, TOURNAMENT_A, { categoryId: CATEGORY_A2 }),
        );
      }, { timeout: 5000 });
    });

    test('una dirección vieja con recurso conserva el recurso', async () => {
      const api = createService({
        competitionPayload: competition({
          tournaments: [TOURNAMENT_A_ENTITY],
          activeTournamentId: null,
        }),
      });
      renderPath(`${legacyOrganizationMatches(ORG)}/${MATCH}/acta`, api);
      await waitFor(() => {
        expect(currentPath).toBe(tournamentMatchReport(ORG, TOURNAMENT_A, MATCH));
      }, { timeout: 5000 });
    });

    test('la configuración vieja nombraba el torneo, así que no pregunta nada', async () => {
      const api = createService();
      renderPath(`${legacyTournamentConfiguration(ORG, TOURNAMENT_A)}?step=3`, api);
      await waitFor(() => {
        expect(currentPath).toBe(
          tournamentConfiguration(ORG, TOURNAMENT_A, { step: 3 }),
        );
      }, { timeout: 5000 });
    });
  });

  describe('con varios torneos se pregunta, no se adivina', () => {
    test('la preferencia no desempata una dirección vieja ambigua', async () => {
      const api = createService();
      renderPath(legacyOrganizationFixture(ORG), api);
      expect(await screen.findByRole(
        'heading',
        { name: /qué torneo querés abrir/i },
        { timeout: 5000 },
      )).toBeInTheDocument();
      // Ni al torneo de la preferencia ni a ningún otro: la dirección sigue
      // siendo la vieja hasta que alguien elija.
      expect(currentPath).toBe(legacyOrganizationFixture(ORG));
      expect(currentPath).not.toContain(TOURNAMENT_B);
    });

    test('la preferencia sí preselecciona, que es lo único para lo que sirve', async () => {
      const api = createService();
      renderPath(legacyOrganizationFixture(ORG), api);
      await screen.findByRole('heading', { name: /qué torneo querés abrir/i }, { timeout: 5000 });
      expect(screen.getByRole('radio', { name: /Copa Beta/ })).toBeChecked();
      expect(screen.getByRole('radio', { name: /Copa Alfa/ })).not.toBeChecked();
    });

    test('el selector explica una decisión de producto, no la arquitectura de la URL', async () => {
      const api = createService();
      renderPath(legacyOrganizationFixture(ORG), api);
      await screen.findByRole('heading', { name: /qué torneo querés abrir/i }, { timeout: 5000 });
      expect(screen.getByText(/disponible en más de una competencia/i)).toBeInTheDocument();
      expect(screen.queryByText(/dirección sin torneo|versión anterior/i)).toBeNull();
    });

    test('elegir un torneo lleva a su dirección canónica', async () => {
      const api = createService();
      renderPath(legacyOrganizationFixture(ORG), api);
      await screen.findByRole('heading', { name: /qué torneo querés abrir/i }, { timeout: 5000 });
      fireEvent.click(screen.getByRole('radio', { name: /Copa Alfa/ }));
      fireEvent.click(screen.getByRole('button', { name: /abrir torneo/i }));
      await waitFor(() => {
        expect(currentPath).toBe(tournamentFixture(ORG, TOURNAMENT_A));
      }, { timeout: 5000 });
    });

    test('resolver una dirección vieja no escribe la preferencia', async () => {
      const api = createService();
      renderPath(legacyOrganizationFixture(ORG), api);
      await screen.findByRole('heading', { name: /qué torneo querés abrir/i }, { timeout: 5000 });
      fireEvent.click(screen.getByRole('radio', { name: /Copa Alfa/ }));
      fireEvent.click(screen.getByRole('button', { name: /abrir torneo/i }));
      await waitFor(() => {
        expect(currentPath).toBe(tournamentFixture(ORG, TOURNAMENT_A));
      }, { timeout: 5000 });
      expect(api.setTournamentContext).not.toHaveBeenCalled();
    });
  });

  describe('el listado de equipos es del torneo de la URL', () => {
    test('la lista se pide para el torneo de la dirección, no para el de la preferencia', async () => {
      const api = createService();
      renderPath(tournamentTeams(ORG, TOURNAMENT_A), api);
      await waitFor(() => {
        expect(api.loadTeamsContext).toHaveBeenCalledWith(ORG, TOURNAMENT_A);
      }, { timeout: 5000 });
      expect(api.loadTeamsContext).not.toHaveBeenCalledWith(ORG, TOURNAMENT_B);
    });

    test('la inscripción ya creada sigue siendo de la organización', async () => {
      const api = createService();
      api.loadTeamsContext.mockResolvedValue({
        settings: { minimumPlayers: 7 },
        entries: [{
          id: ENTRY,
          name: 'Napoli',
          categoryName: 'Primera',
          status: 'approved',
          linked: false,
          roster: { playerCount: 9 },
          manager: { displayName: 'Ana' },
        }],
      });
      renderPath(tournamentTeams(ORG, TOURNAMENT_A), api);
      const link = await screen.findByRole('link', { name: /abrir/i }, { timeout: 5000 });
      expect(link).toHaveAttribute('href', organizationTeamEntry(ORG, ENTRY));
      expect(link.getAttribute('href')).not.toContain('/torneo/');
    });

    test('la identidad visual es un acceso visible desde cada equipo', async () => {
      const api = createService();
      api.loadTeamsContext.mockResolvedValue({
        settings: { minimumPlayers: 7 },
        entries: [{
          id: ENTRY,
          name: 'Napoli',
          categoryName: 'Primera',
          status: 'approved',
          linked: false,
          roster: { playerCount: 9 },
          manager: { displayName: 'Ana' },
        }],
      });
      renderPath(tournamentTeams(ORG, TOURNAMENT_A), api);
      expect(await screen.findByRole(
        'link',
        { name: /identidad visual/i },
        { timeout: 5000 },
      )).toHaveAttribute('href', organizationTeamEntryVisualIdentity(ORG, ENTRY));
    });

    test('abrir un equipo desde la lista no deja el guard en un loader', async () => {
      const api = createService();
      api.loadTeamsContext.mockResolvedValue({
        settings: { minimumPlayers: 7 },
        entries: [{
          id: ENTRY,
          name: 'Napoli',
          categoryName: 'Primera',
          status: 'approved',
          linked: false,
          roster: { playerCount: 9 },
          manager: { displayName: 'Ana' },
        }],
      });
      api.loadTeamRegistration = jest.fn().mockResolvedValue({
        entry: {
          id: ENTRY,
          tournamentId: TOURNAMENT_A,
          categoryId: CATEGORY_A,
          name: 'Napoli',
          status: 'approved',
          linked: false,
          shieldPath: null,
        },
        tournament: { id: TOURNAMENT_A, name: 'Copa Alfa', status: 'active' },
        category: { id: CATEGORY_A, name: 'Primera' },
        settings: {},
        managers: [],
        roster: { id: 'roster-a', version: 1, status: 'approved', players: [] },
        reviews: [],
        audit: [],
        viewer: { scope: 'full' },
        visualAssets: { canManageShield: false },
      });

      renderPath(tournamentTeams(ORG, TOURNAMENT_A), api);
      fireEvent.click(await screen.findByRole(
        'link',
        { name: /abrir equipo/i },
        { timeout: 5000 },
      ));

      expect(await screen.findByRole(
        'heading',
        { name: 'Napoli' },
        { timeout: 5000 },
      )).toBeInTheDocument();
      expect(currentPath).toBe(`${organizationTeamEntry(ORG, ENTRY)}/inscripcion`);
      expect(screen.queryByText(/confirmando acceso a la organización/i)).toBeNull();
    });

    test('la dirección vieja del listado también resuelve al torneo', async () => {
      const api = createService({
        competitionPayload: competition({
          tournaments: [TOURNAMENT_A_ENTITY],
          activeTournamentId: null,
        }),
      });
      renderPath(legacyOrganizationTeams(ORG), api);
      await waitFor(() => {
        expect(currentPath).toBe(tournamentTeams(ORG, TOURNAMENT_A));
      }, { timeout: 5000 });
    });
  });

  describe('los links internos no se arman a mano', () => {
    test('el id del partido entra como segmento y la categoría se rearma', async () => {
      const api = createService();
      api.loadMatchOperations.mockResolvedValue({
        matches: [{
          id: MATCH,
          categoryId: CATEGORY_A,
          matchNumber: 1,
          homeTeamEntryId: 'home',
          awayTeamEntryId: 'away',
          homeName: 'Napoli',
          awayName: 'Belgrano',
          operationId: null,
          operationStatus: null,
        }],
      });
      renderPath(tournamentMatches(ORG, TOURNAMENT_A, { categoryId: CATEGORY_A }), api);
      const link = await screen.findByRole('link', { name: /operar/i }, { timeout: 5000 });
      // El bug que esto cierra: `${base}/${id}` sobre una base con query
      // producía `…/partidos?categoria=X/<id>`.
      expect(link).toHaveAttribute(
        'href',
        tournamentMatch(ORG, TOURNAMENT_A, MATCH, { categoryId: CATEGORY_A }),
      );
      expect(link.getAttribute('href')).toMatch(
        new RegExp(`/partidos/${MATCH}\\?categoria=${CATEGORY_A}$`),
      );
    });

    test('la navegación de la organización conserva torneo y categoría', async () => {
      const api = createService();
      renderPath(tournamentFixture(ORG, TOURNAMENT_A, { categoryId: CATEGORY_A2 }), api);
      await screen.findByRole('heading', { name: 'Fixture' }, { timeout: 5000 });
      const [partidos] = screen.getAllByRole('link', { name: 'Partidos' });
      expect(partidos).toHaveAttribute(
        'href',
        tournamentMatches(ORG, TOURNAMENT_A, { categoryId: CATEGORY_A2 }),
      );
      const [competencia] = screen.getAllByRole('link', { name: 'Competencia' });
      expect(competencia).toHaveAttribute(
        'href',
        tournamentTable(ORG, TOURNAMENT_A, { categoryId: CATEGORY_A2 }),
      );
    });

    test('las superficies de la organización no se cuelan bajo el torneo', async () => {
      const api = createService();
      renderPath(tournamentFixture(ORG, TOURNAMENT_A), api);
      await screen.findByRole('heading', { name: 'Fixture' }, { timeout: 5000 });
      const [inicio] = screen.getAllByRole('link', { name: 'Inicio' });
      expect(inicio.getAttribute('href')).not.toContain('/torneo/');
      expect(screen.getByRole('link', { name: 'Sedes' }))
        .toHaveAttribute('href', organizationVenues(ORG));
    });
  });

  describe('el selector de torneo dentro de una ruta canónica navega', () => {
    test('cambiar de torneo cambia la dirección, no una preferencia invisible', async () => {
      const api = createService();
      renderPath(tournamentFixture(ORG, TOURNAMENT_A, { categoryId: CATEGORY_A2 }), api);
      await screen.findByRole('heading', { name: 'Fixture' }, { timeout: 5000 });
      fireEvent.change(screen.getByLabelText('Torneo activo'), {
        target: { value: TOURNAMENT_B },
      });
      await waitFor(() => {
        // Misma sección, otro torneo. La categoría NO viaja: era de A.
        expect(currentPath).toBe(tournamentFixture(ORG, TOURNAMENT_B));
      }, { timeout: 5000 });
    });

    test('la sección se conserva al cambiar de torneo', async () => {
      const api = createService();
      renderPath(tournamentSchedule(ORG, TOURNAMENT_A), api);
      await screen.findByRole('heading', { name: 'Programación' }, { timeout: 5000 });
      fireEvent.change(screen.getByLabelText('Torneo activo'), {
        target: { value: TOURNAMENT_B },
      });
      await waitFor(() => {
        expect(currentPath).toBe(tournamentSchedule(ORG, TOURNAMENT_B));
      }, { timeout: 5000 });
    });
  });

  describe('lo que no es del torneo no se movió', () => {
    test('las sedes siguen siendo de la organización', async () => {
      const api = createService();
      renderPath(organizationVenues(ORG), api);
      await waitFor(() => {
        expect(api.loadOrganizationVenues).toHaveBeenCalledWith(ORG);
      }, { timeout: 5000 });
      expect(currentPath).toBe(organizationVenues(ORG));
    });

    test('la superficie pública del torneo no la toca el barrido', async () => {
      const api = createService();
      const publicPath = `/torneos/torneo/${TOURNAMENT_A}/tabla`;
      renderPath(publicPath, api);
      await waitFor(() => {
        expect(api.loadContext).toHaveBeenCalled();
      }, { timeout: 5000 });
      expect(currentPath).toBe(publicPath);
      // Nunca entró al guard de organización: no hay catálogo que cargar.
      expect(api.loadCompetitionContext).not.toHaveBeenCalled();
    });
  });

  describe('la ruta canónica sobrevive a los dos selectores de contexto', () => {
    test('el Space Switcher recuerda la dirección completa con su categoría', () => {
      const canonical = tournamentMatches(ORG, TOURNAMENT_A, { categoryId: CATEGORY_A });
      expect(getValidRouteForSpace(APP_SPACE.TORNEOS, canonical)).toBe(canonical);
    });

    test('el QA Role Switcher acepta volver a una dirección canónica', () => {
      const canonical = tournamentMatchReport(ORG, TOURNAMENT_A, MATCH, {
        categoryId: CATEGORY_A,
      });
      expect(sanitizeReturnTo(canonical, { origin: 'http://127.0.0.1:3100' }))
        .toBe(canonical);
    });
  });
});
