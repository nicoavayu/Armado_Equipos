import React, { useState } from 'react';
import { useAuth } from './AuthProvider';
import GoogleAuth from './GoogleAuth';
import { supabase } from '../supabase';
import { toast } from 'react-toastify';
import { handleError, AppError, ERROR_CODES } from '../lib/errorHandler';
import LoadingSpinner from './LoadingSpinner';
import './AuthPage.css';
import logo from '../Logo.png'; // Import the logo

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
      handleError(error, { showToast: true });
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
    setError('');
    setValidationErrors({});
    
    if (!validateEmail(email)) {
      setValidationErrors({ email: 'Ingresá un email válido' });
      return;
    }
    
    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

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
      toast.success('¡Inicio de sesión exitoso!');
    } catch (error) {
      handleError(error, { showToast: false });
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
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}`,
          data: {
            email_confirm: false // Temporal: deshabilitar confirmación
          }
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
      handleError(error, { showToast: false });
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
      handleError(error, { showToast: false });
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
                {validationErrors.email && <div className="validation-error">{validationErrors.email}</div>}
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
        ) : isRegistering ? (
          <div className="auth-methods">
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
                {validationErrors.email && <div className="validation-error">{validationErrors.email}</div>}
              </div>
              <div className="form-group">
                <label htmlFor="register-password">Contraseña</label>
                <input
                  id="register-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Tu contraseña"
                  required
                />
              </div>
              <div className="form-group">
                <label htmlFor="confirm-password">Confirmar Contraseña</label>
                <input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirmar contraseña"
                  required
                />
                {validationErrors.confirmPassword && <div className="validation-error">{validationErrors.confirmPassword}</div>}
              </div>
              <div className="checkbox-group">
                <input
                  id="terms"
                  type="checkbox"
                  checked={acceptTerms}
                  onChange={(e) => setAcceptTerms(e.target.checked)}
                />
                <label htmlFor="terms">
                  Acepto los <a href="#" onClick={(e) => e.preventDefault()}>Términos y Condiciones</a> y la <a href="#" onClick={(e) => e.preventDefault()}>Política de Privacidad</a>
                </label>
              </div>
              {validationErrors.terms && <div className="validation-error">{validationErrors.terms}</div>}
              {error && <div className="auth-error">{error}</div>}
              <button type="submit" className="auth-button" disabled={loading}>
                {loading ? <LoadingSpinner size="small" /> : 'Registrarme'}
              </button>
              
              <div className="auth-divider">
                <span>o</span>
              </div>
              
              <div className="social-auth">
                <GoogleAuth user={user} />
              </div>
            </form>
            
            <div className="auth-footer">
              <p>¿Ya tenés cuenta? <a href="#" onClick={switchToLogin} className="auth-link">Ingresar</a></p>
            </div>
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
                {validationErrors.email && <div className="validation-error">{validationErrors.email}</div>}
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
              <p>¿No tenés una cuenta? <a href="#" onClick={switchToRegister} className="auth-link">Registrate</a></p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AuthPage;