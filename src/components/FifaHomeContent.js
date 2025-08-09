import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { useNotifications } from '../context/NotificationContext';
import { supabase, updateProfile } from '../supabase';
import { parseLocalDateTime } from '../utils/dateLocal';
import { toBigIntId } from '../utils';
import PanelInfo from './PanelInfo';
import ProximosPartidos from './ProximosPartidos';
import NotificationsBell from './NotificationsBell';
import './FifaHomeContent.css';

const FifaHomeContent = ({ onCreateMatch, onViewHistory, onViewInvitations, onViewActivePlayers }) => {
  const { user, profile, refreshProfile } = useAuth();
  const { unreadCount } = useNotifications();
  const navigate = useNavigate();
  const [activeMatches, setActiveMatches] = useState([]);
  const [recentActivity, setRecentActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showProximosPartidos, setShowProximosPartidos] = useState(false);
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const statusDropdownRef = useRef(null);

  useEffect(() => {
    if (user) {
      fetchActiveMatches();
      fetchRecentActivity();
      
      // Actualizar cada 10 segundos para tiempo real
      const interval = setInterval(() => {
        fetchActiveMatches();
      }, 10000);
      
      return () => clearInterval(interval);
    } else {
      setLoading(false);
    }
  }, [user]);

  const fetchActiveMatches = async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    
    try {
      // Usar la misma lógica que ProximosPartidos.js
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
      const todosLosPartidosIds = [...new Set([...partidosComoJugador, ...partidosAdminIds])];
      
      if (todosLosPartidosIds.length === 0) {
        setActiveMatches([]);
        return;
      }
      
      // Obtener cleared matches
      let clearedMatchIds = new Set();
      try {
        const { data: clearedData, error: clearedError } = await supabase
          .from('cleared_matches')
          .select('partido_id')
          .eq('user_id', user.id);
        
        if (clearedError) {
          const key = `cleared_matches_${user.id}`;
          const existing = JSON.parse(localStorage.getItem(key) || '[]');
          clearedMatchIds = new Set(existing);
        } else {
          clearedMatchIds = new Set(clearedData?.map((c) => c.partido_id) || []);
        }
      } catch (error) {
        const key = `cleared_matches_${user.id}`;
        const existing = JSON.parse(localStorage.getItem(key) || '[]');
        clearedMatchIds = new Set(existing);
      }
      
      // Obtener completed surveys
      let completedSurveys = new Set();
      try {
        const { data: userJugadorIdsData } = await supabase
          .from('jugadores')
          .select('id, partido_id')
          .eq('usuario_id', user.id);
          
        if (userJugadorIdsData?.length > 0) {
          const jugadorIds = userJugadorIdsData.map(j => j.id);
          const { data: surveysData } = await supabase
            .from('post_match_surveys')
            .select('partido_id')
            .in('votante_id', jugadorIds);
          completedSurveys = new Set(surveysData?.map((s) => s.partido_id) || []);
        }
      } catch (error) {
        console.error('Error fetching completed surveys:', error);
      }
      
      const { data: partidosData, error: partidosError } = await supabase
        .from('partidos')
        .select('*')
        .in('id', todosLosPartidosIds)
        .order('fecha', { ascending: true })
        .order('hora', { ascending: true });
        
      if (partidosError) throw partidosError;
      
      const now = new Date();
      const partidosFiltrados = partidosData?.filter((partido) => {
        if (clearedMatchIds.has(partido.id) || completedSurveys.has(partido.id)) {
          return false;
        }
        
        if (!partido.fecha || !partido.hora) return true;
        
        try {
          const partidoDateTime = parseLocalDateTime(partido.fecha, partido.hora);
          if (!partidoDateTime) return true;
          const partidoMasUnaHora = new Date(partidoDateTime.getTime() + 60 * 60 * 1000);
          return now <= partidoMasUnaHora;
        } catch {
          return true;
        }
      }) || [];
      

      setActiveMatches(partidosFiltrados);
    } catch (error) {
      console.error('Error fetching active matches:', error);
    } finally {
      setLoading(false);
    }
  };



  const fetchRecentActivity = async () => {
    try {
      const { data, error } = await supabase
        .from('partidos')
        .select('id, fecha, hora, sede, created_at')
        .order('created_at', { ascending: false })
        .limit(3);
      
      if (error) throw error;
      setRecentActivity(data || []);
    } catch (error) {
      console.error('Error fetching recent activity:', error);
    }
  };

  const getInitial = () => {
    if (profile?.avatar_url) return null;
    return profile?.nombre?.charAt(0) || user?.email?.charAt(0) || '?';
  };
  
  const userName = profile?.nombre || user?.email?.split('@')[0] || 'Usuario';
  const truncatedName = userName.length > 15 ? `${userName.substring(0, 15)}...` : userName;
  const isAvailable = profile?.acepta_invitaciones !== false;
  const statusText = isAvailable ? 'Disponible' : 'Ocupado';
  
  const toggleStatusDropdown = (e) => {
    e.stopPropagation();
    setShowStatusDropdown(!showStatusDropdown);
  };
  
  const handleNotificationsClick = () => {
    navigate('/notifications');
    setShowStatusDropdown(false);
  };
  
  const updateAvailabilityStatus = async (status) => {
    if (!user) return;
    
    try {
      await updateProfile(user.id, { acepta_invitaciones: status });
      await refreshProfile();
      setShowStatusDropdown(false);
    } catch (error) {
      console.error('Error updating availability status:', error);
    }
  };

  // Mostrar ProximosPartidos si está activo
  if (showProximosPartidos) {
    return (
      <ProximosPartidos 
        onClose={() => setShowProximosPartidos(false)}
      />
    );
  }

  return (
    <div className="fifa-home-content">
      {/* Header elements - Avatar and Notifications */}
      {user && (
        <div className="fifa-header-elements">
          <div className="fifa-header-left" ref={statusDropdownRef}>
            <div className="fifa-avatar-container" onClick={toggleStatusDropdown}>
              <div className="fifa-avatar">
                {profile?.avatar_url ? (
                  <img 
                    src={profile.avatar_url} 
                    alt="Profile" 
                  />
                ) : (
                  <div>
                    {getInitial()}
                  </div>
                )}
              </div>
              <div className={`fifa-status-led ${isAvailable ? 'available' : 'unavailable'}`}></div>
            </div>
            
            <div className="fifa-user-info" onClick={toggleStatusDropdown}>
              <div className="fifa-greeting-name">
                <div className="fifa-greeting">Hola,</div>
                <div className="fifa-username">{truncatedName}</div>
              </div>
              <div className={`fifa-status-text ${isAvailable ? 'available' : 'unavailable'}`}>{statusText}</div>
            </div>
            
            {showStatusDropdown && createPortal(
              <div className="fifa-status-dropdown-portal fifa-dropdown-enter">
                <div className="fifa-status-dropdown-header">
                  Estado
                </div>
                <div 
                  className={`fifa-status-option ${isAvailable ? 'active' : ''}`}
                  onClick={() => updateAvailabilityStatus(true)}
                >
                  <div className="fifa-status-dot available"></div>
                  <span>Disponible</span>
                </div>
                <div 
                  className={`fifa-status-option ${!isAvailable ? 'active' : ''}`}
                  onClick={() => updateAvailabilityStatus(false)}
                >
                  <div className="fifa-status-dot unavailable"></div>
                  <span>No disponible</span>
                </div>
              </div>,
              document.body
            )}
          </div>
          
          <div className="fifa-header-right">
            <NotificationsBell 
              unreadCount={unreadCount} 
              onClick={handleNotificationsClick} 
            />
          </div>
        </div>
      )}
      
      <div className="fifa-menu-grid">
        {/* Create New Match */}
        <Link to="/nuevo-partido" className="fifa-menu-button create-match">
          <div className="fifa-button-title">PARTIDO<br />NUEVO</div>
          <div className="fifa-button-icon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" fill="currentColor" width={60} height={60}>
              <path d="M320 576C461.4 576 576 461.4 576 320C576 178.6 461.4 64 320 64C178.6 64 64 178.6 64 320C64 461.4 178.6 576 320 576zM296 408L296 344L232 344C218.7 344 208 333.3 208 320C208 306.7 218.7 296 232 296L296 296L296 232C296 218.7 306.7 208 320 208C333.3 208 344 218.7 344 232L344 296L408 296C421.3 296 432 306.7 432 320C432 333.3 421.3 344 408 344L344 344L344 408C344 421.3 333.3 432 320 432C306.7 432 296 421.3 296 408z"/>
            </svg>
          </div>
        </Link>
        
        {/* Próximos Partidos */}
        <div 
          className="fifa-menu-button active-matches"
          onClick={() => user && setShowProximosPartidos(true)}
        >
          <div className="fifa-button-title">PRÓXIMOS<br />PARTIDOS</div>
          <div className="fifa-button-icon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" fill="currentColor" width={48} height={48}>
              <path d="M64 320C64 461.4 178.6 576 320 576C461.4 576 576 461.4 576 320C576 178.6 461.4 64 320 64C178.6 64 64 178.6 64 320zM305 441C295.6 450.4 280.4 450.4 271.1 441C261.8 431.6 261.7 416.4 271.1 407.1L358.1 320.1L271.1 233.1C261.7 223.7 261.7 208.5 271.1 199.2C280.5 189.9 295.7 189.8 305 199.2L409 303C418.4 312.4 418.4 327.6 409 336.9L305 441z"/>
            </svg>
          </div>
          {activeMatches && activeMatches.length > 0 && (
            <div className="fifa-badge">{activeMatches.length}</div>
          )}
        </div>
        
        {/* Historial */}
        <Link to="/historial" className="fifa-menu-button historial">
          <div className="fifa-button-title">HISTORIAL</div>
          <div className="fifa-button-icon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" fill="currentColor" width={48} height={48}>
              <path d="M320 128C426 128 512 214 512 320C512 426 426 512 320 512C254.8 512 197.1 479.5 162.4 429.7C152.3 415.2 132.3 411.7 117.8 421.8C103.3 431.9 99.8 451.9 109.9 466.4C156.1 532.6 233 576 320 576C461.4 576 576 461.4 576 320C576 178.6 461.4 64 320 64C234.3 64 158.5 106.1 112 170.7L112 144C112 126.3 97.7 112 80 112C62.3 112 48 126.3 48 144L48 256C48 273.7 62.3 288 80 288L104.6 288C105.1 288 105.6 288 106.1 288L192.1 288C209.8 288 224.1 273.7 224.1 256C224.1 238.3 209.8 224 192.1 224L153.8 224C186.9 166.6 249 128 320 128zM344 216C344 202.7 333.3 192 320 192C306.7 192 296 202.7 296 216L296 320C296 326.4 298.5 332.5 303 337L375 409C384.4 418.4 399.6 418.4 408.9 409C418.2 399.6 418.3 384.4 408.9 375.1L343.9 310.1L343.9 216z"/>
            </svg>
          </div>
        </Link>
        
        {/* Estadísticas */}
        <Link to="/stats" className="fifa-menu-button estadisticas">
          <div className="fifa-button-title">ESTADÍSTICAS</div>
          <div className="fifa-button-icon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" fill="currentColor" width={48} height={48}>
              <path d="M256 144C256 117.5 277.5 96 304 96L336 96C362.5 96 384 117.5 384 144L384 496C384 522.5 362.5 544 336 544L304 544C277.5 544 256 522.5 256 496L256 144zM64 336C64 309.5 85.5 288 112 288L144 288C170.5 288 192 309.5 192 336L192 496C192 522.5 170.5 544 144 544L112 544C85.5 544 64 522.5 64 496L64 336zM496 160L528 160C554.5 160 576 181.5 576 208L576 496C576 522.5 554.5 544 528 544L496 544C469.5 544 448 522.5 448 496L448 208C448 181.5 469.5 160 496 160z"/>
            </svg>
          </div>
        </Link>
        

      </div>
      
      {/* Panel Info */}
      <PanelInfo />
      
      {/* Recent Activity */}
      <div className="fifa-recent-activity">
        <h3>ACTIVIDAD RECIENTE</h3>
        <div className="fifa-activity-list">
          {recentActivity.length > 0 ? (
            recentActivity.map((activity) => (
              <div key={activity.id} className="fifa-activity-item">
                <div className="fifa-activity-icon">🏆</div>
                <div className="fifa-activity-text">
                  Partido creado en {activity.sede} para el {new Date(activity.fecha).toLocaleDateString()}
                </div>
              </div>
            ))
          ) : (
            <div className="fifa-no-activity">No hay actividad reciente</div>
          )}
        </div>
      </div>
      

    </div>
  );
};

export default FifaHomeContent;