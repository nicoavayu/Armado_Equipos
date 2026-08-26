import React from 'react';
import {
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import CompetitionCenterPage from '../features/torneos/components/CompetitionCenterPage';

let mockOrganization;
let mockFixture;
let mockService;

jest.mock('../features/torneos/context/TorneosWorkspaceContext', () => ({
  useTorneosWorkspace: () => ({ service: mockService }),
}));
jest.mock('../features/torneos/context/TorneosCompetitionContext', () => ({
  useTorneosCompetition: () => ({
    activeTournament: { id: 'tournament', name: 'Copa Metropolitana' },
  }),
}));
jest.mock('../features/torneos/context/TorneosFixtureContext', () => ({
  useTorneosFixture: () => mockFixture,
}));
jest.mock('../features/torneos/components/CompetitionSelector', () => () => (
  <div>Temporada 2026</div>
));
jest.mock('react-router-dom', () => {
  const actual = jest.requireActual('react-router-dom');
  return {
    ...actual,
    useOutletContext: () => ({ organization: mockOrganization }),
  };
});

const row = {
  position: 1,
  participantId: 'participant',
  teamEntryId: 'entry',
  teamName: 'Club Atlético de Nombre Extraordinariamente Largo',
  shortName: 'CAL',
  shieldPath: '11111111-1111-4111-8111-111111111111/teams/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333.png',
  played: 4,
  won: 3,
  drawn: 1,
  lost: 0,
  goalsFor: 12,
  goalsAgainst: 3,
  goalDifference: 9,
  points: 10,
  pointsAdjustment: 0,
  classificationStatus: 'qualified',
  tiebreakTrace: { points: 10, goal_difference: 9 },
};

function renderCenter(mode = 'table') {
  return render(
    <MemoryRouter>
      <CompetitionCenterPage mode={mode} />
    </MemoryRouter>,
  );
}

describe('CompetitionCenterPage', () => {
  beforeEach(() => {
    mockOrganization = {
      id: 'org',
      capabilities: [
        'standings.read',
        'standings.rebuild',
        'standings.publish',
        'statistics.read',
        'qualification.read',
        'qualification.resolve',
        'discipline.read',
      ],
    };
    mockFixture = {
      status: 'ready',
      error: '',
      refresh: jest.fn(),
      versions: [{ id: 'fixture', status: 'published' }],
      phases: [{ id: 'phase', fixtureVersionId: 'fixture', name: 'Fase regular' }],
      groups: [],
      categories: [{ id: 'category', name: 'Libre' }],
      categoryId: 'category',
      activeCategory: { id: 'category', name: 'Libre' },
      setCategoryId: jest.fn(),
    };
    mockService = {
      loadStandings: jest.fn().mockResolvedValue({
        revision: null,
        standings: [],
      }),
      loadStatistics: jest.fn().mockResolvedValue({
        players: [],
        teams: [],
        discipline: [],
      }),
      rebuildStandings: jest.fn().mockResolvedValue('revision'),
      publishStandings: jest.fn().mockResolvedValue('revision'),
      resolveQualification: jest.fn().mockResolvedValue({ resolved: 0, blocked: 0 }),
    };
  });

  test('explains an empty table and sends the complete scope', async () => {
    renderCenter();
    expect(await screen.findByRole('heading', { name: 'Todavía no hay tabla' })).toBeInTheDocument();
    expect(mockService.loadStandings).toHaveBeenCalledWith({
      organizationId: 'org',
      tournamentId: 'tournament',
      categoryId: 'category',
      phaseId: 'phase',
      groupId: null,
    });
  });

  test('renders the official table with an expandable explanation', async () => {
    mockService.loadStandings.mockResolvedValue({
      revision: { id: 'revision', number: 3, status: 'published' },
      standings: [row],
    });
    const view = renderCenter();
    expect(await screen.findByText(row.teamName)).toBeInTheDocument();
    expect(view.container.querySelector('.teamMark img')).toHaveAttribute(
      'src',
      expect.stringContaining(row.shieldPath),
    );
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('Ver detalle')).toBeInTheDocument();
    expect(screen.getByText(/Criterios aplicados/)).toBeInTheDocument();
  });

  test('keeps collaborator in published read-only mode', async () => {
    mockOrganization = {
      id: 'org',
      capabilities: ['standings.read', 'statistics.read', 'discipline.read'],
    };
    renderCenter();
    expect(await screen.findByText(/Vista de sólo lectura/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Recalcular/ })).not.toBeInTheDocument();
  });

  test('requires a reason before rebuilding and reloads authoritative data', async () => {
    renderCenter();
    await screen.findByRole('heading', { name: 'Todavía no hay tabla' });
    await userEvent.click(screen.getByRole('button', { name: /Recalcular/ }));
    const confirm = screen.getByRole('button', { name: 'Confirmar' });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Motivo'), 'Corrección oficial');
    await userEvent.click(confirm);
    await waitFor(() => expect(mockService.rebuildStandings).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org',
        tournamentId: 'tournament',
        categoryId: 'category',
        phaseId: 'phase',
        reason: 'Corrección oficial',
      }),
    ));
    await waitFor(() => expect(mockService.loadStandings).toHaveBeenCalledTimes(2));
  });

  test('keeps keyboard focus inside the action dialog and restores it on Escape', async () => {
    renderCenter();
    await screen.findByRole('heading', { name: 'Todavía no hay tabla' });
    const trigger = screen.getByRole('button', { name: /Recalcular/ });
    trigger.focus();
    await userEvent.click(trigger);

    const reason = screen.getByLabelText('Motivo');
    const cancel = screen.getByRole('button', { name: 'Cancelar' });
    expect(reason).toHaveFocus();

    cancel.focus();
    await userEvent.tab();
    expect(reason).toHaveFocus();

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  test('shows a compact statistical podium and explicit discipline', async () => {
    mockService.loadStatistics.mockResolvedValue({
      players: [{
        rosterPlayerId: 'player',
        name: 'Ada Gol',
        appearances: 4,
        goals: 7,
        assists: 2,
      }],
      teams: [],
      discipline: [{
        rosterPlayerId: 'player',
        name: 'Ada Gol',
        fairPlayPoints: 3,
        yellowCards: 1,
        directReds: 1,
        secondYellows: 0,
        suspensions: [{
          id: 'suspension',
          reason: 'Roja directa',
          servedMatches: 0,
          totalMatches: 1,
          status: 'active',
        }],
      }],
    });
    const { unmount } = renderCenter('statistics');
    expect(await screen.findByText('Ada Gol')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    unmount();
    renderCenter('discipline');
    expect(await screen.findByText('Roja directa')).toBeInTheDocument();
    expect(screen.getByText(/0\/1 fechas · Activa/)).toBeInTheDocument();
  });

  test('clears the previous category when the next request fails', async () => {
    mockService.loadStandings.mockResolvedValue({
      revision: { id: 'revision', number: 1, status: 'published' },
      standings: [row],
    });
    const view = renderCenter();
    expect(await screen.findByText(row.teamName)).toBeInTheDocument();

    mockService.loadStandings.mockRejectedValue(new Error('Sin conexión'));
    mockFixture = {
      ...mockFixture,
      categoryId: 'category-2',
      activeCategory: { id: 'category-2', name: 'Senior' },
      categories: [
        ...mockFixture.categories,
        { id: 'category-2', name: 'Senior' },
      ],
    };
    view.rerender(
      <MemoryRouter>
        <CompetitionCenterPage mode="table" />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('Sin conexión');
    expect(screen.queryByText(row.teamName)).not.toBeInTheDocument();
  });

  test('blocks automatic qualification while a manual tiebreak is pending', async () => {
    mockService.loadStandings.mockResolvedValue({
      revision: { id: 'revision', number: 1, status: 'published' },
      standings: [{ ...row, classificationStatus: 'manual_review' }],
    });
    renderCenter('qualification');
    expect(await screen.findByText(/requieren desempate manual/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Resolver fuentes/ })).toBeDisabled();
  });
});
