import React from 'react';
import { RATING_BUTTONS } from './constants';
import './StarRating.css';

const StarRating = React.memo(({ value, onChange, onRate, hovered, setHovered }) => {
  // Usar onChange si está disponible, de lo contrario usar onRate (para compatibilidad)
  const handleRating = (rating) => {
    if (onChange) {
      onChange(rating);
    } else if (onRate) {
      onRate(rating);
    }
  };
  
  return (
    <div className="star-rating">
      {RATING_BUTTONS.map((rating) => (
        <button
          key={rating}
          className={`star-button ${value === rating ? 'active' : ''} ${hovered === rating ? 'hovered' : ''}`}
          onClick={() => handleRating(rating)}
          onMouseEnter={() => setHovered && setHovered(rating)}
          onMouseLeave={() => setHovered && setHovered(null)}
          aria-label={`Rate ${rating} out of 10`}
        >
          {rating}
        </button>
      ))}
    </div>
  );
});

StarRating.displayName = 'StarRating';

export default StarRating;
