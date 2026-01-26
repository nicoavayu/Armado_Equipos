import React, { useRef, useEffect, useState } from 'react';

export default function FitText({ children, minScale = 0.75, className = '', style = {} }) {
  const containerRef = useRef(null);
  const textRef = useRef(null);
  const [scale, setScale] = useState(1);

  const measure = () => {
    const container = containerRef.current;
    const text = textRef.current;
    if (!container || !text) return;

    // Reset transform to measure natural width
    text.style.transform = 'none';

    const available = container.clientWidth;
    const needed = text.scrollWidth;

    if (!available || needed <= available) {
      setScale(1);
      return;
    }

    const raw = available / needed;
    const clamped = Math.max(minScale, Math.min(1, raw));
    setScale(clamped);
  };

  useEffect(() => {
    measure();
    let ro;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => measure());
      if (containerRef.current) ro.observe(containerRef.current);
      if (textRef.current) ro.observe(textRef.current);
    } else {
      window.addEventListener('resize', measure);
    }
    return () => {
      if (ro && ro.disconnect) ro.disconnect();
      else window.removeEventListener('resize', measure);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [children, minScale]);

  useEffect(() => {
    // measure after mount and when children change
    measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [children]);

  // wrapper keeps full width; inner text element is compressed via scaleX
  return (
    <div
      ref={containerRef}
      className={className}
      style={{ width: '100%', overflow: 'hidden', display: 'block', ...style }}
    >
      <div
        ref={textRef}
        style={{
          display: 'inline-block',
          whiteSpace: 'nowrap',
          transform: `scaleX(${scale})`,
          transformOrigin: 'center',
          willChange: 'transform',
        }}
      >
        {children}
      </div>
    </div>
  );
}
