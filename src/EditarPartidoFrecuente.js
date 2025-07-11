import React, { useState } from 'react';
import { updatePartidoFrecuente, crearPartidoDesdeFrec } from './supabase';
import { toast } from 'react-toastify';
import AutocompleteSede from './AutocompleteSede';

export default function EditarPartidoFrecuente({ partido, onPartidoCreado, onVolver }) {
  const [hora, setHora] = useState(partido.hora);
  const [sede, setSede] = useState(partido.sede);
  const [sedeInfo, setSedeInfo] = useState(null);
  const [fecha, setFecha] = useState(new Date().toISOString().split('T')[0]);
  const [jugadores, setJugadores] = useState(partido.jugadores_frecuentes || []);
  const [nuevoJugador, setNuevoJugador] = useState('');
  const [loading, setLoading] = useState(false);

  const agregarJugador = () => {
    if (!nuevoJugador.trim()) return;
    const jugador = {
      nombre: nuevoJugador.trim(),
      uuid: `temp_${Date.now()}`,
      foto_url: null
    };
    setJugadores(prev => [...prev, jugador]);
    setNuevoJugador('');
  };

  const eliminarJugador = (index) => {
    setJugadores(prev => prev.filter((_, i) => i !== index));
  };

  const guardarCambios = async () => {
    try {
      setLoading(true);
      await updatePartidoFrecuente(partido.id, {
        hora,
        sede,
        jugadores_frecuentes: jugadores
      });
      toast.success('Cambios guardados');
    } catch (error) {
      toast.error('Error al guardar cambios');
    } finally {
      setLoading(false);
    }
  };

  const crearPartido = async () => {
    try {
      setLoading(true);
      const partidoActualizado = {
        ...partido,
        hora,
        sede,
        jugadores_frecuentes: jugadores
      };
      const nuevoPartido = await crearPartidoDesdeFrec(partidoActualizado, fecha);
      onPartidoCreado(nuevoPartido);
    } catch (error) {
      toast.error('Error al crear partido');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="voting-bg">
      <div className="voting-modern-card edit-frequent-container">
        <div className="voting-title-modern">{partido.nombre}</div>
        
        <div className="edit-frequent-form">
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

          <div className="form-group">
            <label className="form-label">Fecha del partido</label>
            <input
              className="input-modern"
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Jugadores ({jugadores.length})</label>
            <div className="add-player-section">
              <input
                className="input-modern add-player-input"
                placeholder="Nombre del jugador"
                value={nuevoJugador}
                onChange={(e) => setNuevoJugador(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && agregarJugador()}
              />
              <button 
                className="add-player-btn"
                onClick={agregarJugador}
                disabled={!nuevoJugador.trim()}
              >
                +
              </button>
            </div>
            
            <div className="players-list">
              {jugadores.map((jugador, index) => (
                <div key={index} className="player-item">
                  <span className="player-name">{jugador.nombre}</span>
                  <button 
                    className="remove-player-btn"
                    onClick={() => eliminarJugador(index)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="edit-frequent-actions">
          <button 
            className="voting-confirm-btn"
            onClick={crearPartido}
            disabled={loading || !fecha}
          >
            {loading ? 'CREANDO...' : 'CREAR PARTIDO'}
          </button>
          <button 
            className="voting-confirm-btn secondary-btn"
            onClick={guardarCambios}
            disabled={loading}
          >
            {loading ? 'GUARDANDO...' : 'GUARDAR CAMBIOS'}
          </button>
          <button 
            className="voting-confirm-btn tertiary-btn"
            onClick={onVolver}
          >
            VOLVER
          </button>
        </div>
      </div>
    </div>
  );
}