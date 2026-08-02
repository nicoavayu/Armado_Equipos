/**
 * Deterministic Canvas 2D renderer for the Estudio Social.
 *
 * Not a screenshot. Nothing here reads the DOM, walks a component tree or
 * depends on the app's stylesheets: a piece is a pure function of
 * `(snapshot, editorial, assets, format)`, so the same input produces the same
 * pixels whether it runs today, next season, or in a test.
 *
 * Canvas rather than SVG-to-image on purpose. An `<img>` pointing at an SVG
 * data URL is a sandboxed document: it cannot load fonts, and every asset would
 * have to be inlined anyway. Canvas draws with the fonts the page has already
 * loaded and with bitmaps we hand it, which is exactly what a deterministic
 * export needs.
 */

import { SOCIAL_ACCENTS, SOCIAL_FORMATS } from './socialContracts';

export const SOCIAL_THEME = Object.freeze({
  background: '#07060D',
  backgroundDeep: '#120B22',
  surface: 'rgba(18, 13, 33, 0.72)',
  surfaceStrong: 'rgba(26, 19, 45, 0.92)',
  hairline: 'rgba(255, 255, 255, 0.10)',
  text: '#FFFFFF',
  textMuted: 'rgba(226, 220, 240, 0.72)',
  textFaint: 'rgba(198, 190, 216, 0.55)',
  electricBlue: '#3B82F6',
  violet: '#9D7BFF',
  display: 'Bebas Neue',
  heading: 'Oswald',
  body: 'Inter',
});

const FALLBACK_STACK = {
  'Bebas Neue': '"Bebas Neue", "Oswald", "Arial Narrow", sans-serif',
  Oswald: '"Oswald", "Arial Narrow", sans-serif',
  Inter: '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif',
};

export function fontOf(family, size, weight = 400) {
  return `${weight} ${size}px ${FALLBACK_STACK[family] || family}`;
}

export function accentValue(accentId) {
  return (SOCIAL_ACCENTS.find((entry) => entry.id === accentId) || SOCIAL_ACCENTS[0]).value;
}

/**
 * Waits for the display faces before drawing. Without this the first export of
 * a session silently falls back to a system font — deterministic, but not the
 * brand. If the API is unavailable the caller still gets a piece, drawn with
 * the fallback stack.
 */
export async function ensureSocialFonts() {
  if (typeof document === 'undefined' || !document.fonts?.load) return false;
  try {
    await Promise.all([
      document.fonts.load('700 96px "Bebas Neue"'),
      document.fonts.load('600 44px "Oswald"'),
      document.fonts.load('400 30px "Inter"'),
      document.fonts.load('700 30px "Inter"'),
    ]);
    await document.fonts.ready;
    return true;
  } catch {
    return false;
  }
}

