import React, { useEffect, useRef, useState } from 'react';
import { CalendarClock, CircleDollarSign, Flag, MapPin, MoreVertical, Pencil, Shield, ShieldQuestion, XCircle } from 'lucide-react';
import { normalizeTeamSkillLevel } from '../config';
import { formatSkillLevelLabel } from '../utils/teamColors';

const CTA_BY_STATUS = {
  open: 'Aceptar',
  accepted: 'Confirmar',
  confirmed: 'Ver detalle',
  completed: 'Finalizado',
  canceled: 'Cancelado',
};

const CHIP_BASE_CLASS = 'font-oswald text-[10px] font-medium px-2 py-[3px] rounded-full shrink-0 whitespace-nowrap leading-none inline-flex items-center gap-1';

const primaryCtaClass = 'w-full flex-1 font-bebas text-[16px] tracking-[0.04em] px-4 py-2.5 border border-white/20 rounded-xl cursor-pointer transition-all duration-200 text-white min-h-[48px] flex items-center justify-center text-center bg-cta-gradient shadow-cta hover:brightness-105 active:scale-[0.985]';
const secondaryCtaClass = 'w-full flex-1 font-bebas text-[16px] tracking-[0.04em] px-4 py-2.5 border border-[rgba(148,134,255,0.24)] rounded-xl cursor-pointer transition-all duration-200 text-white/90 min-h-[48px] flex items-center justify-center text-center bg-white/[0.04] hover:bg-white/[0.08] hover:border-[rgba(148,134,255,0.4)] active:scale-[0.985]';
const menuButtonClass = 'kebab-menu-btn';

const getFormatBadgeClass = (formatValue) => {
  const token = String(formatValue || '').toLowerCase();
  if (token.includes('11')) return 'border-[#818cf8]/50 bg-[#818cf8]/10 text-[#dbe2ff]';
  if (token.includes('9')) return 'border-[#22d3ee]/50 bg-[#22d3ee]/10 text-[#cffafe]';
  if (token.includes('8')) return 'border-[#f43f5e]/50 bg-[#f43f5e]/10 text-[#ffe4e6]';
  if (token.includes('7')) return 'border-[#a78bfa]/50 bg-[#a78bfa]/10 text-[#ede9fe]';
  if (token.includes('6')) return 'border-[#60a5fa]/50 bg-[#60a5fa]/10 text-[#dbeafe]';
  if (token.includes('5')) return 'border-[#22c55e]/50 bg-[#22c55e]/10 text-[#dcfce7]';
  return 'border-slate-500/50 bg-slate-500/10 text-white/85';
};

const getSkillBadgeClass = (skillLevel) => {
  const skill = normalizeTeamSkillLevel(skillLevel);
  if (skill === 'inicial') return 'border-[#22c55e]/50 bg-[#22c55e]/10 text-[#dcfce7]';
  if (skill === 'intermedio') return 'border-[#38bdf8]/50 bg-[#38bdf8]/10 text-[#dbeafe]';
  if (skill === 'competitivo') return 'border-[#facc15]/50 bg-[#facc15]/10 text-[#fef08a]';
  if (skill === 'avanzado') return 'border-[#fb923c]/50 bg-[#fb923c]/10 text-[#ffedd5]';
  if (skill === 'elite') return 'border-[#f87171]/50 bg-[#f87171]/10 text-[#fee2e2]';
  return 'border-slate-500/50 bg-slate-500/10 text-white/85';
};

