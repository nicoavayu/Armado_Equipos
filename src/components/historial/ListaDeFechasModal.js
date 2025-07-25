import React, { useState } from 'react';
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

  // Seleccionar un partido para ver su ficha
  const handleSelectPartido = (partido) => {
    setSelectedPartido(partido);
  };

  // Volver a la lista de fechas
  const handleBack = () => {
    setSelectedPartido(null);
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
                  <p>Cargando historial de partidos...</p>
                </div>
              ) : error ? (
                // Estado de error
                <div className="error-state">
                  <p>{error}</p>
                </div>
              ) : partidos.length === 0 ? (
                // Estado vacío
                <div className="empty-state">
                  <p>No hay partidos jugados en el historial.</p>
                </div>
              ) : (
                // Lista de fechas
                <div className="fechas-list">
                  {partidos.map((partido) => (
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
                          <span className="fecha-location">{partido.lugar || 'Sin ubicación'}</span>
                          {partido.resultado && (
                            <span className="fecha-score">{partido.resultado}</span>
                          )}
                        </div>
                      </div>
                      <div className="fecha-arrow">›</div>
                    </div>
                  ))}
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