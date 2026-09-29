import React from 'react';
import {
  act, fireEvent, render, screen, waitFor, within,
} from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import TorneosFeatureGate from '../features/torneos/TorneosFeatureGate';
import { getCapabilitiesForRole } from '../features/torneos/domain/capabilities';

jest.mock('../components/global-header/GlobalHeader', () => () => (
  <header data-testid="global-header" />
));

// POST-BETA issue 1: Resumen / Convocatorias / Acta / Revisión / Historial are views of ONE match load.
// Before: every tab change re-read the match list, then the acta, then (Convocatorias) both squads —
// 2–3 serial gateway calls behind the full-page "Cargando operación de partidos…".

const ORG = 'd1000000-0000-4000-8000-000000000001';
const TOURNAMENT = 'd2000000-0000-4000-8000-000000000001';
const CATEGORY = 'd3000000-0000-4000-8000-000000000001';
const MATCH = 'd4000000-0000-4000-8000-000000000001';
const OPERATION = 'd5000000-0000-4000-8000-000000000001';
const HOME = 'd6000000-0000-4000-8000-000000000001';
const AWAY = 'd6000000-0000-4000-8000-000000000002';
const PAGE_LOADER = 'Cargando operación de partidos…';
// The first render also resolves the lazy hybrid shell.
const FIRST_LOAD = { timeout: 5000 };

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

function squadContext(teamEntryId, teamName) {
  return {
    matchId: MATCH,
    teamEntryId,
    teamName,
    status: 'scheduled',
    teamSize: 5,
    squad: null,
    players: [{
      rosterPlayerId: `${teamEntryId.slice(0, -1)}9`,
      displayName: `Arquero ${teamName}`,
      shirtNumber: 1,
      position: 'ARQ',
      isGoalkeeper: true,
      availability: 'available',
      selection: null,
    }],
  };
}

function createService({ operationStatus = 'draft', withOperation = true } = {}) {
  const organization = {
    id: ORG,
    name: 'Liga QA',
    slug: 'liga-qa',
    role: 'owner',
    capabilities: getCapabilitiesForRole('owner'),
  };
  return {
    loadContext: jest.fn().mockResolvedValue({
      preference: { workspaceType: 'tournament_organization', activeOrganizationId: ORG },
      organizations: [organization],
    }),
    setPreference: jest.fn().mockResolvedValue({ activeOrganizationId: ORG }),
    loadCompetitionContext: jest.fn().mockResolvedValue({
      preference: { organizationId: ORG, activeSeasonId: 'season-a', activeTournamentId: TOURNAMENT },
      seasons: [{ id: 'season-a', name: 'Apertura', status: 'active' }],
      tournaments: [{
        id: TOURNAMENT,
        seasonId: 'season-a',
        name: 'Liga QA',
        status: 'active',
        categories: [{ id: CATEGORY, name: 'Primera', status: 'active' }],
      }],
      modalities: [],
      formats: [],
    }),
    setTournamentContext: jest.fn(),
    loadFixtureContext: jest.fn().mockResolvedValue({}),
    loadScheduleContext: jest.fn().mockResolvedValue({}),
    loadMatchOperations: jest.fn().mockResolvedValue({
      matches: [{
        id: MATCH,
        categoryId: CATEGORY,
        matchNumber: 3,
        scheduledAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        planningStatus: 'scheduled',
        homeName: 'Napoli',
        awayName: 'Belgrano',
        homeTeamEntryId: HOME,
        awayTeamEntryId: AWAY,
        operationId: withOperation ? OPERATION : null,
        operationStatus: withOperation ? operationStatus : null,
      }],
    }),
    loadMatchOperation: jest.fn().mockResolvedValue({
      operation: {
        id: OPERATION,
        organization_id: ORG,
        tournament_id: TOURNAMENT,
        category_id: CATEGORY,
        operation_version: 1,
        status: operationStatus,
        home_team_entry_id: HOME,
        away_team_entry_id: AWAY,
        home_team_snapshot: { name: 'Napoli' },
        away_team_snapshot: { name: 'Belgrano' },
        opened_at: new Date().toISOString(),
      },
      outcome: null,
      score: null,
      events: [],
      players: [],
      reviews: [],
    }),
    loadMatchSquad: jest.fn(({ teamEntryId }) => Promise.resolve(
      squadContext(teamEntryId, teamEntryId === HOME ? 'Napoli' : 'Belgrano'),
    )),
    saveMatchSquad: jest.fn().mockResolvedValue({}),
    submitMatchSquad: jest.fn().mockResolvedValue({}),
    openMatchOperation: jest.fn(),
    setMatchOutcome: jest.fn().mockResolvedValue({ ok: true }),
    setMatchScore: jest.fn().mockResolvedValue({ ok: true }),
    addMatchEvent: jest.fn().mockResolvedValue({ ok: true }),
    loadPlayerMatches: jest.fn().mockResolvedValue([]),
    respondMatchAvailability: jest.fn(),
    createIdempotencyKey: jest.fn(() => 'request-a'),
  };
}

function renderAt(service, suffix = '') {
  return render(
    <MemoryRouter initialEntries={[`/torneos/organizacion/${ORG}/partidos/${MATCH}${suffix}`]}>
      <Routes>
        <Route path="/torneos/*" element={<TorneosFeatureGate enabled service={service} />} />
      </Routes>
    </MemoryRouter>,
  );
}

const matchReads = (service) => ({
  list: service.loadMatchOperations.mock.calls.length,
  operation: service.loadMatchOperation.mock.calls.length,
  squads: service.loadMatchSquad.mock.calls.length,
});

