import React, { useState } from 'react';
import { supabase } from '../supabase';
import { toast } from 'react-toastify';
import LoadingSpinner from './LoadingSpinner';

const EmailAuth = ({ user }) => {
  const [activeTab, setActiveTab] = useState('login'); // 'login' o 'register'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetPassword, setResetPassword] = useState(false);

  // Si el usuario ya está autenticado, no mostrar el formulario
  if (user) return null;

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        if (error.message.includes('Email not confirmed')) {
          toast.error('Tu correo no está confirmado. Revisá tu mail y hacé clic en el enlace para activar tu cuenta.');
        } else if (error.message.includes('Invalid login credentials')) {
          toast.error('Credenciales inválidas. Verificá tu email y contraseña.');
        } else {
          toast.error(`Error al iniciar sesión: ${error.message}`);
        }
        console.error('Error de login:', error);
      } else {
        toast.success('¡Inicio de sesión exitoso!');
      }
    } catch (error) {
      toast.error(`Error inesperado: ${error.message}`);
      console.error('Error inesperado:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}`,
        },
      });

      if (error) {
        toast.error(`Error al registrarse: ${error.message}`);
        console.error('Error de registro:', error);
      } else {
        toast.success('Te enviamos un correo de confirmación. Revisá tu mail para activar tu cuenta.');
        // Cambiar a la pestaña de login después del registro exitoso
        setActiveTab('login');
      }
    } catch (error) {
      toast.error(`Error inesperado: ${error.message}`);
      console.error('Error inesperado:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });

      if (error) {
        toast.error(`Error al solicitar cambio de contraseña: ${error.message}`);
        console.error('Error de reset:', error);
      } else {
        toast.success('Te enviamos un correo para restablecer tu contraseña. Revisá tu mail.');
        setResetPassword(false);
      }
    } catch (error) {
      toast.error(`Error inesperado: ${error.message}`);
      console.error('Error inesperado:', error);
    } finally {
      setLoading(false);
    }
  };

  // Renderizar formulario de recuperación de contraseña
  if (resetPassword) {
    return (
      <div className="w-full mx-auto max-[480px]:max-w-[98%]">
        <h2>Recuperar Contraseña</h2>
        <form onSubmit={handleResetPassword} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5 mb-2.5">
            <label htmlFor="reset-email" className="text-white text-sm font-medium">Email</label>
            <input
              id="reset-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Tu email"
              required
              className="px-3.5 py-2.5 rounded-lg border border-white/20 bg-white/20 text-white text-base transition-colors duration-300 w-full placeholder:text-white/50 focus:outline-none focus:border-[#8178e5] max-[480px]:px-3 max-[480px]:text-sm"
            />
          </div>
          <button type="submit" className="p-2.5 rounded-lg border-none bg-[#0864b2] text-white text-base font-medium cursor-pointer transition-colors duration-300 flex justify-center items-center h-11 w-full mt-1.5 hover:not-disabled:bg-[#6a5fd0] disabled:opacity-70 disabled:cursor-not-allowed max-[480px]:p-2 max-[480px]:text-sm max-[480px]:h-10" disabled={loading}>
            {loading ? <LoadingSpinner size="small" /> : 'Enviar Instrucciones'}
          </button>
          <button
            type="button"
            className="bg-none border-none text-white/80 text-sm text-center cursor-pointer p-1.5 mt-1.5 w-full hover:underline hover:text-white"
            onClick={() => setResetPassword(false)}
          >
            Volver al inicio de sesión
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="w-full mx-auto max-[480px]:max-w-[98%]">
      <div className="flex mb-4 rounded-lg overflow-hidden border border-white/20">
        <button
          className={`flex-1 p-2.5 border-none text-white text-base font-medium cursor-pointer transition-colors duration-300 max-[480px]:p-2 max-[480px]:text-sm ${activeTab === 'login' ? 'bg-[#0864b2]' : 'bg-black/20 hover:bg-black/30'}`}
          onClick={() => setActiveTab('login')}
        >
          Ingresar
        </button>
        <button
          className={`flex-1 p-2.5 border-none text-white text-base font-medium cursor-pointer transition-colors duration-300 max-[480px]:p-2 max-[480px]:text-sm ${activeTab === 'register' ? 'bg-[#0864b2]' : 'bg-black/20 hover:bg-black/30'}`}
          onClick={() => setActiveTab('register')}
        >
          Registrarse
        </button>
      </div>

      {activeTab === 'login' ? (
        <form onSubmit={handleLogin} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5 mb-2.5">
            <label htmlFor="login-email" className="text-white text-sm font-medium">Email</label>
            <input
              id="login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Tu email"
              required
              className="px-3.5 py-2.5 rounded-lg border border-white/20 bg-white/20 text-white text-base transition-colors duration-300 w-full placeholder:text-white/50 focus:outline-none focus:border-[#8178e5] max-[480px]:px-3 max-[480px]:text-sm"
            />
          </div>
          <div className="flex flex-col gap-1.5 mb-2.5">
            <label htmlFor="login-password" className="text-white text-sm font-medium">Contraseña</label>
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Tu contraseña"
              required
              className="px-3.5 py-2.5 rounded-lg border border-white/20 bg-white/20 text-white text-base transition-colors duration-300 w-full placeholder:text-white/50 focus:outline-none focus:border-[#8178e5] max-[480px]:px-3 max-[480px]:text-sm"
            />
          </div>
          <button type="submit" className="p-2.5 rounded-lg border-none bg-[#0864b2] text-white text-base font-medium cursor-pointer transition-colors duration-300 flex justify-center items-center h-11 w-full mt-1.5 hover:not-disabled:bg-[#6a5fd0] disabled:opacity-70 disabled:cursor-not-allowed max-[480px]:p-2 max-[480px]:text-sm max-[480px]:h-10" disabled={loading}>
            {loading ? <LoadingSpinner size="small" /> : 'Ingresar'}
          </button>
          <button
            type="button"
            className="bg-none border-none text-white/80 text-sm text-center cursor-pointer p-1.5 mt-1.5 w-full hover:underline hover:text-white"
            onClick={() => setResetPassword(true)}
          >
            ¿Olvidaste tu contraseña?
          </button>
        </form>
      ) : (
        <form onSubmit={handleRegister} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5 mb-2.5">
            <label htmlFor="register-email" className="text-white text-sm font-medium">Email</label>
            <input
              id="register-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Tu email"
              required
              className="px-3.5 py-2.5 rounded-lg border border-white/20 bg-white/20 text-white text-base transition-colors duration-300 w-full placeholder:text-white/50 focus:outline-none focus:border-[#8178e5] max-[480px]:px-3 max-[480px]:text-sm"
            />
          </div>
          <div className="flex flex-col gap-1.5 mb-2.5">
            <label htmlFor="register-password" className="text-white text-sm font-medium">Contraseña</label>
            <input
              id="register-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Tu contraseña (mínimo 6 caracteres)"
              minLength={6}
              required
              className="px-3.5 py-2.5 rounded-lg border border-white/20 bg-white/20 text-white text-base transition-colors duration-300 w-full placeholder:text-white/50 focus:outline-none focus:border-[#8178e5] max-[480px]:px-3 max-[480px]:text-sm"
            />
          </div>
          <button type="submit" className="p-2.5 rounded-lg border-none bg-[#0864b2] text-white text-base font-medium cursor-pointer transition-colors duration-300 flex justify-center items-center h-11 w-full mt-1.5 hover:not-disabled:bg-[#6a5fd0] disabled:opacity-70 disabled:cursor-not-allowed max-[480px]:p-2 max-[480px]:text-sm max-[480px]:h-10" disabled={loading}>
            {loading ? <LoadingSpinner size="small" /> : 'Registrarse'}
          </button>
        </form>
      )}
    </div>
  );
};

export default EmailAuth;