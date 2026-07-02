jest.mock('../supabase', () => ({ supabase: {} }));
jest.mock('../api/supabaseWrapper', () => ({ db: {} }));
jest.mock('../config/surveyConfig', () => ({
  SURVEY_FINALIZE_DELAY_MS: 24 * 60 * 60 * 1000,
  SURVEY_START_DELAY_MS: 60 * 60 * 1000,
  SURVEY_MIN_VOTERS_FOR_AWARDS: 3,
}));
jest.mock('../components/AuthProvider', () => ({ useAuth: () => ({ user: null }) }));
jest.mock('../components/LoadingSpinner', () => () => null);
jest.mock('../components/PageLoadingState', () => () => null);
jest.mock('../components/ProfileCard', () => () => null);
jest.mock('../components/StoryLikeCarousel', () => () => null);
jest.mock('../components/EmptyStateCard', () => () => null);
jest.mock('../services/awardsService', () => ({ ensureAwards: jest.fn(async () => ({})) }));
jest.mock('../services/db/penalties', () => ({
  listMatchNoShowSummary: jest.fn(async () => ({ data: [], error: null })),
}));
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

const {
  buildForcedAwardsFallback,
  deriveAwardsUiState,
  deriveAwardsPresentationState,
  deriveAbsenceResultsFromSummary,
  deriveCanonicalResultsRow,
  deriveCanShowResults,
  deriveShouldBlockStaticResultsForAwards,
  resolvePenaltyRatingTransition,
  shouldShowAwardsRetryAction,
  shouldShowSecondaryResultsSections,
} = require('../pages/ResultadosEncuestaView');

