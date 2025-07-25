import React, { useState } from 'react';
import { supabase } from '../supabase';
import { toast } from 'react-toastify';
import LoadingSpinner from './LoadingSpinner';
import './EmailAuth.css';

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
      const { data, error } = await supabase.auth.signInWithPassword({
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
      const { data, error } = await supabase.auth.signUp({
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
      <div className="email-auth-container">
        <h2>Recuperar Contraseña</h2>
        <form onSubmit={handleResetPassword} className="auth-form">
          <div className="form-group">
            <label htmlFor="reset-email">Email</label>
            <input
              id="reset-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Tu email"
              required
            />
          </div>
          <button type="submit" className="auth-button" disabled={loading}>
            {loading ? <LoadingSpinner size="small" /> : 'Enviar Instrucciones'}
          </button>
          <button 
            type="button" 
            className="auth-link-button"
            onClick={() => setResetPassword(false)}
          >
            Volver al inicio de sesión
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="email-auth-container">
      <div className="auth-tabs">
        <button 
          className={`tab-button ${activeTab === 'login' ? 'active' : ''}`}
          onClick={() => setActiveTab('login')}
        >
          Ingresar
        </button>
        <button 
          className={`tab-button ${activeTab === 'register' ? 'active' : ''}`}
          onClick={() => setActiveTab('register')}
        >
          Registrarse
        </button>
      </div>

      {activeTab === 'login' ? (
        <form onSubmit={handleLogin} className="auth-form">
          <div className="form-group">
            <label htmlFor="login-email">Email</label>
            <input
              id="login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Tu email"
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="login-password">Contraseña</label>
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Tu contraseña"
              required
            />
          </div>
          <button type="submit" className="auth-button" disabled={loading}>
            {loading ? <LoadingSpinner size="small" /> : 'Ingresar'}
          </button>
          <button 
            type="button" 
            className="auth-link-button"
            onClick={() => setResetPassword(true)}
          >
            ¿Olvidaste tu contraseña?
          </button>
        </form>
      ) : (
        <form onSubmit={handleRegister} className="auth-form">
          <div className="form-group">
            <label htmlFor="register-email">Email</label>
            <input
              id="register-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Tu email"
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="register-password">Contraseña</label>
            <input
              id="register-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Tu contraseña (mínimo 6 caracteres)"
              minLength={6}
              required
            />
          </div>
          <button type="submit" className="auth-button" disabled={loading}>
            {loading ? <LoadingSpinner size="small" /> : 'Registrarse'}
          </button>
        </form>
      )}
    </div>
  );
};

export default EmailAuth;