import React from 'react';
import { MapPin } from 'lucide-react';
import TeamShieldAvatar from './TeamShieldAvatar';
import { getTeamBadgeStyle } from '../utils/teamColors';
import {
  computeWinRate,
  formatFormatLabel,
  formatZoneLabel,
  getTeamFlag,
  hasDefinedZone,
} from '../utils/teamRanking';

const CHIP_CLASS = 'font-oswald text-[10px] font-bold text-white/55 border border-[rgba(148,134,255,0.2)] bg-[rgba(20,16,41,0.8)] px-2 py-0.5 rounded-full uppercase tracking-wider inline-flex items-center gap-1';

// Exploratory directory card for the "Equipos" tab. Stays more visual/airy than
// a ranking row: escudo, name, format + flag/zone chips, and a stats strip.
// No "Publicar desafío" CTA yet — direct team-vs-team challenges are not wired,
// so we don't surface a button that promises an action we can't fulfil. The
// "Desafiar" CTA slot lives at the bottom of the card for when that lands.
const ChallengeableTeamCard = ({
  team,
  isOwnTeam = false,
}) => {
  const badgeStyle = getTeamBadgeStyle(team);
  const played = Number(team?.played_count) || 0;
  const hasConfirmed = played > 0;
  const winRate = computeWinRate(team?.wins, team?.played_count);
  const zoneDefined = hasDefinedZone(team?.zone);
  const flag = getTeamFlag(team);

  return (
    <div className="relative w-full rounded-card p-3.5 font-oswald overflow-hidden border border-[rgba(148,134,255,0.18)] bg-[linear-gradient(165deg,rgba(48,38,98,0.6),rgba(20,16,41,0.92))] shadow-elev-1">
      <div className="flex items-start gap-3">
        <TeamShieldAvatar team={team} size={52} />

        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <h3 className="min-w-0 flex-1 font-oswald text-white text-[17px] leading-tight tracking-wide truncate">
              {team?.team_name || 'Equipo'}
            </h3>
            {isOwnTeam ? (
              <span className="shrink-0 rounded-full border border-[rgba(148,134,255,0.4)] bg-[rgba(106,67,255,0.22)] px-2 py-0.5 font-oswald text-[9px] font-bold uppercase tracking-wider text-[#cdbcff]">
                Tu equipo
              </span>
            ) : null}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className={CHIP_CLASS} style={badgeStyle}>{formatFormatLabel(team?.format)}</span>
            <span
              className={`${CHIP_CLASS} ${zoneDefined ? '' : 'opacity-70'}`}
              style={badgeStyle}
            >
              <span aria-hidden="true" className="text-[11px] leading-none">{flag}</span>
              <MapPin size={11} /> {formatZoneLabel(team?.zone)}
            </span>
          </div>
        </div>
      </div>

      {hasConfirmed ? (
        <div className="mt-3 flex items-center justify-between rounded-xl border border-[rgba(148,134,255,0.16)] bg-black/25 px-3 py-2">
          <span className="font-oswald text-[12px] text-white/80 tracking-wide">
            {played} PJ · {team?.wins ?? 0}G · {team?.draws ?? 0}E · {team?.losses ?? 0}P
          </span>
          <span className="font-bebas text-[16px] font-bold text-white">{winRate}%</span>
        </div>
      ) : (
        <div className="mt-3 rounded-xl border border-[rgba(148,134,255,0.16)] bg-black/20 px-3 py-2 text-center">
          <span className="font-oswald text-[12px] text-white/55">Sin partidos confirmados</span>
        </div>
      )}
    </div>
  );
};

export default ChallengeableTeamCard;
