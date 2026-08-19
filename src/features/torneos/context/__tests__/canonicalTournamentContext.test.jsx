import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import {
  TorneosCompetitionProvider,
  useTorneosCompetition,
} from '../TorneosCompetitionContext';

const ORG = 'c1000000-0000-4000-8000-000000000001';
const A = 'c2000000-0000-4000-8000-00000000000a';
const B = 'c2000000-0000-4000-8000-00000000000b';
const SEASON = 'c3000000-0000-4000-8000-000000000001';

function payload(activeTournamentId) {
  return {
    preference: { organizationId: ORG, activeSeasonId: SEASON, activeTournamentId },
    seasons: [{ id: SEASON, name: 'Apertura' }],
    tournaments: [
      { id: A, organizationId: ORG, seasonId: SEASON, name: 'Copa Alfa', categories: [] },
      { id: B, organizationId: ORG, seasonId: SEASON, name: 'Copa Beta', categories: [] },
    ],
    modalities: [],
    formats: [],
  };
}

let probe = null;

function Probe() {
  const competition = useTorneosCompetition();
  probe = competition;
  return (
    <div>
      <span data-testid="active">{competition.activeTournament?.name || 'none'}</span>
      <span data-testid="route-status">{competition.routeTournamentStatus}</span>
      <span data-testid="is-route">{String(competition.isTournamentRoute)}</span>
      <span data-testid="status">{competition.status}</span>
    </div>
  );
}

function renderProvider({ routeTournamentId = null, service }) {
  return render(
    <MemoryRouter>
      <TorneosCompetitionProvider
        organizationId={ORG}
        routeTournamentId={routeTournamentId}
        service={service}
      >
        <Probe />
      </TorneosCompetitionProvider>
    </MemoryRouter>,
  );
}

function createService(initial = payload(B)) {
  return {
    loadCompetitionContext: jest.fn().mockResolvedValue(initial),
    setTournamentContext: jest.fn().mockResolvedValue({}),
    createIdempotencyKey: jest.fn(() => 'key'),
  };
}

beforeEach(() => { probe = null; });

describe('TorneosCompetitionProvider — la URL canónica es la fuente de verdad', () => {
  test('the pinned tournament wins over the server preference', async () => {
    const service = createService(payload(B));
    renderProvider({ routeTournamentId: A, service });
    await waitFor(() => expect(screen.getByTestId('active')).toHaveTextContent('Copa Alfa'));
    expect(screen.getByTestId('is-route')).toHaveTextContent('true');
    expect(screen.getByTestId('route-status')).toHaveTextContent('ready');
  });

  test('mounting a canonical route never writes the tournament preference', async () => {
    const service = createService(payload(B));
    renderProvider({ routeTournamentId: A, service });
    await waitFor(() => expect(screen.getByTestId('active')).toHaveTextContent('Copa Alfa'));
    expect(service.setTournamentContext).not.toHaveBeenCalled();
  });

  test('refresh() cannot move a canonical route to the refreshed preference', async () => {
    const service = createService(payload(B));
    renderProvider({ routeTournamentId: A, service });
    await waitFor(() => expect(screen.getByTestId('active')).toHaveTextContent('Copa Alfa'));

    // La preferencia del servidor cambia (otra pestaña, otro dispositivo) y el
    // contexto se recarga. La ruta abierta sigue siendo A.
    service.loadCompetitionContext.mockResolvedValue(payload(B));
    await act(async () => { await probe.refresh(); });
    expect(screen.getByTestId('active')).toHaveTextContent('Copa Alfa');

    service.loadCompetitionContext.mockResolvedValue(payload(A));
    await act(async () => { await probe.refresh(); });
    expect(screen.getByTestId('active')).toHaveTextContent('Copa Alfa');
    expect(service.setTournamentContext).not.toHaveBeenCalled();
  });

  test('refresh() never blanks the pinned tournament mid-flight', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const service = createService(payload(B));
    renderProvider({ routeTournamentId: A, service });
    await waitFor(() => expect(screen.getByTestId('active')).toHaveTextContent('Copa Alfa'));

    service.loadCompetitionContext.mockImplementation(async () => {
      await gate;
      return payload(B);
    });
    let pending;
    await act(async () => { pending = probe.refresh().catch(() => {}); });
    // En vuelo: si el catálogo se vaciara, el torneo de la URL se daría por
    // inexistente y la pantalla parpadearía a "sin torneo".
    expect(screen.getByTestId('status')).toHaveTextContent('loading');
    expect(screen.getByTestId('active')).toHaveTextContent('Copa Alfa');
    expect(screen.getByTestId('route-status')).toHaveTextContent('ready');
    await act(async () => { release(); await pending; });
    expect(screen.getByTestId('active')).toHaveTextContent('Copa Alfa');
  });

  test('an unknown tournament id fails closed instead of falling back', async () => {
    const service = createService(payload(B));
    renderProvider({ routeTournamentId: 'c2000000-0000-4000-8000-0000000000ff', service });
    await waitFor(() => expect(screen.getByTestId('route-status')).toHaveTextContent('not-found'));
    expect(screen.getByTestId('active')).toHaveTextContent('none');
  });

  test('organization surfaces keep following the persisted preference', async () => {
    const service = createService(payload(B));
    renderProvider({ routeTournamentId: null, service });
    await waitFor(() => expect(screen.getByTestId('active')).toHaveTextContent('Copa Beta'));
    expect(screen.getByTestId('is-route')).toHaveTextContent('false');
    expect(screen.getByTestId('route-status')).toHaveTextContent('idle');

    // Y ahí la preferencia sí manda: un refresh que la mueve, mueve la pantalla.
    service.loadCompetitionContext.mockResolvedValue(payload(A));
    await act(async () => { await probe.refresh(); });
    expect(screen.getByTestId('active')).toHaveTextContent('Copa Alfa');
  });

  test('the exposed preference reflects the URL without writing it', async () => {
    const service = createService(payload(B));
    renderProvider({ routeTournamentId: A, service });
    await waitFor(() => expect(screen.getByTestId('active')).toHaveTextContent('Copa Alfa'));
    expect(probe.preference.activeTournamentId).toBe(A);
    expect(probe.preference.activeSeasonId).toBe(SEASON);
    expect(service.setTournamentContext).not.toHaveBeenCalled();
  });
});
