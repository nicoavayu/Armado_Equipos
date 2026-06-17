import React, { useState } from 'react';
import { Clock, MapPin, MoreVertical, Swords } from 'lucide-react';
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

// Compact directory card for the "Equipos" tab. Escudo, name, format + flag/zone
// chips and a stats strip — no big repeated CTA. The action lives in a 3-dot
// overflow menu (top-right):
//   - mi propio equipo  -> card resaltada + badge "Tu equipo" (sin menú)
//   - desafío pendiente -> pill "Desafío pendiente" (sin menú)
//   - rival             -> menú ⋮ con "Desafiar" (abre el modal de desafío)
// Nunca "Publicar desafío": la acción queda asociada al equipo elegido.
const ChallengeableTeamCard = ({
  team,
  isOwnTeam = false,
  isPendingChallenge = false,
  canChallenge = true,
  onChallenge,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const badgeStyle = getTeamBadgeStyle(team);
  const played = Number(team?.played_count) || 0;
  const wins = Number(team?.wins) || 0;
  const draws = Number(team?.draws) || 0;
  const losses = Number(team?.losses) || 0;
  const hasConfirmed = played > 0;
  const winRate = computeWinRate(team?.wins, team?.played_count);
  const zoneDefined = hasDefinedZone(team?.zone);
  const flag = getTeamFlag(team);

  const showMenu = !isOwnTeam && !isPendingChallenge && canChallenge;

  const cardClass = isOwnTeam
    ? 'border-[rgba(125,90,255,0.55)] bg-[linear-gradient(165deg,rgba(106,67,255,0.3),rgba(20,16,41,0.92))] shadow-[0_0_0_1px_rgba(125,90,255,0.22),0_10px_26px_rgba(106,67,255,0.18)]'
    : 'border-[rgba(148,134,255,0.18)] bg-[linear-gradient(165deg,rgba(48,38,98,0.6),rgba(20,16,41,0.92))] shadow-elev-1';

  return (
    <div className={`relative w-full rounded-card p-3 font-oswald overflow-hidden border ${cardClass}`}>
      {isOwnTeam ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-0 top-1/2 h-[64%] w-[3px] -translate-y-1/2 rounded-r bg-[#7d5aff]"
        />
      ) : null}

      <div className="flex items-start gap-3">
        <TeamShieldAvatar team={team} size={44} />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="min-w-0 flex-1 truncate font-oswald text-white text-[16px] leading-tight tracking-wide">
              {team?.team_name || 'Equipo'}
            </h3>
            {isOwnTeam ? (
              <span className="shrink-0 rounded-full border border-[rgba(148,134,255,0.45)] bg-[rgba(106,67,255,0.3)] px-2 py-0.5 font-oswald text-[9px] font-bold uppercase tracking-wider text-[#e7e0ff]">
                Tu equipo
              </span>
            ) : null}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
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

        {isPendingChallenge && !isOwnTeam ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[rgba(148,134,255,0.28)] bg-[rgba(106,67,255,0.14)] px-2.5 py-1 font-bebas text-[12px] tracking-[0.02em] text-[#cdbcff]">
            <Clock size={12} /> Desafío pendiente
          </span>
        ) : showMenu ? (
          <div className="relative shrink-0">
            <button
              type="button"
              aria-label="Acciones"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
              className="grid h-9 w-9 -mr-1 -mt-0.5 place-items-center rounded-lg border border-[rgba(148,134,255,0.22)] bg-[rgba(20,16,41,0.7)] text-white/70 transition-colors hover:border-[rgba(148,134,255,0.4)] hover:text-white active:opacity-90"
            >
              <MoreVertical size={18} />
            </button>
            {menuOpen ? (
              <>
                <button
                  type="button"
                  aria-hidden="true"
                  tabIndex={-1}
                  onClick={() => setMenuOpen(false)}
                  className="fixed inset-0 z-40 cursor-default"
                />
                <div
                  role="menu"
                  className="absolute right-0 top-full z-50 mt-1 min-w-[160px] overflow-hidden rounded-xl border border-[rgba(148,134,255,0.28)] bg-[#161033] py-1 shadow-[0_12px_30px_rgba(5,3,16,0.6)]"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      onChallenge?.(team);
                    }}
                    className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left font-bebas text-[15px] tracking-[0.02em] text-white transition-colors hover:bg-white/[0.08] active:bg-white/[0.12]"
                    data-preserve-button-case="true"
                  >
                    <Swords size={15} /> Desafiar
                  </button>
                </div>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      {hasConfirmed ? (
        <div className="mt-2.5 flex items-center justify-between rounded-lg border border-[rgba(148,134,255,0.16)] bg-black/25 px-2.5 py-1.5">
          <span className="font-oswald text-[12px] tracking-wide text-white/80 tabular-nums">
            {played} PJ · {wins}G · {draws}E · {losses}P
          </span>
          <span className="font-bebas text-[15px] font-bold text-white tabular-nums">{winRate}%</span>
        </div>
      ) : (
        <div className="mt-2.5 rounded-lg border border-[rgba(148,134,255,0.16)] bg-black/20 px-2.5 py-1.5 text-center">
          <span className="font-oswald text-[12px] text-white/55">Sin partidos confirmados</span>
        </div>
      )}
    </div>
  );
};

export default ChallengeableTeamCard;
