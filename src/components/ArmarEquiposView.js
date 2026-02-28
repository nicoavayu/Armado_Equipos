import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getPublicBaseUrl } from '../utils/publicBaseUrl';
import { notifyBlockingError } from 'utils/notifyBlockingError';
import {
  closeVotingAndCalculateScores,
  checkIfAlreadyVoted,
  getVotantesIds,
  getVotantesConNombres,
  getJugadoresDelPartido,
  hasRecordedVotes,
  resetVotacion,
  clearGuestSession,
  supabase,
} from '../supabase';
import { PlayerCardTrigger, AvatarFallback } from './ProfileComponents';
import LoadingSpinner from './LoadingSpinner';
import PageTitle from './PageTitle';
import MatchInfoSection from './MatchInfoSection';
import normalizePartidoForHeader from '../utils/normalizePartidoForHeader';
import { useAuth } from './AuthProvider';
import { sendVotingNotifications } from '../services/notificationService';
import ConfirmModal from '../components/ConfirmModal';
import { MoreVertical, Share2 } from 'lucide-react';

const INVITE_ACCEPT_BUTTON_VIOLET = '#644dff';
const INVITE_ACCEPT_BUTTON_VIOLET_DARK = '#4836bb';
const SLOT_SKEW_X = 6;
const HEADER_ICON_COLOR = '#29aaff';
const HEADER_ICON_GLOW = 'drop-shadow(0 0 4px rgba(41, 170, 255, 0.78))';
const PLACEHOLDER_NUMBER_STYLE = {
  color: 'transparent',
  WebkitTextStroke: '2px rgba(104, 154, 255, 0.5)',
  textShadow: '-0.6px -0.6px 0 rgba(255,255,255,0.11), 0.8px 0.8px 0 rgba(0,0,0,0.34)',
  opacity: 0.56,
  fontFamily: '"Roboto Mono", "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", monospace',
  fontWeight: 700,
  letterSpacing: '0.02em',
  lineHeight: 1,
};

