import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabase';
import JugadorDestacadoCard from './JugadorDestacadoCard';
import EstadisticasPartido from './EstadisticasPartido';
import './FichaDePartido.css';
import PlantillaJugadores from './PlantillaJugadores';

/**
 * Componente que muestra la ficha detallada de un partido
 * @param {Object} partido - Datos básicos del partido
 * @param {Function} onBack - Función para volver a la lista
 * @param {Function} onClose - Función para cerrar el modal
 */
const FichaDePartido = ({ partido, onBack, onClose }) => {
  const [detallesPartido, setDetallesPartido] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchDetallesPartido = async () => {
      if (!partido || !partido.id) return;
      
      setLoading(true);
      try {
        // Obtener detalles del partido con equipos y encuestas
        const { data: partidoData, error: partidoError } = await supabase
          .from('partidos')
          .select(`
            *,
            equipos:equipos_partidos(
              id,
              nombre,
              jugadores:jugadores_equipos(
                jugador:jugadores(*)
              )
            ),
            encuestas:post_match_surveys(*)
          `)
          .eq('id', partido.id)
          .single();
        
        if (partidoError) throw partidoError;
        
        // Obtener premios y jugadores destacados
        const { data: premiosData, error: premiosError } = await supabase
          .from('player_awards')
          .select(`
            *,
            jugador:jugadores(*)
          `)
          .eq('partido_id', partido.id);
        
        if (premiosError) throw premiosError;
        
        // Procesar datos de premios por categoría
        const mvps = premiosData?.filter((p) => p.award_type === 'mvp') || [];
        const arqueros = premiosData?.filter((p) => p.award_type === 'goalkeeper') || [];
        const sucios = premiosData?.filter((p) => p.award_type === 'negative_fair_play') || [];
        
        // Recopilar IDs de jugadores ausentes de todas las encuestas
        const ausentesIds = new Set();
        partidoData?.encuestas?.forEach((encuesta) => {
          if (!encuesta.asistieron_todos && encuesta.jugadores_ausentes?.length) {
            encuesta.jugadores_ausentes.forEach((ausenteId) => {
              ausentesIds.add(ausenteId);
            });
          }
        });
        
        // Obtener datos de jugadores ausentes
        let ausentesData = [];
        if (ausentesIds.size > 0) {
          const { data: jugadoresData } = await supabase
            .from('jugadores')
            .select('*')
            .in('id', Array.from(ausentesIds));
          
          ausentesData = jugadoresData || [];
        }
        
        // Consolidar todos los datos
        setDetallesPartido({
          ...partidoData,
          mvps,
          arqueros,
          sucios,
          ausentes: ausentesData,
        });
      } catch (err) {
        console.error('Error al cargar detalles del partido:', err);
        setError('No se pudieron cargar los detalles del partido');
      } finally {
        setLoading(false);
      }
    };
    
    fetchDetallesPartido();
  }, [partido]);

  // Formatear fecha para mostrar
  const formatFecha = (fechaStr) => {
    try {
      const fecha = new Date(fechaStr);
      const options = { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric',
        hour: '2-digit', 
        minute: '2-digit',
        weekday: 'long',
      };
      return fecha.toLocaleDateString('es-ES', options);
    } catch (e) {
      return fechaStr || 'Fecha no disponible';
    }
  };

  // Estado de carga
  if (loading) {
    return (
      <div className="ficha-loading">
        <div className="loading-spinner"></div>
        <p>Cargando detalles del partido...</p>
      </div>
    );
  }

  // Estado de error
  if (error || !detallesPartido) {
    return (
      <div className="ficha-error">
        <h3>Error</h3>
        <p>{error || 'No se pudo cargar la información del partido'}</p>
        <div className="ficha-buttons">
          <button onClick={onBack} className="ficha-back-btn">Volver</button>
          <button onClick={onClose} className="ficha-close-btn">Cerrar</button>
        </div>
      </div>
    );
  }

  const { fecha, lugar, resultado, mvps, arqueros, sucios, ausentes, encuestas } = detallesPartido;

  // Verificar si hay encuestas o votos para mostrar estadísticas completas
  const tieneEncuestas = encuestas && encuestas.length > 0;
  const tieneDestacados = mvps.length > 0 || arqueros.length > 0 || sucios.length > 0;
  const tieneAusentes = ausentes && ausentes.length > 0;
  
  return (
    <div className="ficha-partido">
      <div className="ficha-header">
        <button className="ficha-back-btn" onClick={onBack}>
          ‹ Volver
        </button>
        <h2>Ficha del Partido</h2>
        <button className="close-button" onClick={onClose}>×</button>
      </div>
      
      <div className="ficha-content">
        {/* Información principal */}
        <div className="ficha-info-principal">
          <div className="ficha-fecha">{formatFecha(fecha)}</div>
          <div className="ficha-lugar">{lugar || 'Sin ubicación'}</div>
          {resultado && (
            <div className="ficha-resultado">{resultado}</div>
          )}
        </div>
        
        {/* Plantilla de jugadores - SIEMPRE se muestra */}
        <PlantillaJugadores jugadores={detallesPartido.jugadores || []} />
        
        {/* Secciones que solo se muestran si hay encuestas o datos */}
        {tieneDestacados && (
          <div className="ficha-section">
            <h3 className="ficha-section-title">Jugadores Destacados</h3>
            
            {mvps.length > 0 ? (
              <div className="ficha-destacados">
                <h4>MVP del Partido</h4>
                <div className="ficha-destacados-grid">
                  {mvps.map((premio) => (
                    <JugadorDestacadoCard 
                      key={premio.id}
                      jugador={premio.jugador}
                      tipo="mvp"
                    />
                  ))}
                </div>
              </div>
            ) : null}
            
            {arqueros.length > 0 ? (
              <div className="ficha-destacados">
                <h4>Mejor Arquero</h4>
                <div className="ficha-destacados-grid">
                  {arqueros.map((premio) => (
                    <JugadorDestacadoCard 
                      key={premio.id}
                      jugador={premio.jugador}
                      tipo="arquero"
                    />
                  ))}
                </div>
              </div>
            ) : null}
            
            {sucios.length > 0 && (
              <div className="ficha-destacados">
                <h4>Tarjeta Negra</h4>
                <div className="ficha-destacados-grid">
                  {sucios.map((premio) => (
                    <JugadorDestacadoCard 
                      key={premio.id}
                      jugador={premio.jugador}
                      tipo="sucio"
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        
        {/* Jugadores ausentes - solo si hay */}
        {tieneAusentes && (
          <div className="ficha-section">
            <h3 className="ficha-section-title">Jugadores Ausentes</h3>
            <div className="ficha-ausentes">
              {ausentes.map((jugador) => (
                <div key={jugador.id} className="ficha-ausente-item">
                  <div className="ficha-ausente-avatar">
                    {jugador.avatar_url ? (
                      <img src={jugador.avatar_url} alt={jugador.nombre} />
                    ) : (
                      <div className="ficha-ausente-placeholder">
                        {jugador.nombre.charAt(0)}
                      </div>
                    )}
                  </div>
                  <div className="ficha-ausente-nombre">{jugador.nombre}</div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        {/* Estadísticas del partido - solo si hay encuestas */}
        {tieneEncuestas && <EstadisticasPartido encuestas={encuestas} />}
      </div>
    </div>
  );
};

export default FichaDePartido;