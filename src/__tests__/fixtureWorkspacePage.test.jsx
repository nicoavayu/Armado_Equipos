import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import FixtureWorkspacePage from '../features/torneos/components/FixtureWorkspacePage';
import { getCapabilitiesForRole } from '../features/torneos/domain/capabilities';

const mockOrganization = {
  id: 'org-a',
  role: 'owner',
  capabilities: getCapabilitiesForRole('owner'),
};

const mockFixtureState = {
  status: 'ready',
  error: '',
  notice: '',
  categoryId: 'category-a',
  activeCategory: { id: 'category-a', name: 'Primera' },
  categories: [{ id: 'category-a', name: 'Primera', status: 'active' }],
  setCategoryId: jest.fn(),
  participantSet: {
    id: 'set-a',
    status: 'frozen',
    versionNumber: 1,
  },
  eligibleEntries: [],
  participants: [
    { id: 'participant-a', name: 'Armas FC', status: 'active' },
    { id: 'participant-b', name: 'Barrio Norte', status: 'active' },
  ],
  pots: [],
  groups: [],
  versions: [{
    id: 'version-a',
    versionNumber: 1,
    status: 'published',
    generationMethod: 'automatic',
    matchCount: 1,
    scheduledCount: 0,
  }],
  phases: [{ id: 'phase-a', fixtureVersionId: 'version-a', phaseType: 'league' }],
  rounds: [{
    id: 'round-a',
    fixtureVersionId: 'version-a',
    phaseId: 'phase-a',
    name: 'Fecha 1',
    roundNumber: 1,
    status: 'draft',
  }],
  matches: [{
    id: 'match-a',
    fixtureVersionId: 'version-a',
    roundId: 'round-a',
    matchNumber: 1,
    homeParticipantId: 'participant-a',
    awayParticipantId: 'participant-b',
    status: 'unscheduled',
    sources: [],
  }],
  venues: [{
    id: 'venue-a',
    name: 'Complejo Central',
    address: 'Av. Central 100',
    status: 'active',
  }],
  courts: [{
    id: 'court-a',
    venueId: 'venue-a',
    name: 'Cancha 1',
    status: 'active',
  }],
  windows: [],
  reschedules: [],
  refresh: jest.fn(),
  actions: {
    freeze: jest.fn(),
    reopen: jest.fn(),
    savePots: jest.fn(),
    draw: jest.fn(),
    generate: jest.fn(),
    createManual: jest.fn(),
    publish: jest.fn(),
    supersede: jest.fn(),
    createVenue: jest.fn(),
    createCourt: jest.fn(),
    saveWindows: jest.fn(),
    schedule: jest.fn(),
    validateSchedule: jest.fn(),
    reschedule: jest.fn(),
    autoSchedule: jest.fn(),
  },
};

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useOutletContext: () => ({ organization: mockOrganization }),
}));

jest.mock('../features/torneos/context/TorneosCompetitionContext', () => ({
  useTorneosCompetition: () => ({
    activeTournament: {
      id: 'tournament-a',
      name: 'Copa Apertura',
      competitionFormat: 'league',
      sportModality: 'football_5',
    },
  }),
}));

jest.mock('../features/torneos/context/TorneosFixtureContext', () => ({
  useTorneosFixture: () => mockFixtureState,
}));

jest.mock('../features/torneos/components/CompetitionSelector', () => (
  function CompetitionSelectorMock() {
    return <div>Temporada Apertura</div>;
  }
));

describe('FixtureWorkspacePage', () => {
  test('renders persisted version metrics and the complete workflow navigation', () => {
    render(
      <MemoryRouter>
        <FixtureWorkspacePage mode="overview" />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Fixture' })).toBeInTheDocument();
    expect(screen.getAllByText('v1')).toHaveLength(2);
    expect(screen.getByText('1 partidos · 0 programados')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Flujo de fixture' }))
      .toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Programación' })).toHaveAttribute(
      'href',
      '/torneos/organizacion/org-a/programacion',
    );
  });

  test('offers a keyboard-accessible schedule form backed by persisted resources', () => {
    render(
      <MemoryRouter>
        <FixtureWorkspacePage mode="schedule" />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Programación' })).toBeInTheDocument();
    expect(screen.getByLabelText('Partido')).toBeRequired();
    expect(screen.getByLabelText('Fecha y hora')).toHaveAttribute('type', 'datetime-local');
    expect(screen.getByLabelText('Sede')).toBeRequired();
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeInTheDocument();
  });

  test('keeps venue, court, and scheduling-window creation in one resource surface', () => {
    render(
      <MemoryRouter>
        <FixtureWorkspacePage mode="venues" />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Nueva sede' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Nueva cancha' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ventana semanal' })).toBeInTheDocument();
    expect(screen.getByLabelText('Minutos por turno')).toHaveAttribute('min', '15');
  });
});
