import logger from '../utils/logger';
import React, { useState, useEffect, useContext, useCallback, useRef } from 'react';
import { supabase, getProfile, createOrUpdateProfile } from '../supabase';
import AppLoadingScreen from './AppLoadingScreen';
import { clearAuthFlowIfSessionSettled } from '../services/auth/socialAuth';
import { clearSentryUser, setSentryUser } from '../utils/monitoring/sentry';
import { withTimeout } from '../utils/promiseTimeout';

import { AuthContext } from './AuthContext';
let authProviderInstanceCounter = 0;

const LOCAL_EDIT_MODE = process.env.NODE_ENV === 'development' && process.env.REACT_APP_LOCAL_EDIT_MODE !== 'false';
const LOCAL_DEV_USER_ID = '00000000-0000-4000-8000-000000000001';
const LOCAL_DEV_PROFILE_KEY = 'local:dev:profile';
const INITIAL_SESSION_TIMEOUT_MS = 12000;

function createLocalDevUser() {
  return {
    id: LOCAL_DEV_USER_ID,
    email: 'local@arma2.dev',
    user_metadata: {
      full_name: 'Local Dev',
      avatar_url: null,
    },
    app_metadata: {
      provider: 'local-dev',
    },
    aud: 'authenticated',
    role: 'authenticated',
  };
}

function createLocalDevProfile() {
  return {
    id: LOCAL_DEV_USER_ID,
    nombre: 'Local Dev',
    email: 'local@arma2.dev',
    avatar_url: null,
    telefono: '',
    localidad: 'Localhost',
    nacionalidad: 'argentina',
    pais_codigo: 'AR',
    posicion: 'DEF',
    ranking: 5,
    partidos_jugados: 0,
    partidos_abandonados: 0,
    acepta_invitaciones: true,
    profile_completion: 70,
    updated_at: new Date().toISOString(),
  };
}

function isLocalDevUser(user) {
  return Boolean(
    user &&
      (user.id === LOCAL_DEV_USER_ID || user.app_metadata?.provider === 'local-dev'),
  );
}

function getSentryUserContext(currentUser) {
  if (!currentUser || isLocalDevUser(currentUser)) return null;

  const provider = [
    currentUser.app_metadata?.provider,
    Array.isArray(currentUser.app_metadata?.providers) ? currentUser.app_metadata.providers[0] : null,
    currentUser.aud,
    currentUser.role,
  ].find((value) => typeof value === 'string' && value.trim() !== '');

  return {
    id: currentUser.id,
    segment: provider || 'authenticated',
  };
}

const stableJson = (value) => {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return null;
  }
};

// supabase-js emits SIGNED_IN / TOKEN_REFRESHED with a freshly parsed user object every time
// the app returns to the foreground. Same account + same server snapshot = same identity, so
// consumers keyed on `user` do not re-run their effects (and refetch) on every focus.
function isSameUserSnapshot(previous, next) {
  if (!previous || !next) return false;
  return previous.id === next.id
    && previous.email === next.email
    && previous.updated_at === next.updated_at
    && previous.email_confirmed_at === next.email_confirmed_at
    && stableJson(previous.user_metadata) === stableJson(next.user_metadata)
    && stableJson(previous.app_metadata) === stableJson(next.app_metadata);
}

function loadLocalDevProfile() {
  if (typeof window === 'undefined') return createLocalDevProfile();
  try {
    const raw = window.localStorage.getItem(LOCAL_DEV_PROFILE_KEY);
    if (!raw) return createLocalDevProfile();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return createLocalDevProfile();
    return { ...createLocalDevProfile(), ...parsed };
  } catch {
    return createLocalDevProfile();
  }
}

function saveLocalDevProfile(profile) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LOCAL_DEV_PROFILE_KEY, JSON.stringify(profile));
  } catch {
    // no-op (private mode / quota)
  }
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};
export { useOptionalAuth } from './AuthContext';

