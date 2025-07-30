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
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedMatch, setSelectedMatch] = useState(null);

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
        allIds: todosLosPartidosIds,
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
        // Si no tiene fecha/hora, mostrar siempre (partidos recién creados)
        if (!partido.fecha || !partido.hora) {
          console.log('[PROXIMOS_PARTIDOS] Showing match without date/time:', partido.nombre);
          return true;
        }
        
        try {
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
        } catch (error) {
          console.error('[PROXIMOS_PARTIDOS] Error parsing date/time for match:', partido.nombre, error);
          return true; // Mostrar en caso de error de parsing
        }
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

  const handleDeleteClick = (e, partido) => {
    e.stopPropagation();
    setSelectedMatch(partido);
    setShowDeleteModal(true);
  };

  const handleDeleteConfirm = async () => {
    if (!selectedMatch) return;
    
    try {
      if (selectedMatch.userRole === 'admin') {
        // Admin elimina el partido completo
        await supabase.from('partidos').delete().eq('id', selectedMatch.id);
        // TODO: Notificar a todos los jugadores
      } else {
        // Jugador abandona el partido
        await supabase
          .from('jugadores')
          .delete()
          .eq('partido_id', selectedMatch.id)
          .eq('usuario_id', user.id);
        // TODO: Notificar abandono
      }
      
      setShowDeleteModal(false);
      setSelectedMatch(null);
      fetchUserMatches();
    } catch (error) {
      console.error('Error deleting match:', error);
    }
  };

  const getDeleteModalText = () => {
    if (!selectedMatch) return '';
    
    if (selectedMatch.userRole === 'admin') {
      return '¿Seguro que deseas eliminar este partido? Se notificará a todos los jugadores y la estructura se borrará.';
    } else {
      return '¿Seguro que deseas abandonar este partido? Se notificará a todos los jugadores.';
    }
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
        <div className="header-content">
          <button className="back-button" onClick={onClose}>←</button>
          <h2>PRÓXIMOS PARTIDOS</h2>
        </div>
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
              <div key={partido.id} className="partido-card">
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
                
                <div className="partido-actions">
                  <button 
                    className="action-btn enter-btn"
                    onClick={() => handleMatchClick(partido)}
                  >
                    Ingresar al Partido
                  </button>
                  <button 
                    className="action-btn delete-btn"
                    onClick={(e) => handleDeleteClick(e, partido)}
                  >
                    {partido.userRole === 'admin' ? 'Eliminar Partido' : 'Abandonar Partido'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showDeleteModal && (
        <div className="modal-backdrop" onClick={() => setShowDeleteModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Confirmar acción</h3>
            <p>{getDeleteModalText()}</p>
            <div className="modal-actions">
              <button className="modal-btn cancel" onClick={() => setShowDeleteModal(false)}>
                Cancelar
              </button>
              <button className="modal-btn confirm" onClick={handleDeleteConfirm}>
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProximosPartidos;