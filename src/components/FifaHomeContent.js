import React, { useState, useEffect } from 'react';
import { useAuth } from './AuthProvider';
import { supabase } from '../supabase';
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
        <div 
          className="fifa-menu-button create-match"
          onClick={onCreateMatch}
        >
          <div className="fifa-button-title">CREAR PARTIDO NUEVO</div>
          <div className="fifa-button-icon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width={60} height={60}>
              <path fillRule="evenodd" d="M12 3.75a.75.75 0 01.75.75v6.75h6.75a.75.75 0 010 1.5h-6.75v6.75a.75.75 0 01-1.5 0v-6.75H4.5a.75.75 0 010-1.5h6.75V4.5a.75.75 0 01.75-.75z" clipRule="evenodd" />
            </svg>
          </div>
        </div>
        
        {/* Active Matches */}
        <div 
          className={`fifa-menu-button active-matches ${activeMatches.length === 0 ? 'disabled' : ''}`}
          onClick={() => activeMatches.length > 0 && onViewHistory()}
        >
          <div className="fifa-button-title">PARTIDOS ACTIVOS</div>
          <div className="fifa-button-icon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width={60} height={60}>
              <path d="M11.645 20.91l-.007-.003-.022-.012a15.247 15.247 0 01-.383-.218 25.18 25.18 0 01-4.244-3.17C4.688 15.36 2.25 12.174 2.25 8.25 2.25 5.322 4.714 3 7.688 3A5.5 5.5 0 0112 5.052 5.5 5.5 0 0116.313 3c2.973 0 5.437 2.322 5.437 5.25 0 3.925-2.438 7.111-4.739 9.256a25.175 25.175 0 01-4.244 3.17 15.247 15.247 0 01-.383.219l-.022.012-.007.004-.003.001a.752.752 0 01-.704 0l-.003-.001z" />
            </svg>
          </div>
          {activeMatches.length > 0 && (
            <div className="fifa-badge">{activeMatches.length}</div>
          )}
        </div>
        
        {/* Open Matches */}
        <div 
          className="fifa-menu-button open-matches"
          onClick={onViewInvitations}
        >
          <div className="fifa-button-title">INVITACIONES</div>
          <div className="fifa-button-icon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width={60} height={60}>
              <path d="M4.5 6.375a4.125 4.125 0 118.25 0 4.125 4.125 0 01-8.25 0zM14.25 8.625a3.375 3.375 0 116.75 0 3.375 3.375 0 01-6.75 0zM1.5 19.125a7.125 7.125 0 0114.25 0v.003l-.001.119a.75.75 0 01-.363.63 13.067 13.067 0 01-6.761 1.873c-2.472 0-4.786-.684-6.76-1.873a.75.75 0 01-.364-.63l-.001-.122zM17.25 19.128l-.001.144a2.25 2.25 0 01-.233.96 10.088 10.088 0 005.06-1.01.75.75 0 00.42-.643 4.875 4.875 0 00-6.957-4.611 8.586 8.586 0 011.71 5.157v.003z" />
            </svg>
          </div>
          {invitationCount > 0 && (
            <div className="fifa-badge">{invitationCount}</div>
          )}
        </div>
        
        {/* Active Players */}
        <div 
          className="fifa-menu-button active-players"
          onClick={onViewActivePlayers}
        >
          <div className="fifa-button-title">JUGADORES LIBRES</div>
          <div className="fifa-button-icon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width={60} height={60}>
              <path fillRule="evenodd" d="M8.25 6.75a3.75 3.75 0 117.5 0 3.75 3.75 0 01-7.5 0zM15.75 9.75a3 3 0 116 0 3 3 0 01-6 0zM2.25 9.75a3 3 0 116 0 3 3 0 01-6 0zM6.31 15.117A6.745 6.745 0 0112 12a6.745 6.745 0 016.709 7.498.75.75 0 01-.372.568A12.696 12.696 0 0112 21.75c-2.305 0-4.47-.612-6.337-1.684a.75.75 0 01-.372-.568 6.787 6.787 0 011.019-4.38z" clipRule="evenodd" />
              <path d="M5.082 14.254a8.287 8.287 0 00-1.308 5.135 9.687 9.687 0 01-1.764-.44l-.115-.04a.563.563 0 01-.373-.487l-.01-.121a3.75 3.75 0 013.57-4.047zM20.226 19.389a8.287 8.287 0 00-1.308-5.135 3.75 3.75 0 013.57 4.047l-.01.121a.563.563 0 01-.373.486l-.115.04c-.567.2-1.156.349-1.764.441z" />
            </svg>
          </div>
          {activePlayers > 0 && (
            <div className="fifa-badge">{activePlayers}</div>
          )}
        </div>
        
        {/* Tournament Mode - Full width and disabled */}
        <div className="fifa-menu-button tournament-mode disabled full-width">
          <div className="fifa-button-title">MODO TORNEO</div>
          <div className="fifa-button-icon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width={60} height={60}>
              <path fillRule="evenodd" d="M5.166 2.621v.858c-1.035.148-2.059.33-3.071.543a.75.75 0 00-.584.859 6.937 6.937 0 006.736 5.848 6.937 6.937 0 005.17-2.341c.432-.52.903-1.088 1.261-1.649-.729-.833-1.178-1.418-1.261-1.649a6.937 6.937 0 00-5.17-2.341 6.937 6.937 0 01-1.822.31V3.75c0-.177.04-.348.117-.5a19.25 19.25 0 01-3.285 0 .75.75 0 00-.133.5zm4.33 8.65c-1.053-.234-2.138-.4-3.232-.492a1.94 1.94 0 00-1.81 1.036 1.94 1.94 0 00.172 2.001c1.306 1.695 3.108 3.034 5.404 4.185 2.295-1.15 4.097-2.49 5.404-4.185a1.94 1.94 0 00.172-2.001 1.94 1.94 0 00-1.81-1.036c-1.094.092-2.18.258-3.233.492a1.94 1.94 0 00-.433.13 1.94 1.94 0 00-.434-.13zM7.44 4.89A7.941 7.941 0 0110.264 4c1.9 0 3.47.73 4.716 1.948a7.941 7.941 0 012.258 5.337c1.035.148 2.059.33 3.071.543a.75.75 0 00.584-.859 6.937 6.937 0 00-6.736-5.848 6.937 6.937 0 01-5.17 2.341c-.432.52-.903 1.088-1.261 1.649.729.833 1.178 1.418 1.261 1.649a6.937 6.937 0 005.17 2.341 6.937 6.937 0 01-2.263-.308c-.437.901-1.088 1.759-1.99 2.539-1.465 1.261-3.765 2.309-7.056 2.309a.75.75 0 000 1.5c3.59 0 6.27-1.177 8.037-2.713a10.657 10.657 0 01-2.37-2.21 6.937 6.937 0 01-5.848-6.736.75.75 0 00-.859-.584c-.212.036-.424.074-.636.114z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="fifa-coming-soon">Próximamente</div>
        </div>
      </div>
      
      {/* Recent Activity */}
      <div className="fifa-recent-activity">
        <h3>ACTIVIDAD RECIENTE</h3>
        <div className="fifa-activity-list">
          {recentActivity.length > 0 ? (
            recentActivity.map(activity => (
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