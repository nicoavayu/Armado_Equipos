import logger from '../utils/logger';
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
import { consumeAuthReturnTo } from '../utils/authReturnTo';
import {
  clearPendingAuthFlow,
  markPendingAuthSessionRestored,
  readPendingAuthFlow,
  setAuthFlowResult,
} from '../utils/authFlowState';
import { track } from '../utils/monitoring/analytics';
import AppLoadingScreen from './AppLoadingScreen';

const SESSION_RETRY_DELAYS_MS = [0, 250, 600, 1200];

export default function AuthCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const logAuth = (event, details = {}) => {
    try {
      logger.info(`[AUTH] ${event} ${JSON.stringify(details)}`);
    } catch (serializationError) {
      logger.info(`[AUTH] ${event} ${JSON.stringify({
        serializationError: serializationError?.message || String(serializationError),
      })}`);
    }
  };

  useEffect(() => {
    let mounted = true;

    const waitForSession = async () => {
      let lastSessionError = null;

      for (const delayMs of SESSION_RETRY_DELAYS_MS) {
        if (delayMs > 0) {
          await new Promise((resolve) => window.setTimeout(resolve, delayMs));
        }

        const { data, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) {
          lastSessionError = sessionError;
          continue;
        }

        if (data?.session) {
          return {
            session: data.session,
            sessionError: null,
          };
        }
      }

      return {
        session: null,
        sessionError: lastSessionError,
      };
    };

    const run = async () => {
      const initialPendingFlow = readPendingAuthFlow();
      const provider = initialPendingFlow?.provider || 'google';

      try {
        const currentUrl = window.location.href;
        logAuth('auth_callback_enter', {
          href: currentUrl,
          pathname: window.location.pathname,
          search: window.location.search,
          hash: window.location.hash,
          provider,
        });
        const url = new URL(currentUrl);
        const code = url.searchParams.get('code');
        let callbackError = null;

        if (code) {
          logAuth('auth_callback_code_detected', {
            codePresent: true,
            provider,
          });
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) {
            callbackError = exchangeError;
            logAuth('auth_callback_exchange_failed', {
              provider,
              message: exchangeError.message,
            });
          }
        } else if (window.location.hash) {
          logAuth('auth_callback_hash_detected', {
            hash: window.location.hash,
            provider,
          });
          const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
          const access_token = hash.get('access_token');
          const refresh_token = hash.get('refresh_token');

          if (access_token && refresh_token) {
            const { error: setSessionError } = await supabase.auth.setSession({
              access_token,
              refresh_token,
            });
            if (setSessionError) {
              callbackError = setSessionError;
              logAuth('auth_callback_set_session_failed', {
                provider,
                message: setSessionError.message,
              });
            }
          }
        }

        const { session, sessionError } = await waitForSession();
        if (sessionError && !session) throw sessionError;
        if (!session) {
          if (callbackError) throw callbackError;
          throw new Error('No se pudo restaurar la sesión.');
        }

        if (callbackError) {
          logAuth('auth_callback_session_restored_after_callback_error', {
            provider,
            message: callbackError.message,
            userId: session.user?.id || null,
          });
        }

        logAuth('auth_callback_session_restored', {
          provider,
          hasSession: true,
          userId: session.user?.id || null,
        });

        markPendingAuthSessionRestored({
          provider,
          userId: session.user?.id || null,
        });

        track('login_success', {
          provider,
          user_id: session.user?.id,
          method: 'oauth_callback',
        });

        const target = consumeAuthReturnTo('/home');
        logAuth('auth_callback_navigate', { target });
        navigate(target, { replace: true });
      } catch (err) {
        const currentProvider = readPendingAuthFlow()?.provider || provider;
        logAuth('auth_callback_error', {
          provider: currentProvider,
          message: err?.message || String(err),
        });
        clearPendingAuthFlow();
        setAuthFlowResult({
          type: 'error',
          provider: currentProvider,
          message: err?.message || 'No pudimos completar el login.',
        });
        if (!mounted) return;
        setError(err?.message || 'No pudimos completar el login.');
      }
    };

    run();

    return () => {
      mounted = false;
    };
  }, [navigate]);

  if (error) {
    return (
      <div className="auth-premium-bg fixed inset-0 z-[1200] flex min-h-[100dvh] w-full flex-col items-center justify-center overflow-hidden px-6">
        <div className="auth-premium-noise" aria-hidden="true" />
        <div className="w-full max-w-md rounded-2xl border border-[rgba(148,134,255,0.16)] bg-[linear-gradient(165deg,rgba(48,38,98,0.55),rgba(18,14,38,0.96))] p-6 text-center shadow-elev-2 backdrop-blur-md">
          <h1 className="font-oswald text-3xl font-semibold tracking-[0.01em] text-white">No pudimos ingresar</h1>
          <p className="mt-4 text-[#ff7b7b]">{error}</p>
        </div>
      </div>
    );
  }

  return <AppLoadingScreen message="Ingresando..." />;
}
