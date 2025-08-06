import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import CountUp from 'react-countup';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';
import { supabase } from '../supabase';
import { useAuth } from './AuthProvider';
import PageTitle from './PageTitle';
import ManualMatchModal from './ManualMatchModal';
import InjuryModal from './InjuryModal';
import './StatsView.css';

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
    ultimaLesion: null
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
        getLesionesStats()
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
        ultimaLesion: lesionesData.ultima
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
      case 'week':
        const now = new Date();
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
        end = now;
        break;
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

    const userPartidos = partidos.filter(partido => 
      partido.jugadores?.some(j => j.uuid === user.id || j.nombre === user.email)
    );

    const ratings = userPartidos.map(p => {
      const userPlayer = p.jugadores?.find(j => j.uuid === user.id || j.nombre === user.email);
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
      logros
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

    const userPartidos = partidos.filter(partido => 
      partido.jugadores?.some(j => j.uuid === user.id || j.nombre === user.email)
    );

    const amigosCount = {};
    const amigosInfo = {};
    
    userPartidos.forEach(partido => {
      partido.jugadores?.forEach(jugador => {
        if (jugador.uuid !== user.id && jugador.nombre !== user.email) {
          const key = jugador.uuid || jugador.nombre;
          amigosCount[key] = (amigosCount[key] || 0) + 1;
          if (!amigosInfo[key]) {
            amigosInfo[key] = {
              nombre: jugador.nombre || key,
              avatar: jugador.foto_url || '/profile.svg',
              uuid: jugador.uuid
            };
          }
        }
      });
    });

    const userIds = Object.keys(amigosInfo).filter(key => amigosInfo[key].uuid);
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from('usuarios')
        .select('id, nombre, avatar_url, lesion_activa')
        .in('id', userIds);
      
      profiles?.forEach(profile => {
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
        color: getAvatarColor(amigosInfo[key].nombre)
      }))
      .sort((a, b) => b.partidos - a.partidos)
      .slice(0, 5);

    return {
      distintos: Object.keys(amigosCount).length,
      top5: topAmigos
    };
  };

  const calculateLogros = async (allPartidos) => {
    const userPartidos = allPartidos.filter(partido => 
      partido.jugadores?.some(j => j.uuid === user.id || j.nombre === user.email)
    );

    const logros = [];

    // Obtener total histórico de todos los partidos
    const [{ data: todosPartidos }, { data: partidosManualesHistoricos }] = await Promise.all([
      supabase.from('partidos').select('*').eq('estado', 'finalizado'),
      supabase.from('partidos_manuales').select('*').eq('usuario_id', user.id)
    ]);
    
    const totalPartidosNormales = todosPartidos?.filter(partido => 
      partido.jugadores?.some(j => j.uuid === user.id || j.nombre === user.email)
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
    const mvpCount = surveys?.filter(survey => 
      survey.mejor_jugador === user.id || survey.mejor_jugador === user.email
    ).length || 0;
    
    // Contar Guantes Dorados
    const guanteDoradoCount = surveys?.filter(survey => 
      survey.guante_dorado === user.id || survey.guante_dorado === user.email
    ).length || 0;
    
    // Contar Tarjetas Rojas
    const tarjetaRojaCount = surveys?.filter(survey => 
      survey.tarjeta_roja === user.id || survey.tarjeta_roja === user.email
    ).length || 0;

    // Mejor mes (siempre mostrar)
    const partidosPorMes = {};
    userPartidos.forEach(partido => {
      const key = new Date(partido.fecha).toLocaleDateString('es-ES', { year: 'numeric', month: 'long' });
      partidosPorMes[key] = (partidosPorMes[key] || 0) + 1;
    });
    
    const mejorMes = Object.entries(partidosPorMes).sort((a, b) => b[1] - a[1])[0];
    logros.push({
      titulo: 'Mejor Mes',
      valor: mejorMes ? `${mejorMes[1]} partidos` : '0 partidos',
      detalle: mejorMes ? mejorMes[0] : 'Sin partidos aún',
      icono: '🏆'
    });

    // Mejor rating (siempre mostrar)
    let mejorRating = 0;
    if (userPartidos.length > 0) {
      const ratings = userPartidos.map(p => {
        const userPlayer = p.jugadores?.find(j => j.uuid === user.id || j.nombre === user.email);
        return userPlayer?.score || 5;
      });
      mejorRating = Math.max(...ratings);
    }
    
    logros.push({
      titulo: 'Mejor Rating',
      valor: mejorRating > 0 ? mejorRating.toFixed(1) : '0.0',
      detalle: mejorRating > 0 ? 'En un partido' : 'Sin partidos aún',
      icono: '⭐'
    });

    // MVP (siempre mostrar)
    logros.push({
      titulo: 'MVP del Partido',
      valor: `${mvpCount} ${mvpCount === 1 ? 'vez' : 'veces'}`,
      detalle: `En ${selectedYear}`,
      icono: '🏅'
    });
    
    // Guante Dorado (siempre mostrar)
    logros.push({
      titulo: 'Guante Dorado',
      valor: `${guanteDoradoCount} ${guanteDoradoCount === 1 ? 'vez' : 'veces'}`,
      detalle: `En ${selectedYear}`,
      icono: '🥅'
    });
    
    // Tarjeta Roja (siempre mostrar)
    logros.push({
      titulo: 'Tarjeta Roja',
      valor: `${tarjetaRojaCount} ${tarjetaRojaCount === 1 ? 'vez' : 'veces'}`,
      detalle: `En ${selectedYear}`,
      icono: '🟥'
    });

    // Total Histórico (siempre mostrar)
    logros.push({
      titulo: 'Total Histórico',
      valor: `${totalHistorico} partidos`,
      detalle: 'Desde el inicio',
      icono: '📊'
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
    return nombre.split(' ').map(word => word.charAt(0)).join('').toUpperCase().slice(0, 2);
  };

  const getPartidosManualesStats = async (dateRange) => {
    const { data: partidosManuales, error } = await supabase
      .from('partidos_manuales')
      .select('*')
      .eq('usuario_id', user.id)
      .gte('fecha', dateRange.start.split('T')[0])
      .lte('fecha', dateRange.end.split('T')[0]);

    if (error) throw error;

    const amistosos = partidosManuales?.filter(p => p.tipo_partido === 'amistoso').length || 0;
    const torneos = partidosManuales?.filter(p => p.tipo_partido === 'torneo').length || 0;
    const chartData = generateChartData(partidosManuales || [], period, true);

    return {
      total: partidosManuales?.length || 0,
      amistosos,
      torneos,
      chartData
    };
  };

  const getLesionesStats = async () => {
    const { data: lesiones, error } = await supabase
      .from('lesiones')
      .select('*')
      .eq('usuario_id', user.id)
      .order('fecha_inicio', { ascending: false });

    if (error) throw error;

    const lesionActiva = lesiones?.find(l => !l.fecha_fin);
    const ultimaLesion = lesiones?.find(l => l.fecha_fin) || lesiones?.[0];

    return {
      activa: lesionActiva,
      ultima: ultimaLesion
    };
  };

  const generateChartData = (partidos, period, isManual = false) => {
    const data = {};
    
    partidos.forEach(partido => {
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
      torneos: counts.torneos || 0
    }));
  };

  const mergeChartData = (chartData1, chartData2) => {
    const merged = {};
    
    [...chartData1, ...chartData2].forEach(item => {
      if (!merged[item.name]) {
        merged[item.name] = { name: item.name, amistosos: 0, torneos: 0 };
      }
      merged[item.name].amistosos += item.amistosos || 0;
      merged[item.name].torneos += item.torneos || 0;
    });
    
    return Object.values(merged).map(item => ({
      ...item,
      total: item.amistosos + item.torneos
    }));
  };

  const formatInjuryStatus = () => {
    if (stats.lesionActiva) {
      const diasDesde = Math.floor((new Date() - new Date(stats.lesionActiva.fecha_inicio)) / (1000 * 60 * 60 * 24));
      return {
        text: `En recuperación desde ${new Date(stats.lesionActiva.fecha_inicio).toLocaleDateString('es-ES')}`,
        subtext: `${stats.lesionActiva.tipo_lesion} - ${diasDesde} días`,
        type: 'active'
      };
    }
    
    if (stats.ultimaLesion && stats.ultimaLesion.fecha_fin) {
      const diasDesde = Math.floor((new Date() - new Date(stats.ultimaLesion.fecha_fin)) / (1000 * 60 * 60 * 24));
      return {
        text: `Última lesión: ${diasDesde} días atrás`,
        subtext: stats.ultimaLesion.tipo_lesion,
        type: 'recovered'
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
    week: 'Semana'
  };

  const monthNames = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  ];

  const getAvailableYears = () => {
    const currentYear = new Date().getFullYear();
    return Array.from({ length: 5 }, (_, i) => currentYear - i);
  };

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      const amistosos = payload.find(p => p.dataKey === 'amistosos')?.value || 0;
      const torneos = payload.find(p => p.dataKey === 'torneos')?.value || 0;
      const total = amistosos + torneos;
      
      return (
        <div className="chart-tooltip">
          <p className="tooltip-label">{`${label}`}</p>
          <p className="tooltip-value">
            {`${total} partido${total !== 1 ? 's' : ''}`}
          </p>
          {amistosos > 0 && (
            <p className="tooltip-detail">
              {`${amistosos} amistoso${amistosos !== 1 ? 's' : ''}`}
            </p>
          )}
          {torneos > 0 && (
            <p className="tooltip-detail">
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
      <div className="stats-bg">
        <PageTitle onBack={onVolver}>ESTADÍSTICAS</PageTitle>
        <div className="stats-loading">
          <div className="loading-spinner"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="stats-bg">
      <PageTitle onBack={onVolver}>ESTADÍSTICAS</PageTitle>
      
      <div className="stats-container">
        <div className="kpi-grid">
          <motion.div 
            className="kpi-card"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <div className="kpi-icon">⚽</div>
            <div className="kpi-number">
              <CountUp end={stats.partidosJugados} duration={1.5} />
            </div>
            <div className="kpi-label">Partidos Jugados</div>
          </motion.div>

          <motion.div 
            className="kpi-card"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <div className="kpi-icon">🤝</div>
            <div className="kpi-number">
              <CountUp end={stats.amistosos} duration={1.5} />
            </div>
            <div className="kpi-label">Amistosos</div>
          </motion.div>

          <motion.div 
            className="kpi-card"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            <div className="kpi-icon">🏆</div>
            <div className="kpi-number">
              <CountUp end={stats.torneos} duration={1.5} />
            </div>
            <div className="kpi-label">Torneos</div>
          </motion.div>

          <motion.div 
            className="kpi-card"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
          >
            <div className="kpi-icon">⭐</div>
            <div className="kpi-number">
              <CountUp end={stats.promedioRating} decimals={1} duration={1.5} />
            </div>
            <div className="kpi-label">Rating Promedio</div>
          </motion.div>
        </div>

        <div className="period-filters">
          {['year', 'month', 'week'].map((p) => (
            <div key={p} className="period-filter-container">
              <button
                className={`period-btn ${period === p ? 'active' : ''}`}
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
                {p !== 'week' && <span className="dropdown-arrow">▼</span>}
              </button>
              
              {p === 'year' && showYearDropdown && period === 'year' && (
                <div className="period-dropdown">
                  {getAvailableYears().map(year => (
                    <div
                      key={year}
                      className={`dropdown-item ${selectedYear === year ? 'active' : ''}`}
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
                <div className="period-dropdown">
                  {monthNames.map((month, index) => (
                    <div
                      key={index}
                      className={`dropdown-item ${selectedMonth === index ? 'active' : ''}`}
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

        <div className="action-buttons">
          <motion.button
            className="action-btn manual-match-btn"
            onClick={() => setShowManualMatchModal(true)}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <span className="btn-icon">⚽</span>
            <span className="btn-text">Sumar Partido Manual</span>
          </motion.button>
          
          <motion.button
            className="action-btn injury-btn"
            onClick={() => setShowInjuryModal(true)}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6 }}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <span className="btn-icon">🏥</span>
            <span className="btn-text">Registrar Lesión</span>
          </motion.button>
        </div>

        {formatInjuryStatus() && (
          <motion.div 
            className={`injury-status ${formatInjuryStatus().type}`}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.7 }}
          >
            <div className="injury-icon">
              {formatInjuryStatus().type === 'active' ? '🏥' : '✅'}
            </div>
            <div className="injury-info">
              <div className="injury-text">{formatInjuryStatus().text}</div>
              <div className="injury-subtext">{formatInjuryStatus().subtext}</div>
            </div>
          </motion.div>
        )}

        {stats.chartData.length > 0 && (
          <motion.div 
            className="chart-container"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.8 }}
          >
            <h3 className="chart-title">Partidos por {periodLabels[period]}</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={stats.chartData}>
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: 'rgba(255,255,255,0.8)', fontSize: 12 }} />
                <YAxis hide />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="amistosos" fill="#242ad8ff" radius={[4, 4, 0, 0]} />
                <Bar dataKey="torneos" fill="#FF9800" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <div className="chart-legend">
              <div className="legend-item">
                <div className="legend-color" style={{ backgroundColor: '#242ad8ff' }}></div>
                <span>Amistosos</span>
              </div>
              <div className="legend-item">
                <div className="legend-color" style={{ backgroundColor: '#FF9800' }}></div>
                <span>Torneos</span>
              </div>
            </div>
          </motion.div>
        )}

        {stats.topFriend && (
          <motion.div 
            className="top-friend-card"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.9 }}
          >
            <div className="top-friend-badge">🏆 Top Friend</div>
            <div className="top-friend-info">
              <img src={stats.topFriend.avatar} alt={stats.topFriend.nombre} className="top-friend-avatar" />
              <div>
                <div className="top-friend-name">{stats.topFriend.nombre}</div>
                <div className="top-friend-count">{stats.topFriend.partidos} partidos juntos</div>
              </div>
            </div>
          </motion.div>
        )}

        <motion.div 
          className="logros-section"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.0 }}
        >
            <h3 className="section-title">Logros</h3>
            <div className="logros-grid">
              {stats.logros.map((logro, index) => (
                <motion.div
                  key={index}
                  className="logro-card"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 1.1 + index * 0.1 }}
                >
                  <div className="logro-icon">{logro.icono}</div>
                  <div className="logro-info">
                    <div className="logro-titulo">{logro.titulo}</div>
                    <div className="logro-valor">{logro.valor}</div>
                    <div className="logro-detalle">{logro.detalle}</div>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}

        {stats.topAmigos.length > 0 && (
          <motion.div 
            className="top-amigos-section"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.2 }}
          >
            <h3 className="section-title">Amigos con los que más jugaste</h3>
            <AnimatePresence>
              {stats.topAmigos.map((amigo, index) => (
                <motion.div
                  key={amigo.nombre}
                  className="amigo-stat-card"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 1.3 + index * 0.1 }}
                >
                  <div className="amigo-rank">#{index + 1}</div>
                  <div className="amigo-avatar-container">
                    {amigo.avatar && amigo.avatar !== '/profile.svg' ? (
                      <img src={amigo.avatar} alt={amigo.nombre} className="amigo-avatar" />
                    ) : (
                      <div 
                        className="amigo-avatar-initials"
                        style={{ backgroundColor: amigo.color }}
                      >
                        {getInitials(amigo.nombre)}
                      </div>
                    )}
                  </div>
                  <div className="amigo-info">
                    <div className="amigo-name">{amigo.nombre}</div>
                    <div className="amigo-count">{amigo.partidos} partidos</div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>
        )}

        {stats.partidosJugados === 0 && (
          <motion.div 
            className="no-data-message"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
          >
            <div className="no-data-icon">📊</div>
            <div className="no-data-text">
              ¡Todavía no jugaste ningún partido {period === 'week' ? 'esta semana' : period === 'month' ? `en ${monthNames[selectedMonth]} ${selectedYear}` : `en ${selectedYear}`}!
            </div>
            <div className="no-data-subtitle">¡Animate a jugar tu primer partido!</div>
          </motion.div>
        )}
        
        <div className="last-updated">
          Datos actualizados al {new Date().toLocaleDateString('es-ES', { 
            day: 'numeric', 
            month: 'long', 
            year: 'numeric' 
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