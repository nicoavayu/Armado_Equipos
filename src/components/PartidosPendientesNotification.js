import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getPartidosPendientesCalificacion } from '../supabase';
import './PartidosPendientesNotification.css';

/**
 * Componente que muestra una notificación de partidos pendientes de calificación
 * y permite al usuario acceder a las encuestas correspondientes
 * @param {string} userId - ID del usuario actual
 */
const PartidosPendientesNotification = ({ userId }) => {
  const [partidosPendientes, setPartidosPendientes] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  // Cargar partidos pendientes al montar el componente
  useEffect(() => {
    const fetchPartidosPendientes = async () => {
      if (!userId) return;
      
      try {
        setLoading(true);
        const partidos = await getPartidosPendientesCalificacion(userId);
        setPartidosPendientes(partidos || []);
        
        // Mostrar en consola para testing
        console.log('IDs de partidos para testing:', partidos.map((p) => p.id));
      } catch (error) {
        console.error('Error cargando partidos pendientes:', error);
      } finally {
        setLoading(false);
      }
    };
    
    fetchPartidosPendientes();
  }, [userId]);

  // Si no hay partidos pendientes, no mostrar nada
  if (loading || partidosPendientes.length === 0) {
    return null;
  }

  // Formatear fecha para mostrar
  const formatFecha = (fechaStr) => {
    try {
      const fecha = new Date(fechaStr);
      return fecha.toLocaleDateString('es-ES', { 
        weekday: 'long',
        day: 'numeric',
        month: 'numeric',
      });
    } catch (e) {
      return fechaStr || 'Fecha no disponible';
    }
  };

  // Ir a la encuesta del partido seleccionado
  const handleCalificar = (partidoId) => {
    setShowModal(false);
    navigate(`/encuesta/${partidoId}`);
  };

  return (
    <>
      {/* Botón de notificación */}
      <div 
        className="partidos-pendientes-notification"
        onClick={() => setShowModal(true)}
      >
        <span className="notification-icon">🔔</span>
        <span className="notification-text">
          Tienes {partidosPendientes.length} partido{partidosPendientes.length !== 1 ? 's' : ''} sin calificar
        </span>
      </div>

      {/* Modal con lista de partidos pendientes */}
      {showModal && (
        <div className="partidos-pendientes-modal-overlay" onClick={() => setShowModal(false)}>
          <div className="partidos-pendientes-modal" onClick={(e) => e.stopPropagation()}>
            <div className="partidos-pendientes-header">
              <h3>Partidos pendientes de calificación</h3>
              <button className="close-button" onClick={() => setShowModal(false)}>×</button>
            </div>
            
            <div className="partidos-pendientes-list">
              {partidosPendientes.map((partido) => (
                <div key={partido.id} className="partido-pendiente-item">
                  <div className="partido-pendiente-info">
                    <div className="partido-pendiente-fecha">
                      {formatFecha(partido.fecha)}
                    </div>
                    <div className="partido-pendiente-sede">
                      {partido.sede || 'Sin ubicación'} - {partido.hora || 'Sin hora'}
                    </div>
                  </div>
                  <button 
                    className="calificar-button"
                    onClick={() => handleCalificar(partido.id)}
                  >
                    Calificar
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default PartidosPendientesNotification;