describe('Resultados awards UI state', () => {
  test('pending awards no longer show a dedicated pending awards card', () => {
    const uiState = deriveAwardsUiState({
      results: { awards_status: 'pending' },
      partido: { awards_status: 'pending' },
      awardsSkippedByEnsure: false,
    });

    expect(uiState.awardsStatus).toBe('pending');
    expect(uiState.awardsReady).toBe(false);
    expect(uiState.hasInsufficientVotesForAwards).toBe(false);
    expect(uiState.shouldShowPendingResultsCard).toBe(false);
  });

  test('stale pending in closed match with insufficient voters falls back to not_eligible', () => {
    const uiState = deriveAwardsUiState({
      results: {
        awards_status: 'pending',
        results_ready: true,
        awards: { mvp: null, best_gk: null, red_card: null },
      },
      partido: {
        awards_status: 'pending',
        survey_status: 'closed',
        survey_expected_voters: 1,
      },
      awardsSkippedByEnsure: false,
      surveyProgress: {
        surveyStatus: 'closed',
        expectedVoters: 1,
        submissionsCount: 1,
      },
    });

    expect(uiState.awardsStatus).toBe('not_eligible');
    expect(uiState.awardsReady).toBe(false);
    expect(uiState.hasInsufficientVotesForAwards).toBe(true);
    expect(uiState.shouldShowPendingResultsCard).toBe(false);
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

  test('rows with results_ready and persisted awards payload are treated as ready even if status lagged', () => {
    const uiState = deriveAwardsUiState({
      results: {
        awards_status: 'pending',
        results_ready: true,
        awards: { mvp: { player_id: '10' } },
      },
      partido: { awards_status: 'pending' },
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

  test('retry action is hidden for not_eligible final state', () => {
    const shouldShowRetry = shouldShowAwardsRetryAction({
      results: { awards_status: 'not_eligible' },
      awardsStatus: 'not_eligible',
      isSurveyClosed: true,
    });

    expect(shouldShowRetry).toBe(false);
  });

  test('retry action is shown only when awards are still pending', () => {
    const shouldShowRetry = shouldShowAwardsRetryAction({
      results: { awards_status: 'pending' },
      awardsStatus: 'pending',
      isSurveyClosed: true,
    });

    expect(shouldShowRetry).toBe(true);
  });

  test('canonical results row ignores ready payloads while survey is still open', () => {
    const canonicalRow = deriveCanonicalResultsRow({
      results: {
        results_ready: true,
        awards_status: 'ready',
        awards: { mvp: { player_id: '10' } },
      },
      surveyProgress: {
        hasSurveyStatus: true,
        surveyStatus: 'open',
      },
      partido: {
        survey_status: 'open',
      },
    });

    expect(canonicalRow).toBeNull();
  });

  test('results screen only renders when canonical results also have renderable content', () => {
    expect(deriveCanShowResults({
      results: {
        results_ready: true,
        awards_status: 'ready',
      },
      renderableSlidesCount: 0,
    })).toBe(false);

    expect(deriveCanShowResults({
      results: {
        results_ready: true,
        awards_status: 'ready',
      },
      renderableSlidesCount: 3,
    })).toBe(true);
  });

  test('ready awards without renderable story fall back to final unavailable state', () => {
    const presentation = deriveAwardsPresentationState({
      isSurveyClosed: true,
      awardsStatus: 'ready',
      hasRenderableAwardsStory: false,
      hasResults: false,
    });

    expect(presentation).toEqual(expect.objectContaining({
      awardsStatusLabel: 'No disponible',
      shouldShowAwardsUnavailableState: true,
      shouldShowPendingResultsCard: false,
    }));
  });

  test('closed not_eligible state no longer renders the generic no-results card', () => {
    const presentation = deriveAwardsPresentationState({
      isSurveyClosed: true,
      awardsStatus: 'not_eligible',
      hasRenderableAwardsStory: false,
      hasResults: false,
    });

    expect(presentation).toEqual(expect.objectContaining({
      awardsStatusLabel: 'No elegible para premios',
      shouldShowAwardsUnavailableState: false,
      shouldShowPendingResultsCard: false,
    }));
  });

  test('error awards stay in a final unavailable state instead of pending bridge', () => {
    const uiState = deriveAwardsUiState({
      results: { awards_status: 'error', results_ready: true },
      partido: { awards_status: 'error', survey_status: 'closed' },
      awardsSkippedByEnsure: false,
    });
    const presentation = deriveAwardsPresentationState({
      isSurveyClosed: true,
      awardsStatus: 'error',
      hasRenderableAwardsStory: false,
      hasResults: true,
    });

    expect(uiState.awardsStatus).toBe('error');
    expect(uiState.hasAwardsError).toBe(true);
    expect(uiState.shouldShowPendingResultsCard).toBe(false);
    expect(presentation).toEqual(expect.objectContaining({
      awardsStatusLabel: 'No disponible',
      shouldShowAwardsUnavailableState: true,
      shouldShowPendingResultsCard: false,
    }));
  });

  test('ready awards with renderable story keep the direct awards-ready state', () => {
    const presentation = deriveAwardsPresentationState({
      isSurveyClosed: true,
      awardsStatus: 'ready',
      hasRenderableAwardsStory: true,
      hasResults: true,
    });

    expect(presentation).toEqual(expect.objectContaining({
      awardsStatusLabel: 'Listos para ver',
      shouldShowAwardsUnavailableState: false,
      shouldShowPendingResultsCard: false,
    }));
  });

  test('secondary result sections stay visible for not_eligible final state when there is real data to show', () => {
    const shouldShowSections = shouldShowSecondaryResultsSections({
      awardsStatus: 'not_eligible',
      hasSecondaryResults: true,
    });

    expect(shouldShowSections).toBe(true);
  });

  test('secondary result sections stay hidden for not_eligible final state when there is no secondary data', () => {
    const shouldShowSections = shouldShowSecondaryResultsSections({
      awardsStatus: 'not_eligible',
      hasSecondaryResults: false,
    });

    expect(shouldShowSections).toBe(false);
  });

  test('secondary result sections stay available for ready awards', () => {
    const shouldShowSections = shouldShowSecondaryResultsSections({
      awardsStatus: 'ready',
    });

    expect(shouldShowSections).toBe(true);
  });

  test('forced awards mode blocks static results before story or fallback resolve', () => {
    expect(deriveShouldBlockStaticResultsForAwards({
      forceAwardsMode: true,
      showingBadgeAnimations: false,
      forcedAwardsFallback: null,
    })).toBe(true);

    expect(deriveShouldBlockStaticResultsForAwards({
      forceAwardsMode: true,
      showingBadgeAnimations: true,
      forcedAwardsFallback: null,
    })).toBe(false);

    expect(deriveShouldBlockStaticResultsForAwards({
      forceAwardsMode: true,
      showingBadgeAnimations: false,
      forcedAwardsFallback: { title: 'Premiación no disponible' },
    })).toBe(false);

    expect(deriveShouldBlockStaticResultsForAwards({
      forceAwardsMode: false,
      showingBadgeAnimations: false,
      forcedAwardsFallback: null,
    })).toBe(false);
  });

  test('forced awards fallback resolves no-slide states without returning to static results', () => {
    expect(buildForcedAwardsFallback({
      row: {
        results_ready: true,
        awards_status: 'not_eligible',
      },
      reason: 'force_awards_no_slides',
    })).toEqual(expect.objectContaining({
      title: 'Premiación no disponible',
      reason: 'force_awards_no_slides',
    }));

    expect(buildForcedAwardsFallback({
      row: {
        results_ready: true,
        awards_status: 'error',
      },
    })).toEqual(expect.objectContaining({
      title: 'Premiación no disponible',
      reason: 'awards_error',
    }));

    expect(buildForcedAwardsFallback({
      row: null,
    })).toEqual(expect.objectContaining({
      title: 'Premiación no disponible',
      reason: 'results_not_ready',
    }));
  });

  test('absence results only use canonical no-show summary rows', () => {
    const absences = deriveAbsenceResultsFromSummary({
      rosterPlayers: [
        {
          id: 1,
          usuario_id: 'user-1',
          nombre: 'Titular',
          ranking: 6.1,
          partidos_abandonados: 4,
          ausencias: [{ fecha: '2026-03-01' }],
          estado: 'ineligible',
        },
        {
          id: 2,
          usuario_id: 'user-2',
          nombre: 'Ausente confirmado',
          ranking: 4.5,
          partidos_abandonados: 1,
          ausencias: [],
          estado: 'active',
        },
      ],
      noShowSummary: [
        {
          playerId: 2,
          userId: 'user-2',
          confirmationCount: 2,
          penaltyApplied: true,
          penaltyAmount: -0.5,
          recoveryApplied: false,
        },
      ],
    });

    expect(absences).toHaveLength(1);
    expect(absences[0]).toMatchObject({
      id: 2,
      nombre: 'Ausente confirmado',
      confirmedAbsent: true,
      confirmationCount: 2,
      penaltyApplied: true,
      ausenciasCount: 1,
      prePenaltyRanking: 5.0,
      penaltyRanking: 4.5,
    });
  });

  test('absence summary falls back to confirmed absence without inventing a penalty', () => {
    const absences = deriveAbsenceResultsFromSummary({
      rosterPlayers: [
        {
          id: 3,
          usuario_id: 'user-3',
          nombre: 'Confirmado sin penalidad',
          ranking: 5.8,
          partidos_abandonados: 0,
        },
      ],
      noShowSummary: [
        {
          playerId: 3,
          userId: 'user-3',
          confirmationCount: 2,
          penaltyApplied: false,
          penaltyAmount: 0,
          recoveryApplied: false,
        },
      ],
    });

    expect(absences).toEqual([
      expect.objectContaining({
        id: 3,
        confirmationCount: 2,
        penaltyApplied: false,
        prePenaltyRanking: 5.8,
        penaltyRanking: 5.8,
      }),
    ]);
  });
});

describe('resolvePenaltyRatingTransition', () => {
  test('with a penalty the rating actually drops (before > after)', () => {
    const transition = resolvePenaltyRatingTransition({
      penaltyPlayer: {
        prePenaltyRanking: 5.5,
        penaltyRanking: 5.0,
        penaltyAmount: -0.5,
      },
    });

    expect(transition).toEqual({ from: 5.5, to: 5.0, delta: 0.5 });
  });

  test('uses the absences entry even when the live roster copy lacks penalty fields', () => {
    // Regression: the story resolved the player through previewPlayers (a
    // roster clone with only `ranking`), which made the pill show "5.0 → 5.0"
    // while the label below said "5.5 → 5.0".
    const transition = resolvePenaltyRatingTransition({
      penaltyPlayer: {
        prePenaltyRanking: 5.5,
        penaltyRanking: 5.0,
      },
      livePlayer: {
        ranking: '5.0',
        nombre: 'Clon del roster',
      },
    });

    expect(transition.from).toBe(5.5);
    expect(transition.to).toBe(5.0);
    expect(transition.delta).toBe(0.5);
  });

  test('without penalty fields it falls back to the current rating with no fake drop', () => {
    const transition = resolvePenaltyRatingTransition({
      penaltyPlayer: null,
      livePlayer: { ranking: 6.2 },
    });

    expect(transition).toEqual({ from: 6.2, to: 6.2, delta: 0 });
  });

  test('shown transition matches the persisted-derived absences data end to end', () => {
    const [absence] = deriveAbsenceResultsFromSummary({
      rosterPlayers: [{ id: 9, usuario_id: 'user-9', nombre: 'Penalizado', ranking: 4.5 }],
      noShowSummary: [{
        playerId: 9,
        userId: 'user-9',
        confirmationCount: 2,
        penaltyApplied: true,
        penaltyAmount: -0.5,
        recoveryApplied: false,
      }],
    });

    const transition = resolvePenaltyRatingTransition({
      penaltyPlayer: absence,
      livePlayer: { ranking: 4.5 },
    });

    // persisted (current) rating is 4.5 → shown as 5.0 → 4.5
    expect(transition).toEqual({ from: 5.0, to: 4.5, delta: 0.5 });
  });
});
