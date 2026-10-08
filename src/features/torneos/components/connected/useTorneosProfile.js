import { useCallback, useEffect, useRef, useState } from 'react';
import { useOptionalAuth } from '../../../../components/AuthContext';
import { useTorneosWorkspace } from '../../context/TorneosWorkspaceContext';

export const TORNEOS_PROFILE_CHANGED = 'arma2:torneos-profile-changed';

// The shared identity (Core name and avatar) is only an initial READ fallback. Torneos never writes it: its own
// presentation name lives in tournament_user_profiles.
export function coreDisplayName(profile, user) {
  return String(profile?.nombre || user?.user_metadata?.full_name || user?.email?.split('@')[0] || '').trim();
}

export function useTorneosProfile() {
  const { user = null, profile: coreProfile = null } = useOptionalAuth() || {};
  const { service, status } = useTorneosWorkspace();
  const supported = typeof service?.loadTorneosProfile === 'function';
  const requestRef = useRef(0);
  const [state, setState] = useState({ status: supported ? 'loading' : 'unsupported', profile: null, error: '' });

  const load = useCallback(async () => {
    if (!supported || status !== 'ready') return;
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    try {
      const profile = await service.loadTorneosProfile();
      if (requestRef.current === requestId) setState({ status: 'ready', profile, error: '' });
    } catch (error) {
      if (requestRef.current === requestId) setState({ status: 'error', profile: null, error: error?.message || '' });
    }
  }, [service, status, supported]);

  useEffect(() => {
    load();
    const onChange = () => { load(); };
    window.addEventListener(TORNEOS_PROFILE_CHANGED, onChange);
    return () => {
      window.removeEventListener(TORNEOS_PROFILE_CHANGED, onChange);
      requestRef.current += 1;
    };
  }, [load]);

  const fallbackName = coreDisplayName(coreProfile, user);
  const displayName = state.profile?.displayName || fallbackName || 'Tu cuenta';
  return {
    ...state,
    supported,
    displayName,
    fallbackName,
    usesFallback: !state.profile?.displayName,
    avatarUrl: coreProfile?.avatar_url || user?.user_metadata?.avatar_url || user?.user_metadata?.picture || null,
    email: user?.email || null,
    reload: load,
  };
}

export function announceTorneosProfileChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(TORNEOS_PROFILE_CHANGED));
}
