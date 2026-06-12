import React from 'react';
import { Shield, MapPin, Users } from 'lucide-react';
import { resolveTeamRosterLimit } from '../config';
import { formatSkillLevelLabel, getTeamAccent, getTeamBadgeStyle, getTeamProvidedColors } from '../utils/teamColors';

const CHIP_CLASS = 'font-oswald text-[10px] font-bold text-white/50 border border-[rgba(148,134,255,0.2)] bg-[rgba(20,16,41,0.8)] px-2 py-0.5 rounded-full uppercase tracking-wider';

const getStatValue = (stats, key) => {
  if (!stats || typeof stats !== 'object') return null;
  const value = stats[key];
  return Number.isFinite(Number(value)) ? Number(value) : null;
};

const TeamCard = React.memo(({ team, stats, onClick, footer, className = '' }) => {
  const badgeStyle = getTeamBadgeStyle(team);
  const accent = getTeamAccent(team);
  const bandColors = getTeamProvidedColors(team, 3);
  const hasColorBand = bandColors.length > 0;
  const normalizedMemberCount = Number(team?.member_count);
  const memberCount = Number.isFinite(normalizedMemberCount) ? normalizedMemberCount : null;
  const rosterLimit = resolveTeamRosterLimit(team?.format, team?.max_roster_size);
  const memberLabel = `${memberCount ?? 0}/${rosterLimit} jugadores`;

  const played = getStatValue(stats, 'played');
  const won = getStatValue(stats, 'won');
  const draw = getStatValue(stats, 'draw');
  const lost = getStatValue(stats, 'lost');

  return (
    <button
      type="button"
      onClick={() => onClick?.(team)}
      className={`relative w-full overflow-hidden rounded-card p-4 text-left border border-[rgba(148,134,255,0.18)] transition-all duration-300 bg-[linear-gradient(165deg,rgba(48,38,98,0.6),rgba(20,16,41,0.92))] shadow-elev-1 active:scale-[0.99] hover:border-[rgba(148,134,255,0.4)] font-oswald ${hasColorBand ? 'pl-7' : ''} ${className}`}
    >
      {hasColorBand ? (
        <span className="pointer-events-none absolute left-0 top-0 bottom-0 z-[1] w-[12px] overflow-hidden">
          <span
            className="grid h-full w-full"
            style={{ gridTemplateColumns: `repeat(${bandColors.length}, minmax(0, 1fr))` }}
          >
            {bandColors.map((color, index) => (
              <span key={`${color}-${index}`} style={{ backgroundColor: color }} />
            ))}
          </span>
        </span>
      ) : null}

      <div className="flex items-start gap-3">
        <div className="h-14 w-14 rounded-2xl overflow-hidden border border-[rgba(148,134,255,0.35)] bg-[#1d1740] flex items-center justify-center shrink-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]">
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
          <div className="rounded-xl border border-[rgba(148,134,255,0.16)] bg-black/25 px-2 py-1.5 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
            <div className="font-oswald text-[10px] text-white/70">PJ</div>
            <div className="font-oswald text-sm font-bold text-white">{played ?? 0}</div>
          </div>
          <div className="rounded-xl border border-[rgba(148,134,255,0.16)] bg-black/25 px-2 py-1.5 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
            <div className="font-oswald text-[10px] text-white/70">PG</div>
            <div className="font-oswald text-sm font-bold" style={{ color: accent }}>{won ?? 0}</div>
          </div>
          <div className="rounded-xl border border-[rgba(148,134,255,0.16)] bg-black/25 px-2 py-1.5 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
            <div className="font-oswald text-[10px] text-white/70">PE</div>
            <div className="font-oswald text-sm font-bold text-white">{draw ?? 0}</div>
          </div>
          <div className="rounded-xl border border-[rgba(148,134,255,0.16)] bg-black/25 px-2 py-1.5 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
            <div className="font-oswald text-[10px] text-white/70">PP</div>
            <div className="font-oswald text-sm font-bold text-white">{lost ?? 0}</div>
          </div>
        </div>
      )}

      {footer ? (
        <div className="mt-3 pt-3 border-t border-white/15">{footer}</div>
      ) : (
        <div className="mt-3 text-[11px] text-white/70 inline-flex items-center gap-2 font-oswald">
          <Users size={12} /> {memberLabel} · Ver detalle del equipo
        </div>
      )}
    </button>
  );
});

export default TeamCard;
