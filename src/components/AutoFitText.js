import React, { useCallback, useEffect, useRef, useState } from 'react';

// Auto-fits a single string into its container by shrinking the font-size (and,
// optionally, the letter-spacing) until it fits on one line — down to
// `minFontPx`. If it still can't fit at the minimum, it wraps to multiple lines
// instead of clipping letters or showing an ellipsis. Used for team names that
// must always render in full (e.g. the challenge cards / VS matchups).
//
// It measures the visible node itself (no duplicated text), so what you read in
// the DOM is exactly what renders — handy for tests and screen readers alike.
export default function AutoFitText({
  text,
  maxFontPx,
  minFontPx,
  maxTrackingEm = 0,
  minTrackingEm = 0,
  className = '',
  style = {},
}) {
  const containerRef = useRef(null);
  const textRef = useRef(null);
  const lastRef = useRef(null);
  const [fit, setFit] = useState({ fontPx: maxFontPx, trackingEm: maxTrackingEm, wrap: false });

  const measure = useCallback(() => {
    const container = containerRef.current;
    const el = textRef.current;
    if (!container || !el) return;

    const available = container.clientWidth;
    if (!available) return; // not laid out yet (e.g. jsdom) — keep full text at max size

    // Measure the natural single-line width at the maximum font size.
    el.style.whiteSpace = 'nowrap';
    el.style.fontSize = `${maxFontPx}px`;
    el.style.letterSpacing = `${maxTrackingEm}em`;
    const neededAtMax = el.scrollWidth;

    let next;
    if (neededAtMax <= available) {
      next = { fontPx: maxFontPx, trackingEm: maxTrackingEm, wrap: false };
    } else {
      // Width scales ~linearly with font-size (letter-spacing is in em), so the
      // ratio that makes it fit is available / neededAtMax.
      const ratio = available / neededAtMax;
      const fittedFont = maxFontPx * ratio;
      if (fittedFont >= minFontPx) {
        next = {
          fontPx: fittedFont,
          trackingEm: Math.max(minTrackingEm, maxTrackingEm * ratio),
          wrap: false,
        };
      } else {
        // Doesn't fit on one line even at the smallest size — wrap instead of clip.
        next = { fontPx: minFontPx, trackingEm: minTrackingEm, wrap: true };
      }
    }

    const last = lastRef.current;
    if (last && last.fontPx === next.fontPx && last.trackingEm === next.trackingEm && last.wrap === next.wrap) {
      return;
    }
    lastRef.current = next;
    setFit(next);
  }, [maxFontPx, minFontPx, maxTrackingEm, minTrackingEm]);

  useEffect(() => {
    measure();
    let ro;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => measure());
      // Only the container width matters; observing it (not the text) avoids a
      // re-measure loop when the font-size we set changes the text's own box.
      if (containerRef.current) ro.observe(containerRef.current);
    } else if (typeof window !== 'undefined') {
      window.addEventListener('resize', measure);
    }
    // Re-fit once web fonts (Bebas/Oswald) finish loading so the measurement
    // uses the real glyph metrics, not the fallback font.
    let cancelled = false;
    if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => { if (!cancelled) measure(); }).catch(() => {});
    }
    return () => {
      cancelled = true;
      if (ro && ro.disconnect) ro.disconnect();
      else if (typeof window !== 'undefined') window.removeEventListener('resize', measure);
    };
  }, [measure, text]);

  return (
    <div ref={containerRef} className={className} style={{ width: '100%', ...style }}>
      <div
        ref={textRef}
        style={{
          fontSize: `${fit.fontPx}px`,
          letterSpacing: `${fit.trackingEm}em`,
          whiteSpace: fit.wrap ? 'normal' : 'nowrap',
          lineHeight: fit.wrap ? 1.05 : 1,
          textAlign: 'center',
          overflowWrap: 'anywhere',
          width: '100%',
        }}
      >
        {text}
      </div>
    </div>
  );
}
