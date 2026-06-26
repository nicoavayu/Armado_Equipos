import React from 'react';
import { MapPin, MoreVertical, Star, User } from 'lucide-react';

const POS_MAP = {
  ARQ: 'ARQ',
  DEF: 'DEF',
  MED: 'MED',
  DEL: 'DEL',
  arq: 'ARQ',
  def: 'DEF',
  med: 'MED',
  del: 'DEL',
  arquero: 'ARQ',
  defensor: 'DEF',
  mediocampista: 'MED',
  delantero: 'DEL',
};
const POS_COLOR_MAP = { ARQ: '#FDB022', DEF: '#FF6B9D', MED: '#06C270', DEL: '#FF3B3B' };

const getPos = (p) => {
  const raw = String(p || '').trim();
  if (!raw) return 'DEF';
  return POS_MAP[raw] || POS_MAP[raw.toUpperCase()] || 'DEF';
};
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
  searching: 'bg-[linear-gradient(165deg,rgba(48,38,98,0.55),rgba(20,16,41,0.88))] border-[rgba(148,134,255,0.14)] hover:border-[rgba(148,134,255,0.42)] hover:brightness-[1.05] shadow-[0_6px_16px_rgba(5,3,16,0.35),inset_0_1px_0_rgba(255,255,255,0.05)]',
  friend: 'bg-[linear-gradient(165deg,rgba(48,38,98,0.68),rgba(20,16,41,0.92))] border-[rgba(148,134,255,0.16)] hover:border-[rgba(148,134,255,0.42)] hover:brightness-[1.06] shadow-[0_6px_16px_rgba(5,3,16,0.35),inset_0_1px_0_rgba(255,255,255,0.05)]',
  friendSelf: 'bg-[linear-gradient(165deg,rgba(48,38,98,0.68),rgba(20,16,41,0.92))] border-[rgba(148,134,255,0.16)] border-l-[3px] border-l-[#f4d37b] hover:border-[rgba(148,134,255,0.42)] hover:border-l-[#ffe39d] hover:brightness-[1.06] shadow-[inset_1px_0_0_rgba(244,211,123,0.45),0_6px_16px_rgba(5,3,16,0.35)]',
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
    ? 'bg-[rgba(10,21,52,0.9)] border-[#e6bf4f]/35 text-[#ffe08a]'
    : (variant === 'friend'
      ? 'bg-[rgba(10,21,52,0.9)] border-[#e6bf4f]/35 text-[#ffe08a]'
      : 'bg-[#FFD700]/10 border-[#FFD700]/30 text-[#FFD700]');
  const nameClass = 'text-white';
  const detailTextClass = variant === 'friend' ? 'text-white/72' : 'text-white/60';
  const avatarBorderClass = isSelfFriendCard ? 'border-[#f4d37b]/60' : 'border-[rgba(148,134,255,0.35)]';
  const placeholderMenuClass = isSelfFriendCard
    ? 'text-[#d7e6ff]'
    : (variant === 'friend' ? 'text-[#d7e6ff]' : 'text-white/50');
  const cardShapeClass = 'rounded-card';

  return (
    <div
      onClick={onClick}
      className={`relative flex items-center gap-2.5 px-3.5 py-2.5 border transition-all duration-200 ${cardShapeClass} ${cardSkinClass} ${onClick ? 'cursor-pointer active:scale-[0.99]' : ''}`}
    >
      <div className={`w-10 h-10 rounded-full overflow-hidden shrink-0 border-2 bg-[#1d1740] flex items-center justify-center shadow-[0_3px_10px_rgba(5,3,16,0.45)] ${avatarBorderClass}`}>
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
        <div className="flex items-center gap-2 mb-0.5">
          <span className={`font-bebas text-[17px] tracking-wide leading-none truncate ${nameClass}`}>
            {name}
          </span>
          {metaBadge}
        </div>

        <div className={`flex items-center gap-2 text-[11px] font-oswald uppercase tracking-wide ${detailTextClass}`}>
          {showRating ? (
            <div className={`inline-flex items-center gap-1 px-2 py-[3px] rounded-full border font-bold normal-case ${ratingContainerClass}`}>
              <Star size={11} fill="currentColor" />
              <span>{ratingStr}</span>
            </div>
          ) : null}

          <div
            className="inline-flex items-center justify-center px-2 py-[3px] rounded-full text-[10px] font-bold text-white min-w-[36px] uppercase tracking-[0.04em]"
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
