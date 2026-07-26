import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
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
  const { activeTournament } = useTorneosCompetition();
  const requestRef = useRef(0);
  const scopeRef = useRef('');
  const [categoryId, setCategoryId] = useState(null);
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
  const scopeKey = `${organizationId || ''}:${activeTournament?.id || ''}:${categoryId || ''}`;
  scopeRef.current = scopeKey;

  useEffect(() => {
    setCategoryId((current) => (
      categories.some((category) => category.id === current)
        ? current
        : categories[0]?.id || null
    ));
  }, [activeTournament?.id, categories]);

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
      'Participantes cerrados y fotografiados.',
    ),
    reopen: (reason) => mutate(
      () => service.reopenParticipants(scoped({ reason })),
      'Participantes reabiertos. El fixture requiere una versión nueva.',
    ),
    savePots: (pots) => mutate(
      () => service.saveDrawPots(scoped({ pots })),
      'Bombos y seeds guardados.',
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
      'Nueva versión draft generada.',
    ),
    createManual: (sourceFixtureVersionId = null) => mutate(
      () => service.createManualFixture(scoped({
        sourceFixtureVersionId,
        idempotencyKey: service.createIdempotencyKey(),
      })),
      sourceFixtureVersionId ? 'Copia manual draft creada.' : 'Versión manual vacía creada.',
    ),
    updateDraft: (fixtureVersionId, action, payload) => mutate(
      () => service.updateDraftFixture(scoped({ fixtureVersionId, action, payload })),
      'Versión draft actualizada.',
    ),
    validateFixture: (fixtureVersionId) => service.validateFixture(
      scoped({ fixtureVersionId }),
    ),
    publish: (fixtureVersionId) => mutate(
      () => service.publishFixture(scoped({ fixtureVersionId })),
      'Fixture publicado internamente.',
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
  }), [mutate, scoped, service]);

  const value = useMemo(() => ({
    ...state,
    ...state.data,
    categories,
    categoryId,
    activeCategory: categories.find((category) => category.id === categoryId) || null,
    setCategoryId,
    refresh,
    actions,
  }), [actions, categories, categoryId, refresh, state]);

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
