import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import TorneosFeatureGate from '../features/torneos/TorneosFeatureGate';

jest.mock('../components/global-header/GlobalHeader', () => () => (
  <header data-testid="global-header" />
));

const MATCH_A = 'a4000000-0000-4000-8000-000000000001';
const MATCH_B = 'a4000000-0000-4000-8000-000000000002';

//
// Contrato de asistencia de Torneos.
//
// `respond_match_availability` no mira cargos: busca un
// `tournament_roster_players` cuyo `arma2_user_id` sea el que llama, en un
// plantel `approved`/`locked` de alguno de los dos equipos del partido, y si no
// lo encuentra tira TORNEOS_MATCH_FORBIDDEN. Es decir, responder "Voy / No voy"
// es contestar por uno mismo.
//
// Estos casos fijan que la pantalla diga lo mismo que el backend: la acción la
// habilita el vínculo deportivo con el plantel, nunca gobernar la organización
// ni dirigir el equipo.
//
const baseMatch = {
  teamName: 'Napoli',
  opponentName: 'Belgrano',
  isHome: true,
  scheduledAt: '2030-06-01T18:00:00.000Z',
  status: 'ready',
  venue: 'Club Horizonte',
  court: 'Cancha 1',
};

function createService(playerMatches) {
  return {
    loadContext: jest.fn().mockResolvedValue({
      preference: { workspaceType: 'personal', activeOrganizationId: null },
      organizations: [],
    }),
    setPreference: jest.fn().mockResolvedValue({ activeOrganizationId: null }),
    loadCompetitionContext: jest.fn().mockResolvedValue({}),
    setTournamentContext: jest.fn(),
    loadPlayerMatches: jest.fn().mockResolvedValue(playerMatches),
    respondMatchAvailability: jest.fn().mockResolvedValue({}),
    createIdempotencyKey: jest.fn(() => 'request-a'),
  };
}

function renderMisPartidos(service) {
  return render(
    <MemoryRouter initialEntries={['/torneos/mis-partidos']}>
      <Routes>
        <Route path="/torneos/*" element={<TorneosFeatureGate enabled service={service} />} />
      </Routes>
    </MemoryRouter>,
  );
}

const availabilityControls = () => screen.queryAllByRole('group', { name: 'Tu disponibilidad' });

describe('responder asistencia sale del vínculo deportivo, no del cargo', () => {
  test('el owner sin plantel llega al partido por dirigir, y no puede responder por el equipo', async () => {
    // Un owner que además figura como capitán ve el partido —esa es su
    // relación real con el equipo— pero no está en ningún plantel.
    const service = createService([{
      ...baseMatch,
      matchId: MATCH_A,
      isRosteredPlayer: false,
      isTeamManager: true,
      canManageSquad: true,
    }]);
    renderMisPartidos(service);
    expect(await screen.findByText('vs. Belgrano')).toBeInTheDocument();
    expect(availabilityControls()).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Voy' })).not.toBeInTheDocument();
    // Lo que sí le corresponde por dirigir sigue estando.
    expect(screen.getByRole('link', { name: 'Gestionar convocatoria' })).toBeInTheDocument();
  });

  test('el jugador del plantel responde por sí mismo', async () => {
    const service = createService([{
      ...baseMatch,
      matchId: MATCH_A,
      isRosteredPlayer: true,
      isTeamManager: false,
    }]);
    renderMisPartidos(service);
    expect(await screen.findByRole('button', { name: 'Voy' })).toBeInTheDocument();
    expect(availabilityControls()).toHaveLength(1);
  });

  test('quien dirige y además juega conserva la acción por ser jugador', async () => {
    // El caso "owner + delegado/jugador": no se bloquea la acción por tener
    // además un cargo; se conserva por la segunda relación.
    const service = createService([{
      ...baseMatch,
      matchId: MATCH_A,
      isRosteredPlayer: true,
      isTeamManager: true,
      canManageSquad: true,
    }]);
    renderMisPartidos(service);
    expect(await screen.findByRole('button', { name: 'Voy' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Gestionar convocatoria' })).toBeInTheDocument();
  });

  test('sobre dos partidos, sólo el del plantel propio ofrece el control', async () => {
    const service = createService([
      {
        ...baseMatch, matchId: MATCH_A, opponentName: 'Belgrano', isRosteredPlayer: true,
      },
      {
        ...baseMatch,
        matchId: MATCH_B,
        teamName: 'Otro Club',
        opponentName: 'Racing',
        isRosteredPlayer: false,
        isTeamManager: true,
      },
    ]);
    renderMisPartidos(service);
    expect(await screen.findByText('vs. Belgrano')).toBeInTheDocument();
    expect(screen.getByText('vs. Racing')).toBeInTheDocument();
    // Dos partidos en pantalla, un solo control de disponibilidad.
    await waitFor(() => expect(availabilityControls()).toHaveLength(1));
  });

  test('una fila sin relación declarada falla cerrada', async () => {
    // Ausencia de dato no es permiso: si nadie afirmó el vínculo, no hay acción.
    const service = createService([{ ...baseMatch, matchId: MATCH_A }]);
    renderMisPartidos(service);
    expect(await screen.findByText('vs. Belgrano')).toBeInTheDocument();
    expect(availabilityControls()).toHaveLength(0);
  });
});
