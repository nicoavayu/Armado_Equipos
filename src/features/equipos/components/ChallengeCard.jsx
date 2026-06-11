import React, { useEffect, useRef, useState } from 'react';
import { CalendarClock, Flag, MapPin, MoreVertical, Pencil, Shield } from 'lucide-react';
import { normalizeTeamSkillLevel } from '../config';
import { formatSkillLevelLabel } from '../utils/teamColors';

const CTA_BY_STATUS = {
  open: 'Aceptar',
  accepted: 'Confirmar',
  confirmed: 'Ver detalle',
  completed: 'Finalizado',
  canceled: 'Cancelado',
};

const CHIP_BASE_CLASS = 'font-oswald text-[11px] font-semibold px-2.5 py-1 rounded-full shrink-0 whitespace-nowrap';

const primaryCtaClass = 'w-full flex-1 font-bebas text-[16px] tracking-[0.04em] px-4 py-2.5 border border-white/20 rounded-xl cursor-pointer transition-all duration-200 text-white min-h-[48px] flex items-center justify-center text-center bg-cta-gradient shadow-cta hover:brightness-105 active:scale-[0.985]';
const secondaryCtaClass = 'w-full flex-1 font-bebas text-[16px] tracking-[0.04em] px-4 py-2.5 border border-[rgba(148,134,255,0.24)] rounded-xl cursor-pointer transition-all duration-200 text-white/90 min-h-[48px] flex items-center justify-center text-center bg-white/[0.04] hover:bg-white/[0.08] hover:border-[rgba(148,134,255,0.4)] active:scale-[0.985]';
const menuButtonClass = 'kebab-menu-btn';

const getFormatBadgeClass = (formatValue) => {
  const token = String(formatValue || '').toLowerCase();
  if (token.includes('11')) return 'bg-[#1a2450] border-[#818cf8] text-[#e0e7ff]';
  if (token.includes('9')) return 'bg-[#0f3b42] border-[#22d3ee] text-[#cffafe]';
  if (token.includes('8')) return 'bg-[#4a1a30] border-[#f43f5e] text-[#ffe4e6]';
  if (token.includes('7')) return 'bg-[#321d5a] border-[#a78bfa] text-[#ede9fe]';
  if (token.includes('6')) return 'bg-[#1b2f55] border-[#60a5fa] text-[#dbeafe]';
  if (token.includes('5')) return 'bg-[#0f2f23] border-[#22c55e] text-[#dcfce7]';
  return 'bg-slate-700 border-slate-500 text-white';
};

