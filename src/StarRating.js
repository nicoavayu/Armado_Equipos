import React from "react";
import { RATING_BUTTONS } from "./constants";
import "./StarRating.css";

const StarRating = React.memo(({ value, onRate }) => (
  <div className="star-rating">
    {RATING_BUTTONS.map(rating => (
      <button
        key={rating}
        className={`star-button ${value === rating ? "active" : ""}`}
        onClick={() => onRate(rating)}
        aria-label={`Rate ${rating} out of 10`}
      >
        {rating}
      </button>
    ))}
  </div>
));

StarRating.displayName = 'StarRating';

export default StarRating;
