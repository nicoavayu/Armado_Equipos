import React, { useState, useEffect } from 'react';
import { toast } from 'react-toastify';
import { UI_SIZES } from '../appConstants';
import {
  closeVotingAndCalculateScores,
  getVotantesIds,
  getVotantesConNombres,
  getJugadoresDelPartido,
  supabase,
} from '../supabase';
import WhatsappIcon from './WhatsappIcon';
import { PlayerCardTrigger } from './ProfileComponents';
import LoadingSpinner from './LoadingSpinner';
import PageTitle from './PageTitle';
import MatchInfoSection from './MatchInfoSection';
import normalizePartidoForHeader from '../utils/normalizePartidoForHeader';
import { useAuth } from './AuthProvider';
import { sendVotingNotifications } from '../services/notificationService';
import { handleError } from '../lib/errorHandler';

export default function ArmarEquiposView({ 
  onBackToAdmin, 
  jugadores, 
  onJugadoresChange, 
  partidoActual,
  onTeamsFormed 
}) {
  const { user } = useAuth();
  const [votantes, setVotantes] = useState([]);
  const [votantesConNombres, setVotantesConNombres] = useState([]);
  const [isClosing, setIsClosing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [calling, setCalling] = useState(false);

  // Control de permisos: verificar si el usuario es admin del partido
  const isAdmin = user?.id && partidoActual?.creado_por === user.id;

  // Si no es admin, mostrar acceso denegado
  if (!isAdmin) {
    return (
      <>
        <PageTitle onBack={onBackToAdmin}>ARMAR EQUIPOS</PageTitle>
        <div style={{ 
          textAlign: 'center', 
          padding: '40px 20px',
          color: '#fff',
          fontFamily: 'Oswald, Arial, sans-serif'
        }}>
          <div style={{ fontSize: '24px', marginBottom: '16px' }}>
            🚫 Acceso Denegado
          </div>
          <div style={{ fontSize: '16px', opacity: 0.8 }}>
            No tenés permisos para acceder a esta función.
          </div>
        </div>
      </>
    );
  }

  // Cargar votantes y suscripción en tiempo real
  useEffect(() => {
    const loadVotantes = async () => {
      if (!partidoActual?.id) return;
      try {
        const votantesIds = await getVotantesIds(partidoActual.id);
        const votantesNombres = await getVotantesConNombres(partidoActual.id);
        setVotantes(votantesIds || []);
        setVotantesConNombres(votantesNombres || []);
      } catch (error) {
        console.error('Error loading votantes:', error);
      }
    };
    
    loadVotantes();
    
    // Suscripción en tiempo real para refrescar cuando hay cambios
    const subscription = supabase
      .channel(`match_${partidoActual?.id}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'partidos',
        filter: `id=eq.${partidoActual?.id}`,
      }, async () => {
        // Refrescar votantes cuando se actualiza el partido
        try {
          const votantesIds = await getVotantesIds(partidoActual.id);
          const votantesNombres = await getVotantesConNombres(partidoActual.id);
          setVotantes(votantesIds || []);
          setVotantesConNombres(votantesNombres || []);
        } catch (error) {
          console.error('Error refreshing voters:', error);
        }
      })
      .subscribe();
    
    return () => {
      subscription.unsubscribe();
    };
  }, [partidoActual?.id]);

  async function handleCallToVote() {
    if (calling) {
      console.debug('[Teams] call-to-vote blocked: already running');
      return;
    }

    if (!partidoActual?.id) {
      toast.error('No hay partido activo');
      return;
    }

    setCalling(true);
    console.debug('[Teams] call-to-vote start', { partidoId: partidoActual?.id });

    try {
      // Count how many players have linked accounts (usuario_id)
      const jugadoresDelPartido = await getJugadoresDelPartido(partidoActual.id);
      const playersWithAccount = (jugadoresDelPartido || []).filter(j => j.usuario_id);

      // If none, warn admin and offer to proceed
      if (playersWithAccount.length === 0) {
        const proceed = window.confirm('No se detectaron jugadores con cuenta vinculada. ¿Querés enviar notificaciones de todas formas (se intentará enviar a usuarios registrados)?');
        if (!proceed) return;
      } else {
        const proceed = window.confirm(`Se detectaron ${playersWithAccount.length} jugadores con cuenta. ¿Querés notificarles ahora para iniciar la votación?`);
        if (!proceed) return;
      }

      // Call service
      const res = await sendVotingNotifications(partidoActual.id, {
        title: '¡Hora de votar!',
        message: 'Entrá a la app y calificá a los jugadores para armar los equipos.',
        type: 'call_to_vote',
      });

      console.debug('[Teams] notifications sent result', res);

      if (res?.error) {
        console.error('[Teams] sendVotingNotifications error result', res.error);
        toast.error('No se pudo iniciar la votación: ' + (res.error.message || 'Error desconocido'));
        return;
      }

      if (res?.skippedDueToSurveyScheduled || res?.skippedDueToSurvey) {
        toast.info('No se envió la notificación porque ya hay una encuesta/programación asociada al partido.');
        return;
      }

      if ((res.inserted || 0) > 0) {
        toast.success(`Notificación enviada a ${res.inserted} jugadores`);
      } else {
        toast.info('No se pudieron enviar notificaciones. Asegurate que los jugadores tengan cuenta.');
      }

    } catch (error) {
      console.error('[Teams] call-to-vote failed', error);
      toast.error('No se pudo iniciar la votación: ' + (error.message || 'Error desconocido'));
    } finally {
      setCalling(false);
    }
  }

  function handleWhatsApp() {
    const publicLink = `${window.location.origin}/?codigo=${partidoActual.codigo}`;
    const text = `Votá para armar los equipos ⚽️\n${publicLink}`;
    
    console.debug('[Teams] share link', { partidoId: partidoActual?.id });
    
    // Intentar Web Share API (si disponible)
    if (navigator.share) {
      navigator.share({ 
        title: 'Votación del partido', 
        text, 
        url: publicLink 
      })
        .then(() => console.debug('[Share] navigator.share success'))
        .catch((e) => console.debug('[Share] navigator.share cancelled/error', e));
      return;
    }
    
    // Fallback WhatsApp
    const wa = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(wa, '_blank', 'noopener,noreferrer');
  }

  async function handleCerrarVotacion() {
    if (isClosing) {
      toast.warn('Operación en progreso, espera un momento');
      return;
    }

    // Validaciones
    if (!partidoActual) {
      toast.error('Error: No hay partido activo');
      return;
    }

    if (!jugadores || jugadores.length === 0) {
      toast.error('Error: No hay jugadores en el partido');
      return;
    }

    if (jugadores.length < 2) {
      toast.error('Se necesitan al menos 2 jugadores');
      return;
    }

    if (jugadores.length % 2 !== 0) {
      toast.error('NECESITAS UN NÚMERO PAR DE JUGADORES PARA FORMAR EQUIPOS');
      return;
    }

    const invalidPlayers = jugadores.filter((j) => !j.uuid);
    if (invalidPlayers.length > 0) {
      toast.error('Error: Algunos jugadores no tienen ID válido');
      return;
    }

    // Confirmar acción
    if (votantes.length === 0) {
      const shouldContinue = window.confirm(
        'No se detectaron votos. ¿Estás seguro de que querés continuar? Los equipos se formarán con puntajes por defecto.',
      );
      if (!shouldContinue) return;
    }

    const confirmMessage = votantes.length > 0 
      ? `¿Cerrar votación y armar equipos? Se procesaron ${votantes.length} votos.`
      : '¿Cerrar votación y armar equipos con puntajes por defecto?';
    
    if (!window.confirm(confirmMessage)) return;

    setIsClosing(true);

    try {
      // Cerrar votación y calcular puntajes
      const result = await closeVotingAndCalculateScores(partidoActual.id);
      
      if (!result) {
        throw new Error('No se recibió respuesta del cierre de votación');
      }

      // Obtener jugadores actualizados
      const matchPlayers = await getJugadoresDelPartido(partidoActual.id);
      
      if (!matchPlayers || matchPlayers.length === 0) {
        throw new Error('No se pudieron obtener los jugadores actualizados');
      }

      // Crear equipos balanceados
      const teams = armarEquipos(matchPlayers);
      
      if (!teams || teams.length !== 2) {
        throw new Error('Error al crear los equipos');
      }

      // Actualizar estado del partido
      await supabase
        .from('partidos')
        .update({ estado: 'equipos_formados', equipos: teams })
        .eq('id', partidoActual.id);

      // Programar notificaciones post-partido
      try {
        const { schedulePostMatchSurveyNotifications } = await import('../utils/matchNotifications');
        await schedulePostMatchSurveyNotifications(partidoActual);
      } catch (scheduleError) {
        // No crítico
      }

      toast.success('¡Votación cerrada! Equipos armados.');
      
      // Redirigir a vista de equipos
      onTeamsFormed(teams, matchPlayers);

    } catch (error) {
      let errorMessage = 'Error al cerrar la votación';
      if (error.message.includes('votos')) {
        errorMessage = 'Error al procesar los votos';
      } else if (error.message.includes('jugadores')) {
        errorMessage = 'Error al actualizar los jugadores';
      } else if (error.message.includes('equipos')) {
        errorMessage = 'Error al crear los equipos';
      } else if (error.message) {
        errorMessage = error.message;
      }

      toast.error(errorMessage);
    } finally {
      setIsClosing(false);
    }
  }

  // Función para armar equipos (copiada del AdminPanel original)
  function armarEquipos(jugadores) {
    const jugadoresUnicos = jugadores.reduce((acc, jugador) => {
      const existeUuid = acc.find((j) => j.uuid === jugador.uuid);
      const existeNombre = acc.find((j) => j.nombre.toLowerCase() === jugador.nombre.toLowerCase());
      
      if (!existeUuid && !existeNombre) {
        acc.push(jugador);
      }
      return acc;
    }, []);
    
    if (jugadoresUnicos.length % 2 !== 0) {
      throw new Error('Se necesita un número par de jugadores para formar equipos');
    }
    
    const jugadoresOrdenados = [...jugadoresUnicos].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const equipoA = [];
    const equipoB = [];
    let puntajeA = 0;
    let puntajeB = 0;
    
    jugadoresOrdenados.forEach((jugador, index) => {
      if (index % 2 === 0) {
        equipoA.push(jugador.uuid);
        puntajeA += jugador.score ?? 0;
      } else {
        equipoB.push(jugador.uuid);
        puntajeB += jugador.score ?? 0;
      }
    });

    return [
      { id: 'equipoA', name: 'Equipo A', players: equipoA, score: puntajeA },
      { id: 'equipoB', name: 'Equipo B', players: equipoB, score: puntajeB },
    ];
  }

  async function eliminarJugador(uuid) {
    const jugadorAEliminar = jugadores.find((j) => j.uuid === uuid);
    
    if (!jugadorAEliminar) return;
    
    setLoading(true);
    try {
      const { error } = await supabase
        .from('jugadores')
        .delete()
        .eq('uuid', uuid)
        .eq('partido_id', partidoActual.id);
        
      if (error) throw error;
      
      // Refrescar datos
      const jugadoresPartido = await getJugadoresDelPartido(partidoActual.id);
      const votantesIds = await getVotantesIds(partidoActual.id);
      const votantesNombres = await getVotantesConNombres(partidoActual.id);
      setVotantes(votantesIds || []);
      setVotantesConNombres(votantesNombres || []);
      onJugadoresChange(jugadoresPartido);
      
    } catch (error) {
      toast.error('Error eliminando jugador: ' + error.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <PageTitle onBack={onBackToAdmin}>ARMAR EQUIPOS</PageTitle>
      <MatchInfoSection
        partido={normalizePartidoForHeader(partidoActual)}
        nombre={partidoActual?.nombre}
        fecha={partidoActual?.fecha}
        hora={partidoActual?.hora}
        sede={partidoActual?.sede}
        modalidad={partidoActual?.modalidad}
        tipo={partidoActual?.tipo_partido}
        precio={partidoActual?.valor_cancha || partidoActual?.valorCancha || partidoActual?.valor || partidoActual?.precio}
        rightActions={null}
      />
      <div className="admin-panel-content" style={{ paddingTop: '0px', marginTop: '0px' }}>
        {/* Lista de jugadores */}
        <div className="admin-players-section">
          <div className="admin-players-title">
            JUGADORES ({jugadores.length}/{partidoActual.cupo_jugadores || 'Sin límite'}) - VOTARON: {votantesConNombres.length}/{jugadores.length}
          </div>
          {jugadores.length === 0 ? (
            <div className="admin-players-empty">
              <LoadingSpinner size="medium" />
            </div>
          ) : (
            <div className="admin-players-grid">
              {jugadores.map((j) => {
                // Comparación más robusta de nombres
                const hasVoted = votantesConNombres.some((v) => {
                  if (!v.nombre || !j.nombre) return false;
                  return v.nombre.toLowerCase().trim() === j.nombre.toLowerCase().trim();
                }) || votantes.includes(j.uuid) || votantes.includes(j.usuario_id);

                return (
                  <PlayerCardTrigger 
                    key={j.uuid} 
                    profile={j}
                    partidoActual={partidoActual}
                  >
                    <div
                      className={`admin-player-item${hasVoted ? ' voted' : ''}`}
                      style={hasVoted ? {
                        background: 'rgba(0,255,136,0.3) !important',
                        border: '3px solid #00ff88 !important',
                        boxShadow: '0 0 15px rgba(0,255,136,0.6) !important',
                      } : {}}
                    >
                      {j.foto_url || j.avatar_url ? (
                        <img
                          src={j.foto_url || j.avatar_url}
                          alt={j.nombre}
                          className="admin-player-avatar"
                        />
                      ) : (
                        <div className="admin-player-avatar-placeholder">👤</div>
                      )}

                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
                        <span className="admin-player-name" style={{ color: 'white' }}>
                          {j.nombre}
                        </span>
                        {/* Corona para admin */}
                        {partidoActual?.creado_por === j.usuario_id && (
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="20" height="20" fill="#FFD700">
                            <path d="M345 151.2C354.2 143.9 360 132.6 360 120C360 97.9 342.1 80 320 80C297.9 80 280 97.9 280 120C280 132.6 285.9 143.9 295 151.2L226.6 258.8C216.6 274.5 195.3 278.4 180.4 267.2L120.9 222.7C125.4 216.3 128 208.4 128 200C128 177.9 110.1 160 88 160C65.9 160 48 177.9 48 200C48 221.8 65.5 239.6 87.2 240L119.8 457.5C124.5 488.8 151.4 512 183.1 512L456.9 512C488.6 512 515.5 488.8 520.2 457.5L552.8 240C574.5 239.6 592 221.8 592 200C592 177.9 574.1 160 552 160C529.9 160 512 177.9 512 200C512 208.4 514.6 216.3 519.1 222.7L459.7 267.3C444.8 278.5 423.5 274.6 413.5 258.9L345 151.2z"/>
                          </svg>
                        )}
                      </div>
                      
                      {/* Botón eliminar - Solo admin puede eliminar otros */}
                      {j.usuario_id !== user?.id && (
                        <button
                          className="admin-remove-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (window.confirm(`¿Eliminar a ${j.nombre} del partido?`)) {
                              eliminarJugador(j.uuid);
                            }
                          }}
                          type="button"
                          disabled={loading}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  </PlayerCardTrigger>
                );
              })}
            </div>
          )}
        </div>

        {/* Botones de acción */}
        <div style={{ width: '90vw', maxWidth: '90vw', boxSizing: 'border-box', margin: '16px auto 0', textAlign: 'center' }}>
          <div style={{ display: 'flex', gap: '8px', width: '100%', marginBottom: '12px' }}>
            <button 
              className="admin-btn-blue" 
              onClick={handleCallToVote}
              disabled={calling}
              style={{ flex: 1, opacity: calling ? 0.6 : 1 }}
            >
              {calling ? 'ENVIANDO...' : 'LLAMAR A VOTAR'}
            </button>
          
            <button 
              className="admin-btn-green" 
              onClick={handleWhatsApp}
              style={{ flex: 1 }}
            >
              <WhatsappIcon size={UI_SIZES.WHATSAPP_ICON_SIZE} style={{ marginRight: 8 }} />
              COMPARTIR LINK
            </button>
          </div>
          
          <button 
            className="admin-btn-orange" 
            onClick={handleCerrarVotacion} 
            disabled={isClosing || jugadores.length < 2}
            style={{
              width: '100%',
            }}
          >
            {isClosing ? (
              <LoadingSpinner size="small" />
            ) : (
              `CERRAR VOTACIÓN (${jugadores.length} jugadores)`
            )}
          </button>
        </div>
      </div>
    </>
  );
}