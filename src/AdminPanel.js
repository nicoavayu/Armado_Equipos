import React, { useState, useEffect, useRef } from 'react';
import {
  addJugador,
  deleteJugador,
  getJugadores,
  closeVotingAndCalculateScores,
  getPartidoPorCodigo,
  updateJugadoresPartido,
  getVotantesIds,
  getVotantesConNombres,
  getJugadoresDelPartido,
  saveTeamsToDatabase,
  getTeamsFromDatabase,
  supabase,
} from './supabase';
import { incrementPartidosAbandonados } from './services/matchStatsService';
import { toast } from 'react-toastify';
import { handleError, handleSuccess, safeAsync } from './utils/errorHandler';
import { UI_MESSAGES, VALIDATION_RULES } from './constants';
import { LOADING_STATES, UI_SIZES } from './appConstants';
import { LazyLoadImage } from 'react-lazy-load-image-component';
import 'react-lazy-load-image-component/src/effects/blur.css';
import './HomeStyleKit.css';
import './AdminPanel.css';
import WhatsappIcon from './components/WhatsappIcon';
import TeamDisplay from './components/TeamDisplay';
import PartidoInfoBox from './PartidoInfoBox';
import Button from './components/Button';
import ChatButton from './components/ChatButton';
import { PlayerCardTrigger } from './components/ProfileComponents';
import LoadingSpinner from './components/LoadingSpinner';
import { HistorialDePartidosButton } from './components/historial';
import { useAuth } from './components/AuthProvider';
import InviteAmigosModal from './components/InviteAmigosModal';
import { detectDuplicates, autoCleanupDuplicates } from './utils/duplicateCleanup';
import PageTitle from './components/PageTitle';

function MiniAvatar({ foto_url, nombre, size = 34 }) {
  if (foto_url) {
    return (
      <LazyLoadImage
        alt={nombre}
        src={foto_url}
        effect="blur"
        width={size}
        height={size}
        className="mini-avatar"
      />
    );
  }
  return <div className="mini-avatar-placeholder" style={{ width: size, height: size }} />;
}

