import { useEffect, useMemo, useState } from 'react';

import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../components/AuthProvider';
import logger from '../../utils/logger';
import { getChecklistContent, ONBOARDING_PATHS } from './content';

// Derive checklist completion from REAL product data. Each signal is an
// independent, error-tolerant query: a failed/unknown signal simply stays
// "not done" (never falsely completed, never crashes). Visiting a screen never
// marks anything — only the underlying action does.

const hasValue = (value) => value !== null && value !== undefined && String(value).trim() !== '';

function deriveProfileComplete(profile) {
  if (!profile) return false;
  const completion = Number(profile.profile_completion ?? 0);
  if (Number.isFinite(completion) && completion >= 60) return true;
  const hasName = hasValue(profile.nombre);
  const hasPlace = hasValue(profile.localidad) || hasValue(profile.location_city);
  const hasPos = hasValue(profile.posicion) || hasValue(profile.posicion_favorita);
  return hasName && hasPlace && hasPos;
}

function deriveHasLocation(profile) {
  if (!profile) return false;
  const lat = Number(profile.latitud);
  const lng = Number(profile.longitud);
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0);
  return hasCoords || hasValue(profile.location_city) || hasValue(profile.localidad);
}

async function queryHasCreatedMatch(userId) {
  const [{ count: partidosCount }, manual] = await Promise.all([
    supabase.from('partidos').select('id', { count: 'exact', head: true }).eq('creado_por', userId),
    supabase.from('partidos_manuales').select('id', { count: 'exact', head: true }).eq('usuario_id', userId),
  ]);
  if (Number(partidosCount || 0) > 0) return true;
  return Number(manual?.count || 0) > 0;
}

async function queryHasInvited(userId) {
  const { data: created } = await supabase.from('partidos').select('id').eq('creado_por', userId).limit(50);
  const ids = (created || []).map((row) => row.id).filter((id) => id != null);
  if (ids.length === 0) return false;
  const { data: others } = await supabase
    .from('jugadores')
    .select('id')
    .in('partido_id', ids)
    .neq('usuario_id', userId)
    .limit(1);
  return Array.isArray(others) && others.length > 0;
}

async function queryHasVoted(userId) {
  const { data } = await supabase.from('votos').select('id').eq('votante_id', userId).limit(1);
  return Array.isArray(data) && data.length > 0;
}

async function queryHasActiveAvailability(userId) {
  const { data } = await supabase
    .from('player_availability')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'active')
    .limit(1);
  return Array.isArray(data) && data.length > 0;
}

async function queryHasConfirmedOpportunity(userId) {
  const { data } = await supabase
    .from('auto_match_proposal_members')
    .select('proposal_id')
    .eq('user_id', userId)
    .eq('response', 'accepted')
    .limit(1);
  return Array.isArray(data) && data.length > 0;
}

// Map derive-key -> async resolver. Sync (profile-based) keys resolve inline.
const ASYNC_DERIVERS = {
  hasCreatedMatch: queryHasCreatedMatch,
  hasInvited: queryHasInvited,
  hasVoted: queryHasVoted,
  hasActiveAvailability: queryHasActiveAvailability,
  hasConfirmedOpportunity: queryHasConfirmedOpportunity,
};

export function useOnboardingChecklist(pathKey, { refreshNonce = 0 } = {}) {
  const { user, profile } = useAuth();
  const userId = user?.id || null;
  const content = getChecklistContent(pathKey || ONBOARDING_PATHS.OVERVIEW);
  const [signals, setSignals] = useState({});
  const [loading, setLoading] = useState(true);

  const neededAsyncKeys = useMemo(() => {
    const keys = new Set();
    content.items.forEach((item) => {
      if (ASYNC_DERIVERS[item.derive]) keys.add(item.derive);
    });
    return Array.from(keys);
  }, [content]);

  useEffect(() => {
    let cancelled = false;
    if (!userId) {
      setSignals({});
      setLoading(false);
      return () => { cancelled = true; };
    }

    setLoading(true);
    (async () => {
      const entries = await Promise.all(neededAsyncKeys.map(async (key) => {
        try {
          const value = await ASYNC_DERIVERS[key](userId);
          return [key, Boolean(value)];
        } catch (error) {
          logger.warn('[ONBOARDING] checklist signal failed', { key, code: error?.code || null });
          return [key, false];
        }
      }));
      if (cancelled) return;
      setSignals(Object.fromEntries(entries));
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [userId, neededAsyncKeys, refreshNonce]);

  const items = useMemo(() => content.items.map((item) => {
    let done = false;
    if (item.derive === 'profileComplete') done = deriveProfileComplete(profile);
    else if (item.derive === 'hasLocation') done = deriveHasLocation(profile);
    else done = Boolean(signals[item.derive]);
    return { ...item, done };
  }), [content, profile, signals]);

  const completedCount = items.filter((item) => item.done).length;
  const allDone = items.length > 0 && completedCount === items.length;

  return {
    title: content.title,
    items,
    completedCount,
    total: items.length,
    allDone,
    loading,
  };
}

export default useOnboardingChecklist;
