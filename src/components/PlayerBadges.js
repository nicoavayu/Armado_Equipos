import React, { useState, useEffect } from 'react';
import { supabase } from '../supabase';

const PlayerBadges = ({ playerId, size = 'small' }) => {
  const [badges, setBadges] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchBadges = async () => {
      if (!playerId) return;
      
      try {
        const { data, error } = await supabase
          .from('player_awards')
          .select('award_type, created_at')
          .eq('jugador_id', playerId)
          .order('created_at', { ascending: false });
        
        if (error) throw error;
        
        // Contar badges por tipo
        const badgeCounts = {};
        data.forEach((award) => {
          badgeCounts[award.award_type] = (badgeCounts[award.award_type] || 0) + 1;
        });
        
        setBadges(badgeCounts);
      } catch (error) {
        console.error('Error fetching badges:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchBadges();
  }, [playerId]);

  if (loading || Object.keys(badges).length === 0) {
    return null;
  }

  const getBadgeIcon = (type) => {
    switch (type) {
      case 'mvp':
        return '🏆';
      case 'goalkeeper':
        return '🥅';
      case 'negative_fair_play':
        return '🟥';
      default:
        return '🏅';
    }
  };

  const getBadgeColor = (type) => {
    switch (type) {
      case 'mvp':
        return '#FFD700';
      case 'goalkeeper':
        return '#00D49B';
      case 'negative_fair_play':
        return '#DE1C49';
      default:
        return '#999';
    }
  };

  const badgeSize = size === 'large' ? '24px' : '16px';
  const fontSize = size === 'large' ? '12px' : '8px';

  return (
    <div style={{ 
      display: 'flex', 
      gap: '4px', 
      alignItems: 'center',
      flexWrap: 'wrap',
    }}>
      {Object.entries(badges).map(([type, count]) => (
        <div
          key={type}
          style={{
            display: 'flex',
            alignItems: 'center',
            backgroundColor: getBadgeColor(type),
            borderRadius: '12px',
            padding: '2px 6px',
            fontSize: fontSize,
            fontWeight: 'bold',
            color: 'white',
            minWidth: badgeSize,
            height: badgeSize,
            justifyContent: 'center',
          }}
          title={`${type}: ${count}`}
        >
          <span style={{ marginRight: count > 1 ? '2px' : '0' }}>
            {getBadgeIcon(type)}
          </span>
          {count > 1 && <span>{count}</span>}
        </div>
      ))}
    </div>
  );
};

export default PlayerBadges;