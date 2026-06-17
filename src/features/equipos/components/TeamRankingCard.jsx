import React from 'react';
import { MapPin } from 'lucide-react';
import TeamShieldAvatar from './TeamShieldAvatar';
import { getTeamBadgeStyle } from '../utils/teamColors';
import {
  computeWinRate,
  formatFormatLabel,
  formatZoneLabel,
  getRankAccent,
  hasDefinedZone,
} from '../utils/teamRanking';

const CHIP_CLASS = 'font-oswald text-[10px] font-bold text-white/55 border border-[rgba(148,134,255,0.2)] bg-[rgba(20,16,41,0.8)] px-2 py-0.5 rounded-full uppercase tracking-wider inline-flex items-center gap-1';

const publishCtaClass = 'w-full min-h-[44px] px-4 py-2.5 rounded-xl border border-white/20 bg-cta-gradient text-white font-bebas text-[15px] tracking-[0.03em] flex items-center justify-center text-center transition-all duration-200 hover:brightness-105 active:scale-[0.985] shadow-cta disabled:opacity-45 disabled:cursor-not-allowed disabled:shadow-none';
const ownTeamCtaClass = 'w-full min-h-[44px] px-4 py-2.5 rounded-xl border border-[rgba(148,134,255,0.22)] bg-white/[0.04] text-white/55 font-bebas text-[15px] tracking-[0.03em] flex items-center justify-center text-center cursor-not-allowed';

const StatCell = ({ label, value, accentColor }) => (
  <div className="flex-1 text-center">
    <div className="font-oswald text-[9px] uppercase tracking-wider text-white/50">{label}</div>
    <div className="font-oswald text-[15px] font-bold leading-tight" style={accentColor ? { color: accentColor } : undefined}>
      {value}
    </div>
  </div>
);

const TeamRankingCard = ({
  team,
  position,
  isOwnTeam = false,
  onPublishChallenge,
  disabled = false,
}) => {
  const badgeStyle = getTeamBadgeStyle(team);
  const rankAccent = getRankAccent(position);
  const winRate = computeWinRate(team?.wins, team?.played_count);
  const zoneDefined = hasDefinedZone(team?.zone);

  return (
    <div
      className={`relative w-full rounded-card p-3.5 font-oswald overflow-hidden border bg-[linear-gradient(165deg,rgba(48,38,98,0.6),rgba(20,16,41,0.92))] shadow-elev-1 ${
        rankAccent ? 'border-[rgba(245,196,81,0.28)]' : 'border-[rgba(148,134,255,0.18)]'
      }`}
    >
      {rankAccent ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-0 left-0 right-0 h-px"
          style={{ background: `linear-gradient(90deg,transparent 8%, ${rankAccent}88 50%, transparent 92%)` }}
        />
      ) : null}

      <div className="flex items-center gap-3">
        <div
          className="w-8 shrink-0 text-center font-bebas font-bold leading-none"
          style={{ color: rankAccent || 'rgba(255,255,255,0.55)', fontSize: rankAccent ? 22 : 18 }}
        >
          {position}
        </div>

        <TeamShieldAvatar team={team} size={52} />

        <div className="min-w-0 flex-1">
          <h3 className="font-oswald text-white text-[17px] leading-tight tracking-wide truncate">
            {team?.team_name || 'Equipo'}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className={CHIP_CLASS} style={badgeStyle}>{formatFormatLabel(team?.format)}</span>
            <span
              className={`${CHIP_CLASS} ${zoneDefined ? '' : 'opacity-70'}`}
              style={badgeStyle}
            >
              <MapPin size={11} /> {formatZoneLabel(team?.zone)}
            </span>
          </div>
        </div>

        <div className="shrink-0 text-right">
          <div className="font-bebas text-[22px] font-bold leading-none text-white">{winRate}%</div>
          <div className="font-oswald text-[9px] uppercase tracking-wider text-white/45">Victorias</div>
        </div>
      </div>

      <div className="mt-3 flex items-stretch rounded-xl border border-[rgba(148,134,255,0.16)] bg-black/25 px-2 py-2 divide-x divide-white/[0.08]">
        <StatCell label="PJ" value={team?.played_count ?? 0} />
        <StatCell label="G" value={team?.wins ?? 0} accentColor="#5cf2a6" />
        <StatCell label="E" value={team?.draws ?? 0} />
        <StatCell label="P" value={team?.losses ?? 0} accentColor="#ff8c9b" />
      </div>

      <div className="mt-3">
        {isOwnTeam ? (
          <button type="button" className={ownTeamCtaClass} disabled aria-disabled="true">
            Tu equipo
          </button>
        ) : (
          <>
            <button
              type="button"
              className={publishCtaClass}
              disabled={disabled}
              onClick={() => onPublishChallenge?.(team)}
            >
              Publicar desafío
            </button>
            <p className="mt-1.5 text-center text-[11px] leading-snug text-white/45 font-oswald">
              Usá este formato para que equipos como este puedan aceptar
            </p>
          </>
        )}
      </div>
    </div>
  );
};

export default TeamRankingCard;
