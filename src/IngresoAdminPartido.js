import React, { useState } from 'react';
import { getPartidoPorCodigo } from './supabase';
import './IngresoAdminPartido.css';

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
    <div className="ingreso-admin-modal-bg">
      <div className="ingreso-admin-modal-box">
        <div className="voting-title-modern" style={{ marginBottom: 22, textAlign: 'center' }}>
          ADMINISTRAR PARTIDO EXISTENTE
        </div>
        <form onSubmit={handleIngresar} autoComplete="off" style={{ width: '100%' }}>
          <input
            className="input-modern"
            type="text"
            placeholder="Código del partido"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            required
            autoFocus
          />
          <div className="ingreso-admin-btn-row">
            <button
              className="voting-confirm-btn wipe-btn"
              type="submit"
              disabled={loading}
              style={{ flex: 1 }}
            >
              {loading ? 'Cargando...' : 'INGRESAR'}
            </button>
            <button
              className="voting-confirm-btn btn-volver"
              type="button"
              style={{ flex: 1 }}
              onClick={onCancelar}
              disabled={loading}
            >
              CANCELAR
            </button>
          </div>
        </form>
        {error && <div className="ingreso-admin-error">{error}</div>}
      </div>
    </div>
  );
}
