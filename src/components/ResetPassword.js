import React, { useState, useEffect } from 'react';
import { supabase } from '../supabase';
import { toast } from 'react-toastify';
import { useNavigate } from 'react-router-dom';
import LoadingSpinner from './LoadingSpinner';


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
        password: password,
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
      <div className="w-full mx-auto max-[480px]:max-w-[98%]">
        <h2>Enlace Inválido</h2>
        <p>El enlace para restablecer la contraseña es inválido o ha expirado.</p>
        <button
          className="p-2.5 rounded-lg border-none bg-[#0864b2] text-white text-base font-medium cursor-pointer transition-colors duration-300 flex justify-center items-center h-11 w-full mt-1.5 hover:not-disabled:bg-[#6a5fd0] disabled:opacity-70 disabled:cursor-not-allowed max-[480px]:p-2 max-[480px]:text-sm max-[480px]:h-10"
          onClick={() => navigate('/')}
        >
          Volver al Inicio
        </button>
      </div>
    );
  }

  return (
    <div className="w-full mx-auto max-[480px]:max-w-[98%]">
      <h2>Restablecer Contraseña</h2>
      <form onSubmit={handleResetPassword} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5 mb-2.5">
          <label htmlFor="new-password" className="text-white text-sm font-medium">Nueva Contraseña</label>
          <input
            id="new-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Nueva contraseña"
            minLength={6}
            required
            className="px-3.5 py-2.5 rounded-lg border border-white/20 bg-white/20 text-white text-base transition-colors duration-300 w-full placeholder:text-white/50 focus:outline-none focus:border-[#8178e5] max-[480px]:px-3 max-[480px]:text-sm"
          />
        </div>
        <div className="flex flex-col gap-1.5 mb-2.5">
          <label htmlFor="confirm-password" className="text-white text-sm font-medium">Confirmar Contraseña</label>
          <input
            id="confirm-password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirmar contraseña"
            minLength={6}
            required
            className="px-3.5 py-2.5 rounded-lg border border-white/20 bg-white/20 text-white text-base transition-colors duration-300 w-full placeholder:text-white/50 focus:outline-none focus:border-[#8178e5] max-[480px]:px-3 max-[480px]:text-sm"
          />
        </div>
        <button type="submit" className="p-2.5 rounded-lg border-none bg-[#0864b2] text-white text-base font-medium cursor-pointer transition-colors duration-300 flex justify-center items-center h-11 w-full mt-1.5 hover:not-disabled:bg-[#6a5fd0] disabled:opacity-70 disabled:cursor-not-allowed max-[480px]:p-2 max-[480px]:text-sm max-[480px]:h-10" disabled={loading}>
          {loading ? <LoadingSpinner size="small" /> : 'Cambiar Contraseña'}
        </button>
      </form>
    </div>
  );
};

export default ResetPassword;