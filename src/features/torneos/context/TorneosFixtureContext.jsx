import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useSearchParams } from 'react-router-dom';
import { CATEGORY_QUERY_PARAM, readCategoryId } from '../routing/canonicalRoutes';
import { useTorneosCompetition } from './TorneosCompetitionContext';

const EMPTY_DATA = Object.freeze({
  participantSet: null,
  eligibleEntries: [],
  participants: [],
  pots: [],
  groups: [],
  versions: [],
  phases: [],
  rounds: [],
  matches: [],
  venues: [],
  courts: [],
  windows: [],
  reschedules: [],
});

const TorneosFixtureContext = createContext(null);

export function TorneosFixtureProvider({
  organizationId,
  service,
  children,
}) {
  const {
    activeTournament,
    isTournamentRoute,
    refresh: refreshCompetition,
  } = useTorneosCompetition();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestRef = useRef(0);
  const scopeRef = useRef('');
  const [preferredCategoryId, setPreferredCategoryId] = useState(null);
  const [state, setState] = useState({
    status: 'idle',
    data: EMPTY_DATA,
    error: '',
    notice: '',
  });
  const categories = useMemo(
    () => (activeTournament?.categories || []).filter((category) => category.status === 'active'),
    [activeTournament?.categories],
  );
  // `?categoria=` es la categoría reproducible: si viene en la URL, gana sobre
  // cualquier preferencia de React previa. Si viene y no pertenece a este
  // torneo no se degrada al default —eso mostraría otra categoría bajo una URL
  // que dice una— sino que queda en null y el guard cierra.
  const queryCategoryId = readCategoryId(searchParams);
  const isKnownCategory = useCallback(
    (candidate) => Boolean(candidate) && categories.some((category) => category.id === candidate),
    [categories],
  );
  const categoryId = (() => {
    if (queryCategoryId) return isKnownCategory(queryCategoryId) ? queryCategoryId : null;
    if (isKnownCategory(preferredCategoryId)) return preferredCategoryId;
    return categories[0]?.id || null;
  })();
  const scopeKey = `${organizationId || ''}:${activeTournament?.id || ''}:${categoryId || ''}`;
  scopeRef.current = scopeKey;

  useEffect(() => {
    setPreferredCategoryId(categoryId);
  }, [activeTournament?.id, categories, categoryId]);

  // Elegir categoría en una ruta canónica tiene que quedar en la URL, o el
  // link deja de reproducir lo que la persona está viendo. Fuera de las rutas
  // canónicas se mantiene el comportamiento previo, en estado de React.
  const selectCategory = useCallback((nextCategoryId) => {
    setPreferredCategoryId(nextCategoryId);
    if (!isTournamentRoute) return;
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (nextCategoryId) next.set(CATEGORY_QUERY_PARAM, nextCategoryId);
      else next.delete(CATEGORY_QUERY_PARAM);
      return next;
    }, { replace: true });
  }, [isTournamentRoute, setSearchParams]);

  const refresh = useCallback(async ({ notice = '' } = {}) => {
    const requestedScope = scopeKey;
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    if (!activeTournament?.id || !categoryId
      || typeof service?.loadFixtureContext !== 'function') {
      const data = { ...EMPTY_DATA };
      if (scopeRef.current === requestedScope) {
        setState({ status: 'ready', data, error: '', notice });
      }
      return data;
    }
    setState({ status: 'loading', data: EMPTY_DATA, error: '', notice });
    try {
      const [fixture, schedule] = await Promise.all([
        service.loadFixtureContext(organizationId, activeTournament.id, categoryId),
        service.loadScheduleContext(organizationId, activeTournament.id, categoryId),
      ]);
      const data = {
        ...EMPTY_DATA,
        ...(fixture || {}),
        ...(schedule || {}),
      };
      if (requestRef.current === requestId && scopeRef.current === requestedScope) {
        setState({ status: 'ready', data, error: '', notice });
      }
      return data;
    } catch (error) {
      if (requestRef.current === requestId && scopeRef.current === requestedScope) {
        setState({
          status: 'error',
          data: EMPTY_DATA,
          error: error?.message || 'No pudimos cargar el fixture.',
          notice: '',
        });
      }
      throw error;
    }
  }, [activeTournament?.id, categoryId, organizationId, scopeKey, service]);

  useEffect(() => {
    setState({ status: 'idle', data: EMPTY_DATA, error: '', notice: '' });
    refresh().catch(() => {});
    return () => {
      requestRef.current += 1;
    };
  }, [refresh]);

  const mutate = useCallback(async (operation, notice) => {
    const requestedScope = scopeKey;
    try {
      const result = await operation();
      if (scopeRef.current === requestedScope) await refresh({ notice });
      return result;
    } catch (error) {
      if (scopeRef.current === requestedScope) {
        setState({
          status: 'error',
          data: EMPTY_DATA,
          error: error?.message || 'No pudimos actualizar el fixture.',
          notice: '',
        });
      }
      throw error;
    }
  }, [refresh, scopeKey]);

  const scoped = useCallback((input = {}) => ({
    organizationId,
    tournamentId: activeTournament?.id,
    categoryId,
    ...input,
  }), [activeTournament?.id, categoryId, organizationId]);

  const actions = useMemo(() => ({
    freeze: (input = {}) => mutate(
      () => service.freezeParticipants(scoped({
        ...input,
        idempotencyKey: input.idempotencyKey || service.createIdempotencyKey(),
      })),
      'Lista de participantes confirmada.',
    ),
    reopen: (reason) => mutate(
      () => service.reopenParticipants(scoped({ reason })),
      'Participantes reabiertos. El fixture requiere una versión nueva.',
    ),
    savePots: (pots) => mutate(
      () => service.saveDrawPots(scoped({ pots })),
      'Bombos y orden de sorteo guardados.',
    ),
    draw: (input) => mutate(
      () => service.executeGroupDraw(scoped(input)),
      input.publish ? 'Sorteo publicado.' : 'Sorteo reproducible ejecutado.',
    ),
    generate: (input = {}) => mutate(
      () => service.generateFixture(scoped({
        ...input,
        idempotencyKey: input.idempotencyKey || service.createIdempotencyKey(),
      })),
      'Nueva versión borrador generada.',
    ),
    createManual: (sourceFixtureVersionId = null) => mutate(
      () => service.createManualFixture(scoped({
        sourceFixtureVersionId,
        idempotencyKey: service.createIdempotencyKey(),
      })),
      sourceFixtureVersionId ? 'Copia editable creada.' : 'Versión manual vacía creada.',
    ),
    updateDraft: (fixtureVersionId, action, payload) => mutate(
      () => service.updateDraftFixture(scoped({ fixtureVersionId, action, payload })),
      'Versión borrador actualizada.',
    ),
    validateFixture: (fixtureVersionId) => service.validateFixture(
      scoped({ fixtureVersionId }),
    ),
    publish: (fixtureVersionId) => mutate(
      async () => {
        const result = await service.publishFixture(scoped({ fixtureVersionId }));
        await refreshCompetition();
        return result;
      },
      'Fixture publicado. Se cerró el alta normal de equipos.',
    ),
    supersede: (fixtureVersionId) => mutate(
      () => service.supersedeFixture(scoped({
        fixtureVersionId,
        idempotencyKey: service.createIdempotencyKey(),
      })),
      'Copia draft creada para aplicar cambios.',
    ),
    createVenue: (input) => mutate(
      () => service.createVenue(scoped(input)),
      'Sede creada.',
    ),
    createCourt: (input) => mutate(
      () => service.createCourt(scoped(input)),
      'Cancha creada.',
    ),
    saveWindows: (windows) => mutate(
      () => service.saveScheduleWindows(scoped({ windows })),
      'Ventanas de programación guardadas.',
    ),
    schedule: (input) => mutate(
      () => service.scheduleMatch(scoped(input)),
      'Partido programado.',
    ),
    validateSchedule: (input) => service.validateMatchSchedule(scoped(input)),
    reschedule: (input) => mutate(
      () => service.rescheduleMatch(scoped(input)),
      'Partido reprogramado con historial.',
    ),
    changeMatchPlan: (input) => mutate(
      () => service.changeMatchPlan(scoped(input)),
      'Estado de planificación actualizado.',
    ),
    autoSchedule: (fixtureVersionId) => mutate(
      () => service.autoScheduleMatches(scoped({ fixtureVersionId })),
      'Programación automática básica completada.',
    ),
  }), [mutate, refreshCompetition, scoped, service]);

  const value = useMemo(() => ({
    ...state,
    ...state.data,
    categories,
    categoryId,
    queryCategoryId,
    activeCategory: categories.find((category) => category.id === categoryId) || null,
    setCategoryId: selectCategory,
    refresh,
    actions,
  }), [actions, categories, categoryId, queryCategoryId, refresh, selectCategory, state]);

  return (
    <TorneosFixtureContext.Provider value={value}>
      {children}
    </TorneosFixtureContext.Provider>
  );
}

export function useTorneosFixture() {
  const context = useContext(TorneosFixtureContext);
  if (!context) {
    throw new Error('useTorneosFixture must be used inside TorneosFixtureProvider');
  }
  return context;
}
