import React, { useState } from "react";
export default function StarRating({ value, onChange, max = 10 }) {
  const [hovered, setHovered] = useState(null);

  return (
    <div className="stars-wrapper">
      <div className="stars-box">
        {[...Array(max)].map((_, i) => {
          const filled = hovered !== null ? i < hovered : i < value;
          return (
            <span
              key={i}
              className={`star-svg ${filled ? "selected" : ""}`}
              style={{
                transform: filled
                  ? "scale(1.18)"
                  : "scale(1)",
                transition: "transform 0.15s, filter 0.15s",
                margin: "0 2px",
                cursor: "pointer"
              }}
              onMouseEnter={() => setHovered(i + 1)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => onChange(i + 1)}
              tabIndex={0}
            >
              <svg
                width="37"
                height="37"
                viewBox="0 0 40 40"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                style={{
                  filter: filled
                    ? "drop-shadow(0 2px 10px #de1c4955)"
                    : "none"
                }}
              >
                <polygon
                  points="20,3 25,15 38,15 28,23 32,36 20,28 8,36 12,23 2,15 15,15"
                  fill={filled ? "#DE1C49" : "#eceaf1"}
                  stroke="#DE1C49"
                  strokeWidth="1.2"
                />
              </svg>
            </span>
          );
        })}
      </div>
      <div className="score-label-custom">
        {hovered !== null ? hovered : value || 0}
      </div>
    </div>
  );
}