const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const instanceIdRef = useRef(authProviderInstanceCounter += 1);
  // Session isolation: the account the provider currently represents, the latest profile
  // request (older responses are dropped) and which account the loaded profile belongs to.
  const activeUserIdRef = useRef(null);
  const profileRequestRef = useRef(0);
  const profileStateRef = useRef({ userId: null, loading: false });
  const authResolved = !loading;
  const shouldShowBlockingSpinner = loading && process.env.NODE_ENV === 'production';
  const shouldPassThroughWhileLoading = loading && process.env.NODE_ENV !== 'production';

  const activateLocalDevSession = useCallback(() => {
    const devUser = createLocalDevUser();
    const devProfile = loadLocalDevProfile();
    activeUserIdRef.current = devUser.id;
    profileRequestRef.current += 1;
    profileStateRef.current = { userId: devUser.id, loading: false };
    setUser(devUser);
    setProfile(devProfile);
    return devUser;
  }, []);

  const fetchProfile = async (currentUser) => {
    if (!currentUser) {
      setProfile(null);
      return;
    }

    if (isLocalDevUser(currentUser)) {
      setProfile(loadLocalDevProfile());
      return;
    }

    const requestId = profileRequestRef.current + 1;
    profileRequestRef.current = requestId;
    profileStateRef.current = { userId: currentUser.id, loading: true };
    // A response is applied only while it is still the latest request for the account the
    // provider represents: a slow answer for a previous account (or after sign-out) is dropped.
    const isCurrent = () => profileRequestRef.current === requestId
      && activeUserIdRef.current === currentUser.id;
    const applyProfile = (nextProfile) => {
      if (!isCurrent()) return;
      profileStateRef.current = { userId: nextProfile ? currentUser.id : null, loading: false };
      setProfile(nextProfile);
    };

    try {
      let profileData;
      try {
        profileData = await getProfile(currentUser.id);
        if (!isCurrent()) return;

        const metadataAvatar = (currentUser.user_metadata?.avatar_url || currentUser.user_metadata?.picture || '').trim();
        if (metadataAvatar && !profileData?.avatar_url) {
          const [{ error: updateUsuarioError }, { error: updateProfileError }] = await Promise.all([
            supabase
              .from('usuarios')
              .update({
                avatar_url: metadataAvatar,
                updated_at: new Date().toISOString(),
              })
              .eq('id', currentUser.id),
            supabase
              .from('profiles')
              .update({ avatar_url: metadataAvatar })
              .eq('id', currentUser.id),
          ]);

          if (updateUsuarioError) {
            logger.warn('[AUTH] Could not hydrate usuarios.avatar_url from metadata:', updateUsuarioError);
          } else {
            profileData = { ...profileData, avatar_url: metadataAvatar };
          }

          if (updateProfileError) {
            logger.warn('[AUTH] Could not hydrate profiles.avatar_url from metadata:', updateProfileError);
          }
        }
      } catch (error) {
        // Only create profile when PostgREST returned "no rows" (PGRST116).
        // For any other error (SQL, missing column 42703, network, etc.) log and stop.
        logger.error('Error fetching profile from getProfile:', error);
        const code = error?.code || error?.status || null;
        if (!isCurrent()) return;
        if (code === 'PGRST116' || code === 116) {
          profileData = await createOrUpdateProfile(currentUser);
        } else {
          // Unexpected error: do NOT try to create a profile or continue — stop to avoid loops/rate limits.
          logger.error('Unexpected error fetching profile, aborting profile creation to avoid loops:', error);
          applyProfile(null);
          return;
        }
      }

      applyProfile(profileData);
    } catch (error) {
      logger.error('Error with profile:', error);
      applyProfile(null);
    }
  };

  // Applies a session's user. A different account replaces identity and hides the previous
  // profile at once; the same account keeps its identity unless the server snapshot changed,
  // and only refetches the profile on USER_UPDATED or when none is loaded or loading for it.
  const applySessionUser = (nextUser, event) => {
    const sameAccount = activeUserIdRef.current === nextUser.id;
    activeUserIdRef.current = nextUser.id;
    setUser((previous) => (isSameUserSnapshot(previous, nextUser) ? previous : nextUser));
    if (!sameAccount) {
      profileRequestRef.current += 1;
      profileStateRef.current = { userId: null, loading: false };
      setProfile(null);
    }
    const profileState = profileStateRef.current;
    const profileCoversUser = profileState.userId === nextUser.id;
    if (!sameAccount || event === 'USER_UPDATED' || !profileCoversUser) {
      Promise.resolve(fetchProfile(nextUser)).catch((profileError) => {
        logger.error('[AUTH] Error fetching profile:', profileError);
      });
    }
  };

  const clearSessionUser = () => {
    activeUserIdRef.current = null;
    profileRequestRef.current += 1;
    profileStateRef.current = { userId: null, loading: false };
    setUser(null);
    setProfile(null);
  };

  const refreshProfile = async () => {
    if (isLocalDevUser(user)) {
      setProfile(loadLocalDevProfile());
      return;
    }
    if (user) {
      await fetchProfile(user);
    }
  };

  const updateLocalProfile = useCallback((patch = {}) => {
    if (!LOCAL_EDIT_MODE) return;
    setProfile((prev) => {
      const base = prev && prev.id === LOCAL_DEV_USER_ID ? prev : loadLocalDevProfile();
      const next = { ...base, ...patch, updated_at: new Date().toISOString() };
      saveLocalDevProfile(next);
      return next;
    });
  }, []);

  useEffect(() => {
    let mounted = true;
    // Once the auth listener has delivered a state it is authoritative: a slower initial
    // getSession() must not re-apply an older account over it.
    let listenerHasSpoken = false;
    const instanceId = instanceIdRef.current;

    const init = async () => {
      let sessionExists = false;
      let sessionUserExists = false;
      let sessionUserId = null;

      try {
        const { data: { session } } = await withTimeout(
          supabase.auth.getSession(),
          INITIAL_SESSION_TIMEOUT_MS,
          'No pudimos verificar tu sesión porque Supabase no respondió a tiempo.',
        );
        sessionExists = Boolean(session);
        sessionUserExists = Boolean(session?.user);
        sessionUserId = session?.user?.id || null;

        if (!mounted) return;
        if (listenerHasSpoken) {
          setLoading(false);
          return;
        }

        if (session?.user) {
          clearAuthFlowIfSessionSettled();
          applySessionUser(session.user, 'INITIAL_SESSION');
          setLoading(false);
        } else if (LOCAL_EDIT_MODE) {
          let activated = false;
          try {
            const { data, error } = await supabase.auth.signInAnonymously();
            if (!mounted) return;
            if (!error && data?.user) {
              applySessionUser(data.user, 'SIGNED_IN');
              setLoading(false);
              activated = true;
            } else if (error) {
              logger.warn('[AUTH] Anonymous sign-in unavailable:', error.message);
            }
          } catch (anonError) {
            logger.warn('[AUTH] Anonymous sign-in failed:', anonError);
          }
          if (!mounted) return;
          if (!activated) {
            activateLocalDevSession();
            setLoading(false);
          }
        } else {
          clearSessionUser();
          setLoading(false);
        }
      } catch (error) {
        logger.error('[AUTH] Error getting initial session:', error);
        if (!mounted) return;
        if (listenerHasSpoken) {
          setLoading(false);
        } else if (LOCAL_EDIT_MODE) {
          activateLocalDevSession();
          setLoading(false);
        } else {
          clearSessionUser();
          setLoading(false);
        }
      }
    };

    init();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      listenerHasSpoken = true;
      if (session?.user) {
        clearAuthFlowIfSessionSettled();
        applySessionUser(session.user, event);
        setLoading(false);
      } else if (LOCAL_EDIT_MODE) {
        activateLocalDevSession();
        setLoading(false);
      } else {
        clearSessionUser();
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [activateLocalDevSession]);

  useEffect(() => {
    if (!user || isLocalDevUser(user)) {
      clearSentryUser();
      return;
    }

    setSentryUser(getSentryUserContext(user));
  }, [user]);

  const value = {
    user,
    profile,
    loading,
    authResolved,
    refreshProfile,
    updateLocalProfile,
    localEditMode: LOCAL_EDIT_MODE,
  };

  if (shouldShowBlockingSpinner) {
    return <AppLoadingScreen />;
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export default AuthProvider;
