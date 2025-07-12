import React, { useState, useEffect } from 'react';
import { getPartidosFrecuentes, deletePartidoFrecuente } from './supabase';
import { toast } from 'react-toastify';
import { DIAS_SEMANA_CORTO } from './constants';

export default function ListaPartidosFrecuentes({ onEditar, onEntrar, onVolver }) {
  const [partidosFrecuentes, setPartidosFrecuentes] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    cargarPartidos();
  }, []);

  const cargarPartidos = async () => {
    try {
      console.log('Loading frequent matches...');
      const partidos = await getPartidosFrecuentes();
      console.log('Frequent matches loaded:', partidos);
      setPartidosFrecuentes(partidos);
    } catch (error) {
      console.error('Error loading frequent matches:', error);
      toast.error('Error al cargar partidos: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const eliminarPartido = async (id, nombre) => {
    if (!window.confirm(`¿Eliminar "${nombre}"?`)) return;
    try {
      await deletePartidoFrecuente(id);
      await cargarPartidos();
      toast.success('Partido eliminado');
    } catch (error) {
      toast.error('Error al eliminar');
    }
  };



  if (loading) {
    return (
      <div className="voting-bg">
        <div className="voting-modern-card">
          <div className="voting-title-modern">CARGANDO...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="voting-bg">
      <div className="voting-modern-card frequent-list-container">
        <div className="voting-title-modern">PARTIDOS FRECUENTES</div>
        
        {partidosFrecuentes.length === 0 ? (
          <div className="frequent-empty-state">
            <p>No hay partidos frecuentes configurados</p>
          </div>
        ) : (
          <div className="frequent-list">
            {partidosFrecuentes.map(partido => (
              <div key={partido.id} className="frequent-list-item">
                <div className="frequent-item-info">
                  <div className="frequent-item-name">{partido.nombre}</div>
                  <div className="frequent-item-details">
                    {DIAS_SEMANA_CORTO[partido.dia_semana] || `Día ${partido.dia_semana}`} • {partido.hora}
                  </div>
                  <div className="frequent-item-sede">
                    {partido.sede}
                  </div>
                </div>
                <div className="frequent-item-actions">
                  <button 
                    className="frequent-action-btn edit-btn"
                    onClick={() => onEntrar(partido)}
                  >
                    ENTRAR
                  </button>
                  <button 
                    className="frequent-action-btn edit-btn"
                    onClick={() => onEditar(partido)}
                  >
                    EDITAR
                  </button>
                  <button 
                    className="frequent-action-btn delete-btn"
                    onClick={() => eliminarPartido(partido.id, partido.nombre)}
                  >
                    ELIMINAR
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="frequent-footer-actions">
          <button className="voting-confirm-btn wipe-btn" onClick={onVolver} style={{ width: "100%", background: '#DE1C49' }}>
            VOLVER AL INICIO
          </button>
        </div>
      </div>
    </div>
  );
}