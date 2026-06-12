import React, { useState, useEffect, createContext, useContext, useCallback, useRef } from 'react';
import { supabase, getProfile, createOrUpdateProfile } from '../supabase';
import AppLoadingScreen from './AppLoadingScreen';
import { clearAuthFlowIfSessionSettled } from '../services/auth/socialAuth';
import { clearSentryUser, setSentryUser } from '../utils/monitoring/sentry';

const AuthContext = createContext();
let authProviderInstanceCounter = 0;

const LOCAL_EDIT_MODE = process.env.NODE_ENV === 'development' && process.env.REACT_APP_LOCAL_EDIT_MODE !== 'false';
const LOCAL_DEV_USER_ID = '00000000-0000-4000-8000-000000000001';
const LOCAL_DEV_PROFILE_KEY = 'local:dev:profile';

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

const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const instanceIdRef = useRef(authProviderInstanceCounter += 1);
  const authResolved = !loading;
  const shouldShowBlockingSpinner = loading && process.env.NODE_ENV === 'production';
  const shouldPassThroughWhileLoading = loading && process.env.NODE_ENV !== 'production';

  const activateLocalDevSession = useCallback(() => {
    const devUser = createLocalDevUser();
    const devProfile = loadLocalDevProfile();
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

    try {
      let profileData;
      try {
        profileData = await getProfile(currentUser.id);

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
            console.warn('[AUTH] Could not hydrate usuarios.avatar_url from metadata:', updateUsuarioError);
          } else {
            profileData = { ...profileData, avatar_url: metadataAvatar };
          }

          if (updateProfileError) {
            console.warn('[AUTH] Could not hydrate profiles.avatar_url from metadata:', updateProfileError);
          }
        }
      } catch (error) {
        // Only create profile when PostgREST returned "no rows" (PGRST116).
        // For any other error (SQL, missing column 42703, network, etc.) log and stop.
        console.error('Error fetching profile from getProfile:', error);
        const code = error?.code || error?.status || null;
        if (code === 'PGRST116' || code === 116) {
          profileData = await createOrUpdateProfile(currentUser);
        } else {
          // Unexpected error: do NOT try to create a profile or continue — stop to avoid loops/rate limits.
          console.error('Unexpected error fetching profile, aborting profile creation to avoid loops:', error);
          setProfile(null);
          return;
        }
      }

      setProfile(profileData);
    } catch (error) {
      console.error('Error with profile:', error);
      setProfile(null);
    }
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
    const instanceId = instanceIdRef.current;

    const init = async () => {
      let sessionExists = false;
      let sessionUserExists = false;
      let sessionUserId = null;

      try {
        const { data: { session } } = await supabase.auth.getSession();
        sessionExists = Boolean(session);
        sessionUserExists = Boolean(session?.user);
        sessionUserId = session?.user?.id || null;

        if (!mounted) return;

        if (session?.user) {
          clearAuthFlowIfSessionSettled();
          setUser(session.user);
          setLoading(false);
          Promise.resolve(fetchProfile(session.user)).catch((profileError) => {
            console.error('[AUTH] Error fetching profile during init:', profileError);
          });
        } else if (LOCAL_EDIT_MODE) {
          let activated = false;
          try {
            const { data, error } = await supabase.auth.signInAnonymously();
            if (!mounted) return;
            if (!error && data?.user) {
              setUser(data.user);
              setLoading(false);
              Promise.resolve(fetchProfile(data.user)).catch((profileError) => {
                console.error('[AUTH] Error fetching anonymous profile:', profileError);
              });
              activated = true;
            } else if (error) {
              console.warn('[AUTH] Anonymous sign-in unavailable:', error.message);
            }
          } catch (anonError) {
            console.warn('[AUTH] Anonymous sign-in failed:', anonError);
          }
          if (!mounted) return;
          if (!activated) {
            activateLocalDevSession();
            setLoading(false);
          }
        } else {
          setUser(null);
          setProfile(null);
          setLoading(false);
        }
      } catch (error) {
        console.error('[AUTH] Error getting initial session:', error);
        if (!mounted) return;
        if (LOCAL_EDIT_MODE) {
          activateLocalDevSession();
          setLoading(false);
        } else {
          setUser(null);
          setProfile(null);
          setLoading(false);
        }
      }
    };

    init();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (session?.user) {
        clearAuthFlowIfSessionSettled();
        setUser(session.user);
        setLoading(false);
        Promise.resolve(fetchProfile(session.user)).catch((profileError) => {
          console.error('[AUTH] Error fetching profile on auth change:', profileError);
        });
      } else if (LOCAL_EDIT_MODE) {
        activateLocalDevSession();
        setLoading(false);
      } else {
        setUser(null);
        setProfile(null);
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
