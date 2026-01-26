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
    <div className="flex flex-wrap gap-1 justify-center my-2.5">
      {RATING_BUTTONS.map((rating) => {
        const isActive = value === rating;
        const isHovered = hovered === rating;

        return (
          <button
            key={rating}
            className={`
              w-8 h-8 rounded-full border-none font-bold text-sm cursor-pointer transition-all duration-150 ease-out active:scale-95
              ${isActive ? 'bg-primary text-white ring-2 ring-white/70 transform scale-110 shadow-[0_0_8px_rgba(18,139,233,0.45)]' : 'bg-white/10 text-white/70 hover:bg-white/20 hover:text-white'}
              ${isHovered && !isActive ? 'transform scale-105 bg-white/25 text-white' : ''}
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
