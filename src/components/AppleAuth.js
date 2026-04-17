import React from 'react';
import { FaApple } from 'react-icons/fa';
import { canShowAppleSignIn, signInWithApple } from '../services/auth/socialAuth';

const AppleAuth = ({
  user,
  className,
  disabled = false,
  loading = false,
  onError,
}) => {
  const handleAppleSignIn = async () => {
    if (disabled) return;

    try {
      await signInWithApple({ source: 'auth_button' });
    } catch (error) {
      if (typeof onError === 'function') onError(error);
    }
  };

  if (user || !canShowAppleSignIn()) return null;

  return (
    <button
      type="button"
      onClick={handleAppleSignIn}
      className={className || 'apple-sign-in-btn'}
      disabled={disabled}
      aria-label="Ingresar con Apple"
    >
      <FaApple size={18} aria-hidden="true" />
      {loading ? 'Conectando con Apple...' : 'Ingresar con Apple'}
    </button>
  );
};

export default AppleAuth;
