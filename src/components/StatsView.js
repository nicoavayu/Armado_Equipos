import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import CountUp from 'react-countup';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid } from 'recharts';
import {
  Activity,
  AlertCircle,
  CalendarDays,
  CircleAlert,
  ClipboardPlus,
  Dribbble,
  Hand,
  Handshake,
  Medal,
  ShieldAlert,
  Sparkles,
  Star,
  Trophy,
} from 'lucide-react';
import { supabase } from '../supabase';
import { useAuth } from './AuthProvider';
import LoadingSpinner from './LoadingSpinner';
import PageTitle from './PageTitle';
import ManualMatchModal from './ManualMatchModal';
import InjuryModal from './InjuryModal';
import { toast } from 'react-toastify';

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
  });
  const [loading, setLoading] = useState(true);

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
    };
  };

  const normalizeTeamEntry = (entry) => {
    if (entry && typeof entry === 'object') {
      return normalizeIdentity(entry.ref || entry.uuid || entry.usuario_id || entry.id || '');
    }
    return normalizeIdentity(entry);
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
        .select('partido_id, winner_team, snapshot_equipos, snapshot_participantes')
        .in('partido_id', matchIds);

      if (query.error) {
        // Backward-compatible fallback for environments without snapshot columns.
        query = await supabase
          .from('survey_results')
          .select('partido_id, winner_team')
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

    const bySurvey = new Map((surveyRows || []).map((row) => [Number(row.partido_id), row]));
    const byTeams = new Map((teamRows || []).map((row) => [Number(row.partido_id), row]));
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

      const winner = normalizeIdentity(survey?.winner_team);
      const hasWinner = winner === 'equipo_a' || winner === 'equipo_b' || winner === 'empate';

      const snapshotTeams = survey?.snapshot_equipos || null;
      const participants = Array.isArray(survey?.snapshot_participantes)
        ? survey.snapshot_participantes
        : (Array.isArray(teamConfirm?.participants) ? teamConfirm.participants : []);
      const teamA = Array.isArray(snapshotTeams?.team_a)
        ? snapshotTeams.team_a
        : (Array.isArray(teamConfirm?.team_a) ? teamConfirm.team_a : []);
      const teamB = Array.isArray(snapshotTeams?.team_b)
        ? snapshotTeams.team_b
        : (Array.isArray(teamConfirm?.team_b) ? teamConfirm.team_b : []);

      if (!hasWinner) {
        pendientes += 1;
        recientes.push({ ...baseRecap, resultKey: 'pendiente', label: 'Pendiente' });
        return;
      }

      if (winner === 'empate') {
        empatados += 1;
        recientes.push({ ...baseRecap, resultKey: 'empate', label: 'Empate' });
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

    // Mejor mes (siempre mostrar)
    const partidosPorMes = {};
    userPartidos.forEach((partido) => {
      const key = new Date(partido.fecha).toLocaleDateString('es-ES', { year: 'numeric', month: 'long' });
      partidosPorMes[key] = (partidosPorMes[key] || 0) + 1;
    });

    const mejorMes = Object.entries(partidosPorMes).sort((a, b) => b[1] - a[1])[0];
    annualLogros.push({
      titulo: 'Mejor Mes',
      valor: mejorMes ? `${mejorMes[1]} partidos` : '0 partidos',
      detalle: mejorMes ? mejorMes[0] : 'Sin partidos aún',
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

      toast.success('Lesión marcada como recuperada');
      await loadStats();
    } catch (error) {
      console.error('Error marking lesion as recovered:', error);
      toast.error('No se pudo marcar la lesión como recuperada');
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
        <div className="bg-black/90 border border-white/20 rounded-lg p-2 backdrop-blur-md">
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
          className="bg-white/10 rounded-2xl p-2 mb-6 backdrop-blur-md border border-white/20 relative z-40 overflow-visible"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="grid grid-cols-3 gap-2">
            {['week', 'month', 'year'].map((p) => (
              <div key={p} className="relative">
                <button
                  className={`w-full py-2.5 rounded-lg font-oswald text-sm font-semibold transition-all uppercase ${period === p ? 'bg-primary text-white shadow-[0_8px_24px_rgba(129,120,229,0.35)]' : 'text-white/75 hover:text-white hover:bg-white/10'}`}
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
                  {p === 'week' ? `Semana ${selectedWeek + 1}` : periodLabels[p]}
                </button>

                {p === 'week' && showWeekDropdown && period === 'week' && (
                  <div className="absolute top-full left-0 right-0 bg-black/90 rounded-lg border border-white/20 z-[1200] mt-1 max-h-[240px] overflow-y-auto backdrop-blur-md md:max-h-[150px]">
                    {getAvailableWeeks().map((week) => (
                      <div
                        key={week.index}
                        className={`px-4 py-3 text-white/80 cursor-pointer transition-all font-oswald text-sm hover:bg-white/10 hover:text-white ${selectedWeek === week.index ? 'bg-white/20 text-white font-semibold' : ''}`}
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
                  <div className="absolute top-full left-0 right-0 bg-black/90 rounded-lg border border-white/20 z-[1200] mt-1 max-h-[200px] overflow-y-auto backdrop-blur-md md:max-h-[150px]">
                    {getAvailableYears().map((year) => (
                      <div
                        key={year}
                        className={`px-4 py-3 text-white/80 cursor-pointer transition-all font-oswald text-sm hover:bg-white/10 hover:text-white ${selectedYear === year ? 'bg-white/20 text-white font-semibold' : ''}`}
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
                  <div className="absolute top-full left-0 right-0 bg-black/90 rounded-lg border border-white/20 z-[1200] mt-1 max-h-[200px] overflow-y-auto backdrop-blur-md md:max-h-[150px]">
                    {monthNames.map((month, index) => (
                      <div
                        key={index}
                        className={`px-4 py-3 text-white/80 cursor-pointer transition-all font-oswald text-sm hover:bg-white/10 hover:text-white ${selectedMonth === index ? 'bg-white/20 text-white font-semibold' : ''}`}
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
                className={`bg-white/10 rounded-2xl p-5 text-left backdrop-blur-md border border-white/20 transition-all hover:-translate-y-1 hover:shadow-xl hover:bg-white/15 md:p-4 ${metric.key === 'lesiones' ? 'cursor-pointer' : ''}`}
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
            className="bg-white/10 rounded-2xl p-4 mb-6 backdrop-blur-md border border-white/20"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.26 }}
          >
            <div className="font-oswald text-base font-semibold text-white mb-1">Recap de resultados</div>
            <div className="font-oswald text-[11px] text-white/65 mb-3">
              Todos tus partidos del período: manuales y partidos reales (con encuesta).
            </div>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-2">
              <div className="rounded-lg border border-emerald-300/25 bg-emerald-400/10 px-3 py-2">
                <div className="font-oswald text-[11px] text-emerald-200/90">Ganados</div>
                <div className="font-oswald text-xl font-bold text-emerald-100">{recapGanados}</div>
              </div>
              <div className="rounded-lg border border-amber-300/25 bg-amber-400/10 px-3 py-2">
                <div className="font-oswald text-[11px] text-amber-100/90">Empatados</div>
                <div className="font-oswald text-xl font-bold text-amber-50">{recapEmpatados}</div>
              </div>
              <div className="rounded-lg border border-rose-300/25 bg-rose-400/10 px-3 py-2">
                <div className="font-oswald text-[11px] text-rose-100/90">Perdidos</div>
                <div className="font-oswald text-xl font-bold text-rose-100">{recapPerdidos}</div>
              </div>
              <div className="rounded-lg border border-sky-300/25 bg-sky-400/10 px-3 py-2">
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
                    <div key={partido.id} className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                      <div className="font-oswald text-sm text-white/90">
                        {titleLabel}
                      </div>
                      <span className={`px-2.5 py-1 rounded-full border text-xs font-oswald ${resultMeta.className}`}>
                        {partido?.label || resultMeta.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </motion.div>
        )}

        {showLesionesDetalle && (
          <motion.div
            className="bg-white/10 rounded-xl p-3.5 mb-6 backdrop-blur-md border border-white/20"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className="font-oswald text-xs text-white/70 uppercase tracking-wide mb-2">Lesiones del período</div>
            {stats.lesionesDetallePeriodo.length === 0 ? (
              <div className="font-oswald text-sm text-white/75">No registraste lesiones en este período.</div>
            ) : (
              <div className="flex flex-col gap-2">
                {stats.lesionesDetallePeriodo.map((lesion) => (
                  <div key={lesion.id} className="bg-white/5 border border-white/10 rounded-lg px-3 py-2">
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
            className="flex items-center justify-center gap-2 px-5 py-4 border-none rounded-xl font-oswald text-[18px] font-semibold tracking-[0.01em] cursor-pointer transition-all backdrop-blur-md border border-white/20 bg-primary/80 text-white hover:bg-primary hover:-translate-y-0.5 hover:shadow-[0_8px_32px_rgba(129,120,229,0.3)] md:px-4 md:py-3 sm:py-3.5"
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
          className="bg-white/10 rounded-xl p-3.5 mb-6 backdrop-blur-md border border-white/20"
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
            className="mt-3 w-full px-3 py-2 rounded-lg border border-white/20 text-white/85 text-xs uppercase tracking-wide hover:bg-white/10 transition-colors"
            onClick={() => setShowInjuryModal(true)}
          >
            Registrar nueva lesión
          </button>
          {injuryStatus?.type === 'active' && (
            <button
              className="mt-2 w-full px-3 py-2 rounded-lg border border-primary/40 bg-primary/20 text-white text-xs uppercase tracking-wide hover:bg-primary/30 transition-colors"
              onClick={markActiveLesionAsRecovered}
            >
              Marcar recuperado
            </button>
          )}
        </motion.div>

        {stats.chartData.length > 0 && (
          <motion.div
            className="bg-white/10 rounded-2xl p-5 mb-6 backdrop-blur-md border border-white/20"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.8 }}
          >
            <h3 className="font-oswald text-lg font-semibold text-white mb-4 text-center uppercase">Partidos por {periodLabels[period]}</h3>
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
            className="bg-white/10 rounded-2xl p-5 mb-6 relative overflow-hidden backdrop-blur-md border border-[#ffd700]/30 shadow-[0_8px_32px_rgba(255,215,0,0.1)]"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.9 }}
          >
            <div className="bg-[#ffd700]/20 text-[#ffd700] px-3 py-1.5 rounded-full font-oswald text-xs font-semibold uppercase mb-3 inline-flex items-center gap-1.5 border border-[#ffd700]/30">
              <Trophy size={16} />
              Top Friend
            </div>
            <div className="flex items-center gap-4 sm:gap-3">
              <img src={stats.topFriend.avatar} alt={stats.topFriend.nombre} className="w-[60px] h-[60px] rounded-full border-[3px] border-[#ffd700]/50 object-cover sm:w-[50px] sm:h-[50px]" />
              <div>
                <div className="font-oswald text-2xl font-bold text-white uppercase mb-1 sm:text-lg">{stats.topFriend.nombre}</div>
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
          <h3 className="font-oswald text-xl font-semibold text-white mb-4 text-center uppercase">Logros</h3>

          <div className="mb-3 text-white/70 font-oswald text-xs uppercase tracking-wide">Anuales</div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3 mt-2 md:grid-cols-2 sm:grid-cols-1">
            {(stats.logros?.annual || []).map((logro, index) => {
              const Icon = iconMap[logro.icono] || Sparkles;
              return (
                <motion.div
                  key={`annual-${index}`}
                  className="bg-white/10 rounded-xl p-4 backdrop-blur-md border border-white/20 text-left transition-all hover:-translate-y-0.5 hover:bg-white/15 md:p-3"
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
                  className="bg-white/10 rounded-xl p-4 backdrop-blur-md border border-white/20 text-left transition-all hover:-translate-y-0.5 hover:bg-white/15 md:p-3"
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
            <h3 className="font-oswald text-xl font-semibold text-white mb-4 text-center uppercase">Amigos con los que más jugaste</h3>
            <AnimatePresence>
              {stats.topAmigos.map((amigo, index) => (
                <motion.div
                  key={amigo.nombre}
                  className="flex items-center gap-4 bg-white/10 rounded-xl p-4 mb-3 backdrop-blur-md border border-white/20 transition-all hover:translate-x-2 hover:bg-white/15 md:p-3 md:gap-3"
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
            className="text-center p-10 bg-white/10 rounded-2xl backdrop-blur-md border border-white/20"
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
