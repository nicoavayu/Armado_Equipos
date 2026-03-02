import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import CountUp from 'react-countup';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid } from 'recharts';
import { notifyBlockingError } from 'utils/notifyBlockingError';
import { getPointsEfficiencySummary } from 'utils/statsSummary';
import {
  Activity,
  AlertCircle,
  CalendarDays,
  CircleAlert,
  ClipboardPlus,
  Dribbble,
  Hand,
  Handshake,
  History,
  Medal,
  Minus,
  ShieldAlert,
  Sparkles,
  Star,
  TrendingDown,
  TrendingUp,
  Trophy,
  UserCheck,
} from 'lucide-react';
import { supabase } from '../supabase';
import { useAuth } from './AuthProvider';
import LoadingSpinner from './LoadingSpinner';
import PageTitle from './PageTitle';
import ManualMatchModal from './ManualMatchModal';
import InjuryModal from './InjuryModal';

const StatsView = ({ onVolver }) => {
  const { user } = useAuth();
  const [period, setPeriod] = useState('year');
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth());
  const [selectedWeek, setSelectedWeek] = useState(Math.floor((new Date().getDate() - 1) / 7));
  const [showYearDropdown, setShowYearDropdown] = useState(false);
  const [showMonthDropdown, setShowMonthDropdown] = useState(false);
  const [showWeekDropdown, setShowWeekDropdown] = useState(false);
  const [showManualMatchModal, setShowManualMatchModal] = useState(false);
  const [showInjuryModal, setShowInjuryModal] = useState(false);
  const [showLesionesDetalle, setShowLesionesDetalle] = useState(false);
  const periodSelectorRef = useRef(null);
  const [stats, setStats] = useState({
    partidosJugados: 0,
    amigosDistintos: 0,
    promedioRating: 0,
    chartData: [],
    topAmigos: [],
    topFriend: null,
    recordPersonal: null,
    logros: { annual: [], historical: [] },
    partidosManuales: 0,
    manualGanados: 0,
    manualEmpates: 0,
    manualPerdidos: 0,
    recapRecientes: [],
    encuestaGanados: 0,
    encuestaEmpates: 0,
    encuestaPerdidos: 0,
    encuestaPendientes: 0,
    encuestaSinEquipoDetectado: 0,
    amistosos: 0,
    torneos: 0,
    lesionesPeriodo: 0,
    lesionesDetallePeriodo: [],
    lesionActiva: null,
    ultimaLesion: null,
    asistencia: {
      partidosConEncuesta: 0,
      partidosSinEncuesta: 0,
      asistenciasConfirmadas: 0,
      faltasConfirmadas: 0,
      asistenciaPct: 0,
      sancionesPeriodo: 0,
      recuperacionesPeriodo: 0,
      deudaPendiente: 0,
      streakRecuperacion: 0,
    },
    resultadosEfectivos: {
      cerrados: 0,
      pendientes: 0,
      winRate: 0,
      winDrawRate: 0,
      puntos: 0,
      puntosPct: 0,
    },
    rankingTimeline: {
      rankingActual: null,
      balancePeriodo: 0,
      movimientos: [],
    },
    consistencia: {
      totalPeriodo: 0,
      totalPeriodoAnterior: 0,
      variacion: 0,
      variacionPct: 0,
      tendencia: 'igual',
      mesesActivos: 0,
      promedioMensual: 0,
      mejorMesLabel: '-',
      mejorMesTotal: 0,
      rachaMeses: 0,
      distribucionMensual: [],
    },
  });
  const [loading, setLoading] = useState(true);

  const getDefaultExtendedStats = () => ({
    asistencia: {
      partidosConEncuesta: 0,
      partidosSinEncuesta: 0,
      asistenciasConfirmadas: 0,
      faltasConfirmadas: 0,
      asistenciaPct: 0,
      sancionesPeriodo: 0,
      recuperacionesPeriodo: 0,
      deudaPendiente: 0,
      streakRecuperacion: 0,
    },
    resultadosEfectivos: {
      cerrados: 0,
      pendientes: 0,
      winRate: 0,
      winDrawRate: 0,
      puntos: 0,
      puntosPct: 0,
    },
    rankingTimeline: {
      rankingActual: null,
      balancePeriodo: 0,
      movimientos: [],
    },
    consistencia: {
      totalPeriodo: 0,
      totalPeriodoAnterior: 0,
      variacion: 0,
      variacionPct: 0,
      tendencia: 'igual',
      mesesActivos: 0,
      promedioMensual: 0,
      mejorMesLabel: '-',
      mejorMesTotal: 0,
      rachaMeses: 0,
      distribucionMensual: [],
    },
  });

  const normalizeIdentity = (value) => String(value || '').trim().toLowerCase();
  const isUuid = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
  const getUserIdentitySet = () => {
    const refs = [
      user?.id,
      user?.email,
      user?.user_metadata?.email,
      user?.user_metadata?.name,
      user?.user_metadata?.full_name,
    ]
      .map(normalizeIdentity)
      .filter(Boolean);
    return new Set(refs);
  };
  const getPlayerIdentityCandidates = (jugador) => {
    if (!jugador) return [];
    return [
      jugador.usuario_id,
      jugador.user_id,
      jugador.uuid,
      jugador.id,
      jugador.auth_id,
      jugador.email,
      jugador.nombre,
    ]
      .map(normalizeIdentity)
      .filter(Boolean);
  };
  const isCurrentUserPlayer = (jugador) => {
    const userRefs = getUserIdentitySet();
    const candidates = getPlayerIdentityCandidates(jugador);
    return candidates.some((c) => userRefs.has(c));
  };

  useEffect(() => {
    if (user) {
      loadStats();
    }
  }, [user, period, selectedYear, selectedMonth, selectedWeek]);

  useEffect(() => {
    const hasOpenDropdown = showWeekDropdown || showMonthDropdown || showYearDropdown;
    if (!hasOpenDropdown) return undefined;

    const handleOutsidePointer = (event) => {
      if (!periodSelectorRef.current) return;
      if (periodSelectorRef.current.contains(event.target)) return;
      setShowWeekDropdown(false);
      setShowMonthDropdown(false);
      setShowYearDropdown(false);
    };

    document.addEventListener('mousedown', handleOutsidePointer);
    document.addEventListener('touchstart', handleOutsidePointer, { passive: true });

    return () => {
      document.removeEventListener('mousedown', handleOutsidePointer);
      document.removeEventListener('touchstart', handleOutsidePointer);
    };
  }, [showWeekDropdown, showMonthDropdown, showYearDropdown]);

  const loadStats = async () => {
    setLoading(true);
    try {
      const dateRange = getDateRange(period);
      const [partidosData, amigosData, partidosManualesData, lesionesData] = await Promise.all([
        getPartidosStats(dateRange),
        getAmigosStats(dateRange),
        getPartidosManualesStats(dateRange),
        getLesionesStats(),
      ]);
      let extendedStats = getDefaultExtendedStats();
      try {
        extendedStats = await getExtendedStats({
          dateRange,
          partidosData,
          partidosManualesData,
        });
      } catch (extendedError) {
        console.warn('[STATS] No se pudieron cargar métricas extendidas, usando fallback.', extendedError);
      }

      const recapRecientes = [
        ...(partidosData.surveyOutcomes.recientes || []),
        ...(partidosManualesData.recientes || []),
      ]
        .sort((a, b) => Number(b?.ts || 0) - Number(a?.ts || 0))
        .slice(0, 5);

      setStats({
        partidosJugados: partidosData.total + partidosManualesData.total,
        amigosDistintos: amigosData.distintos,
        promedioRating: partidosData.promedioRating,
        chartData: mergeChartData(partidosData.chartData, partidosManualesData.chartData),
        topAmigos: amigosData.top5,
        topFriend: amigosData.top5[0] || null,
        recordPersonal: partidosData.record,
        logros: partidosData.logros,
        partidosManuales: partidosManualesData.total,
        manualGanados: partidosManualesData.ganados,
        manualEmpates: partidosManualesData.empatados,
        manualPerdidos: partidosManualesData.perdidos,
        recapRecientes,
        encuestaGanados: partidosData.surveyOutcomes.ganados,
        encuestaEmpates: partidosData.surveyOutcomes.empatados,
        encuestaPerdidos: partidosData.surveyOutcomes.perdidos,
        encuestaPendientes: partidosData.surveyOutcomes.pendientes,
        encuestaSinEquipoDetectado: partidosData.surveyOutcomes.sinEquipoDetectado,
        amistosos: partidosData.total + partidosManualesData.amistosos,
        torneos: partidosManualesData.torneos,
        lesionesPeriodo: lesionesData.enPeriodoCount,
        lesionesDetallePeriodo: lesionesData.enPeriodoDetalle,
        lesionActiva: lesionesData.activa,
        ultimaLesion: lesionesData.ultima,
        asistencia: extendedStats.asistencia,
        resultadosEfectivos: extendedStats.resultadosEfectivos,
        rankingTimeline: extendedStats.rankingTimeline,
        consistencia: extendedStats.consistencia,
      });
    } catch (error) {
      console.error('Error loading stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const getDateRange = (period) => {
    let start, end;

    switch (period) {
      case 'week': {
        const weekStartDay = selectedWeek * 7 + 1;
        const weekEndDay = Math.min(weekStartDay + 6, new Date(selectedYear, selectedMonth + 1, 0).getDate());
        start = new Date(selectedYear, selectedMonth, weekStartDay);
        end = new Date(selectedYear, selectedMonth, weekEndDay);
        break;
      }
      case 'month':
        start = new Date(selectedYear, selectedMonth, 1);
        end = new Date(selectedYear, selectedMonth + 1, 0);
        break;
      case 'year':
      default:
        start = new Date(selectedYear, 0, 1);
        end = new Date(selectedYear, 11, 31);
        break;
    }

    return { start: start.toISOString(), end: end.toISOString() };
  };

  const getPartidosStats = async (dateRange) => {
    const { data: partidos, error } = await supabase
      .from('partidos_view')
      .select('*')
      .gte('fecha', dateRange.start.split('T')[0])
      .lte('fecha', dateRange.end.split('T')[0])
      .eq('estado', 'finalizado');

    if (error) throw error;

    const userPartidos = partidos.filter((partido) =>
      partido.jugadores?.some((j) => isCurrentUserPlayer(j)),
    );

    const ratings = userPartidos.map((p) => {
      const userPlayer = p.jugadores?.find((j) => isCurrentUserPlayer(j));
      return userPlayer?.score || 5;
    });
    const promedioRating = ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0;

    const chartData = generateChartData(userPartidos, period);
    const logros = await calculateLogros(partidos);
    const surveyOutcomes = await getSurveyOutcomeStats(userPartidos);

    return {
      total: userPartidos.length,
      promedioRating: promedioRating,
      chartData,
      record: userPartidos.length,
      logros,
      surveyOutcomes,
      partidos: userPartidos,
    };
  };

  const normalizeTeamEntry = (entry) => {
    if (entry && typeof entry === 'object') {
      return normalizeIdentity(entry.ref || entry.uuid || entry.usuario_id || entry.id || '');
    }
    return normalizeIdentity(entry);
  };

  const normalizeSurveyWinner = (value) => {
    const token = normalizeIdentity(value);
    if (!token) return null;
    if (token === 'equipo_a' || token === 'a' || token === 'team_a') return 'equipo_a';
    if (token === 'equipo_b' || token === 'b' || token === 'team_b') return 'equipo_b';
    if (token === 'empate' || token === 'draw') return 'empate';
    return null;
  };

  const normalizeSurveyResultStatus = (value) => {
    const token = normalizeIdentity(value);
    if (!token) return null;
    if (token === 'finished' || token === 'played') return 'finished';
    if (token === 'draw' || token === 'empate') return 'draw';
    if (token === 'not_played' || token === 'cancelled' || token === 'cancelado') return 'not_played';
    if (token === 'pending' || token === 'pendiente') return 'pending';
    return null;
  };

  const resolveUserTeam = ({ participants, teamA, teamB }) => {
    const teamARefs = new Set((Array.isArray(teamA) ? teamA : []).map(normalizeTeamEntry).filter(Boolean));
    const teamBRefs = new Set((Array.isArray(teamB) ? teamB : []).map(normalizeTeamEntry).filter(Boolean));
    if (teamARefs.size === 0 && teamBRefs.size === 0) return null;

    const userRefs = getUserIdentitySet();
    const candidateRefs = new Set([...userRefs]);

    (Array.isArray(participants) ? participants : []).forEach((p) => {
      const refs = [
        p?.ref,
        p?.uuid,
        p?.usuario_id,
        p?.id,
        p?.email,
        p?.nombre,
      ]
        .map(normalizeIdentity)
        .filter(Boolean);

      if (refs.some((ref) => userRefs.has(ref))) {
        refs.forEach((ref) => candidateRefs.add(ref));
      }
    });

    const isInTeamA = [...candidateRefs].some((ref) => teamARefs.has(ref));
    if (isInTeamA) return 'equipo_a';
    const isInTeamB = [...candidateRefs].some((ref) => teamBRefs.has(ref));
    if (isInTeamB) return 'equipo_b';
    return null;
  };

  const getSurveyOutcomeStats = async (userPartidos = []) => {
    const matchIds = userPartidos
      .map((p) => Number(p?.id))
      .filter((id) => Number.isFinite(id));

    const empty = {
      ganados: 0,
      empatados: 0,
      perdidos: 0,
      pendientes: 0,
      sinEquipoDetectado: 0,
      recientes: [],
    };

    if (matchIds.length === 0) return empty;

    let surveyRows = [];
    try {
      let query = await supabase
        .from('survey_results')
        .select('partido_id, winner_team, result_status, snapshot_equipos, snapshot_participantes')
        .in('partido_id', matchIds);

      if (query.error) {
        // Backward-compatible fallback for environments without snapshot columns.
        query = await supabase
          .from('survey_results')
          .select('partido_id, winner_team, result_status')
          .in('partido_id', matchIds);
      }

      if (query.error) throw query.error;
      surveyRows = query.data || [];
    } catch (error) {
      console.warn('[STATS] No se pudieron cargar resultados de encuesta para recap', error);
      return empty;
    }

    let teamRows = [];
    try {
      const teamsRes = await supabase
        .from('partido_team_confirmations')
        .select('partido_id, participants, team_a, team_b')
        .in('partido_id', matchIds);
      if (!teamsRes.error) {
        teamRows = teamsRes.data || [];
      }
    } catch (_error) {
      // Non-blocking fallback.
    }

    let finalTeamsRows = [];
    try {
      const finalTeamsRes = await supabase
        .from('partidos')
        .select('id, final_team_a, final_team_b')
        .in('id', matchIds);
      if (!finalTeamsRes.error) {
        finalTeamsRows = finalTeamsRes.data || [];
      }
    } catch (_error) {
      // Non-blocking fallback.
    }

    const bySurvey = new Map((surveyRows || []).map((row) => [Number(row.partido_id), row]));
    const byTeams = new Map((teamRows || []).map((row) => [Number(row.partido_id), row]));
    const byFinalTeams = new Map((finalTeamsRows || []).map((row) => [Number(row.id), row]));
    const byMatch = new Map((userPartidos || []).map((p) => [Number(p.id), p]));

    let ganados = 0;
    let empatados = 0;
    let perdidos = 0;
    let pendientes = 0;
    let sinEquipoDetectado = 0;
    const recientes = [];

    matchIds.forEach((matchId) => {
      const survey = bySurvey.get(matchId);
      const teamConfirm = byTeams.get(matchId);
      const finalTeams = byFinalTeams.get(matchId);
      const match = byMatch.get(matchId);
      const ts = match?.fecha
        ? new Date(`${match.fecha}T${String(match?.hora || '00:00').slice(0, 5)}`).getTime()
        : 0;
      const baseRecap = {
        id: `survey-${matchId}`,
        ts: Number.isFinite(ts) ? ts : 0,
        fecha: match?.fecha || null,
        tipoLabel: match?.tipo_partido || match?.modalidad || 'Partido',
        nombre: match?.nombre || 'Partido',
        source: 'encuesta',
      };

      const resultStatus = normalizeSurveyResultStatus(survey?.result_status);
      const winner = normalizeSurveyWinner(survey?.winner_team);
      const hasWinner = winner === 'equipo_a' || winner === 'equipo_b' || winner === 'empate';

      if (resultStatus === 'not_played') {
        return;
      }

      const snapshotTeams = survey?.snapshot_equipos || null;
      const participants = Array.isArray(survey?.snapshot_participantes)
        ? survey.snapshot_participantes
        : (Array.isArray(teamConfirm?.participants) ? teamConfirm.participants : []);
      const teamA = Array.isArray(snapshotTeams?.team_a)
        ? snapshotTeams.team_a
        : (Array.isArray(finalTeams?.final_team_a) ? finalTeams.final_team_a : (Array.isArray(teamConfirm?.team_a) ? teamConfirm.team_a : []));
      const teamB = Array.isArray(snapshotTeams?.team_b)
        ? snapshotTeams.team_b
        : (Array.isArray(finalTeams?.final_team_b) ? finalTeams.final_team_b : (Array.isArray(teamConfirm?.team_b) ? teamConfirm.team_b : []));

      if (resultStatus === 'pending' || (!resultStatus && !hasWinner)) {
        pendientes += 1;
        recientes.push({ ...baseRecap, resultKey: 'pendiente', label: 'Pendiente' });
        return;
      }

      if (resultStatus === 'draw' || winner === 'empate') {
        empatados += 1;
        recientes.push({ ...baseRecap, resultKey: 'empate', label: 'Empate' });
        return;
      }

      if (!hasWinner) {
        pendientes += 1;
        recientes.push({ ...baseRecap, resultKey: 'pendiente', label: 'Pendiente' });
        return;
      }

      const userTeam = resolveUserTeam({ participants, teamA, teamB });
      if (!userTeam) {
        sinEquipoDetectado += 1;
        recientes.push({ ...baseRecap, resultKey: 'sin_equipo', label: 'Sin equipo detectado' });
        return;
      }

      if (winner === userTeam) {
        ganados += 1;
        recientes.push({ ...baseRecap, resultKey: 'ganaste', label: 'Ganaste' });
      } else {
        perdidos += 1;
        recientes.push({ ...baseRecap, resultKey: 'perdiste', label: 'Perdiste' });
      }
    });

    return { ganados, empatados, perdidos, pendientes, sinEquipoDetectado, recientes };
  };

  const getAmigosStats = async (dateRange) => {
    const { data: partidos, error } = await supabase
      .from('partidos_view')
      .select('*')
      .gte('fecha', dateRange.start.split('T')[0])
      .lte('fecha', dateRange.end.split('T')[0])
      .eq('estado', 'finalizado');

    if (error) throw error;

    const userPartidos = partidos.filter((partido) =>
      partido.jugadores?.some((j) => isCurrentUserPlayer(j)),
    );

    const amigosCount = {};
    const amigosInfo = {};

    userPartidos.forEach((partido) => {
      partido.jugadores?.forEach((jugador) => {
        if (!isCurrentUserPlayer(jugador)) {
          const key = jugador.usuario_id || jugador.uuid || jugador.id || jugador.nombre;
          amigosCount[key] = (amigosCount[key] || 0) + 1;
          if (!amigosInfo[key]) {
            amigosInfo[key] = {
              nombre: jugador.nombre || key,
              avatar: jugador.foto_url || '/profile.svg',
              userId: jugador.usuario_id || jugador.uuid || null,
            };
          }
        }
      });
    });

    const userIds = [...new Set(Object.values(amigosInfo).map((a) => a.userId).filter((id) => isUuid(id)))];
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from('usuarios')
        .select('id, nombre, avatar_url, lesion_activa')
        .in('id', userIds);

      profiles?.forEach((profile) => {
        Object.keys(amigosInfo).forEach((key) => {
          if (amigosInfo[key]?.userId === profile.id) {
            amigosInfo[key].nombre = profile.nombre;
            amigosInfo[key].avatar = profile.avatar_url || '/profile.svg';
            amigosInfo[key].lesion_activa = profile.lesion_activa;
          }
        });
      });
    }

    const topAmigos = Object.entries(amigosCount)
      .map(([key, count]) => ({
        ...amigosInfo[key],
        partidos: count,
        color: getAvatarColor(amigosInfo[key].nombre),
      }))
      .sort((a, b) => b.partidos - a.partidos)
      .slice(0, 5);

    return {
      distintos: Object.keys(amigosCount).length,
      top5: topAmigos,
    };
  };

  const calculateLogros = async (allPartidos) => {
    const userPartidos = allPartidos.filter((partido) =>
      partido.jugadores?.some((j) => isCurrentUserPlayer(j)),
    );

    const annualLogros = [];
    const historicalLogros = [];

    // Obtener total histórico de todos los partidos
    const [{ data: todosPartidos }, { data: partidosManualesHistoricos }] = await Promise.all([
      supabase.from('partidos_view').select('id, jugadores').eq('estado', 'finalizado'),
      supabase.from('partidos_manuales').select('*').eq('usuario_id', user.id),
    ]);

    const totalPartidosNormales = todosPartidos?.filter((partido) =>
      partido.jugadores?.some((j) => isCurrentUserPlayer(j)),
    ).length || 0;

    const totalPartidosManuales = partidosManualesHistoricos?.length || 0;
    const totalHistorico = totalPartidosNormales + totalPartidosManuales;

    // Obtener premios del año seleccionado
    const yearStart = new Date(selectedYear, 0, 1).toISOString().split('T')[0];
    const yearEnd = new Date(selectedYear, 11, 31).toISOString().split('T')[0];

    const { data: surveys } = await supabase
      .from('post_match_surveys')
      .select('*')
      .gte('created_at', yearStart)
      .lte('created_at', yearEnd);

    // Contar MVPs
    const mvpCount = surveys?.filter((survey) =>
      survey.mejor_jugador === user.id || survey.mejor_jugador === user.email,
    ).length || 0;

    // Contar Guantes Dorados
    const guanteDoradoCount = surveys?.filter((survey) =>
      survey.guante_dorado === user.id || survey.guante_dorado === user.email,
    ).length || 0;

    // Contar Tarjetas Rojas
    const tarjetaRojaCount = surveys?.filter((survey) =>
      survey.tarjeta_roja === user.id || survey.tarjeta_roja === user.email,
    ).length || 0;

    // Mejor mes (siempre mostrar un mes, incluso con 0 partidos)
    const now = new Date();
    const preferredMonthIndex = selectedYear === now.getFullYear() ? now.getMonth() : 0;
    const monthBuckets = Array.from({ length: 12 }, (_, monthIndex) => ({
      monthIndex,
      label: new Date(selectedYear, monthIndex, 1).toLocaleDateString('es-ES', { year: 'numeric', month: 'long' }),
      count: 0,
    }));

    userPartidos.forEach((partido) => {
      const date = new Date(partido.fecha);
      if (Number.isNaN(date.getTime())) return;
      if (date.getFullYear() !== selectedYear) return;
      const monthIndex = date.getMonth();
      if (monthIndex >= 0 && monthIndex <= 11) {
        monthBuckets[monthIndex].count += 1;
      }
    });

    let mejorMes = monthBuckets[preferredMonthIndex];
    monthBuckets.forEach((bucket) => {
      if (bucket.count > mejorMes.count) {
        mejorMes = bucket;
      }
    });

    annualLogros.push({
      titulo: 'Mejor Mes',
      valor: `${mejorMes.count} partidos`,
      detalle: mejorMes.label,
      icono: 'Trophy',
    });

    // Mejor rating (siempre mostrar)
    let mejorRating = 0;
    if (userPartidos.length > 0) {
      const ratings = userPartidos.map((p) => {
        const userPlayer = p.jugadores?.find((j) => isCurrentUserPlayer(j));
        return userPlayer?.score || 5;
      });
      mejorRating = Math.max(...ratings);
    }

    annualLogros.push({
      titulo: 'Mejor Rating',
      valor: mejorRating > 0 ? mejorRating.toFixed(1) : '0.0',
      detalle: mejorRating > 0 ? 'En un partido' : 'Sin partidos aún',
      icono: 'Star',
    });

    // MVP (siempre mostrar)
    annualLogros.push({
      titulo: 'MVP del Partido',
      valor: `${mvpCount} ${mvpCount === 1 ? 'vez' : 'veces'}`,
      detalle: `En ${selectedYear}`,
      icono: 'Medal',
    });

    // Guante Dorado (siempre mostrar)
    annualLogros.push({
      titulo: 'Guante Dorado',
      valor: `${guanteDoradoCount} ${guanteDoradoCount === 1 ? 'vez' : 'veces'}`,
      detalle: `En ${selectedYear}`,
      icono: 'Hand',
    });

    // Tarjeta Roja (siempre mostrar)
    annualLogros.push({
      titulo: 'Tarjeta Roja',
      valor: `${tarjetaRojaCount} ${tarjetaRojaCount === 1 ? 'vez' : 'veces'}`,
      detalle: `En ${selectedYear}`,
      icono: 'ShieldAlert',
    });

    // Total Histórico (siempre mostrar)
    historicalLogros.push({
      titulo: 'Total Histórico',
      valor: `${totalHistorico} partidos`,
      detalle: 'Desde el inicio',
      icono: 'Activity',
    });

    return { annual: annualLogros, historical: historicalLogros };
  };

  const getAvatarColor = (nombre) => {
    const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9'];
    let hash = 0;
    for (let i = 0; i < (nombre || '').length; i++) {
      hash = (nombre || '').charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  };

  const getInitials = (nombre) => {
    if (!nombre) return '?';
    return nombre.split(' ').map((word) => word.charAt(0)).join('').toUpperCase().slice(0, 2);
  };

  const getPartidosManualesStats = async (dateRange) => {
    const { data: partidosManuales, error } = await supabase
      .from('partidos_manuales')
      .select('*')
      .eq('usuario_id', user.id)
      .gte('fecha', dateRange.start.split('T')[0])
      .lte('fecha', dateRange.end.split('T')[0]);

    if (error) throw error;

    const amistosos = partidosManuales?.filter((p) => p.tipo_partido === 'amistoso').length || 0;
    const torneos = partidosManuales?.filter((p) => p.tipo_partido === 'torneo').length || 0;
    const ganados = partidosManuales?.filter((p) => p.resultado === 'ganaste').length || 0;
    const empatados = partidosManuales?.filter((p) => p.resultado === 'empate').length || 0;
    const perdidos = partidosManuales?.filter((p) => p.resultado === 'perdiste').length || 0;
    const recientes = [...(partidosManuales || [])]
      .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())
      .slice(0, 5)
      .map((p) => {
        const ts = p?.fecha ? new Date(`${p.fecha}T00:00:00`).getTime() : 0;
        const tipoLabel = p?.tipo_partido === 'torneo' ? 'Torneo' : 'Amistoso';
        const resultKey = p?.resultado || 'sin_dato';
        let label = 'Sin dato';
        if (resultKey === 'ganaste') label = 'Ganaste';
        if (resultKey === 'empate') label = 'Empate';
        if (resultKey === 'perdiste') label = 'Perdiste';

        return {
          id: `manual-${p.id}`,
          ts: Number.isFinite(ts) ? ts : 0,
          fecha: p?.fecha || null,
          tipoLabel,
          nombre: 'Partido manual',
          source: 'manual',
          resultKey,
          label,
        };
      });
    const chartData = generateChartData(partidosManuales || [], period, true);

    return {
      total: partidosManuales?.length || 0,
      amistosos,
      torneos,
      ganados,
      empatados,
      perdidos,
      recientes,
      chartData,
      partidos: partidosManuales || [],
    };
  };

  const getLesionesStats = async () => {
    const { data: lesiones, error } = await supabase
      .from('lesiones')
      .select('*')
      .eq('usuario_id', user.id)
      .order('fecha_inicio', { ascending: false });

    if (error) throw error;

    const lesionActiva = lesiones?.find((l) => !l.fecha_fin);
    const ultimaLesion = lesiones?.find((l) => l.fecha_fin) || lesiones?.[0];
    const dateRange = getDateRange(period);
    const start = dateRange.start.split('T')[0];
    const end = dateRange.end.split('T')[0];
    const enPeriodo = (lesiones || []).filter((l) => l?.fecha_inicio && l.fecha_inicio >= start && l.fecha_inicio <= end);

    return {
      activa: lesionActiva,
      ultima: ultimaLesion,
      enPeriodoCount: enPeriodo.length,
      enPeriodoDetalle: enPeriodo.map((l) => ({
        id: l.id,
        tipo_lesion: l.tipo_lesion,
        fecha_inicio: l.fecha_inicio,
        fecha_fin: l.fecha_fin,
      })),
    };
  };

  const toDateOnly = (isoOrDate) => String(isoOrDate || '').split('T')[0];

  const toPlayerIdNumber = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const isMatchPlayedFromSurveys = (surveys = []) => {
    if (!Array.isArray(surveys) || surveys.length === 0) return false;
    const playedVotes = surveys.filter((survey) => survey?.se_jugo === true).length;
    const notPlayedVotes = surveys.filter((survey) => survey?.se_jugo === false).length;
    if (playedVotes === 0 && notPlayedVotes > 0) return false;
    return true;
  };

  const buildAbsentConfirmMap = (surveys = []) => {
    const confirmMap = new Map();

    (surveys || []).forEach((survey) => {
      if (survey?.se_jugo === false) return;
      const voterId = survey?.votante_id;
      const absents = Array.isArray(survey?.jugadores_ausentes) ? survey.jugadores_ausentes : [];
      if (!voterId || absents.length === 0) return;

      absents.forEach((absentRaw) => {
        const absentId = toPlayerIdNumber(absentRaw);
        if (!absentId) return;
        if (String(voterId) === String(absentRaw) || String(voterId) === String(absentId)) return;

        const votersSet = confirmMap.get(absentId) || new Set();
        votersSet.add(String(voterId));
        confirmMap.set(absentId, votersSet);
      });
    });

    return confirmMap;
  };

  const getPreviousDateRange = (dateRange) => {
    const start = new Date(dateRange.start);

    if (period === 'year') {
      const prevYear = selectedYear - 1;
      return {
        start: `${prevYear}-01-01`,
        end: `${prevYear}-12-31`,
      };
    }

    if (period === 'month') {
      const prevMonthDate = new Date(selectedYear, selectedMonth - 1, 1);
      const y = prevMonthDate.getFullYear();
      const m = prevMonthDate.getMonth();
      const monthStart = new Date(y, m, 1);
      const monthEnd = new Date(y, m + 1, 0);
      return {
        start: monthStart.toISOString().split('T')[0],
        end: monthEnd.toISOString().split('T')[0],
      };
    }

    // week: ventana de 7 días anterior
    const prevEnd = new Date(start);
    prevEnd.setDate(prevEnd.getDate() - 1);
    const prevStart = new Date(prevEnd);
    prevStart.setDate(prevStart.getDate() - 6);
    return {
      start: prevStart.toISOString().split('T')[0],
      end: prevEnd.toISOString().split('T')[0],
    };
  };

  const getUserMatchesForRange = async ({ start, end }) => {
    const [realRes, manualRes] = await Promise.all([
      supabase
        .from('partidos_view')
        .select('*')
        .gte('fecha', start)
        .lte('fecha', end)
        .eq('estado', 'finalizado'),
      supabase
        .from('partidos_manuales')
        .select('*')
        .eq('usuario_id', user.id)
        .gte('fecha', start)
        .lte('fecha', end),
    ]);

    if (realRes.error) throw realRes.error;
    if (manualRes.error) throw manualRes.error;

    const userRealMatches = (realRes.data || []).filter((partido) =>
      partido.jugadores?.some((j) => isCurrentUserPlayer(j)),
    );

    return {
      real: userRealMatches,
      manual: manualRes.data || [],
      total: userRealMatches.length + (manualRes.data?.length || 0),
    };
  };

  const getAttendanceStats = async (userPartidos = []) => {
    const matchIds = (userPartidos || []).map((p) => Number(p?.id)).filter((id) => Number.isFinite(id));
    if (matchIds.length === 0) {
      return {
        partidosConEncuesta: 0,
        partidosSinEncuesta: 0,
        asistenciasConfirmadas: 0,
        faltasConfirmadas: 0,
        asistenciaPct: 0,
      };
    }

    const { data: surveysRows, error: surveysErr } = await supabase
      .from('post_match_surveys')
      .select('partido_id, votante_id, se_jugo, jugadores_ausentes')
      .in('partido_id', matchIds);

    if (surveysErr) throw surveysErr;

    const surveysByMatch = new Map();
    (surveysRows || []).forEach((row) => {
      const id = Number(row?.partido_id);
      if (!Number.isFinite(id)) return;
      const list = surveysByMatch.get(id) || [];
      list.push(row);
      surveysByMatch.set(id, list);
    });

    const userPlayerByMatch = new Map();
    (userPartidos || []).forEach((match) => {
      const player = (match?.jugadores || []).find((j) => isCurrentUserPlayer(j));
      const playerId = Number(player?.id);
      if (Number.isFinite(playerId)) {
        userPlayerByMatch.set(Number(match.id), playerId);
      }
    });

    let partidosConEncuesta = 0;
    let faltasConfirmadas = 0;
    let partidosSinEncuesta = 0;

    matchIds.forEach((matchId) => {
      const rows = surveysByMatch.get(matchId) || [];
      if (rows.length === 0) {
        partidosSinEncuesta += 1;
        return;
      }

      if (!isMatchPlayedFromSurveys(rows)) return;
      partidosConEncuesta += 1;

      const userPlayerId = userPlayerByMatch.get(matchId);
      if (!Number.isFinite(userPlayerId)) return;

      const confirmMap = buildAbsentConfirmMap(rows);
      const confirmations = (confirmMap.get(userPlayerId) || new Set()).size;
      if (confirmations >= 2) {
        faltasConfirmadas += 1;
      }
    });

    const asistenciasConfirmadas = Math.max(0, partidosConEncuesta - faltasConfirmadas);
    const asistenciaPct = partidosConEncuesta > 0
      ? Number(((asistenciasConfirmadas / partidosConEncuesta) * 100).toFixed(1))
      : 0;

    return {
      partidosConEncuesta,
      partidosSinEncuesta,
      asistenciasConfirmadas,
      faltasConfirmadas,
      asistenciaPct,
    };
  };

  const getResultadosEfectivos = (surveyOutcomes = {}) => {
    const ganados = Number(surveyOutcomes?.ganados || 0);
    const empatados = Number(surveyOutcomes?.empatados || 0);
    const perdidos = Number(surveyOutcomes?.perdidos || 0);
    const pendientes = Number(surveyOutcomes?.pendientes || 0);
    const cerrados = ganados + empatados + perdidos;
    const puntos = (ganados * 3) + empatados;
    const winRate = cerrados > 0 ? Number(((ganados / cerrados) * 100).toFixed(1)) : 0;
    const winDrawRate = cerrados > 0 ? Number((((ganados + empatados) / cerrados) * 100).toFixed(1)) : 0;
    const puntosPct = cerrados > 0 ? Number(((puntos / (cerrados * 3)) * 100).toFixed(1)) : 0;

    return {
      cerrados,
      pendientes,
      winRate,
      winDrawRate,
      puntos,
      puntosPct,
    };
  };

  const getRankingTimelineStats = async ({ dateRange, userPartidos = [] }) => {
    const [adjustmentsRes, rankingRes, streakRes] = await Promise.all([
      supabase
        .from('rating_adjustments')
        .select('id, partido_id, type, amount, meta, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('usuarios')
        .select('ranking')
        .eq('id', user.id)
        .maybeSingle(),
      supabase
        .from('no_show_recovery_state')
        .select('current_streak')
        .eq('user_id', user.id)
        .maybeSingle(),
    ]);

    if (adjustmentsRes.error) throw adjustmentsRes.error;
    if (rankingRes.error) throw rankingRes.error;
    if (streakRes.error) throw streakRes.error;

    const adjustments = adjustmentsRes.data || [];
    const startDay = toDateOnly(dateRange.start);
    const endDay = toDateOnly(dateRange.end);

    const adjustmentsInPeriod = adjustments.filter((row) => {
      const day = toDateOnly(row?.created_at);
      return day >= startDay && day <= endDay;
    });

    const allPenalties = adjustments
      .filter((row) => row?.type === 'no_show_penalty')
      .reduce((sum, row) => sum + Math.abs(Number(row?.amount || 0)), 0);
    const allRecoveries = adjustments
      .filter((row) => row?.type === 'no_show_recovery')
      .reduce((sum, row) => sum + Math.max(0, Number(row?.amount || 0)), 0);

    const sancionesPeriodo = adjustmentsInPeriod.filter((row) => row?.type === 'no_show_penalty').length;
    const recuperacionesPeriodo = adjustmentsInPeriod.filter((row) => row?.type === 'no_show_recovery').length;
    const deudaPendiente = Number(Math.max(0, allPenalties - allRecoveries).toFixed(2));
    const balancePeriodo = Number(
      adjustmentsInPeriod.reduce((sum, row) => sum + Number(row?.amount || 0), 0).toFixed(2),
    );

    const matchNameMap = new Map();
    (userPartidos || []).forEach((match) => {
      if (Number.isFinite(Number(match?.id))) {
        matchNameMap.set(Number(match.id), String(match?.nombre || `Partido ${match.id}`));
      }
    });

    const missingMatchIds = [...new Set(
      adjustmentsInPeriod
        .map((row) => Number(row?.partido_id))
        .filter((id) => Number.isFinite(id) && !matchNameMap.has(id)),
    )];

    if (missingMatchIds.length > 0) {
      const { data: matchesMeta, error: matchesMetaErr } = await supabase
        .from('partidos')
        .select('id, nombre')
        .in('id', missingMatchIds);
      if (!matchesMetaErr) {
        (matchesMeta || []).forEach((match) => {
          matchNameMap.set(Number(match.id), String(match?.nombre || `Partido ${match.id}`));
        });
      }
    }

    const movimientos = adjustmentsInPeriod
      .map((row) => {
        const delta = Number(row?.amount || 0);
        const partidoId = Number(row?.partido_id);
        return {
          id: `ranking-${row.id}`,
          createdAt: row?.created_at,
          delta,
          type: row?.type,
          partidoId,
          matchName: matchNameMap.get(partidoId) || `Partido ${partidoId}`,
          motivo: row?.type === 'no_show_penalty'
            ? 'Sanción por falta confirmada'
            : row?.type === 'no_show_recovery'
              ? 'Recuperación por racha sin faltas'
              : 'Ajuste de ranking',
        };
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return {
      rankingActual: Number(rankingRes.data?.ranking ?? 0),
      balancePeriodo,
      sancionesPeriodo,
      recuperacionesPeriodo,
      deudaPendiente,
      streakRecuperacion: Number(streakRes.data?.current_streak || 0),
      movimientos,
    };
  };

  const getLongestActiveMonthStreak = (monthTotals = []) => {
    let best = 0;
    let current = 0;
    monthTotals.forEach((value) => {
      if (Number(value || 0) > 0) {
        current += 1;
        best = Math.max(best, current);
      } else {
        current = 0;
      }
    });
    return best;
  };

  const getConsistencyStats = async ({ dateRange, totalPeriodoActual }) => {
    const previousRange = getPreviousDateRange(dateRange);
    const selectedYearRange = {
      start: `${selectedYear}-01-01`,
      end: `${selectedYear}-12-31`,
    };
    const monthLabelsShort = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

    const [previousMatches, selectedYearMatches] = await Promise.all([
      getUserMatchesForRange(previousRange),
      getUserMatchesForRange(selectedYearRange),
    ]);

    const totalPeriodoAnterior = previousMatches.total;
    const variacion = Number(totalPeriodoActual) - Number(totalPeriodoAnterior);
    const variacionPct = totalPeriodoAnterior > 0
      ? Number(((variacion / totalPeriodoAnterior) * 100).toFixed(1))
      : (totalPeriodoActual > 0 ? 100 : 0);
    const tendencia = variacion > 0 ? 'sube' : variacion < 0 ? 'baja' : 'igual';

    const monthlyTotals = Array.from({ length: 12 }, () => 0);
    [...(selectedYearMatches.real || []), ...(selectedYearMatches.manual || [])].forEach((match) => {
      const date = new Date(`${String(match?.fecha || '')}T00:00:00`);
      if (Number.isNaN(date.getTime())) return;
      const m = date.getMonth();
      if (m >= 0 && m <= 11) {
        monthlyTotals[m] += 1;
      }
    });

    const mesesActivos = monthlyTotals.filter((value) => value > 0).length;
    const divisor = selectedYear === new Date().getFullYear()
      ? (new Date().getMonth() + 1)
      : 12;
    const promedioMensual = divisor > 0
      ? Number(((selectedYearMatches.total || 0) / divisor).toFixed(2))
      : 0;

    const bestMonthTotal = Math.max(...monthlyTotals);
    const bestMonthIndex = monthlyTotals.findIndex((value) => value === bestMonthTotal);
    const rachaMeses = getLongestActiveMonthStreak(monthlyTotals);

    return {
      totalPeriodo: Number(totalPeriodoActual || 0),
      totalPeriodoAnterior,
      variacion,
      variacionPct,
      tendencia,
      mesesActivos,
      promedioMensual,
      mejorMesLabel: bestMonthIndex >= 0 ? monthLabelsShort[bestMonthIndex] : '-',
      mejorMesTotal: bestMonthTotal > 0 ? bestMonthTotal : 0,
      rachaMeses,
      distribucionMensual: monthlyTotals.map((total, idx) => ({
        name: monthLabelsShort[idx],
        total,
      })),
    };
  };

  const getExtendedStats = async ({ dateRange, partidosData, partidosManualesData }) => {
    const userPartidos = partidosData?.partidos || [];
    const totalPeriodoActual = (partidosData?.total || 0) + (partidosManualesData?.total || 0);

    const [attendanceStats, rankingStats, consistencyStats] = await Promise.all([
      getAttendanceStats(userPartidos),
      getRankingTimelineStats({ dateRange, userPartidos }),
      getConsistencyStats({ dateRange, totalPeriodoActual }),
    ]);

    return {
      asistencia: {
        ...attendanceStats,
        sancionesPeriodo: rankingStats.sancionesPeriodo,
        recuperacionesPeriodo: rankingStats.recuperacionesPeriodo,
        deudaPendiente: rankingStats.deudaPendiente,
        streakRecuperacion: rankingStats.streakRecuperacion,
      },
      resultadosEfectivos: getResultadosEfectivos(partidosData?.surveyOutcomes || {}),
      rankingTimeline: {
        rankingActual: rankingStats.rankingActual,
        balancePeriodo: rankingStats.balancePeriodo,
        movimientos: rankingStats.movimientos,
      },
      consistencia: consistencyStats,
    };
  };

  const markActiveLesionAsRecovered = async () => {
    if (!stats?.lesionActiva?.id || !user?.id) return;
    try {
      const fechaFin = new Date().toISOString().split('T')[0];
      const { error: lesionError } = await supabase
        .from('lesiones')
        .update({ fecha_fin: fechaFin })
        .eq('id', stats.lesionActiva.id);
      if (lesionError) throw lesionError;

      const { error: userError } = await supabase
        .from('usuarios')
        .update({ lesion_activa: false })
        .eq('id', user.id);
      if (userError) throw userError;

      console.info('Lesión marcada como recuperada');
      await loadStats();
    } catch (error) {
      console.error('Error marking lesion as recovered:', error);
      notifyBlockingError('No se pudo marcar la lesión como recuperada');
    }
  };

  const generateChartData = (partidos, period, isManual = false) => {
    const data = {};

    partidos.forEach((partido) => {
      const date = new Date(partido.fecha);
      let key;

      switch (period) {
        case 'week':
          key = date.toLocaleDateString('es-ES', { weekday: 'short' });
          break;
        case 'month':
          key = `Sem ${Math.ceil(date.getDate() / 7)}`;
          break;
        case 'year':
        default:
          key = date.toLocaleDateString('es-ES', { month: 'short' });
          break;
      }

      if (!data[key]) {
        data[key] = { amistosos: 0, torneos: 0 };
      }

      if (isManual) {
        if (partido.tipo_partido === 'amistoso') {
          data[key].amistosos += 1;
        } else {
          data[key].torneos += 1;
        }
      } else {
        data[key].amistosos += 1;
      }
    });

    return Object.entries(data).map(([name, counts]) => ({
      name,
      amistosos: counts.amistosos || 0,
      torneos: counts.torneos || 0,
    }));
  };

  const mergeChartData = (chartData1, chartData2) => {
    const merged = {};

    [...chartData1, ...chartData2].forEach((item) => {
      if (!merged[item.name]) {
        merged[item.name] = { name: item.name, amistosos: 0, torneos: 0 };
      }
      merged[item.name].amistosos += item.amistosos || 0;
      merged[item.name].torneos += item.torneos || 0;
    });

    return Object.values(merged).map((item) => ({
      ...item,
      total: item.amistosos + item.torneos,
    }));
  };

  const formatInjuryStatus = () => {
    if (stats.lesionActiva) {
      const diasDesde = Math.floor((new Date() - new Date(stats.lesionActiva.fecha_inicio)) / (1000 * 60 * 60 * 24));
      return {
        text: `En recuperación desde ${new Date(stats.lesionActiva.fecha_inicio).toLocaleDateString('es-ES')}`,
        subtext: `${stats.lesionActiva.tipo_lesion} - ${diasDesde} días`,
        type: 'active',
      };
    }

    if (stats.ultimaLesion && stats.ultimaLesion.fecha_fin) {
      const diasDesde = Math.floor((new Date() - new Date(stats.ultimaLesion.fecha_fin)) / (1000 * 60 * 60 * 24));
      return {
        text: `Última lesión: ${diasDesde} días atrás`,
        subtext: stats.ultimaLesion.tipo_lesion,
        type: 'recovered',
      };
    }

    return null;
  };

  const injuryStatus = formatInjuryStatus();
  const resultPillMeta = {
    ganaste: { label: 'Ganaste', className: 'text-emerald-300 border-emerald-300/30 bg-emerald-400/10' },
    empate: { label: 'Empate', className: 'text-amber-200 border-amber-200/30 bg-amber-400/10' },
    perdiste: { label: 'Perdiste', className: 'text-rose-300 border-rose-300/30 bg-rose-400/10' },
    pendiente: { label: 'Pendiente', className: 'text-sky-200 border-sky-300/30 bg-sky-400/10' },
    sin_equipo: { label: 'Sin equipo', className: 'text-white/80 border-white/20 bg-white/10' },
    sin_dato: { label: 'Sin dato', className: 'text-white/80 border-white/20 bg-white/10' },
  };
  const recapGanados = stats.manualGanados + stats.encuestaGanados;
  const recapEmpatados = stats.manualEmpates + stats.encuestaEmpates;
  const recapPerdidos = stats.manualPerdidos + stats.encuestaPerdidos;
  const recapRecientes = Array.isArray(stats.recapRecientes) ? stats.recapRecientes : [];
  const showResultsRecap = (
    recapGanados
    + recapEmpatados
    + recapPerdidos
    + stats.encuestaPendientes
    + stats.encuestaSinEquipoDetectado
  ) > 0 || recapRecientes.length > 0;
  const asistencia = stats.asistencia || {};
  const resultadosEfectivos = stats.resultadosEfectivos || {};
  const rankingTimeline = stats.rankingTimeline || {};
  const consistencia = stats.consistencia || {};

  const formatSignedDelta = (value) => {
    const num = Number(value || 0);
    if (!Number.isFinite(num) || num === 0) return '0';
    return `${num > 0 ? '+' : ''}${num.toFixed(1)}`;
  };

  const tendenciaMeta = consistencia.tendencia === 'sube'
    ? { icon: TrendingUp, className: 'text-emerald-300', label: 'En alza' }
    : consistencia.tendencia === 'baja'
      ? { icon: TrendingDown, className: 'text-rose-300', label: 'En baja' }
      : { icon: Minus, className: 'text-white/70', label: 'Sin cambios' };
  const TendenciaIcon = tendenciaMeta.icon;
  const pointsEfficiencySummary = getPointsEfficiencySummary({
    cerrados: resultadosEfectivos.cerrados,
    puntos: resultadosEfectivos.puntos,
    puntosPct: resultadosEfectivos.puntosPct,
  });
  const maxDistribucionMensual = Math.max(
    ...(Array.isArray(consistencia.distribucionMensual)
      ? consistencia.distribucionMensual.map((item) => Number(item?.total || 0))
      : [0]),
    1,
  );

  const handleManualMatchSaved = () => {
    loadStats();
  };

  const handleInjurySaved = () => {
    loadStats();
    // Force refresh of profile data
    window.location.reload();
  };

  const periodLabels = {
    year: 'Año',
    month: 'Mes',
    week: 'Semana',
  };

  const monthNames = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
  ];
  const statsPanelClass = 'bg-[#1e293b]/92 border border-[rgba(88,107,170,0.46)] rounded-none backdrop-blur-md';
  const statsSubPanelClass = 'rounded-none border border-[rgba(88,107,170,0.46)] bg-[rgba(15,24,56,0.72)]';

  const getAvailableYears = () => {
    const currentYear = new Date().getFullYear();
    return Array.from({ length: 5 }, (_, i) => currentYear - i);
  };

  const getAvailableWeeks = () => {
    const daysInMonth = new Date(selectedYear, selectedMonth + 1, 0).getDate();
    const totalWeeks = Math.ceil(daysInMonth / 7);
    return Array.from({ length: totalWeeks }, (_, idx) => {
      const startDay = idx * 7 + 1;
      const endDay = Math.min(startDay + 6, daysInMonth);
      return {
        index: idx,
        label: `Semana ${idx + 1}`,
        range: `${startDay}-${endDay} ${monthNames[selectedMonth]}`,
      };
    });
  };

  useEffect(() => {
    const maxWeekIndex = getAvailableWeeks().length - 1;
    if (selectedWeek > maxWeekIndex) {
      setSelectedWeek(maxWeekIndex);
    }
  }, [selectedMonth, selectedYear]);

  const iconMap = {
    Trophy,
    Star,
    Medal,
    Hand,
    ShieldAlert,
    Activity,
  };

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      const amistosos = payload.find((p) => p.dataKey === 'amistosos')?.value || 0;
      const torneos = payload.find((p) => p.dataKey === 'torneos')?.value || 0;
      const total = amistosos + torneos;

      return (
        <div className="bg-[#1e293b]/98 border border-[rgba(88,107,170,0.46)] rounded-none p-2 backdrop-blur-md">
          <p className="text-white/80 text-xs m-0 font-oswald">{`${label}`}</p>
          <p className="text-white text-sm font-semibold m-1 font-oswald">
            {`${total} partido${total !== 1 ? 's' : ''}`}
          </p>
          {amistosos > 0 && (
            <p className="text-white/80 text-xs font-normal m-0.5 font-oswald">
              {`${amistosos} amistoso${amistosos !== 1 ? 's' : ''}`}
            </p>
          )}
          {torneos > 0 && (
            <p className="text-white/80 text-xs font-normal m-0.5 font-oswald">
              {`${torneos} torneo${torneos !== 1 ? 's' : ''}`}
            </p>
          )}
        </div>
      );
    }
    return null;
  };

  if (loading) {
    return <LoadingSpinner size="large" fullScreen />;
  }

  return (
    <div className="min-h-[100dvh]">
      <PageTitle onBack={onVolver}>ESTADÍSTICAS</PageTitle>

      <div className="pt-[100px] px-5 pb-5 max-w-[100vw] m-0 box-border md:pt-[90px] md:px-4 sm:pt-[90px]">
        {/* Period selector first: segmented control to define reading context before metrics */}
        <motion.div
          ref={periodSelectorRef}
          className="mb-6 relative z-40 overflow-visible border border-[rgba(88,107,170,0.46)] bg-[#1e293b]/92"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="grid grid-cols-3 gap-0">
            {['week', 'month', 'year'].map((p) => (
              <div key={p} className="relative min-w-0">
                <button
                  className={`relative w-full h-[44px] border-r border-[rgba(88,107,170,0.46)] last:border-r-0 px-2 font-bebas text-[0.95rem] tracking-[0.04em] transition-[background-color,color] duration-150 ${period === p ? 'bg-[#31239f] text-white shadow-[inset_0_0_0_1px_rgba(160,142,255,0.26)]' : 'bg-[#1e293b]/92 text-white/65 hover:text-white/88 hover:bg-[rgba(38,52,94,0.9)]'}`}
                  onClick={() => {
                    setPeriod(p);
                    if (p === 'year') setShowYearDropdown(!showYearDropdown);
                    if (p === 'month') setShowMonthDropdown(!showMonthDropdown);
                    if (p === 'week') setShowWeekDropdown(!showWeekDropdown);
                    if (p !== 'year') setShowYearDropdown(false);
                    if (p !== 'month') setShowMonthDropdown(false);
                    if (p !== 'week') setShowWeekDropdown(false);
                  }}
                >
                  {period === p ? (
                    <span className="pointer-events-none absolute left-0 top-0 h-[3px] w-full bg-[#644dff]" />
                  ) : null}
                  {p === 'week' ? `Semana ${selectedWeek + 1}` : periodLabels[p]}
                </button>

                {p === 'week' && showWeekDropdown && period === 'week' && (
                  <div className="absolute top-full left-0 right-0 bg-[#1e293b]/98 rounded-none border border-[rgba(88,107,170,0.46)] z-[1200] mt-1 max-h-[240px] overflow-y-auto backdrop-blur-md md:max-h-[150px] shadow-[0_10px_24px_rgba(2,10,34,0.46)]">
                    {getAvailableWeeks().map((week) => (
                      <div
                        key={week.index}
                        className={`px-4 py-3 text-white/80 cursor-pointer transition-all font-oswald text-sm hover:bg-[rgba(38,52,94,0.9)] hover:text-white ${selectedWeek === week.index ? 'bg-[rgba(106,67,255,0.22)] text-white font-semibold' : ''}`}
                        onClick={() => {
                          setSelectedWeek(week.index);
                          setShowWeekDropdown(false);
                        }}
                      >
                        <div>{week.label}</div>
                        <div className="text-[11px] text-white/60">{week.range}</div>
                      </div>
                    ))}
                  </div>
                )}

                {p === 'year' && showYearDropdown && period === 'year' && (
                  <div className="absolute top-full left-0 right-0 bg-[#1e293b]/98 rounded-none border border-[rgba(88,107,170,0.46)] z-[1200] mt-1 max-h-[200px] overflow-y-auto backdrop-blur-md md:max-h-[150px] shadow-[0_10px_24px_rgba(2,10,34,0.46)]">
                    {getAvailableYears().map((year) => (
                      <div
                        key={year}
                        className={`px-4 py-3 text-white/80 cursor-pointer transition-all font-oswald text-sm hover:bg-[rgba(38,52,94,0.9)] hover:text-white ${selectedYear === year ? 'bg-[rgba(106,67,255,0.22)] text-white font-semibold' : ''}`}
                        onClick={() => {
                          setSelectedYear(year);
                          setShowYearDropdown(false);
                        }}
                      >
                        {year}
                      </div>
                    ))}
                  </div>
                )}

                {p === 'month' && showMonthDropdown && period === 'month' && (
                  <div className="absolute top-full left-0 right-0 bg-[#1e293b]/98 rounded-none border border-[rgba(88,107,170,0.46)] z-[1200] mt-1 max-h-[200px] overflow-y-auto backdrop-blur-md md:max-h-[150px] shadow-[0_10px_24px_rgba(2,10,34,0.46)]">
                    {monthNames.map((month, index) => (
                      <div
                        key={index}
                        className={`px-4 py-3 text-white/80 cursor-pointer transition-all font-oswald text-sm hover:bg-[rgba(38,52,94,0.9)] hover:text-white ${selectedMonth === index ? 'bg-[rgba(106,67,255,0.22)] text-white font-semibold' : ''}`}
                        onClick={() => {
                          setSelectedMonth(index);
                          setShowMonthDropdown(false);
                        }}
                      >
                        {month} {selectedYear}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </motion.div>

        <div className="grid grid-cols-2 gap-3 mb-6 relative z-10">
          {[
            { key: 'partidos', label: 'Partidos', value: stats.partidosJugados, icon: Dribbble, decimals: 0 },
            { key: 'amistosos', label: 'Amistosos', value: stats.amistosos, icon: Handshake, decimals: 0 },
            { key: 'torneos', label: 'Torneos', value: stats.torneos, icon: Trophy, decimals: 0 },
            { key: 'lesiones', label: 'Lesiones', value: stats.lesionesPeriodo, icon: ShieldAlert, decimals: 0 },
          ].map((metric, idx) => {
            const Icon = metric.icon;
            return (
              <motion.div
                key={metric.key}
                className={`${statsPanelClass} p-5 text-left transition-all hover:-translate-y-1 hover:shadow-xl hover:border-[#4a7ed6] hover:brightness-[1.03] md:p-4 ${metric.key === 'lesiones' ? 'cursor-pointer' : ''}`}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 + idx * 0.08 }}
                onClick={metric.key === 'lesiones' ? () => setShowLesionesDetalle((v) => !v) : undefined}
              >
                <div className="mb-3 text-white/80">
                  <Icon size={26} />
                </div>
                <div className="font-oswald text-3xl font-bold text-white mb-1 leading-none md:text-[28px]">
                  <CountUp end={metric.value} decimals={metric.decimals} duration={1.2} />
                </div>
                <div className="font-oswald text-xs font-medium text-white/80 uppercase tracking-wide">{metric.label}</div>
              </motion.div>
            );
          })}
        </div>

        {showResultsRecap && (
          <motion.div
            className={`${statsPanelClass} p-4 mb-6`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.26 }}
          >
            <div className="font-oswald text-base font-semibold text-white mb-1">Recap de resultados</div>
            <div className="font-oswald text-[11px] text-white/65 mb-3">
              Todos tus partidos del período: manuales y partidos reales (con encuesta).
            </div>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-2">
              <div className="rounded-none border border-emerald-300/25 bg-emerald-400/10 px-3 py-2 text-center min-h-[82px] flex flex-col items-center justify-center">
                <div className="font-oswald text-[11px] text-emerald-200/90">Ganados</div>
                <div className="font-oswald text-xl font-bold text-emerald-100">{recapGanados}</div>
              </div>
              <div className="rounded-none border border-amber-300/25 bg-amber-400/10 px-3 py-2 text-center min-h-[82px] flex flex-col items-center justify-center">
                <div className="font-oswald text-[11px] text-amber-100/90">Empatados</div>
                <div className="font-oswald text-xl font-bold text-amber-50">{recapEmpatados}</div>
              </div>
              <div className="rounded-none border border-rose-300/25 bg-rose-400/10 px-3 py-2 text-center min-h-[82px] flex flex-col items-center justify-center">
                <div className="font-oswald text-[11px] text-rose-100/90">Perdidos</div>
                <div className="font-oswald text-xl font-bold text-rose-100">{recapPerdidos}</div>
              </div>
              <div className="rounded-none border border-sky-300/25 bg-sky-400/10 px-3 py-2 text-center min-h-[82px] flex flex-col items-center justify-center">
                <div className="font-oswald text-[11px] text-sky-100/90">Pendientes</div>
                <div className="font-oswald text-xl font-bold text-sky-100">{stats.encuestaPendientes}</div>
              </div>
            </div>
            {stats.encuestaSinEquipoDetectado > 0 && (
              <div className="font-oswald text-[11px] text-white/55 mt-2">
                {stats.encuestaSinEquipoDetectado} partido(s) con resultado pero sin equipo detectable.
              </div>
            )}
            {recapRecientes.length > 0 && (
              <div className="flex flex-col gap-2 mt-3">
                {recapRecientes.map((partido) => {
                  const resultMeta = resultPillMeta[partido.resultKey] || resultPillMeta.sin_dato;
                  const fechaLabel = partido?.fecha
                    ? new Date(`${partido.fecha}T00:00:00`).toLocaleDateString('es-ES')
                    : 'Sin fecha';
                  const titleLabel = partido?.source === 'manual'
                    ? `${fechaLabel} · ${partido.tipoLabel}`
                    : `${fechaLabel} · ${partido.nombre || 'Partido'} · ${partido.tipoLabel}`;
                  return (
                    <div key={partido.id} className="flex items-center justify-between gap-2 rounded-none border border-[rgba(88,107,170,0.46)] bg-[rgba(15,24,56,0.72)] px-3 py-2">
                      <div className="font-oswald text-sm text-white/90">
                        {titleLabel}
                      </div>
                      <span className={`px-2.5 py-1 rounded-none border text-xs font-oswald ${resultMeta.className}`}>
                        {partido?.label || resultMeta.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </motion.div>
        )}

        <motion.div
          className="grid grid-cols-1 gap-3 mb-6 lg:grid-cols-2"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <div className={`${statsPanelClass} p-4`}>
            <div className="flex items-center justify-between mb-2">
              <div className="font-oswald text-base font-semibold text-white flex items-center gap-2">
                <UserCheck size={18} />
                Asistencia y disciplina
              </div>
              <div className="font-oswald text-2xl font-bold text-emerald-200">
                {Number(asistencia.asistenciaPct || 0).toFixed(1)}%
              </div>
            </div>
            <div className="font-oswald text-[11px] text-white/65 mb-3">
              Basado en partidos con encuesta jugada dentro del período.
            </div>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div className={`${statsSubPanelClass} px-3 py-2`}>
                <div className="font-oswald text-[11px] text-white/60">Con encuesta</div>
                <div className="font-oswald text-lg text-white font-semibold">{asistencia.partidosConEncuesta || 0}</div>
              </div>
              <div className={`${statsSubPanelClass} px-3 py-2`}>
                <div className="font-oswald text-[11px] text-white/60">Sin encuesta</div>
                <div className="font-oswald text-lg text-white font-semibold">{asistencia.partidosSinEncuesta || 0}</div>
              </div>
              <div className="rounded-none border border-rose-300/25 bg-rose-400/10 px-3 py-2">
                <div className="font-oswald text-[11px] text-rose-100/85">Faltas confirmadas</div>
                <div className="font-oswald text-lg text-rose-100 font-semibold">{asistencia.faltasConfirmadas || 0}</div>
              </div>
              <div className="rounded-none border border-emerald-300/25 bg-emerald-400/10 px-3 py-2">
                <div className="font-oswald text-[11px] text-emerald-100/85">Asistencias</div>
                <div className="font-oswald text-lg text-emerald-100 font-semibold">{asistencia.asistenciasConfirmadas || 0}</div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-none border border-rose-300/20 bg-rose-400/5 px-2.5 py-2 text-center">
                <div className="font-oswald text-[10px] text-rose-100/80">Sanciones</div>
                <div className="font-oswald text-base font-semibold text-rose-100">{asistencia.sancionesPeriodo || 0}</div>
              </div>
              <div className="rounded-none border border-sky-300/20 bg-sky-400/5 px-2.5 py-2 text-center">
                <div className="font-oswald text-[10px] text-sky-100/80">Recuperaciones</div>
                <div className="font-oswald text-base font-semibold text-sky-100">{asistencia.recuperacionesPeriodo || 0}</div>
              </div>
              <div className="rounded-none border border-amber-300/20 bg-amber-400/5 px-2.5 py-2 text-center">
                <div className="font-oswald text-[10px] text-amber-100/80">Deuda pend.</div>
                <div className="font-oswald text-base font-semibold text-amber-100">
                  {Number(asistencia.deudaPendiente || 0).toFixed(1)}
                </div>
              </div>
            </div>
          </div>

          <div className={`${statsPanelClass} p-4`}>
            <div className="flex items-center justify-between mb-2">
              <div className="font-oswald text-base font-semibold text-white flex items-center gap-2">
                <Trophy size={18} />
                Resultados efectivos
              </div>
              <div className="font-oswald text-2xl font-bold text-white">
                {Number(resultadosEfectivos.winRate || 0).toFixed(1)}%
              </div>
            </div>
            <div className="font-oswald text-[11px] text-white/65 mb-3">
              Solo partidos con resultado cerrado de encuesta (sin pendientes).
            </div>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div className={`${statsSubPanelClass} px-3 py-2`}>
                <div className="font-oswald text-[11px] text-white/60">Cerrados</div>
                <div className="font-oswald text-lg text-white font-semibold">{resultadosEfectivos.cerrados || 0}</div>
              </div>
              <div className={`${statsSubPanelClass} px-3 py-2`}>
                <div className="font-oswald text-[11px] text-white/60">Pendientes</div>
                <div className="font-oswald text-lg text-white font-semibold">{resultadosEfectivos.pendientes || 0}</div>
              </div>
              <div className="rounded-none border border-emerald-300/25 bg-emerald-400/10 px-3 py-2">
                <div className="font-oswald text-[11px] text-emerald-100/85">% Victorias</div>
                <div className="font-oswald text-lg text-emerald-100 font-semibold">
                  {Number(resultadosEfectivos.winRate || 0).toFixed(1)}%
                </div>
              </div>
              <div className="rounded-none border border-sky-300/25 bg-sky-400/10 px-3 py-2">
                <div className="font-oswald text-[11px] text-sky-100/85">% No perder</div>
                <div className="font-oswald text-lg text-sky-100 font-semibold">
                  {Number(resultadosEfectivos.winDrawRate || 0).toFixed(1)}%
                </div>
              </div>
            </div>
            <div className={`${statsSubPanelClass} px-3 py-2`}>
              <div className="font-oswald text-[11px] text-white/65">Eficiencia de puntos</div>
              <div className="flex items-center justify-between">
                <div className="font-oswald text-base text-white">
                  {pointsEfficiencySummary.scoreText}
                </div>
                <div className="font-oswald text-base font-semibold text-white">
                  {pointsEfficiencySummary.percentText}
                </div>
              </div>
            </div>
          </div>
        </motion.div>

        <motion.div
          className={`${statsPanelClass} p-3 mb-6`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.32 }}
        >
          <div className="font-oswald text-xs text-white/75 uppercase tracking-wide mb-1">Cómo se calcula</div>
          <div className="font-oswald text-[12px] text-white/65 leading-relaxed">
            Asistencia: asistencias confirmadas / partidos con encuesta jugada.
          </div>
          <div className="font-oswald text-[12px] text-white/65 leading-relaxed">
            % Victorias: ganados / partidos cerrados por encuesta.
          </div>
          <div className="font-oswald text-[12px] text-white/65 leading-relaxed">
            Deuda de ranking: sanciones acumuladas menos recuperaciones acumuladas.
          </div>
        </motion.div>

        <motion.div
          className={`${statsPanelClass} p-4 mb-6`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.34 }}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="font-oswald text-base font-semibold text-white flex items-center gap-2">
              <Activity size={18} />
              Consistencia
            </div>
            <div className={`font-oswald text-sm flex items-center gap-1 ${tendenciaMeta.className}`}>
              <TendenciaIcon size={16} />
              {tendenciaMeta.label}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-1">
            <div className={`${statsSubPanelClass} px-3 py-2`}>
              <div className="font-oswald text-[11px] text-white/60">Período actual</div>
              <div className="font-oswald text-lg text-white font-semibold">{consistencia.totalPeriodo || 0}</div>
            </div>
            <div className={`${statsSubPanelClass} px-3 py-2`}>
              <div className="font-oswald text-[11px] text-white/60">Período anterior</div>
              <div className="font-oswald text-lg text-white font-semibold">{consistencia.totalPeriodoAnterior || 0}</div>
            </div>
            <div className={`${statsSubPanelClass} px-3 py-2`}>
              <div className="font-oswald text-[11px] text-white/60">Variación</div>
              <div className={`font-oswald text-lg font-semibold ${consistencia.variacion > 0 ? 'text-emerald-200' : consistencia.variacion < 0 ? 'text-rose-200' : 'text-white'}`}>
                {consistencia.variacion > 0 ? '+' : ''}{consistencia.variacion || 0} ({consistencia.variacionPct || 0}%)
              </div>
            </div>
            <div className={`${statsSubPanelClass} px-3 py-2`}>
              <div className="font-oswald text-[11px] text-white/60">Promedio mensual ({selectedYear})</div>
              <div className="font-oswald text-lg text-white font-semibold">{Number(consistencia.promedioMensual || 0).toFixed(2)}</div>
            </div>
            <div className={`${statsSubPanelClass} px-3 py-2`}>
              <div className="font-oswald text-[11px] text-white/60">Meses activos</div>
              <div className="font-oswald text-lg text-white font-semibold">{consistencia.mesesActivos || 0}</div>
            </div>
            <div className={`${statsSubPanelClass} px-3 py-2`}>
              <div className="font-oswald text-[11px] text-white/60">Mejor mes</div>
              <div className="font-oswald text-lg text-white font-semibold">
                {consistencia.mejorMesLabel || '-'} ({consistencia.mejorMesTotal || 0})
              </div>
            </div>
          </div>
          <div className={`mt-2 ${statsSubPanelClass} px-3 py-2`}>
            <div className="font-oswald text-[11px] text-white/60 mb-3">
              Racha máxima de meses activos: {consistencia.rachaMeses || 0}
            </div>
            <div className="flex items-end gap-1 h-[84px] pt-2">
              {(consistencia.distribucionMensual || []).map((item) => {
                const height = Number(item.total || 0) > 0
                  ? Math.max(8, Math.round((Number(item.total || 0) / maxDistribucionMensual) * 36))
                  : 8;
                return (
                  <div key={item.name} className="flex-1 min-w-0 flex flex-col items-center justify-end gap-1">
                    <div className="font-oswald text-[10px] text-white/60 leading-none min-h-[10px]">{item.total}</div>
                    <div
                      className="w-full rounded-[3px] bg-primary/70"
                      style={{ height: `${height}px` }}
                    />
                    <div className="font-oswald text-[10px] text-white/45 leading-none">{item.name}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </motion.div>

        <motion.div
          className={`${statsPanelClass} p-4 mb-6`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.38 }}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="font-oswald text-base font-semibold text-white flex items-center gap-2">
              <History size={18} />
              Movimientos de ranking
            </div>
            <div className="font-oswald text-sm text-white/80">
              Actual: {Number(rankingTimeline.rankingActual || 0).toFixed(1)}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 mb-3 sm:grid-cols-1">
            <div className={`${statsSubPanelClass} px-3 py-2`}>
              <div className="font-oswald text-[11px] text-white/60">Balance período</div>
              <div className={`font-oswald text-lg font-semibold ${Number(rankingTimeline.balancePeriodo || 0) > 0 ? 'text-emerald-200' : Number(rankingTimeline.balancePeriodo || 0) < 0 ? 'text-rose-200' : 'text-white'}`}>
                {formatSignedDelta(rankingTimeline.balancePeriodo)}
              </div>
            </div>
            <div className={`${statsSubPanelClass} px-3 py-2`}>
              <div className="font-oswald text-[11px] text-white/60">Racha recuperación</div>
              <div className="font-oswald text-lg text-white font-semibold">{asistencia.streakRecuperacion || 0}</div>
            </div>
            <div className={`${statsSubPanelClass} px-3 py-2`}>
              <div className="font-oswald text-[11px] text-white/60">Deuda pendiente</div>
              <div className="font-oswald text-lg text-amber-100 font-semibold">{Number(asistencia.deudaPendiente || 0).toFixed(1)}</div>
            </div>
          </div>
          {Array.isArray(rankingTimeline.movimientos) && rankingTimeline.movimientos.length > 0 ? (
            <div className="flex flex-col gap-2">
              {rankingTimeline.movimientos.slice(0, 6).map((mov) => (
                <div key={mov.id} className="flex items-center justify-between gap-2 rounded-none border border-[rgba(88,107,170,0.46)] bg-[rgba(15,24,56,0.72)] px-3 py-2">
                  <div className="min-w-0">
                    <div className="font-oswald text-sm text-white truncate">{mov.matchName}</div>
                    <div className="font-oswald text-[11px] text-white/60">
                      {new Date(mov.createdAt).toLocaleDateString('es-ES')} · {mov.motivo}
                    </div>
                  </div>
                  <div className={`font-oswald text-sm font-semibold whitespace-nowrap ${mov.delta > 0 ? 'text-emerald-200' : 'text-rose-200'}`}>
                    {formatSignedDelta(mov.delta)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="font-oswald text-sm text-white/70">Sin movimientos de ranking en este período.</div>
          )}
        </motion.div>

        {showLesionesDetalle && (
          <motion.div
            className={`${statsPanelClass} p-3.5 mb-6`}
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className="font-oswald text-xs text-white/70 uppercase tracking-wide mb-2">Lesiones del período</div>
            {stats.lesionesDetallePeriodo.length === 0 ? (
              <div className="font-oswald text-sm text-white/75">No registraste lesiones en este período.</div>
            ) : (
              <div className="flex flex-col gap-2">
                {stats.lesionesDetallePeriodo.map((lesion) => (
                  <div key={lesion.id} className="bg-[rgba(15,24,56,0.72)] border border-[rgba(88,107,170,0.46)] rounded-none px-3 py-2">
                    <div className="font-oswald text-sm text-white">{lesion.tipo_lesion}</div>
                    <div className="font-oswald text-xs text-white/65">
                      {new Date(lesion.fecha_inicio).toLocaleDateString('es-ES')} {lesion.fecha_fin ? `- ${new Date(lesion.fecha_fin).toLocaleDateString('es-ES')}` : '(activa)'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}

        <div className="grid grid-cols-1 gap-3 mb-6">
          <motion.button
            className="flex items-center justify-center gap-2 px-5 py-4 rounded-none font-oswald text-[18px] font-semibold tracking-[0.01em] cursor-pointer transition-all border border-[rgba(136,120,255,0.75)] bg-[linear-gradient(90deg,#4f8ef7_0%,#6f4dff_100%)] text-white hover:brightness-110 md:px-4 md:py-3 sm:py-3.5"
            onClick={() => setShowManualMatchModal(true)}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.45 }}
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
          >
            <ClipboardPlus size={24} />
            <span className="text-[18px] leading-none">Sumar partido manual</span>
          </motion.button>
        </div>

        {/* Injury as informational status block with secondary action (not a primary CTA) */}
        <motion.div
          className={`${statsPanelClass} p-3.5 mb-6`}
          initial={{ opacity: 0, x: -16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.5 }}
        >
          <div className="flex items-start gap-2.5">
            <div className={`mt-0.5 shrink-0 ${injuryStatus?.type === 'active' ? 'text-[#ff8a8a]' : 'text-[#8ddf9a]'}`}>
              {injuryStatus?.type === 'active' ? <CircleAlert size={24} /> : <AlertCircle size={24} />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-oswald text-xs text-white/70 uppercase tracking-wide mb-1">Estado físico</div>
              {injuryStatus ? (
                <>
                  <div className="font-oswald text-[18px] leading-tight font-semibold text-white mb-0.5">
                    {injuryStatus.type === 'active' ? 'En recuperación' : 'Sin lesión activa'}
                  </div>
                  <div className="font-oswald text-xs text-white/70 truncate">
                    {injuryStatus.type === 'active'
                      ? (injuryStatus.subtext || injuryStatus.text)
                      : injuryStatus.text}
                  </div>
                </>
              ) : (
                <>
                  <div className="font-oswald text-[18px] leading-tight font-semibold text-white mb-0.5">Sin lesión activa</div>
                  <div className="font-oswald text-xs text-white/70 truncate">Sin registros recientes</div>
                </>
              )}
            </div>
          </div>
          <button
            className="mt-3 w-full px-3 py-2 rounded-none border border-[rgba(98,117,184,0.58)] bg-[rgba(20,31,70,0.82)] text-white/85 text-xs uppercase tracking-wide hover:bg-[rgba(30,45,94,0.95)] transition-colors"
            onClick={() => setShowInjuryModal(true)}
          >
            Registrar nueva lesión
          </button>
          {injuryStatus?.type === 'active' && (
            <button
              className="mt-2 w-full px-3 py-2 rounded-none border border-[rgba(136,120,255,0.75)] bg-[linear-gradient(90deg,#4f8ef7_0%,#6f4dff_100%)] text-white text-xs uppercase tracking-wide hover:brightness-110 transition-colors"
              onClick={markActiveLesionAsRecovered}
            >
              Marcar recuperado
            </button>
          )}
        </motion.div>

        {stats.chartData.length > 0 && (
          <motion.div
            className={`${statsPanelClass} p-5 mb-6`}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.8 }}
          >
            <h3 className="font-oswald text-lg font-semibold text-white mb-4 text-center">Partidos por {periodLabels[period]}</h3>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={stats.chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.08)" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: 'rgba(255,255,255,0.8)', fontSize: 12 }} />
                <YAxis hide />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="amistosos" fill="#7D74E8" radius={[6, 6, 0, 0]} />
                <Bar dataKey="torneos" fill="#24C4E8" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <div className="flex justify-center gap-5 mt-3 sm:flex-col sm:gap-2 sm:items-center">
              <div className="flex items-center gap-1.5 font-oswald text-xs text-white/80">
                <div className="w-3 h-3 rounded-[2px] bg-[#7D74E8]"></div>
                <span>Amistosos</span>
              </div>
              <div className="flex items-center gap-1.5 font-oswald text-xs text-white/80">
                <div className="w-3 h-3 rounded-[2px] bg-[#24C4E8]"></div>
                <span>Torneos</span>
              </div>
            </div>
          </motion.div>
        )}

        {stats.topFriend && (
          <motion.div
            className="bg-[#1e293b]/92 rounded-none p-5 mb-6 relative overflow-hidden backdrop-blur-md border border-[#ffd700]/45 shadow-[0_8px_32px_rgba(255,215,0,0.1)]"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.9 }}
          >
            <div className="bg-[#ffd700]/20 text-[#ffd700] px-3 py-1.5 rounded-none font-oswald text-xs font-semibold uppercase mb-3 inline-flex items-center gap-1.5 border border-[#ffd700]/30">
              <Trophy size={16} />
              Top Friend
            </div>
            <div className="flex items-center gap-4 sm:gap-3">
              <img src={stats.topFriend.avatar} alt={stats.topFriend.nombre} className="w-[60px] h-[60px] rounded-full border-[3px] border-[#ffd700]/50 object-cover sm:w-[50px] sm:h-[50px]" />
              <div>
                <div className="font-oswald text-2xl font-bold text-white mb-1 sm:text-lg">{stats.topFriend.nombre}</div>
                <div className="font-oswald text-base font-medium text-white/70">{stats.topFriend.partidos} partidos juntos</div>
              </div>
            </div>
          </motion.div>
        )}

        <motion.div
          className="mb-8"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.0 }}
        >
          <h3 className="font-oswald text-xl font-semibold text-white mb-4 text-center">Logros</h3>

          <div className="mb-3 text-white/70 font-oswald text-xs uppercase tracking-wide">Anuales</div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3 mt-2 md:grid-cols-2 sm:grid-cols-1">
            {(stats.logros?.annual || []).map((logro, index) => {
              const Icon = iconMap[logro.icono] || Sparkles;
              return (
                <motion.div
                  key={`annual-${index}`}
                  className={`${statsPanelClass} p-4 text-left transition-all hover:-translate-y-0.5 hover:border-[#4a7ed6] hover:brightness-[1.03] md:p-3`}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 1.1 + index * 0.08 }}
                >
                  <div className="mb-3 text-primary">
                    <Icon size={24} />
                  </div>
                  <div className="font-oswald text-xs font-semibold text-white/80 uppercase mb-1">{logro.titulo}</div>
                  <div className="font-oswald text-lg font-bold text-white mb-0.5">{logro.valor}</div>
                  <div className="font-oswald text-[11px] text-white/60">{logro.detalle}</div>
                </motion.div>
              );
            })}
          </div>

          <div className="mt-5 mb-3 text-white/70 font-oswald text-xs uppercase tracking-wide">Históricos</div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3 mt-2 md:grid-cols-2 sm:grid-cols-1">
            {(stats.logros?.historical || []).map((logro, index) => {
              const Icon = iconMap[logro.icono] || Activity;
              return (
                <motion.div
                  key={`historical-${index}`}
                  className={`${statsPanelClass} p-4 text-left transition-all hover:-translate-y-0.5 hover:border-[#4a7ed6] hover:brightness-[1.03] md:p-3`}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 1.4 + index * 0.08 }}
                >
                  <div className="mb-3 text-[#95a6ff]">
                    <Icon size={24} />
                  </div>
                  <div className="font-oswald text-xs font-semibold text-white/80 uppercase mb-1">{logro.titulo}</div>
                  <div className="font-oswald text-lg font-bold text-white mb-0.5">{logro.valor}</div>
                  <div className="font-oswald text-[11px] text-white/60">{logro.detalle}</div>
                </motion.div>
              );
            })}
          </div>
        </motion.div>

        {stats.topAmigos.length > 0 && (
          <motion.div
            className="mb-8"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.2 }}
          >
            <h3 className="font-oswald text-xl font-semibold text-white mb-4 text-center">Amigos con los que más jugaste</h3>
            <AnimatePresence>
              {stats.topAmigos.map((amigo, index) => (
                <motion.div
                  key={amigo.nombre}
                  className="flex items-center gap-4 bg-[#1e293b]/92 rounded-none p-4 mb-3 backdrop-blur-md border border-[rgba(88,107,170,0.46)] transition-all hover:translate-x-2 hover:border-[#4a7ed6] hover:brightness-[1.03] md:p-3 md:gap-3"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 1.3 + index * 0.1 }}
                >
                  <div className="font-oswald text-xl font-bold text-[#ffd700] min-w-[32px]">#{index + 1}</div>
                  <div className="w-12 h-12 rounded-full border-2 border-white/30 overflow-hidden shrink-0 sm:w-10 sm:h-10">
                    {amigo.avatar && amigo.avatar !== '/profile.svg' ? (
                      <img src={amigo.avatar} alt={amigo.nombre} className="w-full h-full object-cover" />
                    ) : (
                      <div
                        className="w-full h-full flex items-center justify-center text-white font-oswald text-base font-bold shadow-sm"
                        style={{ backgroundColor: amigo.color }}
                      >
                        {getInitials(amigo.nombre)}
                      </div>
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="font-oswald text-lg font-semibold text-white uppercase mb-1">{amigo.nombre}</div>
                    <div className="font-oswald text-sm font-medium text-white/80">{amigo.partidos} partidos</div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>
        )}

        {stats.partidosJugados === 0 && (
          <motion.div
            className="text-center p-10 bg-[#1e293b]/92 rounded-none backdrop-blur-md border border-[rgba(88,107,170,0.46)]"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
          >
            <div className="mb-4 flex justify-center text-white/70">
              <CalendarDays size={28} />
            </div>
            <div className="font-oswald text-xl font-semibold text-white mb-2">
              ¡Todavía no jugaste ningún partido {period === 'week' ? 'esta semana' : period === 'month' ? `en ${monthNames[selectedMonth]} ${selectedYear}` : `en ${selectedYear}`}!
            </div>
            <div className="font-oswald text-base font-normal text-white/80">¡Animate a jugar tu primer partido!</div>
          </motion.div>
        )}

        <div className="text-center font-oswald text-xs text-white/60 mt-8 p-4">
          Datos actualizados al {new Date().toLocaleDateString('es-ES', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })}
        </div>
      </div>

      <ManualMatchModal
        isOpen={showManualMatchModal}
        onClose={() => setShowManualMatchModal(false)}
        onSaved={handleManualMatchSaved}
      />

      <InjuryModal
        isOpen={showInjuryModal}
        onClose={() => setShowInjuryModal(false)}
        onSaved={handleInjurySaved}
      />
    </div>
  );
};

export default StatsView;
