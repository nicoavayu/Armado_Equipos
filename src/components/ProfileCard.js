import React, { useEffect, useRef, useCallback, useMemo } from "react";
import "./ProfileCard.css";

const DEFAULT_BEHIND_GRADIENT =
  "radial-gradient(farthest-side circle at var(--pointer-x) var(--pointer-y),hsla(266,100%,90%,var(--card-opacity)) 4%,hsla(266,50%,80%,calc(var(--card-opacity)*0.75)) 10%,hsla(266,25%,70%,calc(var(--card-opacity)*0.5)) 50%,hsla(266,0%,60%,0) 100%),radial-gradient(35% 52% at 55% 20%,#00ffaac4 0%,#073aff00 100%),radial-gradient(100% 100% at 50% 50%,#00c1ffff 1%,#073aff00 76%),conic-gradient(from 124deg at 50% 50%,#c137ffff 0%,#07c6ffff 40%,#07c6ffff 60%,#c137ffff 100%)";

const DEFAULT_INNER_GRADIENT =
  "linear-gradient(145deg,#60496e8c 0%,#71C4FF44 100%)";

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
  toMax
) =>
  round(toMin + ((toMax - toMin) * (value - fromMin)) / (fromMax - fromMin));

const easeInOutCubic = (x) =>
  x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;