export function createSocialCanvas(formatId, factory) {
  const format = SOCIAL_FORMATS[formatId] || SOCIAL_FORMATS.portrait;
  const canvas = typeof factory === 'function'
    ? factory(format.width, format.height)
    : document.createElement('canvas');
  canvas.width = format.width;
  canvas.height = format.height;
  return { canvas, format };
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/** Black-glass card: the surface every piece is built out of. */
export function glassCard(ctx, x, y, width, height, { radius = 28, strong = false } = {}) {
  ctx.save();
  ctx.fillStyle = strong ? SOCIAL_THEME.surfaceStrong : SOCIAL_THEME.surface;
  roundedRect(ctx, x, y, width, height, radius);
  ctx.fill();
  ctx.strokeStyle = SOCIAL_THEME.hairline;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

/**
 * Shrinks text until it fits. Long club names are the normal case in amateur
 * tournaments, not an edge case, so every text slot has a floor and truncates
 * with an ellipsis rather than overflowing the card.
 */
export function fitText(ctx, text, {
  family, size, weight = 400, maxWidth, minSize = 12,
}) {
  const value = String(text ?? '');
  let current = size;
  ctx.font = fontOf(family, current, weight);
  while (current > minSize && ctx.measureText(value).width > maxWidth) {
    current -= 1;
    ctx.font = fontOf(family, current, weight);
  }
  if (ctx.measureText(value).width <= maxWidth) return { text: value, size: current };
  let truncated = value;
  while (truncated.length > 1 && ctx.measureText(`${truncated}…`).width > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return { text: `${truncated}…`, size: current };
}

export function drawText(ctx, text, x, y, {
  family = SOCIAL_THEME.body, size = 30, weight = 400, color = SOCIAL_THEME.text,
  align = 'left', maxWidth = Infinity, minSize = 12, letterSpacing = 0,
} = {}) {
  const fitted = maxWidth === Infinity
    ? { text: String(text ?? ''), size }
    : fitText(ctx, text, { family, size, weight, maxWidth, minSize });
  ctx.save();
  ctx.font = fontOf(family, fitted.size, weight);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  if (letterSpacing && 'letterSpacing' in ctx) ctx.letterSpacing = `${letterSpacing}px`;
  ctx.fillText(fitted.text, x, y);
  ctx.restore();
  return fitted;
}

export function wrapText(ctx, text, { family, size, weight = 400, maxWidth, maxLines = 3 }) {
  ctx.font = fontOf(family, size, weight);
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !line) line = candidate;
    else {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && words.length > lines.join(' ').split(/\s+/).length) {
    let last = lines[maxLines - 1];
    while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) {
      last = last.slice(0, -1);
    }
    lines[maxLines - 1] = `${last}…`;
  }
  return lines;
}

/** The Arma2 backdrop: black, deep violet bloom, electric blue rim. */
export function drawBackdrop(ctx, width, height, accent) {
  ctx.save();
  ctx.fillStyle = SOCIAL_THEME.background;
  ctx.fillRect(0, 0, width, height);

  const bloom = ctx.createRadialGradient(
    width * 0.24, height * 0.14, 0, width * 0.24, height * 0.14, width * 1.05,
  );
  bloom.addColorStop(0, accent);
  bloom.addColorStop(0.42, SOCIAL_THEME.backgroundDeep);
  bloom.addColorStop(1, SOCIAL_THEME.background);
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = bloom;
  ctx.fillRect(0, 0, width, height);

  const rim = ctx.createRadialGradient(
    width * 0.86, height * 0.9, 0, width * 0.86, height * 0.9, width * 0.85,
  );
  rim.addColorStop(0, SOCIAL_THEME.electricBlue);
  rim.addColorStop(1, 'rgba(7, 6, 13, 0)');
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = rim;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

/**
 * A crest, or a legible monogram when there is none. Amateur tournaments are
 * mostly crestless, so the fallback is a first-class state rather than a hole.
 */
export function drawShield(ctx, image, x, y, size, { name = '', accent }) {
  ctx.save();
  roundedRect(ctx, x, y, size, size, size * 0.28);
  ctx.clip();
  if (image) {
    const scale = Math.max(size / image.width, size / image.height);
    const drawWidth = image.width * scale;
    const drawHeight = image.height * scale;
    ctx.drawImage(
      image, x + (size - drawWidth) / 2, y + (size - drawHeight) / 2, drawWidth, drawHeight,
    );
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(x, y, size, size);
    const initials = String(name).split(/\s+/).filter(Boolean)
      .slice(0, 2).map((word) => word[0]).join('').toUpperCase() || '—';
    ctx.font = fontOf(SOCIAL_THEME.heading, size * 0.42, 600);
    ctx.fillStyle = accent;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(initials, x + size / 2, y + size / 2);
  }
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = SOCIAL_THEME.hairline;
  ctx.lineWidth = 2;
  roundedRect(ctx, x, y, size, size, size * 0.28);
  ctx.stroke();
  ctx.restore();
}

/** Cover-crop with a vertical offset, the only photo positioning we allow. */
export function drawPhoto(ctx, image, x, y, width, height, { offsetY = 0.5, radius = 28 } = {}) {
  if (!image) return false;
  ctx.save();
  roundedRect(ctx, x, y, width, height, radius);
  ctx.clip();
  const scale = Math.max(width / image.width, height / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  const slack = Math.max(0, drawHeight - height);
  ctx.drawImage(
    image,
    x + (width - drawWidth) / 2,
    y - slack * Math.min(1, Math.max(0, offsetY)),
    drawWidth,
    drawHeight,
  );
  const shade = ctx.createLinearGradient(0, y, 0, y + height);
  shade.addColorStop(0, 'rgba(7,6,13,0.05)');
  shade.addColorStop(1, 'rgba(7,6,13,0.88)');
  ctx.fillStyle = shade;
  ctx.fillRect(x, y, width, height);
  ctx.restore();
  return true;
}

/** Wordmark, drawn rather than loaded: no external asset, no CSP surprise. */
export function drawArma2Mark(ctx, x, y, { accent, size = 34 }) {
  ctx.save();
  ctx.font = fontOf(SOCIAL_THEME.display, size, 700);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  const label = 'ARMA2';
  const width = ctx.measureText(label).width;
  ctx.fillStyle = accent;
  roundedRect(ctx, x - width - size * 0.9, y - size * 0.62, width + size * 0.9, size * 1.24, size * 0.4);
  ctx.globalAlpha = 0.18;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = SOCIAL_THEME.text;
  ctx.fillText(label, x - size * 0.42, y);
  ctx.beginPath();
  ctx.arc(x - width - size * 0.62, y, size * 0.16, 0, Math.PI * 2);
  ctx.fillStyle = accent;
  ctx.fill();
  ctx.restore();
}

/**
 * The chrome every piece shares: backdrop, eyebrow, title, subtitle, footer.
 * Templates draw into the body rectangle this returns, so a new format is a
 * change to the band arithmetic here rather than eleven edits.
 */
export function drawFrame(ctx, { width, height }, { snapshot, editorial, accent }) {
  drawBackdrop(ctx, width, height, accent);
  const margin = Math.round(width * 0.074);
  const tall = height > width * 1.5;
  const headerTop = tall ? Math.round(height * 0.085) : Math.round(height * 0.062);

  const eyebrow = [
    snapshot.competition?.organizationName,
    snapshot.competition?.tournamentName,
    snapshot.competition?.categoryName,
  ].filter(Boolean).join(' · ').toUpperCase();
  drawText(ctx, eyebrow, margin, headerTop, {
    family: SOCIAL_THEME.body,
    size: 24,
    weight: 700,
    color: accent,
    maxWidth: width - margin * 2,
    minSize: 16,
    letterSpacing: 2,
  });

  const titleTop = headerTop + Math.round(height * 0.052);
  drawText(ctx, editorial.title, margin, titleTop, {
    family: SOCIAL_THEME.display,
    size: tall ? 108 : 96,
    weight: 700,
    maxWidth: width - margin * 2,
    minSize: 46,
  });

  let cursor = titleTop + Math.round(height * 0.018);
  if (editorial.subtitle) {
    cursor += Math.round(height * 0.026);
    drawText(ctx, editorial.subtitle, margin, cursor, {
      family: SOCIAL_THEME.heading,
      size: 40,
      weight: 500,
      color: SOCIAL_THEME.textMuted,
      maxWidth: width - margin * 2,
      minSize: 22,
    });
  }

  const footerTop = height - Math.round(height * (tall ? 0.072 : 0.082));
  ctx.save();
  ctx.strokeStyle = SOCIAL_THEME.hairline;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(margin, footerTop - 28);
  ctx.lineTo(width - margin, footerTop - 28);
  ctx.stroke();
  ctx.restore();

  if (editorial.note) {
    const lines = wrapText(ctx, editorial.note, {
      family: SOCIAL_THEME.body, size: 26, maxWidth: width - margin * 2, maxLines: 2,
    });
    lines.forEach((line, index) => {
      drawText(ctx, line, margin, footerTop - 74 + index * 32, {
        family: SOCIAL_THEME.body, size: 26, color: SOCIAL_THEME.textFaint,
      });
    });
  }

  drawText(ctx, editorial.cta, margin, footerTop + 12, {
    family: SOCIAL_THEME.body,
    size: 26,
    weight: 600,
    color: SOCIAL_THEME.textMuted,
    maxWidth: width * 0.5,
    minSize: 18,
  });
  if (editorial.showArma2Logo) {
    drawArma2Mark(ctx, width - margin, footerTop + 2, { accent });
  }

  return {
    margin,
    x: margin,
    y: cursor + Math.round(height * 0.038),
    width: width - margin * 2,
    height: (footerTop - 96) - (cursor + Math.round(height * 0.038)),
  };
}

export function canvasToPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    if (typeof canvas.toBlob !== 'function') {
      reject(new Error('canvas_unavailable'));
      return;
    }
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('png_encode_failed'));
    }, 'image/png');
  });
}
