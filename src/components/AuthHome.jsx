import React, { useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { setAuthReturnTo } from '../utils/authReturnTo';
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
      const emailRedirectTo = `${window.location.origin}/auth/callback`;
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo },
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
    <div
      className="fixed inset-0 flex flex-col justify-center items-center p-5 z-[9999]"
      style={{
        background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)',
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
      }}
    >
      <div className="mb-[20px] text-center">
        <img src={logo} alt="ARMA2" className="max-w-full h-[112px] w-auto object-contain mx-auto" />
      </div>

      <div className="w-[96vw] max-w-[360px] p-6 rounded-2xl bg-white/10 backdrop-blur-[20px] border border-white/20 shadow-[0_25px_50px_-12px_rgba(0,0,0,0.5)] max-[480px]:p-[15px]">
        <div className="flex flex-col gap-3">
          <GoogleAuth
            user={null}
            disabled={sendingBlocked}
            loading={googleLoading}
            onStart={() => setGoogleLoading(true)}
            onEnd={() => setGoogleLoading(false)}
            className="flex items-center justify-center gap-2 rounded-lg border border-[#8ba2ff]/60 bg-[#7a78df] text-white text-base font-medium transition-all duration-200 w-full h-12 px-4 hover:bg-[#6e6bd5] disabled:opacity-70 disabled:cursor-not-allowed max-[480px]:h-[44px]"
          />

          {mode === 'options' ? (
            <button
              type="button"
              onClick={() => {
                setMode('email');
                setNotice({ type: '', message: '' });
              }}
              disabled={sendingBlocked}
              className="rounded-lg border border-white/25 bg-white/10 text-white text-base font-medium transition-all duration-200 w-full h-12 px-4 hover:bg-white/20 disabled:opacity-70 disabled:cursor-not-allowed max-[480px]:h-[44px]"
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
                className="w-full h-12 rounded-lg border border-white/25 bg-white/10 px-4 text-white placeholder:text-white/45 outline-none focus:border-[#8ba2ff] max-[480px]:h-[44px]"
              />
              <button
                type="submit"
                disabled={sendingBlocked}
                className="rounded-lg border border-white/25 bg-white/10 text-white text-base font-medium transition-all duration-200 w-full h-12 px-4 hover:bg-white/20 disabled:opacity-70 disabled:cursor-not-allowed max-[480px]:h-[44px]"
              >
                {emailLoading ? 'Enviando link...' : 'Enviar link'}
              </button>
              {notice.message ? (
                <p className={`text-sm ${notice.type === 'success' ? 'text-[#6fe28d]' : 'text-[#ff9aa5]'}`}>
                  {notice.message}
                </p>
              ) : null}
              <button
                type="button"
                onClick={sendMagicLink}
                disabled={sendingBlocked || cooldown > 0 || !email.trim()}
                className="text-sm text-white/80 text-left hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
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
                className="text-sm text-white/75 text-left hover:text-white disabled:opacity-50"
              >
                Volver
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
