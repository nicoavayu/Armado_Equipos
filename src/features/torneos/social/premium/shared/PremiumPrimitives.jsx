import React, { createContext, useContext } from 'react';

export const PremiumRenderContext = createContext(Object.freeze({}));

const imageStyle = Object.freeze({
  display: 'block', width: '100%', height: '100%', objectFit: 'contain',
});

export function PremiumCrest({
  src, ini = '--', kind = 'shield', c1 = '#22252B', c2 = '#FFFFFF', fb = false,
  fbBg = 'transparent', fbInk = '#111111', fbBorder = '#111111', style = null,
}) {
  if (src) {
    return (
      <div style={{ width: '100%', aspectRatio: '5 / 6', ...style }}>
        <img src={src} alt="" draggable="false" style={imageStyle} />
      </div>
    );
  }
  if (fb) {
    return (
      <div style={{
        width: '100%', aspectRatio: '5 / 6', display: 'grid', placeItems: 'center',
        fontWeight: 800, letterSpacing: '0.03em', lineHeight: 1, textAlign: 'center',
        border: '2.5px solid', borderColor: fbBorder, color: fbInk, background: fbBg,
        ...style,
      }}>
        {ini}
      </div>
    );
  }
  if (kind === 'round') {
    return (
      <div style={{
        width: '100%', aspectRatio: '1 / 1', borderRadius: '50%', display: 'grid',
        placeItems: 'center', position: 'relative', overflow: 'hidden', background: c1,
        ...style,
      }}>
        <div style={{ position: 'absolute', inset: '45% 0 auto', height: '10%', background: c2, opacity: 0.25 }} />
        <span style={{ position: 'relative', fontWeight: 900, lineHeight: 1, color: c2 }}>{ini}</span>
      </div>
    );
  }
  if (kind === 'wide') {
    return (
      <div style={{
        width: '100%', aspectRatio: '8 / 5', borderRadius: 5, display: 'grid',
        placeItems: 'center', position: 'relative', overflow: 'hidden', background: c1,
        ...style,
      }}>
        <div style={{ position: 'absolute', inset: 'auto 0 0', height: '22%', background: c2, opacity: 0.3 }} />
        <span style={{ position: 'relative', fontWeight: 900, lineHeight: 1, color: c2 }}>{ini}</span>
      </div>
    );
  }
  return (
    <div style={{
      width: '100%', aspectRatio: '5 / 6', display: 'grid', placeItems: 'center',
      position: 'relative', overflow: 'hidden',
      clipPath: 'polygon(0 0,100% 0,100% 56%,50% 100%,0 56%)', background: c1,
      ...style,
    }}>
      <div style={{ position: 'absolute', inset: '0 auto 0 50%', width: '9%', transform: 'translateX(-50%)', background: c2, opacity: 0.28 }} />
      <span style={{ position: 'relative', fontWeight: 900, lineHeight: 1, letterSpacing: '0.01em', transform: 'translateY(-12%)', color: c2 }}>{ini}</span>
    </div>
  );
}

function FigureFallback({ themeId, initials }) {
  const safeInitials = initials || '—';
  const common = {
    position: 'relative', width: '100%', height: '100%', overflow: 'hidden',
    display: 'grid', placeItems: 'center', boxSizing: 'border-box',
  };
  if (themeId === 'street') {
    return (
      <div data-premium-figure-fallback="street" style={{ ...common, background: '#09090B' }}>
        <div style={{
          position: 'absolute', inset: '10%', opacity: 0.28,
          backgroundImage: 'radial-gradient(#F51D2C 2px, transparent 2px)',
          backgroundSize: '14px 14px', transform: 'skewY(-2deg)',
        }} />
        <strong style={{
          position: 'relative', color: '#F3ECDD', font: "italic 900 210px/1 'Arial Narrow', sans-serif",
          letterSpacing: '-0.06em', transform: 'skewX(-8deg)',
        }}>{safeInitials}</strong>
        <span style={{ position: 'absolute', width: 150, height: 18, bottom: '24%', background: '#F51D2C' }} />
      </div>
    );
  }
  if (themeId === 'scoreboard') {
    return (
      <div data-premium-figure-fallback="scoreboard" style={{ ...common, background: '#06462F' }}>
        <span style={{
          position: 'absolute', inset: '0 0 auto', height: 44,
          background: 'repeating-linear-gradient(90deg,#AFCB9B 0 3px,transparent 3px 13px)',
        }} />
        <strong style={{ color: '#F4F1E8', font: "900 210px/1 'Barlow Condensed', sans-serif", letterSpacing: '-0.04em' }}>
          {safeInitials}
        </strong>
        <span style={{
          position: 'absolute', inset: 'auto 0 0', height: 44,
          background: 'repeating-linear-gradient(90deg,#AFCB9B 0 3px,transparent 3px 13px)',
        }} />
      </div>
    );
  }
  if (themeId === 'editorial') {
    return (
      <div data-premium-figure-fallback="editorial" style={{ ...common, background: '#F1EAD8', border: '2px solid #1B2A46' }}>
        <span style={{ position: 'absolute', top: 58, width: 9, height: 9, background: '#9A3B2E', transform: 'rotate(45deg)' }} />
        <strong style={{ color: '#1B2A46', font: "italic 400 210px/1 'Bodoni Moda', serif", letterSpacing: '-0.04em' }}>
          {safeInitials}
        </strong>
        <span style={{ position: 'absolute', bottom: 58, width: 9, height: 9, background: '#9A3B2E', transform: 'rotate(45deg)' }} />
      </div>
    );
  }
  return (
    <div data-premium-figure-fallback="heritage" style={{ ...common, background: '#16181C' }}>
      <strong style={{ color: '#EFE6D8', font: "400 210px/.9 Anton, sans-serif", letterSpacing: '-0.03em' }}>
        {safeInitials}
      </strong>
      <span style={{ position: 'absolute', width: 150, height: 12, bottom: '26%', background: '#7C1C2E' }} />
    </div>
  );
}

export function PremiumImageSlot({ src, placeholder = '', focalX = 0.5, focalY = 0.5 }) {
  const renderContext = useContext(PremiumRenderContext);
  const clampedX = Math.max(0, Math.min(1, focalX));
  const clampedY = Math.max(0, Math.min(1, focalY));
  const useFigureFallback = renderContext.piece === 'mvp'
    && renderContext.formatId === 'story';
  return (
    <div data-premium-figure-frame="true" style={{ width: '100%', height: '100%', overflow: 'hidden', background: 'rgba(0,0,0,.08)' }}>
      {src ? (
        <img
          src={src}
          alt=""
          draggable="false"
          style={{
            display: 'block', width: '100%', height: '100%', objectFit: 'cover',
            objectPosition: `${clampedX * 100}% ${clampedY * 100}%`,
            transform: 'scale(var(--figura-zoom, 1))',
            transformOrigin: `${clampedX * 100}% ${clampedY * 100}%`,
          }}
        />
      ) : useFigureFallback ? (
        <FigureFallback
          themeId={renderContext.themeId}
          initials={renderContext.figureInitials}
        />
      ) : (
        <span style={{ display: 'grid', width: '100%', height: '100%', placeItems: 'center', font: '600 18px sans-serif', opacity: 0.45 }}>
          {placeholder}
        </span>
      )}
    </div>
  );
}

export function PremiumSponsorMark({ sponsor }) {
  const src = sponsor?.src || sponsor?.imageSrc || null;
  if (!src) return null;
  return <img src={src} alt={sponsor?.name || ''} draggable="false" style={{ display: 'block', width: 118, height: 46, objectFit: 'contain' }} />;
}
