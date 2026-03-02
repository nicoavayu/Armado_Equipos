import React from 'react';
import { Shield, MapPin, Users } from 'lucide-react';
import { formatSkillLevelLabel, getTeamAccent, getTeamBadgeStyle, getTeamGradientStyle } from '../utils/teamColors';

const CHIP_CLASS = 'font-oswald text-[10px] font-bold text-white/40 border border-white/10 bg-white/5 px-2 py-0.5 rounded-none uppercase tracking-wider';

const getStatValue = (stats, key) => {
  if (!stats || typeof stats !== 'object') return null;
  const value = stats[key];
  return Number.isFinite(Number(value)) ? Number(value) : null;
};

const TeamCard = React.memo(({ team, stats, onClick, footer, className = '' }) => {
  const gradientStyle = getTeamGradientStyle(team);
  const badgeStyle = getTeamBadgeStyle(team);
  const accent = getTeamAccent(team);
  const normalizedMemberCount = Number(team?.member_count);
  const memberCount = Number.isFinite(normalizedMemberCount) ? normalizedMemberCount : null;
  const memberLabel = `${memberCount ?? 0} ${memberCount === 1 ? 'jugador' : 'jugadores'}`;

  const played = getStatValue(stats, 'played');
  const won = getStatValue(stats, 'won');
  const draw = getStatValue(stats, 'draw');
  const lost = getStatValue(stats, 'lost');

  return (
    <button
      type="button"
      onClick={() => onClick?.(team)}
      className={`relative w-full rounded-none p-4 text-left border border-white/10 transition-all duration-300 bg-[#1e293b]/70 backdrop-blur-sm shadow-[0_8px_24px_rgba(0,0,0,0.35)] active:scale-[0.99] hover:border-white/20 font-oswald ${className}`}
      style={gradientStyle}
    >
      <span className="absolute left-4 right-4 top-0 h-[2px] rounded-none opacity-75" style={{ backgroundColor: accent }} />

      <div className="flex items-start gap-3">
        <div className="h-14 w-14 rounded-none overflow-hidden border border-white/30 bg-black/20 flex items-center justify-center shrink-0">
          {team?.crest_url ? (
            <img src={team.crest_url} alt={`Escudo ${team?.name || 'equipo'}`} className="h-full w-full object-cover" />
          ) : (
            <Shield size={26} className="text-white/80" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="font-oswald text-white text-lg tracking-wide truncate">{team?.name || 'Equipo sin nombre'}</h3>

          <div className="mt-1 flex flex-wrap gap-1.5">
            <span className={CHIP_CLASS} style={badgeStyle}>
              F{team?.format || '-'}
            </span>
            <span className={CHIP_CLASS} style={badgeStyle}>
              {formatSkillLevelLabel(team?.skill_level)}
            </span>
            {team?.base_zone ? (
              <span className={`${CHIP_CLASS} inline-flex items-center gap-1`} style={badgeStyle}>
                <MapPin size={11} /> {team.base_zone}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {(played !== null || won !== null || draw !== null || lost !== null) && (
        <div className="mt-3 grid grid-cols-4 gap-2">
          <div className="rounded-none border border-white/15 bg-black/15 px-2 py-1.5 text-center">
            <div className="font-oswald text-[10px] text-white/70">PJ</div>
            <div className="font-oswald text-sm font-bold text-white">{played ?? 0}</div>
          </div>
          <div className="rounded-none border border-white/15 bg-black/15 px-2 py-1.5 text-center">
            <div className="font-oswald text-[10px] text-white/70">PG</div>
            <div className="font-oswald text-sm font-bold" style={{ color: accent }}>{won ?? 0}</div>
          </div>
          <div className="rounded-none border border-white/15 bg-black/15 px-2 py-1.5 text-center">
            <div className="font-oswald text-[10px] text-white/70">PE</div>
            <div className="font-oswald text-sm font-bold text-white">{draw ?? 0}</div>
          </div>
          <div className="rounded-none border border-white/15 bg-black/15 px-2 py-1.5 text-center">
            <div className="font-oswald text-[10px] text-white/70">PP</div>
            <div className="font-oswald text-sm font-bold text-white">{lost ?? 0}</div>
          </div>
        </div>
      )}

      {footer ? (
        <div className="mt-3 pt-3 border-t border-white/15">{footer}</div>
      ) : (
        <div className="mt-3 text-[11px] text-white/70 inline-flex items-center gap-1.5 font-oswald">
          <Users size={12} /> {memberLabel} · Ver detalle del equipo
        </div>
      )}
    </button>
  );
});

export default TeamCard;
