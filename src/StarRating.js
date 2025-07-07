import React from "react";
import "./StarRating.css";

export default function StarRating({ value, onRate }) {
  return (
    <div className="star-rating-wrapper">
      <div className="star-rating">
        {Array.from({ length: 10 }, (_, i) => (
          <button
            key={i + 1}
            className={`star-button ${value === i + 1 ? "active" : ""}`}
            onClick={() => onRate(i + 1)}
          >
            {i + 1}
          </button>
        ))}
      </div>
    </div>
  );
}
