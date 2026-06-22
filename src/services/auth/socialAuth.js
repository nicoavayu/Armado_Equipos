import logger from '../../utils/logger';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { SignInWithApple } from '@capacitor-community/apple-sign-in';
import { supabase } from '../../supabase';
import { getAuthRedirectUrl } from '../../utils/authRedirectUrl';
import {
  clearPendingAuthFlow,
  markPendingAuthBrowserOpened,
  markPendingAuthSessionRestored,
  readPendingAuthFlow,
  setAuthFlowResult,
  startPendingAuthFlow,
} from '../../utils/authFlowState';
import { track } from '../../utils/monitoring/analytics';

const IOS_BUNDLE_ID = 'com.teambalancer.app';

const getSafeObjectKeys = (value) => {
  try {
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
      return [];
    }
    return Object.keys(value);
  } catch (_error) {
    return [];
  }
};

const safeTrim = (value) => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

const createRandomToken = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
};

const createSha256Hex = async (value) => {
  const cryptoApi = typeof crypto !== 'undefined' ? crypto : null;
  const textEncoder = typeof TextEncoder !== 'undefined' ? TextEncoder : null;

  if (
    typeof cryptoApi === 'undefined'
    || typeof cryptoApi.subtle === 'undefined'
    || typeof cryptoApi.subtle.digest !== 'function'
    || typeof textEncoder === 'undefined'
  ) {
    throw new Error('SHA-256 no está disponible para Sign in with Apple.');
  }

  const encoded = new textEncoder().encode(value);
  const digest = await cryptoApi.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const stringifyAuthDetails = (details) => {
  try {
    return JSON.stringify(details, (_key, value) => {
      if (value instanceof Error) {
        return {
          name: value.name,
          message: value.message,
        };
      }
      return value;
    });
  } catch (error) {
    return JSON.stringify({
      serializationError: error?.message || String(error),
    });
  }
};

const logAuth = (event, details = {}) => {
  if (process.env.NODE_ENV === 'production') return;
  logger.info(`[AUTH] ${event} ${stringifyAuthDetails(details)}`);
};

const warnAuth = (event, details = {}) => {
  if (process.env.NODE_ENV === 'production') return;
  logger.warn(`[AUTH] ${event} ${stringifyAuthDetails(details)}`);
};

export class AuthCancelledError extends Error {
  constructor(message = 'Inicio de sesión cancelado.') {
    super(message);
    this.name = 'AuthCancelledError';
  }
}

export const isIosNative = () => (
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios'
);

export const canShowAppleSignIn = () => isIosNative();

const isCancellationMessage = (message) => {
  const normalized = safeTrim(message).toLowerCase();
  if (!normalized) return false;

  return (
    normalized.includes('cancel')
    || normalized.includes('authorizationerror error 1001')
    || normalized.includes('canceled')
  );
};

const mapAuthError = (provider, error) => {
  if (error instanceof AuthCancelledError) return error;

  const rawMessage = safeTrim(error?.message || String(error || ''));
  if (isCancellationMessage(rawMessage)) {
    return new AuthCancelledError();
  }

  const providerLabel = provider === 'apple' ? 'Apple' : 'Google';
  return new Error(
    rawMessage
      ? `No pudimos iniciar sesión con ${providerLabel}. ${rawMessage}`
      : `No pudimos iniciar sesión con ${providerLabel}.`,
  );
};

const beginManagedAuthFlow = ({ provider, kind, source }) => {
  const pendingStart = startPendingAuthFlow({ provider, kind, source });
  if (!pendingStart.started) {
    throw new Error('Ya hay un inicio de sesión en curso.');
  }
  return pendingStart.flow;
};

const persistAppleIdentityMetadata = async ({ userId, email, givenName, familyName }) => {
  const resolvedGivenName = safeTrim(givenName);
  const resolvedFamilyName = safeTrim(familyName);
  const resolvedEmail = safeTrim(email);
  const fullName = [resolvedGivenName, resolvedFamilyName].filter(Boolean).join(' ').trim();

  const authMetadataPatch = {};
  if (fullName) authMetadataPatch.full_name = fullName;
  if (resolvedGivenName) authMetadataPatch.given_name = resolvedGivenName;
  if (resolvedFamilyName) authMetadataPatch.family_name = resolvedFamilyName;

  if (Object.keys(authMetadataPatch).length > 0) {
    const { error: updateUserError } = await supabase.auth.updateUser({
      data: authMetadataPatch,
    });

    if (updateUserError) {
      warnAuth('apple_metadata_update_failed', {
        message: updateUserError.message,
      });
    } else {
      logAuth('apple_metadata_update_done', {
        hasFullName: Boolean(fullName),
      });
    }
  }

  if (!userId) return;

  const usuariosPatch = {};
  if (fullName) usuariosPatch.nombre = fullName;
  if (resolvedEmail) usuariosPatch.email = resolvedEmail;

  if (Object.keys(usuariosPatch).length > 0) {
    const { error: usuariosError } = await supabase
      .from('usuarios')
      .update({
        ...usuariosPatch,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId);

    if (usuariosError) {
      warnAuth('apple_usuarios_patch_failed', {
        code: usuariosError.code,
        message: usuariosError.message,
      });
    }
  }

  if (fullName) {
    const { error: profilesError } = await supabase
      .from('profiles')
      .update({ nombre: fullName })
      .eq('id', userId);

    if (profilesError) {
      warnAuth('apple_profiles_patch_failed', {
        code: profilesError.code,
        message: profilesError.message,
      });
    }
  }
};

export const signInWithGoogle = async ({ source = 'auth_button' } = {}) => {
  const isNative = Capacitor.isNativePlatform();
  beginManagedAuthFlow({
    provider: 'google',
    kind: isNative ? 'oauth_native' : 'oauth_web',
    source,
  });

  track('login_started', {
    method: 'google',
    source,
  });

  try {
    const redirectTo = getAuthRedirectUrl();
    const options = redirectTo ? { redirectTo } : {};
    if (isNative) {
      options.skipBrowserRedirect = true;
    }

    logAuth('oauth_start', {
      flow: `${source}_google_auth`,
      isNative,
      redirectTo,
      skipBrowserRedirect: options.skipBrowserRedirect === true,
    });

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: Object.keys(options).length > 0 ? options : undefined,
    });

    if (error) throw error;

    logAuth('oauth_response', {
      flow: `${source}_google_auth`,
      redirectTo,
      authUrl: data?.url || null,
    });

    if (isNative) {
      const authUrl = safeTrim(data?.url);
      if (!authUrl) {
        throw new Error('No se recibió URL de autenticación.');
      }

      markPendingAuthBrowserOpened({ browserUrl: authUrl });
      await Browser.open({ url: authUrl });
      return { pending: true };
    }

    return data;
  } catch (error) {
    clearPendingAuthFlow();
    const mappedError = mapAuthError('google', error);

    if (mappedError instanceof AuthCancelledError) {
      setAuthFlowResult({
        type: 'cancelled',
        provider: 'google',
        message: mappedError.message,
      });
    }

    throw mappedError;
  }
};

