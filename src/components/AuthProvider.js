import React, { useState, useEffect, createContext, useContext } from 'react';
import { supabase, getProfile } from '../supabase';
import UserHeader from './UserHeader';
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

  const fetchProfile = async (userId) => {
    if (!userId) {
      setProfile(null);
      return;
    }
    try {
      const profileData = await getProfile(userId);
      setProfile(profileData);
    } catch (error) {
      console.error('Error fetching profile:', error);
      setProfile(null);
    }
  };

  const refreshProfile = async () => {
    if (user?.id) {
      await fetchProfile(user.id);
    }
  };

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id);
      }
      setLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id);
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
    refreshProfile
  };

  if (loading) {
    return (
      <div className="voting-bg">
        <div className="voting-modern-card">
          <LoadingSpinner size="lg" message="Cargando autenticación..." />
        </div>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={value}>
      {user && (
        <UserHeader 
          user={user} 
          profile={profile} 
          onProfileUpdate={refreshProfile}
        />
      )}
      {children}
    </AuthContext.Provider>
  );
};

export default AuthProvider;