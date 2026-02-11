import React, { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
import { setAuthReturnTo } from '../utils/authReturnTo';

function parseReturnTo(search) {
  const sp = new URLSearchParams(search || '');
  const value = sp.get('returnTo');
  if (!value || !value.startsWith('/')) return '/home';
  return value;
}

export default function EmailMagicLinkLogin() {
  const navigate = useNavigate();
  const location = useLocation();
  const defaultReturnTo = useMemo(() => parseReturnTo(location.search), [location.search]);

  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const onSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;

    setLoading(true);
    setError('');
    setSent(false);

    try {
      setAuthReturnTo(defaultReturnTo);

      const emailRedirectTo = `${window.location.origin}/auth/callback`;
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo,
        },
      });

      if (otpError) throw otpError;
      setSent(true);
    } catch (err) {
      setError(err?.message || 'No pudimos enviar el link. Intentá de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] w-screen bg-fifa-gradient flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-white/20 bg-[#1a1f46]/90 p-6">
        <h1 className="font-bebas-neue text-4xl text-white tracking-wide">Continuar con email</h1>
        <p className="text-white/70 mt-2 text-sm">Ingresá tu email y te mandamos un link para entrar.</p>

        <form onSubmit={onSubmit} className="mt-6 space-y-3">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="tu@email.com"
            className="w-full h-12 rounded-xl border border-white/25 bg-[#10163a] px-4 text-white placeholder:text-white/40 outline-none focus:border-[#7d8bff]"
          />

          <button
            type="submit"
            disabled={loading}
            className="w-full h-12 rounded-xl bg-[#7a78df] text-white font-oswald text-xl tracking-wide disabled:opacity-70"
          >
            {loading ? 'ENVIANDO...' : 'Enviar link'}
          </button>

          <button
            type="button"
            onClick={() => navigate('/')}
            className="w-full h-11 rounded-xl border border-white/25 bg-transparent text-white/85 font-oswald text-lg"
          >
            Volver
          </button>
        </form>

        {sent && <p className="mt-4 text-[#6fe28d]">Te enviamos un link a tu mail</p>}
        {error && <p className="mt-4 text-[#ff7b7b]">{error}</p>}
      </div>
    </div>
  );
}
