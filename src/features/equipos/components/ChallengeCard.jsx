import React from 'react';
import { CalendarClock, Flag, MapPin, Shield } from 'lucide-react';
import { CHALLENGE_STATUS_LABELS } from '../config';
import { formatSkillLevelLabel, getTeamGradientStyle, getTeamPalette } from '../utils/teamColors';
import { PRIMARY_CTA_BUTTON_CLASS } from '../../../styles/buttonClasses';

const CTA_BY_STATUS = {
  open: 'Aceptar',
  accepted: 'Confirmar',
  confirmed: 'Ver detalle',
  completed: 'Finalizado',
  canceled: 'Cancelado',
};

const CHIP_CLASS = 'font-oswald text-[10px] font-bold text-white/40 border border-white/10 bg-white/5 px-2 py-0.5 rounded uppercase tracking-wider';

const compactPrimaryClass = `${PRIMARY_CTA_BUTTON_CLASS} !w-auto flex-1 px-4 py-2.5 min-h-[48px] text-[18px] tracking-[0.01em]`;
const ownPrimaryClass = 'w-full !w-auto flex-1 rounded-xl border border-red-300/35 bg-red-500/12 text-red-100 font-oswald font-semibold px-4 py-2.5 min-h-[48px] text-[18px] tracking-[0.01em] transition-all hover:bg-red-500/18 disabled:opacity-45 disabled:cursor-not-allowed';

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
  if (!Number.isFinite(parsed) || parsed < 0) return null;
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
      <div className="flex-1 rounded-xl border border-dashed border-white/20 bg-white/5 p-3 min-h-[88px] flex items-center justify-center">
        <p className="font-oswald text-white/60 text-xs font-semibold tracking-wide uppercase">{fallbackText}</p>
      </div>
    );
  }

  const style = getTeamGradientStyle(team);
  const palette = getTeamPalette(team);

  return (
    <div className="flex-1 rounded-xl border border-white/10 p-3 bg-[#1e293b]/55 shadow-[0_8px_20px_rgba(0,0,0,0.25)]" style={style}>
      <div className="flex items-center gap-2">
        <div className="h-10 w-10 rounded-lg overflow-hidden border border-white/30 bg-black/15 flex items-center justify-center shrink-0">
          {team.crest_url ? (
            <img src={team.crest_url} alt={team.name || 'Escudo'} className="h-full w-full object-cover" />
          ) : (
            <Shield size={18} className="text-white/80" />
          )}
        </div>
        <div className="min-w-0">
          <div className="text-white font-oswald text-[15px] font-semibold leading-tight truncate">{team.name || 'Equipo'}</div>
          <div className="font-oswald text-[11px] uppercase text-white/75">F{team.format || '-'} · {formatSkillLevelLabel(team.skill_level)}</div>
        </div>
      </div>

      {team.base_zone ? (
        <div className={`${CHIP_CLASS} mt-2 inline-flex items-center gap-1`} style={{ borderColor: `${palette.accent}66`, color: '#F8FAFC', backgroundColor: palette.chipBg }}>
          <MapPin size={11} /> {team.base_zone}
        </div>
      ) : null}
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
}) => {
  const status = (challenge?.status || 'open').toLowerCase();
  const label = CHALLENGE_STATUS_LABELS[status] || status;
  const cta = primaryLabel || CTA_BY_STATUS[status] || 'Ver detalle';
  const pricePerTeamLabel = formatMoneyAr(challenge?.price_per_team);
  const fieldPriceLabel = formatMoneyAr(challenge?.field_price);

  return (
    <div
      className={`w-full rounded-2xl border backdrop-blur-sm p-4 shadow-[0_8px_24px_rgba(0,0,0,0.35)] font-oswald ${isOwnChallenge
        ? 'border-[#C026D3]/55 bg-[linear-gradient(135deg,rgba(192,38,211,0.12),rgba(30,41,59,0.86))] shadow-[0_8px_24px_rgba(192,38,211,0.16)]'
        : 'border-white/10 bg-[#1e293b]/70'
        }`}
    >
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {isOwnChallenge ? (
          <span className={`${CHIP_CLASS} border-[#E879F9]/45 bg-[#C026D3]/18 text-[#F5D0FE]`}>
            Mi desafio
          </span>
        ) : null}
        <span className={`${CHIP_CLASS} text-white/90 bg-white/10 border-white/20`}>
          {label}
        </span>
        <span className={`${CHIP_CLASS} inline-flex items-center gap-1`}>
          <Flag size={11} /> F{challenge?.format || '-'}
        </span>
        <span className={CHIP_CLASS}>
          {formatSkillLevelLabel(challenge?.skill_level)}
        </span>
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-center">
        <TeamSide team={challenge?.challenger_team} fallbackText="Equipo A" />
        <div className="text-white/65 font-oswald text-xs tracking-[0.14em] px-1">VS</div>
        <TeamSide team={challenge?.accepted_team} fallbackText="Busco rival" />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-white/70 font-oswald">
        <span className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-2 py-1 bg-white/5">
          <CalendarClock size={12} /> {formatChallengeDate(challenge?.scheduled_at)}
        </span>
        <span className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-2 py-1 bg-white/5">
          <MapPin size={12} /> {challenge?.location_name || 'A coordinar'}
        </span>
        {pricePerTeamLabel ? (
          <span className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-2 py-1 bg-white/5">
            Por equipo {pricePerTeamLabel}
          </span>
        ) : null}
        {fieldPriceLabel ? (
          <span className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-2 py-1 bg-white/5">
            Cancha {fieldPriceLabel}
          </span>
        ) : null}
      </div>

      {challenge?.notes ? (
        <p className="mt-3 text-[13px] leading-snug text-white/75 break-words font-oswald">{challenge.notes}</p>
      ) : null}

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={onPrimaryAction}
          className={`${isOwnChallenge ? ownPrimaryClass : compactPrimaryClass} disabled:opacity-45 disabled:cursor-not-allowed`}
        >
          {cta}
        </button>

        {canCancel ? (
          <button
            type="button"
            disabled={disabled}
            onClick={onCancel}
            className="rounded-xl border border-white/20 bg-white/5 text-white font-oswald font-semibold px-4 py-2.5 min-h-[48px] text-[18px] tracking-[0.01em] hover:bg-white/10 disabled:opacity-45 disabled:cursor-not-allowed"
          >
            Cancelar
          </button>
        ) : null}
      </div>
    </div>
  );
};

export default ChallengeCard;
