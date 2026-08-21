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

//
// El provider tiene dos modos inequívocos.
//
//   Tournament route      La URL manda. `routeTournamentId` viene de
//                         :tournamentId y NADA lo sobrescribe: ni la
//                         preferencia del servidor, ni un refresh, ni otra
//                         pestaña que cambie el torneo activo.
//
//   Organization surface  No hay torneo en la URL, así que la preferencia
//                         persistida sigue siendo el default de UX.
//
// Montar una ruta canónica no escribe la preferencia. Eso queda para la
// elección explícita del usuario, el default al entrar en superficies sin
// torneo y la compatibilidad legacy.
//
export function TorneosCompetitionProvider({
  organizationId,
  routeTournamentId = null,
  service,
  children,
}) {
  const pinnedTournamentId = typeof routeTournamentId === 'string' && routeTournamentId
    ? routeTournamentId
    : null;
  const mountedRef = useRef(true);
  const requestRef = useRef(0);
  // Por ref y no por dependencia: navegar de un torneo a otro dentro de la
  // misma organización no puede invalidar `refresh` y disparar una recarga
  // completa del catálogo. El catálogo es de la organización, no del torneo.
  const pinnedRef = useRef(pinnedTournamentId);
  pinnedRef.current = pinnedTournamentId;
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
      // Con la URL como fuente de verdad no se puede vaciar el catálogo
      // mientras recargamos: el torneo de la ruta se resuelve contra esta
      // lista, y blanquearla haría que un refresh lo diera por inexistente.
      seasons: pinnedRef.current ? current.seasons : [],
      tournaments: pinnedRef.current ? current.tournaments : [],
      preference: pinnedRef.current
        ? current.preference
        : { ...EMPTY_PREFERENCE, organizationId },
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

  // La resolución del torneo es lo único que distingue los dos modos.
  //
  // Con `pinnedTournamentId` buscamos por id contra el catálogo de la
  // organización y listo: la preferencia no participa. Sin él, vale la
  // preferencia persistida, igual que antes.
  const pinnedTournament = pinnedTournamentId
    ? state.tournaments.find((tournament) => tournament.id === pinnedTournamentId) || null
    : null;
  const preferredTournament = state.tournaments.find(
    (tournament) => tournament.id === state.preference.activeTournamentId,
  ) || null;
  const activeTournament = pinnedTournamentId ? pinnedTournament : preferredTournament;
  const activeSeason = state.seasons.find((season) => (
    season.id === (pinnedTournamentId
      ? pinnedTournament?.seasonId
      : state.preference.activeSeasonId)
  )) || null;

  // Un `:tournamentId` que no existe en la organización no puede degradarse al
  // torneo de la preferencia: eso renderizaría el torneo equivocado bajo una
  // URL que dice otra cosa. El guard lo lee y cierra.
  const routeTournamentStatus = (() => {
    if (!pinnedTournamentId) return 'idle';
    if (pinnedTournament) return 'ready';
    return state.status === 'ready' ? 'not-found' : 'loading';
  })();

  // La preferencia expuesta refleja lo que la ruta está mostrando, sin escribir
  // nada en el servidor. Así los selectores no contradicen a la URL.
  const effectivePreference = pinnedTournamentId
    ? {
      ...state.preference,
      activeSeasonId: pinnedTournament?.seasonId || state.preference.activeSeasonId,
      activeTournamentId: pinnedTournament?.id || null,
    }
    : state.preference;

  const value = useMemo(() => ({
    ...state,
    preference: effectivePreference,
    routeTournamentId: pinnedTournamentId,
    isTournamentRoute: Boolean(pinnedTournamentId),
    routeTournamentStatus,
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
    effectivePreference,
    pinnedTournamentId,
    routeTournamentStatus,
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

export function useOptionalTorneosCompetition() {
  return useContext(TorneosCompetitionContext);
}
