import { useState, useEffect, useRef } from 'react';
import { getVotantesIds, getVotantesConNombres, getJugadoresDelPartido, supabase } from '../supabase';
import { toBigIntId } from '../utils';
import { incrementMatchesAbandoned, canAbandonWithoutPenalty } from '../utils/matchStatsManager';
import { autoCleanupDuplicates } from '../utils/duplicateCleanup';
import { toast } from 'react-toastify';

/**
 * Custom hook for AdminPanel state management and handlers
 * @param {Object} props - Hook props
 * @returns {Object} State and handlers
 */
export const useAdminPanelState = ({ 
  jugadores, 
  onJugadoresChange, 
  partidoActual, 
  user, 
  isAdmin, 
  onBackToHome 
}) => {
  const [votantes, setVotantes] = useState([]);
  const [votantesConNombres, setVotantesConNombres] = useState([]);
  const [nuevoNombre, setNuevoNombre] = useState('');
  const [loading, setLoading] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [showTeamView, setShowTeamView] = useState(false);
  const [showArmarEquiposView, setShowArmarEquiposView] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [duplicatesDetected, setDuplicatesDetected] = useState(0);
  const [teams, setTeams] = useState([
    { id: 'equipoA', name: 'Equipo A', players: [], score: 0 },
    { id: 'equipoB', name: 'Equipo B', players: [], score: 0 },
  ]);
  const [jugadoresLocal, setJugadoresLocal] = useState(jugadores || []);
  const [pendingInvitation, setPendingInvitation] = useState(false);
  const [invitationLoading, setInvitationLoading] = useState(false);
  const [invitationChecked, setInvitationChecked] = useState(false);
  const [faltanJugadoresState, setFaltanJugadoresState] = useState(partidoActual?.falta_jugadores || false);
  const inputRef = useRef();

  const jugadoresActuales = jugadoresLocal || [];
  const currentPlayerInMatch = jugadoresActuales.find((j) => j.usuario_id === user?.id);
  const isPlayerInMatch = !!currentPlayerInMatch;

  // Sync with initial props
  useEffect(() => {
    if (jugadores && jugadores.length > 0) {
      setJugadoresLocal(jugadores);
    }
  }, [jugadores]);

  // Check invitation
  useEffect(() => {
    const checkInvitation = async () => {
      if (!user?.id || !partidoActual?.id) {
        setInvitationChecked(true);
        return;
      }
      
      try {
        const isInMatch = jugadores.some(j => j.usuario_id === user.id);
        if (isInMatch) {
          setPendingInvitation(false);
          setInvitationChecked(true);
          return;
        }
        
        const { data: invitation } = await supabase
          .from('notifications')
          .select('id, data')
          .eq('user_id', user.id)
          .eq('type', 'match_invite')
          .eq('read', false)
          .eq('data->>matchId', partidoActual.id.toString())
          .single();
          
        setPendingInvitation(!!invitation);
      } catch (error) {
        setPendingInvitation(false);
      } finally {
        setInvitationChecked(true);
      }
    };
    
    checkInvitation();
  }, [user?.id, partidoActual?.id, jugadores]);

  // Fetch initial data and polling
  useEffect(() => {
    async function fetchInitialData() {
      if (!partidoActual?.id) return;
      try {
        const jugadoresPartido = await getJugadoresDelPartido(partidoActual.id);
        const votantesIds = await getVotantesIds(partidoActual.id);
        const votantesNombres = await getVotantesConNombres(partidoActual.id);
        setVotantes(votantesIds || []);
        setVotantesConNombres(votantesNombres || []);
        onJugadoresChange(jugadoresPartido);
      } catch (error) {
        console.error('Error loading initial data:', error);
      }
    }
    
    fetchInitialData();
    
    const refreshInterval = setInterval(async () => {
      try {
        const jugadoresPartido = await getJugadoresDelPartido(partidoActual.id);
        const currentCount = jugadoresActuales.length;
        const newCount = jugadoresPartido.length;
        
        if (currentCount !== newCount) {
          setJugadoresLocal(jugadoresPartido);
          onJugadoresChange(jugadoresPartido);
        }
      } catch (error) {
        console.error('Error refreshing players:', error);
      }
    }, 3000);
    
    return () => clearInterval(refreshInterval);
  }, [partidoActual?.id]);

  // Initialize falta_jugadores state
  useEffect(() => {
    if (partidoActual?.falta_jugadores !== undefined && 
        faltanJugadoresState === false && 
        !partidoActual.falta_jugadores) {
      setFaltanJugadoresState(partidoActual.falta_jugadores);
    }
  }, [partidoActual?.id, faltanJugadoresState, partidoActual?.falta_jugadores]);

  const agregarJugador = async (e) => {
    e.preventDefault();
    
    if (!isAdmin) {
      toast.error('Solo el admin puede agregar jugadores');
      return;
    }
    
    if (partidoActual.cupo_jugadores && jugadores.length >= partidoActual.cupo_jugadores) {
      toast.error('El partido está lleno');
      return;
    }
    
    const nombre = nuevoNombre.trim();
    if (!nombre) return;
    
    const nombreExiste = jugadores.some((j) => j.nombre.toLowerCase() === nombre.toLowerCase());
    if (nombreExiste) {
      toast.warn('Ya existe un jugador con ese nombre.');
      return;
    }
    
    setLoading(true);
    try {
      const uuid = crypto.randomUUID();
      
      const { error } = await supabase
        .from('jugadores')
        .insert([{
          uuid,
          nombre,
          partido_id: partidoActual.id,
          score: 5,
          is_goalkeeper: false,
        }])
        .select()
        .single();
        
      if (error) throw error;
      setNuevoNombre('');
      
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
        }
      }, 200);
      
      setTimeout(async () => {
        try {
          await autoCleanupDuplicates(partidoActual.id);
        } catch (cleanupError) {
          // Error cleaning duplicates
        }
      }, 1500);
      
      const jugadoresPartido = await getJugadoresDelPartido(partidoActual.id);
      const votantesIds = await getVotantesIds(partidoActual.id);
      const votantesNombres = await getVotantesConNombres(partidoActual.id);
      setVotantes(votantesIds || []);
      setVotantesConNombres(votantesNombres || []);
      onJugadoresChange(jugadoresPartido);
      
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
        }
      }, 50);
    } catch (error) {
      toast.error('Error agregando jugador: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const eliminarJugador = async (uuid, esExpulsion = false) => {
    const jugadorAEliminar = jugadores.find((j) => j.uuid === uuid);
    
    if (!isAdmin && jugadorAEliminar?.usuario_id !== user?.id) {
      toast.error('Solo puedes eliminarte a ti mismo o ser admin');
      return;
    }
    
    if (isAdmin && jugadorAEliminar?.usuario_id === user?.id) {
      const otrosJugadoresConCuenta = jugadores.filter((j) => j.usuario_id && j.usuario_id !== user?.id);
      if (otrosJugadoresConCuenta.length === 0) {
        toast.error('No puedes eliminarte siendo admin. Primero transfiere el rol de admin a otro jugador con cuenta.');
        return;
      }
    }
    
    const esAutoEliminacion = jugadorAEliminar?.usuario_id === user?.id;
    
    setLoading(true);
    try {
      const { error } = await supabase
        .from('jugadores')
        .delete()
        .eq('uuid', uuid)
        .eq('partido_id', partidoActual.id);
        
      if (error) throw error;
      
      if (esAutoEliminacion && jugadorAEliminar?.usuario_id) {
        try {
          const canAbandonSafely = canAbandonWithoutPenalty(
            partidoActual.fecha, 
            partidoActual.hora,
          );
          if (!canAbandonSafely) {
            await incrementMatchesAbandoned(jugadorAEliminar.usuario_id);
          }
        } catch (abandonError) {
          // Error processing match abandonment
        }
      }
      
      if (esAutoEliminacion) {
        toast.success('Te has eliminado del partido');
        setTimeout(() => onBackToHome(), 1000);
      }
      
      if (isAdmin && !esAutoEliminacion && jugadorAEliminar?.usuario_id) {
        try {
          const payload = {
            user_id: jugadorAEliminar.usuario_id,
            type: 'match_kicked',
            title: 'Expulsado del partido',
            message: `Has sido expulsado del partido "${partidoActual.nombre || 'PARTIDO'}"`,
            data: {
              matchId: toBigIntId(partidoActual.id),
              matchName: partidoActual.nombre,
              kickedBy: user.id,
            },
            read: false,
          };
          await supabase.from('notifications').insert([payload]);
        } catch (notifError) {
          // Error sending kick notification
        }
      }
      
      if (!esAutoEliminacion) {
        const jugadoresPartido = await getJugadoresDelPartido(partidoActual.id);
        const votantesIds = await getVotantesIds(partidoActual.id);
        const votantesNombres = await getVotantesConNombres(partidoActual.id);
        setVotantes(votantesIds || []);
        setVotantesConNombres(votantesNombres || []);
        onJugadoresChange(jugadoresPartido);
      }
    } catch (error) {
      toast.error('Error eliminando jugador: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const transferirAdmin = async (jugadorId) => {
    if (!isAdmin) {
      toast.error('Solo el creador puede transferir el rol de admin');
      return;
    }
    
    const jugador = jugadores.find((j) => j.id === jugadorId || j.usuario_id === jugadorId);
    if (!jugador || !jugador.usuario_id) {
      toast.error('El jugador debe tener una cuenta para ser admin');
      return;
    }
    
    if (jugador.usuario_id === user.id) {
      toast.error('Ya eres el admin del partido');
      return;
    }
    
    if (!window.confirm('¿Estás seguro de transferir el rol de admin? Perderás el control del partido.')) {
      return;
    }
    
    try {
      const { error } = await supabase
        .from('partidos')
        .update({ creado_por: jugador.usuario_id })
        .eq('id', partidoActual.id);
        
      if (error) throw error;
      
      partidoActual.creado_por = jugador.usuario_id;
      
      const payload = {
        user_id: jugador.usuario_id,
        type: 'admin_transfer',
        title: 'Eres el nuevo admin',
        message: `Ahora eres admin del partido "${partidoActual.nombre || 'PARTIDO'}".`,
        data: {
          matchId: toBigIntId(partidoActual.id),
          matchName: partidoActual.nombre,
          newAdminId: jugador.usuario_id,
        },
        read: false,
      };
      await supabase.from('notifications').insert([payload]);
      
      await supabase
        .from('partidos')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', partidoActual.id);
      
      onJugadoresChange([...jugadores]);
      
      toast.success(`${jugador.nombre || 'El jugador'} es ahora el admin del partido`);
      
      setTimeout(() => {
        window.location.reload();
      }, 2000);
      
    } catch (error) {
      toast.error('Error al transferir admin: ' + error.message);
    }
  };

  const aceptarInvitacion = async () => {
    if (!user?.id || !partidoActual?.id) return;
    
    const yaEstaEnPartido = jugadores.some((j) => j.usuario_id === user.id);
    if (yaEstaEnPartido) {
      toast.error('Ya estás en este partido');
      setPendingInvitation(false);
      return;
    }
    
    if (partidoActual.cupo_jugadores && jugadores.length >= partidoActual.cupo_jugadores) {
      toast.error('El partido está lleno');
      return;
    }
    
    setInvitationLoading(true);
    try {
      const { data: existingPlayer } = await supabase
        .from('jugadores')
        .select('id')
        .eq('partido_id', partidoActual.id)
        .eq('usuario_id', user.id)
        .single();
        
      if (existingPlayer) {
        toast.error('Ya estás en este partido');
        return;
      }
      
      const { data: userProfile, error: profileError } = await supabase
        .from('usuarios')
        .select('nombre, avatar_url')
        .eq('id', user.id)
        .single();
        
      if (profileError) throw profileError;
      
      const { error: insertError } = await supabase
        .from('jugadores')
        .insert([{
          partido_id: partidoActual.id,
          usuario_id: user.id,
          nombre: userProfile?.nombre || user.email?.split('@')[0] || 'Jugador',
          avatar_url: userProfile?.avatar_url || null,
          foto_url: userProfile?.avatar_url || null,
          uuid: user.id,
          score: 5,
          is_goalkeeper: false,
        }]);
        
      if (insertError) {
        if (insertError.code === '23505') {
          toast.error('Ya estás en este partido');
          setPendingInvitation(false);
          return;
        }
        throw insertError;
      }
      
      const { data: notifications } = await supabase
        .from('notifications')
        .select('id, data')
        .eq('user_id', user.id)
        .eq('type', 'match_invite')
        .eq('read', false);
        
      const matchNotification = notifications?.find((n) => 
        n.data && n.data.matchId === partidoActual.id,
      );
      
      if (matchNotification) {
        await supabase
          .from('notifications')
          .update({ read: true })
          .eq('id', matchNotification.id);
      }
      
      await notificarJugadoresNuevoMiembro(userProfile?.nombre || 'Un jugador');
      
      const jugadoresActualizados = await getJugadoresDelPartido(partidoActual.id);
      onJugadoresChange(jugadoresActualizados);
      
      toast.success('Te has unido al partido', { autoClose: 3000 });
      
    } catch (error) {
      toast.error('Error al unirse al partido: ' + error.message);
    } finally {
      setInvitationLoading(false);
    }
  };

  const rechazarInvitacion = async () => {
    if (!user?.id || !partidoActual?.id) return;
    
    setInvitationLoading(true);
    try {
      const { data: notifications } = await supabase
        .from('notifications')
        .select('id, data')
        .eq('user_id', user.id)
        .eq('type', 'match_invite')
        .eq('read', false);
        
      const matchNotification = notifications?.find((n) => 
        n.data && n.data.matchId === partidoActual.id,
      );
      
      if (matchNotification) {
        await supabase
          .from('notifications')
          .update({ read: true })
          .eq('id', matchNotification.id);
      }
      
      const { data: userProfile } = await supabase
        .from('usuarios')
        .select('nombre')
        .eq('id', user.id)
        .single();
      
      await notificarRechazoInvitacion(userProfile?.nombre || 'Un jugador');
      
      onBackToHome();
      
    } catch (error) {
      toast.error('Error al rechazar invitación: ' + error.message);
    } finally {
      setInvitationLoading(false);
    }
  };

  const notificarJugadoresNuevoMiembro = async (nombreJugador) => {
    try {
      const jugadoresConCuenta = jugadores.filter((j) => j.usuario_id && j.usuario_id !== user.id);
      
      const notificaciones = jugadoresConCuenta.map((jugador) => ({
        user_id: jugador.usuario_id,
        type: 'match_update',
        title: 'Nuevo jugador',
        message: `${nombreJugador} se unió al partido "${partidoActual.nombre || 'PARTIDO'}"`,
        data: {
          matchId: toBigIntId(partidoActual.id),
          matchName: partidoActual.nombre,
          playerName: nombreJugador,
        },
        read: false,
      }));
      
      if (notificaciones.length > 0) {
        await supabase.from('notifications').insert(notificaciones);
      }
    } catch (error) {
      // Error notifying players
    }
  };

  const notificarRechazoInvitacion = async (nombreJugador) => {
    try {
      const jugadoresConCuenta = jugadores.filter((j) => j.usuario_id);
      
      const notificaciones = jugadoresConCuenta.map((jugador) => ({
        user_id: jugador.usuario_id,
        type: 'match_update',
        title: 'Invitación rechazada',
        message: `${nombreJugador} rechazó la invitación al partido "${partidoActual.nombre || 'PARTIDO'}"`,
        data: {
          matchId: toBigIntId(partidoActual.id),
          matchName: partidoActual.nombre,
          playerName: nombreJugador,
        },
        read: false,
      }));
      
      if (notificaciones.length > 0) {
        await supabase.from('notifications').insert(notificaciones);
      }
    } catch (error) {
      // Error notifying rejection
    }
  };

  const handleFaltanJugadores = async () => {
    if (!isAdmin) {
      toast.error('Solo el admin puede cambiar este estado');
      return;
    }
    
    const isAtCapacity = partidoActual.cupo_jugadores && jugadores.length >= partidoActual.cupo_jugadores;
    
    if (isAtCapacity && !faltanJugadoresState) {
      toast.error('No se puede abrir el partido cuando está lleno');
      return;
    }
    
    try {
      const nuevoEstado = !faltanJugadoresState;
      const { error } = await supabase
        .from('partidos')
        .update({ falta_jugadores: nuevoEstado })
        .eq('id', partidoActual.id);
      
      if (error) throw error;
      
      setFaltanJugadoresState(nuevoEstado);
      partidoActual.falta_jugadores = nuevoEstado;
      
      toast.success(nuevoEstado ? 
        '¡Partido abierto a la comunidad!' : 
        'Partido cerrado a nuevos jugadores',
      );
    } catch (error) {
      toast.error('Error al actualizar el partido: ' + error.message);
    }
  };

  return {
    // State
    votantes,
    votantesConNombres,
    nuevoNombre,
    setNuevoNombre,
    loading,
    isClosing,
    showTeamView,
    setShowTeamView,
    showArmarEquiposView,
    setShowArmarEquiposView,
    showInviteModal,
    setShowInviteModal,
    duplicatesDetected,
    teams,
    setTeams,
    jugadoresLocal,
    pendingInvitation,
    invitationLoading,
    invitationChecked,
    faltanJugadoresState,
    inputRef,
    jugadoresActuales,
    currentPlayerInMatch,
    isPlayerInMatch,
    
    // Handlers
    agregarJugador,
    eliminarJugador,
    transferirAdmin,
    aceptarInvitacion,
    rechazarInvitacion,
    handleFaltanJugadores,
  };
};