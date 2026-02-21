import React, { useState, useEffect, createContext, useContext, useCallback } from 'react';
import { supabase, getProfile, createOrUpdateProfile } from '../supabase';
import LoadingSpinner from './LoadingSpinner';

const AuthContext = createContext();

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

  const activateLocalDevSession = useCallback(() => {
    const devUser = createLocalDevUser();
    const devProfile = loadLocalDevProfile();
    setUser(devUser);
    setProfile(devProfile);
    return devUser;
  }, []);

  const fetchProfile = async (currentUser) => {
    console.log('AuthProvider fetchProfile called with:', currentUser?.id);
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
        console.log('Attempting to get existing profile...');
        profileData = await getProfile(currentUser.id);
        console.log('Existing profile found:', profileData);

        const metadataAvatar = (currentUser.user_metadata?.avatar_url || currentUser.user_metadata?.picture || '').trim();
        if (metadataAvatar && !profileData?.avatar_url) {
          console.log('[AUTH] Hydrating missing avatar_url from social metadata');

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
          console.log('Profile not found (PGRST116), creating profile for user:', currentUser.id);
          profileData = await createOrUpdateProfile(currentUser);
          console.log('New profile created:', profileData);
        } else {
          // Unexpected error: do NOT try to create a profile or continue — stop to avoid loops/rate limits.
          console.error('Unexpected error fetching profile, aborting profile creation to avoid loops:', error);
          setProfile(null);
          return;
        }
      }

      setProfile(profileData);
      console.log('Profile set in state:', profileData);
      console.log('Profile avatar fields debug:', {
        avatar_url: profileData?.avatar_url,
        user_metadata_avatar: currentUser.user_metadata?.avatar_url,
        user_metadata_picture: currentUser.user_metadata?.picture,
        all_fields: Object.keys(profileData || {}),
      });
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

    const init = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!mounted) return;

        console.log('Initial session:', session?.user?.id);
        if (session?.user) {
          setUser(session.user);
          await fetchProfile(session.user);
        } else if (LOCAL_EDIT_MODE) {
          let activated = false;
          try {
            const { data, error } = await supabase.auth.signInAnonymously();
            if (!error && data?.user) {
              setUser(data.user);
              await fetchProfile(data.user);
              activated = true;
            } else if (error) {
              console.warn('[AUTH] Anonymous sign-in unavailable:', error.message);
            }
          } catch (anonError) {
            console.warn('[AUTH] Anonymous sign-in failed:', anonError);
          }
          if (!activated) activateLocalDevSession();
        } else {
          setUser(null);
          setProfile(null);
        }
      } catch (error) {
        console.error('[AUTH] Error getting initial session:', error);
        if (LOCAL_EDIT_MODE) {
          activateLocalDevSession();
        } else {
          setUser(null);
          setProfile(null);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };

    init();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      if (session?.user) {
        setUser(session.user);
        fetchProfile(session.user);
      } else if (LOCAL_EDIT_MODE) {
        activateLocalDevSession();
      } else {
        setUser(null);
        setProfile(null);
      }
      setLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [activateLocalDevSession]);

  const value = {
    user,
    profile,
    loading,
    refreshProfile,
    updateLocalProfile,
    localEditMode: LOCAL_EDIT_MODE,
  };

  if (loading) {
    return (
      <div className="voting-bg" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <LoadingSpinner size="large" />
      </div>
    );
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export default AuthProvider;
