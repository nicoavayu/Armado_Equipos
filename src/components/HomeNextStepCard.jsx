import React from 'react';
import {
  CalendarClock,
  ChevronRight,
  ClipboardList,
  Trophy,
  UserPlus,
  Users,
  Vote,
  Wallet,
} from 'lucide-react';

const iconMap = {
  CalendarClock,
  ClipboardList,
  Trophy,
  UserPlus,
  Users,
  Vote,
  Wallet,
};

/**
 * Home next-action card. Renders nothing without an action.
 * No section title and no side CTA button: it reads as one more smart access
 * right below the quick-access carousel, and the WHOLE card is the tap target
 * (a subtle chevron is the only affordance). Title/description may wrap to
 * two lines so the copy never ends in a broken ellipsis.
 */
const HomeNextStepCard = ({ action, onOpen, onPrefetch }) => {
  if (!action) return null;

  const Icon = iconMap[action.icon] || ChevronRight;
  const prefetch = () => {
    if (typeof onPrefetch === 'function') onPrefetch(action);
  };

  return (
    <section className="mb-4 a2-rise">
      <button
        type="button"
        onClick={() => onOpen?.(action)}
        onMouseEnter={prefetch}
        onTouchStart={prefetch}
        onFocus={prefetch}
        aria-label={`${action.title}. ${action.description}`}
        className="relative w-full text-left rounded-card p-4 pl-5 min-h-[96px] border border-[rgba(148,134,255,0.24)] overflow-hidden transition-all duration-200 shadow-elev-2 cursor-pointer
          bg-[radial-gradient(420px_220px_at_14%_-32%,rgba(139,92,255,0.26),transparent_70%),linear-gradient(165deg,rgba(48,38,98,0.78),rgba(20,16,41,0.95))]
          before:content-[''] before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[3px] before:bg-[linear-gradient(180deg,#8b5cff,rgba(236,0,125,0.35))]
          hover:brightness-[1.06] hover:border-[rgba(148,134,255,0.42)] hover:shadow-[0_12px_32px_rgba(5,3,16,0.5),0_0_20px_rgba(106,67,255,0.16)]
          active:scale-[0.985]"
      >
        <div className="flex items-center gap-3.5">
          <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] bg-[linear-gradient(140deg,rgba(139,92,255,0.32),rgba(106,67,255,0.1))] border border-[rgba(148,134,255,0.38)] text-[#cfc4ff] shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]">
            <Icon size={22} />
          </span>

          <div className="min-w-0 flex-1">
            <div className="font-oswald text-[16.5px] font-bold text-white leading-snug tracking-[0.01em] line-clamp-2">
              {action.title}
            </div>
            <div className="font-sans text-[12.5px] text-white/60 leading-[1.35] mt-1 line-clamp-2">
              {action.description}
            </div>
          </div>

          <ChevronRight size={20} className="shrink-0 text-white/35" aria-hidden="true" />
        </div>
      </button>
    </section>
  );
};

export default HomeNextStepCard;
