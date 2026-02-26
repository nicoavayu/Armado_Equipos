import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabase';
import LoadingSpinner from '../LoadingSpinner';
import FichaDePartido from './FichaDePartido';

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
            .select('usuario_id, nombre, avatar_url')
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
    <>
      <style>
        {`
          @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          @keyframes slideUp {
            from { transform: translateY(50px); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
          }
        `}
      </style>
      <div
        data-modal-root="true"
        className="fixed inset-0 bg-black/70 flex justify-center items-center z-[1000] animate-[fadeIn_0.3s_ease]"
        onClick={(e) => {
          // Cerrar modal al hacer clic fuera del contenido — solo si el click fue directo en el overlay
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div className="bg-[#1a1a2e] w-[90%] max-w-[600px] max-h-[90vh] rounded-xl overflow-hidden flex flex-col shadow-[0_5px_20px_rgba(0,0,0,0.5)] animate-[slideUp_0.3s_ease] max-[768px]:w-full max-[768px]:h-full max-[768px]:max-w-none max-[768px]:max-h-none max-[768px]:rounded-none">
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
              <div className="flex justify-between items-center px-5 py-[15px] bg-[#16162e] border-b border-[#2a2a40]">
                <h2 className="m-0 text-[#8178e5] text-[1.3rem] font-semibold max-[768px]:text-[1.2rem]">Historial de {nombrePartido}</h2>
                <button className="bg-none border-none text-white text-2xl cursor-pointer" onClick={() => onClose && onClose()}>×</button>
              </div>
              <div className="flex-1 overflow-y-auto p-0">
                {loading ? (
                  // Estado de carga
                  <div className="flex flex-col items-center justify-center py-[60px] px-0 text-center text-[#aaa]">
                    <div className="w-10 h-10 border-4 border-[#8178e5]/30 rounded-full border-t-[#8178e5] animate-[spin_1s_linear_infinite] mb-5"></div>
                    <LoadingSpinner size="medium" />
                  </div>
                ) : error ? (
                  // Estado de error
                  <div className="flex flex-col items-center justify-center py-[60px] px-0 text-center text-[#ff6b6b]">
                    <p>{error}</p>
                  </div>
                ) : (!displayedPartidos || displayedPartidos.length === 0) ? (
                  // Estado vacío
                  <div className="flex flex-col items-center justify-center py-[60px] px-0 text-center text-[#aaa]">
                    <p>No hay plantillas guardadas.</p>
                  </div>
                ) : (
                  // Lista de fechas
                  <div className="flex flex-col p-4 gap-0">
                    {displayedPartidos.map((partido) => {
                      const jugadores = partidoJugadores[partido.id] || [];
                      const equipos = partido.equipos || [];
                      const isDeleting = deletingId === partido.id;

                      return (
                        <div
                          key={partido.id}
                          className="flex justify-between items-center px-5 py-[15px] mb-2 bg-white/10 rounded-xl border border-white/20 cursor-pointer transition-all duration-300 shadow-[0_4px_12px_rgba(0,0,0,0.1)] relative pointer-events-auto hover:-translate-y-0.5 hover:shadow-[0_8px_16px_rgba(0,0,0,0.15)] hover:border-white/40 hover:bg-white/15"
                          onClick={() => handleSelectPartido(partido)}
                        >
                          <div className="flex flex-col">
                            <div className="text-[1.1rem] font-medium text-white mb-[5px] capitalize max-[768px]:text-[1rem]">
                              {formatFecha(partido.fecha)}
                            </div>
                            <div className="flex items-center gap-[10px] flex-wrap">
                              <span className="text-[#aaa] text-[0.9rem]">{partido.sede || partido.lugar || 'Sin ubicación'}</span>
                              <span className="text-[#8178e5] text-[0.8rem] font-semibold">{jugadores.length} jugadores</span>
                              {equipos.length === 2 && (
                                <span className="bg-[#4CAF50] text-white py-[2px] px-2 rounded-xl text-[0.8rem] font-semibold">Equipos formados</span>
                              )}
                            </div>
                          </div>

                          {/* Actions area: botón de borrar simplificado */}
                          <div className="flex items-center gap-2 min-w-[160px] justify-end relative z-10 pointer-events-auto max-[768px]:min-w-[110px]" style={{ position: 'relative', zIndex: 9998, pointerEvents: 'auto' }}>
                            <button
                              type="button"
                              className="bg-none border-none text-[#ff6b6b] text-[18px] cursor-pointer p-1.5 rounded-lg pointer-events-auto relative z-[11] hover:bg-[#ff6b6b]/10"
                              style={{ position: 'relative', zIndex: 9999, pointerEvents: 'auto' }}
                              onPointerDown={(e) => { console.log('[Historial] pointerdown delete', partido.id, e.type); if (e && e.stopPropagation) e.stopPropagation(); }}
                              onTouchStart={(e) => { console.log('[Historial] touchstart delete', partido.id); if (e && e.stopPropagation) e.stopPropagation(); }}
                              onClick={(e) => { console.log('🗑️ CLICK DELETE BUTTON', partido.id); console.log('[Historial] delete button click', partido.id, e.type); if (e && e.stopPropagation) e.stopPropagation(); handleDelete(partido.id, e); }}
                              disabled={isDeleting}
                              aria-label={`Eliminar plantilla ${partido.id}`}
                            >
                              {isDeleting ? 'Eliminando...' : '🗑'}
                            </button>
                            <div className="text-[#8178e5] text-2xl font-bold relative z-[5] pointer-events-auto" style={{ position: 'relative', zIndex: 5, pointerEvents: 'auto' }}>›</div>
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
    </>
  );
};

export default ListaDeFechasModal;