const getSkillBadgeClass = (skillLevel) => {
  const skill = normalizeTeamSkillLevel(skillLevel);
  if (skill === 'inicial') return 'bg-[#0f2f23] border-[#22c55e] text-[#dcfce7]';
  if (skill === 'intermedio') return 'bg-[#113248] border-[#38bdf8] text-[#dbeafe]';
  if (skill === 'competitivo') return 'bg-[#3b3112] border-[#facc15] text-[#fef08a]';
  if (skill === 'avanzado') return 'bg-[#44200f] border-[#fb923c] text-[#ffedd5]';
  if (skill === 'elite') return 'bg-[#3f1119] border-[#f87171] text-[#fee2e2]';
  return 'bg-slate-700 border-slate-500 text-white';
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
    ? 'text-[clamp(15px,2.3vw,19px)] tracking-[0.006em]'
    : teamNameLength >= 15
      ? 'text-[clamp(16px,2.6vw,20px)] tracking-[0.01em]'
      : 'text-[clamp(17px,2.8vw,22px)] tracking-[0.014em]';

  if (!team) {
    return (
      <div className="flex-1 min-w-0 h-[168px] rounded-2xl border border-dashed border-[rgba(148,134,255,0.3)] bg-white/[0.025] px-3 py-3 flex items-center justify-center">
        <p className="font-oswald text-white/55 text-xs font-semibold tracking-[0.1em] uppercase">{fallbackText}</p>
      </div>
    );
  }

  return (
    <div className="flex-1 min-w-0 h-[168px] rounded-2xl border border-[rgba(148,134,255,0.3)] px-3 py-3 bg-[radial-gradient(circle_at_50%_0%,rgba(139,92,255,0.18),rgba(20,16,41,0.95)_52%),linear-gradient(180deg,#221a4d_0%,#13102c_100%)] shadow-[0_14px_28px_rgba(5,3,16,0.45),inset_0_1px_0_rgba(255,255,255,0.07)]">
      <div className="h-full flex flex-col items-center text-center">
        <div className="h-12 w-12 rounded-2xl overflow-hidden border border-[rgba(148,134,255,0.4)] bg-[#1d1740] flex items-center justify-center shrink-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]">
          {team.crest_url ? (
            <img src={team.crest_url} alt={teamName} className="h-full w-full object-cover" />
          ) : (
            <Shield size={20} className="text-[#cfc4ff]" />
          )}
        </div>

        <div className={`mt-2 w-full min-w-0 h-[30px] flex items-center justify-center px-1 text-white font-oswald font-semibold leading-none whitespace-nowrap overflow-hidden text-ellipsis ${teamNameSizeClass}`}>
          {teamName}
        </div>

        <div className="mt-2 h-px w-full bg-[linear-gradient(90deg,transparent,rgba(148,134,255,0.3),transparent)]" />

        <div className={`${CHIP_BASE_CLASS} mt-2 max-w-full inline-flex items-center gap-1 border border-[rgba(148,134,255,0.2)] bg-[rgba(20,16,41,0.85)] text-white/85 overflow-hidden text-ellipsis`}>
          <MapPin size={11} /> {team.base_zone || 'Sin definir'}
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
      className={`relative w-full border rounded-card p-4 font-oswald overflow-hidden bg-[radial-gradient(380px_180px_at_16%_-28%,rgba(139,92,255,0.18),transparent_70%),linear-gradient(165deg,rgba(48,38,98,0.72),rgba(20,16,41,0.94))] shadow-elev-2 after:content-[''] after:absolute after:top-0 after:inset-x-0 after:h-px after:pointer-events-none ${isOwnChallenge
        ? 'border-[rgba(236,0,125,0.4)] after:bg-[linear-gradient(90deg,transparent_6%,rgba(236,0,125,0.55)_50%,transparent_94%)]'
        : 'border-[rgba(148,134,255,0.2)] after:bg-[linear-gradient(90deg,transparent_6%,rgba(176,160,255,0.45)_50%,transparent_94%)]'
        }`}
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          {isOwnChallenge ? (
            <span className={`${CHIP_BASE_CLASS} border border-[#E879F9]/45 bg-[#C026D3]/18 text-[#F5D0FE]`}>
              Mi desafio
            </span>
          ) : null}
          <span className={`${CHIP_BASE_CLASS} inline-flex items-center gap-1 border ${getFormatBadgeClass(challengeFormatLabel)}`}>
            <Flag size={11} /> {challengeFormatLabel}
          </span>
          <span className={`${CHIP_BASE_CLASS} border ${getSkillBadgeClass(challenge?.skill_level || challenge?.challenger_team?.skill_level)}`}>
            {challengeSkillLabel}
          </span>
          <span className={`${CHIP_BASE_CLASS} inline-flex items-center gap-1 border border-white/20 bg-white/5 text-white/90`}>
            <CalendarClock size={11} /> {formatChallengeDate(challenge?.scheduled_at)}
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

      <div className="grid grid-cols-[minmax(0,1fr)_30px_minmax(0,1fr)] sm:grid-cols-[minmax(0,1fr)_34px_minmax(0,1fr)] gap-1 items-center">
        <TeamSide team={challenge?.challenger_team} fallbackText={teamAFallbackText} />
        <div className="px-0.5 flex flex-col items-center justify-center gap-1.5">
          <span className="h-px w-3 bg-[linear-gradient(90deg,transparent,rgba(139,92,255,0.7))]" />
          <div className="text-white font-bebas text-[19px] tracking-[0.08em] leading-none drop-shadow-[0_0_10px_rgba(139,92,255,0.55)]">VS</div>
          <span className="h-px w-3 bg-[linear-gradient(90deg,rgba(236,0,125,0.6),transparent)]" />
        </div>
        <TeamSide team={challenge?.accepted_team} fallbackText={teamBFallbackText} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="chip-pill text-white/80 font-oswald">
          <MapPin size={12} /> {locationLabel}
        </span>
        <span className="chip-pill text-white/80 font-oswald">
          {fieldPriceLabel ? `Cancha ${fieldPriceLabel}` : 'Sin precio'}
        </span>
      </div>

      {challenge?.notes ? (
        <p className="mt-3 text-[13px] leading-snug text-white/70 break-words font-sans border-l-2 border-[rgba(148,134,255,0.35)] pl-2.5">{challenge.notes}</p>
      ) : null}

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={onPrimaryAction}
          className={`${primaryCtaClass} disabled:opacity-45 disabled:cursor-not-allowed`}
        >
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
  );
};

export default ChallengeCard;