const ProfileCardComponent = ({
  profile,
  isVisible = true,
  enableTilt = true,
}) => {
  const wrapRef = useRef(null);
  const cardRef = useRef(null);

  // Adapt profile data to card format
  const getPositionAbbr = (position) => {
    const positions = {
      'ARQ': 'ARQ',
      'DEF': 'DEF', 
      'MED': 'MED',
      'DEL': 'DEL',
      'arquero': 'ARQ',
      'defensor': 'DEF', 
      'mediocampista': 'MED',
      'delantero': 'DEL'
    };
    return positions[position] || 'DEF';
  };

  const getCountryCode = (code) => {
    const countries = {
      'AR': 'ARG', 'BR': 'BRA', 'UY': 'URU', 'CL': 'CHI', 'CO': 'COL', 'PE': 'PER'
    };
    return countries[code] || code?.toUpperCase() || 'ARG';
  };

  // Renders 5 stars: filled, half or empty based on rating
  const renderStars = (rating) => {
    const stars = [];
    const fullStars = Math.floor(rating);
    const hasHalfStar = rating % 1 >= 0.5;
    for (let i = 0; i < 5; i++) {
      if (i < fullStars) {
        stars.push(<span key={i} className="star filled">★</span>);
      } else if (i === fullStars && hasHalfStar) {
        stars.push(<span key={i} className="star half">★</span>);
      } else {
        stars.push(<span key={i} className="star empty">☆</span>);
      }
    }
    return stars;
  };

  // Forzar la obtención del avatar desde todas las fuentes posibles
  const getAvatarUrl = () => {
    // Check if we have a direct avatar_url from the profile
    if (profile?.avatar_url) {
      // Handle both blob URLs and regular URLs
      if (profile.avatar_url.startsWith('blob:')) {
        console.log('Using blob URL directly:', profile.avatar_url);
        return profile.avatar_url;
      } else {
        const cacheBuster = `?t=${Date.now()}`;
        const url = profile.avatar_url.includes('?') ? profile.avatar_url : profile.avatar_url + cacheBuster;
        console.log('Using profile.avatar_url with cache buster:', url);
        return url;
      }
    }
    
    // If no direct avatar_url, check other sources
    const sources = [
      profile?.user?.user_metadata?.avatar_url,
      profile?.user?.user_metadata?.picture,
      profile?.user_metadata?.avatar_url,
      profile?.user_metadata?.picture
    ];
    
    // Use the first valid source
    for (const source of sources) {
      if (source) {
        const cacheBuster = `?t=${Date.now()}`;
        const url = source.includes('?') ? source : source + cacheBuster;
        console.log('Using alternative avatar source:', url);
        return url;
      }
    }
    
    return null;
  };
  
  // Force avatar URL refresh on each render
  const avatarUrl = getAvatarUrl();
  console.log('ProfileCard rendering with avatar URL:', avatarUrl);
  
  const playerData = {
    name: profile?.nombre || 'JUGADOR',
    handle: profile?.social?.replace('@', '') || 'jugador',
    status: profile?.acepta_invitaciones === false ? 'Ocupado' : 'Disponible', // Asegura que sea Disponible por defecto
    avatarUrl: avatarUrl,
    rating: profile?.calificacion || 4.5,
    matchesPlayed: profile?.partidos_jugados || 0,
    matchesAbandoned: profile?.partidos_abandonados || 0,
    position: getPositionAbbr(profile?.rol_favorito || profile?.posicion_favorita),
    number: profile?.numero || 10,
    countryCode: profile?.pais_codigo || 'AR',
    countryName: getCountryCode(profile?.pais_codigo)
  };
  
  // Force avatar URL to be valid
  if (playerData.avatarUrl && playerData.avatarUrl.startsWith('blob:')) {
    console.log('Using blob URL for avatar:', playerData.avatarUrl);
  } else if (!playerData.avatarUrl && profile?.avatar_url) {
    playerData.avatarUrl = profile.avatar_url;
    console.log('Using profile.avatar_url directly:', playerData.avatarUrl);
  }
  
  // Debug avatar URL to ensure it's being used
  console.log('ProfileCard avatar sources:', {
    profile_avatar_url: profile?.avatar_url,
    user_metadata_avatar_url: profile?.user_metadata?.avatar_url,
    user_metadata_picture: profile?.user_metadata?.picture,
    user_metadata_from_user: profile?.user?.user_metadata,
    final_avatar_url: avatarUrl
  });

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
        "--pointer-x": `${percentX}%`,
        "--pointer-y": `${percentY}%`,
        "--background-x": `${adjust(percentX, 0, 100, 35, 65)}%`,
        "--background-y": `${adjust(percentY, 0, 100, 35, 65)}%`,
        "--pointer-from-center": `${clamp(Math.hypot(percentY - 50, percentX - 50) / 50, 0, 1)}`,
        "--pointer-from-top": `${percentY / 100}`,
        "--pointer-from-left": `${percentX / 100}`,
        "--rotate-x": `${round(-(centerX / 5))}deg`,
        "--rotate-y": `${round(centerY / 4)}deg`,
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

  // Mantiene el tilt activo pero NO pausa la animación del holo (así siempre ves el logo animado)
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
        wrap
      );
    },
    [animationHandlers]
  );
  const handlePointerEnter = useCallback(() => {
    const card = cardRef.current;
    const wrap = wrapRef.current;
    if (!card || !wrap || !animationHandlers) return;
    animationHandlers.cancelAnimation();
    wrap.classList.add("active");
    card.classList.add("active");
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
        wrap
      );
      wrap.classList.remove("active");
      card.classList.remove("active");
    },
    [animationHandlers]
  );

  useEffect(() => {
    if (!enableTilt || !animationHandlers) return;
    const card = cardRef.current;
    const wrap = wrapRef.current;
    if (!card || !wrap) return;
    card.addEventListener("pointerenter", handlePointerEnter);
    card.addEventListener("pointermove", handlePointerMove);
    card.addEventListener("pointerleave", handlePointerLeave);

    const initialX = wrap.clientWidth - ANIMATION_CONFIG.INITIAL_X_OFFSET;
    const initialY = ANIMATION_CONFIG.INITIAL_Y_OFFSET;
    animationHandlers.updateCardTransform(initialX, initialY, card, wrap);
    animationHandlers.createSmoothAnimation(
      ANIMATION_CONFIG.INITIAL_DURATION,
      initialX,
      initialY,
      card,
      wrap
    );
    return () => {
      card.removeEventListener("pointerenter", handlePointerEnter);
      card.removeEventListener("pointermove", handlePointerMove);
      card.removeEventListener("pointerleave", handlePointerLeave);
      animationHandlers.cancelAnimation();
    };
  }, [
    enableTilt,
    animationHandlers,
    handlePointerMove,
    handlePointerEnter,
    handlePointerLeave,
  ]);

  // Usá tu logo en el holo (animado)
  const cardStyle = useMemo(
    () =>
      ({
        "--behind-gradient": DEFAULT_BEHIND_GRADIENT,
        "--inner-gradient": DEFAULT_INNER_GRADIENT,
        "--icon": "url(/logo.svg)"
      }),
    []
  );

  if (!isVisible) return null;

  return (
    <div
      ref={wrapRef}
      className="pc-card-wrapper"
      style={cardStyle}
    >
      <section ref={cardRef} className="pc-card">
        <div className="pc-inside">
          {/* HOLO ANIMATION: tu logo animado va acá */}
          <div className="pc-shine" />
          <div className="pc-glare" />

          {/* HEADER: NOMBRE Y BANDERA */}
          <div className="pc-content">
            {/* LED de disponibilidad en la esquina */}
            <div className="pc-status-corner">
              <div className={`pc-status-indicator ${playerData.status === 'Disponible' ? '' : 'unavailable'}`}></div>
              
              {/* Bandera debajo del LED */}
              <div className="pc-country-badge">
                <img
                  src={`https://flagcdn.com/w40/${playerData.countryCode.toLowerCase()}.png`}
                  alt={playerData.countryName}
                  className="pc-flag"
                  onError={(e) => {
                    e.target.style.display = "none";
                  }}
                />
                <span className="pc-country-code">{playerData.countryName}</span>
              </div>
            </div>
            
            {/* Stats a la derecha */}
            <div className="pc-stats-header">
              <span className="pc-number">#{playerData.number}</span>
              <span className="pc-position">{playerData.position}</span>
            </div>
            
            {/* Nombre centrado y grande */}
            <div className="pc-details">
              <h3>{playerData.name}</h3>
            </div>
          </div>

          {/* FOTO PRINCIPAL (FIFA STYLE) - Centrada */}
          <div className="pc-content pc-avatar-content">
            {playerData.avatarUrl ? (
              <img
                className="avatar"
                src={playerData.avatarUrl} // URL already has cache buster from getAvatarUrl
                alt={`${playerData.name} avatar`}
                loading="eager"
                crossOrigin="anonymous"
                style={{ 
                  display: 'block', 
                  maxWidth: '100%', 
                  maxHeight: '100%',
                  objectFit: 'cover'
                }}
                onError={(e) => {
                  console.error('Error loading avatar image:', e.target.src);
                  e.target.style.display = "none";
                  const placeholder = document.createElement('div');
                  placeholder.className = 'avatar-placeholder';
                  placeholder.textContent = '👤';
                  e.target.parentNode.appendChild(placeholder);
                }}
                key={`avatar-${Date.now()}`} // Force re-render on each render
              />
            ) : (
              <div className="avatar-placeholder">👤</div>
            )}
          </div>
          
          {/* INFORMACIÓN DEL JUGADOR (abajo) */}
          <div className="pc-user-info">
            <div className="pc-user-stats">
              <div className="pc-handle">@{playerData.handle}</div>
              <div className="pc-matches-container">
                <div className="pc-matches-played">{playerData.matchesPlayed} PJ</div>
                <div className="pc-matches-abandoned">{playerData.matchesAbandoned} PA</div>
              </div>
            </div>
            
            {/* Rating (grande y dorado) */}
            <div className="pc-rating-container">
              <div className="pc-rating-number">{playerData.rating.toFixed(1)}</div>
              <div className="pc-stars">{renderStars(playerData.rating)}</div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

const ProfileCard = React.memo(ProfileCardComponent);

export default ProfileCard;
