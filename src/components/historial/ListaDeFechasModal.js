import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabase';
import LoadingSpinner from '../LoadingSpinner';
import FichaDePartido from './FichaDePartido';
import './ListaDeFechasModal.css';

/**
 * Modal que muestra la lista de fechas de un partido frecuente
 * @param {Array} partidos - Lista de partidos del historial
 * @param {Function} onClose - Función para cerrar el modal
 * @param {String} nombrePartido - Nombre del partido frecuente
 * @param {String} error - Mensaje de error (si existe)
 * @param {Boolean} loading - Estado de carga
 */
const ListaDeFechasModal = ({ partidos, onClose, nombrePartido, error, loading }) => {
  const [selectedPartido, setSelectedPartido] = useState(null);
  const [partidoJugadores, setPartidoJugadores] = useState({});
  // Added state to track which card is in confirmation mode
  // BEFORE: global delete confirmation (centrado, obligaba scrollear)
  const [pendingDeleteId, setPendingDeleteId] = useState(null);
  // AFTER: inline confirmation inside the card (pendingDeleteId === partido.id)
  // Local copy of partidos so we can optimistically remove a deleted item from the list
  const [displayedPartidos, setDisplayedPartidos] = useState(partidos || []);
  const [deletingId, setDeletingId] = useState(null);

  // Keep displayedPartidos in sync when parent partidos prop changes
  useEffect(() => {
    setDisplayedPartidos(partidos || []);
  }, [partidos]);

  // Cargar jugadores para todos los partidos
  useEffect(() => {
    const loadPlayersForMatches = async () => {
      const sourcePartidos = displayedPartidos || [];
      if (!sourcePartidos || sourcePartidos.length === 0) return;
      
      const playersData = {};
      
      for (const partido of sourcePartidos) {
        try {
          const { data: jugadores, error } = await supabase
            .from('jugadores')
            .select('uuid, nombre, foto_url, avatar_url')
            .eq('partido_id', partido.id);
            
          if (!error && jugadores) {
            playersData[partido.id] = jugadores;
          }
        } catch (err) {
          console.error('Error loading players for match:', partido.id, err);
        }
      }
      
      setPartidoJugadores(playersData);
    };
    
    loadPlayersForMatches();
  }, [displayedPartidos]);

  // Seleccionar un partido para ver su ficha
  const handleSelectPartido = (partido) => {
    setSelectedPartido({
      ...partido,
      jugadores: partidoJugadores[partido.id] || [],
    });
  };

  // Volver a la lista de fechas
  const handleBack = () => {
    setSelectedPartido(null);
  };

  // Inicia el modo de confirmación inline para un partido (no abre la ficha)
  const handleStartDelete = (partidoId, e) => {
    if (e && e.stopPropagation) e.stopPropagation();
    setPendingDeleteId(partidoId);
  };

  // Cancela el modo de confirmación inline
  const handleCancelDelete = (e) => {
    if (e && e.stopPropagation) e.stopPropagation();
    setPendingDeleteId(null);
  };

  // Confirma el borrado: llama a supabase, actualiza la lista local y limpia el estado
  const handleConfirmDelete = async (partidoId, e) => {
    if (e && e.stopPropagation) e.stopPropagation();
    try {
      setDeletingId(partidoId);
      const { error: deleteError } = await supabase
        .from('partidos')
        .delete()
        .eq('id', partidoId);

      if (deleteError) {
        console.error('Error deleting partido:', deleteError);
        // keep pendingDeleteId so user can retry or cancel
        return;
      }

      // Optimistically remove from local list
      setDisplayedPartidos((prev) => prev.filter((p) => p.id !== partidoId));
      setPendingDeleteId(null);
      // If the deleted partido was currently selected, go back to list
      if (selectedPartido && selectedPartido.id === partidoId) {
        setSelectedPartido(null);
      }
    } catch (err) {
      console.error('Error confirming delete:', err);
    } finally {
      setDeletingId(null);
    }
  };

  // Formatear fecha para mostrar en formato corto (ej: "Lunes 18/7")
  const formatFecha = (fechaStr) => {
    try {
      const fecha = new Date(fechaStr);
      const weekday = fecha.toLocaleDateString('es-ES', { weekday: 'long' });
      const day = fecha.getDate();
      const month = fecha.getMonth() + 1;
      return `${weekday.charAt(0).toUpperCase() + weekday.slice(1)} ${day}/${month}`;
    } catch (e) {
      return fechaStr || 'Fecha no disponible';
    }
  };

  return (
    <div className="modal-overlay" onClick={(e) => {
      // Cerrar modal al hacer clic fuera del contenido
      if (e.target.className === 'modal-overlay') onClose();
    }}>
      <div className="modal-container">
        {selectedPartido ? (
          // Mostrar ficha de partido seleccionado
          <FichaDePartido 
            partido={selectedPartido} 
            onBack={handleBack} 
            onClose={onClose}
          />
        ) : (
          // Mostrar lista de fechas
          <>
            <div className="modal-header">
              <h2>Historial de {nombrePartido}</h2>
              <button className="close-button" onClick={onClose}>×</button>
            </div>
            <div className="modal-content">
              {loading ? (
                // Estado de carga
                <div className="loading-state">
                  <div className="loading-spinner"></div>
                  <LoadingSpinner size="medium" />
                </div>
              ) : error ? (
                // Estado de error
                <div className="error-state">
                  <p>{error}</p>
                </div>
              ) : (!displayedPartidos || displayedPartidos.length === 0) ? (
                // Estado vacío
                <div className="empty-state">
                  <p>No hay partidos jugados en el historial.</p>
                </div>
              ) : (
                // Lista de fechas
                <div className="fechas-list">
                  {displayedPartidos.map((partido) => {
                    const jugadores = partidoJugadores[partido.id] || [];
                    const equipos = partido.equipos || [];
                    const isPendingDelete = pendingDeleteId === partido.id;
                    const isDeleting = deletingId === partido.id;
                    
                    return (
                      <div 
                        key={partido.id} 
                        className="fecha-card"
                        onClick={() => handleSelectPartido(partido)}
                      >
                        <div className="fecha-info">
                          <div className="fecha-date">
                            {formatFecha(partido.fecha)}
                          </div>
                          <div className="fecha-details">
                            <span className="fecha-location">{partido.sede || 'Sin ubicación'}</span>
                            <span className="fecha-players">{jugadores.length} jugadores</span>
                            {equipos.length === 2 && (
                              <span className="fecha-teams">Equipos formados</span>
                            )}
                          </div>
                        </div>

                        {/* Inline confirmation / actions area */}
                        <div className="fecha-actions">
                          {isPendingDelete ? (
                            <div className="inline-confirm" onClick={(e) => e.stopPropagation()}>
                              <div className="confirm-text">¿Eliminar este partido?</div>
                              <div className="confirm-buttons">
                                <button 
                                  className="confirm-btn" 
                                  onClick={(e) => handleConfirmDelete(partido.id, e)}
                                  disabled={isDeleting}
                                >
                                  {isDeleting ? 'Eliminando...' : 'CONFIRMAR'}
                                </button>
                                <button 
                                  className="cancel-btn" 
                                  onClick={(e) => handleCancelDelete(e)}
                                >CANCELAR</button>
                              </div>
                            </div>
                          ) : (
                            <div className="normal-actions">
                              <button 
                                className="delete-trigger" 
                                onClick={(e) => handleStartDelete(partido.id, e)}
                                aria-label={`Eliminar partido ${partido.id}`}
                              >
                                🗑
                              </button>
                              <div className="fecha-arrow">›</div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ListaDeFechasModal;