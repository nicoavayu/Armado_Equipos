import React from 'react';
import TeamShieldAvatar from './TeamShieldAvatar';
import {
  computeWinRate,
  formatFormatLabel,
  formatZoneLabel,
  getRankAccent,
  hasDefinedZone,
} from '../utils/teamRanking';

// Compact premium "row" card for the Ranking tab. Denser than the directory
// card on purpose: more teams per screen, all the info on a single meta line
// (formato · zona · PJ/G/E/P) with the win rate kept prominent on the right.
const publishCtaClass = 'w-full min-h-[38px] px-3 py-2 rounded-lg border border-white/20 bg-cta-gradient text-white font-bebas text-[14px] tracking-[0.03em] flex items-center justify-center text-center transition-all duration-200 hover:brightness-105 active:scale-[0.985] shadow-cta disabled:opacity-45 disabled:cursor-not-allowed disabled:shadow-none';
const ownTeamCtaClass = 'w-full min-h-[38px] px-3 py-2 rounded-lg border border-[rgba(148,134,255,0.22)] bg-white/[0.04] text-white/55 font-bebas text-[14px] tracking-[0.03em] flex items-center justify-center text-center cursor-not-allowed';

const TeamRankingCard = ({
  team,
  position,
  isOwnTeam = false,
  onPublishChallenge,
  disabled = false,
}) => {
  const rankAccent = getRankAccent(position);
  const winRate = computeWinRate(team?.wins, team?.played_count);
  const zoneDefined = hasDefinedZone(team?.zone);
  const played = Number(team?.played_count) || 0;
  const wins = Number(team?.wins) || 0;
  const draws = Number(team?.draws) || 0;
  const losses = Number(team?.losses) || 0;

  return (
    <div
      className={`relative w-full rounded-card px-3 py-2.5 font-oswald overflow-hidden border bg-[linear-gradient(165deg,rgba(48,38,98,0.6),rgba(20,16,41,0.92))] shadow-elev-1 ${
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

      <div className="flex items-center gap-2.5">
        <div
          className="w-6 shrink-0 text-center font-bebas font-bold leading-none"
          style={{ color: rankAccent || 'rgba(255,255,255,0.5)', fontSize: rankAccent ? 20 : 15 }}
        >
          {position}
        </div>

        <TeamShieldAvatar team={team} size={44} />

        <div className="min-w-0 flex-1">
          <h3 className="font-oswald text-white text-[15px] leading-tight tracking-wide truncate">
            {team?.team_name || 'Equipo'}
          </h3>
          <p className="mt-0.5 truncate font-oswald text-[11.5px] leading-tight text-white/55">
            <span className="font-semibold text-[#b9a8ff]">{formatFormatLabel(team?.format)}</span>
            {' · '}
            <span className={zoneDefined ? '' : 'text-white/40'}>{formatZoneLabel(team?.zone)}</span>
            {' · '}
            <span>{played} PJ</span>{' · '}
            <span className="text-[#5cf2a6]">{wins}G</span>{' · '}
            <span>{draws}E</span>{' · '}
            <span className="text-[#ff8c9b]">{losses}P</span>
          </p>
        </div>

        <div className="shrink-0 pl-1 text-right">
          <div className="font-bebas text-[20px] font-bold leading-none text-white">{winRate}%</div>
          <div className="font-oswald text-[8.5px] uppercase tracking-wider text-white/40">Victorias</div>
        </div>
      </div>

      <div className="mt-2.5">
        {isOwnTeam ? (
          <button type="button" className={ownTeamCtaClass} disabled aria-disabled="true">
            Tu equipo
          </button>
        ) : (
          <button
            type="button"
            className={publishCtaClass}
            disabled={disabled}
            onClick={() => onPublishChallenge?.(team)}
          >
            Publicar desafío
          </button>
        )}
      </div>
    </div>
  );
};

export default TeamRankingCard;
