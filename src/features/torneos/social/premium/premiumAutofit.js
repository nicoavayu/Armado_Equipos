const contexts = new Map();

function contextFor(font) {
  if (contexts.has(font)) return contexts.get(font);
  if (typeof document === 'undefined') return null;
  if (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent || '')) return null;
  const context = document.createElement('canvas').getContext('2d');
  if (!context) throw new Error('PREMIUM_TEXT_METRICS_UNAVAILABLE');
  context.font = font;
  contexts.set(font, context);
  return context;
}

export function measurePremiumText(value, {
  family, size, weight = 700, letterSpacing = 0,
}) {
  const text = String(value || '');
  const font = `${weight} ${size}px "${family}"`;
  const context = contextFor(font);
  if (!context) return text.length * size * 0.56;
  context.font = font;
  return context.measureText(text).width
    + letterSpacing * size * Math.max(0, text.length - 1);
}

export function fitPremiumWords(value, {
  family, width, base, min = 18, weight = 700, letterSpacing = 0,
}) {
  const words = String(value || '—').trim().split(/\s+/);
  for (let size = base; size > min; size -= 1) {
    if (words.every((word) => measurePremiumText(word, {
      family, size, weight, letterSpacing,
    }) <= width)) return size;
  }
  return min;
}

export function fitPremiumLines(value, {
  family, width, base, min = 18, maxLines = 3, weight = 700, letterSpacing = 0,
}) {
  const words = String(value || '—').trim().split(/\s+/);
  for (let size = base; size > min; size -= 1) {
    let line = '';
    let lines = 1;
    let valid = true;
    for (const word of words) {
      if (measurePremiumText(word, { family, size, weight, letterSpacing }) > width) {
        valid = false;
        break;
      }
      const candidate = line ? `${line} ${word}` : word;
      if (measurePremiumText(candidate, {
        family, size, weight, letterSpacing,
      }) <= width) line = candidate;
      else {
        lines += 1;
        line = word;
      }
    }
    if (valid && lines <= maxLines) return size;
  }
  return min;
}
