import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import TorneosFeatureGate from '../features/torneos/TorneosFeatureGate';
import { DisciplinePanel } from '../features/torneos/components/CompetitionCenterPage';

jest.mock('../components/global-header/GlobalHeader', () => () => (
  <header data-testid="global-header" />
));

const match = (index, overrides = {}) => ({
  matchId: `a4000000-0000-4000-8000-00000000000${index}`,
  teamName: 'Napoli',
  opponentName: `Rival ${index}`,
  isHome: true,
  scheduledAt: null,
  status: 'scheduled',
  venue: null,
  court: null,
  availability: null,
  ...overrides,
});

function renderMyMatches(playerMatches) {
  const service = {
    loadContext: jest.fn().mockResolvedValue({
      preference: { workspaceType: 'personal', activeOrganizationId: null },
      organizations: [],
    }),
    setPreference: jest.fn().mockResolvedValue({ activeOrganizationId: null }),
    loadCompetitionContext: jest.fn().mockResolvedValue({}),
    setTournamentContext: jest.fn(),
    loadPlayerMatches: jest.fn().mockResolvedValue(playerMatches),
    respondMatchAvailability: jest.fn(),
    createIdempotencyKey: jest.fn(() => 'request-a'),
  };
  return render(
    <MemoryRouter initialEntries={['/torneos/mis-partidos']}>
      <Routes>
        <Route path="/torneos/*" element={<TorneosFeatureGate enabled service={service} />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Mis partidos: lo que falta jugar primero, la historia plegada', () => {
  test('los próximos van ordenados por fecha (sin fecha al final) y los jugados quedan en "Jugados"', async () => {
    renderMyMatches([
      match(1, { opponentName: 'Sin fecha' }),
      match(2, { opponentName: 'Jugado viejo', scheduledAt: '2030-05-01T18:00:00.000Z', officialScore: { home: 1, away: 0 } }),
      match(3, { opponentName: 'Pronto', scheduledAt: '2030-06-01T18:00:00.000Z' }),
      match(4, { opponentName: 'Más tarde', scheduledAt: '2030-06-08T18:00:00.000Z' }),
      match(5, { opponentName: 'Jugado reciente', scheduledAt: '2030-05-20T18:00:00.000Z', officialScore: { home: 2, away: 2 } }),
    ]);
    const upcoming = await screen.findByRole('region', { name: /Por jugar/ });
    expect(within(upcoming).getAllByRole('heading', { level: 3 }).map((h) => h.textContent))
      .toEqual(['vs. Pronto', 'vs. Más tarde', 'vs. Sin fecha']);
    const played = screen.getByText('Jugados').closest('details');
    expect(played).not.toHaveAttribute('open');
    expect(within(played).getByText('2 partidos con resultado oficial')).toBeInTheDocument();
    expect(within(played).getAllByRole('heading', { level: 3 }).map((h) => h.textContent))
      .toEqual(['vs. Jugado reciente', 'vs. Jugado viejo']);
  });

  test('la misma persona vinculada a los dos lados de un partido ve las dos tarjetas', async () => {
    const shared = 'a4000000-0000-4000-8000-000000000009';
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
    renderMyMatches([
      match(9, { matchId: shared, teamName: 'Napoli', opponentName: 'Belgrano', isHome: true }),
      match(9, { matchId: shared, teamName: 'Belgrano', opponentName: 'Napoli', isHome: false }),
    ]);
    expect(await screen.findByText('vs. Belgrano')).toBeInTheDocument();
    expect(screen.getByText('vs. Napoli')).toBeInTheDocument();
    expect(errors.mock.calls.flat().join(' ')).not.toMatch(/same key/);
    errors.mockRestore();
  });

  test('sin partidos por jugar lo dice, y deja los jugados a mano', async () => {
    renderMyMatches([
      match(1, { scheduledAt: '2030-05-01T18:00:00.000Z', officialScore: { home: 1, away: 0 } }),
    ]);
    expect(await screen.findByText(/No te quedan partidos por jugar/)).toBeInTheDocument();
    expect(screen.getByText('1 partido con resultado oficial')).toBeInTheDocument();
  });
});

describe('Disciplina: primero quien tiene tarjetas o sanciones', () => {
  const player = (index, overrides = {}) => ({
    rosterPlayerId: `player-${index}`,
    name: `Jugador ${index}`,
    fairPlayPoints: 0,
    yellowCards: 0,
    directReds: 0,
    secondYellows: 0,
    suspensions: [],
    ...overrides,
  });

  test('los jugadores sin tarjetas son una línea plegada, no una tarjeta cada uno', () => {
    render(<DisciplinePanel rows={[
      player(1, { fairPlayPoints: 5, yellowCards: 5, suspensions: [{ id: 's1', reason: 'Cinco amarillas', servedMatches: 1, totalMatches: 1, status: 'served' }] }),
      player(2, { fairPlayPoints: 1, yellowCards: 1 }),
      player(3), player(4), player(5),
    ]} />);
    expect(screen.getByText('Jugador 1')).toBeInTheDocument();
    expect(screen.getByText('Jugador 2')).toBeInTheDocument();
    const clean = screen.getByText('3 jugadores sin tarjetas').closest('details');
    expect(clean).not.toHaveAttribute('open');
    expect(within(clean).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Jugador 3', 'Jugador 4', 'Jugador 5']);
    expect(screen.getAllByText('Sin suspensión activa.')).toHaveLength(1);
  });

  test('si nadie tiene tarjetas lo dice, y la lista sigue disponible', () => {
    render(<DisciplinePanel rows={[player(1), player(2)]} />);
    expect(screen.getByText('Sin tarjetas ni sanciones')).toBeInTheDocument();
    expect(screen.getByText('2 jugadores sin tarjetas')).toBeInTheDocument();
  });
});
