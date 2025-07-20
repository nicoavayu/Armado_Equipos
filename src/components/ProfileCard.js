import React, { useEffect, useRef, useCallback, useMemo, useState } from "react";
import "./ProfileCard.css";
import "./ProfileCardMobile.css"; // Importamos los estilos específicos para móvil
import { useAmigos } from "../hooks/useAmigos";
import { supabase } from "../supabase";
import { toast } from "react-toastify";
import LoadingSpinner from "./LoadingSpinner";

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
  currentUserId,
  showFriendActions = true,
}) => {
  const [relationshipStatus, setRelationshipStatus] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const { getRelationshipStatus, sendFriendRequest, acceptFriendRequest, rejectFriendRequest, removeFriend } = useAmigos(currentUserId);
  
  // Check relationship status when profile or currentUserId changes
  useEffect(() => {
    const checkRelationship = async () => {
      console.log('ProfileCard: Checking relationship status', { currentUserId, profileId: profile?.id });
      
      if (!currentUserId) {
        console.log('ProfileCard: No currentUserId available, skipping relationship check');
        return;
      }
      
      if (!profile?.id) {
        console.log('ProfileCard: No profile.id available, skipping relationship check');
        return;
      }
      
      if (currentUserId === profile.id) {
        console.log('ProfileCard: Current user is viewing their own profile, skipping relationship check');
        return;
      }
      
      console.log('ProfileCard: Getting relationship status between', currentUserId, 'and', profile.id);
      setIsLoading(true);
      const status = await getRelationshipStatus(profile.id);
      console.log('ProfileCard: Relationship status result:', status);
      setRelationshipStatus(status);
      setIsLoading(false);
    };
    
    checkRelationship();
  }, [currentUserId, profile?.id, getRelationshipStatus]);
  
  // Handle friend request actions
  const handleAddFriend = async () => {
    console.log('ProfileCard: Adding friend', { currentUserId, profileId: profile?.id });
    
    if (!currentUserId) {
      console.log('ProfileCard: No currentUserId available, cannot add friend');
      return;
    }
    
    if (!profile?.id) {
      console.log('ProfileCard: No profile.id available, cannot add friend');
      return;
    }
    
    console.log('ProfileCard: Sending friend request from', currentUserId, 'to', profile.id);
    setIsLoading(true);
    const result = await sendFriendRequest(profile.id);
    console.log('ProfileCard: Send friend request result:', result);
    setIsLoading(false);
    
    if (result.success) {
      console.log('ProfileCard: Friend request sent successfully');
      setRelationshipStatus({ id: result.data.id, status: 'pending' });
      toast.success('Solicitud de amistad enviada');
    } else {
      console.error('ProfileCard: Error sending friend request:', result.message);
      toast.error(result.message || 'Error al enviar solicitud');
    }
  };
  
  const handleAcceptRequest = async () => {
    console.log('ProfileCard: Accepting friend request', relationshipStatus);
    
    if (!relationshipStatus?.id) {
      console.log('ProfileCard: No relationshipStatus.id available, cannot accept request');
      return;
    }
    
    console.log('ProfileCard: Accepting friend request with ID:', relationshipStatus.id);
    setIsLoading(true);
    const result = await acceptFriendRequest(relationshipStatus.id);
    console.log('ProfileCard: Accept friend request result:', result);
    setIsLoading(false);
    
    if (result.success) {
      console.log('ProfileCard: Friend request accepted successfully');
      setRelationshipStatus({ ...relationshipStatus, status: 'accepted' });
      toast.success('Solicitud de amistad aceptada');
    } else {
      console.error('ProfileCard: Error accepting friend request:', result.message);
      toast.error(result.message || 'Error al aceptar solicitud');
    }
  };
  
  const handleRejectRequest = async () => {
    console.log('ProfileCard: Rejecting friend request', relationshipStatus);
    
    if (!relationshipStatus?.id) {
      console.log('ProfileCard: No relationshipStatus.id available, cannot reject request');
      return;
    }
    
    console.log('ProfileCard: Rejecting friend request with ID:', relationshipStatus.id);
    setIsLoading(true);
    const result = await rejectFriendRequest(relationshipStatus.id);
    console.log('ProfileCard: Reject friend request result:', result);
    setIsLoading(false);
    
    if (result.success) {
      console.log('ProfileCard: Friend request rejected successfully');
      setRelationshipStatus({ ...relationshipStatus, status: 'rejected' });
      toast.success('Solicitud de amistad rechazada');
    } else {
      console.error('ProfileCard: Error rejecting friend request:', result.message);
      toast.error(result.message || 'Error al rechazar solicitud');
    }
  };
  
  const handleRemoveFriend = async () => {
    console.log('ProfileCard: Removing friend', relationshipStatus);
    
    if (!relationshipStatus?.id) {
      console.log('ProfileCard: No relationshipStatus.id available, cannot remove friend');
      return;
    }
    
    console.log('ProfileCard: Removing friendship with ID:', relationshipStatus.id);
    setIsLoading(true);
    const result = await removeFriend(relationshipStatus.id);
    console.log('ProfileCard: Remove friend result:', result);
    setIsLoading(false);
    
    if (result.success) {
      console.log('ProfileCard: Friend removed successfully');
      setRelationshipStatus(null);
      toast.success('Amistad eliminada');
    } else {
      console.error('ProfileCard: Error removing friend:', result.message);
      toast.error(result.message || 'Error al eliminar amistad');
    }
  };
  
  // Determine if we should show private data
  const canViewPrivateData = useMemo(() => {
    console.log('ProfileCard: Determining if user can view private data', { 
      currentUserId, 
      profileId: profile?.id, 
      relationshipStatus: relationshipStatus?.status 
    });
    
    // User can see their own private data
    if (currentUserId === profile?.id) {
      console.log('ProfileCard: User is viewing their own profile, can view private data');
      return true;
    }
    
    // User can see private data of accepted friends
    const canView = relationshipStatus?.status === 'accepted';
    console.log('ProfileCard: User is viewing another profile, can view private data:', canView);
    return canView;
  }, [currentUserId, profile?.id, relationshipStatus?.status]);
  
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
  
  // Render friend action buttons based on relationship status
  const renderFriendActions = () => {
    if (!showFriendActions || currentUserId === profile?.id) {
      return null;
    }
    
    // Loading state
    if (isLoading) {
      return <LoadingSpinner size="small" />;
    }
    
    // No relationship exists yet
    if (!relationshipStatus) {
      return (
        <button className="pc-friend-btn add" onClick={handleAddFriend}>
          Agregar Amigo
        </button>
      );
    }
    
    // Pending request sent by current user
    if (relationshipStatus.status === 'pending') {
      return (
        <button className="pc-friend-btn pending" disabled>
          Solicitud Pendiente
        </button>
      );
    }
    
    // Already friends
    if (relationshipStatus.status === 'accepted') {
      return (
        <button className="pc-friend-btn remove" onClick={handleRemoveFriend}>
          Eliminar Amigo
        </button>
      );
    }
    
    // Rejected request
    if (relationshipStatus.status === 'rejected') {
      return (
        <button className="pc-friend-btn add" onClick={handleAddFriend}>
          Agregar Amigo
        </button>
      );
    }
    
    return null;
  };
  
  // Render private data section if user is a friend
  const renderPrivateData = () => {
    console.log('ProfileCard: Rendering private data section', { 
      canViewPrivateData, 
      hasProfile: !!profile,
      telefono: profile?.telefono,
      email: profile?.email,
      localidad: profile?.localidad
    });
    
    if (!canViewPrivateData) {
      console.log('ProfileCard: Cannot view private data, not rendering private section');
      return null;
    }
    
    if (!profile) {
      console.log('ProfileCard: No profile data available, not rendering private section');
      return null;
    }
    
    console.log('ProfileCard: Rendering private data for fields:', { 
      hasTelefono: !!profile.telefono, 
      hasEmail: !!profile.email, 
      hasLocalidad: !!profile.localidad 
    });
    
    return (
      <div className="pc-private-data">
        {profile.telefono && (
          <div className="pc-private-data-item">
            <div className="pc-private-data-label">Teléfono:</div>
            <div className="pc-private-data-value">{profile.telefono}</div>
          </div>
        )}
        {profile.email && (
          <div className="pc-private-data-item">
            <div className="pc-private-data-label">Email:</div>
            <div className="pc-private-data-value">{profile.email}</div>
          </div>
        )}
        {profile.localidad && (
          <div className="pc-private-data-item">
            <div className="pc-private-data-label">Localidad:</div>
            <div className="pc-private-data-value">{profile.localidad}</div>
          </div>
        )}
      </div>
    );
  };

  // Forzar la obtención del avatar desde todas las fuentes posibles
  const getAvatarUrl = () => {
    console.log('[AMIGOS] Getting avatar URL for profile:', profile?.id);
    console.log('[AMIGOS] Available profile fields:', profile ? Object.keys(profile) : 'No profile');
    
    // For authenticated users, use avatar_url from usuarios table
    if (profile?.avatar_url) {
      // Handle both blob URLs and regular URLs
      if (profile.avatar_url.startsWith('blob:')) {
        console.log('[AMIGOS] Using blob URL directly from avatar_url:', profile.avatar_url);
        return profile.avatar_url;
      } else {
        const cacheBuster = `?t=${Date.now()}`;
        const url = profile.avatar_url.includes('?') ? profile.avatar_url : profile.avatar_url + cacheBuster;
        console.log('[AMIGOS] Using profile.avatar_url with cache buster:', url);
        return url;
      }
    }
    
    // For guest users, use foto_url from jugadores table
    if (profile?.foto_url) {
      // Handle both blob URLs and regular URLs
      if (profile.foto_url.startsWith('blob:')) {
        console.log('[AMIGOS] Using blob URL directly from foto_url:', profile.foto_url);
        return profile.foto_url;
      } else {
        const cacheBuster = `?t=${Date.now()}`;
        const url = profile.foto_url.includes('?') ? profile.foto_url : profile.foto_url + cacheBuster;
        console.log('[AMIGOS] Using profile.foto_url with cache buster:', url);
        return url;
      }
    }
    
    // If no direct avatar_url or foto_url, check other sources
    const sources = [
      profile?.user?.user_metadata?.avatar_url,
      profile?.user?.user_metadata?.picture,
      profile?.user_metadata?.avatar_url,
      profile?.user_metadata?.picture
    ];
    
    console.log('[AMIGOS] Checking alternative avatar sources');
    
    // Use the first valid source
    for (const source of sources) {
      if (source) {
        const cacheBuster = `?t=${Date.now()}`;
        const url = source.includes('?') ? source : source + cacheBuster;
        console.log('[AMIGOS] Using alternative avatar source:', url);
        return url;
      }
    }
    
    console.log('[AMIGOS] No avatar URL found, using default');
    return null;
  };
  
  // Force avatar URL refresh on each render
  const avatarUrl = getAvatarUrl();
  console.log('[AMIGOS] ProfileCard rendering with avatar URL:', avatarUrl);
  
  // Log position and ranking fields for debugging
  console.log('[AMIGOS] Processing position and ranking fields:', { 
    posicion: profile?.posicion, 
    posicion_favorita: profile?.posicion_favorita,
    ranking: profile?.ranking,
    calificacion: profile?.calificacion
  });
  
  const playerData = {
    name: profile?.nombre || 'JUGADOR',
    handle: profile?.social?.replace('@', '') || 'jugador',
    status: profile?.acepta_invitaciones === false ? 'Ocupado' : 'Disponible', // Asegura que sea Disponible por defecto
    avatarUrl: avatarUrl,
    rating: profile?.ranking || profile?.calificacion || 4.5, // Support both ranking and calificacion for backward compatibility
    matchesPlayed: profile?.partidos_jugados || 0,
    matchesAbandoned: profile?.partidos_abandonados || 0,
    position: getPositionAbbr(profile?.posicion || profile?.posicion_favorita),
    number: profile?.numero || 10,
    countryCode: profile?.pais_codigo || 'AR',
    countryName: getCountryCode(profile?.pais_codigo)
  };
  
  // Force avatar URL to be valid
  if (playerData.avatarUrl && playerData.avatarUrl.startsWith('blob:')) {
    console.log('[AMIGOS] Using blob URL for avatar:', playerData.avatarUrl);
  } else if (!playerData.avatarUrl) {
    // Try avatar_url first (for authenticated users)
    if (profile?.avatar_url) {
      playerData.avatarUrl = profile.avatar_url;
      console.log('[AMIGOS] Using profile.avatar_url directly:', playerData.avatarUrl);
    } 
    // Then try foto_url (for guest users)
    else if (profile?.foto_url) {
      playerData.avatarUrl = profile.foto_url;
      console.log('[AMIGOS] Using profile.foto_url directly:', playerData.avatarUrl);
    }
  }
  
  // Debug avatar URL to ensure it's being used
  console.log('[AMIGOS] ProfileCard avatar sources:', {
    profile_avatar_url: profile?.avatar_url,
    profile_foto_url: profile?.foto_url,
    user_metadata_avatar_url: profile?.user_metadata?.avatar_url,
    user_metadata_picture: profile?.user_metadata?.picture,
    user_metadata_from_user: profile?.user?.user_metadata,
    final_avatar_url: avatarUrl
  });
  
  // Log the complete profile object for debugging
  console.log('[AMIGOS] ProfileCard complete profile object:', profile);

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

          {/* HEADER & AVATAR CONTAINER */}
          <div className="pc-content">
            {/* HEADER: Contains all top info */}
            <div className="pc-header">
              <div className="pc-top-info">
                <div className="pc-status-corner">
                  <div className={`pc-status-indicator ${playerData.status === 'Disponible' ? '' : 'unavailable'}`}></div>
                  <div className="pc-country-badge">
                    <img
                      src={`https://flagcdn.com/w40/${playerData.countryCode.toLowerCase()}.png`}
                      alt={playerData.countryName}
                      className="pc-flag"
                      onError={(e) => { e.target.style.display = "none"; }}
                    />
                    <span className="pc-country-code">{playerData.countryName}</span>
                  </div>
                </div>
                <div className="pc-stats-header">
                  <span className="pc-number">#{playerData.number}</span>
                  <span className="pc-position">{playerData.position}</span>
                </div>
              </div>
              <div className="pc-details">
                <h3>{playerData.name}</h3>
              </div>
            </div>

            {/* AVATAR: Positioned absolutely within pc-content */}
            <div className="pc-avatar-content">
              {playerData.avatarUrl ? (
                <img
                  className="avatar"
                  src={playerData.avatarUrl}
                  alt={`${playerData.name} avatar`}
                  loading="eager"
                  crossOrigin="anonymous"
                  onError={(e) => {
                    console.error('Error loading avatar image:', e.target.src);
                    e.target.style.display = "none";
                    const placeholder = document.createElement('div');
                    placeholder.className = 'avatar-placeholder';
                    placeholder.textContent = '👤';
                    e.target.parentNode.appendChild(placeholder);
                  }}
                  key={`avatar-${Date.now()}`}
                />
              ) : (
                <div className="avatar-placeholder">👤</div>
              )}
            </div>
          </div>

          {/* FOOTER: User Info */}
          <div className="pc-user-info">
            <div className="pc-user-stats">
              <div className="pc-handle">@{playerData.handle}</div>
              <div className="pc-matches-container">
                <span className="pc-matches-played">{playerData.matchesPlayed} PJ</span>
                <span className="pc-matches-abandoned">{playerData.matchesAbandoned} PA</span>
              </div>
            </div>
            <div className="pc-center-section">
              <img src="/logo.svg" alt="Armados" className="pc-center-logo" />
            </div>
            <div className="pc-rating-container">
              <div className="pc-rating-number">{playerData.rating.toFixed(1)}</div>
            </div>
          </div>
          
          {/* Friend action buttons */}
          {renderFriendActions()}
          
          {/* Private data section */}
          {renderPrivateData()}
        </div>
      </section>
    </div>
  );
};

const ProfileCard = React.memo(ProfileCardComponent);

export default ProfileCard;