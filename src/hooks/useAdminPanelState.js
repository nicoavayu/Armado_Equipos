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
  onBackToHome,
}) => {
  const [votantes, setVotantes] = useState([]);
  const [votantesConNombres, setVotantesConNombres] = useState([]);
  const [nuevoNombre, setNuevoNombre] = useState('');
  const [loading, setLoading] = useState(false);
  const [isClosing, _setIsClosing] = useState(false);
  const [showTeamView, setShowTeamView] = useState(false);
  const [showArmarEquiposView, setShowArmarEquiposView] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [duplicatesDetected, _setDuplicatesDetected] = useState(0);
  const [teams, setTeams] = useState([
    { id: 'equipoA', name: 'Equipo A', players: [], score: 0 },
    { id: 'equipoB', name: 'Equipo B', players: [], score: 0 },
  ]);
  const [jugadoresLocal, setJugadoresLocal] = useState(jugadores || []);
  const [pendingInvitation, setPendingInvitation] = useState(false);
  const [invitationStatus, setInvitationStatus] = useState(null); // 'pending', 'declined', 'accepted', etc.
  const [invitationLoading, setInvitationLoading] = useState(false);
  const [invitationChecked, setInvitationChecked] = useState(false);
  const [faltanJugadoresState, setFaltanJugadoresState] = useState(partidoActual?.falta_jugadores || false);
  const inputRef = useRef();

  const jugadoresActuales = jugadoresLocal || [];
  const currentPlayerInMatch = jugadoresActuales.find((j) => j.usuario_id === user?.id);
  const starterCapacity = Number(partidoActual?.cupo_jugadores || 0);
  const maxRosterSlots = starterCapacity > 0 ? starterCapacity + 2 : 0; // titulares + 2 suplentes
  const isRosterFull = maxRosterSlots > 0 && jugadores.length >= maxRosterSlots;

  // New state to track if user has an approved request but isn't in players table yet
  const [hasApprovedRequest, setHasApprovedRequest] = useState(false);

  // Combined membership state
  const isPlayerInMatch = !!currentPlayerInMatch || hasApprovedRequest;

  // Sync with initial props
  useEffect(() => {
    if (jugadores && jugadores.length > 0) {
      setJugadoresLocal(jugadores);
    }
  }, [jugadores]);

  // Check invitation
  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    if (search.has('codigo')) return; // no correr en voting view

    const checkInvitation = async () => {
      if (!user?.id || !partidoActual?.id) {
        setInvitationChecked(true);
        return;
      }

      try {
        const isInMatch = jugadores.some((j) => j.usuario_id === user.id);
        if (isInMatch) {
          setPendingInvitation(false);
          setHasApprovedRequest(false);
          setInvitationChecked(true);
          return;
        }

        // --- NEW: Check match_join_requests for approved status ---
        const { data: joinReq } = await supabase
          .from('match_join_requests')
          .select('status')
          .eq('match_id', partidoActual.id)
          .eq('user_id', user.id)
          .maybeSingle();

        if (joinReq?.status === 'approved') {
          console.log('[ADMIN_PANEL] User has approved request, synchronizing...');
          setHasApprovedRequest(true);
          setPendingInvitation(false);
          setInvitationChecked(true);
          return;
        }
        // ---------------------------------------------------------

        // Validate partidoActual.id is a valid value
        if (!partidoActual.id || partidoActual.id === 'undefined' || partidoActual.id === 'null') {
          console.warn('[ADMIN_PANEL] Invalid partidoActual.id, skipping invitation check');
          setInvitationChecked(true);
          return;
        }

        console.log('[ADMIN_PANEL] Checking invitation for match:', partidoActual.id);

        const { data: invitation } = await supabase
          .from('notifications_ext')
          .select('id, data')
          .eq('user_id', user.id)
          .eq('type', 'match_invite')
          // .eq('read', false) // REMOVER: queremos ver si existe aunque esté leída para controlar estado
          .eq('match_id_text', partidoActual.id.toString())
          .order('send_at', { ascending: false }) // Get latest
          .limit(1)
          .maybeSingle();

        if (invitation) {
          const status = invitation.data?.status || 'pending';
          setInvitationStatus(status);
          // Sólo mostrar como pending si el status es pending (o undefined) Y no está leída (opcional, pero user quiere que rejection invalide)
          // User req: "Si invite status != 'pending' ... mostrar pantalla read-only"
          // So actually we want to KNOW if there is an invitation even if handled/declined to show the invalid screen?
          // Or does 'pendingInvitation' boolean drive the UI?
          // AdminPanel uses `pendingInvitation` to show the guest view UI (checking MatchInfoSection vs PlayersSection).
          // If I set pendingInvitation=true, it shows guest view.
          // I should set pendingInvitation=true if there is ANY recent invite record, and let the view handle the 'Invalid' state based on 'invitationStatus'.
          // WAIT. AdminPanel logic: `!showTeams && ( ... AdminActions ... PlayersSection )`
          // PlayersSection handles `!isPlayerInMatch`.

          // Correct approach:
          // If status IS pending, treat as valid invite -> pendingInvitation = true.
          // If status IS declined, we still might want to show "You declined this".
          // But normally if I declined, I proceed to see the match as a stranger (or see nothing special).
          // User wants: "Al abrir la pantalla de Aceptar invitación ... Si invite status != pending ... mostrar pantalla read-only".
          // This implies we DO enter the flow.
          setPendingInvitation(true);
        } else {
          setPendingInvitation(false);
          setInvitationStatus(null);
        }

      } catch (error) {
        setPendingInvitation(false);
      } finally {
        setInvitationChecked(true);
      }
    };

    checkInvitation();
  }, [user?.id, partidoActual?.id, jugadores]);

  const fetchJugadores = async () => {
    if (!partidoActual?.id) return;
    try {
      const jugadoresPartido = await getJugadoresDelPartido(partidoActual.id);
      const votantesIds = await getVotantesIds(partidoActual.id);
      const votantesNombres = await getVotantesConNombres(partidoActual.id);
      setVotantes(votantesIds || []);
      setVotantesConNombres(votantesNombres || []);

      // Update local state instead of calling parent onJugadoresChange 
      // which triggers a destructive updateJugadoresPartido.
      setJugadoresLocal(jugadoresPartido || []);
    } catch (error) {
      console.error('Error loading initial data:', error);
    }
  };

  // Fetch initial data and real-time subscriptions
  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    if (search.has('codigo')) return;

    fetchJugadores();

    // Real-time subscription for players
    const playersChannel = supabase
      .channel(`match-players-${partidoActual.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'jugadores',
        filter: `partido_id=eq.${partidoActual.id}`,
      }, async () => {
        console.log('[REALTIME] Players changed, refreshing...');
        try {
          const jugadoresPartido = await getJugadoresDelPartido(partidoActual.id);
          setJugadoresLocal(jugadoresPartido);
        } catch (error) {
          console.error('Error refreshing players:', error);
        }
      })
      .subscribe();

    // Real-time subscription for votes (authenticated)
    const votesChannel = supabase
      .channel(`match-votes-${partidoActual.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'votos',
        filter: `partido_id=eq.${partidoActual.id}`,
      }, async () => {
        console.log('[REALTIME] Auth votes changed, refreshing...');
        try {
          const votantesIds = await getVotantesIds(partidoActual.id);
          const votantesNombres = await getVotantesConNombres(partidoActual.id);
          setVotantes(votantesIds || []);
          setVotantesConNombres(votantesNombres || []);
        } catch (error) {
          console.error('Error refreshing votes:', error);
        }
      })
      .subscribe();

    // Real-time subscription for public votes
    const publicVotesChannel = supabase
      .channel(`match-public-votes-${partidoActual.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'votos_publicos',
        filter: `partido_id=eq.${partidoActual.id}`,
      }, async () => {
        console.log('[REALTIME] Public votes changed, refreshing...');
        try {
          const votantesIds = await getVotantesIds(partidoActual.id);
          const votantesNombres = await getVotantesConNombres(partidoActual.id);
          setVotantes(votantesIds || []);
          setVotantesConNombres(votantesNombres || []);
        } catch (error) {
          console.error('Error refreshing public votes:', error);
        }
      })
      .subscribe();

    // Real-time subscription for public voters (identities)
    const publicVotersChannel = supabase
      .channel(`match-public-voters-${partidoActual.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'public_voters',
        filter: `partido_id=eq.${partidoActual.id}`,
      }, async () => {
        console.log('[REALTIME] Public voters changed, refreshing...');
        try {
          const votantesIds = await getVotantesIds(partidoActual.id);
          const votantesNombres = await getVotantesConNombres(partidoActual.id);
          setVotantes(votantesIds || []);
          setVotantesConNombres(votantesNombres || []);
        } catch (error) {
          console.error('Error refreshing public voters:', error);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(playersChannel);
      supabase.removeChannel(votesChannel);
      supabase.removeChannel(publicVotesChannel);
      supabase.removeChannel(publicVotersChannel);
    };
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

    if (isRosterFull) {
      toast.error('El partido está completo (titulares y suplentes)');
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

  const eliminarJugador = async (jugadorId, _esExpulsion = false) => {
    const jugadorAEliminar = jugadores.find((j) => j.id === jugadorId);

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
      console.log('[LEAVE_MATCH] Deleting player from match:', {
        matchId: partidoActual.id,
        jugadorId: jugadorId,
        isSelfRemoval: esAutoEliminacion
      });

      // Use jugador.id (BIGINT) as source of truth - works for ALL players
      const { error } = await supabase
        .from('jugadores')
        .delete()
        .eq('id', jugadorId)
        .eq('partido_id', partidoActual.id);

      if (error) {
        console.error('[LEAVE_MATCH] Error:', {
          code: error.code,
          message: error.message,
          details: error.details,
          hint: error.hint
        });
        throw error;
      }

      console.log('[LEAVE_MATCH] Deleted successfully');

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
          console.error('[LEAVE_MATCH] Error incrementing abandonment counter:', abandonError);
        }
      }

      if (esAutoEliminacion) {
        toast.success('Te has eliminado del partido');
        setTimeout(() => onBackToHome(), 1000);
      }

      if (isAdmin && !esAutoEliminacion && jugadorAEliminar?.usuario_id) {
        try {
          // If an approved request exists, demote it so the user can request access again.
          // This prevents the public screen from getting stuck in "approved syncing".
          await supabase
            .from('match_join_requests')
            .update({ status: 'rejected', decided_at: new Date().toISOString(), decided_by: user.id })
            .eq('match_id', partidoActual.id)
            .eq('user_id', jugadorAEliminar.usuario_id)
            .eq('status', 'approved');

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
          console.error('[LEAVE_MATCH] Error sending kick notification:', notifError);
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
      console.error('[LEAVE_MATCH] Unexpected error:', error);
      toast.error('Error eliminando jugador: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const transferirAdmin = async (jugadorId) => {
    console.log('[TRANSFER_ADMIN] Starting admin transfer', { jugadorId, isAdmin, currentUserId: user?.id });

    if (!isAdmin) {
      const msg = 'Solo el creador puede transferir el rol de admin';
      console.error('[TRANSFER_ADMIN]', msg);
      throw new Error(msg);
    }

    const jugador = jugadores.find((j) => j.id === jugadorId || j.usuario_id === jugadorId);
    console.log('[TRANSFER_ADMIN] Found jugador:', { jugador, searchedId: jugadorId });

    if (!jugador || !jugador.usuario_id) {
      const msg = 'El jugador debe tener una cuenta para ser admin';
      console.error('[TRANSFER_ADMIN]', msg);
      throw new Error(msg);
    }

    if (jugador.usuario_id === user.id) {
      const msg = 'Ya eres el admin del partido';
      console.error('[TRANSFER_ADMIN]', msg);
      throw new Error(msg);
    }

    try {
      console.log('[TRANSFER_ADMIN] Updating partido creado_por to', jugador.usuario_id);
      const { error } = await supabase
        .from('partidos')
        .update({ creado_por: jugador.usuario_id })
        .eq('id', partidoActual.id);

      if (error) {
        console.error('[TRANSFER_ADMIN] Supabase update error:', error);
        throw error;
      }

      console.log('[TRANSFER_ADMIN] Update successful, updating local state');
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

      console.log('[TRANSFER_ADMIN] Inserting notification');
      await supabase.from('notifications').insert([payload]);

      // Trigger a minimal update to refresh admin panel (updated_at handled by trigger)
      console.log('[TRANSFER_ADMIN] Final update to trigger refresh');
      await supabase
        .from('partidos')
        .update({ creado_por: jugador.usuario_id })
        .eq('id', partidoActual.id);

      onJugadoresChange([...jugadores]);

      console.log('[TRANSFER_ADMIN] Transfer completed successfully');
      toast.success(`${jugador.nombre || 'El jugador'} es ahora el admin del partido`);

      // Don't reload page, let the modal stay open to show changes
      setTimeout(() => {
        window.location.reload();
      }, 2000);

    } catch (error) {
      console.error('[TRANSFER_ADMIN] Catch block error:', error);
      throw error;
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

    if (isRosterFull) {
      toast.error('El partido está completo (titulares y suplentes)');
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
      setJugadoresLocal(jugadoresActualizados);
      onJugadoresChange(jugadoresActualizados);
      setPendingInvitation(false);

      toast.success('Te has unido al partido', { autoClose: 3000 });

      // Force refresh to show guest view
      setTimeout(() => {
        window.location.reload();
      }, 1500);

    } catch (error) {
      if (error.message && error.message.includes('row-level security policy')) {
        console.warn('Suppressing RLS error during join sync (expected for non-admins):', error);
      } else {
        toast.error('Error al unirse al partido: ' + error.message);
      }
    } finally {
      setInvitationLoading(false);
    }
  };

  const unirseAlPartido = async () => {
    if (!user?.id || !partidoActual?.id) return;

    if (isRosterFull) {
      toast.error('El partido está completo (titulares y suplentes)');
      return;
    }

    setLoading(true);
    try {
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
          score: 5,
          is_goalkeeper: false,
        }]);

      if (insertError) throw insertError;

      const jugadoresActualizados = await getJugadoresDelPartido(partidoActual.id);
      setJugadoresLocal(jugadoresActualizados);
      onJugadoresChange(jugadoresActualizados);

      toast.success('¡Te sumaste al partido!');
    } catch (error) {
      console.error("Error uniéndose:", error);
      toast.error("No se pudo unir: " + error.message);
    } finally {
      setLoading(false);
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

    const isAtCapacity = isRosterFull;

    if (isAtCapacity && !faltanJugadoresState) {
      toast.error('No se puede abrir el partido cuando está lleno');
      return;
    }

    try {
      const nuevoEstado = !faltanJugadoresState;
      const updateObj = { falta_jugadores: nuevoEstado };
      if (nuevoEstado) updateObj.estado = 'active';
      const { error } = await supabase
        .from('partidos')
        .update(updateObj)
        .eq('id', partidoActual.id);

      if (error) throw error;

      setFaltanJugadoresState(nuevoEstado);
      partidoActual.falta_jugadores = nuevoEstado;
      if (nuevoEstado) partidoActual.estado = 'active';

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
    invitationStatus, // Export status
    unirseAlPartido,
    fetchJugadores,
    hasApprovedRequest, // Export new state
  };
};
