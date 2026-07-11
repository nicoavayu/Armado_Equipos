import { supabase } from '../../lib/supabaseClient';
import logger from '../../utils/logger';

export const AUTH_REQUIRED_MESSAGE = 'Necesitás una sesión activa. Volvé a iniciar sesión e intentá de nuevo.';
export const PERMISSION_DENIED_MESSAGE = 'No pudimos completar esta acción por un problema de permisos.';

// A locally stored token is not enough: an expired session would hit the
// backend as `anon`. Refresh once when the stored session is already past
// (or within a minute of) its expiry.
export const getUsableSession = async () => {
  const { data: { session } = {} } = await supabase.auth.getSession();
  if (!session?.access_token) return null;
  const expiresAtMs = Number(session.expires_at || 0) * 1000;
  if (expiresAtMs && expiresAtMs <= Date.now() + 60 * 1000) {
    const { data, error } = await supabase.auth.refreshSession();
    if (error || !data?.session?.access_token) return null;
    return data.session;
  }
  return session;
};

// Errors from calls made WITH a usable session. `not_authenticated` / JWT
// problems mean the backend never saw the user → re-login. A 42501 or RLS
// violation with a valid session is NOT a session problem (wrong payload,
// failing WITH CHECK, broken policy…): show a permission message and keep
// the real error in the logs instead of masking it as "session expired".
export const describeDbAccessError = (error, context = {}) => {
  const message = String(error?.message || '');
  if (/not_authenticated|jwt/i.test(message)) {
    return new Error(AUTH_REQUIRED_MESSAGE);
  }
  if (error?.code === '42501' || /permission denied|row-level security/i.test(message)) {
    logger.error('[DB_ACCESS] permission error', {
      code: error?.code || null,
      message,
      operation: context.operation || null,
      target: context.target || null,
      userId: context.userId || null,
    });
    return new Error(PERMISSION_DENIED_MESSAGE);
  }
  return error;
};
