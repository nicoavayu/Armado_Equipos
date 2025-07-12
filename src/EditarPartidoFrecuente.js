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
      <div className="voting-modern-card" style={{ padding: 42, maxWidth: 420 }}>
        <div className="match-name" style={{ marginBottom: 24 }}>EDITAR {partido.nombre}</div>
        
        <input
          className="input-modern"
          type="date"
          placeholder="Fecha"
          value={fecha}
          onChange={(e) => setFecha(e.target.value)}
          style={{ marginBottom: 22, width: "100%" }}
        />

        <input
          className="input-modern"
          type="time"
          placeholder="Hora"
          value={hora}
          onChange={(e) => setHora(e.target.value)}
          style={{ marginBottom: 22, width: "100%" }}
        />

        <AutocompleteSede
          value={sede}
          onSelect={(info) => {
            setSede(info.description);
            setSedeInfo(info);
          }}
        />

        <button 
          className="voting-confirm-btn"
          onClick={guardarCambios}
          disabled={loading}
          style={{ width: "100%", marginBottom: 12, fontSize: '1.5rem', height: '64px', borderRadius: '9px' }}
        >
          {loading ? 'GUARDANDO...' : 'GUARDAR CAMBIOS'}
        </button>
        <button 
          className="voting-confirm-btn wipe-btn"
          onClick={onVolver}
          style={{ background: '#DE1C49', width: '100%', fontSize: '1.5rem', height: '64px', borderRadius: '9px', marginBottom: '0' }}
        >
          VOLVER AL INICIO
        </button>
      </div>
    </div>
  );
}