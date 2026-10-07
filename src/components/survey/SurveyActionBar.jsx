import React from 'react';
import { getInitials } from '../AvatarFallback';

const MiniAvatar = ({ player, className = 'h-7 w-7 text-[10px]' }) => {
  const photoUrl = player?.avatar_url || player?.foto_url || null;
  return (
    <span className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-[#1c1442] bg-gradient-to-br from-blue-500 to-purple-600 font-bold uppercase text-white ${className}`}>
      {photoUrl ? (
        <img src={photoUrl} alt="" className="h-full w-full object-cover" style={{ objectPosition: '50% 30%' }} />
      ) : getInitials(player?.nombre)}
    </span>
  );
};

/**
 * What the person picked, said back in one line above the button (single pick: avatar +
 * name; several: stacked avatars + count). Announced politely to screen readers.
 */
export const SurveySelectionSummary = ({ players = [], emptyLabel = '', label = '' }) => {
  const picked = players.filter(Boolean);
  if (picked.length === 0 && !emptyLabel) return <div className="h-9" aria-hidden="true" />;
  return (
    <div className="mb-2.5 flex h-9 items-center justify-center" aria-live="polite">
      {picked.length === 0 ? (
        <span className="font-oswald text-[13px] text-white/55">{emptyLabel}</span>
      ) : (
        <span key={picked.map((player) => player.uuid).join('|')} className="a2-pop inline-flex max-w-full items-center gap-2 rounded-pill border border-[rgba(167,139,250,0.35)] bg-[rgba(106,67,255,0.18)] py-1 pl-1 pr-3.5">
          <span className="flex shrink-0 -space-x-2">
            {picked.slice(0, 3).map((player) => <MiniAvatar key={player.uuid} player={player} />)}
          </span>
          <span className="truncate font-oswald text-[13px] text-white">
            {label || (picked.length === 1 ? picked[0].nombre : `${picked.length} jugadores`)}
          </span>
        </span>
      )}
    </div>
  );
};

/** Who was signed up, as overlapping avatars: context for "¿Asistieron todos?". */
export const SurveyRosterStack = ({ players = [], max = 7 }) => {
  if (players.length === 0) return null;
  const shown = players.slice(0, max);
  const rest = players.length - shown.length;
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex -space-x-2.5" aria-hidden="true">
        {shown.map((player, index) => (
          <span key={player.uuid || index} className="a2-pop" style={{ animationDelay: `${160 + (index * 45)}ms` }}>
            <MiniAvatar player={player} className="h-10 w-10 text-[12px]" />
          </span>
        ))}
        {rest > 0 ? (
          <span className="a2-pop inline-flex h-10 w-10 items-center justify-center rounded-full border-2 border-[#1c1442] bg-white/[0.12] font-oswald text-[12px] font-semibold text-white" style={{ animationDelay: `${160 + (shown.length * 45)}ms` }}>
            +{rest}
          </span>
        ) : null}
      </div>
      <span className="font-oswald text-[13px] text-white/65">{players.length} anotados</span>
    </div>
  );
};

/** Bottom of the step, in the thumb zone: an optional summary, the buttons, and errors. */
const SurveyActionBar = ({ summary = null, error = null, children }) => (
  <div className="relative w-full shrink-0 pb-4 pt-2">
    {summary}
    <div className="flex w-full items-center gap-2.5">
      {children}
    </div>
    {error}
  </div>
);

export default SurveyActionBar;
