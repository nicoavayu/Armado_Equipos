import React, { useState } from 'react';
import { useAuth } from './AuthProvider';
import GoogleAuth from './GoogleAuth';
import { supabase } from '../supabase';
import { toast } from 'react-toastify';
import LoadingSpinner from './LoadingSpinner';
import './AuthPage.css';
import logo from '../Logo.png'; // Import the logo

const AuthPage = () => {
  const { user } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetPassword, setResetPassword] = useState(false);
  const [error, setError] = useState('');

  const handleLogout = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        toast.error(`Error al cerrar sesión: ${error.message}`);
      } else {
        toast.success('Sesión cerrada correctamente');
      }
    } catch (error) {
      toast.error(`Error inesperado: ${error.message}`);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) {
        if (error.message.includes('Email not confirmed')) {
          setError('Tu correo no está confirmado. Revisá tu mail y hacé clic en el enlace para activar tu cuenta.');
        } else if (error.message.includes('Invalid login credentials')) {
          setError('Credenciales inválidas. Verificá tu email y contraseña.');
        } else {
          setError(`Error al iniciar sesión: ${error.message}`);
        }
      } else {
        toast.success('¡Inicio de sesión exitoso!');
      }
    } catch (error) {
      setError(`Error inesperado: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    window.location.href = '/register'; // Redirect to register page
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`
      });

      if (error) {
        setError(`Error al solicitar cambio de contraseña: ${error.message}`);
      } else {
        toast.success('Te enviamos un correo para restablecer tu contraseña. Revisá tu mail.');
        setResetPassword(false);
      }
    } catch (error) {
      setError(`Error inesperado: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-logo-container">
        <img src={logo} alt="Team Balancer" className="auth-logo" />
      </div>
      
      <div className="auth-container">
        {user ? (
          <div className="logged-in-container">
            <p className="welcome-message">
              Bienvenido, <span className="user-email">{user.email}</span>
            </p>
            <button onClick={handleLogout} className="logout-button">
              Cerrar Sesión
            </button>
          </div>
        ) : resetPassword ? (
          <div className="auth-methods">
            <h2 className="auth-title">Recuperar Contraseña</h2>
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
              {error && <div className="auth-error">{error}</div>}
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
        ) : (
          <div className="auth-methods">
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
              {error && <div className="auth-error">{error}</div>}
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
              
              <div className="auth-divider">
                <span>o</span>
              </div>
              
              <div className="social-auth">
                <GoogleAuth user={user} />
              </div>
            </form>
            
            <div className="auth-footer">
              <p>¿No tenés una cuenta? <a href="#" onClick={(e) => {
                e.preventDefault();
                handleRegister();
              }} className="auth-link">Registrate</a></p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AuthPage;