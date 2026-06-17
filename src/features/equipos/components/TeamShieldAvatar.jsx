import React from 'react';
import { Shield } from 'lucide-react';

// Premium circular/rounded team crest. Uses crest_url when present, otherwise a
// branded fallback: the team's initials over a violet shield-tone tile, or a
// Shield glyph when no name is available. Shared by the ranking and directory
// cards so the escudo treatment stays consistent.

const getInitials = (name) => {
  const words = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
};

const TeamShieldAvatar = ({
  team,
  size = 56,
  className = '',
}) => {
  const name = team?.team_name || team?.name || '';
  const crestUrl = team?.avatar_url || team?.crest_url || null;
  const initials = getInitials(name);
  const dimension = { width: size, height: size };

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border border-[rgba(148,134,255,0.45)] bg-[linear-gradient(160deg,#3a2a7a_0%,#1d1740_70%)] flex items-center justify-center shrink-0 shadow-[0_8px_20px_rgba(5,3,16,0.5),inset_0_1px_0_rgba(255,255,255,0.12)] ${className}`}
      style={dimension}
    >
      {crestUrl ? (
        <img
          src={crestUrl}
          alt={`Escudo ${name || 'equipo'}`}
          className="h-full w-full object-cover"
          loading="lazy"
        />
      ) : initials ? (
        <span
          className="font-bebas font-bold uppercase leading-none tracking-[0.04em] text-[#e9e2ff]"
          style={{ fontSize: Math.round(size * 0.42) }}
        >
          {initials}
        </span>
      ) : (
        <Shield size={Math.round(size * 0.5)} strokeWidth={1.4} className="text-[#d9d0ff]" />
      )}
    </div>
  );
};

export default TeamShieldAvatar;
