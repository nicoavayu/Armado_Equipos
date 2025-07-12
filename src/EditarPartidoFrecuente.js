import React, { useState } from 'react';
import { updatePartidoFrecuente, crearPartidoDesdeFrec } from './supabase';
import { toast } from 'react-toastify';
import AutocompleteSede from './AutocompleteSede';

export default function EditarPartidoFrecuente({ partido, onGuardado, onVolver }) {
  const [fecha, setFecha] = useState(new Date().toISOString().split('T')[0]);
  const [hora, setHora] = useState(partido.hora);
  const [sede, setSede] = useState(partido.sede);
  const [sedeInfo, setSedeInfo] = useState(null);
  const [loading, setLoading] = useState(false);



  const guardarCambios = async () => {
    try {
      setLoading(true);
      await updatePartidoFrecuente(partido.id, {
        hora,
        sede,
        dia_semana: new Date(fecha).getDay()
      });
      toast.success('Cambios guardados');
      onGuardado && onGuardado();
    } catch (error) {
      toast.error('Error al guardar cambios');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="voting-bg">
      <div className="voting-modern-card edit-frequent-container">
        <div className="voting-title-modern">EDITAR {partido.nombre}</div>
        
        <div className="edit-frequent-form">
          <div className="form-group">
            <label className="form-label">Fecha</label>
            <input
              className="input-modern"
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Hora</label>
            <input
              className="input-modern"
              type="time"
              value={hora}
              onChange={(e) => setHora(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Sede</label>
            <AutocompleteSede
              value={sede}
              onSelect={(info) => {
                setSede(info.description);
                setSedeInfo(info);
              }}
            />
          </div>
        </div>

        <div className="edit-frequent-actions">
          <button 
            className="voting-confirm-btn"
            onClick={guardarCambios}
            disabled={loading}
          >
            {loading ? 'GUARDANDO...' : 'GUARDAR CAMBIOS'}
          </button>
          <button 
            className="voting-confirm-btn secondary-btn"
            onClick={onVolver}
          >
            VOLVER
          </button>
        </div>
      </div>
    </div>
  );
}