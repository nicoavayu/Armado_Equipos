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
 * Compact "Tu próximo paso" band for Home. Renders nothing without an action.
 * The whole card is tappable; the CTA pill is visual reinforcement only.
 */
const HomeNextStepCard = ({ action, onOpen, onPrefetch }) => {
  if (!action) return null;

  const Icon = iconMap[action.icon] || ChevronRight;
  const prefetch = () => {
    if (typeof onPrefetch === 'function') onPrefetch(action);
  };

  return (
    <section className="mb-4 a2-rise">
      <h3 className="section-title" style={{ marginBottom: 14 }}>Tu próximo paso</h3>
      <button
        type="button"
        onClick={() => onOpen?.(action)}
        onMouseEnter={prefetch}
        onTouchStart={prefetch}
        onFocus={prefetch}
        className="relative w-full text-left rounded-card p-3.5 pl-5 border border-[rgba(148,134,255,0.2)] overflow-hidden transition-all duration-200 shadow-elev-2 cursor-pointer
          bg-[radial-gradient(360px_180px_at_12%_-30%,rgba(139,92,255,0.2),transparent_70%),linear-gradient(165deg,rgba(48,38,98,0.72),rgba(20,16,41,0.94))]
          before:content-[''] before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[3px] before:bg-[linear-gradient(180deg,#8b5cff,rgba(236,0,125,0.35))]
          hover:brightness-[1.06] hover:border-[rgba(148,134,255,0.42)] hover:shadow-[0_12px_32px_rgba(5,3,16,0.5),0_0_20px_rgba(106,67,255,0.16)]
          active:scale-[0.985]"
      >
        <div className="flex items-center gap-3">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-[linear-gradient(140deg,rgba(139,92,255,0.3),rgba(106,67,255,0.08))] border border-[rgba(148,134,255,0.35)] text-[#cfc4ff] shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]">
            <Icon size={19} />
          </span>

          <div className="min-w-0 flex-1">
            <div className="font-oswald text-[15px] font-bold text-white leading-tight tracking-[0.01em] truncate">
              {action.title}
            </div>
            <div className="font-sans text-[12px] text-white/55 leading-4 mt-0.5 truncate">
              {action.description}
            </div>
          </div>

          <span className="shrink-0 inline-flex items-center gap-1 pl-3 pr-2 py-1.5 rounded-full bg-cta-gradient border border-white/20 shadow-cta text-white font-sans text-[11.5px] font-bold whitespace-nowrap">
            {action.ctaLabel}
            <ChevronRight size={14} />
          </span>
        </div>
      </button>
    </section>
  );
};

export default HomeNextStepCard;
