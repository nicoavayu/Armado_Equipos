import React, { useState, useEffect } from 'react';
import { supabase } from '../supabase';
import './PlayerAwards.css';

/**
 * Component to display player awards in the profile
 * @param {Object} props - Component props
 * @param {string} props.playerId - Player ID
 */
const PlayerAwards = ({ playerId }) => {
  const [awards, setAwards] = useState({
    mvp: 0,
    arquero: 0,
    fairplayNegativo: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (playerId) {
      fetchPlayerAwards();
    }
  }, [playerId]);

  // Fetch player awards from the database
  const fetchPlayerAwards = async () => {
    if (!playerId) return;
    
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('player_awards')
        .select('award_type')
        .eq('jugador_id', playerId);
        
      if (error) throw error;
      
      // Count awards by type
      const counts = {
        mvp: 0,
        arquero: 0,
        fairplayNegativo: 0,
      };
      
      data.forEach((award) => {
        if (award.award_type === 'mvp') counts.mvp++;
        if (award.award_type === 'arquero') counts.arquero++;
        if (award.award_type === 'fairplay_negativo') counts.fairplayNegativo++;
      });
      
      setAwards(counts);
    } catch (error) {
      console.error('Error fetching player awards:', error);
    } finally {
      setLoading(false);
    }
  };

  // If no awards, don't render anything
  if (!loading && awards.mvp === 0 && awards.arquero === 0 && awards.fairplayNegativo === 0) {
    return null;
  }

  return (
    <div className="player-awards">
      <h3>Reconocimientos</h3>
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
        
        {awards.arquero > 0 && (
          <div className="award-item arquero">
            <div className="award-icon">🧤</div>
            <div className="award-details">
              <div className="award-title">Mejor Arquero</div>
              <div className="award-count">{awards.arquero}</div>
            </div>
          </div>
        )}
        
        {awards.fairplayNegativo > 0 && (
          <div className="award-item fairplay-negativo">
            <div className="award-icon">🟨</div>
            <div className="award-details">
              <div className="award-title">Tarjetas</div>
              <div className="award-count">{awards.fairplayNegativo}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PlayerAwards;