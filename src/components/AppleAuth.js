import React from 'react';
import { Capacitor } from '@capacitor/core';
import { SignInWithApple } from '@capacitor-community/apple-sign-in';
import { supabase } from '../supabase';
import { notifyBlockingError } from 'utils/notifyBlockingError';
import { setAuthReturnTo } from '../utils/authReturnTo';
import { track } from '../utils/monitoring/analytics';

const isNativeIosPlatform = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
const APPLE_NATIVE_CLIENT_ID = 'com.teambalancer.app';
const APPLE_NATIVE_REDIRECT_URI = process.env.REACT_APP_AUTH_REDIRECT_URL || 'com.teambalancer.app://auth/callback';

function generateRawNonce(length = 32) {
  const charset = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-._';
  const randomValues = new Uint8Array(length);
  window.crypto.getRandomValues(randomValues);

  return Array.from(randomValues, (value) => charset[value % charset.length]).join('');
}

async function sha256(value) {
  const digest = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function getAppleIdentityToken(result) {
  return result?.response?.identityToken || result?.identityToken || result?.response?.id_token || result?.id_token || null;
}

function getAppleErrorMessage(error) {
  return error?.message || String(error || '');
}

function isAppleCancelError(error) {
  const message = getAppleErrorMessage(error).toLowerCase();
  return message.includes('1001') || message.includes('cancel') || message.includes('cancelado');
}

const AppleAuth = ({ className, disabled = false, loading = false, onStart, onEnd, onSuccess, returnTo = '/home' }) => {
  const signInWithApple = async () => {
    if (disabled || !isNativeIosPlatform()) return;

    if (returnTo) setAuthReturnTo(returnTo);
    if (typeof onStart === 'function') onStart();
    track('login_started', {
      method: 'apple',
      source: 'auth_button',
    });

    try {
      if (!window.crypto?.getRandomValues || !window.crypto?.subtle) {
        throw new Error('Apple Sign In requiere crypto seguro en el dispositivo.');
      }

      const rawNonce = generateRawNonce();
      const hashedNonce = await sha256(rawNonce);
      const result = await SignInWithApple.authorize({
        clientId: APPLE_NATIVE_CLIENT_ID,
        redirectURI: APPLE_NATIVE_REDIRECT_URI,
        scopes: 'email name',
        state: rawNonce,
        nonce: hashedNonce,
      });

      const identityToken = getAppleIdentityToken(result);
      if (!identityToken) {
        throw new Error('Apple no devolvió identity token.');
      }

      const { data, error } = await supabase.auth.signInWithIdToken({
        provider: 'apple',
        token: identityToken,
        nonce: rawNonce,
      });

      if (error) {
        notifyBlockingError(`Error al iniciar sesion con Apple: ${error.message}`);
        console.error('Error signing in with Apple:', error);
        return;
      }

      if (!data?.session) {
        throw new Error('No se pudo crear sesión con Apple.');
      }

      track('login_success', {
        provider: 'apple',
        user_id: data.session.user?.id,
        method: 'native_id_token',
      });

      if (typeof onSuccess === 'function') onSuccess(data);
    } catch (error) {
      if (isAppleCancelError(error)) return;

      notifyBlockingError(`Error inesperado: ${getAppleErrorMessage(error)}`);
      console.error('Unexpected Apple auth error:', error);
    } finally {
      if (typeof onEnd === 'function') onEnd();
    }
  };

  if (!isNativeIosPlatform()) return null;

  return (
    <button type="button" onClick={signInWithApple} className={className || 'apple-sign-in-btn'} disabled={disabled}>
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" style={{ marginRight: '8px' }}>
        <path
          fill="currentColor"
          d="M16.37 1.51c0 1.04-.42 2.04-1.1 2.78-.73.79-1.93 1.39-2.89 1.31-.13-1 .37-2.06 1.02-2.78.72-.8 1.98-1.41 2.97-1.31ZM20.61 17.42c-.54 1.25-.8 1.81-1.49 2.91-.97 1.49-2.34 3.35-4.03 3.37-.75.01-1.26-.22-1.81-.47-.58-.26-1.2-.54-2.16-.54-.98 0-1.64.29-2.24.56-.53.24-1.03.47-1.73.48-1.61.06-2.84-1.61-3.82-3.1-2.68-4.1-2.96-8.9-1.31-11.45 1.18-1.82 3.03-2.89 4.78-2.89.87 0 1.53.29 2.11.55.55.25 1.03.46 1.67.46.58 0 1.03-.2 1.59-.45.64-.28 1.42-.63 2.55-.6.84.03 3.2.34 4.71 2.55-4.14 2.27-3.47 8.16.72 8.62Z"
        />
      </svg>
      {loading ? 'Conectando con Apple...' : 'Continuar con Apple'}
    </button>
  );
};

export default AppleAuth;
