import React from 'react';
import { getInitials } from '../AvatarFallback';

const BURST_DOTS = Array.from({ length: 12 }, (_, index) => ({
  angle: `${index * 30}deg`,
  distance: `${index % 2 === 0 ? 74 : 58}px`,
  color: index % 3 === 0 ? '#ec007d' : index % 3 === 1 ? '#b9a6ff' : '#8b5cff',
}));

const RecapValue = ({ item }) => (
  <span className="flex min-w-0 items-center justify-end gap-2">
    {item.player ? (
      <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-[9px] font-bold uppercase text-white">
        {item.player.avatar_url || item.player.foto_url ? (
          <img src={item.player.avatar_url || item.player.foto_url} alt="" className="h-full w-full object-cover" style={{ objectPosition: '50% 30%' }} />
        ) : getInitials(item.player.nombre)}
      </span>
    ) : null}
    <span className="truncate font-oswald text-[14px] font-semibold text-white">{item.value}</span>
  </span>
);

/**
 * End of the survey. `justSaved`: an animated check, a short burst and what was saved;
 * otherwise (coming back later) a calm "ya completaste".
 */
const SurveySavedCelebration = ({
  justSaved = false,
  title,
  message,
  detail = '',
  recap = [],
  onHome,
  homeLabel = 'VOLVER AL INICIO',
  buttonClassName = '',
}) => (
  <div className="flex w-full flex-1 flex-col items-center justify-center gap-5 px-1 text-center">
    <div className="relative flex h-[132px] w-[132px] items-center justify-center" aria-hidden="true">
      {justSaved ? (
        <span className="a2-survey-burst">
          {BURST_DOTS.map((dot) => (
            <span key={dot.angle} style={{ '--a': dot.angle, '--d': dot.distance, background: dot.color }} />
          ))}
        </span>
      ) : null}
      <span className="a2-survey-glow flex h-[92px] w-[92px] items-center justify-center rounded-full border border-[rgba(185,166,255,0.55)] bg-[radial-gradient(circle_at_50%_30%,rgba(139,92,255,0.55),rgba(84,48,224,0.25))] shadow-[0_18px_40px_rgba(54,32,140,0.55)]">
        <svg viewBox="0 0 56 56" className="h-14 w-14" fill="none">
          <circle className={justSaved ? 'a2-survey-check-circle' : ''} cx="28" cy="28" r="26" stroke="rgba(255,255,255,0.85)" strokeWidth="3" />
          <path className={justSaved ? 'a2-survey-check-mark' : ''} d="M17 29.5l7 7 15-16" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </div>

    <div className="a2-survey-rise flex w-full flex-col items-center gap-2" style={{ animationDelay: justSaved ? '380ms' : '0ms' }}>
      <h1 className="w-full font-bebas text-[32px] font-bold uppercase leading-[1.02] tracking-[0.04em] text-white drop-shadow-md [text-wrap:balance]">
        {title}
      </h1>
      <p role="status" className="font-oswald text-[17px] leading-snug text-white">{message}</p>
      {detail ? <p className="font-oswald text-[14px] leading-snug text-white/68">{detail}</p> : null}
    </div>

    {recap.length > 0 ? (
      <div className="a2-survey-rise surface-card w-full max-w-[420px] px-4 py-3 text-left" style={{ animationDelay: '560ms' }}>
        <span className="section-eyebrow">Tu voto</span>
        <dl className="mt-1 divide-y divide-white/[0.08]">
          {recap.map((item) => (
            <div key={item.label} className="flex items-center justify-between gap-3 py-2">
              <dt className="shrink-0 font-oswald text-[13px] text-white/62">{item.label}</dt>
              <dd className="min-w-0"><RecapValue item={item} /></dd>
            </div>
          ))}
        </dl>
      </div>
    ) : null}

    <div className="a2-survey-rise w-full max-w-[460px]" style={{ animationDelay: justSaved ? '700ms' : '120ms' }}>
      <button type="button" className={buttonClassName} onClick={onHome}>
        {homeLabel}
      </button>
    </div>
  </div>
);

export default SurveySavedCelebration;
