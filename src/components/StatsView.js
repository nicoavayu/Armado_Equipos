import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import CountUp from 'react-countup';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';
import { supabase } from '../supabase';
import { useAuth } from './AuthProvider';
import PageTitle from './PageTitle';
import ManualMatchModal from './ManualMatchModal';
import InjuryModal from './InjuryModal';

const StatsView = ({ onVolver }) => {
  const { user } = useAuth();
  const [period, setPeriod] = useState('year');
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth());
  const [showYearDropdown, setShowYearDropdown] = useState(false);
  const [showMonthDropdown, setShowMonthDropdown] = useState(false);
  const [showManualMatchModal, setShowManualMatchModal] = useState(false);
  const [showInjuryModal, setShowInjuryModal] = useState(false);
  const [stats, setStats] = useState({
    partidosJugados: 0,
    amigosDistintos: 0,
    promedioRating: 0,
    chartData: [],
    topAmigos: [],
    topFriend: null,
    recordPersonal: null,
    logros: [],
    partidosManuales: 0,
    amistosos: 0,
    torneos: 0,
    lesionActiva: null,
    ultimaLesion: null,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      loadStats();
    }
  }, [user, period, selectedYear, selectedMonth]);

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
        amistosos: partidosData.total + partidosManualesData.amistosos,
        torneos: partidosManualesData.torneos,
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
        const now = new Date();
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
        end = now;
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
      .from('partidos')
      .select('*')
      .gte('fecha', dateRange.start.split('T')[0])
      .lte('fecha', dateRange.end.split('T')[0])
      .eq('estado', 'finalizado');

    if (error) throw error;

    const userPartidos = partidos.filter((partido) =>
      partido.jugadores?.some((j) => j.uuid === user.id || j.nombre === user.email),
    );

    const ratings = userPartidos.map((p) => {
      const userPlayer = p.jugadores?.find((j) => j.uuid === user.id || j.nombre === user.email);
      return userPlayer?.score || 5;
    });
    const promedioRating = ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0;

    const chartData = generateChartData(userPartidos, period);
    const logros = await calculateLogros(partidos);

    return {
      total: userPartidos.length,
      promedioRating: promedioRating,
      chartData,
      record: userPartidos.length,
      logros,
    };
  };

  const getAmigosStats = async (dateRange) => {
    const { data: partidos, error } = await supabase
      .from('partidos')
      .select('*')
      .gte('fecha', dateRange.start.split('T')[0])
      .lte('fecha', dateRange.end.split('T')[0])
      .eq('estado', 'finalizado');

    if (error) throw error;

    const userPartidos = partidos.filter((partido) =>
      partido.jugadores?.some((j) => j.uuid === user.id || j.nombre === user.email),
    );

    const amigosCount = {};
    const amigosInfo = {};

    userPartidos.forEach((partido) => {
      partido.jugadores?.forEach((jugador) => {
        if (jugador.uuid !== user.id && jugador.nombre !== user.email) {
          const key = jugador.uuid || jugador.nombre;
          amigosCount[key] = (amigosCount[key] || 0) + 1;
          if (!amigosInfo[key]) {
            amigosInfo[key] = {
              nombre: jugador.nombre || key,
              avatar: jugador.foto_url || '/profile.svg',
              uuid: jugador.uuid,
            };
          }
        }
      });
    });

    const userIds = Object.keys(amigosInfo).filter((key) => amigosInfo[key].uuid);
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from('usuarios')
        .select('id, nombre, avatar_url, lesion_activa')
        .in('id', userIds);

      profiles?.forEach((profile) => {
        if (amigosInfo[profile.id]) {
          amigosInfo[profile.id].nombre = profile.nombre;
          amigosInfo[profile.id].avatar = profile.avatar_url || '/profile.svg';
          amigosInfo[profile.id].lesion_activa = profile.lesion_activa;
        }
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
      partido.jugadores?.some((j) => j.uuid === user.id || j.nombre === user.email),
    );

    const logros = [];

    // Obtener total histórico de todos los partidos
    const [{ data: todosPartidos }, { data: partidosManualesHistoricos }] = await Promise.all([
      supabase.from('partidos').select('*').eq('estado', 'finalizado'),
      supabase.from('partidos_manuales').select('*').eq('usuario_id', user.id),
    ]);

    const totalPartidosNormales = todosPartidos?.filter((partido) =>
      partido.jugadores?.some((j) => j.uuid === user.id || j.nombre === user.email),
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
    logros.push({
      titulo: 'Mejor Mes',
      valor: mejorMes ? `${mejorMes[1]} partidos` : '0 partidos',
      detalle: mejorMes ? mejorMes[0] : 'Sin partidos aún',
      icono: '🏆',
    });

    // Mejor rating (siempre mostrar)
    let mejorRating = 0;
    if (userPartidos.length > 0) {
      const ratings = userPartidos.map((p) => {
        const userPlayer = p.jugadores?.find((j) => j.uuid === user.id || j.nombre === user.email);
        return userPlayer?.score || 5;
      });
      mejorRating = Math.max(...ratings);
    }

    logros.push({
      titulo: 'Mejor Rating',
      valor: mejorRating > 0 ? mejorRating.toFixed(1) : '0.0',
      detalle: mejorRating > 0 ? 'En un partido' : 'Sin partidos aún',
      icono: '⭐',
    });

    // MVP (siempre mostrar)
    logros.push({
      titulo: 'MVP del Partido',
      valor: `${mvpCount} ${mvpCount === 1 ? 'vez' : 'veces'}`,
      detalle: `En ${selectedYear}`,
      icono: '🏅',
    });

    // Guante Dorado (siempre mostrar)
    logros.push({
      titulo: 'Guante Dorado',
      valor: `${guanteDoradoCount} ${guanteDoradoCount === 1 ? 'vez' : 'veces'}`,
      detalle: `En ${selectedYear}`,
      icono: '🥅',
    });

    // Tarjeta Roja (siempre mostrar)
    logros.push({
      titulo: 'Tarjeta Roja',
      valor: `${tarjetaRojaCount} ${tarjetaRojaCount === 1 ? 'vez' : 'veces'}`,
      detalle: `En ${selectedYear}`,
      icono: '🟥',
    });

    // Total Histórico (siempre mostrar)
    logros.push({
      titulo: 'Total Histórico',
      valor: `${totalHistorico} partidos`,
      detalle: 'Desde el inicio',
      icono: '📊',
    });



    return logros;
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
    const chartData = generateChartData(partidosManuales || [], period, true);

    return {
      total: partidosManuales?.length || 0,
      amistosos,
      torneos,
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

    return {
      activa: lesionActiva,
      ultima: ultimaLesion,
    };
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
    return (
      <div className="min-h-screen pb-[100px]">
        <PageTitle onBack={onVolver}>ESTADÍSTICAS</PageTitle>
        <div className="flex justify-center items-center h-[50vh]">
          <div className="w-10 h-10 border-4 border-white/30 border-t-white rounded-full animate-spin"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-[100px]">
      <PageTitle onBack={onVolver}>ESTADÍSTICAS</PageTitle>

      <div className="pt-[100px] px-5 pb-5 max-w-[100vw] m-0 box-border md:pt-[90px] md:px-4 sm:pt-[90px]">
        <div className="grid grid-cols-4 gap-4 mb-6 md:grid-cols-2 md:gap-3 sm:gap-2">
          <motion.div
            className="bg-white/10 rounded-2xl p-5 text-center backdrop-blur-md border border-white/20 transition-all hover:-translate-y-1 hover:shadow-xl hover:bg-white/15 md:p-4"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <div className="text-[32px] mb-2 md:text-2xl">⚽</div>
            <div className="font-oswald text-4xl font-bold text-white mb-1 leading-none md:text-[28px]">
              <CountUp end={stats.partidosJugados} duration={1.5} />
            </div>
            <div className="font-oswald text-xs font-medium text-white/80 uppercase tracking-wide">Partidos Jugados</div>
          </motion.div>

          <motion.div
            className="bg-white/10 rounded-2xl p-5 text-center backdrop-blur-md border border-white/20 transition-all hover:-translate-y-1 hover:shadow-xl hover:bg-white/15 md:p-4"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <div className="text-[32px] mb-2 md:text-2xl">🤝</div>
            <div className="font-oswald text-4xl font-bold text-white mb-1 leading-none md:text-[28px]">
              <CountUp end={stats.amistosos} duration={1.5} />
            </div>
            <div className="font-oswald text-xs font-medium text-white/80 uppercase tracking-wide">Amistosos</div>
          </motion.div>

          <motion.div
            className="bg-white/10 rounded-2xl p-5 text-center backdrop-blur-md border border-white/20 transition-all hover:-translate-y-1 hover:shadow-xl hover:bg-white/15 md:p-4"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            <div className="text-[32px] mb-2 md:text-2xl">🏆</div>
            <div className="font-oswald text-4xl font-bold text-white mb-1 leading-none md:text-[28px]">
              <CountUp end={stats.torneos} duration={1.5} />
            </div>
            <div className="font-oswald text-xs font-medium text-white/80 uppercase tracking-wide">Torneos</div>
          </motion.div>

          <motion.div
            className="bg-white/10 rounded-2xl p-5 text-center backdrop-blur-md border border-white/20 transition-all hover:-translate-y-1 hover:shadow-xl hover:bg-white/15 md:p-4"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
          >
            <div className="text-[32px] mb-2 md:text-2xl">⭐</div>
            <div className="font-oswald text-4xl font-bold text-white mb-1 leading-none md:text-[28px]">
              <CountUp end={stats.promedioRating} decimals={1} duration={1.5} />
            </div>
            <div className="font-oswald text-xs font-medium text-white/80 uppercase tracking-wide">Rating Promedio</div>
          </motion.div>
        </div>

        <div className="flex gap-2 mb-6 justify-center md:gap-1">
          {['year', 'month', 'week'].map((p) => (
            <div key={p} className="relative flex-1 max-w-[120px] sm:max-w-none">
              <button
                className={`w-full px-5 py-3 bg-white/10 border-2 border-white/20 rounded-xl text-white/80 font-oswald text-base font-semibold cursor-pointer transition-all duration-300 uppercase flex items-center justify-center gap-1 hover:bg-white/15 hover:text-white md:px-4 md:py-2.5 md:text-sm sm:px-3 sm:py-2 sm:text-xs ${period === p ? 'bg-white/20 border-white/50 text-white -translate-y-0.5 shadow-md' : ''}`}
                onClick={() => {
                  setPeriod(p);
                  if (p === 'year') setShowYearDropdown(!showYearDropdown);
                  if (p === 'month') setShowMonthDropdown(!showMonthDropdown);
                  if (p === 'week') {
                    setShowYearDropdown(false);
                    setShowMonthDropdown(false);
                  }
                }}
              >
                {periodLabels[p]}
                {p !== 'week' && <span className="text-[10px] opacity-70">▼</span>}
              </button>

              {p === 'year' && showYearDropdown && period === 'year' && (
                <div className="absolute top-full left-0 right-0 bg-black/90 rounded-lg border border-white/20 z-[1000] mt-1 max-h-[200px] overflow-y-auto backdrop-blur-md md:max-h-[150px]">
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
                <div className="absolute top-full left-0 right-0 bg-black/90 rounded-lg border border-white/20 z-[1000] mt-1 max-h-[200px] overflow-y-auto backdrop-blur-md md:max-h-[150px]">
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

        <div className="grid grid-cols-2 gap-3 mb-6 sm:grid-cols-1 sm:gap-2">
          <motion.button
            className="flex items-center justify-center gap-2 px-5 py-4 border-none rounded-xl font-oswald text-sm font-semibold uppercase cursor-pointer transition-all backdrop-blur-md border border-white/20 bg-primary/80 text-white hover:bg-primary hover:-translate-y-0.5 hover:shadow-[0_8px_32px_rgba(129,120,229,0.3)] md:px-4 md:py-3 md:text-xs sm:py-3.5"
            onClick={() => setShowManualMatchModal(true)}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <span className="text-lg">⚽</span>
            <span className="text-xs leading-none">Sumar Partido Manual</span>
          </motion.button>

          <motion.button
            className="flex items-center justify-center gap-2 px-5 py-4 border-none rounded-xl font-oswald text-sm font-semibold uppercase cursor-pointer transition-all backdrop-blur-md border border-white/20 bg-[#ff6b6b]/80 text-white hover:bg-[#ff6b6b] hover:-translate-y-0.5 hover:shadow-lg md:px-4 md:py-3 md:text-xs sm:py-3.5"
            onClick={() => setShowInjuryModal(true)}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6 }}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <span className="text-lg">🏥</span>
            <span className="text-xs leading-none">Registrar Lesión</span>
          </motion.button>
        </div>

        {formatInjuryStatus() && (
          <motion.div
            className={`flex items-center gap-3 bg-white/10 rounded-xl p-4 mb-6 backdrop-blur-md border border-white/20 md:p-3 md:gap-2.5 ${formatInjuryStatus().type === 'active' ? 'bg-[#ff6b6b]/20 border-[#ff6b6b]/30' : 'bg-[#4CAF50]/20 border-[#4CAF50]/30'}`}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.7 }}
          >
            <div className="text-2xl shrink-0">
              {formatInjuryStatus().type === 'active' ? '🏥' : '✅'}
            </div>
            <div className="flex-1">
              <div className="font-oswald text-base font-semibold text-white mb-1 md:text-sm">{formatInjuryStatus().text}</div>
              <div className="font-oswald text-sm font-normal text-white/80 md:text-xs">{formatInjuryStatus().subtext}</div>
            </div>
          </motion.div>
        )}

        {stats.chartData.length > 0 && (
          <motion.div
            className="bg-white/10 rounded-2xl p-5 mb-6 backdrop-blur-md border border-white/20"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.8 }}
          >
            <h3 className="font-oswald text-lg font-semibold text-white mb-4 text-center uppercase">Partidos por {periodLabels[period]}</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={stats.chartData}>
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: 'rgba(255,255,255,0.8)', fontSize: 12 }} />
                <YAxis hide />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="amistosos" fill="#242ad8ff" radius={[4, 4, 0, 0]} />
                <Bar dataKey="torneos" fill="#FF9800" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <div className="flex justify-center gap-5 mt-3 sm:flex-col sm:gap-2 sm:items-center">
              <div className="flex items-center gap-1.5 font-oswald text-xs text-white/80">
                <div className="w-3 h-3 rounded-[2px] bg-[#242ad8ff]"></div>
                <span>Amistosos</span>
              </div>
              <div className="flex items-center gap-1.5 font-oswald text-xs text-white/80">
                <div className="w-3 h-3 rounded-[2px] bg-[#FF9800]"></div>
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
            <div className="bg-[#ffd700]/20 text-[#ffd700] px-3 py-1.5 rounded-full font-oswald text-xs font-semibold uppercase mb-3 inline-block border border-[#ffd700]/30">🏆 Top Friend</div>
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
          <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3 mt-4 md:grid-cols-2 sm:grid-cols-1">
            {stats.logros.map((logro, index) => (
              <motion.div
                key={index}
                className="bg-white/10 rounded-xl p-4 backdrop-blur-md border border-white/20 text-center transition-all hover:-translate-y-0.5 hover:bg-white/15 md:p-3"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 1.1 + index * 0.1 }}
              >
                <div className="text-2xl mb-2">{logro.icono}</div>
                <div className="flex-1">
                  <div className="font-oswald text-xs font-semibold text-white/80 uppercase mb-1">{logro.titulo}</div>
                  <div className="font-oswald text-lg font-bold text-white mb-0.5">{logro.valor}</div>
                  <div className="font-oswald text-[10px] text-white/60">{logro.detalle}</div>
                </div>
              </motion.div>
            ))}
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
            <div className="text-[64px] mb-4">📊</div>
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