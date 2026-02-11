import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
import { consumeAuthReturnTo } from '../utils/authReturnTo';

export default function AuthCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;

    const run = async () => {
      try {
        const currentUrl = window.location.href;
        const url = new URL(currentUrl);
        const code = url.searchParams.get('code');

        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
        } else if (window.location.hash) {
          const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
          const access_token = hash.get('access_token');
          const refresh_token = hash.get('refresh_token');

          if (access_token && refresh_token) {
            const { error: setSessionError } = await supabase.auth.setSession({
              access_token,
              refresh_token,
            });
            if (setSessionError) throw setSessionError;
          }
        }

        const { data, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        if (!data?.session) throw new Error('No se pudo restaurar la sesión.');

        const target = consumeAuthReturnTo('/home');
        navigate(target, { replace: true });
      } catch (err) {
        if (!mounted) return;
        setError(err?.message || 'No pudimos completar el login.');
      }
    };

    run();

    return () => {
      mounted = false;
    };
  }, [navigate]);

  return (
    <div className="min-h-[100dvh] w-screen bg-fifa-gradient flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-white/20 bg-[#1a1f46]/90 p-6 text-center">
        <h1 className="font-bebas-neue text-4xl text-white tracking-wide">Ingresando...</h1>
        {!error && <p className="text-white/70 mt-3">Estamos validando tu sesión.</p>}
        {error && <p className="text-[#ff7b7b] mt-4">{error}</p>}
      </div>
    </div>
  );
}
