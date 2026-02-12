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
    <div className="w-[min(90vw,520px)] max-w-full mx-auto px-4 sm:px-6 md:px-8 flex flex-nowrap justify-between my-2.5">
      {RATING_BUTTONS.map((rating) => {
        const isActive = value === rating;
        const isHovered = hovered === rating;

        return (
          <button
            key={rating}
            className={`
              w-8 h-8 sm:w-9 sm:h-9 md:w-10 md:h-10 rounded-full border border-white/10 font-bold text-[18px] sm:text-[20px] md:text-[24px] leading-none font-bebas text-center cursor-pointer transition-all duration-150 ease-out active:scale-95
              ${isActive ? 'bg-primary text-white ring-2 ring-white/70 scale-110 shadow-[0_0_10px_rgba(18,139,233,0.55)] border-white/40' : 'bg-white/12 text-white/75 hover:bg-white/24 hover:text-white'}
              ${isHovered && !isActive ? 'scale-105 bg-white/25 text-white border-white/30' : ''}
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
