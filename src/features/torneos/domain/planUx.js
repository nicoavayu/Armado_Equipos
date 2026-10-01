// Confirmed labels are always scoped to the displayed season.
export function describePlanState(state, season) {
  if (!season) return state?.status === 'loading' ? 'Cargando plan…' : 'Sin temporada';
  if (state?.status === 'ready' && state.data?.isTrusted
    && state.data.scope?.seasonId === season.id && ['FREE', 'PREMIUM'].includes(state.data.plan)) return state.data.plan;
  if (state?.status === 'loading') return 'Cargando plan…';
  if (state?.status === 'unavailable') return 'Lectura no disponible';
  return 'Error transitorio';
}
