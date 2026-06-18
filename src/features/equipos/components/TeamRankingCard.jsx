import React from 'react';
import TeamShieldAvatar from './TeamShieldAvatar';
import {
  computeWinRate,
  formatZoneLabel,
  getRankAccent,
  getTeamFlag,
  hasDefinedZone,
} from '../utils/teamRanking';

// One compact row of the Ranking sports table. Intentionally low + dense so
// more teams fit per screen and columns line up with the sortable header.
// Columns: # | Equipo (escudo + bandera/zona) | F | G | E | P | %.
const TeamRankingCard = ({
  team,
  position,
  isOwnTeam = false,
  gridTemplate,
}) => {
  const rankAccent = getRankAccent(position);
  const winRate = computeWinRate(team?.wins, team?.played_count);
  const zoneDefined = hasDefinedZone(team?.zone);
  const format = String(team?.format ?? '').replace(/\D/g, '');
  const wins = Number(team?.wins) || 0;
  const draws = Number(team?.draws) || 0;
  const losses = Number(team?.losses) || 0;
  const flag = getTeamFlag(team);

  const cellClass = 'self-center text-center font-oswald text-[12.5px] tabular-nums leading-none';

  // "Tu equipo" se comunica con el ROW completo (fondo violeta + borde interno +
  // barra de acento), nunca con un badge dentro de la celda del nombre: así el
  // nombre usa todo el ancho y trunca limpio sin que nada lo tape.
  const rowAccent = isOwnTeam ? '#7d5aff' : rankAccent;
  const rowBg = isOwnTeam
    ? 'bg-[rgba(106,67,255,0.16)] ring-1 ring-inset ring-[rgba(125,90,255,0.5)]'
    : rankAccent
      ? 'bg-[rgba(245,196,81,0.05)]'
      : 'odd:bg-white/[0.015]';

  return (
    <div
      role="row"
      data-own-team={isOwnTeam ? 'true' : undefined}
      className={`relative grid items-center border-b border-white/[0.06] px-2.5 py-2 last:border-b-0 transition-colors duration-150 ${rowBg}`}
      style={{ gridTemplateColumns: gridTemplate, columnGap: 4 }}
    >
      {rowAccent ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-0 top-1/2 h-[60%] w-[3px] -translate-y-1/2 rounded-r"
          style={{ background: rowAccent }}
        />
      ) : null}

      <div
        role="cell"
        className="self-center text-center font-bebas font-bold leading-none"
        style={{ color: rankAccent || 'rgba(255,255,255,0.45)', fontSize: rankAccent ? 16 : 13 }}
      >
        {position}
      </div>

      <div role="cell" className="flex min-w-0 items-center gap-2">
        {isOwnTeam ? <span className="sr-only">Tu equipo</span> : null}
        <TeamShieldAvatar team={team} size={26} className="!rounded-lg" />
        <div className="min-w-0 flex-1">
          <span className={`block truncate font-oswald text-[13.5px] leading-tight tracking-wide ${isOwnTeam ? 'text-[#e7e0ff]' : 'text-white'}`}>
            {team?.team_name || 'Equipo'}
          </span>
          <div className={`mt-0.5 flex items-center gap-1 truncate font-oswald text-[10.5px] leading-tight ${zoneDefined ? 'text-white/55' : 'text-white/40'}`}>
            <span aria-hidden="true" className="text-[11px] leading-none">{flag}</span>
            <span className="truncate">{formatZoneLabel(team?.zone)}</span>
          </div>
        </div>
      </div>

      <div role="cell" className={`${cellClass} font-semibold text-[#b9a8ff]`}>{format ? `F${format}` : '—'}</div>
      <div role="cell" className={`${cellClass} text-[#5cf2a6]`}>{wins}</div>
      <div role="cell" className={`${cellClass} text-white/70`}>{draws}</div>
      <div role="cell" className={`${cellClass} text-[#ff8c9b]`}>{losses}</div>
      <div role="cell" className="self-center text-center font-bebas text-[16px] font-bold leading-none text-white tabular-nums">
        {winRate}
        <span className="font-oswald text-[9px] font-semibold text-white/45">%</span>
      </div>
    </div>
  );
};

export default TeamRankingCard;
