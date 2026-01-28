import React, { useState } from 'react';
import { useAuth } from './AuthProvider';
import GoogleAuth from './GoogleAuth';
import { supabase } from '../supabase';
import { toast } from 'react-toastify';
import { handleError } from '../lib/errorHandler';
import LoadingSpinner from './LoadingSpinner';
import logo from '../Logo.png'; // Reverted to white logo

const AuthPage = () => {
  const { user } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resetPassword, setResetPassword] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [error, setError] = useState('');
  const [validationErrors, setValidationErrors] = useState({});

  const handleLogout = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      toast.success('Sesión cerrada correctamente');
    } catch (error) {
      handleError(error, { showToast: true, onError: () => { } });
    }
  };

  const validateEmail = (email) => {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
  };

  const validateForm = () => {
    const errors = {};

    if (isRegistering) {
      if (!validateEmail(email)) {
        errors.email = 'Ingresá un email válido';
      }

      if (password !== confirmPassword) {
        errors.confirmPassword = 'Las contraseñas no coinciden';
      }

      if (!acceptTerms) {
        errors.terms = 'Debés aceptar los términos y condiciones';
      }
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleLogin = async (e) => {
    e.preventDefault();

    // Anti-double-submit guard
    if (loading) {
      console.debug('[Login] submit blocked: already submitting');
      return;
    }

    setError('');
    setValidationErrors({});

    console.debug('[Login] submit start', { hasEmail: !!email, hasPassword: !!password });

    if (!validateEmail(email)) {
      setValidationErrors({ email: 'Ingresá un email válido' });
      return;
    }

    setLoading(true);

    try {
      console.debug('[Login] calling signInWithPassword');

      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      console.debug('[Login] signIn result', { ok: !error, userId: data?.user?.id });

      if (error) {
        if (error.message.includes('Email not confirmed')) {
          setError('Tu correo no está confirmado. Revisá tu mail y hacé clic en el enlace para activar tu cuenta.');
        } else if (error.message.includes('Invalid login credentials')) {
          setError('Credenciales inválidas. Verificá tu email y contraseña.');
        } else {
          setError(`Error al iniciar sesión: ${error.message}`);
        }
        throw error;
      }

      // Success - AuthProvider will handle redirect
      console.debug('[Login] redirect to', '/');
      toast.success('¡Inicio de sesión exitoso!');
    } catch (error) {
      handleError(error, { showToast: false, onError: () => { } });
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setError('');

    if (!validateForm()) {
      return;
    }

    setLoading(true);

    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}`,
          data: {
            email_confirm: false, // Temporal: deshabilitar confirmación
          },
        },
      });

      if (error) {
        setError(`Error al registrarse: ${error.message}`);
        throw error;
      }
      toast.success('Te enviamos un correo de confirmación. Revisá tu mail para activar tu cuenta.');
      setIsRegistering(false);
      setPassword('');
      setConfirmPassword('');
      setAcceptTerms(false);
    } catch (error) {
      handleError(error, { showToast: false, onError: () => { } });
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    setError('');
    setValidationErrors({});

    if (!validateEmail(email)) {
      setValidationErrors({ email: 'Ingresá un email válido' });
      return;
    }

    setLoading(true);

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });

      if (error) {
        setError(`Error al solicitar cambio de contraseña: ${error.message}`);
        throw error;
      }
      toast.success('Te enviamos un correo para restablecer tu contraseña. Revisá tu mail.');
      setResetPassword(false);
    } catch (error) {
      handleError(error, { showToast: false, onError: () => { } });
    } finally {
      setLoading(false);
    }
  };

  const switchToRegister = (e) => {
    e.preventDefault();
    setIsRegistering(true);
    setError('');
    setValidationErrors({});
  };

  const switchToLogin = (e) => {
    e.preventDefault();
    setIsRegistering(false);
    setError('');
    setValidationErrors({});
  };

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
        <img src={logo} alt="Team Balancer" className="max-w-full h-[120px]" />
      </div>

      <div className="w-[96vw] max-w-[360px] p-6 rounded-2xl bg-white/10 backdrop-blur-[20px] border border-white/20 shadow-[0_25px_50px_-12px_rgba(0,0,0,0.5)] max-[480px]:p-[15px]">
        {user ? (
          <div className="text-center text-white">
            <p className="text-[18px] mb-5">
              Bienvenido, <span className="font-bold text-white">{user.email}</span>
            </p>
            <button onClick={handleLogout} className="p-0 rounded-lg border-none bg-[#dc3545] text-white text-base font-medium cursor-pointer transition-colors duration-200 h-11 w-full hover:bg-[#c82333] max-[480px]:h-[42px]">
              Cerrar Sesión
            </button>
          </div>
        ) : resetPassword ? (
          <div className="flex flex-col gap-[10px]">
            <h2 className="text-xl text-white mt-0 mb-[15px] text-center">Recuperar Contraseña</h2>
            <form onSubmit={handleResetPassword} className="flex flex-col gap-[10px]">
              <div className="flex flex-col gap-1 mb-2">
                <label htmlFor="reset-email" className="text-white text-sm font-medium">Email</label>
                <input
                  id="reset-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Tu email"
                  required
                  className="px-4 rounded-lg border border-white/20 bg-white/10 text-white text-base transition-all duration-200 w-full h-11 box-border placeholder:text-white/40 focus:outline-none focus:border-[#8178e5] focus:bg-white/15 max-[480px]:h-[42px]"
                />
                {validationErrors.email && <div className="text-white text-[13px] mt-[2px] mb-[5px] italic">{validationErrors.email}</div>}
              </div>
              {error && <div className="text-[#fdfdfd] text-[13px] mb-[5px] italic">{error}</div>}
              <button type="submit" className="p-0 rounded-lg border-none bg-[#8178e5] text-white text-base font-medium cursor-pointer transition-colors duration-200 flex justify-center items-center h-11 w-full mt-[5px] hover:not-disabled:bg-[#6a5fd0] disabled:opacity-70 disabled:cursor-not-allowed max-[480px]:h-[42px]" disabled={loading}>
                {loading ? <LoadingSpinner size="small" /> : 'Enviar Instrucciones'}
              </button>
              <button
                type="button"
                className="bg-none border-none text-white/80 text-sm text-center cursor-pointer p-1 mt-[2px] w-full hover:underline"
                onClick={() => setResetPassword(false)}
              >
                Volver al inicio de sesión
              </button>
            </form>
          </div>
        ) : isRegistering ? (
          <div className="flex flex-col gap-[10px]">
            <form onSubmit={handleRegister} className="flex flex-col gap-[10px]">
              <div className="flex flex-col gap-1 mb-2">
                <label htmlFor="register-email" className="text-white text-sm font-medium">Email</label>
                <input
                  id="register-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Tu email"
                  required
                  className="px-4 rounded-lg border border-white/20 bg-white/10 text-white text-base transition-all duration-200 w-full h-11 box-border placeholder:text-white/40 focus:outline-none focus:border-[#8178e5] focus:bg-white/15 max-[480px]:h-[42px]"
                />
                {validationErrors.email && <div className="text-white text-[13px] mt-[2px] mb-[5px] italic">{validationErrors.email}</div>}
              </div>
              <div className="flex flex-col gap-1 mb-2">
                <label htmlFor="register-password" className="text-white text-sm font-medium">Contraseña</label>
                <input
                  id="register-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Tu contraseña"
                  required
                  className="px-4 rounded-lg border border-white/20 bg-white/10 text-white text-base transition-all duration-200 w-full h-11 box-border placeholder:text-white/40 focus:outline-none focus:border-[#8178e5] focus:bg-white/15 max-[480px]:h-[42px]"
                />
              </div>
              <div className="flex flex-col gap-1 mb-2">
                <label htmlFor="confirm-password" className="text-white text-sm font-medium">Confirmar Contraseña</label>
                <input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirmar contraseña"
                  required
                  className="px-4 rounded-lg border border-white/20 bg-white/10 text-white text-base transition-all duration-200 w-full h-11 box-border placeholder:text-white/40 focus:outline-none focus:border-[#8178e5] focus:bg-white/15 max-[480px]:h-[42px]"
                />
                {validationErrors.confirmPassword && <div className="text-white text-[13px] mt-[2px] mb-[5px] italic">{validationErrors.confirmPassword}</div>}
              </div>
              <div className="flex items-start gap-2 mb-[10px]">
                <input
                  id="terms"
                  type="checkbox"
                  checked={acceptTerms}
                  onChange={(e) => setAcceptTerms(e.target.checked)}
                  className="mt-[3px] w-4 h-4 accent-[#8178e5]"
                />
                <label htmlFor="terms" className="text-white/80 text-sm leading-[1.4]">
                  Acepto los <a href="#" onClick={(e) => e.preventDefault()} className="text-white no-underline hover:underline">Términos y Condiciones</a> y la <a href="#" onClick={(e) => e.preventDefault()} className="text-white no-underline hover:underline">Política de Privacidad</a>
                </label>
              </div>
              {validationErrors.terms && <div className="text-white text-[13px] mt-[2px] mb-[5px] italic">{validationErrors.terms}</div>}
              {error && <div className="text-[#fdfdfd] text-[13px] mb-[5px] italic">{error}</div>}
              <button type="submit" className="p-0 rounded-lg border-none bg-[#8178e5] text-white text-base font-medium cursor-pointer transition-colors duration-200 flex justify-center items-center h-11 w-full mt-[5px] hover:not-disabled:bg-[#6a5fd0] disabled:opacity-70 disabled:cursor-not-allowed max-[480px]:h-[42px]" disabled={loading}>
                {loading ? <LoadingSpinner size="small" /> : 'Registrarme'}
              </button>

              <div className="flex items-center text-center text-white/50 text-xs my-2 before:content-[''] before:flex-1 before:border-b before:border-white/20 before:mr-[10px] after:content-[''] after:flex-1 after:border-b after:border-white/20 after:ml-[10px]">
                <span>o</span>
              </div>

              <div className="w-full">
                <GoogleAuth user={user} className="flex items-center justify-center gap-2 p-0 rounded-lg border border-white/20 bg-white/10 text-white text-base font-medium cursor-pointer transition-all duration-200 w-full h-11 hover:bg-white/20 hover:border-white/30 max-[480px]:h-[42px]" />
              </div>
            </form>

            <div className="text-center mt-[10px] text-sm text-white/80">
              <p>¿Ya tenés cuenta? <a href="#" onClick={switchToLogin} className="text-white no-underline font-medium hover:underline">Ingresar</a></p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-[10px]">
            <form onSubmit={handleLogin} className="flex flex-col gap-[10px]">
              <div className="flex flex-col gap-1 mb-2">
                <label htmlFor="login-email" className="text-white text-sm font-medium">Email</label>
                <input
                  id="login-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Tu email"
                  required
                  className="px-4 rounded-lg border border-white/20 bg-white/10 text-white text-base transition-all duration-200 w-full h-11 box-border placeholder:text-white/40 focus:outline-none focus:border-[#8178e5] focus:bg-white/15 max-[480px]:h-[42px]"
                />
                {validationErrors.email && <div className="text-white text-[13px] mt-[2px] mb-[5px] italic">{validationErrors.email}</div>}
              </div>
              <div className="flex flex-col gap-1 mb-2">
                <label htmlFor="login-password" className="text-white text-sm font-medium">Contraseña</label>
                <input
                  id="login-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Tu contraseña"
                  required
                  className="px-4 rounded-lg border border-white/20 bg-white/10 text-white text-base transition-all duration-200 w-full h-11 box-border placeholder:text-white/40 focus:outline-none focus:border-[#8178e5] focus:bg-white/15 max-[480px]:h-[42px]"
                />
              </div>
              {error && <div className="text-[#fdfdfd] text-[13px] mb-[5px] italic">{error}</div>}
              <button type="submit" className="p-0 rounded-lg border-none bg-[#8178e5] text-white text-base font-medium cursor-pointer transition-colors duration-200 flex justify-center items-center h-11 w-full mt-[5px] hover:not-disabled:bg-[#6a5fd0] disabled:opacity-70 disabled:cursor-not-allowed max-[480px]:h-[42px]" disabled={loading}>
                {loading ? <LoadingSpinner size="small" /> : 'Ingresar'}
              </button>
              <button
                type="button"
                className="bg-none border-none text-white/80 text-sm text-center cursor-pointer p-1 mt-[2px] w-full hover:underline"
                onClick={() => setResetPassword(true)}
              >
                ¿Olvidaste tu contraseña?
              </button>

              <div className="flex items-center text-center text-white/50 text-xs my-2 before:content-[''] before:flex-1 before:border-b before:border-white/20 before:mr-[10px] after:content-[''] after:flex-1 after:border-b after:border-white/20 after:ml-[10px]">
                <span>o</span>
              </div>

              <div className="w-full">
                <GoogleAuth user={user} className="flex items-center justify-center gap-2 p-0 rounded-lg border border-white/20 bg-white/10 text-white text-base font-medium cursor-pointer transition-all duration-200 w-full h-11 hover:bg-white/20 hover:border-white/30 max-[480px]:h-[42px]" />
              </div>
            </form>

            <div className="text-center mt-[10px] text-sm text-white/80">
              <p>¿No tenés una cuenta? <a href="#" onClick={switchToRegister} className="text-white no-underline font-medium hover:underline">Registrate</a></p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AuthPage;