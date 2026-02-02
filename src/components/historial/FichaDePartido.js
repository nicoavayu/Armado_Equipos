import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabase';
import LoadingSpinner from '../LoadingSpinner';
import JugadorDestacadoCard from './JugadorDestacadoCard';
import EstadisticasPartido from './EstadisticasPartido';
import PlantillaJugadores from './PlantillaJugadores';

/**
 * Componente que muestra la ficha detallada de un partido
 * @param {Object} props
 * @param {Object} props.partido - Datos básicos del partido
 * @param {Function} props.onBack - Función para volver a la lista
 * @param {Function} props.onClose - Función para cerrar el modal
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
          .from('partidos_view')
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
      /** @type {Intl.DateTimeFormatOptions} */
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
      <div className="flex flex-col items-center justify-center py-10 px-5 text-[#aaa] text-center h-full">
        <div className="loading-spinner"></div>
        <LoadingSpinner size="medium" />
      </div>
    );
  }

  // Estado de error
  if (error || !detallesPartido) {
    return (
      <div className="flex flex-col items-center justify-center py-10 px-5 text-[#ff6b6b] text-center h-full">
        <h3>Error</h3>
        <p>{error || 'No se pudo cargar la información del partido'}</p>
        <div className="flex gap-2.5 mt-5">
          <button onClick={onBack} className="bg-none border-none text-[#8178e5] text-[1.2rem] cursor-pointer flex items-center p-[5px]">Volver</button>
          <button onClick={onClose} className="bg-[#ff6b6b] text-white border-none rounded-[50px] py-2 px-5 font-semibold cursor-pointer">Cerrar</button>
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
    <div className="flex flex-col w-full h-full text-white">
      <div className="flex justify-between items-center px-5 py-[15px] bg-[#16162e] border-b border-[#2a2a40]">
        <button className="bg-none border-none text-[#8178e5] text-[1.2rem] cursor-pointer flex items-center p-[5px]" onClick={onBack}>
          ‹ Volver
        </button>
        <h2 className="m-0 text-[#8178e5] text-[1.3rem] font-semibold max-[768px]:text-[1.1rem]">Ficha del Partido</h2>
        <button className="text-[#aaa] text-2xl cursor-pointer hover:text-white" onClick={onClose}>×</button>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {/* Información principal */}
        <div className="bg-[rgba(4,48,106,0.22)] rounded-[10px] p-5 mb-5 text-center">
          <div className="text-[1.2rem] font-semibold mb-[5px] text-white capitalize max-[768px]:text-[1.1rem]">{formatFecha(fecha)}</div>
          <div className="text-[1rem] text-[#aaa] mb-[10px]">{lugar || 'Sin ubicación'}</div>
          {resultado && (
            <div className="text-[1.8rem] font-bold text-[#8178e5] mt-[10px] max-[768px]:text-[1.5rem]">{resultado}</div>
          )}
        </div>

        {/* Equipos formados - SIEMPRE se muestra si existen */}
        {detallesPartido.equipos && detallesPartido.equipos.length === 2 ? (
          <div className="mb-[30px]">
            <h3 className="text-[1.2rem] text-[#8178e5] mb-[15px] border-b border-[#2a2a40] pb-[10px]">Equipos</h3>
            <div className="grid grid-cols-2 gap-5 mb-5 max-[768px]:grid-cols-1 max-[768px]:gap-[15px]">
              {detallesPartido.equipos.map((equipo, index) => {
                const jugadoresEquipo = (partido.jugadores || []).filter((j) =>
                  equipo.players && equipo.players.includes(j.uuid),
                );

                return (
                  <div key={equipo.id || index} className="bg-[rgba(4,48,106,0.22)] rounded-[10px] p-[15px]">
                    <div className="flex justify-between items-center mb-[15px] pb-[10px] border-b border-[#444]">
                      <h4 className="m-0 text-[#8178e5] text-[1.1rem]">{equipo.name || `Equipo ${index + 1}`}</h4>
                      <span className="bg-[#8178e5] text-white py-1 px-2 rounded-[15px] text-[0.9rem] font-semibold">
                        {(equipo.score ?? 0).toFixed(1)}
                      </span>
                    </div>
                    <div className="flex flex-col gap-2">
                      {jugadoresEquipo.map((jugador) => (
                        <div key={jugador.uuid} className="flex items-center p-2 bg-[rgba(4,48,106,0.22)] rounded-lg">
                          <div className="w-8 h-8 rounded-full overflow-hidden mr-3 bg-[#16162e] flex items-center justify-center max-[768px]:w-7 max-[768px]:h-7">
                            {jugador.foto_url || jugador.avatar_url ? (
                              <img src={jugador.foto_url || jugador.avatar_url} alt={jugador.nombre} className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center bg-[#444] text-white font-bold text-[0.8rem]">
                                {jugador.nombre.charAt(0)}
                              </div>
                            )}
                          </div>
                          <div className="text-[0.9rem] text-white font-medium max-[768px]:text-[0.8rem]">{jugador.nombre}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          /* Plantilla de jugadores - si no hay equipos formados */
          <PlantillaJugadores jugadores={partido.jugadores || []} />
        )}

        {/* Secciones que solo se muestran si hay encuestas o datos */}
        {tieneDestacados && (
          <div className="mb-[30px]">
            <h3 className="text-[1.2rem] text-[#8178e5] mb-[15px] border-b border-[#2a2a40] pb-[10px]">Jugadores Destacados</h3>

            {mvps.length > 0 ? (
              <div className="mb-5">
                <h4 className="text-[1rem] text-[#ddd] mb-[10px]">MVP del Partido</h4>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-[15px] max-[768px]:grid-cols-[repeat(auto-fill,minmax(120px,1fr))]">
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
              <div className="mb-5">
                <h4 className="text-[1rem] text-[#ddd] mb-[10px]">Mejor Arquero</h4>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-[15px] max-[768px]:grid-cols-[repeat(auto-fill,minmax(120px,1fr))]">
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
              <div className="mb-5">
                <h4 className="text-[1rem] text-[#ddd] mb-[10px]">Tarjeta Negra</h4>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-[15px] max-[768px]:grid-cols-[repeat(auto-fill,minmax(120px,1fr))]">
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
          <div className="mb-[30px]">
            <h3 className="text-[1.2rem] text-[#8178e5] mb-[15px] border-b border-[#2a2a40] pb-[10px]">Jugadores Ausentes</h3>
            <div className="flex flex-wrap gap-[10px]">
              {ausentes.map((jugador) => (
                <div key={jugador.id} className="flex items-center bg-[rgba(4,48,106,0.22)] rounded-[50px] py-[5px] pr-[15px] pl-[5px]">
                  <div className="w-[30px] h-[30px] rounded-full overflow-hidden mr-[10px] bg-[#16162e] flex items-center justify-center">
                    {jugador.avatar_url ? (
                      <img src={jugador.avatar_url} alt={jugador.nombre} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-[#444] text-white font-bold">
                        {jugador.nombre.charAt(0)}
                      </div>
                    )}
                  </div>
                  <div className="text-[0.9rem] text-white">{jugador.nombre}</div>
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