import React, { useState, useEffect } from 'react';
import { supabase } from '../supabase';
import { toast } from 'react-toastify';
import { useNavigate } from 'react-router-dom';
import LoadingSpinner from './LoadingSpinner';
import './EmailAuth.css'; // Reutilizamos los estilos de EmailAuth

const ResetPassword = () => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [hash, setHash] = useState('');
  const navigate = useNavigate();

  // Extraer el hash de la URL
  useEffect(() => {
    const hashFragment = window.location.hash;
    if (hashFragment) {
      // Formato esperado: #access_token=XXX&type=recovery
      const params = new URLSearchParams(hashFragment.substring(1));
      const accessToken = params.get('access_token');
      const type = params.get('type');
      
      if (accessToken && type === 'recovery') {
        setHash(accessToken);
      }
    }
  }, []);

  const handleResetPassword = async (e) => {
    e.preventDefault();
    
    if (password !== confirmPassword) {
      toast.error('Las contraseñas no coinciden');
      return;
    }
    
    if (password.length < 6) {
      toast.error('La contraseña debe tener al menos 6 caracteres');
      return;
    }
    
    setLoading(true);
    
    try {
      const { error } = await supabase.auth.updateUser({
        password: password
      });
      
      if (error) {
        toast.error(`Error al cambiar la contraseña: ${error.message}`);
      } else {
        toast.success('Contraseña actualizada correctamente');
        // Redirigir al inicio después de un breve retraso
        setTimeout(() => {
          navigate('/');
        }, 2000);
      }
    } catch (error) {
      toast.error(`Error inesperado: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Si no hay hash, mostrar mensaje de error
  if (!hash) {
    return (
      <div className="email-auth-container">
        <h2>Enlace Inválido</h2>
        <p>El enlace para restablecer la contraseña es inválido o ha expirado.</p>
        <button 
          className="auth-button"
          onClick={() => navigate('/')}
        >
          Volver al Inicio
        </button>
      </div>
    );
  }

  return (
    <div className="email-auth-container">
      <h2>Restablecer Contraseña</h2>
      <form onSubmit={handleResetPassword} className="auth-form">
        <div className="form-group">
          <label htmlFor="new-password">Nueva Contraseña</label>
          <input
            id="new-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Nueva contraseña"
            minLength={6}
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
            minLength={6}
            required
          />
        </div>
        <button type="submit" className="auth-button" disabled={loading}>
          {loading ? <LoadingSpinner size="small" /> : 'Cambiar Contraseña'}
        </button>
      </form>
    </div>
  );
};

export default ResetPassword;