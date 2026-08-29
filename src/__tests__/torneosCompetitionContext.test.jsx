import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  TorneosCompetitionProvider,
  useTorneosCompetition,
} from '../features/torneos/context/TorneosCompetitionContext';

const SEASONS = [
  { id: 'season-a', name: 'Apertura', status: 'active' },
  { id: 'season-b', name: 'Clausura', status: 'draft' },
];
const TOURNAMENTS = [
  { id: 'tournament-a', seasonId: 'season-a', name: 'Copa A', status: 'draft' },
  { id: 'tournament-b', seasonId: 'season-b', name: 'Copa B', status: 'draft' },
];

function payload(overrides = {}) {
  return {
    preference: {
      organizationId: 'org-a',
      activeSeasonId: 'season-a',
      activeTournamentId: 'tournament-a',
    },
    seasons: SEASONS,
    tournaments: TOURNAMENTS,
    modalities: [],
    formats: [],
    ...overrides,
  };
}

function service(overrides = {}) {
  return {
    loadCompetitionContext: jest.fn().mockResolvedValue(payload()),
    setTournamentContext: jest.fn().mockResolvedValue({}),
    createSeason: jest.fn().mockResolvedValue({ id: 'season-new' }),
    updateSeason: jest.fn(),
    createTournament: jest.fn(),
    updateTournament: jest.fn(),
    saveCategory: jest.fn(),
    changeTournamentStatus: jest.fn(),
    createIdempotencyKey: jest.fn(() => 'request-key'),
    ...overrides,
  };
}

function Probe() {
  const {
    status,
    activeSeason,
    activeTournament,
    seasons,
    notice,
    error,
    selectContext,
    createSeason,
    refresh,
  } = useTorneosCompetition();
  return (
    <div>
      <span>{status}</span>
      <span>{activeSeason?.name || 'Sin temporada'}</span>
      <span>{activeTournament?.name || 'Sin torneo'}</span>
      <span>{seasons.length} temporadas</span>
      <span>{notice}</span>
      <span>{error}</span>
      <button type="button" onClick={() => selectContext('season-b', 'tournament-b')}>
        Cambiar
      </button>
      <button type="button" onClick={() => selectContext('season-a', 'foreign')}>
        Falsificar
      </button>
      <button type="button" onClick={() => createSeason({ name: 'Nueva' })}>
        Crear
      </button>
      <button type="button" onClick={() => refresh().catch(() => {})}>
        Refrescar
      </button>
    </div>
  );
}

describe('TorneosCompetitionProvider', () => {
  test('uses only a season/tournament pair present in the server snapshot', async () => {
    const api = service();
    render(
      <TorneosCompetitionProvider organizationId="org-a" service={api}>
        <Probe />
      </TorneosCompetitionProvider>,
    );
    expect(await screen.findByText('Apertura')).toBeInTheDocument();
    expect(screen.getByText('Copa A')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar' }));
    expect(await screen.findByText('Clausura')).toBeInTheDocument();
    expect(api.setTournamentContext).toHaveBeenCalledWith({
      organizationId: 'org-a',
      seasonId: 'season-b',
      tournamentId: 'tournament-b',
    });
  });

  test('rejects a tournament outside the authorized snapshot before calling backend', async () => {
    const api = service();
    render(
      <TorneosCompetitionProvider organizationId="org-a" service={api}>
        <Probe />
      </TorneosCompetitionProvider>,
    );
    await screen.findByText('Apertura');
    fireEvent.click(screen.getByRole('button', { name: 'Falsificar' }));
    expect(await screen.findByText('Ese contexto ya no está disponible.'))
      .toBeInTheDocument();
    expect(api.setTournamentContext).not.toHaveBeenCalled();
  });

  test('clears private competition data while revalidating after a network error', async () => {
    const api = service();
    render(
      <TorneosCompetitionProvider organizationId="org-a" service={api}>
        <Probe />
      </TorneosCompetitionProvider>,
    );
    await screen.findByText('Copa A');
    api.loadCompetitionContext.mockRejectedValueOnce(new Error('Sin conexión'));
    fireEvent.click(screen.getByRole('button', { name: 'Refrescar' }));
    expect(screen.queryByText('Copa A')).not.toBeInTheDocument();
    expect(await screen.findByText('0 temporadas')).toBeInTheDocument();
    expect(await screen.findByText('Sin conexión')).toBeInTheDocument();
  });

  test('ignores an older response that arrives after a newer authorization result', async () => {
    let resolveOlder;
    let resolveNewer;
    const older = new Promise((resolve) => { resolveOlder = resolve; });
    const newer = new Promise((resolve) => { resolveNewer = resolve; });
    const api = service();
    render(
      <TorneosCompetitionProvider organizationId="org-a" service={api}>
        <Probe />
      </TorneosCompetitionProvider>,
    );
    await screen.findByText('Copa A');
    api.loadCompetitionContext
      .mockImplementationOnce(() => older)
      .mockImplementationOnce(() => newer);
    fireEvent.click(screen.getByRole('button', { name: 'Refrescar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Refrescar' }));
    resolveNewer(payload({
      preference: {
        organizationId: 'org-a',
        activeSeasonId: null,
        activeTournamentId: null,
      },
      seasons: [],
      tournaments: [],
    }));
    expect(await screen.findByText('0 temporadas')).toBeInTheDocument();
    resolveOlder(payload());
    await waitFor(() => {
      expect(screen.queryByText('Copa A')).not.toBeInTheDocument();
    });
  });

  test('generates idempotency on create and refreshes the authoritative snapshot', async () => {
    const api = service();
    render(
      <TorneosCompetitionProvider organizationId="org-a" service={api}>
        <Probe />
      </TorneosCompetitionProvider>,
    );
    await screen.findByText('Apertura');
    fireEvent.click(screen.getByRole('button', { name: 'Crear' }));
    await waitFor(() => {
      expect(api.createSeason).toHaveBeenCalledWith({
        organizationId: 'org-a',
        name: 'Nueva',
        idempotencyKey: 'request-key',
      });
      expect(api.loadCompetitionContext).toHaveBeenCalledTimes(2);
    });
  });
});
