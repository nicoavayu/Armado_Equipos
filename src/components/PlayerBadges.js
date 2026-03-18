import React, { useState, useEffect } from 'react';
import { fetchAwardCountsForPlayerRef, normalizeAwardType } from '../services/db/userIdentity';

const AWARD_ORDER = ['mvp', 'best_gk', 'red_card'];

const AWARD_VISUALS = {
  mvp: {
    label: 'MVP',
    accent: '#FFD84A',
    border: 'rgba(255, 216, 74, 0.48)',
    backgroundTop: 'rgba(255, 216, 74, 0.14)',
    backgroundBottom: 'rgba(255, 216, 74, 0.07)',
    icon: '#FFD84A',
    count: '#FFF8D5',
  },
  best_gk: {
    label: 'Mejor arquero',
    accent: '#22D3A5',
    border: 'rgba(34, 211, 165, 0.42)',
    backgroundTop: 'rgba(34, 211, 165, 0.16)',
    backgroundBottom: 'rgba(34, 211, 165, 0.07)',
    icon: '#5DF1C7',
    count: '#D9FFF2',
  },
  red_card: {
    label: 'Tarjeta roja',
    accent: '#FF6A82',
    border: 'rgba(255, 106, 130, 0.44)',
    backgroundTop: 'rgba(255, 106, 130, 0.16)',
    backgroundBottom: 'rgba(255, 106, 130, 0.08)',
    icon: '#FF8CA0',
    count: '#FFE2E8',
  },
  default: {
    label: 'Premio',
    accent: '#A8B3E6',
    border: 'rgba(168, 179, 230, 0.38)',
    backgroundTop: 'rgba(168, 179, 230, 0.14)',
    backgroundBottom: 'rgba(168, 179, 230, 0.07)',
    icon: '#C6D0FF',
    count: '#E5EBFF',
  },
};

const SIZE_MAP = {
  small: {
    badgeHeight: 20,
    badgeMinWidth: 26,
    badgePaddingX: 5,
    iconSize: 10,
    countSize: 10,
    badgeGap: 4,
    contentGap: 3,
  },
  large: {
    badgeHeight: 24,
    badgeMinWidth: 32,
    badgePaddingX: 7,
    iconSize: 12,
    countSize: 11,
    badgeGap: 5,
    contentGap: 4,
  },
};

const AwardIcon = ({ type, color, size }) => {
  const normalizedType = normalizeAwardType(type);
  const svgProps = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: color,
    strokeWidth: 1.9,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  };

  if (normalizedType === 'mvp') {
    return (
      <svg {...svgProps}>
        <path d="M7 4h10v4a5 5 0 1 1-10 0V4Z" />
        <path d="M17 6h2a2 2 0 0 1 0 4h-2" />
        <path d="M7 6H5a2 2 0 1 0 0 4h2" />
        <path d="M12 13v7" />
        <path d="M9 20h6" />
      </svg>
    );
  }

  if (normalizedType === 'best_gk') {
    return (
      <svg {...svgProps}>
        <path d="M12 3 5 6v5.2C5 16 8.3 19 12 21c3.7-2 7-5 7-9.8V6L12 3Z" />
        <path d="m9.4 12.2 1.7 1.7 3.4-3.4" />
      </svg>
    );
  }

  if (normalizedType === 'red_card') {
    return (
      <svg {...svgProps}>
        <rect x="7.5" y="3.5" width="9" height="17" rx="1.6" />
        <path d="M9.8 7.8h4.4" />
      </svg>
    );
  }

  return (
    <svg {...svgProps}>
      <circle cx="12" cy="12" r="7" />
      <path d="m12 8.7 1 2 2.2.3-1.6 1.5.4 2.2L12 13.5l-2 1.2.4-2.2-1.6-1.5 2.2-.3 1-2Z" />
    </svg>
  );
};

const PlayerBadges = ({ playerId, size = 'small' }) => {
  const [badges, setBadges] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchBadges = async () => {
      if (!playerId) {
        setLoading(false);
        return;
      }
      setLoading(true);

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

  const orderedBadges = AWARD_ORDER
    .map((awardType) => [awardType, badges?.[awardType]])
    .filter(([, count]) => Number(count) > 0);
  const extraBadges = Object.entries(badges)
    .filter(([awardType, count]) => !AWARD_ORDER.includes(awardType) && Number(count) > 0);
  const visibleBadges = [...orderedBadges, ...extraBadges];

  if (loading || visibleBadges.length === 0) {
    return null;
  }

  const sizeConfig = SIZE_MAP[size] || SIZE_MAP.small;

  return (
    <div style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: `${sizeConfig.badgeGap}px`,
      flexWrap: 'nowrap',
      minWidth: 0,
    }}>
      {visibleBadges.map(([type, count]) => {
        const normalizedType = normalizeAwardType(type);
        const visual = AWARD_VISUALS[normalizedType] || AWARD_VISUALS.default;
        return (
          <span
            key={type}
            role="img"
            aria-label={`${visual.label}: ${count}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: `${sizeConfig.contentGap}px`,
              justifyContent: 'center',
              height: `${sizeConfig.badgeHeight}px`,
              minWidth: `${sizeConfig.badgeMinWidth}px`,
              padding: `0 ${sizeConfig.badgePaddingX}px`,
              borderRadius: '5px',
              border: `1px solid ${visual.border}`,
              background: `linear-gradient(180deg, ${visual.backgroundTop}, ${visual.backgroundBottom})`,
              boxShadow: `inset 0 1px 0 rgba(255,255,255,0.08), 0 0 0 1px ${visual.accent}1A`,
              flexShrink: 0,
            }}
            title={`${visual.label}: ${count}`}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
              <AwardIcon
                type={type}
                size={sizeConfig.iconSize}
                color={visual.icon}
              />
            </span>
            <span
              style={{
                color: visual.count,
                fontFamily: 'Oswald, sans-serif',
                fontSize: `${sizeConfig.countSize}px`,
                fontWeight: 700,
                lineHeight: 1,
                fontVariantNumeric: 'tabular-nums',
                letterSpacing: '0.02em',
                textShadow: '0 1px 1px rgba(0,0,0,0.55)',
              }}
            >
              {count}
            </span>
          </span>
        );
      })}
    </div>
  );
};

export default PlayerBadges;
