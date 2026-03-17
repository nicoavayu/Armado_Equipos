import React, { useState, useEffect } from 'react';
import { fetchAwardCountsForPlayerRef, normalizeAwardType } from '../services/db/userIdentity';

const PlayerBadges = ({ playerId, size = 'small' }) => {
  const [badges, setBadges] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchBadges = async () => {
      if (!playerId) {
        setLoading(false);
        return;
      }

      try {
        const badgeCounts = await fetchAwardCountsForPlayerRef(playerId);
        setBadges({
          mvp: Number(badgeCounts?.mvps || 0),
          best_gk: Number(badgeCounts?.guantes_dorados || 0),
          red_card: Number(badgeCounts?.tarjetas_rojas || 0),
        });
      } catch (error) {
        console.error('Error fetching badges:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchBadges();
  }, [playerId]);

  const visibleBadges = Object.entries(badges)
    .filter(([, count]) => Number(count) > 0);

  if (loading || visibleBadges.length === 0) {
    return null;
  }

  const getBadgeIcon = (type) => {
    const normalizedType = normalizeAwardType(type);
    if (normalizedType === 'mvp') return '🏆';
    if (normalizedType === 'best_gk') return '🥅';
    if (normalizedType === 'red_card') return '🟥';
    return '🏅';
  };

  const getBadgeColor = (type) => {
    const normalizedType = normalizeAwardType(type);
    if (normalizedType === 'mvp') return '#FFD700';
    if (normalizedType === 'best_gk') return '#00D49B';
    if (normalizedType === 'red_card') return '#DE1C49';
    return '#999';
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
      {visibleBadges.map(([type, count]) => (
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
