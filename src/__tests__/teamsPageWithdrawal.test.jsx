import React from 'react';
import { render, screen } from '@testing-library/react';
import {
  MemoryRouter,
  Outlet,
  Route,
  Routes,
} from 'react-router-dom';
import TeamsPage from '../features/torneos/components/TeamsPage';
import { TOURNAMENT_ROLES } from '../features/torneos/domain/capabilities';

const mockState = {
  organization: { id: 'org-a', role: TOURNAMENT_ROLES.OWNER },
  tournament: { id: 'tournament-a', status: 'active' },
};

jest.mock('../features/torneos/context/TorneosCompetitionContext', () => {
  // Identidad estable: si el contexto devolviera un objeto nuevo por render,
  // los efectos de la página se reengancharían en bucle.
  const competition = {
    activeTournament: null,
    status: 'ready',
    error: '',
    refresh: jest.fn(),
    withdrawCompetitionParticipant: jest.fn(),
  };
  return {
    __competition: competition,
    useTorneosCompetition: () => competition,
  };
});

jest.mock('../features/torneos/context/TorneosWorkspaceContext', () => {
  const workspace = {
    service: {
      loadTeamsContext: () => Promise.resolve({
        entries: [
          {
            id: 'entry-a',
            name: 'Estrella del Sur',
            categoryName: 'Primera',
            status: 'approved',
            linked: false,
            roster: { playerCount: 12 },
            manager: { displayName: 'Ana' },
          },
          {
            id: 'entry-b',
            name: 'Ferroviarios Unidos',
            categoryName: 'Primera',
            status: 'withdrawn',
            linked: false,
            roster: { playerCount: 11 },
            manager: { displayName: 'Beto' },
          },
        ],
        settings: { minimumPlayers: 10 },
      }),
    },
  };
  return { useTorneosWorkspace: () => workspace };
});

jest.mock('../features/torneos/components/CompetitionSelector', () => () => null);

function OrganizationOutlet() {
  return <Outlet context={{ organization: mockState.organization }} />;
}

const renderTeams = () => render(
  <MemoryRouter initialEntries={['/equipos']}>
    <Routes>
      <Route element={<OrganizationOutlet />}>
        <Route path="/equipos" element={<TeamsPage />} />
      </Route>
    </Routes>
  </MemoryRouter>,
);

describe('retiro de equipo desde Equipos', () => {
  // eslint-disable-next-line global-require
  const competitionContext = require('../features/torneos/context/TorneosCompetitionContext');

  const useTournament = (status) => {
    mockState.tournament = { id: 'tournament-a', status };
    competitionContext.__competition.activeTournament = mockState.tournament;
  };

  beforeEach(() => {
    mockState.organization = { id: 'org-a', role: TOURNAMENT_ROLES.OWNER };
    useTournament('active');
  });

  test('el propietario puede retirar un equipo aprobado con la competencia en juego', async () => {
    renderTeams();
    expect(await screen.findByRole('button', { name: /retirar equipo/i })).toBeInTheDocument();
  });

  test('el equipo retirado sigue en la lista con su marca', async () => {
    renderTeams();
    expect(await screen.findByText('Ferroviarios Unidos')).toBeInTheDocument();
    expect(screen.getByText('Retirado')).toBeInTheDocument();
  });

  test('sólo se ofrece el retiro sobre inscripciones vigentes', async () => {
    renderTeams();
    await screen.findByText('Estrella del Sur');
    // Sólo la entrada aprobada ofrece el retiro; la ya retirada no se repite.
    expect(screen.getAllByRole('button', { name: /retirar equipo/i })).toHaveLength(1);
  });

  test('no aparece durante la etapa de inscripción', async () => {
    useTournament('registration');
    renderTeams();
    await screen.findByText('Estrella del Sur');
    expect(screen.queryByRole('button', { name: /retirar equipo/i })).not.toBeInTheDocument();
  });

  test('no aparece con la competencia finalizada', async () => {
    useTournament('completed');
    renderTeams();
    await screen.findByText('Estrella del Sur');
    expect(screen.queryByRole('button', { name: /retirar equipo/i })).not.toBeInTheDocument();
  });

  test('el colaborador no puede retirar equipos', async () => {
    mockState.organization = { id: 'org-a', role: TOURNAMENT_ROLES.COLLABORATOR };
    renderTeams();
    await screen.findByText('Estrella del Sur');
    expect(screen.queryByRole('button', { name: /retirar equipo/i })).not.toBeInTheDocument();
  });

  test('explica que un equipo puede retirarse y que no se reemplaza', async () => {
    renderTeams();
    expect(await screen.findByText(/no se puede incorporar otro equipo en su lugar/i))
      .toBeInTheDocument();
  });
});
