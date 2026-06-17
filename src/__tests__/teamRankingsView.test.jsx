import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import TeamRankingsView from '../features/equipos/views/TeamRankingsView';
import { getTeamChallengeRankings, searchChallengeableTeams } from '../services/db/teamRankings';

jest.mock('../services/db/teamRankings', () => ({
  getTeamChallengeRankings: jest.fn(),
  searchChallengeableTeams: jest.fn(),
}));

jest.mock('../utils/notifyBlockingError', () => ({
  notifyBlockingError: jest.fn(),
}));

// Avoid pulling Google Places / window.google into the test.
jest.mock('../features/equipos/components/NeighborhoodAutocomplete', () => ({
  __esModule: true,
  default: ({ value, onChange, placeholder }) => (
    <input
      aria-label="zone-filter"
      placeholder={placeholder}
      value={value || ''}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

const rankingRows = [
  {
    team_id: 'own-team',
    team_name: 'Mi Equipo',
    avatar_url: null,
    format: 5,
    zone: 'Villa Devoto',
    played_count: 12,
    wins: 8,
    draws: 2,
    losses: 2,
    win_rate: 67,
  },
  {
    team_id: 'rival-1',
    team_name: 'Fulbo',
    avatar_url: 'https://cdn.example.com/fulbo.png',
    format: 7,
    zone: null,
    played_count: 9,
    wins: 5,
    draws: 1,
    losses: 3,
    win_rate: 56,
  },
];

const directoryRows = [
  {
    team_id: 'rival-1',
    team_name: 'Fulbo',
    avatar_url: 'https://cdn.example.com/fulbo.png',
    format: 7,
    zone: 'GBA Norte',
    played_count: 9,
    wins: 5,
    draws: 1,
    losses: 3,
    win_rate: 56,
  },
  {
    team_id: 'newbie',
    team_name: 'Nuevo FC',
    avatar_url: null,
    format: 5,
    zone: null,
    played_count: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    win_rate: 0,
  },
];

const renderView = (props = {}) => render(
  <TeamRankingsView
    userId="user-1"
    ownTeamIds={new Set(['own-team'])}
    onPublishChallenge={jest.fn()}
    {...props}
  />,
);

beforeEach(() => {
  jest.clearAllMocks();
  getTeamChallengeRankings.mockResolvedValue(rankingRows);
  searchChallengeableTeams.mockResolvedValue(directoryRows);
});

describe('TeamRankingsView', () => {
  // Tests 11-14: escudo/fallback, format, zone, name and stats render.
  test('renders ranking cards with name, format, zone and stats', async () => {
    renderView();

    await waitFor(() => expect(screen.getByText('Mi Equipo')).toBeInTheDocument());
    expect(screen.getByText('Fulbo')).toBeInTheDocument();

    // zone present + "Zona no definida" fallback (Test 10)
    expect(screen.getByText('Villa Devoto')).toBeInTheDocument();
    expect(screen.getByText('Zona no definida')).toBeInTheDocument();

    // format badge (Test 12)
    expect(screen.getAllByText('F7').length).toBeGreaterThan(0);

    // crest image for a team with avatar, initials fallback otherwise (Test 11)
    expect(screen.getByAltText('Escudo Fulbo')).toBeInTheDocument();
    expect(screen.getByText('ME')).toBeInTheDocument();

    // win rate computed from confirmed stats
    expect(screen.getByText('67%')).toBeInTheDocument();
    expect(screen.getByText('56%')).toBeInTheDocument();
  });

  // Tests 15-17: cannot challenge own team; can publish for a rival.
  test('blocks own team and publishes for a rival', async () => {
    const onPublishChallenge = jest.fn();
    renderView({ onPublishChallenge });

    await waitFor(() => expect(screen.getByText('Mi Equipo')).toBeInTheDocument());

    // own team -> disabled "Tu equipo", never a publish CTA
    const ownCta = screen.getByRole('button', { name: 'Tu equipo' });
    expect(ownCta).toBeDisabled();

    // rival -> honest "Publicar desafío" CTA that triggers the publish flow
    const publishButtons = screen.getAllByRole('button', { name: 'Publicar desafío' });
    expect(publishButtons.length).toBe(1);
    fireEvent.click(publishButtons[0]);
    expect(onPublishChallenge).toHaveBeenCalledWith(expect.objectContaining({ team_id: 'rival-1' }));

    // copy never implies a direct challenge to that specific rival
    expect(screen.queryByText(/Desafiar a Fulbo/i)).not.toBeInTheDocument();
  });

  test('shows the empty state when there are no confirmed matches (ranking)', async () => {
    getTeamChallengeRankings.mockResolvedValue([]);
    renderView();

    await waitFor(() => expect(
      screen.getByText('No hay partidos confirmados todavía'),
    ).toBeInTheDocument());
  });

  // Directory tab: teams without confirmed results still appear.
  test('directory shows "Sin partidos confirmados" for teams with no results', async () => {
    renderView();
    await waitFor(() => expect(screen.getByText('Mi Equipo')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'EQUIPOS' }));

    await waitFor(() => expect(screen.getByText('Nuevo FC')).toBeInTheDocument());
    expect(screen.getByText('Sin partidos confirmados')).toBeInTheDocument();
    expect(searchChallengeableTeams).toHaveBeenCalled();
  });
});
