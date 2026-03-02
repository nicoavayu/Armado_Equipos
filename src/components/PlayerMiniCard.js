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
  searching: 'bg-[rgba(15,24,56,0.72)] border-[rgba(88,107,170,0.46)] hover:border-[#4a7ed6] hover:brightness-[1.03] shadow-none',
  friend: 'bg-[rgba(20,31,70,0.82)] border-[rgba(98,117,184,0.58)] hover:border-[rgba(124,142,210,0.62)] hover:bg-[rgba(30,45,94,0.95)] shadow-none',
  friendSelf: 'bg-[linear-gradient(135deg,rgba(127,92,18,0.62),rgba(79,54,12,0.78))] border-[#f4d37b]/75 hover:border-[#ffe39d] hover:bg-[linear-gradient(135deg,rgba(145,106,24,0.68),rgba(93,64,16,0.82))] shadow-[0_0_0_1px_rgba(244,211,123,0.2),0_10px_22px_rgba(44,28,6,0.45)]',
};

const PlayerMiniCard = ({
  profile,
  variant = 'friend',
  distanceKm = null,
  showDistanceUnavailable = false,
  onClick,
  rightSlot = null,
  metaBadge = null,
  detailBadges = null,
  showRating = true,
  showMenuPlaceholder = false,
  isSelf = false,
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
  const isSelfFriendCard = variant === 'friend' && isSelf;
  const cardSkinClass = isSelfFriendCard
    ? skinClasses.friendSelf
    : (skinClasses[variant] || skinClasses.friend);
  const ratingContainerClass = isSelfFriendCard
    ? 'bg-[#5b3e0b]/80 border-[#f4d37b]/65 text-[#ffecb8]'
    : (variant === 'friend'
      ? 'bg-[rgba(10,21,52,0.9)] border-[#e6bf4f]/35 text-[#ffe08a]'
      : 'bg-[#FFD700]/10 border-[#FFD700]/30 text-[#FFD700]');
  const nameClass = isSelfFriendCard ? 'text-[#fff4d1]' : 'text-white';
  const detailTextClass = isSelfFriendCard ? 'text-[#ffe6ac]' : (variant === 'friend' ? 'text-white/72' : 'text-white/60');
  const avatarBorderClass = isSelfFriendCard ? 'border-[#f4d37b]/60' : 'border-white/15';
  const placeholderMenuClass = isSelfFriendCard
    ? 'text-[#ffe6ac]'
    : (variant === 'friend' ? 'text-[#d7e6ff]' : 'text-white/50');
  const cardShapeClass = (variant === 'friend' || variant === 'searching') ? 'rounded-none' : 'rounded-xl';

  return (
    <div
      onClick={onClick}
      className={`relative flex items-center gap-3 p-3.5 border transition-all duration-200 ${cardShapeClass} ${cardSkinClass} ${onClick ? 'cursor-pointer active:scale-[0.99]' : ''}`}
    >
      <div className={`w-12 h-12 rounded-full overflow-hidden shrink-0 border bg-slate-800 flex items-center justify-center ${avatarBorderClass}`}>
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
          <span className={`font-bebas text-lg tracking-wide leading-none truncate ${nameClass}`}>
            {name}
          </span>
          {metaBadge}
        </div>

        <div className={`flex items-center gap-2.5 text-[11px] font-oswald uppercase tracking-wide ${detailTextClass}`}>
          {showRating ? (
            <div className={`inline-flex items-center gap-1 px-2 py-1 rounded border font-bold normal-case ${ratingContainerClass}`}>
              <Star size={12} fill="currentColor" />
              <span>{ratingStr}</span>
            </div>
          ) : null}

          <div
            className="inline-flex items-center justify-center px-2 py-1 rounded text-[10px] font-bold text-white min-w-[34px]"
            style={{ backgroundColor: posColor }}
          >
            {posicion}
          </div>

          {detailBadges}

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
        <div className={placeholderMenuClass}>
          <MoreVertical size={18} />
        </div>
      )}
    </div>
  );
};

export default PlayerMiniCard;
