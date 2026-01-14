import React, { useState, useEffect } from 'react';
import { supabase } from '../supabase';
import { useBadges } from '../context/BadgeContext';
import { useInterval } from '../hooks/useInterval';
import LoadingSpinner from './LoadingSpinner';
import './PlayerAwards.css';

// Test function for debugging
window.testBadgeInsert = async () => {
  console.log('🧪 Testing badge insertion...');
  
  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      console.error('❌ No authenticated user');
      return;
    }
    
    const { data: partidos, error: partidoError } = await supabase
      .from('partidos')
      .select('id, precio_cancha_por_persona')
      .limit(1);
      
    if (partidoError || !partidos?.length) {
      console.error('❌ No partidos found');
      return;
    }
    
    const testBadge = {
      jugador_id: user.id,
      partido_id: partidos[0].id,
      award_type: 'mvp',
      otorgado_por: user.id,
    };
    
    console.log('📝 Inserting test badge:', testBadge);
    
    const { data, error } = await supabase
      .from('player_awards')
      .insert([testBadge])
      .select();
      
    if (error) {
      console.error('❌ Insert error:', error);
    } else {
      console.log('✅ Badge inserted successfully:', data);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
};

/**
 * Component to display player awards in the profile
 * Includes MVP, Guante Dorado (Golden Glove), and Tarjeta Roja (Red Card) badges
 * @param {Object} props - Component props
 * @param {string} props.playerId - Player ID
 */
const PlayerAwards = ({ playerId }) => {
  const { refreshTrigger } = useBadges();
  const { setIntervalSafe } = useInterval();
  const [awards, setAwards] = useState({
    mvp: 0,
    guante_dorado: 0,
    tarjeta_roja: 0,
  });
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (playerId) {
      fetchPlayerAwards();
    }
  }, [playerId, refreshKey, refreshTrigger]);

  // Auto-refresh every 30 seconds to catch new badges
  useEffect(() => {
    if (playerId) {
      setIntervalSafe(() => {
        console.log('[PLAYER_AWARDS] Auto-refreshing awards...');
        setRefreshKey((prev) => prev + 1);
      }, 30000);
    }
  }, [playerId, setIntervalSafe]);

  // Fetch player awards from the database
  const fetchPlayerAwards = async () => {
    if (!playerId) return;
    
    console.log('[PLAYER_AWARDS] Fetching awards for playerId:', playerId);
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('player_awards')
        .select('*')
        .eq('jugador_id', playerId);
        
      if (error) throw error;
      
      console.log('[PLAYER_AWARDS] Raw data:', data);
      
      // Count awards by type
      const counts = {
        mvp: 0,
        guante_dorado: 0,
        tarjeta_roja: 0,
      };
      
      data.forEach((award) => {
        if (award.award_type === 'mvp') counts.mvp++;
        if (award.award_type === 'guante_dorado') counts.guante_dorado++;
        if (award.award_type === 'tarjeta_roja') counts.tarjeta_roja++;
      });
      
      console.log('[PLAYER_AWARDS] Counts:', counts);
      setAwards(counts);
    } catch (error) {
      console.error('Error fetching player awards:', error);
    } finally {
      setLoading(false);
    }
  };

  // Always show for debugging
  console.log('[PLAYER_AWARDS] Rendering with awards:', awards, 'loading:', loading, 'playerId:', playerId);
  console.log('[PLAYER_AWARDS] Run testBadgeInsert() in console to test badge insertion');
  
  const hasAnyAwards = awards.mvp > 0 || awards.guante_dorado > 0 || awards.tarjeta_roja > 0;
  
  // Always show the section, even if no awards
  if (loading) {
    return (
      <div className="player-awards">
        <h3>Reconocimientos</h3>
        <LoadingSpinner size="small" />
      </div>
    );
  }
  
  // If no awards, show debug info
  if (!hasAnyAwards) {
    return (
      <div className="player-awards">
        <h3>Reconocimientos</h3>
        <div style={{ color: '#999', fontSize: '12px', marginBottom: '10px' }}>
          No hay badges aún (playerId: {playerId})
        </div>
        <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
          <button 
            onClick={() => setRefreshKey((prev) => prev + 1)}
            style={{ 
              padding: '4px 8px', 
              fontSize: '10px', 
              background: '#8178e5', 
              color: 'white', 
              border: 'none', 
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Refrescar
          </button>
          <button onClick={async () => {
            console.log('🔥 DIRECT TEST - No cache');
            try {
              const { data: { user } } = await supabase.auth.getUser();
              const { data: partidos } = await supabase.from('partidos').select('id').limit(1);
              if (!partidos?.length) {
                console.log('🔥 No partidos found');
                return;
              }
              const badge = { jugador_id: user.id, partido_id: partidos[0].id, award_type: 'mvp' };
              console.log('🔥 DIRECT INSERT:', badge);
              const { data, error } = await supabase.from('player_awards').insert([badge]).select();
              if (error) console.error('🔥 ERROR:', error);
              else {
                console.log('🔥 SUCCESS:', data);
                setRefreshKey((prev) => prev + 1); // Refresh after insert
              }
            } catch (e) { console.error('🔥 FAIL:', e); }
          }} style={{ 
            padding: '4px 8px', 
            fontSize: '10px', 
            background: '#dc3545', 
            color: 'white', 
            border: 'none', 
            borderRadius: '4px',
            cursor: 'pointer',
          }}>
            Test Badge
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="player-awards">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <h3 style={{ margin: 0 }}>Reconocimientos</h3>
        <button 
          onClick={() => setRefreshKey((prev) => prev + 1)}
          style={{ 
            padding: '4px 8px', 
            fontSize: '10px', 
            background: 'rgba(129, 120, 229, 0.2)', 
            color: '#8178e5', 
            border: '1px solid rgba(129, 120, 229, 0.3)', 
            borderRadius: '4px',
            cursor: 'pointer',
          }}
          title="Refrescar badges"
        >
          🔄
        </button>
      </div>
      <div className="awards-container">
        {awards.mvp > 0 && (
          <div className="award-item mvp">
            <div className="award-icon">🏆</div>
            <div className="award-details">
              <div className="award-title">MVP</div>
              <div className="award-count">{awards.mvp}</div>
            </div>
          </div>
        )}
        
        {awards.guante_dorado > 0 && (
          <div className="award-item guante-dorado">
            <div className="award-icon">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="24" height="24" fill="currentColor">
                <path d="M448 448L160 448L101.4 242.9C97.8 230.4 96 217.4 96 204.3C96 126.8 158.8 64 236.3 64L239.7 64C305.7 64 363.2 108.9 379.2 172.9L410.6 298.7L428.2 278.6C440.8 264.2 458.9 256 478 256L480.8 256C515.7 256 544.1 284.3 544.1 319.3C544.1 335.2 538.1 350.5 527.3 362.2L448 448zM128 528C128 510.3 142.3 496 160 496L448 496C465.7 496 480 510.3 480 528L480 544C480 561.7 465.7 576 448 576L160 576C142.3 576 128 561.7 128 544L128 528z"/>
              </svg>
            </div>
            <div className="award-details">
              <div className="award-title">Guante Dorado</div>
              <div className="award-count">{awards.guante_dorado}</div>
            </div>
          </div>
        )}
        
        {awards.tarjeta_roja > 0 && (
          <div className="award-item tarjeta-roja">
            <div className="award-icon">🟥</div>
            <div className="award-details">
              <div className="award-title">Tarjetas Rojas</div>
              <div className="award-count">{awards.tarjeta_roja}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PlayerAwards;