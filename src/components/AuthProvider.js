import React, { useState, useEffect, createContext, useContext } from 'react';
import { supabase, getProfile, createOrUpdateProfile, updateProfile } from '../supabase';
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
        
        // Siempre actualizar el avatar_url si viene de un proveedor social
        const metadataAvatar = currentUser.user_metadata?.avatar_url || currentUser.user_metadata?.picture;
        if (metadataAvatar) {
          console.log('Updating profile with avatar from user metadata:', metadataAvatar);
          profileData = await updateProfile(currentUser.id, { avatar_url: metadataAvatar });
        }
      } catch (error) {
        // Profile doesn't exist, create it
        console.log('Profile not found, creating new profile for user:', currentUser.id);
        profileData = await createOrUpdateProfile(currentUser);
        console.log('New profile created:', profileData);
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