const formatChallengeDate = (value) => {
  if (!value) return 'A coordinar';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'A coordinar';
  return parsed.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatMoneyAr = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed.toLocaleString('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
};

const TeamSide = ({ team, fallbackText }) => {
  const teamName = String(team?.name || 'Equipo').trim() || 'Equipo';
  const teamNameLength = teamName.length;
  const teamNameSizeClass = teamNameLength >= 20
    ? 'text-[clamp(15px,2.3vw,19px)] tracking-[0.02em]'
    : teamNameLength >= 15
      ? 'text-[clamp(16px,2.6vw,21px)] tracking-[0.03em]'
      : 'text-[clamp(19px,3.2vw,25px)] tracking-[0.04em]';

  if (!team) {
    return (
      <div className="flex-1 min-w-0 h-[196px] rounded-2xl border border-dashed border-[rgba(148,134,255,0.28)] bg-[radial-gradient(circle_at_50%_28%,rgba(139,92,255,0.07),transparent_62%),rgba(255,255,255,0.015)] px-3 py-3 flex flex-col items-center justify-center gap-3">
        <div className="relative flex items-center justify-center">
          <ShieldQuestion size={58} strokeWidth={1.1} className="text-[#9486ff]/30" />
        </div>
        <p className="font-bebas text-white/45 text-[15px] font-semibold tracking-[0.18em] uppercase">{fallbackText}</p>
      </div>
    );
  }

  return (
    <div className="flex-1 min-w-0 h-[196px] rounded-2xl border border-[rgba(148,134,255,0.32)] px-3 py-4 bg-[radial-gradient(circle_at_50%_0%,rgba(139,92,255,0.2),rgba(20,16,41,0.95)_56%),linear-gradient(180deg,#231b4f_0%,#13102c_100%)] shadow-[0_14px_28px_rgba(5,3,16,0.45),inset_0_1px_0_rgba(255,255,255,0.07)]">
      <div className="h-full flex flex-col items-center justify-center text-center">
        <div className="h-[72px] w-[72px] rounded-2xl overflow-hidden border border-[rgba(148,134,255,0.45)] bg-[linear-gradient(160deg,#3a2a7a_0%,#1d1740_70%)] flex items-center justify-center shrink-0 shadow-[0_8px_20px_rgba(5,3,16,0.5),inset_0_1px_0_rgba(255,255,255,0.12)]">
          {team.crest_url ? (
            <img src={team.crest_url} alt={teamName} className="h-full w-full object-cover" />
          ) : (
            <Shield size={34} strokeWidth={1.4} className="text-[#d9d0ff]" />
          )}
        </div>

        <div className={`mt-3 w-full min-w-0 flex items-center justify-center px-1 text-white font-bebas font-bold uppercase leading-none whitespace-nowrap overflow-hidden text-ellipsis ${teamNameSizeClass}`}>
          {teamName}
        </div>

        <div className="mt-2 h-[2px] w-7 rounded-full bg-[linear-gradient(90deg,rgba(236,0,125,0.85),rgba(139,92,255,0.6))]" />

        <div className={`${CHIP_BASE_CLASS} mt-3 max-w-full border border-[rgba(148,134,255,0.22)] bg-[rgba(20,16,41,0.85)] text-white/80 overflow-hidden text-ellipsis`}>
          <MapPin size={10} /> {team.base_zone || 'Sin definir'}
        </div>
      </div>
    </div>
  );
};

const ChallengeCard = ({
  challenge,
  onPrimaryAction,
  onCancel,
  primaryLabel,
  canCancel = false,
  disabled = false,
  isOwnChallenge = false,
  canEdit = false,
  onEdit = null,
}) => {
  const status = (challenge?.status || 'open').toLowerCase();
  const cta = primaryLabel || CTA_BY_STATUS[status] || 'Ver detalle';
  const locationLabel = String(challenge?.location || challenge?.location_name || '').trim() || 'A coordinar';
  const fieldPriceLabel = formatMoneyAr(challenge?.cancha_cost ?? challenge?.field_price);
  const challengeSkillLabel = formatSkillLevelLabel(challenge?.skill_level || challenge?.challenger_team?.skill_level);
  const challengeFormatLabel = `F${challenge?.format || '-'}`;
  const hasAcceptedTeam = Boolean(challenge?.accepted_team_id);
  const teamAFallbackText = hasAcceptedTeam ? 'Equipo rival' : 'Equipo A';
  const teamBFallbackText = hasAcceptedTeam ? 'Equipo rival' : 'Busco rival';
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const handleClickOutside = (event) => {
      if (!menuRef.current || menuRef.current.contains(event.target)) return;
      setMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  useEffect(() => {
    if (!canEdit && menuOpen) setMenuOpen(false);
  }, [canEdit, menuOpen]);

  return (
    <div
      className={`w-full rounded-[19px] p-px ${isOwnChallenge
        ? 'bg-[linear-gradient(150deg,rgba(236,0,125,0.55),rgba(148,134,255,0.4)_45%,rgba(106,67,255,0.4))]'
        : 'bg-[linear-gradient(150deg,rgba(176,160,255,0.4),rgba(148,134,255,0.18)_55%,rgba(148,134,255,0.3))]'
        }`}
    >
    <div
      className={`relative w-full rounded-card p-4 font-oswald overflow-hidden bg-[radial-gradient(380px_180px_at_16%_-28%,rgba(139,92,255,0.18),transparent_70%),linear-gradient(165deg,rgba(43,34,88,0.98),rgba(17,13,35,0.99))] shadow-elev-2 after:content-[''] after:absolute after:top-0 after:inset-x-0 after:h-px after:pointer-events-none ${isOwnChallenge
        ? 'after:bg-[linear-gradient(90deg,transparent_6%,rgba(236,0,125,0.55)_50%,transparent_94%)]'
        : 'after:bg-[linear-gradient(90deg,transparent_6%,rgba(176,160,255,0.45)_50%,transparent_94%)]'
        }`}
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          {isOwnChallenge ? (
            <span className={`${CHIP_BASE_CLASS} border border-[#E879F9]/45 bg-[#C026D3]/15 text-[#F5D0FE]`}>
              <Shield size={10} /> Mi desafio
            </span>
          ) : null}
          <span className={`${CHIP_BASE_CLASS} border ${getFormatBadgeClass(challengeFormatLabel)}`}>
            <Flag size={10} /> {challengeFormatLabel}
          </span>
          <span className={`${CHIP_BASE_CLASS} border ${getSkillBadgeClass(challenge?.skill_level || challenge?.challenger_team?.skill_level)}`}>
            {challengeSkillLabel}
          </span>
          <span className={`${CHIP_BASE_CLASS} border border-white/15 bg-white/[0.04] text-white/85`}>
            <CalendarClock size={10} /> {formatChallengeDate(challenge?.scheduled_at)}
          </span>
        </div>

        {canEdit ? (
          <div className="relative shrink-0" ref={menuRef}>
            <button
              type="button"
              className={menuButtonClass}
              onClick={(event) => {
                event.stopPropagation();
                setMenuOpen((prev) => !prev);
              }}
              aria-label="Mas acciones"
              title="Mas acciones"
            >
              <MoreVertical size={16} />
            </button>
            {menuOpen ? (
              <div className="admin-action-menu absolute right-0 mt-2 w-48 z-20" onClick={(event) => event.stopPropagation()}>
                <div className="py-1">
                  <button
                    type="button"
                    className="admin-action-menu-item"
                    onClick={() => {
                      setMenuOpen(false);
                      onEdit?.(challenge);
                    }}
                  >
                    <Pencil size={15} />
                    <span>Editar desafio</span>
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_42px_minmax(0,1fr)] sm:grid-cols-[minmax(0,1fr)_48px_minmax(0,1fr)] gap-1 items-center">
        <TeamSide team={challenge?.challenger_team} fallbackText={teamAFallbackText} />
        <div className="relative h-[196px] flex items-center justify-center overflow-visible">
          <span aria-hidden className="absolute h-[150px] w-[2px] rotate-[16deg] rounded-full bg-[linear-gradient(180deg,transparent,rgba(236,0,125,0.55)_38%,rgba(139,92,255,0.6)_62%,transparent)]" />
          <div className="relative text-white font-bebas font-bold italic text-[clamp(26px,4.5vw,32px)] tracking-[0.04em] leading-none drop-shadow-[0_0_14px_rgba(139,92,255,0.6)]">VS</div>
        </div>
        <TeamSide team={challenge?.accepted_team} fallbackText={teamBFallbackText} />
      </div>

      <div className="mt-3 w-full rounded-xl border border-white/[0.06] bg-white/[0.03] grid grid-cols-2 divide-x divide-white/[0.08]">
        <div className="flex flex-col items-center justify-center gap-1.5 py-3 px-2 min-w-0">
          <MapPin size={16} className="text-white/70 shrink-0" />
          <span className="font-oswald text-[12px] text-white/85 leading-none max-w-full overflow-hidden text-ellipsis whitespace-nowrap">{locationLabel}</span>
        </div>
        <div className="flex flex-col items-center justify-center gap-1.5 py-3 px-2 min-w-0">
          <CircleDollarSign size={16} className="text-white/70 shrink-0" />
          <span className="font-oswald text-[12px] text-white/85 leading-none max-w-full overflow-hidden text-ellipsis whitespace-nowrap">{fieldPriceLabel ? `Cancha ${fieldPriceLabel}` : 'Sin precio'}</span>
        </div>
      </div>

      {challenge?.notes ? (
        <p className="mt-3 text-[13px] leading-snug text-white/70 break-words font-sans border-l-2 border-[rgba(148,134,255,0.35)] pl-2.5">{challenge.notes}</p>
      ) : null}

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={onPrimaryAction}
          className={`${primaryCtaClass} gap-2 disabled:opacity-45 disabled:cursor-not-allowed`}
        >
          {/cancelar/i.test(cta) ? <XCircle size={17} className="shrink-0" /> : null}
          {cta}
        </button>

        {canCancel ? (
          <button
            type="button"
            disabled={disabled}
            onClick={onCancel}
            className={`${secondaryCtaClass} disabled:opacity-45 disabled:cursor-not-allowed`}
          >
            Cancelar
          </button>
        ) : null}
      </div>
    </div>
    </div>
  );
};

export default ChallengeCard;
