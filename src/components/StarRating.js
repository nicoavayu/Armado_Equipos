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
    <div className="w-full max-w-full mx-auto">
      <div className="w-full flex flex-nowrap items-stretch overflow-hidden rounded-[6px] border border-white/18 bg-[#161f42] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
        {RATING_BUTTONS.map((rating) => {
          const isActive = value === rating;
          const isHovered = hovered === rating;
          const isFilled = Number.isFinite(value) && value > rating;

          return (
            <button
              key={rating}
              className={`
                relative flex-1 min-w-0 h-[42px] md:h-[44px] border-0 text-[14px] md:text-[15px] leading-none font-oswald font-bold text-center cursor-pointer
                transition-[background-color,color,box-shadow,filter] duration-180 ease-out
                border-r border-white/14 last:border-r-0
                ${isActive
                  ? 'text-white bg-[linear-gradient(132deg,#291686_0%,#3f24ba_48%,#5638e6_100%)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18),0_0_10px_rgba(86,56,230,0.22)]'
                  : isFilled
                    ? 'text-white/90 bg-[linear-gradient(132deg,rgba(41,22,134,0.56)_0%,rgba(63,36,186,0.46)_48%,rgba(86,56,230,0.40)_100%)]'
                    : 'text-white/68 bg-transparent hover:bg-[#202b58] hover:text-white/86'}
                ${isHovered && !isActive ? 'brightness-105' : ''}
                active:brightness-110
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-inset
              `}
              onClick={() => handleRating(rating)}
              onMouseEnter={() => setHovered && setHovered(rating)}
              onMouseLeave={() => setHovered && setHovered(null)}
              aria-label={`Calificar ${rating} de 10`}
              aria-pressed={isActive}
            >
              {rating}
            </button>
          );
        })}
      </div>
    </div>
  );
};

StarRating.displayName = 'StarRating';

export default StarRating;
