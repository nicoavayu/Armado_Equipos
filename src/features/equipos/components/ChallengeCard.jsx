import React, { useEffect, useRef, useState } from 'react';
import { CalendarClock, Flag, MapPin, MoreVertical, Pencil, Shield } from 'lucide-react';
import { CHALLENGE_STATUS_LABELS } from '../config';
import { formatSkillLevelLabel } from '../utils/teamColors';

const CTA_BY_STATUS = {
  open: 'Aceptar',
  accepted: 'Confirmar',
  confirmed: 'Ver detalle',
  completed: 'Finalizado',
  canceled: 'Cancelado',
};

const CHIP_BASE_CLASS = 'font-oswald text-[11px] font-semibold px-2.5 py-1.5 rounded-none shrink-0 whitespace-nowrap';
const STATUS_BADGE_CLASS = {
  open: 'text-[#D4EBFF] border border-[#9ED3FF]/45 bg-[#128BE9]/22',
  accepted: 'text-[#D4EBFF] border border-[#9ED3FF]/45 bg-[#128BE9]/22',
  confirmed: 'text-[#D6F8E2] border border-[#5AD17B]/45 bg-[#2F9E44]/24',
  completed: 'text-[#FFD9D9] border border-[#F87171]/45 bg-[#B91C1C]/24',
  canceled: 'text-[#D1D5DB] border border-white/25 bg-white/10',
};

const primaryCtaClass = 'w-full flex-1 font-bebas text-base px-4 py-2.5 border border-[#7d5aff] rounded-none cursor-pointer transition-all text-white min-h-[44px] flex items-center justify-center text-center bg-[#6a43ff] shadow-[0_0_14px_rgba(106,67,255,0.3)] hover:bg-[#7550ff]';
const secondaryCtaClass = 'w-full flex-1 font-bebas text-base px-4 py-2.5 border border-white/35 rounded-none cursor-pointer transition-all text-white min-h-[44px] flex items-center justify-center text-center bg-white/5 hover:bg-white/10';
const menuButtonClass = 'kebab-menu-btn';

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

const TeamSide = ({ team, fallbackText }) => {
  if (!team) {
    return (
      <div className="flex-1 min-w-0 rounded-none border border-dashed border-white/20 bg-[rgba(15,24,56,0.45)] px-3 py-4 min-h-[130px] flex items-center justify-center">
        <p className="font-oswald text-white/60 text-xs font-semibold tracking-wide uppercase">{fallbackText}</p>
      </div>
    );
  }

  return (
    <div className="flex-1 min-w-0 rounded-none border border-[rgba(41,170,255,0.9)] px-3 py-4 bg-[#07163b] shadow-[0_0_10px_rgba(41,170,255,0.24)]">
      <div className="flex flex-col items-center text-center gap-2">
        <div className="h-14 w-14 rounded-none overflow-hidden border border-white/30 bg-black/15 flex items-center justify-center shrink-0">
          {team.crest_url ? (
            <img src={team.crest_url} alt={team.name || 'Escudo'} className="h-full w-full object-cover" />
          ) : (
            <Shield size={22} className="text-white/80" />
          )}
        </div>

        <div className="w-full text-white font-oswald text-[clamp(20px,3.2vw,26px)] font-semibold leading-tight whitespace-normal break-words">
          {team.name || 'Equipo'}
        </div>

        {team.base_zone ? (
          <div className={`${CHIP_BASE_CLASS} mt-1 inline-flex items-center gap-1 border border-[rgba(88,107,170,0.46)] bg-white/5 text-white/90`}>
            <MapPin size={11} /> {team.base_zone}
          </div>
        ) : null}
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
  const label = CHALLENGE_STATUS_LABELS[status] || status;
  const cta = primaryLabel || CTA_BY_STATUS[status] || 'Ver detalle';
  const hasPendingLocation = !String(challenge?.location || challenge?.location_name || '').trim();
  const challengeSkillLabel = formatSkillLevelLabel(challenge?.skill_level || challenge?.challenger_team?.skill_level);
  const statusClass = STATUS_BADGE_CLASS[status] || 'text-white/90 bg-white/10 border border-white/20';
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
          <span className={`${CHIP_BASE_CLASS} ${statusClass}`}>
            {label}
          </span>
          <span className={`${CHIP_BASE_CLASS} inline-flex items-center gap-1 border border-white/20 bg-white/5 text-white/90`}>
            <Flag size={11} /> F{challenge?.format || '-'}
          </span>
          <span className={`${CHIP_BASE_CLASS} border border-white/20 bg-white/5 text-white/90`}>
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

      {hasPendingLocation ? (
        <div className="mt-3 flex items-center">
          <span className="inline-flex items-center gap-1 rounded-none border border-white/20 px-2.5 py-1.5 bg-white/5 text-xs text-white/75 font-oswald">
            <MapPin size={12} /> A coordinar
          </span>
        </div>
      ) : null}

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
