import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import StatsView from '../components/StatsView';
import { supabase } from '../supabase';
import {
  listMyManageableTeams,
  reportChallengeResult,
} from '../services/db/teamChallenges';

jest.mock('framer-motion', () => {
  const React = require('react');
  const passthrough = (Tag) => React.forwardRef(({
    children,
    initial,
    animate,
    transition,
    whileHover,
    whileTap,
    ...props
  }, ref) => (
    <Tag ref={ref} {...props}>{children}</Tag>
  ));
  return {
    motion: {
      div: passthrough('div'),
      button: passthrough('button'),
    },
    AnimatePresence: ({ children }) => <>{children}</>,
  };
});

jest.mock('recharts', () => ({
  BarChart: ({ children }) => <div>{children}</div>,
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  ResponsiveContainer: ({ children }) => <div>{children}</div>,
  Tooltip: () => null,
  CartesianGrid: () => null,
}));

jest.mock('../components/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'owner-a', email: 'nico@example.com' } }),
}));

jest.mock('../services/db/userIdentity', () => ({
  buildUserIdentityTokenSet: ({ user, aliasRefs = [] }) => new Set([user?.id, ...aliasRefs].filter(Boolean)),
  entityMatchesIdentitySet: (entity, refs) => refs.has(entity?.usuario_id) || refs.has(entity?.uuid) || refs.has(String(entity?.id || '')),
  getEntityIdentityValues: (entity) => [entity?.usuario_id, entity?.uuid, entity?.id, entity?.email, entity?.nombre].filter(Boolean),
  isUuidLike: () => false,
  listRegisteredUserIdentityRefs: jest.fn().mockResolvedValue([]),
  normalizeAwardType: (value) => value,
  normalizeIdentityToken: (value) => String(value || '').trim().toLowerCase(),
}));

jest.mock('../services/db/teamChallenges', () => ({
  listMyManageableTeams: jest.fn(),
  reportChallengeResult: jest.fn(),
}));

jest.mock('../supabase', () => ({
  supabase: {
    from: jest.fn(),
  },
}));

jest.mock('../components/LoadingSpinner', () => () => <div>Cargando...</div>);
jest.mock('../components/PageTitle', () => ({ children }) => <h1>{children}</h1>);
jest.mock('../components/ManualMatchModal', () => () => null);
jest.mock('../components/InjuryModal', () => () => null);

let challengeResultStatus;
let challengeResultConfirmed;
let challengeResultConflict;

const periodMatch = {
  id: 120,
  nombre: 'Desafío: Equipo a vs Equipo b',
  fecha: '2026-06-16',
  hora: '01:05',
  estado: 'finalizado',
  survey_status: 'closed',
  result_status: 'pending',
  winner_team: null,
  finished_at: '2026-06-16T04:05:00Z',
  tipo_partido: 'Desafío',
  jugadores: [{ id: 71, usuario_id: 'owner-a', nombre: 'Nico' }],
};

const challengeTeamMatch = () => ({
  id: 'tm-120',
  partido_id: 120,
  origin_type: 'challenge',
  challenge_id: 'challenge-120',
  team_a_id: 'team-a',
  team_b_id: 'team-b',
  scheduled_at: '2000-06-16T04:05:00Z',
  played_at: null,
  status: challengeResultStatus ? 'played' : 'pending',
  result_status: challengeResultStatus,
  result_confirmed: challengeResultConfirmed,
  result_conflict: challengeResultConflict,
  result_reported_by_team_id: challengeResultStatus ? 'team-a' : null,
  result_reported_at: challengeResultStatus ? '2026-06-16T05:00:00Z' : null,
  team_a: { id: 'team-a', name: 'Equipo a', owner_user_id: 'owner-a' },
  team_b: { id: 'team-b', name: 'Equipo b', owner_user_id: 'owner-b' },
  challenge: {
    id: 'challenge-120',
    created_by_user_id: 'owner-a',
    accepted_by_user_id: 'owner-b',
    challenger_team_id: 'team-a',
    accepted_team_id: 'team-b',
    status: challengeResultStatus ? 'completed' : 'accepted',
    scheduled_at: '2000-06-16T04:05:00Z',
  },
});

class QueryBuilder {
  constructor(table) {
    this.table = table;
    this.options = {};
  }

