import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import TeamRankingsView from '../features/equipos/views/TeamRankingsView';
import { getTeamChallengeRankings, searchChallengeableTeams } from '../services/db/teamRankings';

jest.mock('../services/db/teamRankings', () => ({
  getTeamChallengeRankings: jest.fn(),
  searchChallengeableTeams: jest.fn(),
  TEAM_RANKING_LIMIT: 20,
  TEAM_DIRECTORY_PAGE_SIZE: 20,
}));

jest.mock('../services/db/teamChallenges', () => ({
  createDirectedChallenge: jest.fn().mockResolvedValue({}),
  listMyPendingChallengedTeamIds: jest.fn().mockResolvedValue([]),
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

const makeTeamRows = (prefix, count, format = 5) => Array.from({ length: count }, (_, index) => ({
  team_id: `${prefix}-${index + 1}`,
  team_name: `${prefix} ${String(index + 1).padStart(2, '0')}`,
  avatar_url: null,
  format,
  zone: 'CABA',
  country_code: 'AR',
  played_count: count - index,
  wins: Math.max(0, count - index - 2),
  draws: 1,
  losses: 1,
  win_rate: 50,
}));

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
  test('shows at most the global top 20 and never renders Cargar más', async () => {
    getTeamChallengeRankings.mockResolvedValue(makeTeamRows('Global', 25));
    renderView();

    await waitFor(() => expect(screen.getByText('Global 01')).toBeInTheDocument());
    const table = screen.getByRole('table', { name: 'Ranking de equipos' });
    expect(within(table).getAllByRole('row')).toHaveLength(21); // header + 20 teams
    expect(screen.getByText('Global 20')).toBeInTheDocument();
    expect(screen.queryByText('Global 21')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cargar más' })).not.toBeInTheDocument();
    expect(getTeamChallengeRankings).toHaveBeenCalledWith(
      expect.objectContaining({ format: '', limit: 20 }),
    );
  });

  test('format filter fetches and shows at most the top 20 for that format', async () => {
    const rows = [
      ...makeTeamRows('Cinco', 25, 5),
      ...makeTeamRows('Ocho', 25, 8),
    ];
    getTeamChallengeRankings.mockImplementation(({ format, limit }) => Promise.resolve(
      rows
        .filter((team) => !format || String(team.format) === String(format))
        .slice(0, limit),
    ));
    renderView();
    await waitFor(() => expect(screen.getByText('Cinco 01')).toBeInTheDocument());

    const formatOption = screen.getByRole('option', { name: 'F8' });
    fireEvent.change(formatOption.closest('select'), { target: { value: '8' } });

    await waitFor(() => expect(screen.getByText('Ocho 01')).toBeInTheDocument());
    const table = screen.getByRole('table', { name: 'Ranking de equipos' });
    expect(within(table).getAllByRole('row')).toHaveLength(21);
    expect(screen.getByText('Ocho 20')).toBeInTheDocument();
    expect(screen.queryByText('Ocho 21')).not.toBeInTheDocument();
    expect(getTeamChallengeRankings).toHaveBeenCalledWith(
      expect.objectContaining({ format: '8', limit: 20 }),
    );
  });

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

    // per-row format + G/E/P/% cells (scoped so the format <select> options
    // and the other row do not collide). PJ is intentionally not a column.
    const me = rowFor('Mi Equipo');
    expect(within(me).getByText('F5')).toBeInTheDocument();
    expect(within(me).getByText('8')).toBeInTheDocument(); // G
    expect(within(me).getAllByText('2')).toHaveLength(2); // E + P
    expect(within(me).getByText('67')).toBeInTheDocument(); // %
    expect(within(me).queryByText('12')).not.toBeInTheDocument(); // PJ removed

    const fulbo = rowFor('Fulbo');
    expect(within(fulbo).getByText('F7')).toBeInTheDocument();
    expect(within(fulbo).getByText('56')).toBeInTheDocument();
  });

  // The PJ (partidos jugados) column/sort is intentionally removed: G/E/P/%
  // already convey it and dropping it gives the team name more room.
  test('does not render the PJ column/sort but keeps F, G, E, P and %', async () => {
    renderView();
    await waitFor(() => expect(screen.getByText('Mi Equipo')).toBeInTheDocument());

    expect(screen.queryByRole('columnheader', { name: 'PJ' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Partidos jugados' })).not.toBeInTheDocument();

    ['F', 'G', 'E', 'P', '%'].forEach((label) => {
      expect(header(label)).toBeInTheDocument();
    });
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

    // Default order is "más jugaron" (played desc, kept internally): Mi Equipo
    // (12) before Fulbo (9). PJ is no longer a visible/sortable column.
    expect(rankingOrder()).toEqual(['Mi Equipo', 'Fulbo']);

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

  // Test 7: no "Publicar desafío" CTA in Ranking; "my team" is communicated by
  // the row, not by a visible badge that competes with the name.
  test('no "Publicar desafío" CTA; own team flagged for a11y, not as a button', async () => {
    renderView();
    await waitFor(() => expect(screen.getByText('Mi Equipo')).toBeInTheDocument());

    expect(screen.queryByText('Publicar desafío')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Publicar desafío' })).not.toBeInTheDocument();

    // "Tu equipo" is present for the own team (screen-reader label), not a button.
    expect(screen.getByText('Tu equipo')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tu equipo' })).not.toBeInTheDocument();
  });

  // Test 1/3: the own-team row is highlighted as a whole (data-own-team) and the
  // team name is never covered by a visible badge inside its cell.
  test('own-team row is highlighted and its name is not covered by a badge', async () => {
    renderView();
    await waitFor(() => expect(screen.getByText('Mi Equipo')).toBeInTheDocument());

    const me = rowFor('Mi Equipo');
    const fulbo = rowFor('Fulbo');
    expect(me).toHaveAttribute('data-own-team', 'true');
    expect(fulbo).not.toHaveAttribute('data-own-team');

    // The "Tu equipo" marker in the own row is screen-reader-only (.sr-only),
    // so it occupies no layout next to the name.
    const marker = within(me).getByText('Tu equipo');
    expect(marker).toHaveClass('sr-only');
    // The name renders in full (truncates via CSS, never replaced/hidden).
    expect(within(me).getByText('Mi Equipo')).toBeVisible();
  });

  // Test 3: the format dropdown still filters the ranking via the RPC.
  test('format dropdown filters the ranking (RPC called with the format)', async () => {
    renderView();
    await waitFor(() => expect(screen.getByText('Mi Equipo')).toBeInTheDocument());

    getTeamChallengeRankings.mockClear();
    const formatOption = screen.getByRole('option', { name: 'F7' });
    fireEvent.change(formatOption.closest('select'), { target: { value: '7' } });

    await waitFor(() => expect(getTeamChallengeRankings).toHaveBeenCalledWith(
      expect.objectContaining({ format: '7' }),
    ));
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
  test('shows own teams first, then 20 general teams, without duplicates, and loads the next page', async () => {
    const ownTeam = {
      team_id: 'own-team',
      team_name: 'Mi Equipo',
      format: 5,
      zone: 'CABA',
      country_code: 'AR',
      played_count: 2,
      wins: 1,
      draws: 0,
      losses: 1,
      win_rate: 50,
    };
    const allRows = [
      ownTeam,
      ...makeTeamRows('General', 25),
    ];
    searchChallengeableTeams.mockImplementation(({ limit }) => Promise.resolve(
      allRows.slice(0, limit),
    ));
    renderView({
      ownTeamIds: new Set(['own-team']),
      myTeams: [{ id: 'own-team', name: 'Mi Equipo', format: 5, base_zone: 'CABA', is_active: true }],
    });

    await waitFor(() => expect(screen.getByText('Mi Equipo')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'EQUIPOS' }));

    await waitFor(() => expect(screen.getByText('General 20')).toBeInTheDocument());
    expect(screen.getAllByText('Mi Equipo')).toHaveLength(1);
    expect(screen.queryByText('General 21')).not.toBeInTheDocument();

    const own = screen.getByText('Mi Equipo');
    const firstGeneral = screen.getByText('General 01');
    expect(own.compareDocumentPosition(firstGeneral) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const loadMore = screen.getByRole('button', { name: 'Cargar más' });
    expect(searchChallengeableTeams).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 22 }),
    );
    fireEvent.click(loadMore);

    await waitFor(() => expect(searchChallengeableTeams).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 42 }),
    ));
    await waitFor(() => expect(screen.getByText('General 21')).toBeInTheDocument());
    expect(screen.getByText('General 25')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cargar más' })).not.toBeInTheDocument();
  });

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

describe('TeamRankingsView — filtro por país', () => {
  const multiCountryRanking = [
    {
      team_id: 'ar1', team_name: 'River', format: 5, zone: 'CABA', country_code: 'AR', played_count: 5, wins: 3, draws: 1, losses: 1, win_rate: 60,
    },
    {
      team_id: 'uy1', team_name: 'Peñarol', format: 5, zone: 'Montevideo', country_code: 'UY', played_count: 4, wins: 2, draws: 1, losses: 1, win_rate: 50,
    },
  ];

  test('país filter lives in the Filtros panel and filters the ranking table', async () => {
    getTeamChallengeRankings.mockResolvedValue(multiCountryRanking);
    renderView();
    await waitFor(() => expect(screen.getByText('River')).toBeInTheDocument());
    expect(screen.getByText('Peñarol')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Filtros/ }));
    const uyOption = screen.getByRole('option', { name: /Uruguay/ });
    const countrySelect = uyOption.closest('select');
    fireEvent.change(countrySelect, { target: { value: 'UY' } });

    expect(screen.queryByText('River')).not.toBeInTheDocument();
    expect(screen.getByText('Peñarol')).toBeInTheDocument();
  });

  test('país filter affects the Equipos directory cards', async () => {
    searchChallengeableTeams.mockResolvedValue(multiCountryRanking);
    renderView();
    await waitFor(() => expect(screen.getByText('Mi Equipo')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'EQUIPOS' }));
    await waitFor(() => expect(screen.getByText('Peñarol')).toBeInTheDocument());
    expect(screen.getByText('River')).toBeInTheDocument();

    const arOption = screen.getByRole('option', { name: /Argentina/ });
    const countrySelect = arOption.closest('select');
    fireEvent.change(countrySelect, { target: { value: 'AR' } });

    expect(screen.getByText('River')).toBeInTheDocument();
    expect(screen.queryByText('Peñarol')).not.toBeInTheDocument();
  });
});

describe('TeamRankingsView — Equipos (orden y acciones)', () => {
  test('mis equipos aparecen primero, luego el resto alfabético', async () => {
    renderView({
      ownTeamIds: new Set(['newbie']),
      myTeams: [{ id: 't1', name: 'Fulbo FC', format: 5, is_active: true }],
    });

    fireEvent.click(screen.getByRole('button', { name: 'EQUIPOS' }));
    await waitFor(() => expect(screen.getByText('Nuevo FC')).toBeInTheDocument());

    // "Nuevo FC" (mine) is rendered before "Fulbo" (rival).
    const nuevo = screen.getByText('Nuevo FC');
    const fulbo = screen.getByText('Fulbo');
    expect(nuevo.compareDocumentPosition(fulbo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // My team has no actions menu; the rival exposes the ⋮ overflow menu.
    const nuevoCard = nuevo.closest('.rounded-card');
    const fulboCard = fulbo.closest('.rounded-card');
    expect(within(nuevoCard).queryByRole('button', { name: 'Acciones' })).not.toBeInTheDocument();
    expect(within(nuevoCard).getByText('Tu equipo')).toBeInTheDocument();
    expect(within(fulboCard).getByRole('button', { name: 'Acciones' })).toBeInTheDocument();
  });

  test('the ⋮ overflow menu opens the challenge modal with the rival name', async () => {
    renderView({ myTeams: [{ id: 't1', name: 'Fulbo FC', format: 5, is_active: true }] });
    await waitFor(() => expect(screen.getByText('Mi Equipo')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'EQUIPOS' }));
    await waitFor(() => expect(screen.getByText('Nuevo FC')).toBeInTheDocument());

    // No big "Desafiar" button on the card — the action lives behind ⋮.
    const card = screen.getByText('Nuevo FC').closest('.rounded-card');
    expect(within(card).queryByRole('button', { name: /Desafiar/ })).not.toBeInTheDocument();

    fireEvent.click(within(card).getByRole('button', { name: 'Acciones' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Desafiar/ }));

    expect(screen.getByText('Desafiar a Nuevo FC')).toBeInTheDocument();
    expect(screen.queryByText('Publicar desafío')).not.toBeInTheDocument();
  });
});