export const signInWithApple = async ({ source = 'auth_button' } = {}) => {
  if (!isIosNative()) {
    throw new Error('Sign in with Apple está disponible solo en iOS.');
  }

  beginManagedAuthFlow({
    provider: 'apple',
    kind: 'native_apple',
    source,
  });

  track('login_started', {
    method: 'apple',
    source,
  });

  try {
    let authorizeStillPendingTimeoutId = null;
    const clearAuthorizeStillPendingTimeout = () => {
      if (authorizeStillPendingTimeoutId === null) return;
      window.clearTimeout(authorizeStillPendingTimeoutId);
      authorizeStillPendingTimeoutId = null;
    };
    const rawNonce = createRandomToken();
    const hashedNonce = await createSha256Hex(rawNonce);
    const state = createRandomToken();
    const redirectURI = getAuthRedirectUrl() || `${IOS_BUNDLE_ID}://auth/callback`;

    logAuth('apple_native_start', {
      source,
      redirectURI,
    });

    const appleSignInPlugin = SignInWithApple;
    logAuth('apple_plugin_direct_ready', {
      hasAuthorize: typeof appleSignInPlugin?.authorize === 'function',
      pluginType: typeof appleSignInPlugin,
      pluginKeys: getSafeObjectKeys(appleSignInPlugin),
    });

    if (typeof appleSignInPlugin?.authorize !== 'function') {
      throw new Error('Sign in with Apple no está disponible.');
    }

    logAuth('apple_authorize_start', {
      source,
      hasState: Boolean(state),
      hasNonce: Boolean(rawNonce),
      nonceEncoding: 'sha256_hex',
      scopes: 'email name',
    });
    authorizeStillPendingTimeoutId = window.setTimeout(() => {
      warnAuth('apple_authorize_still_pending_after_10s', { source });
    }, 10000);

    let result;
    try {
      logAuth('apple_authorize_call', { source });
      try {
        result = await appleSignInPlugin.authorize({
          clientId: IOS_BUNDLE_ID,
          redirectURI,
          scopes: 'email name',
          state,
          nonce: hashedNonce,
        });
      } catch (error) {
        warnAuth('apple_authorize_throw', {
          name: error?.name || null,
          message: error?.message || null,
          error,
        });
        throw error;
      }
    } finally {
      clearAuthorizeStillPendingTimeout();
    }

    logAuth('apple_authorize_done', {
      hasIdentityToken: Boolean(result?.response?.identityToken),
      hasEmail: Boolean(result?.response?.email),
      hasGivenName: Boolean(result?.response?.givenName),
      hasFamilyName: Boolean(result?.response?.familyName),
    });

    const authorizeResponse = result?.response || {};
    const identityToken = safeTrim(authorizeResponse.identityToken);
    if (!identityToken) {
      throw new Error('Apple no devolvió un token de identidad.');
    }

    logAuth('apple_supabase_sign_in_start', {
      hasIdentityToken: true,
      hasNonce: Boolean(rawNonce),
    });
    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: identityToken,
      nonce: rawNonce,
    });
    logAuth('apple_supabase_sign_in_done', {
      hasError: Boolean(error),
      errorMessage: error?.message || null,
      hasSession: Boolean(data?.session),
      hasUser: Boolean(data?.user || data?.session?.user),
    });

    if (error) throw error;

    const resolvedUser = data?.user || data?.session?.user || null;

    await persistAppleIdentityMetadata({
      userId: resolvedUser?.id || null,
      email: authorizeResponse.email || resolvedUser?.email || '',
      givenName: authorizeResponse.givenName || '',
      familyName: authorizeResponse.familyName || '',
    });

    markPendingAuthSessionRestored({
      provider: 'apple',
      userId: resolvedUser?.id || null,
    });

    track('login_success', {
      provider: 'apple',
      user_id: resolvedUser?.id,
      method: 'native_apple',
    });

    logAuth('apple_native_success', {
      userId: resolvedUser?.id || null,
      hasEmail: Boolean(result?.response?.email),
      hasGivenName: Boolean(result?.response?.givenName),
      hasFamilyName: Boolean(result?.response?.familyName),
    });

    return { data, credential: result.response };
  } catch (error) {
    clearPendingAuthFlow();
    warnAuth('apple_native_error', {
      name: error?.name || null,
      message: error?.message || null,
      error,
    });
    const mappedError = mapAuthError('apple', error);

    if (mappedError instanceof AuthCancelledError) {
      setAuthFlowResult({
        type: 'cancelled',
        provider: 'apple',
        message: mappedError.message,
      });
    }

    throw mappedError;
  }
};

export const clearAuthFlowIfSessionSettled = () => {
  const pendingAuthFlow = readPendingAuthFlow();
  if (!pendingAuthFlow) return;
  clearPendingAuthFlow();
};
