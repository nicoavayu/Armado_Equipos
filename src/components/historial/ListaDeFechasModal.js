import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabase';
import LoadingSpinner from '../LoadingSpinner';
import FichaDePartido from './FichaDePartido';
import './ListaDeFechasModal.css';

/**
 * Modal que muestra la lista de plantillas (partidos_frecuentes)
 * @param {Object} props
 * @param {Array} props.partidosFrecuentes - Lista de plantillas (partidos_frecuentes)
 * @param {Function} props.onClose - Función para cerrar el modal
 * @param {String} props.nombrePartido - Nombre del partido frecuente
 * @param {String} props.error - Mensaje de error (si existe)
 * @param {Boolean} props.loading - Estado de carga
 */
const ListaDeFechasModal = ({ partidosFrecuentes, onClose, nombrePartido, error, loading }) => {
  const [selectedPartido, setSelectedPartido] = useState(null);
  const [partidoJugadores, setPartidoJugadores] = useState({});
  // Local copy of partidos so we can optimistically remove a deleted item from the list
  const [displayedPartidos, setDisplayedPartidos] = useState(partidosFrecuentes || []);
  const [deletingId, setDeletingId] = useState(null);

  // Temporary global click spy (capture) for debugging click delivery
  useEffect(() => {
    const handler = (e) => {
      const t = e.target;
      try {
        console.log('[CLICK SPY]', {
          type: e.type,
          targetTag: t?.tagName,
          targetClass: t?.className,
          targetId: t?.id,
          text: t?.textContent?.slice ? t.textContent.slice(0, 30) : undefined,
        });
      } catch (err) {
        // defensive
      }
    };
    document.addEventListener('click', handler, true); // capture phase
    return () => document.removeEventListener('click', handler, true);
  }, []);

  // Keep displayedPartidos in sync when parent partidosFrecuentes prop changes
  useEffect(() => {
    setDisplayedPartidos(partidosFrecuentes || []);
  }, [partidosFrecuentes]);

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

  // Borrado simplificado: pedir confirmación nativa y ejecutar DELETE
  const handleDelete = async (partidoId, e) => {
    console.log('🗑️ ENTER handleDelete', partidoId);
    if (e && e.stopPropagation) e.stopPropagation();
    try {
      // This modal only manages plantillas (partidos_frecuentes)
      const confirmMsg = '¿Eliminar esta plantilla? Esta acción no se puede deshacer.';

      const confirmed = window.confirm(confirmMsg);
      if (!confirmed) return;

      console.log('[Historial] delete requested for', 'plantilla', partidoId);
      setDeletingId(partidoId);

      // Force delete against partidos_frecuentes only
      const { data: deleteData, error: deleteError } = await supabase
        .from('partidos_frecuentes')
        .delete()
        .eq('id', partidoId);

      // Log full response for debugging
      console.log('[Historial] DELETE RESPONSE', { partidoId, deleteError, deleteData });

      if (deleteError) {
        const { code, message, details, hint } = deleteError || {};
        console.error('[Historial] DELETE FAILED', {
          partidoId,
          code,
          message,
          details,
          hint,
          fullError: deleteError,
        });
        // aquí se podría mostrar un toast de error
        return;
      }

      console.log('[Historial] DELETE OK', partidoId);

      // Optimistic update: remover partido (plantilla) de la lista local
      setDisplayedPartidos((prev) => prev.filter((p) => p.id !== partidoId));
      if (selectedPartido && selectedPartido.id === partidoId) setSelectedPartido(null);
      console.log('[Historial] delete successful for', partidoId);
    } catch (err) {
      console.error('Error deleting item:', err);
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
      // Cerrar modal al hacer clic fuera del contenido — solo si el click fue directo en el overlay
      if (e.target === e.currentTarget) onClose();
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
              <button className="close-button" onClick={() => onClose && onClose()}>×</button>
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
                  <p>No hay plantillas guardadas.</p>
                </div>
              ) : (
                // Lista de fechas
                <div className="fechas-list">
                  {displayedPartidos.map((partido) => {
                    const jugadores = partidoJugadores[partido.id] || [];
                    const equipos = partido.equipos || [];
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
                            <span className="fecha-location">{partido.sede || partido.lugar || 'Sin ubicación'}</span>
                            <span className="fecha-players">{jugadores.length} jugadores</span>
                            {equipos.length === 2 && (
                              <span className="fecha-teams">Equipos formados</span>
                            )}
                          </div>
                        </div>

                        {/* Actions area: botón de borrar simplificado */}
                        <div className="fecha-actions" style={{ position: 'relative', zIndex: 9998, pointerEvents: 'auto' }}>
                          <button
                            type="button"
                            className="delete-trigger"
                            style={{ position: 'relative', zIndex: 9999, pointerEvents: 'auto' }}
                            onPointerDown={(e) => { console.log('[Historial] pointerdown delete', partido.id, e.type); if (e && e.stopPropagation) e.stopPropagation(); }}
                            onTouchStart={(e) => { console.log('[Historial] touchstart delete', partido.id); if (e && e.stopPropagation) e.stopPropagation(); }}
                            onClick={(e) => { console.log('🗑️ CLICK DELETE BUTTON', partido.id); console.log('[Historial] delete button click', partido.id, e.type); if (e && e.stopPropagation) e.stopPropagation(); handleDelete(partido.id, e); }}
                            disabled={isDeleting}
                            aria-label={`Eliminar plantilla ${partido.id}`}
                          >
                            {isDeleting ? 'Eliminando...' : '🗑'}
                          </button>
                           <div className="fecha-arrow" style={{ position: 'relative', zIndex: 5, pointerEvents: 'auto' }}>›</div>
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