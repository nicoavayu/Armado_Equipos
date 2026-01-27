import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { useNotifications } from '../context/NotificationContext';
import { useInterval } from '../hooks/useInterval';
import { supabase } from '../supabase';
import { clearMatchFromList } from '../services/matchFinishService';
import { parseLocalDateTime, formatLocalDateShort, formatLocalDM } from '../utils/dateLocal';
import { toBigIntId } from '../utils';
import LoadingSpinner from './LoadingSpinner';
import PageTitle from './PageTitle';
import ConfirmModal from './ConfirmModal';
import { toast } from 'react-toastify';

import { FaCrown } from 'react-icons/fa';
import { MoreVertical, LogOut, XCircle } from 'lucide-react';

const ProximosPartidos = ({ onClose }) => {
  const { user } = useAuth();
  const { createNotification } = useNotifications();
  const navigate = useNavigate();
  const [partidos, setPartidos] = useState([]);
  const [loading, setLoading] = useState(true);
  // Always sort by temporal proximity (soonest first)
  const [clearedMatches, setClearedMatches] = useState(new Set());
  const [completedSurveys, setCompletedSurveys] = useState(new Set());
  const [notifiedMatches, setNotifiedMatches] = useState(new Set());
  const [userJugadorIds, setUserJugadorIds] = useState([]);

  const [menuOpenId, setMenuOpenId] = useState(null);

  // Per-match processing id flags so only the clicked button is disabled
  const [processingDeleteId, setProcessingDeleteId] = useState(null);
  const [processingClearId, setProcessingClearId] = useState(null);

  // Confirmation modal state (shared for delete / clean / cancel / abandon)
  const [showConfirm, setShowConfirm] = useState(false);
  const [actionType, setActionType] = useState(null); // 'cancel' | 'clean' | 'abandon'
  const [partidoTarget, setPartidoTarget] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    if (user) {
      fetchUserMatches();
    }
  }, [user]);

  // Suscripción en tiempo real a inserts de encuestas
  useEffect(() => {
    if (!user || !userJugadorIds.length) return;
    const channel = supabase
      .channel('post_match_surveys_inserts')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'post_match_surveys' }, (payload) => {
        const { partido_id, votante_id } = payload.new || {};
        if (!partido_id || !votante_id) return;
        if (!userJugadorIds.includes(votante_id)) return; // solo mis encuestas
        setCompletedSurveys((prev) => { const s = new Set(prev); s.add(partido_id); return s; });
        setPartidos((prev) => prev.filter((p) => p.id !== partido_id)); // limpia inmediatamente
      });
    return () => { supabase.removeChannel(channel); };
  }, [user?.id, userJugadorIds]);

  // Refetch al volver con ?surveyDone=1
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('surveyDone') === '1') {
      fetchUserMatches();
      navigate('/proximos', { replace: true });
    }
  }, [navigate]);

  // Force re-render every minute to update match status
  const { setIntervalSafe, clearIntervalSafe } = useInterval();

  useEffect(() => {
    setIntervalSafe(() => {
      setPartidos((prev) => [...prev]); // Force re-render
    }, 60000);

    return () => clearIntervalSafe();
  }, [setIntervalSafe, clearIntervalSafe]);

  const fetchUserMatches = async () => {
    if (!user) return;

    try {
      const { data: jugadoresData, error: jugadoresError } = await supabase
        .from('jugadores')
        .select('partido_id')
        .eq('usuario_id', user.id);

      if (jugadoresError) throw jugadoresError;

      const partidosComoJugador = jugadoresData?.map((j) => j.partido_id) || [];

      const { data: partidosComoAdmin, error: adminError } = await supabase
        .from('partidos')
        .select('id')
        .eq('creado_por', user.id);

      if (adminError) throw adminError;

      const partidosAdminIds = partidosComoAdmin?.map((p) => p.id) || [];
      const todosLosPartidosIds = Array.from(new Set([...partidosComoJugador, ...partidosAdminIds]));

      if (todosLosPartidosIds.length === 0) {
        setPartidos([]);
        setLoading(false);
        return;
      }

      // Get cleared matches for this user
      let clearedMatchIds = new Set();
      try {
        const { data: clearedData, error: clearedError } = await supabase
          .from('cleared_matches')
          .select('partido_id')
          .eq('user_id', user.id);

        if (!clearedError) {
          clearedMatchIds = new Set(clearedData?.map((c) => c.partido_id) || []);
        } else {
          // Fallback to localStorage
          const key = `cleared_matches_${user.id}`;
          const existing = JSON.parse(localStorage.getItem(key) || '[]');
          clearedMatchIds = new Set(existing);
        }
      } catch (error) {
        // Fallback to localStorage
        const key = `cleared_matches_${user.id}`;
        const existing = JSON.parse(localStorage.getItem(key) || '[]');
        clearedMatchIds = new Set(existing);
      }
      setClearedMatches(clearedMatchIds);

      // Get completed surveys for this user
      try {
        // First get the user's jugador IDs from all their matches
        const { data: userJugadorIdsData, error: jugadorError } = await supabase
          .from('jugadores')
          .select('id, partido_id')
          .eq('usuario_id', user.id);

        if (!jugadorError && userJugadorIdsData && userJugadorIdsData.length > 0) {
          const jugadorIds = userJugadorIdsData.map((j) => j.id);
          setUserJugadorIds(jugadorIds);

          const { data: surveysData, error: surveysError } = await supabase
            .from('post_match_surveys')
            .select('partido_id')
            .in('votante_id', jugadorIds);

          if (!surveysError) {
            setCompletedSurveys(new Set(surveysData?.map((s) => s.partido_id) || []));
          }
        }
      } catch (error) {
        console.error('Error fetching completed surveys:', error);
      }

      const { data: partidosData, error: partidosError } = await supabase
        .from('partidos')
        .select(`
          *,
          jugadores(count)
        `)
        .in('id', todosLosPartidosIds)
        .order('fecha', { ascending: true })
        .order('hora', { ascending: true });

      if (partidosError) throw partidosError;

      const now = new Date();
      const partidosFiltrados = partidosData.filter((partido) => {
        // Filter out cleared matches
        if (clearedMatchIds.has(partido.id)) {
          return false;
        }

        // Filter out matches with completed surveys (el partido desaparece cuando el usuario completa la encuesta)
        if (completedSurveys.has(partido.id)) {
          return false;
        }

        if (!partido.fecha || !partido.hora) {
          return true;
        }

        try {
          const partidoDateTime = parseLocalDateTime(partido.fecha, partido.hora);
          if (!partidoDateTime) return true;
          // Show match until 1 hour after it started, then it becomes finished
          const partidoMasUnaHora = new Date(partidoDateTime.getTime() + 60 * 60 * 1000);
          return now <= partidoMasUnaHora;
        } catch (error) {
          return true;
        }
      });

      const partidosEnriquecidos = partidosFiltrados.map((partido) => ({
        ...partido,
        userRole: partidosAdminIds.includes(partido.id) ? 'admin' : 'player',
        userJoined: partidosComoJugador.includes(partido.id),
        hasCompletedSurvey: completedSurveys.has(partido.id),
      }));

      // Check for finished matches and send notifications
      for (const partido of partidosEnriquecidos) {
        if (isMatchFinished(partido) && !notifiedMatches.has(partido.id)) {
          try {
            // --- CANONICAL MODE CHECK: prevent client creation when DB is canonical ---
            const SURVEY_FANOUT_MODE = process.env.NEXT_PUBLIC_SURVEY_FANOUT_MODE || 'db';
            if (SURVEY_FANOUT_MODE === 'db') {
              setNotifiedMatches((prev) => { const s = new Set(prev); s.add(partido.id); return s; });
              continue;
            }

            await createNotification(
              'post_match_survey',
              '¡Encuesta lista!',
              `La encuesta ya está lista para completar sobre el partido ${partido.nombre || formatMatchDate(partido.fecha)}.`,
              {
                partido_id: partido.id,
                partido_nombre: partido.nombre,
                partido_fecha: partido.fecha,
                partido_hora: partido.hora,
                partido_sede: partido.sede,
              },
            );
            setNotifiedMatches((prev) => { const s = new Set(prev); s.add(partido.id); return s; });
          } catch (error) {
            console.error('Error sending match finish notification:', error);
          }
        }
      }

      setPartidos(partidosEnriquecidos);

    } catch (error) {
      console.error('Error fetching matches:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleMatchClick = (partido) => {
    onClose();
    navigate(`/admin/${partido.id}`);
  };

  const handleCancelMatch = (e, partido) => {
    if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
    setMenuOpenId(null);
    setPartidoTarget(partido);
    setActionType('cancel');
    setShowConfirm(true);
  };

  const handleAbandonMatch = (e, partido) => {
    if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
    setMenuOpenId(null);
    setPartidoTarget(partido);
    setActionType('abandon');
    setShowConfirm(true);
  };

  const handleSurveyClick = (e, partido) => {
    e.stopPropagation();
    navigate(`/encuesta/${partido.id}`);
  };

  const handleClearMatch = (e, partido) => {
    if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
    console.log('[PROXIMOS] click LIMPIAR', partido?.id);
    setPartidoTarget(partido);
    setActionType('clean');
    setShowConfirm(true);
  };

  const handleConfirmAction = async () => {
    if (!partidoTarget || !actionType) {
      setShowConfirm(false);
      return;
    }

    setIsProcessing(true);
    try {
      if (actionType === 'cancel') {
        setProcessingDeleteId(partidoTarget.id);
        const { error } = await supabase.from('partidos').delete().eq('id', partidoTarget.id);
        if (error) throw error;
        setPartidos((prev) => prev.filter((p) => p.id !== partidoTarget.id));
        toast.success('Partido cancelado');
        setProcessingDeleteId(null);
      } else if (actionType === 'abandon') {
        setProcessingDeleteId(partidoTarget.id);
        const { error } = await supabase
          .from('jugadores')
          .delete()
          .eq('partido_id', partidoTarget.id)
          .eq('usuario_id', user.id);
        if (error) throw error;
        setPartidos((prev) => prev.filter((p) => p.id !== partidoTarget.id));
        toast.success('Abandonaste el partido');
        setProcessingDeleteId(null);
      } else if (actionType === 'clean') {
        setProcessingClearId(partidoTarget.id);
        const success = await clearMatchFromList(user.id, partidoTarget.id);
        if (success) {
          setPartidos((prev) => prev.filter((p) => p.id !== partidoTarget.id));
          setClearedMatches((prev) => { const s = new Set(prev); s.add(partidoTarget.id); return s; });
          toast.success('Partido limpiado');
        } else {
          toast.error('No se pudo limpiar el partido');
        }
        setProcessingClearId(null);
      }
    } catch (error) {
      console.error('[PROXIMOS] confirm action error', error);
      toast.error('Ocurrió un error al procesar la acción');
    } finally {
      setIsProcessing(false);
      setShowConfirm(false);
      setActionType(null);
      setPartidoTarget(null);
    }
  };

  const isMatchFinished = (partido) => {
    if (!partido.fecha || !partido.hora) return false;

    try {
      const partidoDateTime = parseLocalDateTime(partido.fecha, partido.hora);
      if (!partidoDateTime) return false;
      const now = new Date();

      return now >= partidoDateTime;
    } catch (error) {
      console.error('Error checking match finish:', error);
      return false;
    }
  };

  const formatDate = (dateString) => formatLocalDateShort(dateString);

  const formatMatchDate = (fecha) => formatLocalDM(fecha);

  const canAbandon = (partido) => {
    const partidoDateTime = parseLocalDateTime(partido.fecha, partido.hora);
    if (!partidoDateTime) return false;
    return new Date() < partidoDateTime;
  };

  const canCancel = (partido) => {
    const partidoDateTime = parseLocalDateTime(partido.fecha, partido.hora);
    if (!partidoDateTime) return false;
    return new Date() < partidoDateTime;
  };

  const getPrimaryCta = (partido) => {
    const matchFinished = isMatchFinished(partido);
    const joined = !!partido.userJoined;
    const completed = !!partido.hasCompletedSurvey;

    if (matchFinished) {
      if (joined && !completed) return { label: 'Completar encuesta', kind: 'survey', disabled: false };
      if (joined && completed) return { label: 'Encuesta completada', kind: 'survey_done', disabled: true };
      return { label: 'Ver detalles', kind: 'details', disabled: false };
    }

    if (joined) return { label: 'Ver detalles', kind: 'details', disabled: false };
    return { label: 'Ingresar', kind: 'join', disabled: false };
  };

  const getRoleIcon = (role) => {
    if (role === 'admin') {
      return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="14" height="14" fill="currentColor">
          <path d="M345 151.2C354.2 143.9 360 132.6 360 120C360 97.9 342.1 80 320 80C297.9 80 280 97.9 280 120C280 132.6 285.9 143.9 295 151.2L226.6 258.8C216.6 274.5 195.3 278.4 180.4 267.2L120.9 222.7C125.4 216.3 128 208.4 128 200C128 177.9 110.1 160 88 160C65.9 160 48 177.9 48 200C48 221.8 65.5 239.6 87.2 240L119.8 457.5C124.5 488.8 151.4 512 183.1 512L456.9 512C488.6 512 515.5 488.8 520.2 457.5L552.8 240C574.5 239.6 592 221.8 592 200C592 177.9 574.1 160 552 160C529.9 160 512 177.9 512 200C512 208.4 514.6 216.3 519.1 222.7L459.7 267.3C444.8 278.5 423.5 274.6 413.5 258.9L345 151.2z" />
        </svg>
      );
    } else {
      return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="14" height="14" fill="currentColor">
          <path d="M481.3 424.1L409.7 419.3C404.5 419 399.4 420.4 395.2 423.5C391 426.6 388 430.9 386.8 436L369.2 505.6C353.5 509.8 337 512 320 512C303 512 286.5 509.8 270.8 505.6L253.2 436C251.9 431 248.9 426.6 244.8 423.5C240.7 420.4 235.5 419 230.3 419.3L158.7 424.1C141.1 396.9 130.2 364.9 128.3 330.5L189 292.3C193.4 289.5 196.6 285.3 198.2 280.4C199.8 275.5 199.6 270.2 197.7 265.4L171 198.8C192 173.2 219.3 153 250.7 140.9L305.9 186.9C309.9 190.2 314.9 192 320 192C325.1 192 330.2 190.2 334.1 186.9L389.3 140.9C420.6 153 448 173.2 468.9 198.8L442.2 265.4C440.3 270.2 440.1 275.5 441.7 280.4C443.3 285.3 446.6 289.5 450.9 292.3L511.6 330.5C509.7 364.9 498.8 396.9 481.2 424.1zM320 576C461.4 576 576 461.4 576 320C576 178.6 461.4 64 320 64C178.6 64 64 178.6 64 320C64 461.4 178.6 576 320 576zM334.1 250.3C325.7 244.2 314.3 244.2 305.9 250.3L258 285C249.6 291.1 246.1 301.9 249.3 311.8L267.6 368.1C270.8 378 280 384.7 290.4 384.7L349.6 384.7C360 384.7 369.2 378 372.4 368.1L390.7 311.8C393.9 301.9 390.4 291.1 382 285L334.1 250.2z" />
        </svg>
      );
    }
  };

  const getRoleText = (role) => {
    return role === 'admin' ? 'Admin' : 'Jugador';
  };

  const getModalidadClass = (modalidad) => {
    if (!modalidad) return 'bg-slate-700 border-2 border-[#4CAF50]';
    if (modalidad.includes('5')) return 'bg-slate-700 border-2 border-[#4CAF50]';
    if (modalidad.includes('6')) return 'bg-slate-700 border-2 border-[#FF9800]';
    if (modalidad.includes('7')) return 'bg-slate-700 border-2 border-[#9c27b0]';
    if (modalidad.includes('8')) return 'bg-slate-700 border-2 border-[#f44336]';
    if (modalidad.includes('11')) return 'bg-slate-700 border-2 border-[#3f51b5]';
    return 'bg-slate-700 border-2 border-[#4CAF50]';
  };

  const getTipoClass = (tipo) => {
    if (!tipo) return 'bg-slate-700 border-2 border-[#2196F3]';
    const tipoLower = tipo.toLowerCase();
    if (tipoLower.includes('masculino')) return 'bg-slate-700 border-2 border-[#2196F3]';
    if (tipoLower.includes('femenino')) return 'bg-slate-700 border-2 border-[#E91E63]';
    if (tipoLower.includes('mixto')) return 'bg-slate-700 border-2 border-[#FFC107]';
    return 'bg-slate-700 border-2 border-[#2196F3]';
  };

  const getSortedPartidos = () => {
    const partidosCopy = [...partidos];
    // Sort by temporal proximity (earliest upcoming first)
    return partidosCopy.sort((a, b) => {
      const dateA = parseLocalDateTime(a.fecha, a.hora);
      const dateB = parseLocalDateTime(b.fecha, b.hora);
      const ta = dateA ? dateA.getTime() : 0;
      const tb = dateB ? dateB.getTime() : 0;
      return ta - tb;
    });
  };

  return (
    <div className="fixed top-0 left-0 w-screen h-screen text-white flex flex-col overflow-hidden z-[1000]">
      <PageTitle onBack={onClose} title="PRÓXIMOS PARTIDOS">PRÓXIMOS PARTIDOS</PageTitle>

      <div className="flex-1 pt-[96px] px-4 pb-[100px] overflow-y-auto w-full box-border sm:pt-[96px] sm:px-4 sm:pb-[100px]">
        {loading ? (
          <div className="text-center py-[60px] px-5">
            <LoadingSpinner size="medium" />
          </div>
        ) : partidos.length === 0 ? (
          <div className="text-center py-[60px] px-5 mt-[70px]">
            <p className="text-[22px] font-bold mb-2 text-white text-center font-oswald">No tienes partidos próximos</p>
            <span className="text-[15px] opacity-95 block text-center text-white/80">Crea un partido o únete a uno para verlo aquí</span>
          </div>
        ) : (
          <>
            {/* Sorting controls removed: always sorted by proximity */}
            <div className="flex flex-col gap-[1px] w-full box-border">
              {getSortedPartidos().map((partido) => {
                const matchFinished = isMatchFinished(partido);
                const primaryCta = getPrimaryCta(partido);
                const showMenu = partido.userJoined || partido.userRole === 'admin';

                return (
                  <div key={partido.id} className={`relative bg-slate-900 rounded-2xl p-5 mb-3 min-h-[150px] border border-slate-800 transition-all duration-300 shadow-xl hover:-translate-y-[2px] hover:shadow-2xl hover:border-slate-700 sm:p-4 ${matchFinished ? '!opacity-100 !bg-slate-950 !border-slate-900' : ''}`}>
                    {/* Header: Fecha/Hora a la izquierda, Admin Badge a la derecha */}
                    <div className="flex justify-between items-start mb-4 sm:items-start">
                      <div className={`flex items-center gap-2 ${matchFinished ? 'opacity-70' : ''}`}>
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="20" height="20" fill="currentColor">
                          <path d="M224 64C206.3 64 192 78.3 192 96L192 128L160 128C124.7 128 96 156.7 96 192L96 240L544 240L544 192C544 156.7 515.3 128 480 128L448 128L448 96C448 78.3 433.7 64 416 64C398.3 64 384 78.3 384 96L384 128L256 128L256 96C256 78.3 241.7 64 224 64zM96 288L96 480C96 515.3 124.7 544 160 544L480 544C515.3 544 544 515.3 544 480L544 288L96 288z" />
                        </svg>
                        <div className="font-oswald text-[18px] font-bold text-white capitalize">
                          {formatDate(partido.fecha)} • {partido.hora}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {matchFinished ? (
                          <div className="bg-[#4CAF50] text-white px-2 py-1 rounded-xl text-[11px] font-semibold whitespace-nowrap flex items-center gap-1 shadow-sm opacity-100">
                            ✓ Finalizado
                          </div>
                        ) : partido.userRole === 'admin' ? (
                          <div className="flex items-center gap-1.5 bg-slate-700 px-2.5 py-1.5 rounded-full text-[11px] font-semibold shrink-0 border border-[#0EA9C6]">
                            <FaCrown size={12} color="#0EA9C6" style={{ marginRight: '2px' }} />
                            <span className="font-semibold uppercase text-[#0EA9C6]">Admin</span>
                          </div>
                        ) : null}

                        {showMenu && (
                          <div className="relative">
                            <button
                              className="p-2 rounded-full border border-slate-700 hover:border-slate-500 hover:bg-slate-800 text-slate-200"
                              onClick={(e) => {
                                e.stopPropagation();
                                setMenuOpenId((prev) => prev === partido.id ? null : partido.id);
                              }}
                              aria-label="Más acciones"
                            >
                              <MoreVertical size={16} />
                            </button>
                            {menuOpenId === partido.id && (
                              <div className="absolute right-0 mt-2 w-48 rounded-xl border border-slate-700 bg-slate-900 shadow-lg z-10">
                                <div className="py-1">
                                  {partido.userJoined && canAbandon(partido) && (
                                    <button
                                      className="w-full px-3 py-2 flex items-center gap-2 text-left text-slate-100 hover:bg-slate-800"
                                      onClick={(e) => handleAbandonMatch(e, partido)}
                                    >
                                      <LogOut size={16} />
                                      <span>Abandonar partido</span>
                                    </button>
                                  )}
                                  {partido.userRole === 'admin' && canCancel(partido) && (
                                    <button
                                      className="w-full px-3 py-2 flex items-center gap-2 text-left text-red-200 hover:bg-slate-800"
                                      onClick={(e) => handleCancelMatch(e, partido)}
                                    >
                                      <XCircle size={16} />
                                      <span>Cancelar partido</span>
                                    </button>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Modalidad, Tipo, Precio y Jugadores en una sola línea */}
                    <div className="flex flex-nowrap items-center gap-2 mb-4">
                      <div className={`font-oswald text-[11px] font-semibold text-white px-2.5 py-1.5 rounded-lg border border-transparent shrink-0 whitespace-nowrap ${getModalidadClass(partido.modalidad)} ${matchFinished ? 'opacity-70' : ''}`}> 
                        {partido.modalidad || 'F5'}
                      </div>
                      <div className={`font-oswald text-[11px] font-semibold text-white px-2.5 py-1.5 rounded-lg border border-transparent shrink-0 whitespace-nowrap ${getTipoClass(partido.tipo_partido)} ${matchFinished ? 'opacity-70' : ''}`}>
                        {partido.tipo_partido || 'Masculino'}
                      </div>
                      {(() => {
                        const precioRaw = (partido?.precio_cancha_por_persona ?? partido?.precio_cancha ?? partido?.precio ?? partido?.valor_cancha);
                        let precioNumber = null;
                        if (precioRaw !== undefined && precioRaw !== null && String(precioRaw).trim() !== '') {
                          const parsed = Number(String(precioRaw).replace(/[^0-9.,-]/g, '').replace(/,/g, '.'));
                          if (!Number.isNaN(parsed) && Number.isFinite(parsed)) precioNumber = parsed;
                        }
                        const label = (precioNumber !== null && precioNumber > 0)
                          ? new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(precioNumber)
                          : 'Sin precio';
                        return (
                          <div className={`font-oswald text-[11px] font-semibold text-slate-200 px-2.5 py-1.5 rounded-lg border border-slate-700 bg-slate-900 shrink-0 whitespace-nowrap ${matchFinished ? 'opacity-70' : ''}`}>
                            {label}
                          </div>
                        );
                      })()}
                      {(() => {
                        const jugadoresCount = partido.jugadores?.[0]?.count || 0;
                        const cupoMaximo = partido.cupo_jugadores || 20;
                        const isComplete = jugadoresCount >= cupoMaximo;
                        return (
                          <div className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold shrink-0 whitespace-nowrap ${
                            isComplete 
                              ? 'bg-[#165a2e] text-[#22c55e] border border-[#22c55e]' 
                              : 'bg-slate-900 text-slate-300 border border-slate-700'
                          } ${matchFinished ? 'opacity-70' : ''}`}>
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="12" height="12" fill="currentColor">
                              <path d="M320 312C386.3 312 440 258.3 440 192C440 125.7 386.3 72 320 72C253.7 72 200 125.7 200 192C200 258.3 253.7 312 320 312zM290.3 368C191.8 368 112 447.8 112 546.3C112 562.7 125.3 576 141.7 576L498.3 576C514.7 576 528 562.7 528 546.3C528 447.8 448.2 368 349.7 368L290.3 368z" />
                            </svg>
                            {jugadoresCount}/{cupoMaximo} jugadores
                          </div>
                        );
                      })()}
                    </div>

                    {/* Ubicación */}
                    <div className={`font-oswald text-sm font-medium text-white/90 flex items-center gap-2 mb-5 overflow-hidden text-ellipsis ${matchFinished ? 'opacity-70' : ''}`}>
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512" width="16" height="16" fill="rgba(255, 255, 255, 0.9)">
                        <path d="M0 188.6C0 84.4 86 0 192 0S384 84.4 384 188.6c0 119.3-120.2 262.3-170.4 316.8-11.8 12.8-31.5 12.8-43.3 0-50.2-54.5-170.4-197.5-170.4-316.8zM192 256a64 64 0 1 0 0-128 64 64 0 1 0 0 128z" />
                      </svg>
                      <span className="truncate">{partido.sede}</span>
                    </div>

                    <div className="flex gap-3 mt-4">
                      <button
                        className={`flex-1 font-bebas text-base px-4 py-2.5 border-2 border-transparent rounded-xl cursor-pointer transition-all text-white min-h-[44px] flex items-center justify-center text-center sm:text-[13px] sm:px-3 sm:py-2 sm:min-h-[36px] ${primaryCta.disabled ? 'bg-slate-700 text-slate-300 cursor-not-allowed' : 'bg-primary shadow-lg hover:brightness-110 hover:-translate-y-px'} disabled:opacity-60`}
                        onClick={(e) => {
                          if (primaryCta.disabled) return;
                          if (primaryCta.kind === 'survey') return handleSurveyClick(e, partido);
                          return handleMatchClick(partido);
                        }}
                        disabled={primaryCta.disabled}
                        aria-disabled={primaryCta.disabled}
                      >
                        {primaryCta.label}
                      </button>

                      {matchFinished && (
                        <button
                          className="font-bebas text-base px-4 py-2.5 border border-slate-700 rounded-xl cursor-pointer transition-all text-slate-200 min-h-[44px] flex items-center justify-center text-center sm:text-[13px] sm:px-3 sm:py-2 sm:min-h-[36px] bg-slate-900 hover:bg-slate-800 hover:text-white flex-none"
                          onClick={(e) => handleClearMatch(e, partido)}
                          disabled={processingClearId === partido.id}
                          aria-disabled={processingClearId === partido.id}
                        >
                          {processingClearId === partido.id ? 'LIMPIANDO…' : 'Limpiar'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      <ConfirmModal
        isOpen={showConfirm}
        title={actionType === 'cancel' ? 'Cancelar partido' : actionType === 'abandon' ? 'Abandonar partido' : 'CONFIRMAR LIMPIEZA'}
        message={actionType === 'cancel'
          ? 'Esto cancelará el partido para todos los jugadores.'
          : actionType === 'abandon'
            ? 'Vas a dejar tu lugar en este partido. Esta acción no elimina el partido para los demás.'
            : '¿Estás seguro que querés limpiar este partido sin llenar la encuesta?'}
        onConfirm={handleConfirmAction}
        onCancel={() => { if (isProcessing) return; setShowConfirm(false); setActionType(null); setPartidoTarget(null); }}
        confirmText={actionType === 'cancel' ? 'Cancelar partido' : actionType === 'abandon' ? 'Abandonar' : 'LIMPIAR'}
        cancelText='CANCELAR'
        isDeleting={isProcessing}
      />
    </div>
  );
};

export default ProximosPartidos;