  select(_columns, options = {}) {
    this.options = options || {};
    return this;
  }

  eq() { return this; }
  gte() { return this; }
  lte() { return this; }
  in() { return this; }
  not() { return this; }
  order() { return this; }

  maybeSingle() {
    if (this.table === 'usuarios') return Promise.resolve({ data: { ranking: 0 }, error: null });
    if (this.table === 'no_show_recovery_state') return Promise.resolve({ data: { current_streak: 0 }, error: null });
    return Promise.resolve({ data: null, error: null });
  }

  then(resolve, reject) {
    return Promise.resolve(resolveTable(this.table, this.options)).then(resolve, reject);
  }
}

const resolveTable = (table, options = {}) => {
  if (table === 'partidos_view') return { data: [periodMatch], error: null };
  if (table === 'partidos') {
    return {
      data: [{
        id: 120,
        result_status: 'pending',
        winner_team: null,
        finished_at: '2026-06-16T04:05:00Z',
        survey_status: 'closed',
      }],
      error: null,
    };
  }
  if (table === 'team_matches') return { data: [challengeTeamMatch()], error: null };
  if (table === 'partidos_manuales') {
    return options?.head ? { data: null, count: 0, error: null } : { data: [], error: null };
  }
  if (table === 'usuarios') return { data: { ranking: 0 }, error: null };
  if (table === 'no_show_recovery_state') return { data: { current_streak: 0 }, error: null };
  return { data: [], error: null };
};

describe('StatsView challenge result recap', () => {
  beforeEach(() => {
    challengeResultStatus = null;
    challengeResultConfirmed = false;
    challengeResultConflict = false;
    supabase.from.mockImplementation((table) => new QueryBuilder(table));
    listMyManageableTeams.mockResolvedValue([{ id: 'team-a', name: 'Equipo a' }]);
    reportChallengeResult.mockImplementation(async ({ resultStatus }) => {
      challengeResultStatus = resultStatus;
      challengeResultConfirmed = false;
      return { id: 'tm-120', result_status: resultStatus, result_confirmed: false };
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('keeps recap pending after a one-team provisional result report', async () => {
    render(<StatsView onVolver={jest.fn()} />);

    const recap = await screen.findByText('Recap de resultados');
    const recapPanel = recap.closest('div[class*="rounded-card"]');
    expect(within(recapPanel).getByText('Pendientes').nextSibling).toHaveTextContent('1');

    fireEvent.click(await screen.findByRole('button', { name: /desafío: equipo a vs equipo b/i }));

    expect(await screen.findByRole('heading', { name: '¿Cómo salió el desafío?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ganamos' }));
    fireEvent.click(screen.getByRole('button', { name: 'Aceptar' }));

    await waitFor(() => expect(reportChallengeResult).toHaveBeenCalledWith({
      challengeId: 'challenge-120',
      resultStatus: 'team_a_win',
    }));
    await waitFor(() => expect(within(recapPanel).getByText('Ganados').nextSibling).toHaveTextContent('0'));
    expect(within(recapPanel).getByText('Pendientes').nextSibling).toHaveTextContent('1');
  });

  // Test 8 / 15: a confirmed result finally counts towards statistics.
  test('counts a confirmed challenge result as a win', async () => {
    challengeResultStatus = 'team_a_win';
    challengeResultConfirmed = true;
    challengeResultConflict = false;

    render(<StatsView onVolver={jest.fn()} />);

    const recap = await screen.findByText('Recap de resultados');
    const recapPanel = recap.closest('div[class*="rounded-card"]');
    await waitFor(() => expect(within(recapPanel).getByText('Ganados').nextSibling).toHaveTextContent('1'));
    expect(within(recapPanel).getByText('Pendientes').nextSibling).toHaveTextContent('0');
  });

  // Test 10: a result in conflict never credits a win/draw/loss. The only match
  // is in conflict, so it is excluded from the stats recap entirely.
  test('does not count a result in conflict', async () => {
    challengeResultStatus = null;
    challengeResultConfirmed = false;
    challengeResultConflict = true;

    render(<StatsView onVolver={jest.fn()} />);

    await waitFor(() => expect(screen.queryByText('Cargando...')).not.toBeInTheDocument());
    expect(screen.queryByText('Recap de resultados')).not.toBeInTheDocument();
  });
});
