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
      <div className="w-full flex flex-nowrap items-stretch overflow-hidden rounded-2xl border border-[rgba(148,134,255,0.32)] bg-[#16113a] shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_10px_24px_rgba(5,3,16,0.45)]">
        {RATING_BUTTONS.map((rating) => {
          const isActive = value === rating;
          const isHovered = hovered === rating;
          const isFilled = Number.isFinite(value) && value > rating;

          return (
            <button
              key={rating}
              className={`
                relative flex-1 min-w-0 h-[48px] md:h-[52px] border-0 text-[15px] md:text-[16px] leading-none font-oswald font-bold text-center cursor-pointer
                transition-[background-color,color] duration-150 ease-out
                border-r border-white/[0.09] last:border-r-0
                ${isActive
                  ? 'text-white bg-[linear-gradient(135deg,#8b5cff_0%,#6a43ff_52%,#5430e0_100%)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25)]'
                  : isFilled
                    ? 'text-white/92 bg-[linear-gradient(135deg,rgba(139,92,255,0.42)_0%,rgba(106,67,255,0.34)_52%,rgba(84,48,224,0.3)_100%)]'
                    : 'text-white/65 bg-transparent hover:bg-[#221a52] hover:text-white/90'}
                ${isHovered && !isActive ? 'brightness-105' : ''}
                ${isActive ? 'a2-pop' : ''}
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
      <div className="mt-2 flex items-center justify-between px-1 font-sans text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/40">
        <span>1 · Flojo</span>
        <span>10 · Crack</span>
      </div>
    </div>
  );
};

StarRating.displayName = 'StarRating';

export default StarRating;
