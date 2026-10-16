import React, { createContext, useContext } from 'react';

export const PremiumRenderContext = createContext(Object.freeze({}));

const imageStyle = Object.freeze({
  display: 'block', width: '100%', height: '100%', objectFit: 'contain',
});

export function PremiumCrest({
  src, ini = '--', kind = 'shield', c1 = '#22252B', c2 = '#FFFFFF', fb = false,
  fbBg = 'transparent', fbInk = '#111111', fbBorder = '#111111', style = null,
}) {
  // A crest with neither an image nor initials (a tournament without logo or name) is not drawn at all.
  if (!src && !String(ini ?? '').trim()) return null;
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

// PREMIUM SPONSORS — the «CON EL APOYO DE» band. One to three logos, each whole (object-fit: contain) inside a tile of
// the same size and padding, laid out across the width (one centred, two split, three evenly): legible on a phone. The
// tile is white so a logo in any dark ink reads on every style; a light logo on a transparent background
// (premiumDataAdapter: tone "dark") gets the style's ink instead. Only drawn when a piece has sponsors: without them the
// compositions are untouched.
export const PREMIUM_SPONSOR_BAND_METRICS = Object.freeze({
  portrait: Object.freeze({
    labelSize: 19, labelGap: 12, tileHeight: 160, tilePadY: 12, tilePadX: 20, tileGap: 22, tileMaxWidth: 400,
  }),
  story: Object.freeze({
    labelSize: 24, labelGap: 16, tileHeight: 216, tilePadY: 16, tilePadX: 26, tileGap: 28, tileMaxWidth: 440,
  }),
});

const SPONSOR_BAND_THEMES = Object.freeze({
  heritage: {
    label: 'CON EL APOYO DE', labelColor: '#4F473F', labelWeight: 700, labelSpacing: '0.26em',
    rule: 'rgba(22,24,28,0.3)', centered: false,
    tile: '#FFFFFF', tileBorder: '2px solid rgba(22,24,28,0.16)', tileRadius: 4, ink: '#16181C',
  },
  street: {
    label: 'APOYAN', chip: { background: '#EDE4D3', color: '#0B0B0C', transform: 'rotate(-1.4deg)', padding: '5px 12px 4px' },
    labelColor: '#0B0B0C', labelWeight: 700, labelSpacing: '0.18em',
    rule: 'rgba(237,228,211,0.35)', centered: false,
    tile: '#FFFFFF', tileBorder: '2px solid #FFFFFF', tileRadius: 0,
    ink: '#1A1A1D', inkBorder: '2px solid rgba(237,228,211,0.45)',
  },
  scoreboard: {
    label: 'CON EL APOYO DE', labelColor: '#3E4838', labelWeight: 600, labelSpacing: '0.24em',
    rule: '#C3C9B7', centered: false,
    tile: '#FFFFFF', tileBorder: '2px solid #C3C9B7', tileRadius: 0, ink: '#093A22',
  },
  editorial: {
    label: 'CON EL APOYO DE', labelColor: 'rgba(27,42,70,0.82)', labelWeight: 600, labelSpacing: '0.28em',
    rule: 'rgba(27,42,70,0.35)', centered: true,
    tile: '#FFFFFF', tileBorder: '1.5px solid rgba(27,42,70,0.3)', tileRadius: 2, ink: '#1B2A46',
  },
});

export function PremiumSponsorBand({ sponsors, style = null }) {
  const { themeId, formatId } = useContext(PremiumRenderContext);
  const drawn = (sponsors || []).filter((sponsor) => sponsor?.src).slice(0, 3);
  if (!drawn.length) return null;
  const metrics = PREMIUM_SPONSOR_BAND_METRICS[formatId === 'story' ? 'story' : 'portrait'];
  const theme = SPONSOR_BAND_THEMES[themeId] || SPONSOR_BAND_THEMES.heritage;
  const rule = <span aria-hidden="true" style={{ flex: '1 1 0', minWidth: 24, height: 2, background: theme.rule }} />;
  return (
    <div
      data-premium-sponsor-band={drawn.length}
      style={{
        flex: 'none', display: 'flex', flexDirection: 'column', gap: metrics.labelGap, width: '100%',
        boxSizing: 'border-box', ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: Math.round(metrics.labelSize * 0.9) }}>
        {theme.centered ? rule : null}
        <span
          data-premium-sponsor-label="true"
          style={{
            flex: 'none', whiteSpace: 'nowrap', lineHeight: 1.15, fontSize: metrics.labelSize,
            fontWeight: theme.labelWeight, letterSpacing: theme.labelSpacing, color: theme.labelColor,
            ...theme.chip,
          }}
        >
          {theme.label}
        </span>
        {rule}
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', gap: metrics.tileGap, width: '100%' }}>
        {drawn.map((sponsor, index) => {
          const dark = sponsor.tone === 'dark';
          return (
            <div
              key={sponsor.id || index}
              data-premium-sponsor-tile="true"
              data-tone={dark ? 'dark' : 'light'}
              style={{
                flex: `1 1 ${metrics.tileMaxWidth}px`, maxWidth: metrics.tileMaxWidth, minWidth: 0,
                height: metrics.tileHeight, boxSizing: 'border-box',
                padding: `${metrics.tilePadY}px ${metrics.tilePadX}px`,
                background: dark ? theme.ink : theme.tile,
                border: dark ? (theme.inkBorder || theme.tileBorder) : theme.tileBorder,
                borderRadius: theme.tileRadius, overflow: 'hidden',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <img
                src={sponsor.src}
                alt={sponsor.name || ''}
                draggable="false"
                style={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain' }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
