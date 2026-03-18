jest.mock('../supabase', () => ({ supabase: {} }));
jest.mock('../api/supabaseWrapper', () => ({ db: {} }));
jest.mock('../components/AuthProvider', () => ({ useAuth: () => ({ user: null }) }));
jest.mock('../components/LoadingSpinner', () => () => null);
jest.mock('../components/PageLoadingState', () => () => null);
jest.mock('../components/ProfileCard', () => () => null);
jest.mock('../components/StoryLikeCarousel', () => () => null);
jest.mock('../components/EmptyStateCard', () => () => null);
jest.mock('../services/awardsService', () => ({ ensureAwards: jest.fn(async () => ({})) }));
jest.mock('../services/realtimeService', () => ({ subscribeToMatchUpdates: jest.fn(() => () => {}) }));
jest.mock('../services/db/profiles', () => ({ getProfile: jest.fn(async () => null) }));
jest.mock('utils/notifyBlockingError', () => ({ notifyBlockingError: jest.fn() }));
jest.mock('../Logo.png', () => 'logo-mock');
jest.mock('react-router-dom', () => {
  const actual = jest.requireActual('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ partidoId: '1' }),
    useNavigate: () => jest.fn(),
    useLocation: () => ({ search: '', state: null }),
  };
});

const { deriveAwardsUiState } = require('../pages/ResultadosEncuestaView');

describe('Resultados awards UI state', () => {
  test('pending awards keep awards section hidden and pending card visible', () => {
    const uiState = deriveAwardsUiState({
      results: { awards_status: 'pending' },
      partido: { awards_status: 'pending' },
      awardsSkippedByEnsure: false,
    });

    expect(uiState.awardsStatus).toBe('pending');
    expect(uiState.awardsReady).toBe(false);
    expect(uiState.hasInsufficientVotesForAwards).toBe(false);
    expect(uiState.shouldShowPendingResultsCard).toBe(true);
  });

  test('not_eligible awards hide awards section and pending card, showing non-eligibility state', () => {
    const uiState = deriveAwardsUiState({
      results: { awards_status: 'not_eligible' },
      partido: { awards_status: 'not_eligible' },
      awardsSkippedByEnsure: false,
    });

    expect(uiState.awardsStatus).toBe('not_eligible');
    expect(uiState.awardsReady).toBe(false);
    expect(uiState.hasInsufficientVotesForAwards).toBe(true);
    expect(uiState.shouldShowPendingResultsCard).toBe(false);
  });

  test('ready awards enable awards section and hide pending card', () => {
    const uiState = deriveAwardsUiState({
      results: { awards_status: 'ready' },
      partido: { awards_status: 'ready' },
      awardsSkippedByEnsure: false,
    });

    expect(uiState.awardsStatus).toBe('ready');
    expect(uiState.awardsReady).toBe(true);
    expect(uiState.hasInsufficientVotesForAwards).toBe(false);
    expect(uiState.shouldShowPendingResultsCard).toBe(false);
  });

  test('legacy rows with awards_generated true are treated as ready', () => {
    const uiState = deriveAwardsUiState({
      results: { awards_status: null, awards_generated: true },
      partido: { awards_status: null },
      awardsSkippedByEnsure: false,
    });

    expect(uiState.awardsStatus).toBe('ready');
    expect(uiState.awardsReady).toBe(true);
    expect(uiState.shouldShowPendingResultsCard).toBe(false);
  });

  test('awardsSkippedByEnsure forces not_eligible regardless of row state', () => {
    const uiState = deriveAwardsUiState({
      results: { awards_status: 'ready' },
      partido: { awards_status: 'ready' },
      awardsSkippedByEnsure: true,
    });

    expect(uiState.awardsStatus).toBe('not_eligible');
    expect(uiState.awardsReady).toBe(false);
    expect(uiState.hasInsufficientVotesForAwards).toBe(true);
  });
});
