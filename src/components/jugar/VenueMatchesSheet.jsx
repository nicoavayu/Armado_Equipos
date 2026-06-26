import React, { useEffect } from 'react';
import ReactDOM from 'react-dom';
import { Calendar, Clock, MapPin, Users, X } from 'lucide-react';

// Premium bottom sheet for the Jugar > PARTIDOS "Mapa" view.
//
// Opens when a venue/pin is tapped and lists every open match at that venue.
// It does NOT re-implement join logic — each match CTA calls `onSelectMatch`
// and the parent reuses the existing navigation (owner → /admin/:id, otherwise
// → /partido-publico/:id). CSS-only animation, reduced-motion + safe-area aware.

const formatMatchDate = (fecha) => {
  if (!fecha) return '';
  const date = new Date(`${fecha}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
};

const getSlots = (match) => {
  const capacity = Number(match?.cupo_jugadores) || 0;
  const roster = Array.isArray(match?.jugadores) ? match.jugadores.length : Number(match?.jugadores_count) || 0;
  const taken = Math.min(roster, capacity || roster);
  return { taken, capacity };
};

const getMissingPlayers = (match) => {
  const falta = Number(match?.falta_jugadores);
  return Number.isFinite(falta) && falta > 0 ? falta : null;
};

const isOwnerMatch = (match, currentUserId) => (
  Boolean(currentUserId) && String(match?.creado_por || '') === String(currentUserId)
);

const MatchRow = ({ match, currentUserId, onSelectMatch }) => {
  const owner = isOwnerMatch(match, currentUserId);
  const { taken, capacity } = getSlots(match);
  const missing = getMissingPlayers(match);
  const dateLabel = formatMatchDate(match?.fecha);

  return (
    <li className="rounded-2xl border border-[rgba(148,134,255,0.16)] bg-[linear-gradient(165deg,rgba(48,38,98,0.55),rgba(20,16,41,0.92))] p-3.5 shadow-elev-1">
      <div className="flex items-center gap-1.5 font-oswald text-[14px] font-bold text-white capitalize">
        <Calendar size={14} className="shrink-0 text-[#cfc4ff]" />
        <span className="truncate">{dateLabel}</span>
        {match?.hora ? (
          <>
            <span className="text-white/40">•</span>
            <Clock size={14} className="shrink-0 text-[#cfc4ff]" />
            <span>{match.hora} hs</span>
          </>
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="font-sans text-[11px] font-bold whitespace-nowrap rounded-full border border-[#22c55e]/45 bg-[#22c55e]/10 px-2.5 py-[3px] text-[#86efac]">
          {match?.modalidad || 'F5'}
        </span>
        <span className="font-sans text-[11px] font-bold whitespace-nowrap rounded-full border border-[#2dd4bf]/45 bg-[#2dd4bf]/10 px-2.5 py-[3px] text-[#99f6e4]">
          {match?.tipo_partido || 'Mixto'}
        </span>
        {capacity > 0 ? (
          <span className="font-sans text-[11px] font-bold whitespace-nowrap rounded-full border border-white/[0.12] bg-[#0c0a1d]/80 px-2.5 py-[3px] text-white/75">
            {taken}/{capacity}
          </span>
        ) : null}
        {owner ? (
          <span className="font-sans text-[10px] font-bold uppercase tracking-[0.04em] whitespace-nowrap rounded-full border border-[#8e7dff]/60 bg-[rgba(106,67,255,0.16)] px-2.5 py-[3px] text-[#ddd7ff]">
            Tu partido
          </span>
        ) : null}
      </div>

      {missing ? (
        <div className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-sans font-semibold text-amber-300">
          <Users size={12} />
          {`Faltan ${missing} ${missing === 1 ? 'jugador' : 'jugadores'}`}
        </div>
      ) : null}

      <button
        type="button"
        className="mt-3 flex min-h-[44px] w-full items-center justify-center rounded-2xl border border-white/15 bg-cta-gradient px-4 py-2.5 font-bebas text-base font-semibold text-white shadow-cta transition-all hover:brightness-110"
        onClick={() => onSelectMatch?.(match, { isOwner: owner })}
      >
        Ver partido
      </button>
    </li>
  );
};

const VenueMatchesSheet = ({ venue, currentUserId, onClose, onSelectMatch }) => {
  useEffect(() => {
    if (!venue) return undefined;
    const handleKey = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', handleKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [venue, onClose]);

  if (!venue) return null;

  const matches = Array.isArray(venue.matches) ? venue.matches : [];
  const count = matches.length;

  const sheet = (
    <div
      data-venue-sheet-root="true"
      className="fixed inset-0 z-[10001] flex items-end justify-center venue-sheet-backdrop"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Partidos en ${venue.label}`}
        className="venue-sheet-panel relative w-full max-w-[520px] flex max-h-[72vh] flex-col overflow-hidden rounded-t-3xl border-t border-[rgba(148,134,255,0.3)] bg-[linear-gradient(168deg,#241c52_0%,#171234_55%,#110d26_100%)] shadow-[0_-24px_64px_rgba(5,3,16,0.75)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-0 right-0 top-0 h-[2px] bg-[linear-gradient(90deg,transparent_2%,rgba(139,92,255,0.85)_30%,rgba(236,0,125,0.7)_72%,transparent_98%)]"
        />
        <div aria-hidden="true" className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-white/20" />

        <div className="flex items-start gap-3 px-5 pb-3 pt-3">
          <div className="min-w-0 flex-1">
            <h2 className="m-0 truncate font-oswald text-[18px] font-bold text-white" title={venue.label}>
              {venue.label}
            </h2>
            {venue.sede && venue.sede !== venue.label ? (
              <p className="mt-0.5 flex items-center gap-1.5 truncate font-sans text-[12px] text-white/55">
                <MapPin size={12} className="shrink-0 text-[#cfc4ff]" />
                <span className="truncate" title={venue.sede}>{venue.sede}</span>
              </p>
            ) : null}
            <span className="mt-1.5 inline-flex items-center rounded-full border border-[rgba(148,134,255,0.3)] bg-[rgba(106,67,255,0.16)] px-2.5 py-0.5 font-sans text-[12px] font-bold text-white">
              {count === 1 ? '1 partido abierto' : `${count} partidos abiertos`}
            </span>
          </div>
          <button
            type="button"
            aria-label="Cerrar"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-white/60 transition-all hover:bg-white/[0.12] hover:text-white"
          >
            <X size={16} />
          </button>
        </div>

        <ul
          className="min-h-0 flex-1 space-y-2.5 overflow-y-auto overscroll-contain px-5 pt-1"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 20px)' }}
        >
          {matches.map((match) => (
            <MatchRow
              key={match.id}
              match={match}
              currentUserId={currentUserId}
              onSelectMatch={onSelectMatch}
            />
          ))}
        </ul>
      </div>

      <style>{`
        @keyframes venueSheetFade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes venueSheetRise { from { transform: translateY(100%); } to { transform: translateY(0); } }
        .venue-sheet-backdrop {
          background: rgba(5, 3, 16, 0.62);
          animation: venueSheetFade 180ms ease-out;
        }
        .venue-sheet-panel {
          animation: venueSheetRise 240ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        @media (prefers-reduced-motion: reduce) {
          .venue-sheet-backdrop,
          .venue-sheet-panel {
            animation: none;
          }
        }
      `}</style>
    </div>
  );

  return ReactDOM.createPortal(sheet, document.body);
};

export default VenueMatchesSheet;
