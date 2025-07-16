import { useAuth } from '../components/AuthProvider';

export function useProfile() {
  const { profile, loading, refreshProfile } = useAuth();

  const updateProfile = (updatedProfile) => {
    // The profile will be updated through AuthProvider's refreshProfile
    refreshProfile();
  };

  return {
    profile,
    loading,
    updateProfile,
    refreshProfile
  };
}