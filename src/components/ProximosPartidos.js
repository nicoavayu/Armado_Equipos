import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { supabase } from '../supabase';
import LoadingSpinner from './LoadingSpinner';
import './ProximosPartidos.css';

const ProximosPartidos = ({ onClose }) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [partidos, setPartidos] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      fetchUserMatches();
      // Actualizar cada 5 segundos para tiempo real
      const interval = setInterval(fetchUserMatches, 5000);
      return () => clearInterval(interval);
    }
  }, [user]);

  const fetchUserMatches = async () => {
    if (!user) return;
    
    try {
      console.log('[PROXIMOS_PARTIDOS] Fetching matches for user:', user.id);
      
      // 1. Obtener partidos donde el usuario está como jugador
      const { data: jugadoresData, error: jugadoresError } = await supabase
        .from('jugadores')
        .select('partido_id')
        .eq('usuario_id', user.id);
        
      if (jugadoresError) throw jugadoresError;
      
      const partidosComoJugador = jugadoresData?.map((j) => j.partido_id) || [];
      
      // 2. Obtener partidos donde es admin (sin filtrar por estado)
      const { data: partidosComoAdmin, error: adminError } = await supabase
        .from('partidos')
        .select('id')
        .eq('creado_por', user.id);
        
      if (adminError) throw adminError;
      
      const partidosAdminIds = partidosComoAdmin?.map((p) => p.id) || [];
      
      // 3. Combinar ambos arrays y eliminar duplicados
      const todosLosPartidosIds = [...new Set([...partidosComoJugador, ...partidosAdminIds])];
      
      console.log('[PROXIMOS_PARTIDOS] Match IDs found:', {
        asPlayer: partidosComoJugador.length,
        asAdmin: partidosAdminIds.length,
        total: todosLosPartidosIds.length,
      });
      
      if (todosLosPartidosIds.length === 0) {
        setPartidos([]);
        setLoading(false);
        return;
      }
      
      // 4. Obtener datos completos de los partidos (sin filtrar por estado)
      const { data: partidosData, error: partidosError } = await supabase
        .from('partidos')
        .select('*')
        .in('id', todosLosPartidosIds)
        .order('fecha', { ascending: true })
        .order('hora', { ascending: true });
        
      if (partidosError) throw partidosError;
      
      // 5. Filtrar partidos que no hayan pasado más de 1 hora desde su fecha/hora
      const now = new Date();
      const partidosFiltrados = partidosData.filter((partido) => {
        // Si no tiene fecha/hora, mostrar siempre
        if (!partido.fecha || !partido.hora) return true;
        
        const [hours, minutes] = partido.hora.split(':').map(Number);
        const partidoDateTime = new Date(partido.fecha + 'T00:00:00');
        partidoDateTime.setHours(hours, minutes, 0, 0);
        
        // Agregar 1 hora al tiempo del partido
        const partidoMasUnaHora = new Date(partidoDateTime.getTime() + 60 * 60 * 1000);
        
        // Mostrar si no han pasado más de 1 hora desde la fecha del partido
        const shouldShow = now < partidoMasUnaHora;
        
        console.log('[PROXIMOS_PARTIDOS] Match filter check:', {
          matchName: partido.nombre,
          matchDateTime: partidoDateTime.toISOString(),
          matchPlusOneHour: partidoMasUnaHora.toISOString(),
          now: now.toISOString(),
          shouldShow,
          estado: partido.estado,
        });
        
        return shouldShow;
      });
      
      // 6. Enriquecer con información de rol del usuario
      const partidosEnriquecidos = partidosFiltrados.map((partido) => ({
        ...partido,
        userRole: partidosAdminIds.includes(partido.id) ? 'admin' : 'player',
      }));
      
      console.log('[PROXIMOS_PARTIDOS] Enriched matches:', partidosEnriquecidos);
      setPartidos(partidosEnriquecidos);
      
    } catch (error) {
      console.error('[PROXIMOS_PARTIDOS] Error fetching matches:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleMatchClick = (partido) => {
    console.log('[PROXIMOS_PARTIDOS] Navigating to match:', partido.id);
    onClose();
    navigate(`/admin/${partido.id}`);
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('es-ES', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
  };

  const getRoleIcon = (role) => {
    return role === 'admin' ? '👑' : '⚽';
  };

  const getRoleText = (role) => {
    return role === 'admin' ? 'Admin' : 'Jugador';
  };

  return (
    <div className="proximos-partidos-container">
      <div className="proximos-partidos-header">
        <button className="back-button" onClick={onClose}>←</button>
        <h2>Próximos Partidos</h2>
      </div>

      <div className="proximos-partidos-content">
        {loading ? (
          <div className="loading-state">
            <LoadingSpinner size="medium" />
            <p>Cargando partidos...</p>
          </div>
        ) : partidos.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📅</div>
            <p>No tienes partidos próximos</p>
            <span>Crea un partido o únete a uno para verlo aquí</span>
          </div>
        ) : (
          <div className="partidos-list">
            {partidos.map((partido) => (
              <div
                key={partido.id}
                className="partido-item"
                onClick={() => handleMatchClick(partido)}
              >
                <div className="partido-info">
                  <div className="partido-header">
                    <div className="partido-name">
                      {partido.nombre || 'PARTIDO'}
                    </div>
                    <div className="partido-role">
                      <span className="role-icon">{getRoleIcon(partido.userRole)}</span>
                      <span className="role-text">{getRoleText(partido.userRole)}</span>
                    </div>
                  </div>
                  
                  <div className="partido-details">
                    <div className="partido-date">
                      📅 {formatDate(partido.fecha)} • {partido.hora}
                    </div>
                    <div className="partido-location">
                      📍 {partido.sede}
                    </div>
                    <div className="partido-mode">
                      ⚽ {partido.modalidad} • {partido.tipo_partido}
                      {partido.estado === 'equipos_formados' && (
                        <span className="equipos-formados-badge">• Equipos Listos</span>
                      )}
                    </div>
                  </div>
                </div>
                
                <div className="partido-arrow">→</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ProximosPartidos;