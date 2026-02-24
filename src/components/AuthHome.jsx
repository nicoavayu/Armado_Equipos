import React, { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { setAuthReturnTo } from '../utils/authReturnTo';
import { getAuthRedirectUrl } from '../utils/authRedirectUrl';
import GoogleAuth from './GoogleAuth';
import { supabase } from '../supabase';
import logo from '../Logo.png';

function getReturnTo(search) {
  const sp = new URLSearchParams(search || '');
  const raw = sp.get('returnTo');
  if (!raw || !raw.startsWith('/')) return null;
  if (raw.startsWith('//')) return null;
  return raw;
}

export default function AuthHome() {
  const location = useLocation();
  const { user, loading } = useAuth();
  const [mode, setMode] = useState(location.pathname === '/login/email' ? 'email' : 'options');
  const [email, setEmail] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [notice, setNotice] = useState({ type: '', message: '' });
  const [cooldown, setCooldown] = useState(0);

  const returnTo = useMemo(() => getReturnTo(location.search), [location.search]);

  useEffect(() => {
    if (returnTo) {
      setAuthReturnTo(returnTo);
    }
  }, [returnTo]);

  useEffect(() => {
    if (mode !== 'email' || cooldown <= 0) return undefined;
    const id = window.setInterval(() => {
      setCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(id);
  }, [mode, cooldown]);

  useEffect(() => {
    setMode(location.pathname === '/login/email' ? 'email' : 'options');
  }, [location.pathname]);

  const sendingBlocked = emailLoading || googleLoading;

  const sendMagicLink = async () => {
    if (sendingBlocked) return;
    if (!email.trim()) {
      setNotice({ type: 'warning', message: 'Ingresá tu email.' });
      return;
    }

    setEmailLoading(true);
    setNotice({ type: '', message: '' });
    try {
      setAuthReturnTo(returnTo || '/home');
      const emailRedirectTo = getAuthRedirectUrl();
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: emailRedirectTo ? { emailRedirectTo } : undefined,
      });
      if (error) throw error;

      setNotice({ type: 'success', message: 'Te mandamos un link al email. Abrilo para entrar.' });
      setCooldown(10);
    } catch (error) {
      setNotice({ type: 'warning', message: error?.message || 'No pudimos enviar el link. Intentá de nuevo.' });
    } finally {
      setEmailLoading(false);
    }
  };

  const onEmailSubmit = async (event) => {
    event.preventDefault();
    await sendMagicLink();
  };

  if (!loading && user) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="auth-premium-bg fixed inset-0 z-[9999] flex min-h-[100dvh] w-screen items-center justify-center overflow-hidden px-5">
      <div className="auth-premium-noise" aria-hidden="true" />
      <div className="w-full max-w-[380px]">
        <div className="auth-logo-block mb-10 text-center">
          <img src={logo} alt="ARMA2" className="auth-logo-mark mx-auto h-[122px] w-auto max-w-full object-contain" />
          <p className="mt-[14px] text-sm font-medium tracking-[0.3px] text-[rgba(255,255,255,0.9)]">Futbol amateur, nivel pro</p>
        </div>

        <div className="auth-premium-card rounded-2xl px-5 py-6 max-[480px]:px-4 max-[480px]:py-5">
          <div className="flex flex-col gap-3">
            <GoogleAuth
              user={null}
              disabled={sendingBlocked}
              loading={googleLoading}
              onStart={() => setGoogleLoading(true)}
              onEnd={() => setGoogleLoading(false)}
              className="auth-btn auth-btn-primary flex h-12 w-full items-center justify-center gap-2 rounded-xl px-4 text-base font-medium max-[480px]:h-[46px]"
            />

            {mode === 'options' ? (
              <button
                type="button"
                onClick={() => {
                  setMode('email');
                  setNotice({ type: '', message: '' });
                }}
                disabled={sendingBlocked}
                className="auth-btn auth-btn-secondary h-12 w-full rounded-xl px-4 text-base font-medium max-[480px]:h-[46px]"
              >
                Continuar con email
              </button>
            ) : (
              <form onSubmit={onEmailSubmit} className="flex flex-col gap-3">
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="tu@email.com"
                  autoComplete="email"
                  required
                  className="auth-email-input h-12 w-full rounded-xl px-4 text-white placeholder:text-white/45 outline-none max-[480px]:h-[46px]"
                />
                <button
                  type="submit"
                  disabled={sendingBlocked}
                  className="auth-btn auth-btn-secondary h-12 w-full rounded-xl px-4 text-base font-medium max-[480px]:h-[46px]"
                >
                  {emailLoading ? 'Enviando link...' : 'Enviar link'}
                </button>
                <div className="min-h-[22px]">
                  {notice.message ? (
                    <p className={`text-sm ${notice.type === 'success' ? 'text-[#76e7a0]' : 'text-[#ffadba]'}`}>
                      {notice.message}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={sendMagicLink}
                  disabled={sendingBlocked || cooldown > 0 || !email.trim()}
                  className="text-left text-sm text-white/80 transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {cooldown > 0 ? `Reenviar en ${cooldown}s` : 'Reenviar'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode('options');
                    setNotice({ type: '', message: '' });
                  }}
                  disabled={sendingBlocked}
                  className="text-left text-sm text-white/70 transition-colors hover:text-white disabled:opacity-50"
                >
                  Volver
                </button>
              </form>
            )}
          </div>
        </div>

        <p className="mx-auto mt-4 max-w-[340px] text-center text-[12px] leading-relaxed text-[rgba(255,255,255,0.72)]">
          Al continuar aceptás nuestros{' '}
          <Link to="/terms" className="auth-legal-link">
            Términos
          </Link>{' '}
          y{' '}
          <Link to="/privacy" className="auth-legal-link">
            Política de Privacidad
          </Link>
        </p>
      </div>
    </div>
  );
}
