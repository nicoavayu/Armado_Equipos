import React, { useCallback, useRef, useState } from 'react';

// Premium, precise distance slider built on Pointer Events.
//
// Why custom instead of <input type="range">: the native range proved
// unreliable on iOS WKWebView / Android WebView (you had to grab the small
// thumb exactly — no tap-to-position — and it fought the app's global
// horizontal-swipe guard, feeling sticky). This control captures the pointer so
// the thumb tracks the finger exactly, lets the user tap anywhere on the track
// to jump, and never competes with page scroll or map gestures. It stays fully
// keyboard accessible via role="slider" + arrow/Home/End/PageUp/PageDown.

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const DistanceSlider = ({
  min,
  max,
  step = 1,
  value,
  disabled = false,
  onChange,
  ariaLabel,
  valueText,
}) => {
  const trackRef = useRef(null);
  const [active, setActive] = useState(false);

  const percent = max > min ? clamp(((value - min) / (max - min)) * 100, 0, 100) : 0;

  const valueFromClientX = useCallback((clientX) => {
    const el = trackRef.current;
    if (!el) return value;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return value;
    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
    const stepped = Math.round((min + ratio * (max - min)) / step) * step;
    return clamp(stepped, min, max);
  }, [max, min, step, value]);

  const commit = useCallback((next) => {
    if (next !== value) onChange(next);
  }, [onChange, value]);

  const handlePointerDown = (event) => {
    if (disabled) return;
    // Capture so the drag keeps tracking even if the finger drifts off the
    // track (vertically or past either end) — this is what makes it precise.
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setActive(true);
    commit(valueFromClientX(event.clientX));
  };

  const handlePointerMove = (event) => {
    if (disabled) return;
    if (!event.currentTarget.hasPointerCapture?.(event.pointerId)) return;
    commit(valueFromClientX(event.clientX));
  };

  const endDrag = () => setActive(false);

  const handleKeyDown = (event) => {
    if (disabled) return;
    let next = value;
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowDown': next = value - step; break;
      case 'ArrowRight':
      case 'ArrowUp': next = value + step; break;
      case 'PageDown': next = value - step * 5; break;
      case 'PageUp': next = value + step * 5; break;
      case 'Home': next = min; break;
      case 'End': next = max; break;
      default: return;
    }
    event.preventDefault();
    commit(clamp(next, min, max));
  };

  return (
    <div
      ref={trackRef}
      role="slider"
      aria-label={ariaLabel}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={valueText}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      // The app's global touchmove guard cancels horizontal drags unless the
      // target opts in; keep that opt-in even though touch-action:none already
      // hands the gesture to this control.
      data-allow-horizontal-scroll="true"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={handleKeyDown}
      onBlur={endDrag}
      className={`group relative flex h-7 w-full select-none items-center outline-none ${
        disabled ? 'cursor-not-allowed opacity-45' : 'cursor-pointer'
      }`}
      style={{ touchAction: 'none' }}
    >
      {/* Base track */}
      <div className="pointer-events-none absolute inset-x-0 h-1.5 rounded-full bg-[rgba(124,92,255,0.16)] shadow-[inset_0_0_0_1px_rgba(148,134,255,0.18)]" />
      {/* Filled portion */}
      <div
        className="pointer-events-none absolute left-0 h-1.5 rounded-full bg-[linear-gradient(to_right,#7c5cff,#9a7bff)]"
        style={{ width: `${percent}%` }}
      />
      {/* Thumb */}
      <div
        className={`pointer-events-none absolute h-5 w-5 -translate-x-1/2 rounded-full border-2 border-[#efe9ff] bg-[radial-gradient(circle_at_32%_28%,#cbbcff_0%,#7c5cff_55%,#5a39e0_100%)] shadow-[0_2px_8px_rgba(5,3,16,0.45)] transition-[transform,box-shadow] duration-100 ease-out group-focus-visible:scale-110 group-focus-visible:shadow-[0_0_0_7px_rgba(106,67,255,0.18),0_4px_12px_rgba(5,3,16,0.5)] ${
          active ? 'scale-110 shadow-[0_0_0_7px_rgba(106,67,255,0.18),0_4px_12px_rgba(5,3,16,0.5)]' : ''
        }`}
        style={{ left: `${percent}%` }}
      />
    </div>
  );
};

export default DistanceSlider;
