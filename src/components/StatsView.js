import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import CountUp from 'react-countup';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';
import { supabase } from '../supabase';
import { useAuth } from './AuthProvider';
import PageTitle from './PageTitle';
import './StatsView.css';

const StatsView = ({ onVolver }) => {
  const { user } = useAuth();
  const [period, setPeriod] = useState('year');
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth());
  const [showYearDropdown, setShowYearDropdown] = useState(false);
  const [showMonthDropdown, setShowMonthDropdown] = useState(false);
  const [stats, setStats] = useState({
    partidosJugados: 0,
    amigosDistintos: 0,
    promedioRating: 0,
    chartData: [],
    topAmigos: [],
    topFriend: null,
    recordPersonal: null,
    logros: []
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
      const [partidosData, amigosData] = await Promise.all([
        getPartidosStats(dateRange),
        getAmigosStats(dateRange)
      ]);

      setStats({
        partidosJugados: partidosData.total,
        amigosDistintos: amigosData.distintos,
        promedioRating: partidosData.promedioRating,
        chartData: partidosData.chartData,
        topAmigos: amigosData.top5,
        topFriend: amigosData.top5[0] || null,
        recordPersonal: partidosData.record,
        logros: partidosData.logros
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

    // Filtrar partidos donde el usuario participó
    const userPartidos = partidos.filter(partido => 
      partido.jugadores?.some(j => j.uuid === user.id || j.nombre === user.email)
    );

    // Calcular promedio de rating
    const ratings = userPartidos.map(p => {
      const userPlayer = p.jugadores?.find(j => j.uuid === user.id || j.nombre === user.email);
      return userPlayer?.score || 5;
    });
    const promedioRating = ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0;

    // Generar datos para el gráfico
    const chartData = generateChartData(userPartidos, period);

    // Calcular logros/récords
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

    // Contar amigos y obtener sus perfiles
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

    // Obtener perfiles reales de usuarios
    const userIds = Object.keys(amigosInfo).filter(key => amigosInfo[key].uuid);
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from('usuarios')
        .select('id, nombre, avatar_url')
        .in('id', userIds);
      
      profiles?.forEach(profile => {
        if (amigosInfo[profile.id]) {
          amigosInfo[profile.id].nombre = profile.nombre;
          amigosInfo[profile.id].avatar = profile.avatar_url || '/profile.svg';
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

    // Mejor mes histórico
    const partidosPorMes = {};
    userPartidos.forEach(partido => {
      const key = new Date(partido.fecha).toLocaleDateString('es-ES', { year: 'numeric', month: 'long' });
      partidosPorMes[key] = (partidosPorMes[key] || 0) + 1;
    });
    
    const mejorMes = Object.entries(partidosPorMes).sort((a, b) => b[1] - a[1])[0];
    if (mejorMes) {
      logros.push({
        titulo: 'Mejor Mes',
        valor: `${mejorMes[1]} partidos`,
        detalle: mejorMes[0],
        icono: '🏆'
      });
    }

    // Mejor rating promedio
    const ratings = userPartidos.map(p => {
      const userPlayer = p.jugadores?.find(j => j.uuid === user.id || j.nombre === user.email);
      return userPlayer?.score || 5;
    });
    const mejorRating = Math.max(...ratings);
    if (mejorRating > 0) {
      logros.push({
        titulo: 'Mejor Rating',
        valor: mejorRating.toFixed(1),
        detalle: 'En un partido',
        icono: '⭐'
      });
    }

    // Total histórico
    logros.push({
      titulo: 'Total Histórico',
      valor: `${userPartidos.length} partidos`,
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

  const generateChartData = (partidos, period) => {
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

      data[key] = (data[key] || 0) + 1;
    });

    return Object.entries(data).map(([name, partidos]) => ({ name, partidos }));
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
      return (
        <div className="chart-tooltip">
          <p className="tooltip-label">{`${label}`}</p>
          <p className="tooltip-value">
            {`${payload[0].value} partido${payload[0].value !== 1 ? 's' : ''}`}
          </p>
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
        {/* Filtros de período */}
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
              
              {/* Dropdown de años */}
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
              
              {/* Dropdown de meses */}
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

        {/* KPIs animados */}
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
            <div className="kpi-icon">👥</div>
            <div className="kpi-number">
              <CountUp end={stats.amigosDistintos} duration={1.5} />
            </div>
            <div className="kpi-label">Amigos Distintos</div>
          </motion.div>

          <motion.div 
            className="kpi-card"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            <div className="kpi-icon">⭐</div>
            <div className="kpi-number">
              <CountUp end={stats.promedioRating} decimals={1} duration={1.5} />
            </div>
            <div className="kpi-label">Rating Promedio</div>
          </motion.div>
        </div>

        {/* Gráfico de barras */}
        {stats.chartData.length > 0 && (
          <motion.div 
            className="chart-container"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.4 }}
          >
            <h3 className="chart-title">Partidos por {periodLabels[period]}</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={stats.chartData}>
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: 'rgba(255,255,255,0.8)', fontSize: 12 }} />
                <YAxis hide />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="partidos" fill="#0865b2" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </motion.div>
        )}

        {/* Top Friend destacado */}
        {stats.topFriend && (
          <motion.div 
            className="top-friend-card"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.5 }}
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

        {/* Logros/Récords */}
        {stats.logros.length > 0 && (
          <motion.div 
            className="logros-section"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6 }}
          >
            <h3 className="section-title">Logros</h3>
            <div className="logros-grid">
              {stats.logros.map((logro, index) => (
                <motion.div
                  key={index}
                  className="logro-card"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.7 + index * 0.1 }}
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

        {/* Top 5 amigos */}
        {stats.topAmigos.length > 0 && (
          <motion.div 
            className="top-amigos-section"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.7 }}
          >
            <h3 className="section-title">Amigos con los que más jugaste</h3>
            <AnimatePresence>
              {stats.topAmigos.map((amigo, index) => (
                <motion.div
                  key={amigo.nombre}
                  className="amigo-stat-card"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.8 + index * 0.1 }}
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

        {/* Mensaje si no hay datos */}
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
        
        {/* Fecha de actualización */}
        <div className="last-updated">
          Datos actualizados al {new Date().toLocaleDateString('es-ES', { 
            day: 'numeric', 
            month: 'long', 
            year: 'numeric' 
          })}
        </div>
      </div>
    </div>
  );
};

export default StatsView;