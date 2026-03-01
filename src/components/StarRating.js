import React from 'react';
import { RATING_BUTTONS } from '../constants';


const StarRating = ({ value, onChange, onRate, hovered, setHovered }) => {
  // Usar onChange si está disponible, de lo contrario usar onRate (para compatibilidad)
  const handleRating = (rating) => {
    if (onChange) {
      onChange(rating);
    } else if (onRate) {
      onRate(rating);
    }
  };

  return (
    <div className="w-full max-w-full mx-auto flex flex-nowrap items-center justify-between gap-1.5 sm:gap-2 md:gap-2.5">
      {RATING_BUTTONS.map((rating) => {
        const isActive = value === rating;
        const isHovered = hovered === rating;

        return (
          <button
            key={rating}
            className={`
              flex-1 min-w-0 h-10 md:h-11 rounded-[5px] border text-[14px] md:text-[15px] leading-none font-oswald font-semibold text-center cursor-pointer transition-[transform,box-shadow,background-color,border-color,color] duration-180 ease-out
              ${isActive
                ? 'text-white border-[#8470ff]/70 bg-[linear-gradient(132deg,#291686_0%,#3f24ba_48%,#5638e6_100%)] shadow-[0_0_12px_rgba(86,56,230,0.28),0_2px_6px_rgba(0,0,0,0.25)]'
                : 'text-white/68 border-white/18 bg-[#1a2247] hover:text-white/88 hover:border-white/28 hover:bg-[#222d59]'}
              ${isHovered && !isActive ? 'scale-[1.02] shadow-[0_2px_6px_rgba(0,0,0,0.2)]' : ''}
              active:scale-[0.99]
            `}
            onClick={() => handleRating(rating)}
            onMouseEnter={() => setHovered && setHovered(rating)}
            onMouseLeave={() => setHovered && setHovered(null)}
            aria-label={`Rate ${rating} out of 10`}
            aria-pressed={isActive}
          >
            {rating}
          </button>
        );
      })}
    </div>
  );
};

StarRating.displayName = 'StarRating';

export default StarRating;
