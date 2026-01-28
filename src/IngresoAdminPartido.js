import React, { useState } from 'react';
import { getPartidoPorCodigo } from './supabase';

export default function IngresoAdminPartido({ onAcceder, onCancelar }) {
  const [codigo, setCodigo] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleIngresar(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const partido = await getPartidoPorCodigo(codigo.trim());
      if (!partido) throw new Error('Partido no encontrado');
      onAcceder(partido); // Avanza al AdminPanel del partido
    } catch (err) {
      setError('Código incorrecto o partido no existe.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed z-[99] inset-0 w-screen h-[100dvh] bg-[rgba(30,20,70,0.46)] flex items-center justify-center">
      <div className="bg-[#191942] rounded-[38px] shadow-[0_8px_54px_0_rgba(34,40,80,0.18)] px-[50px] pt-[54px] pb-[40px] max-w-[520px] w-[95vw] text-white flex flex-col items-center max-[600px]:p-[28px_10px_24px] max-[600px]:max-w-[98vw] max-[600px]:rounded-[14px]">
        <div className="text-[2.3rem] font-[Bebas_Neue,Oswald,Arial,sans-serif] tracking-[0.03em] mb-[22px] text-center max-[600px]:text-[2.7rem]">
          ADMINISTRAR PARTIDO EXISTENTE
        </div>
        <form onSubmit={handleIngresar} autoComplete="off" style={{ width: '100%' }} className="w-full flex flex-col items-center">
          <input
            className="w-full text-[32px] p-[14px_20px] bg-[#312e5a] border-[3px] border-white text-[#ccc] rounded-lg font-[Oswald,Arial,sans-serif] font-bold outline-none mb-[26px] max-[600px]:text-[18px]"
            type="text"
            placeholder="Código del partido"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            required
            autoFocus
          />
          <div className="w-full flex gap-[22px] justify-center">
            <button
              className="w-full text-[2.1rem] py-[20px] m-0 rounded-[9px] border-[3px] border-white font-[Oswald,Arial,sans-serif] font-bold tracking-[0.04em] transition-all duration-200 active:opacity-93 max-[600px]:text-[1.1rem] max-[600px]:py-[12px]"
              type="submit"
              disabled={loading}
              style={{ flex: 1 }}
            >
              {loading ? 'Cargando...' : 'INGRESAR'}
            </button>
            <button
              className="w-full text-[2.1rem] py-[20px] m-0 rounded-[9px] border-[3px] border-white font-[Oswald,Arial,sans-serif] font-bold tracking-[0.04em] transition-all duration-200 bg-[#be3256] text-white max-[600px]:text-[1.1rem] max-[600px]:py-[12px]"
              type="button"
              style={{ flex: 1 }}
              onClick={onCancelar}
              disabled={loading}
            >
              CANCELAR
            </button>
          </div>
        </form>
        {error && (
          <div className="text-white bg-[#d13c3c] rounded-lg p-[9px_10px] mt-[22px] text-center text-[18px] font-bold w-full">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
