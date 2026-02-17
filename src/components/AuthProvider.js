import React, { useState, useEffect, createContext, useContext } from 'react';
import { supabase, getProfile, createOrUpdateProfile } from '../supabase';
import LoadingSpinner from './LoadingSpinner';

const AuthContext = createContext();

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
  const fetchProfile = async (currentUser) => {
    console.log('AuthProvider fetchProfile called with:', currentUser?.id);
    if (!currentUser) {
      setProfile(null);
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
      // Async check to observe the actual state value after React processes the update
      setTimeout(() => {
        console.log('[AUTH] profile state after set (async)', profile?.avatar_url);
      }, 0);
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
    if (user) {
      await fetchProfile(user);
    }
  };

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      console.log('Initial session:', session?.user?.id);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user);
      }
      setLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user);
      } else {
        setProfile(null);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const value = {
    user,
    profile,
    loading,
    refreshProfile,
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
