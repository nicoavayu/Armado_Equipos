import React, { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import './ProfileCard.css';
// Eliminado import de useAmigos y toast
import LoadingSpinner from './LoadingSpinner';

const DEFAULT_BEHIND_GRADIENT =
  'radial-gradient(farthest-side circle at var(--pointer-x) var(--pointer-y),hsla(266,100%,90%,var(--card-opacity)) 4%,hsla(266,50%,80%,calc(var(--card-opacity)*0.75)) 10%,hsla(266,25%,70%,calc(var(--card-opacity)*0.5)) 50%,hsla(266,0%,60%,0) 100%),radial-gradient(35% 52% at 55% 20%,#00ffaac4 0%,#073aff00 100%),radial-gradient(100% 100% at 50% 50%,#00c1ffff 1%,#073aff00 76%),conic-gradient(from 124deg at 50% 50%,#c137ffff 0%,#07c6ffff 40%,#07c6ffff 60%,#c137ffff 100%)';

const DEFAULT_INNER_GRADIENT =
  'linear-gradient(145deg,#60496e8c 0%,#71C4FF44 100%)';

const ANIMATION_CONFIG = {
  SMOOTH_DURATION: 600,
  INITIAL_DURATION: 1500,
  INITIAL_X_OFFSET: 70,
  INITIAL_Y_OFFSET: 60,
};

const clamp = (value, min = 0, max = 100) =>
  Math.min(Math.max(value, min), max);

const round = (value, precision = 3) =>
  parseFloat(value.toFixed(precision));

const adjust = (
  value,
  fromMin,
  fromMax,
  toMin,
  toMax,
) =>
  round(toMin + ((toMax - toMin) * (value - fromMin)) / (fromMax - fromMin));

const easeInOutCubic = (x) =>
  x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;

// Badge counter selector
const getBadgeCounts = (profile) => ({
  mvp: Number(profile?.mvp_badges ?? profile?.mvps ?? 0),
  gk: Number(profile?.gk_badges ?? profile?.guantes_dorados ?? 0),
  red: Number(profile?.red_badges ?? profile?.tarjetas_rojas ?? 0),
});

const ProfileCardComponent = ({
  profile,
  isVisible = true,
  enableTilt = true,
  currentUserId,
}) => {
  const wrapRef = useRef(null);
  const cardRef = useRef(null);

  const getPositionAbbr = (position) => {
    const positions = {
      'ARQ': 'ARQ', 'DEF': 'DEF', 'MED': 'MED', 'DEL': 'DEL',
      'arquero': 'ARQ', 'defensor': 'DEF', 'mediocampista': 'MED', 'delantero': 'DEL',
    };
    return positions[position] || 'DEF';
  };

  const getCountryCode = (code) => {
    const countries = {
      'AR': 'ARG', 'BR': 'BRA', 'UY': 'URU', 'CL': 'CHI', 'CO': 'COL', 'PE': 'PER',
    };
    return countries[code] || code?.toUpperCase() || 'ARG';
  };

  const getAvatarUrl = () => {
    if (profile?.avatar_url) {
      if (profile.avatar_url.startsWith('blob:')) return profile.avatar_url;
      const cacheBuster = `?t=${Date.now()}`;
      return profile.avatar_url.includes('?')
        ? profile.avatar_url
        : profile.avatar_url + cacheBuster;
    }
    if (profile?.foto_url) {
      if (profile.foto_url.startsWith('blob:')) return profile.foto_url;
      const cacheBuster = `?t=${Date.now()}`;
      return profile.foto_url.includes('?')
        ? profile.foto_url
        : profile.foto_url + cacheBuster;
    }
    const sources = [
      profile?.user?.user_metadata?.avatar_url,
      profile?.user?.user_metadata?.picture,
      profile?.user_metadata?.avatar_url,
      profile?.user_metadata?.picture,
    ];
    for (const source of sources) {
      if (source) {
        const cacheBuster = `?t=${Date.now()}`;
        return source.includes('?') ? source : source + cacheBuster;
      }
    }
    return null;
  };

  const avatarUrl = getAvatarUrl();

  const playerData = {
    name: profile?.nombre || 'JUGADOR',
    handle: profile?.social?.replace('@', '') || 'jugador',
    avatarUrl: avatarUrl,
    rating: profile?.rating || profile?.ranking || profile?.calificacion || 5.0,
    ranking: profile?.ranking || 5.0,
    matchesPlayed: profile?.partidos_jugados || 0,
    matchesAbandoned: profile?.partidos_abandonados || 0,
    position: getPositionAbbr(profile?.posicion || profile?.posicion_favorita),
    countryCode: profile?.pais_codigo || 'AR',
    countryName: getCountryCode(profile?.pais_codigo),
  };

  // --- Animation logic (tilt effect) ---
  const animationHandlers = useMemo(() => {
    if (!enableTilt) return null;
    let rafId = null;
    const updateCardTransform = (offsetX, offsetY, card, wrap) => {
      const width = card.clientWidth;
      const height = card.clientHeight;
      const percentX = clamp((100 / width) * offsetX);
      const percentY = clamp((100 / height) * offsetY);
      const centerX = percentX - 50;
      const centerY = percentY - 50;
      const properties = {
        '--pointer-x': `${percentX}%`,
        '--pointer-y': `${percentY}%`,
        '--background-x': `${adjust(percentX, 0, 100, 35, 65)}%`,
        '--background-y': `${adjust(percentY, 0, 100, 35, 65)}%`,
        '--pointer-from-center': `${clamp(Math.hypot(percentY - 50, percentX - 50) / 50, 0, 1)}`,
        '--pointer-from-top': `${percentY / 100}`,
        '--pointer-from-left': `${percentX / 100}`,
        '--rotate-x': `${round(-(centerX / 5))}deg`,
        '--rotate-y': `${round(centerY / 4)}deg`,
      };
      Object.entries(properties).forEach(([property, value]) => {
        wrap.style.setProperty(property, value);
      });
    };
    const createSmoothAnimation = (duration, startX, startY, card, wrap) => {
      const startTime = performance.now();
      const targetX = wrap.clientWidth / 2;
      const targetY = wrap.clientHeight / 2;
      const animationLoop = (currentTime) => {
        const elapsed = currentTime - startTime;
        const progress = clamp(elapsed / duration);
        const easedProgress = easeInOutCubic(progress);
        const currentX = adjust(easedProgress, 0, 1, startX, targetX);
        const currentY = adjust(easedProgress, 0, 1, startY, targetY);
        updateCardTransform(currentX, currentY, card, wrap);
        if (progress < 1) {
          rafId = requestAnimationFrame(animationLoop);
        }
      };
      rafId = requestAnimationFrame(animationLoop);
    };
    return {
      updateCardTransform,
      createSmoothAnimation,
      cancelAnimation: () => {
        if (rafId) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
      },
    };
  }, [enableTilt]);

  const handlePointerMove = useCallback(
    (event) => {
      const card = cardRef.current;
      const wrap = wrapRef.current;
      if (!card || !wrap || !animationHandlers) return;
      const rect = card.getBoundingClientRect();
      animationHandlers.updateCardTransform(
        event.clientX - rect.left,
        event.clientY - rect.top,
        card,
        wrap,
      );
    },
    [animationHandlers],
  );
  const handlePointerEnter = useCallback(() => {
    const card = cardRef.current;
    const wrap = wrapRef.current;
    if (!card || !wrap || !animationHandlers) return;
    animationHandlers.cancelAnimation();
    wrap.classList.add('active');
    card.classList.add('active');
  }, [animationHandlers]);
  const handlePointerLeave = useCallback(
    (event) => {
      const card = cardRef.current;
      const wrap = wrapRef.current;
      if (!card || !wrap || !animationHandlers) return;
      animationHandlers.createSmoothAnimation(
        ANIMATION_CONFIG.SMOOTH_DURATION,
        event.offsetX,
        event.offsetY,
        card,
        wrap,
      );
      wrap.classList.remove('active');
      card.classList.remove('active');
    },
    [animationHandlers],
  );

  useEffect(() => {
    if (!enableTilt || !animationHandlers) return;
    const card = cardRef.current;
    const wrap = wrapRef.current;
    if (!card || !wrap) return;
    card.addEventListener('pointerenter', handlePointerEnter);
    card.addEventListener('pointermove', handlePointerMove);
    card.addEventListener('pointerleave', handlePointerLeave);

    const initialX = wrap.clientWidth - ANIMATION_CONFIG.INITIAL_X_OFFSET;
    const initialY = ANIMATION_CONFIG.INITIAL_Y_OFFSET;
    animationHandlers.updateCardTransform(initialX, initialY, card, wrap);
    animationHandlers.createSmoothAnimation(
      ANIMATION_CONFIG.INITIAL_DURATION,
      initialX,
      initialY,
      card,
      wrap,
    );
    return () => {
      card.removeEventListener('pointerenter', handlePointerEnter);
      card.removeEventListener('pointermove', handlePointerMove);
      card.removeEventListener('pointerleave', handlePointerLeave);
      animationHandlers.cancelAnimation();
    };
  }, [
    enableTilt,
    animationHandlers,
    handlePointerMove,
    handlePointerEnter,
    handlePointerLeave,
  ]);

  const cardStyle = useMemo(
    () => ({
      '--behind-gradient': DEFAULT_BEHIND_GRADIENT,
      '--inner-gradient': DEFAULT_INNER_GRADIENT,
    }),
    [],
  );

  if (!isVisible) return null;

  const isGuest = !profile?.usuario_id;
  const { mvp, gk, red } = getBadgeCounts(profile);

  return (
    <div
      ref={wrapRef}
      className="pc-card-wrapper"
      style={cardStyle}
    >
      <section ref={cardRef} className="pc-card">
        <div className={`pc-status-led ${profile?.acepta_invitaciones !== false ? 'available' : 'unavailable'}`}></div>
        <div className="pc-inside">
          {/* HOLO ANIMATION */}
          <div className="pc-shine" />
          <div className="pc-glare" />

          <div className="pc-content">
            <div className="pc-details">
              <div className="pc-name-container">
                {profile?.lesion_activa ? (
                  <div className="pc-injury-badge" title="Lesionado">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width={12} height={12}>
                      <path d="M12 2C13.1 2 14 2.9 14 4V8H18C19.1 8 20 8.9 20 10V14C20 15.1 19.1 16 18 16H14V20C14 21.1 13.1 22 12 22H10C8.9 22 8 21.1 8 20V16H4C2.9 16 2 15.1 2 14V10C2 8.9 2.9 8 4 8H8V4C8 2.9 8.9 2 10 2H12Z"/>
                    </svg>
                  </div>
                ) : (
                  <div className={`pc-availability-led ${profile?.acepta_invitaciones !== false ? 'available' : 'unavailable'}`} 
                       title={profile?.acepta_invitaciones !== false ? 'Disponible' : 'Ausente'}>
                  </div>
                )}
                <h3>{playerData.name}</h3>
              </div>
            </div>
            <div className="pc-avatar-container">
              <div className="pc-avatar-wrapper">
                {playerData.avatarUrl ? (
                  <img
                    className="avatar"
                    src={playerData.avatarUrl}
                    alt={`${playerData.name} avatar`}
                    loading="eager"
                    crossOrigin="anonymous"
                    onError={(e) => {
                      if (e.target instanceof HTMLImageElement) {
                        e.target.style.display = 'none';
                        const placeholder = document.createElement('div');
                        placeholder.className = 'avatar-placeholder';
                        placeholder.textContent = '👤';
                        e.target.parentNode?.insertBefore(placeholder, e.target);
                      }
                    }}
                  />
                ) : (
                  <div className="avatar-placeholder">👤</div>
                )}
              </div>
            </div>
            <div className="pc-overlays">
              <div className="pc-middle-right-badges">
                {/* MVP Badge */}
                <div className={`pc-badge-mvp ${isGuest ? 'is-guest' : ''}`}>
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width={16} height={16}>
                    <path fillRule="evenodd" d="M5.166 2.621v.858c-1.035.148-2.059.33-3.071.543a.75.75 0 0 0-.584.859 6.753 6.753 0 0 0 6.138 5.6 6.73 6.73 0 0 0 2.743 1.346A6.707 6.707 0 0 1 9.279 15H8.54c-1.036 0-1.875.84-1.875 1.875V19.5h-.75a2.25 2.25 0 0 0-2.25 2.25c0 .414.336.75.75.75h15a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-2.25-2.25H16.5v-2.625c0-1.036-.84-1.875-1.875-1.875h-.739a6.706 6.706 0 0 1-1.112-3.173 6.73 6.73 0 0 0 2.743-1.347 6.753 6.753 0 0 0 6.139-5.6.75.75 0 0 0-.585-.858 47.077 47.077 0 0 0-3.07-.543V2.62a.75.75 0 0 0-.658-.744 49.22 49.22 0 0 0-6.093-.377c-2.063 0-4.096.128-6.093.377a.75.75 0 0 0-.657.744Z" clipRule="evenodd" />
                  </svg>
                  <span className="pc-badge-count">{mvp}</span>
                </div>
                {/* Red Card Badge */}
                <div className={`pc-badge-red-card ${isGuest ? 'is-guest' : ''}`}>
                  <svg className="pc-red-card-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
                    <mask id="ipSRectangle0">
                      <path fill="#fff" stroke="#fff" strokeWidth="4" d="M38 4H10a2 2 0 0 0-2 2v36a2 2 0 0 0 2 2h28a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2Z"/>
                    </mask>
                    <path fill="currentColor" d="M0 0h48v48H0z" mask="url(#ipSRectangle0)"/>
                  </svg>
                  <span className="pc-badge-count">{red}</span>
                </div>
                {/* Golden Glove Badge */}
                <div className={`pc-badge-golden-glove ${isGuest ? 'is-guest' : ''}`}>
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width={16} height={16} fill="currentColor">
                    <path d="M448 448L160 448L101.4 242.9C97.8 230.4 96 217.4 96 204.3C96 126.8 158.8 64 236.3 64L239.7 64C305.7 64 363.2 108.9 379.2 172.9L410.6 298.7L428.2 278.6C440.8 264.2 458.9 256 478 256L480.8 256C515.7 256 544.1 284.3 544.1 319.3C544.1 335.2 538.1 350.5 527.3 362.2L448 448zM128 528C128 510.3 142.3 496 160 496L448 496C465.7 496 480 510.3 480 528L480 544C480 561.7 465.7 576 448 576L160 576C142.3 576 128 561.7 128 544L128 528z"/>
                  </svg>
                  <span className="pc-badge-count">{gk}</span>
                </div>
              </div>
              <div className="pc-bottom-left-badges">
                <div className={`pc-badge-position ${playerData.position.toLowerCase()}`}>
                  <span className="pc-position">{playerData.position}</span>
                </div>
                <div className="pc-badge-column">
                  <img
                    src={`https://flagcdn.com/w40/${playerData.countryCode.toLowerCase()}.png`}
                    alt={playerData.countryName}
                    className="pc-flag"
                    onError={(e) => {
                      if (e.target instanceof HTMLImageElement) {
                        e.target.style.display = 'none';
                      }
                    }}
                  />
                  <span className="pc-country-code">{playerData.countryName}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="pc-bottom-container">
            <div className="pc-handle-container">
              <span
                className="pc-handle"
                title={`@${playerData.handle}`}
                style={{ display: 'block', maxWidth: '100%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
              >
                @{playerData.handle}
              </span>
            </div>
            <div className="pc-matches-vertical">
              <span className="pc-matches-played">PJ {playerData.matchesPlayed}</span>
              <span className="pc-matches-abandoned">PA {playerData.matchesAbandoned}</span>
            </div>
            <div className="pc-rating-container">
              <span className="pc-responsibility-label">R:</span>
              <span className="pc-responsibility-value">{playerData.ranking.toFixed(1)}</span>
            </div>
          </div>

        </div>
      </section>
    </div>
  );
};

const ProfileCard = React.memo(ProfileCardComponent);

export default ProfileCard;