export default function AdminPanel({ onBackToHome, jugadores, onJugadoresChange, partidoActual }) {
  const { user } = useAuth(); // [TEAM_BALANCER_EDIT] Agregado para control de permisos
  const [votantes, setVotantes] = useState([]);
  const [votantesConNombres, setVotantesConNombres] = useState([]);
  const [nuevoNombre, setNuevoNombre] = useState('');
  const [loading, setLoading] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [showTeamView, setShowTeamView] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false); // [TEAM_BALANCER_EDIT] Modal de invitación
  const [duplicatesDetected, setDuplicatesDetected] = useState(0); // Contador de duplicados

  const [teams, setTeams] = useState([
    { id: 'equipoA', name: 'Equipo A', players: [], score: 0 },
    { id: 'equipoB', name: 'Equipo B', players: [], score: 0 },
  ]);
  const inputRef = useRef();

  // 🟢 Si jugadores viene undefined o null, usá array vacío
  jugadores = jugadores || [];
  if (!Array.isArray(jugadores)) jugadores = [];
  console.log('Jugadores en AdminPanel:', jugadores);
  
  // [TEAM_BALANCER_EDIT] Control de permisos: verificar si el usuario es admin del partido
  const isAdmin = user?.id && partidoActual?.creado_por === user.id;
  const currentPlayerInMatch = jugadores.find((j) => j.usuario_id === user?.id);
  const isPlayerInMatch = !!currentPlayerInMatch;
  
  // [TEAM_BALANCER_INVITE_EDIT] Estado de invitación pendiente
  const [pendingInvitation, setPendingInvitation] = useState(false);
  const [invitationLoading, setInvitationLoading] = useState(false);
  const [invitationChecked, setInvitationChecked] = useState(false); // [TEAM_BALANCER_INVITE_ACCESS_FIX] Control de verificación
  
  // [TEAM_BALANCER_INVITE_ACCESS_FIX] Verificar invitación pendiente
  useEffect(() => {
    const checkPendingInvitation = async (userId, matchId) => {
      console.log('[INVITE_DEBUG] Checking invitation for:', { userId, matchId });
      
      // Si el usuario ya está en el partido, no hay invitación pendiente
      if (isPlayerInMatch) {
        console.log('[INVITE_DEBUG] User already in match, no pending invitation');
        return { invitation: null, error: null, matchId };
      }
      
      // Obtener todas las notificaciones de invitación y filtrar en JS
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', userId)
        .eq('type', 'match_invite');

      if (error) {
        console.error('[INVITE_DEBUG] Supabase error:', error);
        return { invitation: null, error, matchId };
      }

      console.log('[INVITE_DEBUG] All invitations found:', data);
      
      // Asegurarse que notification.data sea siempre un objeto
      const invitations = (data || []).map((n) => ({
        ...n,
        data: typeof n.data === 'string' ? JSON.parse(n.data) : n.data,
      }));
      
      console.log('[INVITE_DEBUG] Processed invitations:', invitations);
      
      // Filtrar por matchId asegurando tipo string
      const matchingInvitation = invitations.find((notification) =>
        notification.data &&
        String(notification.data.matchId) === String(matchId),
      );
      
      if (matchingInvitation) {
        console.log('[INVITE_DEBUG] Found matching invitation:', matchingInvitation);
        return { invitation: matchingInvitation, error: null, matchId };
      }
      
      console.log('[INVITE_DEBUG] No matching invitation found for matchId:', matchId);
      return { invitation: null, error: null, matchId };
    };
    
    const runCheck = async () => {
      if (!user?.id || !partidoActual?.id) {
        console.log('[INVITE_DEBUG] Missing user or match, setting checked to true');
        setInvitationChecked(true);
        return;
      }
      
      try {
        const result = await checkPendingInvitation(user.id, partidoActual.id);
        
        if (result.invitation && !isPlayerInMatch) {
          console.log('[INVITE_DEBUG] Setting pendingInvitation to true');
          setPendingInvitation(true);
        } else {
          console.log('[INVITE_DEBUG] No pending invitation or user already in match');
          setPendingInvitation(false);
        }
      } catch (error) {
        console.log('[INVITE_DEBUG] Error in runCheck:', error);
      } finally {
        console.log('[INVITE_DEBUG] Setting invitationChecked to true');
        setInvitationChecked(true);
      }
    };
    
    if (user?.id && partidoActual) {
      runCheck();
    }
  }, [user?.id, partidoActual, isPlayerInMatch]);
  
  // [TEAM_BALANCER_INVITE_ACCESS_FIX] Control de acceso separado
  useEffect(() => {
    const checkKickedStatus = async () => {
      if (!user?.id || !partidoActual?.id) return false;
      
      try {
        const { data: kickNotification } = await supabase
          .from('notifications')
          .select('id')
          .eq('user_id', user.id)
          .eq('type', 'match_kicked')
          .contains('data', { matchId: partidoActual.id })
          .single();
          
        return !!kickNotification;
      } catch (error) {
        return false;
      }
    };
    
    const runAccessCheck = async () => {
      console.log('[ACCESS_DEBUG] Access control check:', {
        userId: user?.id,
        matchId: partidoActual?.id,
        invitationChecked,
        isPlayerInMatch,
        isAdmin,
        pendingInvitation,
      });
      
      if (!user?.id || !partidoActual?.id || !invitationChecked) {
        console.log('[ACCESS_DEBUG] Skipping access check - missing data or invitation not checked yet');
        return;
      }
      
      // Verificar si fue expulsado
      const wasKicked = await checkKickedStatus();
      if (wasKicked) {
        console.log('[ACCESS_DEBUG] User was kicked, redirecting to home');
        toast.error('Has sido expulsado de este partido');
        onBackToHome();
        return;
      }
      
      // Solo redirigir si el usuario NO está en la nómina, NO es admin y NO tiene invitación pendiente
      const shouldRedirect = !isPlayerInMatch && !isAdmin && !pendingInvitation;
      console.log('[ACCESS_DEBUG] Should redirect?', shouldRedirect);
      
      if (shouldRedirect) {
        console.log('[ACCESS_DEBUG] Redirecting to home - no access');
        toast.error('No estás invitado a este partido');
        onBackToHome();
      } else {
        console.log('[ACCESS_DEBUG] Access granted');
      }
    };
    
    runAccessCheck();
  }, [user?.id, partidoActual, isPlayerInMatch, isAdmin, pendingInvitation, invitationChecked, onBackToHome]);
  // useEffect para refrescar jugadores desde la tabla jugadores
  useEffect(() => {
    async function fetchJugadoresDelPartido() {
      if (!partidoActual?.id) return;
      try {
        console.log('[ADMIN_PANEL] Fetching players from jugadores table for match:', partidoActual.id);
        
        // Verificar si cambió el admin del partido
        const { data: partidoData } = await supabase
          .from('partidos')
          .select('creado_por')
          .eq('id', partidoActual.id)
          .single();
          
        if (partidoData && partidoData.creado_por !== partidoActual.creado_por) {
          console.log('[ADMIN_PANEL] Admin changed, reloading page');
          window.location.reload();
          return;
        }
        
        const jugadoresPartido = await getJugadoresDelPartido(partidoActual.id);
        console.log('[ADMIN_PANEL] Players fetched:', {
          count: jugadoresPartido.length,
          players: jugadoresPartido.map((j) => ({ nombre: j.nombre, uuid: j.uuid })),
        });
        
        const votantesIds = await getVotantesIds(partidoActual.id);
        const votantesNombres = await getVotantesConNombres(partidoActual.id);
        setVotantes(votantesIds || []);
        setVotantesConNombres(votantesNombres || []);
        
        onJugadoresChange(jugadoresPartido);
        
        if (isAdmin) {
          try {
            const duplicateInfo = await detectDuplicates(partidoActual.id);
            setDuplicatesDetected(duplicateInfo.duplicates?.length || 0);
          } catch (error) {
            console.error('Error detecting duplicates:', error);
          }
        }
      } catch (error) {
        console.error('[ADMIN_PANEL] Error loading match data:', error);
      }
    }
    
    fetchJugadoresDelPartido();
    const interval = setInterval(fetchJugadoresDelPartido, 2000);
    
    return () => {
      clearInterval(interval);
    };
  }, [partidoActual?.id]);


  async function refreshVotantes(partidoActual, setVotantes) {
    try {
      const votantesIds = await getVotantesIds(partidoActual.id);
      setVotantes(votantesIds || []);
    } catch (error) {
      // Silent refresh error - not critical for UX
    }
  }

  // Refresh voters when players change
  useEffect(() => {
    if (jugadores.length > 0 && partidoActual?.id) {
      refreshVotantes(partidoActual, setVotantes);
    }
  }, [jugadores.length, partidoActual?.id]);

  /**
 * Adds a new player to the current match
 * Creates player in database and updates match roster
 */
  async function agregarJugador(e) {
    e.preventDefault();
    
    // [TEAM_BALANCER_EDIT] Solo admin puede agregar jugadores
    if (!isAdmin) {
      toast.error('Solo el admin puede agregar jugadores');
      return;
    }
    
    // [TEAM_BALANCER_EDIT] Verificar cupo máximo
    if (partidoActual.cupo_jugadores && jugadores.length >= partidoActual.cupo_jugadores) {
      toast.error('El partido está lleno');
      return;
    }
    
    const nombre = nuevoNombre.trim();
    if (!nombre) return;
    
    // Verificar duplicados más estricto
    const nombreExiste = jugadores.some((j) => j.nombre.toLowerCase() === nombre.toLowerCase());
    if (nombreExiste) {
      toast.warn('Ya existe un jugador con ese nombre.');
      return;
    }
    setLoading(true);
    try {
      console.log('[ADMIN_PANEL] Adding player to match:', { nombre, partidoId: partidoActual.id });
      
      // Generar UUID único para el jugador
      const uuid = crypto.randomUUID();
      
      // Insertar jugador directamente en la tabla jugadores con partido_id (SOLO INSERT, nunca DELETE)
      const { data: nuevoJugador, error } = await supabase
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
      
      console.log('[ADMIN_PANEL] Player added successfully:', nuevoJugador);
      setNuevoNombre('');
      setTimeout(() => inputRef.current?.focus(), 10);
      
      // Limpiar duplicados automáticamente después de agregar
      setTimeout(async () => {
        try {
          const cleanupResult = await autoCleanupDuplicates(partidoActual.id);
          if (cleanupResult.cleaned > 0) {
            console.log('[AUTO_CLEANUP] Removed', cleanupResult.cleaned, 'duplicates after adding player');
          }
        } catch (cleanupError) {
          console.error('[AUTO_CLEANUP] Error cleaning duplicates:', cleanupError);
        }
      }, 1500);
      
      // El useEffect se encargará de refrescar la lista automáticamente
    } catch (error) {
      console.error('[ADMIN_PANEL] Error adding player:', error);
      toast.error('Error agregando jugador: ' + error.message);
    } finally {
      setLoading(false);
    }
  }


  async function eliminarJugador(uuid, esExpulsion = false) {
    const jugadorAEliminar = jugadores.find((j) => j.uuid === uuid);
    
    // [TEAM_BALANCER_EDIT] Control de permisos para eliminar jugadores
    if (!isAdmin && jugadorAEliminar?.usuario_id !== user?.id) {
      toast.error('Solo puedes eliminarte a ti mismo o ser admin');
      return;
    }
    
    // [TEAM_BALANCER_EDIT] Si es admin eliminándose, debe transferir admin primero
    if (isAdmin && jugadorAEliminar?.usuario_id === user?.id) {
      const otrosJugadoresConCuenta = jugadores.filter((j) => j.usuario_id && j.usuario_id !== user?.id);
      if (otrosJugadoresConCuenta.length === 0) {
        toast.error('No puedes eliminarte siendo admin. Primero transfiere el rol de admin a otro jugador con cuenta.');
        return;
      }
    }
    
    const esAutoEliminacion = jugadorAEliminar?.usuario_id === user?.id;
    const esExpulsionPorAdmin = isAdmin && !esAutoEliminacion;
    
    setLoading(true);
    try {
      console.log('[ADMIN_PANEL] Removing player from match:', { uuid, partidoId: partidoActual.id, esExpulsionPorAdmin });
      
      // Eliminar jugador específico de la tabla jugadores (usando uuid como string)
      const { error } = await supabase
        .from('jugadores')
        .delete()
        .eq('uuid', uuid)
        .eq('partido_id', partidoActual.id);
        
      if (error) throw error;
      
      // Solo incrementar partidos abandonados si es auto-eliminación
      if (esAutoEliminacion && jugadorAEliminar?.usuario_id) {
        try {
          await incrementPartidosAbandonados(jugadorAEliminar.usuario_id);
        } catch (abandonError) {
          console.error('Error incrementing abandoned matches:', abandonError);
        }
      }
      
      console.log('[ADMIN_PANEL] Player removed successfully');
      
      // Si es auto-eliminación, volver al home
      if (esAutoEliminacion) {
        toast.success('Te has eliminado del partido');
        setTimeout(() => onBackToHome(), 1000);
      }
      
      // Si es expulsión por admin, notificar al jugador expulsado
      if (esExpulsionPorAdmin && jugadorAEliminar?.usuario_id) {
        try {
          await supabase.from('notifications').insert([{
            user_id: jugadorAEliminar.usuario_id,
            type: 'match_kicked',
            title: 'Expulsado del partido',
            message: `Has sido expulsado del partido "${partidoActual.nombre || 'PARTIDO'}"`,
            data: {
              matchId: partidoActual.id,
              matchName: partidoActual.nombre,
              kickedBy: user.id,
            },
            read: false,
          }]);
        } catch (notifError) {
          console.error('Error sending kick notification:', notifError);
        }
      }
      
      // El useEffect se encargará de refrescar la lista automáticamente
    } catch (error) {
      console.error('[ADMIN_PANEL] Error removing player:', error);
      toast.error('Error eliminando jugador: ' + error.message);
    } finally {
      setLoading(false);
    }
  }
  /**
   * Creates balanced teams based on player scores
   * Distributes players to minimize score difference between teams
   */
  function armarEquipos(jugadores) {
    // Eliminar duplicados por UUID y nombre
    const jugadoresUnicos = jugadores.reduce((acc, jugador) => {
      const existeUuid = acc.find((j) => j.uuid === jugador.uuid);
      const existeNombre = acc.find((j) => j.nombre.toLowerCase() === jugador.nombre.toLowerCase());
      
      if (!existeUuid && !existeNombre) {
        acc.push(jugador);
      }
      return acc;
    }, []);
    
    console.log('[ARMAR_EQUIPOS] Jugadores únicos:', jugadoresUnicos.length, 'de', jugadores.length, 'originales');
    
    // Verificar que hay número par de jugadores
    if (jugadoresUnicos.length % 2 !== 0) {
      throw new Error('Se necesita un número par de jugadores para formar equipos');
    }
    
    const jugadoresOrdenados = [...jugadoresUnicos].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const equipoA = [];
    const equipoB = [];
    let puntajeA = 0;
    let puntajeB = 0;
    
    // Distribuir jugadores alternando por puntaje para mejor balance
    jugadoresOrdenados.forEach((jugador, index) => {
      if (index % 2 === 0) {
        equipoA.push(jugador.uuid);
        puntajeA += jugador.score ?? 0;
      } else {
        equipoB.push(jugador.uuid);
        puntajeB += jugador.score ?? 0;
      }
    });
    
    console.log('[ARMAR_EQUIPOS] Equipos formados:', {
      equipoA: equipoA.length,
      equipoB: equipoB.length,
      puntajeA: puntajeA.toFixed(2),
      puntajeB: puntajeB.toFixed(2),
      diferencia: Math.abs(puntajeA - puntajeB).toFixed(2),
    });

    return [
      { id: 'equipoA', name: 'Equipo A', players: equipoA, score: puntajeA },
      { id: 'equipoB', name: 'Equipo B', players: equipoB, score: puntajeB },
    ];
  }

  const safeSetTeams = (newTeams) => {
    if (!Array.isArray(newTeams)) return;
    let equipoA = newTeams.find((t) => t && t.id === 'equipoA');
    let equipoB = newTeams.find((t) => t && t.id === 'equipoB');
    if (!equipoA) equipoA = { id: 'equipoA', name: 'Equipo A', players: [], score: 0 };
    if (!equipoB) equipoB = { id: 'equipoB', name: 'Equipo B', players: [], score: 0 };
    setTeams([equipoA, equipoB]);
  };

  const handleTeamsChange = (newTeams) => {
    safeSetTeams(newTeams);
  };

  /**
 * Closes voting phase and creates balanced teams
 * Calculates player averages from votes and forms teams
 */
  async function handleCerrarVotacion() {
    // [TEAM_BALANCER_EDIT] Solo admin puede cerrar votación
    if (!isAdmin) {
      toast.error('Solo el admin puede cerrar la votación');
      return;
    }
    
    // Prevent double execution
    if (isClosing) {
      toast.warn('Operación en progreso, espera un momento');
      return;
    }
  
    // Validate preconditions
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
  
    // Validate player UUIDs
    const invalidPlayers = jugadores.filter((j) => !j.uuid);
    if (invalidPlayers.length > 0) {
      toast.error('Error: Algunos jugadores no tienen ID válido');
      return;
    }
  
    // Check if there are any votes
    if (votantes.length === 0) {
      const shouldContinue = window.confirm(
        'No se detectaron votos. ¿Estás seguro de que querés continuar? Los equipos se formarán con puntajes por defecto.',
      );
      if (!shouldContinue) {
        return;
      }
    }
  
    const confirmMessage = votantes.length > 0 
      ? `¿Cerrar votación y armar equipos? Se procesaron ${votantes.length} votos.`
      : '¿Cerrar votación y armar equipos con puntajes por defecto?';
    
    if (!window.confirm(confirmMessage)) {
      return;
    }
  
    setIsClosing(true);
  
    try {
    // Close voting and calculate scores
      const result = await closeVotingAndCalculateScores(partidoActual.id);
    
      if (!result) {
        throw new Error('No se recibió respuesta del cierre de votación');
      }
    
      // Get fresh player data with updated scores from match
      const matchPlayers = await getJugadoresDelPartido(partidoActual.id);
    
      if (!matchPlayers || matchPlayers.length === 0) {
        throw new Error('No se pudieron obtener los jugadores actualizados');
      }
    
      // Create balanced teams
      const teams = armarEquipos(matchPlayers);
    
      if (!teams || teams.length !== 2) {
        throw new Error('Error al crear los equipos');
      }
    
      // Validate teams
      const teamAPlayers = teams[0]?.players?.length || 0;
      const teamBPlayers = teams[1]?.players?.length || 0;
      if (teamAPlayers === 0 || teamBPlayers === 0) {
        throw new Error('Los equipos creados están vacíos');
      }
    
      // Update match status
      await supabase
        .from('partidos')
        .update({ estado: 'equipos_formados', equipos: teams })
        .eq('id', partidoActual.id);
    
      // Update UI state
      safeSetTeams(teams);
      setShowTeamView(true);
      onJugadoresChange(matchPlayers);
    
      // Programar notificaciones de encuesta post-partido
      try {
        const { schedulePostMatchSurveyNotifications } = await import('./utils/matchNotifications');
        await schedulePostMatchSurveyNotifications(partidoActual);
      } catch (scheduleError) {
        console.warn('No se pudieron programar las notificaciones de encuesta:', scheduleError);
      // No mostramos error al usuario ya que no es crítico para la funcionalidad principal
      }
    
      // Success! Show toast only for admin
      if (isAdmin) {
        toast.success('¡Equipos generados exitosamente!');
        
        // Show additional toast if teams are perfectly balanced
        const teamA = teams[0];
        const teamB = teams[1];
        if (teamA && teamB && Math.abs(teamA.score - teamB.score) < 0.01) {
          setTimeout(() => {
            toast.success('¡MATCH PERFECTO! Equipos perfectamente balanceados.');
          }, 1000);
        }
      }
    
    } catch (error) {
    // Provide specific error messages
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
    
      // Reset state on error
      setShowTeamView(false);
    
    } finally {
      setIsClosing(false);
    }
  }


  function handleCopyLink() {
    const url = `${window.location.origin}/?codigo=${partidoActual.codigo}`;
    navigator.clipboard.writeText(url);
    toast.success('¡Link copiado!', { autoClose: 2000 });
  }
  
  async function handleCallToVote() {
    // [TEAM_BALANCER_EDIT] Solo admin puede llamar a votar
    if (!isAdmin) {
      toast.error('Solo el admin puede llamar a votar');
      return;
    }
    
    try {
      // Verificar que haya jugadores para notificar
      if (!jugadores || jugadores.length === 0) {
        toast.warn('No hay jugadores para notificar');
        return;
      }
      
      // Importar dinámicamente la función para crear notificaciones
      const { createCallToVoteNotifications } = await import('./utils/matchNotifications');
      
      // Crear notificaciones para todos los jugadores
      const notificaciones = await createCallToVoteNotifications(partidoActual);
      
      // Mostrar mensaje de éxito con el número de notificaciones creadas
      if (notificaciones.length > 0) {
        toast.success(`Notificación enviada a ${notificaciones.length} jugadores`);
      } else {
        toast.info('No se pudieron enviar notificaciones. Asegúrate que los jugadores tengan cuenta.');
      }
      
    } catch (error) {
      console.error('Error al enviar notificaciones:', error);
      toast.error('Error al enviar notificaciones: ' + error.message);
    }
  }

  function handleWhatsApp() {
    const url = `${window.location.origin}/?codigo=${partidoActual.codigo}`;
    window.open(`https://wa.me/?text=${encodeURIComponent('Entrá a votar para armar los equipos: ' + url)}`, '_blank');
  }
  
  // [TEAM_BALANCER_EDIT] Función para transferir admin (solo el creador puede transferir)
  async function transferirAdmin(jugadorId) {
    if (!isAdmin) {
      toast.error('Solo el creador puede transferir el rol de admin');
      return;
    }
    
    // Encontrar el jugador y obtener su usuario_id
    const jugador = jugadores.find(j => j.id === jugadorId || j.usuario_id === jugadorId);
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
      
      // Actualizar estado local
      partidoActual.creado_por = jugador.usuario_id;
      
      // Notificar al nuevo admin
      await supabase.from('notifications').insert([{
        user_id: jugador.usuario_id,
        type: 'admin_transfer',
        title: 'Eres el nuevo admin',
        message: `Ahora eres admin del partido "${partidoActual.nombre || 'PARTIDO'}".`,
        data: {
          matchId: partidoActual.id,
          matchName: partidoActual.nombre,
          newAdminId: jugador.usuario_id
        },
        read: false
      }]);
      
      // Actualizar el partido en la base de datos para trigger realtime
      await supabase
        .from('partidos')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', partidoActual.id);
      
      // Forzar re-render del componente
      onJugadoresChange([...jugadores]);
      
      toast.success(`${jugador.nombre || 'El jugador'} es ahora el admin del partido`);
      
      // Refrescar la página después de un momento para asegurar que todos los permisos se actualicen
      setTimeout(() => {
        window.location.reload();
      }, 2000);
      
    } catch (error) {
      console.error('Error transferring admin:', error);
      toast.error('Error al transferir admin: ' + error.message);
    }
  }
  
  // [TEAM_BALANCER_INVITE_EDIT] Aceptar invitación al partido
  async function aceptarInvitacion() {
    if (!user?.id || !partidoActual?.id) return;
    
    // Verificar si ya está en el partido
    const yaEstaEnPartido = jugadores.some((j) => j.usuario_id === user.id);
    if (yaEstaEnPartido) {
      toast.error('Ya estás en este partido');
      setPendingInvitation(false);
      return;
    }
    
    // Verificar cupo
    if (partidoActual.cupo_jugadores && jugadores.length >= partidoActual.cupo_jugadores) {
      toast.error('El partido está lleno');
      return;
    }
    
    setInvitationLoading(true);
    try {
      // Verificar nuevamente en la base de datos
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
      
      // Obtener perfil del usuario
      const { data: userProfile, error: profileError } = await supabase
        .from('usuarios')
        .select('nombre, avatar_url')
        .eq('id', user.id)
        .single();
        
      if (profileError) throw profileError;
      
      // Agregar jugador a la tabla jugadores
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
      
      // Marcar notificación como leída - buscar y actualizar por ID
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
      
      // Notificar a otros jugadores
      await notificarJugadoresNuevoMiembro(userProfile?.nombre || 'Un jugador');
      
      toast.success('Te has unido al partido', { autoClose: 3000 });
      
      // No establecer pendingInvitation a false aquí - dejar que el useEffect lo detecte automáticamente
      
    } catch (error) {
      console.error('Error accepting invitation:', error);
      toast.error('Error al unirse al partido: ' + error.message);
    } finally {
      setInvitationLoading(false);
    }
  }
  
  // [TEAM_BALANCER_INVITE_EDIT] Rechazar invitación al partido
  async function rechazarInvitacion() {
    if (!user?.id || !partidoActual?.id) return;
    
    setInvitationLoading(true);
    try {
      // Marcar notificación como leída - buscar y actualizar por ID
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
      
      // Obtener nombre del usuario
      const { data: userProfile } = await supabase
        .from('usuarios')
        .select('nombre')
        .eq('id', user.id)
        .single();
      
      // Notificar rechazo
      await notificarRechazoInvitacion(userProfile?.nombre || 'Un jugador');
      
      onBackToHome(); // Volver sin toast confuso
      
    } catch (error) {
      console.error('Error rejecting invitation:', error);
      toast.error('Error al rechazar invitación: ' + error.message);
    } finally {
      setInvitationLoading(false);
    }
  }
  
  // [TEAM_BALANCER_INVITE_EDIT] Notificar nuevo miembro
  async function notificarJugadoresNuevoMiembro(nombreJugador) {
    try {
      const jugadoresConCuenta = jugadores.filter((j) => j.usuario_id && j.usuario_id !== user.id);
      
      const notificaciones = jugadoresConCuenta.map((jugador) => ({
        user_id: jugador.usuario_id,
        type: 'match_update',
        title: 'Nuevo jugador',
        message: `${nombreJugador} se unió al partido "${partidoActual.nombre || 'PARTIDO'}"`,
        data: {
          matchId: partidoActual.id,
          matchName: partidoActual.nombre,
          playerName: nombreJugador,
        },
        read: false,
      }));
      
      if (notificaciones.length > 0) {
        await supabase.from('notifications').insert(notificaciones);
      }
    } catch (error) {
      console.error('Error notifying players:', error);
    }
  }
  
  // [TEAM_BALANCER_INVITE_EDIT] Notificar rechazo de invitación
  async function notificarRechazoInvitacion(nombreJugador) {
    try {
      const jugadoresConCuenta = jugadores.filter((j) => j.usuario_id);
      
      const notificaciones = jugadoresConCuenta.map((jugador) => ({
        user_id: jugador.usuario_id,
        type: 'match_update',
        title: 'Invitación rechazada',
        message: `${nombreJugador} rechazó la invitación al partido "${partidoActual.nombre || 'PARTIDO'}"`,
        data: {
          matchId: partidoActual.id,
          matchName: partidoActual.nombre,
          playerName: nombreJugador,
        },
        read: false,
      }));
      
      if (notificaciones.length > 0) {
        await supabase.from('notifications').insert(notificaciones);
      }
    } catch (error) {
      console.error('Error notifying rejection:', error);
    }
  }
  
  const [faltanJugadoresState, setFaltanJugadoresState] = useState(partidoActual?.falta_jugadores || false);
  
  // Initialize state only once when partidoActual loads
  useEffect(() => {
    if (partidoActual?.falta_jugadores !== undefined && faltanJugadoresState === false && !partidoActual.falta_jugadores) {
      setFaltanJugadoresState(partidoActual.falta_jugadores);
    }
  }, [partidoActual?.id]); // Only run when partidoActual.id changes (new match loaded)
 
  async function handleFaltanJugadores() {
    // [TEAM_BALANCER_EDIT] Solo admin puede cambiar estado de "faltan jugadores"
    if (!isAdmin) {
      toast.error('Solo el admin puede cambiar este estado');
      return;
    }
    
    const isAtCapacity = partidoActual.cupo_jugadores && jugadores.length >= partidoActual.cupo_jugadores;
    
    // Si está lleno y quiere activar el toggle, no permitir
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
      
      // Update both local states
      setFaltanJugadoresState(nuevoEstado);
      partidoActual.falta_jugadores = nuevoEstado;
      
      toast.success(nuevoEstado ? 
        '¡Partido abierto a la comunidad!' : 
        'Partido cerrado a nuevos jugadores',
      );
    } catch (error) {
      toast.error('Error al actualizar el partido: ' + error.message);
    }
  }
  


  // Función handleRefreshPlayers eliminada

  // Funciones de jugadores libres eliminadas





  // Check for existing teams from database
  const checkForFormedTeams = async () => {
    if (!partidoActual?.id) return;
    
    try {
      // Check if match has teams formed status and get teams from database
      const { data: partidoData } = await supabase
        .from('partidos')
        .select('estado, equipos')
        .eq('id', partidoActual.id)
        .single();
        
      if (partidoData?.estado === 'equipos_formados' && !showTeamView) {
        console.log('[REALTIME] Teams formed detected, loading from database...');
        
        // Try to get teams from database first
        const savedTeams = await getTeamsFromDatabase(partidoActual.id);
        
        if (savedTeams && Array.isArray(savedTeams) && savedTeams.length === 2) {
          console.log('[REALTIME] Loading saved teams from database:', savedTeams);
          safeSetTeams(savedTeams);
          setShowTeamView(true);
          
          // Toast only for guests
          if (!isAdmin) {
            toast.success('¡Equipos formados!');
          }
        } else {
          // Fallback: generate teams from players if no saved teams
          const matchPlayers = await getJugadoresDelPartido(partidoActual.id);
          
          if (matchPlayers && matchPlayers.length > 0 && matchPlayers.length % 2 === 0) {
            const generatedTeams = armarEquipos(matchPlayers);
            
            if (generatedTeams && generatedTeams.length === 2) {
              safeSetTeams(generatedTeams);
              setShowTeamView(true);
              onJugadoresChange(matchPlayers);
              
              // Save generated teams to database
              if (isAdmin) {
                try {
                  await saveTeamsToDatabase(partidoActual.id, generatedTeams);
                } catch (error) {
                  console.error('[REALTIME] Error saving generated teams:', error);
                }
              }
              
              // Toast only for guests
              if (!isAdmin) {
                toast.success('¡Equipos formados!');
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('[REALTIME] Error checking for formed teams:', error);
    }
  };
  
  // Verificar equipos formados al cargar y periódicamente
  useEffect(() => {
    checkForFormedTeams();
    const interval = setInterval(checkForFormedTeams, 3000);
    return () => clearInterval(interval);
  }, [partidoActual?.id, showTeamView, isAdmin]);
  
  const showTeams =
    showTeamView &&
    Array.isArray(teams) &&
    teams.length === 2 &&
    teams.find((t) => t.id === 'equipoA') &&
    teams.find((t) => t.id === 'equipoB');

  // Determine if button should be disabled
  const isButtonDisabled = isClosing || loading || jugadores.length < 2;
  const hasOddPlayers = jugadores.length > 0 && jugadores.length % 2 !== 0;
  const hasNoVotes = votantes.length === 0 && jugadores.length > 0;

  // [TEAM_BALANCER_INVITE_ACCESS_FIX] Mostrar loading hasta verificar invitación
  if (!partidoActual || !invitationChecked) return <LoadingSpinner size="large" />;
  
  // Utility function to extract short venue name
  const getShortVenueName = (venue) => {
    if (!venue) return '';
    // Extract text before first comma or parenthesis
    const shortName = venue.split(/[,(]/)[0].trim();
    return shortName;
  };
  
  // Get match name from database
  const getMatchName = () => {
    // Always use the nombre field from partidos table
    return partidoActual.nombre || 'PARTIDO';
  };

  return (
    <>
      <ChatButton partidoId={partidoActual?.id} />
      
      <PageTitle onBack={onBackToHome}>CONVOCA JUGADORES</PageTitle>
      
      <div className="admin-panel-content">
        {showTeams ? (
          <TeamDisplay
            teams={teams}
            players={jugadores}
            onTeamsChange={handleTeamsChange}
            onBackToHome={onBackToHome}
            isAdmin={isAdmin} // [TEAM_BALANCER_EDIT] Pasar permisos de admin
            partidoId={partidoActual?.id} // Para suscripción en tiempo real
            nombre={partidoActual?.nombre}
            fecha={partidoActual?.fecha}
            hora={partidoActual?.hora}
            sede={partidoActual?.sede}
          />
        ) : (
          <>
            {/* Match header with custom name and details */}
            {/* AJUSTE DE MARGEN: Modificar marginTop aquí para separar del PageTitle */}
            <div className="match-header" style={{ textAlign: 'center', marginBottom: '10px', marginTop: '70px', width: '100%' }}>
              <div className="match-name" style={{ 
                fontSize: '36px', 
                fontWeight: 'bold', 
                marginBottom: '7px',
                fontFamily: 'Bebas Neue, Arial, sans-serif',
                textTransform: 'uppercase',
                letterSpacing: '1px',
              }}>
                {getMatchName()}
              </div>
              <div className="match-details" style={{ 
                fontSize: '20px', 
                color: 'rgba(255,255,255,0.9)',
                textAlign: 'center',
                lineHeight: '1.04',
              }}>
                {partidoActual.fecha && new Date(partidoActual.fecha + 'T00:00:00').toLocaleDateString('es-ES', { 
                  weekday: 'long', 
                  day: 'numeric', 
                  month: 'numeric', 
                })}
                {partidoActual.hora && ` ${partidoActual.hora}`}
                {partidoActual.sede && (
                  <>
                    {' – '}
                    <a 
                      href={`https://www.google.com/maps/search/${encodeURIComponent(getShortVenueName(partidoActual.sede))}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="venue-link"
                      style={{ color: 'rgba(255,255,255,0.9)', textDecoration: 'underline' }}
                    >
                      {getShortVenueName(partidoActual.sede)}
                    </a>
                  </>
                )}
              </div>
            </div>

            {/* [TEAM_BALANCER_INVITE_EDIT] Botones de aceptar/rechazar invitación */}
            {pendingInvitation && (
              <div className="admin-add-section">
                <div style={{ display: 'flex', flexDirection: 'row', gap: '8px', width: '100%' }}>
                  <button
                    className="guest-action-btn invite-btn"
                    onClick={aceptarInvitacion}
                    disabled={invitationLoading || (partidoActual.cupo_jugadores && jugadores.length >= partidoActual.cupo_jugadores)}
                    style={{ 
                      flex: 1,
                      fontSize: '13px',
                      padding: '10px 4px',
                      opacity: (partidoActual.cupo_jugadores && jugadores.length >= partidoActual.cupo_jugadores) ? 0.5 : 1,
                    }}
                  >
                    {invitationLoading ? <LoadingSpinner size="small" /> : 'SUMARME AL PARTIDO'}
                  </button>
                  <button
                    className="guest-action-btn leave-btn"
                    onClick={rechazarInvitacion}
                    disabled={invitationLoading}
                    style={{ 
                      flex: 1,
                      fontSize: '13px',
                      padding: '10px 4px',
                      background: 'rgba(222, 28, 73, 0.3)',
                      borderColor: '#fff',
                    }}
                  >
                    {invitationLoading ? <LoadingSpinner size="small" /> : 'RECHAZAR INVITACIÓN'}
                  </button>
                </div>
                {partidoActual.cupo_jugadores && jugadores.length >= partidoActual.cupo_jugadores && (
                  <div style={{ color: '#ff6b35', fontSize: '14px', textAlign: 'center', marginTop: '8px' }}>
                    Partido lleno ({jugadores.length}/{partidoActual.cupo_jugadores})
                  </div>
                )}
              </div>
            )}
            
            {/* Add player section - Solo para admin */}
            {isAdmin && !pendingInvitation && (
              <div className="admin-add-section">
                <div className="admin-add-form-new">
                  <input
                    className="input-modern-full"
                    type="text"
                    value={nuevoNombre}
                    onChange={(e) => setNuevoNombre(e.target.value)}
                    placeholder="Nombre del jugador"
                    disabled={loading || (partidoActual.cupo_jugadores && jugadores.length >= partidoActual.cupo_jugadores)}
                    ref={inputRef}
                    maxLength={40}
                    required
                    aria-label="Nombre del nuevo jugador"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        agregarJugador(e);
                      }
                    }}
                  />
                  <div className="admin-buttons-row">
                    <button
                      className="voting-confirm-btn admin-btn-half"
                      type="button"
                      onClick={agregarJugador}
                      disabled={loading || isClosing || (partidoActual.cupo_jugadores && jugadores.length >= partidoActual.cupo_jugadores)}
                    >
                      {loading ? <LoadingSpinner size="small" /> : 'AGREGAR'}
                    </button>
                    <button
                      className="voting-confirm-btn admin-btn-half admin-invite-btn"
                      type="button"
                      onClick={() => setShowInviteModal(true)}
                      disabled={!partidoActual?.id || (partidoActual.cupo_jugadores && jugadores.length >= partidoActual.cupo_jugadores)}
                      aria-label="Invitar amigos al partido"
                    >
                      INVITAR AMIGOS
                    </button>
                  </div>
                </div>
                {partidoActual.cupo_jugadores && jugadores.length >= partidoActual.cupo_jugadores && (
                  <div style={{ color: '#ff6b35', fontSize: '14px', textAlign: 'center', marginTop: '8px' }}>
                    Partido lleno ({jugadores.length}/{partidoActual.cupo_jugadores})
                  </div>
                )}
              </div>
            )}
            


            {/* Players list section */}
            <div className="admin-players-section">
              <div className="admin-players-title">
              JUGADORES ({jugadores.length}/{partidoActual.cupo_jugadores || 'Sin límite'}) - VOTARON: {votantesConNombres.length}/{jugadores.length}
                {duplicatesDetected > 0 && isAdmin && (
                  <span style={{ 
                    color: '#ff6b35', 
                    fontSize: '12px', 
                    marginLeft: '10px',
                    background: 'rgba(255, 107, 53, 0.1)',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    border: '1px solid rgba(255, 107, 53, 0.3)',
                  }}>
                    ⚠️ {duplicatesDetected} duplicado{duplicatesDetected > 1 ? 's' : ''}
                  </span>
                )}
              </div>
              {jugadores.length === 0 ? (
                <div className="admin-players-empty">
                  <LoadingSpinner size="medium" />
                </div>
              ) : (
                <div className="admin-players-grid">
                  {jugadores.map((j) => {
                  // Check if this specific player voted by name
                    const hasVoted = votantesConNombres.some((v) => v.nombre === j.nombre);
                    // LOG POR JUGADOR
                    console.log('Render jugador:', j.nombre, j.foto_url, j.avatar_url, j.uuid);

                    return (
                      <PlayerCardTrigger 
                        key={j.uuid} 
                        profile={j}
                        partidoActual={partidoActual}
                        onMakeAdmin={transferirAdmin}
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
                          
                          {/* [TEAM_BALANCER_EDIT] Botón eliminar en el extremo derecho - Solo admin puede eliminar otros */}
                          {isAdmin && j.usuario_id !== user?.id ? (
                            <button
                              className="admin-remove-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                const isOwnPlayer = j.usuario_id === user?.id;
                                const confirmMessage = isOwnPlayer 
                                  ? '¿Estás seguro de que quieres salir del partido?' 
                                  : `¿Eliminar a ${j.nombre} del partido?`;
                                if (window.confirm(confirmMessage)) {
                                  eliminarJugador(j.uuid);
                                }
                              }}
                              type="button"
                              aria-label={j.usuario_id === user?.id ? 'Salir del partido' : 'Eliminar jugador'}
                              disabled={isClosing}
                              title={j.usuario_id === user?.id ? 'Salir del partido' : 'Eliminar jugador'}
                            >
                              ×
                            </button>
                          ) : null}
                        </div>
                      </PlayerCardTrigger>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Toggle para abrir partido a la comunidad - Solo admin */}
            {isAdmin && !pendingInvitation && (
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center', 
                gap: '12px', 
                margin: '16px auto', 
                fontSize: '14px', 
                color: 'rgba(255,255,255,0.8)',
                fontFamily: 'Oswald, Arial, sans-serif',
              }}>
                <span>¿Faltan jugadores?</span>
                <label style={{ 
                  position: 'relative', 
                  display: 'inline-block', 
                  width: '50px', 
                  height: '24px',
                  cursor: (partidoActual.cupo_jugadores && jugadores.length >= partidoActual.cupo_jugadores && !faltanJugadoresState) ? 'not-allowed' : 'pointer',
                }}>
                  <input 
                    type="checkbox" 
                    checked={faltanJugadoresState}
                    onChange={handleFaltanJugadores}
                    disabled={partidoActual.cupo_jugadores && jugadores.length >= partidoActual.cupo_jugadores}
                    style={{ opacity: 0, width: 0, height: 0 }}
                  />
                  <span style={{
                    position: 'absolute',
                    cursor: 'inherit',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: faltanJugadoresState ? '#4CAF50' : '#ccc',
                    transition: '0.3s',
                    borderRadius: '24px',
                    opacity: (partidoActual.cupo_jugadores && jugadores.length >= partidoActual.cupo_jugadores) ? 0.5 : 1,
                  }}>
                    <span style={{
                      position: 'absolute',
                      content: '',
                      height: '18px',
                      width: '18px',
                      left: faltanJugadoresState ? '29px' : '3px',
                      bottom: '3px',
                      backgroundColor: 'white',
                      transition: '0.3s',
                      borderRadius: '50%',
                    }} />
                  </span>
                </label>
                <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)' }}>Abrir a la comunidad</span>
              </div>
            )}

            {/* Sección ARMAR EQUIPOS PAREJOS - Solo admin */}
            {isAdmin && !pendingInvitation && (
              <div style={{ width: '90vw', maxWidth: '90vw', boxSizing: 'border-box', margin: '0 auto', textAlign: 'center' }}>
                <div style={{
                  fontFamily: 'Bebas Neue, Arial, sans-serif',
                  fontSize: '24px',
                  color: '#fff',
                  letterSpacing: '1px',
                  marginBottom: '16px',
                  textTransform: 'uppercase',
                }}>
                  ARMAR EQUIPOS PAREJOS
                </div>
                
                <div style={{ display: 'flex', gap: '8px', width: '100%', marginBottom: '12px' }}>
                  <button 
                    className="voting-confirm-btn admin-btn-cyan" 
                    onClick={handleCallToVote}
                    aria-label="Enviar notificación a los jugadores para que voten"
                    style={{ flex: 1 }}
                  >
                  LLAMAR A VOTAR
                  </button>
                
                  <button 
                    className="voting-confirm-btn admin-btn-cyan" 
                    onClick={handleWhatsApp}
                    aria-label="Compartir enlace por WhatsApp"
                    style={{ flex: 1 }}
                  >
                    <WhatsappIcon size={UI_SIZES.WHATSAPP_ICON_SIZE} style={{ marginRight: 8 }} />
                  COMPARTIR LINK
                  </button>
                </div>
                
                <div style={{ position: 'relative' }}>
                  <button 
                    className="voting-confirm-btn admin-btn-cyan" 
                    onClick={handleCerrarVotacion} 
                    disabled={isButtonDisabled}
                    style={{
                      width: '100%',
                      opacity: isButtonDisabled ? 0.6 : 1,
                      cursor: isButtonDisabled ? 'not-allowed' : 'pointer',
                    }}
                    aria-label={isClosing ? 'Cerrando votación' : `Cerrar votación con ${jugadores.length} jugadores`}
                  >
                    {isClosing ? (
                      <LoadingSpinner size="small" />
                    ) : (
                      `CERRAR VOTACIÓN (${jugadores.length} jugadores)`
                    )}
                  </button>
                

                </div>
                

              </div>
            )}
              
            {/* Botones para jugadores no-admin que están en el partido */}
            {!isAdmin && isPlayerInMatch && !pendingInvitation && (
              <div style={{ display: 'flex', flexDirection: 'row', gap: '8px', width: '90vw', maxWidth: '90vw', boxSizing: 'border-box', margin: '0 auto' }}>
                <button
                  className="guest-action-btn invite-btn"
                  onClick={() => setShowInviteModal(true)}
                  disabled={!partidoActual?.id || (partidoActual.cupo_jugadores && jugadores.length >= partidoActual.cupo_jugadores)}
                  style={{ 
                    flex: 1,
                    fontSize: '13px',
                    padding: '10px 4px',
                    background: 'rgba(76, 175, 80, 0.3)',
                    borderColor: '#fff',
                  }}
                >
                  INVITAR AMIGOS
                </button>
                <button
                  className="guest-action-btn leave-btn"
                  onClick={() => {
                    if (window.confirm('¿Estás seguro de que quieres abandonar el partido?')) {
                      eliminarJugador(user.id, false);
                    }
                  }}
                  style={{ 
                    flex: 1,
                    fontSize: '13px',
                    padding: '10px 4px',
                    background: 'rgba(222, 28, 73, 0.3)',
                    borderColor: '#fff',
                  }}
                >
                  ABANDONAR PARTIDO
                </button>
              </div>
            )}
          
            {/* Sección de jugadores libres eliminada */}

          </>
        )}
      </div>
      
      {/* [TEAM_BALANCER_EDIT] Modal de invitar amigos */}
      {showInviteModal && partidoActual?.id && (
        <InviteAmigosModal
          isOpen={showInviteModal}
          onClose={() => setShowInviteModal(false)}
          currentUserId={user?.id}
          partidoActual={partidoActual}
        />
      )}
    </>
  );
}
