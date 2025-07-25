import React from 'react';
import './EstadisticasPartido.css';

/**
 * Componente que muestra estadísticas del partido basadas en encuestas
 * @param {Array} encuestas - Lista de encuestas del partido
 */
const EstadisticasPartido = ({ encuestas = [] }) => {
  // Calcular estadísticas
  const totalEncuestas = encuestas.length;
  
  // Contar cuántas encuestas reportan que el partido se jugó
  const partidosJugados = encuestas.filter((e) => e.se_jugo).length;
  
  // Porcentaje de partido limpio
  const votosPartidoLimpio = encuestas.filter((e) => e.partido_limpio).length;
  const porcentajeLimpio = totalEncuestas > 0 
    ? Math.round((votosPartidoLimpio / totalEncuestas) * 100) 
    : 0;
  
  // Contar ausencias reportadas (jugadores únicos)
  const ausenciasSet = new Set();
  encuestas.forEach((encuesta) => {
    if (!encuesta.asistieron_todos && encuesta.jugadores_ausentes) {
      encuesta.jugadores_ausentes.forEach((id) => ausenciasSet.add(id));
    }
  });
  const ausenciasReportadas = ausenciasSet.size;
  
  // Contar jugadores violentos reportados (jugadores únicos)
  const violentosSet = new Set();
  encuestas.forEach((encuesta) => {
    if (!encuesta.partido_limpio && encuesta.jugadores_violentos) {
      encuesta.jugadores_violentos.forEach((id) => violentosSet.add(id));
    }
  });
  const violentosReportados = violentosSet.size;
  
  return (
    <div className="estadisticas-partido">
      <h3 className="ficha-section-title">Estadísticas del Partido</h3>
      
      <div className="estadisticas-grid">
        <div className="estadistica-item">
          <div className="estadistica-valor">{totalEncuestas}</div>
          <div className="estadistica-label">Encuestas respondidas</div>
        </div>
        
        <div className="estadistica-item">
          <div className="estadistica-valor">{partidosJugados > 0 ? 'Sí' : 'No'}</div>
          <div className="estadistica-label">¿Se jugó el partido?</div>
        </div>
        
        <div className="estadistica-item">
          <div className="estadistica-valor">{porcentajeLimpio}%</div>
          <div className="estadistica-label">Partido limpio</div>
          <div className="estadistica-barra-container">
            <div 
              className="estadistica-barra-fill" 
              style={{ width: `${porcentajeLimpio}%` }}
            ></div>
          </div>
        </div>
        
        <div className="estadistica-item">
          <div className="estadistica-valor">{ausenciasReportadas}</div>
          <div className="estadistica-label">Ausencias reportadas</div>
        </div>
        
        <div className="estadistica-item">
          <div className="estadistica-valor">{violentosReportados}</div>
          <div className="estadistica-label">Jugadores con tarjeta negra</div>
        </div>
      </div>
      
      {totalEncuestas === 0 && (
        <div className="estadisticas-no-data">
          No hay encuestas respondidas para este partido
        </div>
      )}
    </div>
  );
};

export default EstadisticasPartido;