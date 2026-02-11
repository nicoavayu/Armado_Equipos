import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { getPublicBaseUrl } from '../utils/publicBaseUrl';
import { UI_SIZES } from '../appConstants';
import {
  closeVotingAndCalculateScores,
  getVotantesIds,
  getVotantesConNombres,
  getJugadoresDelPartido,
  resetVotacion,
  clearGuestSession,
  supabase,
} from '../supabase';
import WhatsappIcon from './WhatsappIcon';
import { PlayerCardTrigger, AvatarFallback } from './ProfileComponents';
import LoadingSpinner from './LoadingSpinner';
import PageTitle from './PageTitle';
import MatchInfoSection from './MatchInfoSection';
import normalizePartidoForHeader from '../utils/normalizePartidoForHeader';
import { useAuth } from './AuthProvider';
import { sendVotingNotifications } from '../services/notificationService';
import ConfirmModal from '../components/ConfirmModal';
import { MoreVertical, Crown as CrownIcon, X as XIcon, User as UserIcon } from 'lucide-react';

export default function ArmarEquiposView({
  onBackToAdmin,
  jugadores,
  onJugadoresChange,
  partidoActual,
  onTeamsFormed,
  onChatClick,
  chatUnreadCount = 0,
}) {
  const { user } = useAuth();
  const [votantes, setVotantes] = useState([]);
  const [votantesConNombres, setVotantesConNombres] = useState([]);
  const [isClosing, setIsClosing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [calling, setCalling] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const [confirmConfig, setConfirmConfig] = useState({ open: false, action: null });
  const [votingStarted, setVotingStarted] = useState(false);
  const [estadoOverride, setEstadoOverride] = useState(null); // Override local para estado después de reset
  const [playerToRemove, setPlayerToRemove] = useState(null); // Para modal de eliminación
  const playersSectionRef = React.useRef(null);
  const navigate = useNavigate();

  // Control de permisos: verificar si el usuario es admin del partido
  const isAdmin = user?.id && partidoActual?.creado_por === user.id;

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

  // Derivar estado de votación desde DB (notificaciones de tipo call_to_vote)
  useEffect(() => {
    const fetchVotingState = async () => {
      if (!partidoActual?.id) return;
      try {
        const pidNumber = Number(partidoActual.id);
        const { data, error } = await supabase
          .from('notifications')
          .select('id')
          .eq('type', 'call_to_vote')
          .eq('partido_id', pidNumber)
          .limit(1);
        if (error) {
          console.warn('[VotingState] notifications lookup failed', error);
          return;
        }
        setVotingStarted(Boolean(data && data.length > 0));
      } catch (e) {
        console.warn('[VotingState] failed', e);
      }
    };
    fetchVotingState();
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
      // Call service (notify players with app accounts)
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

      // Duplicate notification means voting was already started before; allow entering voting anyway.
      if (res?.alreadyExists) {
        setVotingStarted(true);
        toast.info('La votación ya estaba iniciada. Entrando...');
        navigate(`/?partidoId=${partidoActual.id}`);
        return;
      }

      if (res?.skippedDueToSurveyScheduled || res?.skippedDueToSurvey) {
        toast.info('No se envió la notificación porque ya hay una encuesta/programación asociada al partido.');
        return;
      }

      if ((res.inserted || 0) > 0) {
        toast.success(`Notificación enviada a ${res.inserted} jugadores. Entrando a votación...`);

        // Refrescar estado de votación
        try {
          const { data } = await supabase
            .from('notifications')
            .select('id')
            .eq('type', 'call_to_vote')
            .eq('partido_id', Number(partidoActual.id))
            .limit(1);
          setVotingStarted(Boolean(data && data.length > 0));
        } catch (_e) {
          // Intentionally ignored: failure to refresh voting state shouldn't block navigation.
        }

        // Navegar al admin a la pantalla de votación inmediatamente
        setTimeout(() => {
          const codigo = normalizeMatchCode(partidoActual?.codigo);
          if (codigo) {
            navigate(`/?codigo=${codigo}`);
          } else {
            navigate(`/?partidoId=${partidoActual.id}`);
          }
        }, 500);
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

  async function handleResetVotacion() {
    if (resetting) {
      console.debug('[Teams] reset blocked: already running');
      return;
    }

    if (!partidoActual?.id) {
      toast.error('No hay partido activo');
      return;
    }

    setResetting(true);
    console.debug('[Teams] reset-voting start', { partidoId: partidoActual?.id });

    try {
      const result = await resetVotacion(partidoActual.id);
      console.debug('[Teams] reset result', result);

      toast.success('Votación reseteada - Ahora podés votar de nuevo');

      // Volver a estado pre-votación: borrar notificaciones de call_to_vote y refrescar bandera local
      try {
        const pid = Number(partidoActual.id);
        const orExpr = `partido_id.eq.${pid},match_ref.eq.${pid},data->>match_id.eq.${pid},data->>matchId.eq.${pid}`;
        await supabase
          .from('notifications')
          .delete()
          .eq('type', 'call_to_vote')
          .or(orExpr);
      } catch (notifError) {
        console.warn('[Teams] reset voting: failed to delete call_to_vote notifications', notifError);
      }

      // Limpiar estado local inmediato para reflejar reset (sin esperar re-fetch)
      setVotingStarted(false);
      setVotantes([]);
      setVotantesConNombres([]);
      setActionsMenuOpen(false);
      setEstadoOverride('votacion'); // Forzar UI a salir de "equipos_formados" mientras se actualiza partidoActual

      // Limpiar guest session cache para permitir revotación
      try {
        clearGuestSession(partidoActual.id);
      } catch (e) {
        console.warn('[Teams] error clearing guest session', e);
      }

      // Refrescar votantes desde DB para confirmar estado limpio
      try {
        const votantesIds = await getVotantesIds(partidoActual.id);
        const votantesNombres = await getVotantesConNombres(partidoActual.id);
        setVotantes(votantesIds || []);
        setVotantesConNombres(votantesNombres || []);
      } catch (e) {
        console.warn('[Teams] error refreshing voters after reset', e);
      }

    } catch (error) {
      console.error('[Teams] reset-voting failed', error);
      toast.error('No se pudo resetear la votación: ' + (error.message || 'Error desconocido'));
    } finally {
      setResetting(false);
    }
  }

  const primaryLabel = (() => {
    const estado = estadoOverride || partidoActual?.estado;
    if (estado === 'equipos_formados') return 'VER EQUIPOS';
    if (votingStarted) return 'IR A VOTACIÓN';
    return 'LLAMAR A VOTAR';
  })();

  const handlePrimaryClick = () => {
    const estado = estadoOverride || partidoActual?.estado;
    if (estado === 'equipos_formados') {
      // Already formed, keep current behavior (no redirect in minimal patch)
      if (playersSectionRef.current) playersSectionRef.current.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    if (votingStarted) {
      // START CHANGE: Check if user already voted
      const hasVoted = votantes.includes(user?.id) || (user?.id && votantesConNombres.some((v) => v.id === user.id));

      if (hasVoted) {
        setConfirmConfig({ open: true, action: 'already_voted' });
        return;
      }
      // END CHANGE

      // Navigate to voting using partidoId (codigo may not be loaded)
      console.log('[Teams] Navigating to voting for match:', partidoActual.id);
      navigate(`/?partidoId=${partidoActual.id}`);
      return;
    }
    // Open confirm modal to start voting
    setConfirmConfig({ open: true, action: 'call_to_vote' });
  };

  const normalizeMatchCode = (value) => {
    const raw = String(value ?? '').trim();
    if (!raw || raw.toLowerCase() === 'null' || raw.toLowerCase() === 'undefined') return null;
    return raw;
  };

  const resolveMatchCode = async () => {
    const inMemoryCode = normalizeMatchCode(partidoActual?.codigo);
    if (inMemoryCode) return inMemoryCode;
    if (!partidoActual?.id) return null;

    try {
      const { data, error } = await supabase
        .from('partidos')
        .select('codigo')
        .eq('id', Number(partidoActual.id))
        .maybeSingle();
      if (error) {
        console.error('[Teams] Could not fetch match code from DB:', error);
        return null;
      }
      return normalizeMatchCode(data?.codigo);
    } catch (error) {
      console.error('[Teams] Unexpected error resolving match code:', error);
      return null;
    }
  };

  async function handleWhatsApp() {
    const matchCode = await resolveMatchCode();
    if (!matchCode) {
      toast.error('No se pudo obtener el código del partido para compartir.');
      return;
    }
    const baseUrl = getPublicBaseUrl() || window.location.origin;
    const publicLink = `${baseUrl}/votar-equipos?codigo=${encodeURIComponent(matchCode)}`;
    const text = 'Votá para armar los equipos ⚽️';

    console.debug('[Teams] share link', { partidoId: partidoActual?.id, matchCode });

    // Intentar Web Share API (si disponible)
    if (navigator.share) {
      navigator.share({
        title: 'Votación del partido',
        text,
        url: publicLink,
      })
        .then(() => console.debug('[Share] navigator.share success'))
        .catch((e) => console.debug('[Share] navigator.share cancelled/error', e));
      return;
    }

    // Fallback WhatsApp
    const waText = `${text}\n${publicLink}`;
    const wa = `https://wa.me/?text=${encodeURIComponent(waText)}`;
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
      try {
        // Prefer equipos_json (canonical). Keep legacy "equipos" too for older clients.
        const { error: upErr } = await supabase
          .from('partidos')
          .update({ estado: 'equipos_formados', equipos_json: teams, equipos: teams })
          .eq('id', partidoActual.id);
        if (upErr) throw upErr;
      } catch (e) {
        // Fallback if equipos_json/equipos column doesn't exist in some deployments
        await supabase
          .from('partidos')
          .update({ estado: 'equipos_formados' })
          .eq('id', partidoActual.id);
      }

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

  async function eliminarJugador(jugadorId) {
    const jugadorAEliminar = jugadores.find((j) => j.id === jugadorId);

    if (!jugadorAEliminar) return;

    setLoading(true);
    try {
      const { error } = await supabase
        .from('jugadores')
        .delete()
        .eq('id', jugadorId)
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

  // Si no es admin, mostrar acceso denegado
  if (!isAdmin) {
    return (
      <>
        <PageTitle onBack={onBackToAdmin}>ARMAR EQUIPOS</PageTitle>
        <div className="text-center py-10 px-5 text-white font-oswald">
          <div className="text-2xl mb-4">
            🚫 Acceso Denegado
          </div>
          <div className="text-base opacity-80">
            No tenés permisos para acceder a esta función.
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageTitle
        onBack={onBackToAdmin}
        showChatButton={true}
        onChatClick={onChatClick}
        unreadCount={chatUnreadCount}
      >
        ARMAR EQUIPOS
      </PageTitle>
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
      <div className="w-[90vw] md:w-full max-w-[90vw] md:max-w-4xl mx-auto pb-20 flex flex-col gap-3 overflow-x-hidden mt-6 pt-0">
        {/* Lista de jugadores */}
        <div ref={playersSectionRef} className="bg-white/10 border-2 border-white/20 rounded-xl p-3 min-h-[120px] w-full mx-auto mt-0 box-border">
          <div className="flex items-start justify-between gap-3 mb-3 mt-2">
            <div className="font-bebas text-xl text-white tracking-wide uppercase">
              JUGADORES ({jugadores.length}/{partidoActual.cupo_jugadores || 'Sin límite'})
              <div className="text-[12px] text-white/60 font-oswald font-normal tracking-normal mt-1">
                Votaron: {votantesConNombres.length}/{jugadores.length}
              </div>
              <div className="text-[11px] text-white/50 font-oswald font-normal tracking-normal mt-0.5 leading-snug">
                Esperando votos para armar los equipos
              </div>
            </div>
            {isAdmin && (
              <div className="relative">
                <button
                  className="w-8 h-8 flex items-center justify-center text-white/70 hover:text-white/90 transition-colors"
                  onClick={() => setActionsMenuOpen(!actionsMenuOpen)}
                  type="button"
                  aria-label="Menú de acciones"
                  title="Acciones de administración"
                >
                  <MoreVertical size={20} />
                </button>
                {actionsMenuOpen && (
                  <div className="absolute top-full right-0 mt-1 rounded-lg border border-slate-700 bg-slate-900 shadow-lg z-10 min-w-[180px]">
                    <button
                      className="w-full px-4 py-3 flex items-center gap-2 text-left text-slate-200 hover:bg-slate-800 transition-colors text-sm font-oswald"
                      onClick={() => {
                        setActionsMenuOpen(false);
                        setConfirmConfig({ open: true, action: 'reset' });
                      }}
                      type="button"
                    >
                      <span>Resetear votación</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
          {jugadores.length === 0 ? (
            <div className="text-center text-white/60 font-oswald text-base p-5 italic">
              <LoadingSpinner size="medium" />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2.5 w-full max-w-[720px] mx-auto justify-items-center box-border">
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
                      className={`flex items-center gap-1.5 bg-slate-900 border rounded-lg p-2 transition-all min-h-[36px] w-full max-w-[660px] mx-auto hover:bg-slate-800 ${hasVoted ? 'border-emerald-500 hover:border-emerald-400 border-[1.5px]' : 'border-slate-800 hover:border-slate-700'}`}
                    >
                      {j.foto_url || j.avatar_url ? (
                        <img
                          src={j.foto_url || j.avatar_url}
                          alt={j.nombre}
                          className="w-8 h-8 rounded-full object-cover border border-slate-700 bg-slate-800 shrink-0"
                        />
                      ) : (
                        <AvatarFallback name={j.nombre} size="w-8 h-8" />
                      )}

                      <span className="flex-1 font-oswald text-sm font-semibold text-white tracking-wide min-w-0 break-words leading-tight">
                        {j.nombre}
                      </span>

                      {/* Corona para admin */}
                      {partidoActual?.creado_por === j.usuario_id && (
                        <CrownIcon size={18} className="text-yellow-400/90" style={{ flexShrink: 0 }} />
                      )}

                      {/* Botón eliminar - Solo admin puede eliminar otros */}
                      {j.usuario_id !== user?.id && (
                        <button
                          className="w-6 h-6 bg-slate-800 text-white/70 border border-slate-700 rounded-full cursor-pointer transition-all flex items-center justify-center shrink-0 hover:bg-slate-700 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPlayerToRemove({ id: j.id, nombre: j.nombre });
                          }}
                          type="button"
                          disabled={loading}
                          aria-label={`Eliminar a ${j.nombre}`}
                        >
                          <XIcon size={12} />
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
        <div className="w-full box-border mx-auto mt-4 mb-0">
          {/* Primary and Secondary CTAs */}
          <div className="flex gap-2 w-full mb-3">
            <div className="flex-1 flex flex-col gap-1">
              <button
                type="button"
                className="relative z-10 w-full font-bebas text-[15px] px-4 border-none rounded-xl cursor-pointer transition-all text-white h-[44px] min-h-[44px] flex items-center justify-center font-bold tracking-wide disabled:opacity-50 disabled:cursor-not-allowed bg-[#128BE9] hover:brightness-110 active:scale-95"
                onClick={handlePrimaryClick}
                disabled={calling}
              >
                {calling ? <LoadingSpinner size="small" /> : primaryLabel}
              </button>
              <div className="text-[11px] text-white/50 leading-snug text-center px-1">
                Notifica a los jugadores que ya tienen la app
              </div>
            </div>

            <div className="flex-1 flex flex-col gap-1">
              <button
                className="w-full font-bebas text-[15px] px-4 border border-slate-600 rounded-xl cursor-pointer transition-all text-white/80 h-[44px] min-h-[44px] flex items-center justify-center font-bold tracking-wide disabled:opacity-50 disabled:cursor-not-allowed hover:border-slate-500 hover:text-white/90 bg-transparent"
                onClick={handleWhatsApp}
              >
                <WhatsappIcon size={UI_SIZES.WHATSAPP_ICON_SIZE} style={{ marginRight: 6 }} />
                COMPARTIR
              </button>
              <div className="text-[11px] text-white/50 leading-snug text-center px-1">
                Enviá el link a quienes no tienen la app
              </div>
            </div>
          </div>

          {/* Flow progression: Cerrar votación */}
          <div className="w-full flex flex-col gap-1 mt-3 pt-2 border-t border-slate-700/50">
            <button
              type="button"
              className="w-full font-bebas text-[15px] px-4 border border-slate-600 rounded-xl cursor-pointer transition-all text-white/80 h-[44px] min-h-[44px] flex items-center justify-center font-bold tracking-wide disabled:opacity-50 disabled:cursor-not-allowed hover:border-slate-500 hover:text-white/90 bg-transparent"
              onClick={() => setConfirmConfig({ open: true, action: 'close' })}
              disabled={isClosing}
            >
              {isClosing ? <LoadingSpinner size="small" /> : 'CERRAR VOTACIÓN'}
            </button>
            <div className="text-[11px] text-white/50 leading-snug text-center px-1">
              Avanza al armado de equipos y bloquea nuevas votaciones
            </div>
          </div>
        </div>

        <ConfirmModal
          isOpen={confirmConfig.open && confirmConfig.action === 'call_to_vote'}
          title={'Iniciar votación'}
          message={`Se notificará a los ${jugadores.length} jugadores que tienen la app para que voten. Luego entrarás a la pantalla de votación.`}
          onConfirm={() => {
            setConfirmConfig({ open: false, action: null });
            handleCallToVote();
          }}
          onCancel={() => setConfirmConfig({ open: false, action: null })}
          confirmText={'Notificar y votar'}
          cancelText={'Cancelar'}
          isDeleting={calling}
        />

        <ConfirmModal
          isOpen={confirmConfig.open && confirmConfig.action === 'reset'}
          title={'Resetear votación'}
          message={'Esta acción borra todos los votos del partido y vuelve la votación a cero. No se puede deshacer.'}
          onConfirm={() => {
            setConfirmConfig({ open: false, action: null });
            handleResetVotacion();
          }}
          onCancel={() => setConfirmConfig({ open: false, action: null })}
          confirmText={'Resetear votación'}
          cancelText={'Cancelar'}
          isDeleting={resetting}
        />

        <ConfirmModal
          isOpen={confirmConfig.open && confirmConfig.action === 'close'}
          title={'Cerrar votación'}
          message={votantes.length > 0
            ? `¿Cerrar votación y armar equipos? Se procesaron ${votantes.length} votos.`
            : 'No se detectaron votos. Los equipos se formarán con puntajes por defecto.'}
          onConfirm={() => {
            setConfirmConfig({ open: false, action: null });
            handleCerrarVotacion();
          }}
          onCancel={() => setConfirmConfig({ open: false, action: null })}
          confirmText={'Cerrar votación'}
          cancelText={'Cancelar'}
          isDeleting={isClosing}
        />

        <ConfirmModal
          isOpen={confirmConfig.open && confirmConfig.action === 'already_voted'}
          title="YA VOTASTE"
          message="Ya registramos tu voto para este partido. Esperá a que el administrador cierre la votación para ver los equipos."
          onConfirm={() => setConfirmConfig({ open: false, action: null })}
          onCancel={() => setConfirmConfig({ open: false, action: null })}
          confirmText="Aceptar"
          cancelText=""
          isDeleting={false}
          singleButton={true}
        />

        <ConfirmModal
          isOpen={playerToRemove !== null}
          title="Eliminar jugador"
          message={`¿Eliminar a ${playerToRemove?.nombre} del partido?`}
          onConfirm={() => {
            if (playerToRemove) {
              eliminarJugador(playerToRemove.id);
              setPlayerToRemove(null);
            }
          }}
          onCancel={() => setPlayerToRemove(null)}
          confirmText="Eliminar"
          cancelText="Cancelar"
          isDeleting={loading}
        />
      </div>
    </>
  );
}
