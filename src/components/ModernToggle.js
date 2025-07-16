import React from 'react';
import './ModernToggle.css';

export default function ModernToggle({ checked, onChange, label }) {
  return (
    <div className="modern-toggle-container">
      <label className="modern-toggle-label">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="modern-toggle-input"
        />
        <div className="modern-toggle-slider">
          <div className="modern-toggle-thumb"></div>
        </div>
        <span className="modern-toggle-text">{label}</span>
      </label>
    </div>
  );
}