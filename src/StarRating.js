import React from "react";

export default function StarRating({ value, onChange, max = 10, hovered, setHovered }) {
  const handleMouseMove = (e) => {
    const { left, width } = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - left;
    const star = Math.ceil((x / width) * max);
    setHovered && setHovered(star < 1 ? 1 : star > max ? max : star);
  };

  const handleClick = (e) => {
    const { left, width } = e.currentTarget.getBoundingClientRect();
    const x = e.touches ? e.touches[0].clientX - left : e.clientX - left;
    const star = Math.ceil((x / width) * max);
    onChange(star < 1 ? 1 : star > max ? max : star);
  };

  return (
    <div
      className="star-rating-container"
      onMouseLeave={() => setHovered && setHovered(null)}
    >
      <div
        className="stars-box"
        onMouseMove={handleMouseMove}
        onClick={handleClick}
        onTouchStart={handleClick}
      >
        {[...Array(max)].map((_, i) => (
          <svg
            key={i}
            className="star-svg"
            viewBox="0 0 24 24"
            style={{
              filter: (hovered !== null && i < hovered) || (hovered === null && i < value)
                ? "drop-shadow(0 0 7px #ffd700b0)"
                : "none",
              transform: (hovered !== null
                ? (i < hovered ? "scale(1.15)" : "scale(1)")
                : (i < value ? "scale(1.09)" : "scale(1)")
              ),
            }}
          >
            <polygon
              points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26"
              fill={
                hovered !== null
                  ? (i < hovered ? "#FFD700" : "rgba(255,255,255,0.38)")
                  : (i < value ? "#FFD700" : "rgba(255,255,255,0.38)")
              }
            />
          </svg>
        ))}
      </div>
      <span className="star-score">
        {hovered !== null ? hovered : (value || 0)}
      </span>
    </div>
  );
}
