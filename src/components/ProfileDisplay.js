import React from 'react';
import { useAuth } from './AuthProvider';

const ProfileDisplay = () => {
  const { user, profile } = useAuth();

  if (!user) return null;

  return (
    <div style={{ 
      color: '#fff', 
      padding: '10px', 
      textAlign: 'center',
      fontSize: '14px',
    }}>
      <div>Welcome, {profile?.nombre || user?.email}!</div>
      {profile?.avatar_url && (
        <img 
          src={profile.avatar_url} 
          alt="Profile" 
          style={{ 
            width: '30px', 
            height: '30px', 
            borderRadius: '50%', 
            marginTop: '5px', 
          }} 
        />
      )}
    </div>
  );
};

export default ProfileDisplay;