// src/components/ThemeSwitch.js
import React from "react";
import "./ThemeSwitch.css";

export default function ThemeSwitch({ theme, onToggle }) {
  return (
    <button
      className={`switch-toggle${theme === "dark" ? " dark" : ""}`}
      onClick={onToggle}
      aria-label="Cambiar tema"
      type="button"
    >
      <span className="switch-track" />
      <span className="switch-thumb">
        {theme === "dark" ? (
          // SVG Luna
          <svg viewBox="0 0 22 22" width="20" height="20">
            <path
              d="M12 2a1 1 0 0 1 1 1v1.35a7 7 0 1 1-6.35 6.35H5a1 1 0 1 1 0-2h1.35A7 7 0 0 1 12 2z"
              fill="#ffd800"
              stroke="#ffd800"
              strokeWidth="1.2"
              opacity="0.9"
            />
          </svg>
        ) : (
          // SVG Sol
          <svg viewBox="0 0 22 22" width="20" height="20">
            <circle cx="11" cy="11" r="5" fill="#ffd800" />
            <g stroke="#ffd800" strokeWidth="1.2">
              <line x1="11" y1="2" x2="11" y2="4" />
              <line x1="11" y1="18" x2="11" y2="20" />
              <line x1="2" y1="11" x2="4" y2="11" />
              <line x1="18" y1="11" x2="20" y2="11" />
              <line x1="4.2" y1="4.2" x2="5.6" y2="5.6" />
              <line x1="16.4" y1="16.4" x2="17.8" y2="17.8" />
              <line x1="4.2" y1="17.8" x2="5.6" y2="16.4" />
              <line x1="16.4" y1="5.6" x2="17.8" y2="4.2" />
            </g>
          </svg>
        )}
      </span>
    </button>
  );
}
