import React from 'react';
import { supabase } from '../supabase';
import { toast } from 'react-toastify';

const GoogleAuth = ({ user }) => {
  const signInWithGoogle = async () => {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin
        }
      });
      
      if (error) {
        toast.error(`Error al iniciar sesión con Google: ${error.message}`);
        console.error('Error signing in with Google:', error);
      }
    } catch (error) {
      toast.error(`Error inesperado: ${error.message}`);
      console.error('Unexpected error:', error);
    }
  };

  if (user) return null;

  return (
    <button onClick={signInWithGoogle} className="google-sign-in-btn">
      <svg width="18" height="18" viewBox="0 0 18 18" style={{ marginRight: '8px' }}>
        <path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18z"/>
        <path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2.04a4.8 4.8 0 0 1-7.18-2.53H1.83v2.07A8 8 0 0 0 8.98 17z"/>
        <path fill="#FBBC05" d="M4.5 10.49a4.8 4.8 0 0 1 0-3.07V5.35H1.83a8 8 0 0 0 0 7.28l2.67-2.14z"/>
        <path fill="#EA4335" d="M8.98 3.58c1.32 0 2.5.45 3.44 1.35l2.54-2.59a8 8 0 0 0-5.98-2.26 8 8 0 0 0-7.15 4.42l2.67 2.14c.63-1.89 2.39-3.06 4.48-3.06z"/>
      </svg>
      Ingresar con Google
    </button>
  );
};

export default GoogleAuth;