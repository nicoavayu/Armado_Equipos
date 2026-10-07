import React from 'react';
import { Check } from 'lucide-react';
import { getInitials } from '../AvatarFallback';
import { surveyHaptic } from './surveyHaptics';

// Phone widths: big enough to recognize a face and hit with a thumb.
const resolveColumns = (count) => {
  if (count <= 9) return 3;
  if (count <= 16) return 4;
  return 5;
};

const PlayerTile = ({ player, selected, dimmed, onSelect, index, columns }) => {
  const name = player?.nombre || 'Jugador';
  const photoUrl = player?.avatar_url || player?.foto_url || null;
  const initialsClass = columns <= 3 ? 'text-[30px]' : columns === 4 ? 'text-[24px]' : 'text-[19px]';
  return (
    // The entrance animation lives on the wrapper so its fill never overrides the
    // dimmed opacity or the press scale of the button.
    <div className="a2-rise min-w-0" style={{ animationDelay: `${Math.min(index * 18, 180)}ms` }}>
      <button
        type="button"
        aria-pressed={selected}
        aria-label={name}
        title={name}
        onClick={() => {
          surveyHaptic('light');
          onSelect(player.uuid);
        }}
        className="group flex w-full min-w-0 flex-col items-center gap-1.5 rounded-[20px] p-1 text-center transition-transform duration-200 ease-out active:scale-[0.95] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/85"
      >
        <span
          className={`relative block aspect-square w-full overflow-hidden rounded-[18px] bg-[#151037] transition-[box-shadow,transform,opacity] duration-200 ease-out ${
            selected
              ? 'a2-survey-pop -translate-y-0.5 shadow-[0_0_0_2.5px_#b9a6ff,0_0_0_6px_rgba(139,92,255,0.28),0_14px_28px_rgba(54,32,140,0.55)]'
              : 'shadow-[0_0_0_1px_rgba(148,134,255,0.3),0_8px_18px_rgba(8,6,30,0.42)]'
          } ${dimmed ? 'opacity-50' : ''}`}
        >
          {photoUrl ? (
            <img
              src={photoUrl}
              alt=""
              className="h-full w-full object-cover"
              style={{ objectPosition: '50% 30%' }}
              loading="lazy"
              draggable={false}
            />
          ) : (
            <span
              className={`flex h-full w-full items-center justify-center bg-gradient-to-br from-blue-500 to-purple-600 font-bold uppercase text-white ${initialsClass}`}
              aria-hidden="true"
            >
              {getInitials(name)}
            </span>
          )}
          {selected ? (
            <span
              className="a2-pop absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-accent text-white shadow-glow-accent ring-2 ring-[#1c1442]"
              aria-hidden="true"
            >
              <Check size={14} strokeWidth={3.2} />
            </span>
          ) : null}
        </span>
        <span
          className={`line-clamp-2 w-full break-words font-oswald text-[12.5px] leading-tight transition-colors duration-200 ${
            selected ? 'font-semibold text-white' : 'text-white/80'
          } ${dimmed ? 'opacity-60' : ''}`}
        >
          {name}
        </span>
      </button>
    </div>
  );
};

/**
 * Players to choose from (one, or several with `multiple`). Optional `sections` groups
 * them under labels (team challenges). Scrolls inside its area when the roster is long.
 */
const SurveyPlayerGrid = ({
  players = [],
  sections = null,
  isSelected,
  onSelect,
  multiple = false,
  labelledBy = 'survey-step-title',
}) => {
  const allPlayers = sections ? sections.flatMap((section) => section.players) : players;
  const hasSelection = allPlayers.some((player) => isSelected(player.uuid));

  const renderGrid = (list, keyPrefix) => {
    const columns = resolveColumns(list.length);
    return (
      <div
        className="grid w-full"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, columnGap: '8px', rowGap: '10px' }}
      >
        {list.map((player, index) => {
          const selected = isSelected(player.uuid);
          return (
            <PlayerTile
              key={`${keyPrefix}${player.uuid}`}
              player={player}
              selected={selected}
              dimmed={!multiple && hasSelection && !selected}
              onSelect={onSelect}
              index={index}
              columns={columns}
            />
          );
        })}
      </div>
    );
  };

  return (
    <div className="w-full" role="group" aria-labelledby={labelledBy}>
      {sections ? (
        <div className="flex w-full flex-col gap-4">
          {sections.map((section) => (
            <div key={section.key} className="w-full">
              <div className="mb-2 flex items-center gap-3 px-1">
                <span className="shrink-0 font-bebas text-[17px] uppercase tracking-[0.08em] text-white/88">{section.label}</span>
                <span className="h-px flex-1 bg-white/14" />
              </div>
              {renderGrid(section.players, `${section.key}-`)}
            </div>
          ))}
        </div>
      ) : renderGrid(players, 'all-')}
    </div>
  );
};

export default SurveyPlayerGrid;
