import React from 'react';
import { MapPin } from 'lucide-react';
import TeamShieldAvatar from './TeamShieldAvatar';
import { getTeamBadgeStyle } from '../utils/teamColors';
import {
  computeWinRate,
  formatFormatLabel,
  formatZoneLabel,
  hasDefinedZone,
} from '../utils/teamRanking';

const CHIP_CLASS = 'font-oswald text-[10px] font-bold text-white/55 border border-[rgba(148,134,255,0.2)] bg-[rgba(20,16,41,0.8)] px-2 py-0.5 rounded-full uppercase tracking-wider inline-flex items-center gap-1';

const publishCtaClass = 'w-full min-h-[44px] px-4 py-2.5 rounded-xl border border-white/20 bg-cta-gradient text-white font-bebas text-[15px] tracking-[0.03em] flex items-center justify-center text-center transition-all duration-200 hover:brightness-105 active:scale-[0.985] shadow-cta disabled:opacity-45 disabled:cursor-not-allowed disabled:shadow-none';
const ownTeamCtaClass = 'w-full min-h-[44px] px-4 py-2.5 rounded-xl border border-[rgba(148,134,255,0.22)] bg-white/[0.04] text-white/55 font-bebas text-[15px] tracking-[0.03em] flex items-center justify-center text-center cursor-not-allowed';

const ChallengeableTeamCard = ({
  team,
  isOwnTeam = false,
  onPublishChallenge,
  disabled = false,
}) => {
  const badgeStyle = getTeamBadgeStyle(team);
  const played = Number(team?.played_count) || 0;
  const hasConfirmed = played > 0;
  const winRate = computeWinRate(team?.wins, team?.played_count);
  const zoneDefined = hasDefinedZone(team?.zone);

  return (
    <div className="relative w-full rounded-card p-3.5 font-oswald overflow-hidden border border-[rgba(148,134,255,0.18)] bg-[linear-gradient(165deg,rgba(48,38,98,0.6),rgba(20,16,41,0.92))] shadow-elev-1">
      <div className="flex items-start gap-3">
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

export default ChallengeableTeamCard;
