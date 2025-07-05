// src/StarRating.js
import React, { useState, useEffect } from "react";

export default function StarRating({ value, onChange, max = 10, hovered, setHovered }) {
  // Tamaño adaptativo (más chico en mobile)
  const [starSize, setStarSize] = useState(48);

  useEffect(() => {
    const handleResize = () => {
      setStarSize(window.innerWidth < 600 ? 30 : 48);
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Manejador para detección continua en todo el bloque (sin gaps)
  const handleMouseMove = (e) => {
    const { left, width } = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - left;
    const star = Math.ceil((x / width) * max);
    setHovered(star < 1 ? 1 : star > max ? max : star);
  };

  return (
    <div
      className="star-rating-mobile"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        marginTop: window.innerWidth < 600 ? 16 : 48,
        userSelect: "none"
      }}
      onMouseLeave={() => setHovered(null)}
    >
      <div
        style={{ display: "flex", gap: 9, marginBottom: 13, cursor: "pointer" }}
        onMouseMove={handleMouseMove}
      >
        {[...Array(max)].map((_, i) => (
          <svg
            key={i}
            width={starSize}
            height={starSize}
            viewBox="0 0 24 24"
            onClick={() => onChange(i + 1)}
            style={{
              transition: "filter .18s, transform .12s",
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
      <span className="star-score" style={{
        fontFamily: "'Bebas Neue', 'Oswald', Arial, sans-serif",
        color: "#fff",
        fontSize: window.innerWidth < 600 ? 24 : 70,
        fontWeight: 700,
        marginTop: 10,
        marginBottom: 4,
        letterSpacing: 1.3
      }}>
        {hovered !== null ? hovered : (value || 0)}
      </span>
    </div>
  );
}
