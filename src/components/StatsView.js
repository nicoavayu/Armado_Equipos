import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import CountUp from 'react-countup';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer } from 'recharts';
import { supabase } from '../supabase';
import { useAuth } from './AuthProvider';
import PageTitle from './PageTitle';
import './StatsView.css';

const StatsView = ({ onVolver }) => {
  const { user } = useAuth();
  const [period, setPeriod] = useState('year');
  const [stats, setStats] = useState({
    partidosJugados: 0,
    amigosDistintos: 0,
    promedioRating: 0,
    chartData: [],
    topAmigos: [],
    topFriend: null,
    recordPersonal: null
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      loadStats();
    }
  }, [user, period]);

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
        recordPersonal: partidosData.record
      });
    } catch (error) {
      console.error('Error loading stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const getDateRange = (period) => {
    const now = new Date();
    let start, end = now;

    switch (period) {
      case 'week':
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
        break;
      case 'month':
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'year':
      default:
        start = new Date(now.getFullYear(), 0, 1);
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

    return {
      total: userPartidos.length,
      promedioRating: promedioRating,
      chartData,
      record: userPartidos.length
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

    // Contar amigos
    const amigosCount = {};
    userPartidos.forEach(partido => {
      partido.jugadores?.forEach(jugador => {
        if (jugador.uuid !== user.id && jugador.nombre !== user.email) {
          const key = jugador.uuid || jugador.nombre;
          amigosCount[key] = (amigosCount[key] || 0) + 1;
        }
      });
    });

    const topAmigos = Object.entries(amigosCount)
      .map(([key, count]) => ({
        nombre: key,
        partidos: count,
        avatar: '/profile.svg'
      }))
      .sort((a, b) => b.partidos - a.partidos)
      .slice(0, 5);

    return {
      distintos: Object.keys(amigosCount).length,
      top5: topAmigos
    };
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
            <button
              key={p}
              className={`period-btn ${period === p ? 'active' : ''}`}
              onClick={() => setPeriod(p)}
            >
              {periodLabels[p]}
            </button>
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
                <XAxis dataKey="name" axisLine={false} tickLine={false} />
                <YAxis hide />
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

        {/* Top 5 amigos */}
        {stats.topAmigos.length > 0 && (
          <motion.div 
            className="top-amigos-section"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6 }}
          >
            <h3 className="section-title">Amigos con los que más jugaste</h3>
            <AnimatePresence>
              {stats.topAmigos.map((amigo, index) => (
                <motion.div
                  key={amigo.nombre}
                  className="amigo-stat-card"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.7 + index * 0.1 }}
                >
                  <div className="amigo-rank">#{index + 1}</div>
                  <img src={amigo.avatar} alt={amigo.nombre} className="amigo-avatar" />
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
              ¡Todavía no jugaste ningún partido {period === 'week' ? 'esta semana' : period === 'month' ? 'este mes' : 'este año'}!
            </div>
            <div className="no-data-subtitle">¡Animate a jugar tu primer partido!</div>
          </motion.div>
        )}
      </div>
    </div>
  );
};

export default StatsView;