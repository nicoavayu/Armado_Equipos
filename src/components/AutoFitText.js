import React, { useCallback, useEffect, useRef, useState } from 'react';

// Auto-fits a single string into its container by shrinking the font-size (and,
// optionally, the letter-spacing) until it fits on one line — down to
// `minFontPx`. If it still can't fit at the minimum, it wraps to multiple lines
// instead of clipping letters or showing an ellipsis. Used for team names that
// must always render in full (e.g. the challenge cards / VS matchups).
//
// The visible text node is controlled purely by React state — it is never
// mutated imperatively. Width is measured on a throwaway, off-screen probe node
// that is created and removed within a single measure() call, so the rendered
// text always reflects the fitted size (no leaked measuring font-size) and the
// container never resizes from our own work (no ResizeObserver feedback loop).
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
  const [fit, setFit] = useState({ fontPx: maxFontPx, trackingEm: maxTrackingEm, wrap: false });

  const measure = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const available = container.clientWidth;
    if (!available) return; // not laid out yet (e.g. jsdom) — keep full text at max size

    // Measure the natural single-line width at the maximum font size using a
    // detached, invisible probe. It inherits font-family/weight/text-transform
    // from the real container, so its metrics match the rendered glyphs.
    const probe = document.createElement('span');
    probe.textContent = text;
    probe.style.cssText = [
      'position:absolute',
      'left:-9999px',
      'top:0',
      'visibility:hidden',
      'pointer-events:none',
      'white-space:nowrap',
      `font-size:${maxFontPx}px`,
      `letter-spacing:${maxTrackingEm}em`,
    ].join(';');
    container.appendChild(probe);
    const neededAtMax = probe.scrollWidth;
    container.removeChild(probe);

    if (!neededAtMax) return;

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

    setFit((prev) => (
      prev.fontPx === next.fontPx && prev.trackingEm === next.trackingEm && prev.wrap === next.wrap
        ? prev
        : next
    ));
  }, [text, maxFontPx, minFontPx, maxTrackingEm, minTrackingEm]);

  useEffect(() => {
    measure();
    let ro;
    let raf;
    // Defer the re-measure to the next frame: it breaks the synchronous
    // observe→measure→observe chain that otherwise surfaces as the benign
    // "ResizeObserver loop completed with undelivered notifications" warning.
    const schedule = () => {
      if (typeof window === 'undefined' || !window.requestAnimationFrame) {
        measure();
        return;
      }
      if (raf) window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(() => measure());
    };
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(schedule);
      // Only the container width matters; observing it (not the text) avoids a
      // re-measure loop when the font-size we set changes the text's own box.
      if (containerRef.current) ro.observe(containerRef.current);
    } else if (typeof window !== 'undefined') {
      window.addEventListener('resize', schedule);
    }
    // Re-fit once web fonts (Bebas/Oswald) finish loading so the measurement
    // uses the real glyph metrics, not the fallback font.
    let cancelled = false;
    if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => { if (!cancelled) measure(); }).catch(() => {});
    }
    return () => {
      cancelled = true;
      if (raf && typeof window !== 'undefined' && window.cancelAnimationFrame) window.cancelAnimationFrame(raf);
      if (ro && ro.disconnect) ro.disconnect();
      else if (typeof window !== 'undefined') window.removeEventListener('resize', schedule);
    };
  }, [measure]);

  return (
    <div ref={containerRef} className={className} style={{ width: '100%', ...style }}>
      <div
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