const tab = (name) => within(screen.getByRole('navigation', { name: 'Secciones del partido' }))
  .getByRole('link', { name });

describe('pestañas del partido: una sola carga, sin loader de página completa', () => {
  test('Resumen → Acta → Revisión → Historial no vuelve a leer nada ni desmonta la página', async () => {
    const service = createService();
    renderAt(service);
    await screen.findByRole('heading', { name: /Hay convocatorias pendientes/ }, FIRST_LOAD);
    const initial = matchReads(service);
    expect(initial).toEqual({ list: 1, operation: 1, squads: 0 });
    expect(tab('Resumen')).toHaveAttribute('aria-current', 'page');

    fireEvent.click(tab('Acta'));
    expect(screen.queryByText(PAGE_LOADER)).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /Guardar estado/ })).toBeInTheDocument();
    expect(tab('Acta')).toHaveAttribute('aria-current', 'page');

    fireEvent.click(tab('Revisión'));
    expect(screen.queryByText(PAGE_LOADER)).not.toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Revisión y validación' })).toBeInTheDocument();

    fireEvent.click(tab('Historial'));
    expect(await screen.findByRole('heading', { name: 'Historial del acta' })).toBeInTheDocument();

    fireEvent.click(tab('Resumen'));
    expect(await screen.findByRole('heading', { name: /Hay convocatorias pendientes/ })).toBeInTheDocument();
    expect(matchReads(service)).toEqual(initial);
  });

  test('Convocatorias lee sólo las dos convocatorias, con loader local, y queda en memoria', async () => {
    const service = createService();
    const home = deferred();
    service.loadMatchSquad.mockImplementation(({ teamEntryId }) => (
      teamEntryId === HOME
        ? home.promise
        : Promise.resolve(squadContext(AWAY, 'Belgrano'))
    ));
    renderAt(service);
    await screen.findByRole('heading', { name: /Hay convocatorias pendientes/ }, FIRST_LOAD);

    fireEvent.click(tab('Convocatorias'));
    // The page header and the tabs stay; only the tab body waits.
    expect(screen.queryByText(PAGE_LOADER)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Napoli/ })).toBeInTheDocument();
    expect(await screen.findByText('Cargando convocatorias…')).toBeInTheDocument();
    expect(matchReads(service)).toEqual({ list: 1, operation: 1, squads: 2 });

    await act(async () => { home.resolve(squadContext(HOME, 'Napoli')); });
    expect(await screen.findByRole('button', { name: /Arquero Napoli/ })).toBeInTheDocument();
    expect(screen.queryByText('Cargando convocatorias…')).not.toBeInTheDocument();

    fireEvent.click(tab('Acta'));
    await screen.findByRole('button', { name: /Guardar estado/ });
    fireEvent.click(tab('Convocatorias'));
    expect(await screen.findByRole('button', { name: /Arquero Napoli/ })).toBeInTheDocument();
    expect(screen.queryByText('Cargando convocatorias…')).not.toBeInTheDocument();
    expect(matchReads(service)).toEqual({ list: 1, operation: 1, squads: 2 });
  });

  test('entrar directo a Convocatorias lee acta y convocatorias en paralelo, no en serie', async () => {
    const service = createService();
    const operation = deferred();
    const original = service.loadMatchOperation.getMockImplementation();
    service.loadMatchOperation.mockImplementation(() => operation.promise);
    renderAt(service, '/convocatorias');
    await waitFor(() => expect(service.loadMatchOperation).toHaveBeenCalledTimes(1));
    // The acta is still pending and the squads were already asked for.
    expect(service.loadMatchSquad).toHaveBeenCalledTimes(2);
    await act(async () => { operation.resolve(await original()); });
    expect(await screen.findByRole('button', { name: /Guardar borrador/ })).toBeInTheDocument();
    expect(matchReads(service)).toEqual({ list: 1, operation: 1, squads: 2 });
  });

  test('si las convocatorias no se pueden leer, el error queda en la pestaña y se puede reintentar', async () => {
    const service = createService();
    service.loadMatchSquad.mockRejectedValueOnce(new Error('Torneos no está disponible en este momento.'));
    renderAt(service);
    await screen.findByRole('heading', { name: /Hay convocatorias pendientes/ }, FIRST_LOAD);
    fireEvent.click(tab('Convocatorias'));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('No pudimos cargar las convocatorias');
    // Fail-safe: no squad editor built from a read that failed.
    expect(screen.queryByRole('button', { name: /Guardar borrador/ })).not.toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Secciones del partido' })).toBeInTheDocument();

    fireEvent.click(within(alert).getByRole('button', { name: /Reintentar/ }));
    expect(await screen.findByRole('button', { name: /Guardar borrador/ })).toBeInTheDocument();
    expect(service.loadMatchOperations).toHaveBeenCalledTimes(1);
  });

  test('guardar la convocatoria re-lee en segundo plano, y si esa relectura falla la página cierra', async () => {
    const service = createService({ withOperation: false });
    renderAt(service, '/convocatorias');
    const save = await screen.findByRole('button', { name: /Guardar borrador/ });

    service.loadMatchOperations.mockRejectedValueOnce(new Error('Torneos no está disponible en este momento.'));
    fireEvent.click(save);
    await waitFor(() => expect(service.saveMatchSquad).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(PAGE_LOADER)).not.toBeInTheDocument();
    expect(await screen.findByText('No pudimos abrir Torneos')).toBeInTheDocument();
  });
});
