import React, { useEffect, useMemo } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { setAuthReturnTo } from '../utils/authReturnTo';
import GoogleAuth from './GoogleAuth';
import logo from '../Logo.png';

function getReturnTo(search) {
  const sp = new URLSearchParams(search || '');
  const raw = sp.get('returnTo');
  if (!raw || !raw.startsWith('/')) return null;
  if (raw.startsWith('//')) return null;
  return raw;
}

export default function AuthHome() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, loading } = useAuth();

  const returnTo = useMemo(() => getReturnTo(location.search), [location.search]);

  useEffect(() => {
    if (returnTo) {
      setAuthReturnTo(returnTo);
    }
  }, [returnTo]);

  const onEmail = () => {
    const query = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : '';
    navigate(`/login/email${query}`);
  };

  if (!loading && user) {
    return <Navigate to="/" replace />;
  }

  const showPasswordLink = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';

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
        <div className="flex flex-col gap-[10px]">
          <div className="w-full">
            <GoogleAuth
              user={null}
              className="flex items-center justify-center gap-2 p-0 rounded-lg border border-white/20 bg-white/10 text-white text-base font-medium cursor-pointer transition-all duration-200 w-full h-11 hover:bg-white/20 hover:border-white/30 max-[480px]:h-[42px]"
            />
          </div>

          <button
            type="button"
            onClick={onEmail}
            className="p-0 rounded-lg border border-white/20 bg-white/10 text-white text-base font-medium cursor-pointer transition-all duration-200 w-full h-11 hover:bg-white/20 hover:border-white/30 max-[480px]:h-[42px]"
          >
            Continuar con email
          </button>

          {showPasswordLink && (
            <div className="text-center mt-[4px]">
              <Link to="/login/password" className="text-white/80 text-sm hover:underline">
                Usar contraseña
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
