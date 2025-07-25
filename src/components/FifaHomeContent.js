import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { supabase } from '../supabase';
import PanelInfo from './PanelInfo';
import WeatherWidget from './WeatherWidget';
import './FifaHomeContent.css';

const FifaHomeContent = ({ onCreateMatch, onViewHistory, onViewInvitations, onViewActivePlayers }) => {
  const { user } = useAuth();
  const [activeMatches, setActiveMatches] = useState([]);
  const [invitationCount, setInvitationCount] = useState(0);
  const [recentActivity, setRecentActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activePlayers, setActivePlayers] = useState(0);

  useEffect(() => {
    if (user) {
      fetchActiveMatches();
      fetchInvitations();
      fetchRecentActivity();
      fetchActivePlayers();
    } else {
      setLoading(false);
    }
  }, [user]);

  const fetchActiveMatches = async () => {
    if (!user) return;
    
    try {
      const { data, error } = await supabase
        .from('partidos')
        .select('*')
        .eq('estado', 'activo')
        .contains('jugadores', [{ uuid: user.id }]);
      
      if (error) throw error;
      setActiveMatches(data || []);
    } catch (error) {
      console.error('Error fetching active matches:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchInvitations = async () => {
    if (!user) return;
    
    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('count')
        .eq('user_id', user.id)
        .eq('type', 'match_invite')
        .eq('read', false)
        .single();
      
      if (error && error.code !== 'PGRST116') throw error;
      setInvitationCount(data?.count || 0);
    } catch (error) {
      console.error('Error fetching invitations:', error);
    }
  };


  const fetchActivePlayers = async () => {
    try {
      const { data, error } = await supabase
        .from('jugadores_sin_partido')
        .select('count')
        .eq('disponible', true)
        .single();
      
      if (error && error.code !== 'PGRST116') throw error;
      setActivePlayers(data?.count || 0);
    } catch (error) {
      console.error('Error fetching active players:', error);
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

  return (
    <div className="fifa-home-content">
      <div className="fifa-menu-grid">
        {/* Create New Match */}
        <Link to="/nuevo-partido" className="fifa-menu-button create-match">
          <div className="fifa-button-title">PARTIDO<br />NUEVO</div>
          <div className="fifa-button-icon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width={60} height={60}>
              <path fillRule="evenodd" d="M12 3.75a.75.75 0 01.75.75v6.75h6.75a.75.75 0 010 1.5h-6.75v6.75a.75.75 0 01-1.5 0v-6.75H4.5a.75.75 0 010-1.5h6.75V4.5a.75.75 0 01.75-.75z" clipRule="evenodd" />
            </svg>
          </div>
        </Link>
        
        {/* Próximos Partidos */}
        <div 
          className={`fifa-menu-button active-matches ${activeMatches.length === 0 ? 'disabled' : ''}`}
          onClick={() => activeMatches.length > 0 && onViewHistory()}
        >
          <div className="fifa-button-title">PRÓXIMOS<br />PARTIDOS</div>
          <div className="fifa-button-icon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width={48} height={48}>
              <path d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5a2.25 2.25 0 002.25-2.25m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5a2.25 2.25 0 012.25 2.25v7.5" />
            </svg>
          </div>
          {activeMatches.length > 0 && (
            <div className="fifa-badge">{activeMatches.length}</div>
          )}
        </div>
        
        {/* Historial */}
        <div className="fifa-menu-button historial" onClick={onViewHistory}>
          <div className="fifa-button-title">HISTORIAL</div>
          <div className="fifa-button-icon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width={48} height={48}>
              <path fillRule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25zM12.75 6a.75.75 0 00-1.5 0v6c0 .414.336.75.75.75h4.5a.75.75 0 000-1.5h-3.75V6z" clipRule="evenodd" />
            </svg>
          </div>
        </div>
        
        {/* Open Matches */}
        <Link 
          to="/quiero-jugar" 
          className="fifa-menu-button open-matches"
          onClick={() => sessionStorage.setItem('quiero-jugar-tab', 'matches')}
        >
          <div className="fifa-button-title">PARTIDOS<br />ABIERTOS</div>
          <div className="fifa-button-icon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width={60} height={60}>
              <path d="M4.5 6.375a4.125 4.125 0 118.25 0 4.125 4.125 0 01-8.25 0zM14.25 8.625a3.375 3.375 0 116.75 0 3.375 3.375 0 01-6.75 0zM1.5 19.125a7.125 7.125 0 0114.25 0v.003l-.001.119a.75.75 0 01-.363.63 13.067 13.067 0 01-6.761 1.873c-2.472 0-4.786-.684-6.76-1.873a.75.75 0 01-.364-.63l-.001-.122zM17.25 19.128l-.001.144a2.25 2.25 0 01-.233.96 10.088 10.088 0 005.06-1.01.75.75 0 00.42-.643 4.875 4.875 0 00-6.957-4.611 8.586 8.586 0 011.71 5.157v.003z" />
            </svg>
          </div>
          {invitationCount > 0 && (
            <div className="fifa-badge">{invitationCount}</div>
          )}
        </Link>
        
        {/* Active Players */}
        <Link 
          to="/quiero-jugar" 
          className="fifa-menu-button active-players"
          onClick={() => sessionStorage.setItem('quiero-jugar-tab', 'players')}
        >
          <div className="fifa-button-title">JUGADORES<br />LIBRES</div>
          <div className="fifa-button-icon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width={48} height={48}>
              <path fillRule="evenodd" d="M8.25 6.75a3.75 3.75 0 117.5 0 3.75 3.75 0 01-7.5 0zM15.75 9.75a3 3 0 116 0 3 3 0 01-6 0zM2.25 9.75a3 3 0 116 0 3 3 0 01-6 0zM6.31 15.117A6.745 6.745 0 0112 12a6.745 6.745 0 016.709 7.498.75.75 0 01-.372.568A12.696 12.696 0 0112 21.75c-2.305 0-4.47-.612-6.337-1.684a.75.75 0 01-.372-.568 6.787 6.787 0 011.019-4.38z" clipRule="evenodd" />
              <path d="M5.082 14.254a8.287 8.287 0 00-1.308 5.135 9.687 9.687 0 01-1.764-.44l-.115-.04a.563.563 0 01-.373-.487l-.01-.121a3.75 3.75 0 013.57-4.047zM20.226 19.389a8.287 8.287 0 00-1.308-5.135 3.75 3.75 0 013.57 4.047l-.01.121a.563.563 0 01-.373.486l-.115.04c-.567.2-1.156.349-1.764.441z" />
            </svg>
          </div>
          {activePlayers > 0 && (
            <div className="fifa-badge">{activePlayers}</div>
          )}
        </Link>
        
        {/* Estadísticas */}
        <div className="fifa-menu-button estadisticas">
          <div className="fifa-button-title">ESTADÍSTICAS</div>
          <div className="fifa-button-icon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width={48} height={48}>
              <path d="M18.375 2.25c-1.035 0-1.875.84-1.875 1.875v15.75c0 1.035.84 1.875 1.875 1.875h.75c1.035 0 1.875-.84 1.875-1.875V4.125c0-1.036-.84-1.875-1.875-1.875h-.75zM9.75 8.625c0-1.036.84-1.875 1.875-1.875h.75c1.036 0 1.875.84 1.875 1.875v11.25c0 1.035-.84 1.875-1.875 1.875h-.75a1.875 1.875 0 01-1.875-1.875V8.625zM3 13.125c0-1.036.84-1.875 1.875-1.875h.75c1.036 0 1.875.84 1.875 1.875v6.75c0 1.035-.84 1.875-1.875 1.875h-.75A1.875 1.875 0 013 19.875v-6.75z" />
            </svg>
          </div>
        </div>
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