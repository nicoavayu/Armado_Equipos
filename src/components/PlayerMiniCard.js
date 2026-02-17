import React from 'react';
import { MapPin, MoreVertical, Star, User } from 'lucide-react';

const POS_MAP = { ARQ: 'ARQ', DEF: 'DEF', MED: 'MED', DEL: 'DEL', arquero: 'ARQ', defensor: 'DEF', mediocampista: 'MED', delantero: 'DEL' };
const POS_COLOR_MAP = { ARQ: '#FDB022', DEF: '#FF6B9D', MED: '#06C270', DEL: '#FF3B3B' };

const getPos = (p) => POS_MAP[p] || 'DEF';
const getPosColor = (p) => POS_COLOR_MAP[p] || '#8178e5';

const getInitials = (name) => {
  if (!name) return '?';
  return name
    .split(' ')
    .map((word) => word.charAt(0))
    .join('')
    .toUpperCase()
    .slice(0, 2);
};

const getBackgroundColor = (name) => {
  if (!name) return '#ccc';
  const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
};

const skinClasses = {
  searching: 'bg-[#1e293b]/70 border-white/5 hover:border-white/20 hover:bg-[#1e293b] shadow-sm',
  friend: 'bg-[linear-gradient(135deg,rgba(39,77,153,0.58),rgba(29,55,112,0.64))] backdrop-blur-lg border-[#3c78d6]/55 hover:border-[#4f8fec]/70 hover:bg-[linear-gradient(135deg,rgba(45,87,168,0.62),rgba(35,66,132,0.68))] shadow-[0_12px_28px_rgba(7,20,52,0.36)]',
};

const PlayerMiniCard = ({
  profile,
  variant = 'friend',
  distanceKm = null,
  showDistanceUnavailable = false,
  onClick,
  rightSlot = null,
  metaBadge = null,
  showMenuPlaceholder = false,
}) => {
  const name = profile?.nombre || 'Usuario';
  const avatarUrl = profile?.avatar_url || profile?.foto_url;
  const rawRatingCandidate = typeof profile?.rating === 'number'
    ? profile.rating
    : (typeof profile?.ranking === 'number'
      ? profile.ranking
      : (typeof profile?.calificacion === 'number' ? profile.calificacion : 5));
  const normalizedRating = Number.isFinite(rawRatingCandidate) && rawRatingCandidate > 0
    ? rawRatingCandidate
    : 5;
  const ratingStr = normalizedRating.toFixed(1);
  const posicion = getPos(profile?.posicion || profile?.rol_favorito || 'DEF');
  const posColor = getPosColor(posicion);
  const showDistance = variant === 'searching' && typeof distanceKm === 'number' && Number.isFinite(distanceKm);
  const showMissingDistance = variant === 'searching' && showDistanceUnavailable && !showDistance;
  const ratingContainerClass = variant === 'friend'
    ? 'bg-[#233f78]/88 border-[#e6bf4f]/35 text-[#ffe08a]'
    : 'bg-[#FFD700]/10 border-[#FFD700]/30 text-[#FFD700]';

  return (
    <div
      onClick={onClick}
      className={`relative flex items-center gap-3 rounded-xl p-3.5 border transition-all duration-200 ${skinClasses[variant] || skinClasses.friend} ${onClick ? 'cursor-pointer active:scale-[0.99]' : ''}`}
    >
      <div className="w-12 h-12 rounded-full overflow-hidden shrink-0 border border-white/15 bg-slate-800 flex items-center justify-center">
        {avatarUrl ? (
          <img src={avatarUrl} alt={name} className="w-full h-full object-cover" />
        ) : (
          <div
            className="w-full h-full flex items-center justify-center text-white text-xs font-semibold"
            style={{ backgroundColor: getBackgroundColor(name) }}
          >
            {getInitials(name) || <User size={18} />}
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className={`font-bebas text-lg tracking-wide leading-none truncate ${variant === 'friend' ? 'text-white' : 'text-white'}`}>
            {name}
          </span>
          {metaBadge}
        </div>

        <div className={`flex items-center gap-2.5 text-[11px] font-oswald uppercase tracking-wide ${variant === 'friend' ? 'text-[#d4e4ff]' : 'text-white/60'}`}>
          <div className={`inline-flex items-center gap-1 px-2 py-1 rounded border font-bold normal-case ${ratingContainerClass}`}>
            <Star size={12} fill="currentColor" />
            <span>{ratingStr}</span>
          </div>

          <div
            className="inline-flex items-center justify-center px-2 py-1 rounded text-[10px] font-bold text-white min-w-[34px]"
            style={{ backgroundColor: posColor }}
          >
            {posicion}
          </div>

          {showDistance && (
            <span className="inline-flex items-center gap-1 normal-case">
              <MapPin size={12} />
              {Math.round(distanceKm)} km
            </span>
          )}

          {showMissingDistance && (
            <span className="inline-flex items-center gap-1 normal-case text-white/40">
              <MapPin size={12} />
              Sin ubicacion
            </span>
          )}
        </div>
      </div>

      {rightSlot}
      {showMenuPlaceholder && !rightSlot && (
        <div className={variant === 'friend' ? 'text-[#d7e6ff]' : 'text-white/50'}>
          <MoreVertical size={18} />
        </div>
      )}
    </div>
  );
};

export default PlayerMiniCard;
