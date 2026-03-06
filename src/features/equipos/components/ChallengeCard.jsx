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

const CHIP_BASE_CLASS = 'font-oswald text-[11px] font-semibold px-2.5 py-1.5 rounded-none shrink-0 whitespace-nowrap';

const primaryCtaClass = 'w-full flex-1 font-bebas text-base px-4 py-2.5 border border-[#7d5aff] rounded-none cursor-pointer transition-all text-white min-h-[44px] flex items-center justify-center text-center bg-[#6a43ff] shadow-[0_0_14px_rgba(106,67,255,0.3)] hover:bg-[#7550ff]';
const secondaryCtaClass = 'w-full flex-1 font-bebas text-base px-4 py-2.5 border border-white/35 rounded-none cursor-pointer transition-all text-white min-h-[44px] flex items-center justify-center text-center bg-white/5 hover:bg-white/10';
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
  if (!team) {
    return (
      <div className="flex-1 min-w-0 rounded-[26px] border border-dashed border-white/20 bg-[rgba(15,24,56,0.45)] px-3 py-4 min-h-[150px] flex items-center justify-center">
        <p className="font-oswald text-white/60 text-xs font-semibold tracking-wide uppercase">{fallbackText}</p>
      </div>
    );
  }

  return (
    <div className="flex-1 min-w-0 rounded-[26px] border border-[rgba(41,170,255,0.4)] px-3 py-4 bg-[radial-gradient(circle_at_50%_0%,rgba(39,105,255,0.12),rgba(7,22,59,0.95)_48%),linear-gradient(180deg,#081338_0%,#060f2d_100%)] shadow-[0_16px_28px_rgba(3,8,28,0.45)]">
      <div className="flex flex-col items-center text-center gap-2">
        <div className="h-14 w-14 rounded-[18px] overflow-hidden border border-[#1c4ea8] bg-[#0e1b47] flex items-center justify-center shrink-0">
          {team.crest_url ? (
            <img src={team.crest_url} alt={team.name || 'Escudo'} className="h-full w-full object-cover" />
          ) : (
            <Shield size={22} className="text-white/80" />
          )}
        </div>

        <div className="w-full text-white font-oswald text-[clamp(20px,3.2vw,28px)] font-semibold leading-tight whitespace-normal break-words">
          {team.name || 'Equipo'}
        </div>

        <div className="h-px w-full bg-[rgba(88,107,170,0.34)]" />

        <div className={`${CHIP_BASE_CLASS} mt-1 inline-flex items-center gap-1 border border-[rgba(88,107,170,0.46)] bg-white/5 text-white/90`}>
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
      className={`relative w-full border backdrop-blur-sm p-4 shadow-[0_10px_24px_rgba(0,0,0,0.28)] font-oswald ${isOwnChallenge
        ? 'border-[rgba(192,38,211,0.56)] bg-[#1e293b]/92'
        : 'border-[rgba(88,107,170,0.46)] bg-[#1e293b]/92'
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
              <div className="absolute right-0 mt-2 w-48 rounded-none border border-slate-700 bg-slate-900 shadow-lg z-20" onClick={(event) => event.stopPropagation()}>
                <div className="py-1">
                  <button
                    type="button"
                    className="w-full h-[42px] px-3 flex items-center gap-2 text-left text-slate-100 hover:bg-slate-800"
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

      <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-center">
        <TeamSide team={challenge?.challenger_team} fallbackText="Equipo A" />
        <div className="text-white/65 font-oswald text-xs tracking-[0.14em] px-1">VS</div>
        <TeamSide team={challenge?.accepted_team} fallbackText="Busco rival" />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-none border border-white/20 px-2.5 py-1.5 bg-white/5 text-xs text-white/75 font-oswald">
          <MapPin size={12} /> {locationLabel}
        </span>
        <span className="inline-flex items-center gap-1 rounded-none border border-white/20 px-2.5 py-1.5 bg-white/5 text-xs text-white/75 font-oswald">
          {fieldPriceLabel ? `Cancha ${fieldPriceLabel}` : 'Sin precio'}
        </span>
      </div>

      {challenge?.notes ? (
        <p className="mt-3 text-[13px] leading-snug text-white/75 break-words font-oswald">{challenge.notes}</p>
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
