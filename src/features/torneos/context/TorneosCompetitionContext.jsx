import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

const EMPTY_PREFERENCE = Object.freeze({
  organizationId: null,
  activeSeasonId: null,
  activeTournamentId: null,
});

const TorneosCompetitionContext = createContext(null);

function normalizeCompetitionContext(payload, organizationId) {
  const seasons = Array.isArray(payload?.seasons) ? payload.seasons : [];
  const tournaments = Array.isArray(payload?.tournaments) ? payload.tournaments : [];
  const modalities = Array.isArray(payload?.modalities) ? payload.modalities : [];
  const formats = Array.isArray(payload?.formats) ? payload.formats : [];
  const requested = payload?.preference || EMPTY_PREFERENCE;
  const activeSeason = seasons.find((season) => season.id === requested.activeSeasonId);
  const activeTournament = tournaments.find((tournament) => (
    tournament.id === requested.activeTournamentId
    && tournament.seasonId === activeSeason?.id
  ));

  return {
    seasons,
    tournaments,
    modalities,
    formats,
    preference: {
      organizationId,
      activeSeasonId: activeSeason?.id || null,
      activeTournamentId: activeTournament?.id || null,
      updatedAt: requested.updatedAt || null,
    },
  };
}

export function TorneosCompetitionProvider({
  organizationId,
  service,
  children,
}) {
  const mountedRef = useRef(true);
  const requestRef = useRef(0);
  const supportsCompetition = typeof service?.loadCompetitionContext === 'function';
  const [state, setState] = useState({
    status: supportsCompetition ? 'loading' : 'ready',
    seasons: [],
    tournaments: [],
    modalities: [],
    formats: [],
    preference: { ...EMPTY_PREFERENCE, organizationId },
    error: '',
    notice: '',
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestRef.current += 1;
    };
  }, []);

  const refresh = useCallback(async ({ notice = '' } = {}) => {
    if (!supportsCompetition) return normalizeCompetitionContext({}, organizationId);
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setState((current) => ({
      ...current,
      status: 'loading',
      seasons: [],
      tournaments: [],
      preference: { ...EMPTY_PREFERENCE, organizationId },
      error: '',
      notice: notice || current.notice,
    }));
    try {
      const normalized = normalizeCompetitionContext(
        await service.loadCompetitionContext(organizationId),
        organizationId,
      );
      if (!mountedRef.current || requestRef.current !== requestId) return normalized;
      setState((current) => ({
        ...current,
        ...normalized,
        status: 'ready',
        error: '',
        notice: notice || current.notice,
      }));
      return normalized;
    } catch (error) {
      if (!mountedRef.current || requestRef.current !== requestId) throw error;
      setState((current) => ({
        ...current,
        status: 'error',
        seasons: [],
        tournaments: [],
        preference: { ...EMPTY_PREFERENCE, organizationId },
        error: error?.message || 'No pudimos cargar la competencia.',
      }));
      throw error;
    }
  }, [organizationId, service, supportsCompetition]);

  useEffect(() => {
    setState((current) => ({
      ...current,
      status: supportsCompetition ? 'loading' : 'ready',
      seasons: [],
      tournaments: [],
      modalities: [],
      formats: [],
      preference: { ...EMPTY_PREFERENCE, organizationId },
      error: '',
      notice: '',
    }));
    if (supportsCompetition) refresh().catch(() => {});
  }, [organizationId, refresh, supportsCompetition]);

  const runMutation = useCallback(async (operation, successNotice) => {
    const result = await operation();
    await refresh({ notice: successNotice });
    return result;
  }, [refresh]);

  const selectContext = useCallback(async (seasonId, tournamentId = null) => {
    const season = state.seasons.find((candidate) => candidate.id === seasonId);
    const tournament = tournamentId
      ? state.tournaments.find((candidate) => (
        candidate.id === tournamentId && candidate.seasonId === seasonId
      ))
      : null;
    if (!season || (tournamentId && !tournament)) {
      setState((current) => ({
        ...current,
        notice: 'Ese contexto ya no está disponible.',
      }));
      return null;
    }
    await service.setTournamentContext({
      organizationId,
      seasonId,
      tournamentId,
    });
    setState((current) => ({
      ...current,
      preference: {
        organizationId,
        activeSeasonId: seasonId,
        activeTournamentId: tournamentId,
      },
      notice: '',
    }));
    return tournament || season;
  }, [organizationId, service, state.seasons, state.tournaments]);

  const createSeason = useCallback((input) => runMutation(
    () => service.createSeason({
      organizationId,
      ...input,
      idempotencyKey: input.idempotencyKey || service.createIdempotencyKey(),
    }),
    'Temporada creada como borrador.',
  ), [organizationId, runMutation, service]);

  const updateSeason = useCallback((input) => runMutation(
    () => service.updateSeason({ organizationId, ...input }),
    'Temporada actualizada.',
  ), [organizationId, runMutation, service]);

  const createTournament = useCallback((input) => runMutation(
    () => service.createTournament({
      organizationId,
      ...input,
      idempotencyKey: input.idempotencyKey || service.createIdempotencyKey(),
    }),
    'Torneo creado. Podés continuar su configuración.',
  ), [organizationId, runMutation, service]);

  const updateTournament = useCallback((input) => runMutation(
    () => service.updateTournament({ organizationId, ...input }),
    'Configuración guardada.',
  ), [organizationId, runMutation, service]);

  const saveCategory = useCallback((input) => runMutation(
    () => service.saveCategory({ organizationId, ...input }),
    input.status === 'archived' ? 'Categoría archivada.' : 'Categoría guardada.',
  ), [organizationId, runMutation, service]);

  const changeTournamentStatus = useCallback((input) => runMutation(
    () => service.changeTournamentStatus({ organizationId, ...input }),
    input.status === 'registration'
      ? 'El torneo quedó preparado para inscripciones.'
      : input.status === 'archived'
        ? 'Torneo archivado.'
        : 'Estado actualizado.',
  ), [organizationId, runMutation, service]);

  const startCompetition = useCallback((input) => runMutation(
    () => service.startCompetition({ organizationId, ...input }),
    'La competencia quedó En juego.',
  ), [organizationId, runMutation, service]);

  const finishCompetition = useCallback((input) => runMutation(
    () => service.finishCompetition({ organizationId, ...input }),
    'La competencia quedó finalizada.',
  ), [organizationId, runMutation, service]);

  const reopenCompetition = useCallback((input) => runMutation(
    () => service.reopenCompetition({ organizationId, ...input }),
    'La competencia volvió a estar En juego.',
  ), [organizationId, runMutation, service]);

  const withdrawCompetitionParticipant = useCallback((input) => runMutation(
    () => service.withdrawCompetitionParticipant({ organizationId, ...input }),
    'El equipo quedó retirado de la competencia.',
  ), [organizationId, runMutation, service]);

  const createIdempotencyKey = useCallback(
    () => service.createIdempotencyKey(),
    [service],
  );

  const clearNotice = useCallback(() => {
    setState((current) => ({ ...current, notice: '' }));
  }, []);

  const activeSeason = state.seasons.find(
    (season) => season.id === state.preference.activeSeasonId,
  ) || null;
  const activeTournament = state.tournaments.find(
    (tournament) => tournament.id === state.preference.activeTournamentId,
  ) || null;

  const value = useMemo(() => ({
    ...state,
    activeSeason,
    activeTournament,
    refresh,
    selectContext,
    createSeason,
    updateSeason,
    createTournament,
    updateTournament,
    saveCategory,
    changeTournamentStatus,
    startCompetition,
    finishCompetition,
    reopenCompetition,
    withdrawCompetitionParticipant,
    createIdempotencyKey,
    clearNotice,
  }), [
    activeSeason,
    activeTournament,
    changeTournamentStatus,
    clearNotice,
    createSeason,
    createTournament,
    createIdempotencyKey,
    finishCompetition,
    refresh,
    reopenCompetition,
    saveCategory,
    selectContext,
    startCompetition,
    state,
    updateSeason,
    updateTournament,
    withdrawCompetitionParticipant,
  ]);

  return (
    <TorneosCompetitionContext.Provider value={value}>
      {children}
    </TorneosCompetitionContext.Provider>
  );
}

export function useTorneosCompetition() {
  const context = useContext(TorneosCompetitionContext);
  if (!context) {
    throw new Error('useTorneosCompetition must be used inside TorneosCompetitionProvider');
  }
  return context;
}
