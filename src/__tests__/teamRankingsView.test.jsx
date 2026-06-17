import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
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
    {...props}
  />,
);

// Returns the team names in their current DOM (render) order.
const rankingOrder = () => {
  const me = screen.getByText('Mi Equipo');
  const fulbo = screen.getByText('Fulbo');
  const meFirst = me.compareDocumentPosition(fulbo) & Node.DOCUMENT_POSITION_FOLLOWING;
  return meFirst ? ['Mi Equipo', 'Fulbo'] : ['Fulbo', 'Mi Equipo'];
};

const rowFor = (name) => screen.getByText(name).closest('[role="row"]');
const header = (name) => screen.getByRole('columnheader', { name });

beforeEach(() => {
  jest.clearAllMocks();
  getTeamChallengeRankings.mockResolvedValue(rankingRows);
  searchChallengeableTeams.mockResolvedValue(directoryRows);
});

describe('TeamRankingsView — Ranking (tabla deportiva)', () => {
  // Tests 11-14 + 6: escudo/fallback, name, format, flag, zone and stats render.
  test('renders the ranking table with name, format, flag, zone and stats', async () => {
    renderView();

    await waitFor(() => expect(screen.getByText('Mi Equipo')).toBeInTheDocument());
    expect(screen.getByText('Fulbo')).toBeInTheDocument();

    // It is a real (aria) table, not a list of big cards.
    expect(screen.getByRole('table', { name: 'Ranking de equipos' })).toBeInTheDocument();

    // zone present + "Zona no definida" fallback (Test 10)
    expect(screen.getByText('Villa Devoto')).toBeInTheDocument();
    expect(screen.getByText('Zona no definida')).toBeInTheDocument();

    // country flag fallback (Test 6) — one per row
    expect(screen.getAllByText('🇦🇷').length).toBe(2);

    // crest image for a team with avatar, initials fallback otherwise (Test 11)
    expect(screen.getByAltText('Escudo Fulbo')).toBeInTheDocument();
    expect(screen.getByText('ME')).toBeInTheDocument();

    // per-row format + PJ/G/E/P/% cells (scoped so the format <select> options
    // and the other row do not collide).
    const me = rowFor('Mi Equipo');
    expect(within(me).getByText('F5')).toBeInTheDocument();
    expect(within(me).getByText('12')).toBeInTheDocument(); // PJ
    expect(within(me).getByText('8')).toBeInTheDocument(); // G
    expect(within(me).getAllByText('2')).toHaveLength(2); // E + P
    expect(within(me).getByText('67')).toBeInTheDocument(); // %

    const fulbo = rowFor('Fulbo');
    expect(within(fulbo).getByText('F7')).toBeInTheDocument();
    expect(within(fulbo).getByText('56')).toBeInTheDocument();
  });

  // Test 3: the big "Más jugaron" / "Más ganaron" buttons are gone.
  test('does not render the "Más jugaron" / "Más ganaron" buttons', async () => {
    renderView();
    await waitFor(() => expect(screen.getByText('Mi Equipo')).toBeInTheDocument());

    expect(screen.queryByText('Más jugaron')).not.toBeInTheDocument();
    expect(screen.queryByText('Más ganaron')).not.toBeInTheDocument();
  });

  // Test 4: the column headers ARE the sort controls, with asc/desc toggle and a
  // clear active-direction indicator (aria-sort).
  test('sorting by Equipo (name) toggles asc <-> desc', async () => {
    renderView();
    await waitFor(() => expect(screen.getByText('Mi Equipo')).toBeInTheDocument());

    // Default order is "más jugaron" (PJ desc): Mi Equipo (12) before Fulbo (9).
    expect(rankingOrder()).toEqual(['Mi Equipo', 'Fulbo']);
    expect(header('PJ')).toHaveAttribute('aria-sort', 'descending');

    // First tap on Equipo -> ascending (A→Z): Fulbo before Mi Equipo.
    fireEvent.click(header('Equipo'));
    expect(header('Equipo')).toHaveAttribute('aria-sort', 'ascending');
    expect(rankingOrder()).toEqual(['Fulbo', 'Mi Equipo']);

    // Second tap on the same column flips to descending.
    fireEvent.click(header('Equipo'));
    expect(header('Equipo')).toHaveAttribute('aria-sort', 'descending');
    expect(rankingOrder()).toEqual(['Mi Equipo', 'Fulbo']);
  });

  // Test: header F sorts by format, asc then desc.
  test('sorting by F orders by format and toggles direction', async () => {
    renderView();
    await waitFor(() => expect(screen.getByText('Mi Equipo')).toBeInTheDocument());

    // F asc (F5 -> F7): Mi Equipo (F5) before Fulbo (F7).
    fireEvent.click(header('F'));
    expect(header('F')).toHaveAttribute('aria-sort', 'ascending');
    expect(rankingOrder()).toEqual(['Mi Equipo', 'Fulbo']);

    // F desc: Fulbo (F7) first.
    fireEvent.click(header('F'));
    expect(header('F')).toHaveAttribute('aria-sort', 'descending');
    expect(rankingOrder()).toEqual(['Fulbo', 'Mi Equipo']);
  });

  // Test: header % sorts by win rate, desc by default then asc.
  test('sorting by % orders by win rate and toggles direction', async () => {
    renderView();
    await waitFor(() => expect(screen.getByText('Mi Equipo')).toBeInTheDocument());

    // % desc (default for stats): Mi Equipo (67) before Fulbo (56).
    fireEvent.click(header('%'));
    expect(header('%')).toHaveAttribute('aria-sort', 'descending');
    expect(rankingOrder()).toEqual(['Mi Equipo', 'Fulbo']);

    // % asc: Fulbo (56) first.
    fireEvent.click(header('%'));
    expect(header('%')).toHaveAttribute('aria-sort', 'ascending');
    expect(rankingOrder()).toEqual(['Fulbo', 'Mi Equipo']);
  });

  // Test 7: no "Publicar desafío" CTA in Ranking; own team is a compact badge,
  // not a big button.
  test('no "Publicar desafío" CTA; own team shown as a badge', async () => {
    renderView();
    await waitFor(() => expect(screen.getByText('Mi Equipo')).toBeInTheDocument());

    expect(screen.queryByText('Publicar desafío')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Publicar desafío' })).not.toBeInTheDocument();

    // "Tu equipo" appears for the own team, and it is not a button.
    expect(screen.getByText('Tu equipo')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tu equipo' })).not.toBeInTheDocument();
  });

  // Compact ranking toolbar: zona + período live behind a "Filtros" panel.
  test('ranking secondary filters live behind the "Filtros" panel', async () => {
    renderView();
    await waitFor(() => expect(screen.getByText('Mi Equipo')).toBeInTheDocument());

    expect(screen.queryByLabelText('zone-filter')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Últimos 90 días' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Filtros/ }));

    expect(screen.getByLabelText('zone-filter')).toBeInTheDocument();
    const period90 = screen.getByRole('button', { name: 'Últimos 90 días' });
    expect(period90).toBeInTheDocument();

    getTeamChallengeRankings.mockClear();
    fireEvent.click(period90);

    await waitFor(() => expect(getTeamChallengeRankings).toHaveBeenCalledWith(
      expect.objectContaining({ period: '90d' }),
    ));
  });

  test('shows the empty state when there are no confirmed matches (ranking)', async () => {
    getTeamChallengeRankings.mockResolvedValue([]);
    renderView();

    await waitFor(() => expect(
      screen.getByText('No hay partidos confirmados todavía'),
    ).toBeInTheDocument());
  });
});

describe('TeamRankingsView — Equipos (directorio)', () => {
  // Tests 8/9: exploratory cards, flag/zone, no premature CTA.
  test('directory shows visual cards with flag/zone and no "Publicar desafío" CTA', async () => {
    renderView();
    await waitFor(() => expect(screen.getByText('Mi Equipo')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'EQUIPOS' }));

    await waitFor(() => expect(screen.getByText('Nuevo FC')).toBeInTheDocument());
    expect(screen.getByText('Sin partidos confirmados')).toBeInTheDocument();
    expect(searchChallengeableTeams).toHaveBeenCalled();

    // country flag rendered in the directory cards too
    expect(screen.getAllByText('🇦🇷').length).toBeGreaterThan(0);

    // the premature publish CTA is gone from the directory as well
    expect(screen.queryByText('Publicar desafío')).not.toBeInTheDocument();
  });
});
