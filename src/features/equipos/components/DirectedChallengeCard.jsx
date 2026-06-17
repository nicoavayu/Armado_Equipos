import React from 'react';
import { CalendarClock, Hourglass, MapPin, MessageSquare } from 'lucide-react';
import TeamShieldAvatar from './TeamShieldAvatar';

const PRIMARY_BTN = 'flex-1 inline-flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl border border-white/20 bg-cta-gradient px-3 py-2 font-bebas text-[15px] tracking-[0.02em] text-white shadow-cta transition-all hover:brightness-105 active:opacity-95 disabled:cursor-not-allowed disabled:opacity-50';
const DANGER_BTN = 'flex-1 inline-flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl border border-[#ff5c8a]/40 bg-[#ff5c8a]/10 px-3 py-2 font-bebas text-[15px] tracking-[0.02em] text-[#ffc2d4] transition-all hover:bg-[#ff5c8a]/20 active:opacity-95 disabled:cursor-not-allowed disabled:opacity-50';

const formatWhen = (value) => {
  if (!value) return 'Fecha a coordinar';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Fecha a coordinar';
  return parsed.toLocaleString('es-AR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const expiresInLabel = (expiresAt) => {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return 'Vencido';
  const hours = Math.ceil(ms / 3600000);
  if (hours <= 1) return 'Vence en menos de 1 h';
  if (hours < 24) return `Vence en ${hours} h`;
  const days = Math.ceil(hours / 24);
  return `Vence en ${days} d`;
};

// Compact card for directed challenges shown in "Te desafiaron" (incoming) and
// "Desafíos enviados" (outgoing). Keeps the result-flow ChallengeCard untouched.
const DirectedChallengeCard = ({
  challenge,
  variant = 'incoming',
  onAccept,
  onReject,
  onCancel,
  disabled = false,
}) => {
  const isIncoming = variant === 'incoming';
  // Incoming: muestro al equipo que ME desafió. Outgoing: al equipo que desafié.
  const otherTeam = isIncoming ? challenge?.challenger_team : challenge?.challenged_team;
  const otherName = otherTeam?.name || (isIncoming ? 'Un equipo' : 'Equipo rival');
  const zone = challenge?.location || challenge?.location_name || null;
  const note = challenge?.notes || null;
  const expiry = expiresInLabel(challenge?.expires_at);

  return (
    <div className="relative w-full rounded-card p-3.5 font-oswald overflow-hidden border border-[rgba(148,134,255,0.18)] bg-[linear-gradient(165deg,rgba(48,38,98,0.6),rgba(20,16,41,0.92))] shadow-elev-1">
      <div className="flex items-start gap-3">
        <TeamShieldAvatar team={otherTeam} size={46} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-oswald text-[11px] uppercase tracking-wider text-white/45">
              {isIncoming ? 'Te desafió' : 'Desafiaste a'}
            </span>
          </div>
          <h3 className="truncate font-oswald text-white text-[17px] leading-tight tracking-wide">
            {otherName}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-white/70">
            <span className="inline-flex items-center gap-1">
              <CalendarClock size={12} /> {formatWhen(challenge?.scheduled_at)}
            </span>
            {zone ? (
              <span className="inline-flex items-center gap-1">
                <MapPin size={12} /> {zone}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {note ? (
        <div className="mt-2.5 flex items-start gap-1.5 rounded-xl border border-[rgba(148,134,255,0.16)] bg-black/20 px-3 py-2 text-[12.5px] text-white/75">
          <MessageSquare size={13} className="mt-0.5 shrink-0 text-[#cdbcff]" />
          <span className="min-w-0 break-words">{note}</span>
        </div>
      ) : null}

      {expiry ? (
        <div className="mt-2 inline-flex items-center gap-1 font-oswald text-[11px] tracking-wide text-[#cdbcff]/80">
          <Hourglass size={11} /> {expiry}
        </div>
      ) : null}

      <div className="mt-3 flex items-center gap-2">
        {isIncoming ? (
          <>
            <button
              type="button"
              onClick={() => onAccept?.(challenge)}
              disabled={disabled}
              className={PRIMARY_BTN}
              data-preserve-button-case="true"
            >
              Aceptar
            </button>
            <button
              type="button"
              onClick={() => onReject?.(challenge)}
              disabled={disabled}
              className={DANGER_BTN}
              data-preserve-button-case="true"
            >
              Rechazar
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => onCancel?.(challenge)}
            disabled={disabled}
            className={DANGER_BTN}
            data-preserve-button-case="true"
          >
            Cancelar desafío
          </button>
        )}
      </div>
    </div>
  );
};

export default DirectedChallengeCard;