const resolveSlotsFromMatchType = (match = {}) => {
  const explicitCapacity = Number(match?.cupo_jugadores || match?.cupo || 0);
  if (Number.isFinite(explicitCapacity) && explicitCapacity > 0) {
    return explicitCapacity;
  }

  const token = String(match?.tipo_partido || match?.modalidad || '').trim().toUpperCase();
  const normalized = token.replace(/\s+/g, '');
  const matchByNumber = normalized.match(/F(\d+)/i);
  if (matchByNumber) {
    const playersPerTeam = Number(matchByNumber[1]);
    if (Number.isFinite(playersPerTeam) && playersPerTeam > 0) {
      return playersPerTeam * 2;
    }
  }

  const fallbackByType = {
    F5: 10,
    F6: 12,
    F7: 14,
    F8: 16,
    F11: 22,
  };

  return fallbackByType[normalized] || 10;
};

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
  const [checkingVoteStatus, setCheckingVoteStatus] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const [confirmConfig, setConfirmConfig] = useState({ open: false, action: null });
  const [votingStarted, setVotingStarted] = useState(false);
  const [estadoOverride, setEstadoOverride] = useState(null); // Override local para estado después de reset
  const [playerToRemove, setPlayerToRemove] = useState(null); // Para modal de eliminación
  const [inlineNotice, setInlineNotice] = useState(null);
  const playersSectionRef = React.useRef(null);
  const navigate = useNavigate();

  // Control de permisos: verificar si el usuario es admin del partido
  const isAdmin = user?.id && partidoActual?.creado_por === user.id;

  const showInlineNotice = (type, message) => {
    setInlineNotice({ type, message, ts: Date.now() });
  };

  useEffect(() => {
    if (!inlineNotice) return undefined;
    const timer = setTimeout(() => setInlineNotice(null), 4200);
    return () => clearTimeout(timer);
  }, [inlineNotice]);

  const normalizeIdentity = useCallback((value) => {
    if (value === null || value === undefined) return null;
    const normalized = String(value).trim();
    return normalized.length > 0 ? normalized : null;
  }, []);

  const normalizeName = useCallback((value) => {
    if (!value) return null;
    const normalized = String(value).trim().toLowerCase();
    return normalized.length > 0 ? normalized : null;
  }, []);

  const votantesIdSet = useMemo(() => {
    const ids = (votantes || []).map((id) => normalizeIdentity(id)).filter(Boolean);
    return new Set(ids);
  }, [votantes, normalizeIdentity]);

  const votantesNameSet = useMemo(() => {
    const names = (votantesConNombres || [])
      .map((voter) => normalizeName(voter?.nombre))
      .filter(Boolean);
    return new Set(names);
  }, [votantesConNombres, normalizeName]);

  const currentRosterPlayer = useMemo(() => {
    if (!user?.id || !Array.isArray(jugadores)) return null;
    const authId = normalizeIdentity(user.id);
    if (!authId) return null;
    return jugadores.find((j) => {
      const byUserId = normalizeIdentity(j?.usuario_id);
      const byUuid = normalizeIdentity(j?.uuid);
      return byUserId === authId || byUuid === authId;
    }) || null;
  }, [jugadores, user?.id, normalizeIdentity]);

  const currentUserIdentityCandidates = useMemo(() => {
    const candidates = [
      user?.id,
      currentRosterPlayer?.usuario_id,
      currentRosterPlayer?.uuid,
      currentRosterPlayer?.id,
    ]
      .map((value) => normalizeIdentity(value))
      .filter(Boolean);
    return Array.from(new Set(candidates));
  }, [user?.id, currentRosterPlayer, normalizeIdentity]);

  const currentUserNameCandidates = useMemo(() => {
    const names = [
      currentRosterPlayer?.nombre,
      user?.user_metadata?.full_name,
      user?.user_metadata?.name,
    ]
      .map((value) => normalizeName(value))
      .filter(Boolean);
    return Array.from(new Set(names));
  }, [currentRosterPlayer?.nombre, user?.user_metadata?.full_name, user?.user_metadata?.name, normalizeName]);

  const currentUserHasVotedLocal = useMemo(() => {
    if (currentUserIdentityCandidates.some((id) => votantesIdSet.has(id))) return true;
    return currentUserNameCandidates.some((name) => votantesNameSet.has(name));
  }, [currentUserIdentityCandidates, currentUserNameCandidates, votantesIdSet, votantesNameSet]);

  const playerHasVoted = useCallback((player) => {
    if (!player) return false;
    const ids = [player.uuid, player.usuario_id, player.id]
      .map((value) => normalizeIdentity(value))
      .filter(Boolean);
    if (ids.some((id) => votantesIdSet.has(id))) return true;

    const normalizedPlayerName = normalizeName(player.nombre);
    return normalizedPlayerName ? votantesNameSet.has(normalizedPlayerName) : false;
  }, [normalizeIdentity, normalizeName, votantesIdSet, votantesNameSet]);

  const refreshVotantes = useCallback(async () => {
    if (!partidoActual?.id) return;
    try {
      const votantesIds = await getVotantesIds(partidoActual.id);
      const votantesNombres = await getVotantesConNombres(partidoActual.id);
      setVotantes(votantesIds || []);
      setVotantesConNombres(votantesNombres || []);
    } catch (error) {
      console.error('Error loading votantes:', error);
    }
  }, [partidoActual?.id]);

  // Cargar votantes y suscripción en tiempo real
  useEffect(() => {
    if (!partidoActual?.id) return undefined;
    refreshVotantes();

    // Suscripción en tiempo real para refrescar cuando hay cambios
    const subscription = supabase
      .channel(`match_${partidoActual?.id}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'partidos',
        filter: `id=eq.${partidoActual?.id}`,
      }, () => {
        refreshVotantes();
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'votos',
        filter: `partido_id=eq.${partidoActual?.id}`,
      }, () => {
        refreshVotantes();
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'votos_publicos',
        filter: `partido_id=eq.${partidoActual?.id}`,
      }, () => {
        refreshVotantes();
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'public_voters',
        filter: `partido_id=eq.${partidoActual?.id}`,
      }, () => {
        refreshVotantes();
      })
      .subscribe();

    const handleFocus = () => {
      refreshVotantes();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshVotantes();
      }
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      subscription.unsubscribe();
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [partidoActual?.id, refreshVotantes]);

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

  const buildVotingRoute = ({ partidoId, codigo } = {}) => {
    const resolvedPartidoId = Number(partidoId || partidoActual?.id);
    const params = new URLSearchParams();

    if (Number.isFinite(resolvedPartidoId) && resolvedPartidoId > 0) {
      const idAsString = String(resolvedPartidoId);
      params.set('partidoId', idAsString);
      params.set('adminPartidoId', idAsString);
    }

    const safeCode = String(codigo || '').trim();
    if (safeCode) {
      params.set('codigo', safeCode);
    }

    params.set('returnTo', 'armar-equipos');
    return `/?${params.toString()}`;
  };

  async function handleCallToVote() {
    if (calling) {
      console.debug('[Teams] call-to-vote blocked: already running');
      return;
    }

    if (!partidoActual?.id) {
      showInlineNotice('warning', 'No hay partido activo.');
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
        notifyBlockingError('No se pudo iniciar la votación: ' + (res.error.message || 'Error desconocido'));
        return;
      }

      // Duplicate notification means voting was already started before; allow entering voting anyway.
      if (res?.alreadyExists) {
        setVotingStarted(true);
        showInlineNotice('info', 'La votación ya estaba iniciada. Entrando a votación.');
        navigate(buildVotingRoute({ partidoId: partidoActual.id }));
        return;
      }

      if (res?.skippedDueToSurveyScheduled || res?.skippedDueToSurvey) {
        showInlineNotice('warning', 'La votación ya está programada para este partido.');
        return;
      }

      if ((res.inserted || 0) > 0) {
        showInlineNotice('success', `Notificación enviada a ${res.inserted} jugadores. Entrando a votación.`);

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
            navigate(buildVotingRoute({ partidoId: partidoActual.id, codigo }));
          } else {
            navigate(buildVotingRoute({ partidoId: partidoActual.id }));
          }
        }, 500);
      } else {
        showInlineNotice('warning', 'No se enviaron notificaciones porque no hay jugadores con cuenta.');
      }

    } catch (error) {
      console.error('[Teams] call-to-vote failed', error);
      notifyBlockingError('No se pudo iniciar la votación: ' + (error.message || 'Error desconocido'));
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
      showInlineNotice('warning', 'No hay partido activo.');
      return;
    }

    setResetting(true);
    console.debug('[Teams] reset-voting start', { partidoId: partidoActual?.id });

    try {
      const result = await resetVotacion(partidoActual.id);
      console.debug('[Teams] reset result', result);

      showInlineNotice('success', 'Votación reseteada. Ahora podés votar de nuevo.');

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
      notifyBlockingError('No se pudo resetear la votación: ' + (error.message || 'Error desconocido'));
    } finally {
      setResetting(false);
    }
  }

  const primaryLabel = (() => {
    const estado = estadoOverride || partidoActual?.estado;
    if (estado === 'equipos_formados') return 'Ver equipos';
    if (votingStarted) return 'Ir a votación';
    return 'Llamar a votar';
  })();

  const handlePrimaryClick = async () => {
    const estado = estadoOverride || partidoActual?.estado;
    if (estado === 'equipos_formados') {
      // Already formed, keep current behavior (no redirect in minimal patch)
      if (playersSectionRef.current) playersSectionRef.current.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    if (votingStarted) {
      if (checkingVoteStatus) return;
      setCheckingVoteStatus(true);
      try {
        let hasVoted = currentUserHasVotedLocal;

        if (!hasVoted && partidoActual?.id) {
          for (const candidateId of currentUserIdentityCandidates) {
            const alreadyVoted = await checkIfAlreadyVoted(candidateId, partidoActual.id);
            if (alreadyVoted) {
              hasVoted = true;
              break;
            }
          }
        }

        if (hasVoted) {
          await refreshVotantes();
          setConfirmConfig({ open: true, action: 'already_voted' });
          return;
        }

        // Navigate to voting using partidoId (codigo may not be loaded)
        console.log('[Teams] Navigating to voting for match:', partidoActual.id);
        navigate(buildVotingRoute({ partidoId: partidoActual.id }));
      } catch (error) {
        console.warn('[Teams] failed to verify local voter status, allowing access to voting', error);
        navigate(buildVotingRoute({ partidoId: partidoActual.id }));
      } finally {
        setCheckingVoteStatus(false);
      }
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
      showInlineNotice('warning', 'No se pudo obtener el código del partido para compartir.');
      return;
    }
    const baseUrl = getPublicBaseUrl() || window.location.origin;
    const publicLink = `${baseUrl}/votar-equipos?codigo=${encodeURIComponent(matchCode)}`;
    const text = 'Votá para armar los equipos ⚽️';
    const waText = `${text}\n${publicLink}`;
    const encodedText = encodeURIComponent(waText);
    const whatsappWebUrl = `https://api.whatsapp.com/send?text=${encodedText}`;
    const whatsappAppUrl = `whatsapp://send?text=${encodedText}`;
    const isMobileWeb = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');

    console.debug('[Teams] share link', { partidoId: partidoActual?.id, matchCode });

    // En mobile web priorizamos deep-link a WhatsApp para abrir selector de contactos.
    if (isMobileWeb) {
      window.location.href = whatsappAppUrl;
      return;
    }

    // Intentar Web Share API (si disponible) en desktop.
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Votación del partido',
          text,
          url: publicLink,
        });
        return;
      } catch (shareError) {
        if (shareError?.name === 'AbortError') return;
        console.warn('[Share] navigator.share failed, fallback to WhatsApp URL', shareError);
      }
    }

    // Fallback WhatsApp web.
    const opened = window.open(whatsappWebUrl, '_blank', 'noopener,noreferrer');
    if (opened) return;
    window.location.href = whatsappWebUrl;
  }

  async function handleCerrarVotacion() {
    if (isClosing) {
      showInlineNotice('info', 'Operación en progreso, esperá un momento.');
      return;
    }

    // Validaciones
    if (!partidoActual) {
      showInlineNotice('warning', 'No hay partido activo.');
      return;
    }

    if (!jugadores || jugadores.length === 0) {
      showInlineNotice('warning', 'No hay jugadores en el partido.');
      return;
    }

    if (jugadores.length < 2) {
      showInlineNotice('warning', 'Se necesitan al menos 2 jugadores.');
      return;
    }

    if (jugadores.length % 2 !== 0) {
      showInlineNotice('warning', 'Se necesita un número par de jugadores para formar equipos.');
      return;
    }

    const invalidPlayers = jugadores.filter((j) => !j.uuid);
    if (invalidPlayers.length > 0) {
      showInlineNotice('warning', 'Hay jugadores sin ID válido.');
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

      showInlineNotice('success', 'Votación cerrada. Equipos armados.');

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

      notifyBlockingError(errorMessage);
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

    const matchHasVotes = await hasRecordedVotes(partidoActual.id);
    if (matchHasVotes) {
      showInlineNotice('warning', 'Ya hay votos registrados. Para editar el plantel, primero reseteá la votación.');
      return;
    }

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
      notifyBlockingError('Error eliminando jugador: ' + error.message);
    } finally {
      setLoading(false);
    }
  }

  const requiredSlots = resolveSlotsFromMatchType(partidoActual);
  const displayCount = jugadores?.length ?? 0;
  const confirmedCount = Math.min(displayCount, requiredSlots);
  const progressPct = requiredSlots > 0
    ? Math.max(0, Math.min((confirmedCount / requiredSlots) * 100, 100))
    : 0;
  const slotItems = Array.from({ length: requiredSlots }, (_, idx) => jugadores?.[idx] || null);
  const missingSlotsCount = Math.max(0, requiredSlots - confirmedCount);
  const softCardWrapperStyle = {
    backgroundColor: '#07163b',
    border: '1px solid rgba(41, 170, 255, 0.9)',
    boxShadow: '0 0 9px rgba(41, 170, 255, 0.24)',
    transform: `skewX(-${SLOT_SKEW_X}deg)`,
    backfaceVisibility: 'hidden',
  };
  const softPlaceholderWrapperStyle = {
    background: 'rgba(255,255,255,0.015)',
    border: '1px dashed rgba(255,255,255,0.055)',
    boxShadow: 'none',
    transform: `skewX(-${SLOT_SKEW_X}deg)`,
  };
  const skewCounterStyle = {
    transform: `skewX(${SLOT_SKEW_X}deg)`,
  };
  const callToVotePalette = {
    '--btn': 'linear-gradient(90deg, rgba(100, 77, 255, 0.78) 0%, rgba(123, 97, 255, 0.86) 100%)',
    '--btn-dark': 'rgba(122, 104, 255, 0.72)',
    '--btn-text': '#eef0ff',
    '--btn-shadow': '0 6px 14px rgba(71, 56, 187, 0.22)',
  };
  const closeVotingPalette = {
    '--btn': `linear-gradient(90deg, ${INVITE_ACCEPT_BUTTON_VIOLET_DARK} 0%, ${INVITE_ACCEPT_BUTTON_VIOLET} 100%)`,
    '--btn-dark': 'rgba(144, 118, 255, 0.86)',
    '--btn-text': '#ffffff',
    '--btn-shadow': '0 8px 18px rgba(76, 58, 196, 0.34)',
  };
  const headerActionIconButtonClass = 'h-8 w-8 inline-flex items-center justify-center bg-transparent border-0 p-0 text-[#29aaff]/80 hover:text-[#29aaff] transition-colors disabled:opacity-45 disabled:cursor-not-allowed';

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
      <style>{`
        .invite-cta-btn {
          appearance: none;
          cursor: pointer;
          width: 100%;
          max-width: none;
          min-width: 0;
          height: 60px;
          padding-inline: 18px;
          display: flex;
          flex: 1 1 0;
          align-items: center;
          justify-content: center;
          gap: 0.55rem;
          font-size: 1.08rem;
          font-weight: 700;
          letter-spacing: 0.045em;
          color: var(--btn-text, #fff);
          background: var(--btn);
          border: 1.5px solid var(--btn-dark);
          border-radius: 0;
          box-shadow: var(--btn-shadow, none);
          transform: skew(-6deg);
          transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease, opacity 120ms ease;
          backface-visibility: hidden;
          white-space: nowrap;
        }
        .invite-cta-btn > span {
          transform: skew(6deg);
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .invite-cta-btn:hover:not(:disabled) {
          filter: brightness(1.08);
        }
        .invite-cta-btn:active:not(:disabled) {
          transform: skew(-6deg);
          opacity: 0.92;
        }
        .invite-cta-btn:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }
      `}</style>
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
      <div className="w-[90vw] md:w-full max-w-[90vw] md:max-w-4xl mx-auto flex flex-col gap-3 overflow-x-hidden mt-6 pt-0 pb-[calc(var(--safe-bottom,0px)+14px)]">
        {inlineNotice && (
          <div
            className={`rounded-xl px-4 py-3 border text-sm font-oswald ${
              inlineNotice.type === 'success'
                ? 'bg-emerald-500/15 border-emerald-400/40 text-emerald-200'
                : inlineNotice.type === 'warning'
                  ? 'bg-amber-500/15 border-amber-400/40 text-amber-100'
                  : 'bg-sky-500/15 border-sky-400/40 text-sky-100'
            }`}
          >
            {inlineNotice.message}
          </div>
        )}
        {/* Lista de jugadores */}
        <div ref={playersSectionRef} className="relative w-full mx-auto mt-0 box-border min-h-[120px]">
          <div className="absolute right-0 top-0 z-10">
            {isAdmin && (
              <div className="relative flex items-center gap-1.5">
                <button
                  type="button"
                  className={headerActionIconButtonClass}
                  onClick={handleWhatsApp}
                  title="Compartir link de votación"
                  aria-label="Compartir link de votación"
                >
                  <Share2 size={14} style={{ color: HEADER_ICON_COLOR, filter: HEADER_ICON_GLOW }} />
                </button>
                <button
                  className={headerActionIconButtonClass}
                  onClick={() => setActionsMenuOpen(!actionsMenuOpen)}
                  type="button"
                  aria-label="Menú de acciones"
                  title="Acciones de administración"
                >
                  <MoreVertical size={16} style={{ color: HEADER_ICON_COLOR, filter: HEADER_ICON_GLOW }} />
                </button>
                {actionsMenuOpen && (
                  <div className="absolute top-full right-0 mt-1 w-48 border bg-slate-900/98 shadow-lg z-10 overflow-hidden transition-all duration-200 ease-out" style={{ borderColor: 'rgba(88, 107, 170, 0.46)', borderRadius: 0, transform: `skewX(-${SLOT_SKEW_X}deg)` }}>
                    <div style={{ transform: `skewX(${SLOT_SKEW_X}deg)` }}>
                      <button
                        className="w-full h-[46px] px-3 flex items-center gap-2 text-left text-slate-100 hover:bg-slate-800 transition-colors text-sm font-medium"
                        onClick={() => {
                          setActionsMenuOpen(false);
                          setConfirmConfig({ open: true, action: 'reset' });
                        }}
                        type="button"
                      >
                        <span>Resetear votación</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="w-full box-border" style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0.01) 100%)', paddingTop: '16px', paddingBottom: '24px' }}>
            <div className="px-1 mb-6 pr-14">
              <div className="font-oswald text-xl font-semibold text-white tracking-[0.01em]">
                Jugadores
              </div>
              <div className="mt-2 h-[6px] w-full overflow-hidden rounded-[6px] bg-white/[0.08]">
                <div
                  className="h-full rounded-[6px] transition-all duration-200"
                  style={{ width: `${progressPct}%`, backgroundColor: INVITE_ACCEPT_BUTTON_VIOLET, filter: 'saturate(1.05)' }}
                />
              </div>
              <div className="text-[11px] text-white/50 font-oswald font-normal tracking-normal mt-2 leading-snug">
                Esperando votos para armar los equipos
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 w-full max-w-[720px] mx-auto justify-items-center box-border px-1">
              {(() => {
                let slotNumber = missingSlotsCount;
                return slotItems.map((j, idx) => {
                  if (!j) {
                    const visibleNumber = slotNumber > 0 ? slotNumber : Math.max(1, requiredSlots - idx);
                    slotNumber = Math.max(0, slotNumber - 1);
                    return (
                      <div
                        key={`slot-empty-${idx}`}
                        className="rounded-none h-12 w-full overflow-hidden"
                        style={softPlaceholderWrapperStyle}
                        aria-hidden="true"
                      >
                        <div
                          className="h-full w-full p-2 flex items-center justify-center"
                          style={skewCounterStyle}
                        >
                          <span className="select-none pointer-events-none text-[28px]" style={PLACEHOLDER_NUMBER_STYLE}>
                            {visibleNumber}
                          </span>
                        </div>
                      </div>
                    );
                  }

                  const hasVoted = playerHasVoted(j);
                  const cardStyle = {
                    ...softCardWrapperStyle,
                    border: hasVoted ? '1px solid rgba(74, 222, 128, 0.9)' : softCardWrapperStyle.border,
                    boxShadow: hasVoted ? '0 0 11px rgba(74, 222, 128, 0.3)' : softCardWrapperStyle.boxShadow,
                  };

                  return (
                    <PlayerCardTrigger
                      key={j.uuid || j.id || `slot-player-${idx}`}
                      profile={j}
                      partidoActual={partidoActual}
                    >
                      <div
                        className="PlayerCard PlayerCard--soft relative rounded-none h-12 w-full overflow-visible transition-all cursor-pointer hover:brightness-105"
                        style={cardStyle}
                      >
                        <div className="h-full w-full p-2 flex items-center gap-1.5" style={skewCounterStyle}>
                          {j.foto_url || j.avatar_url ? (
                            <img
                              src={j.foto_url || j.avatar_url}
                              alt={j.nombre}
                              className="w-8 h-8 rounded-full object-cover border border-slate-700 bg-slate-800 shrink-0"
                            />
                          ) : (
                            <AvatarFallback name={j.nombre} size="w-8 h-8" />
                          )}

                          <span className="flex-1 font-oswald text-sm font-semibold text-white tracking-wide min-w-0 truncate leading-tight">
                            {j.nombre}
                          </span>

                          {partidoActual?.creado_por === j.usuario_id && (
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="16" height="16" fill="#FFD700" style={{ flexShrink: 0 }}>
                              <path d="M345 151.2C354.2 143.9 360 132.6 360 120C360 97.9 342.1 80 320 80C297.9 80 280 97.9 280 120C280 132.6 285.9 143.9 295 151.2L226.6 258.8C216.6 274.5 195.3 278.4 180.4 267.2L120.9 222.7C125.4 216.3 128 208.4 128 200C128 177.9 110.1 160 88 160C65.9 160 48 177.9 48 200C48 221.8 65.5 239.6 87.2 240L119.8 457.5C124.5 488.8 151.4 512 183.1 512L456.9 512C488.6 512 515.5 488.8 520.2 457.5L552.8 240C574.5 239.6 592 221.8 592 200C592 177.9 574.1 160 552 160C529.9 160 512 177.9 512 200C512 208.4 514.6 216.3 519.1 222.7L459.7 267.3C444.8 278.5 423.5 274.6 413.5 258.9L345 151.2z" />
                            </svg>
                          )}

                          {j.usuario_id !== user?.id && (
                            <button
                              className="w-5 h-5 bg-transparent border-0 p-0 cursor-pointer transition-colors inline-flex items-center justify-center shrink-0 hover:text-[#29aaff] disabled:opacity-50 disabled:cursor-not-allowed"
                              onClick={(e) => {
                                e.stopPropagation();
                                setPlayerToRemove({ id: j.id, nombre: j.nombre });
                              }}
                              type="button"
                              disabled={loading}
                              aria-label={`Eliminar a ${j.nombre}`}
                              title={`Eliminar a ${j.nombre}`}
                            >
                              <span
                                className="leading-none text-[15px]"
                                style={{ color: HEADER_ICON_COLOR, filter: HEADER_ICON_GLOW }}
                              >
                                ×
                              </span>
                            </button>
                          )}
                        </div>
                      </div>
                    </PlayerCardTrigger>
                  );
                });
              })()}
            </div>
          </div>
        </div>

        {/* Botones de acción */}
        <div className="w-full box-border mx-auto mt-4 mb-0">
          <div className="w-full flex flex-col gap-1 mb-3">
            <button
              type="button"
              className="invite-cta-btn relative z-10"
              style={callToVotePalette}
              onClick={handlePrimaryClick}
              disabled={calling || checkingVoteStatus}
            >
              <span>{calling || checkingVoteStatus ? <LoadingSpinner size="small" /> : primaryLabel}</span>
            </button>
            <div className="text-[11px] text-white/50 leading-snug text-center px-1">
              Notifica a los jugadores que ya tienen la app
            </div>
          </div>

          {/* Flow progression: Cerrar votación */}
          <div className="w-full flex flex-col gap-1 mt-3 pt-2 border-t border-slate-700/50">
            <button
              type="button"
              className="invite-cta-btn"
              style={closeVotingPalette}
              onClick={() => setConfirmConfig({ open: true, action: 'close' })}
              disabled={isClosing}
            >
              <span>{isClosing ? <LoadingSpinner size="small" /> : 'Cerrar votación'}</span>
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
          actionsAlign="center"
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
          confirmText={'Confirmar'}
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
          confirmText={'Confirmar'}
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
