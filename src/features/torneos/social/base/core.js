// ARMA2 TORNEOS — Social Studio / Theme BASE (Free)
// Tokens + Canvas 2D primitives. Deterministic: no randomness, no DOM capture.

export const C = {
  bg0: '#07070C', bg1: '#0B0912', bg2: '#100D1C',
  panel: '#111019', panelAlt: '#16141F', panelHi: '#1C1929',
  violet: '#6E2BFF', violetMid: '#7B4DFF', violetLite: '#A98BFF', violetDeep: '#311A72', violetInk: '#160D2B',
  white: '#FFFFFF', text: '#E9E9F3', muted: '#9A9AB2', dim: '#66667E',
  border: '#241E3C', borderSoft: '#191527',
  yellow: '#F2C14E', red: '#E24B4B',
};

export const SETTINGS = { geometry: true };

export const FAM = {
  display: '"Bebas Neue", "Oswald", Impact, sans-serif',
  head: '"Oswald", "Bebas Neue", sans-serif',
  body: '"Inter", "Oswald", system-ui, sans-serif',
};

export const FORMATS = {
  '4:5': { id: '4:5', W: 1080, H: 1350, m: 72, label: '1080 × 1350' },
  '9:16': { id: '9:16', W: 1080, H: 1920, m: 84, label: '1080 × 1920' },
};

export function frame(fmtId) {
  const f = FORMATS[fmtId] || FORMATS['4:5'];
  return { ...f, x: f.m, w: f.W - f.m * 2 };
}

/* Vertical rhythm, single source of truth for every piece.
   headerBottom: brand rule → kicker · kickerGap: kicker → title
   subGap: title → subtitle · titleBottom: header group → content */
export const S = {
  '4:5': { headerH: 42, headerBottom: 34, kickerGap: 56, subGap: 48, titleBottom: 48, footerH: 76, title: 88, cardR: 14, cardCut: 24 },
  '9:16': { headerH: 50, headerBottom: 42, kickerGap: 66, subGap: 56, titleBottom: 60, footerH: 86, title: 100, cardR: 16, cardCut: 28 },
};
export const sp = (g) => S[g.id] || S['4:5'];
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---------------------------------------------------------------- assets */

const _cache = new Map();
export function loadImage(src) {
  if (!src) return Promise.resolve(null);
  if (_cache.has(src)) return _cache.get(src);
  const p = new Promise((res) => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => res(im);
    im.onerror = () => res(null);
    im.src = src;
  });
  _cache.set(src, p);
  return p;
}
export function cached(src) {
  const p = _cache.get(src);
  return p && p._v ? p._v : null;
}
export async function preload(srcs) {
  const list = [...new Set(srcs.filter(Boolean))];
  const imgs = await Promise.all(list.map(loadImage));
  const map = new Map();
  list.forEach((s, i) => map.set(s, imgs[i]));
  return map;
}

/* ------------------------------------------------------------- geometry */

export function rrect(ctx, x, y, w, h, r) {
  const k = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + k, y);
  ctx.lineTo(x + w - k, y); ctx.quadraticCurveTo(x + w, y, x + w, y + k);
  ctx.lineTo(x + w, y + h - k); ctx.quadraticCurveTo(x + w, y + h, x + w - k, y + h);
  ctx.lineTo(x + k, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - k);
  ctx.lineTo(x, y + k); ctx.quadraticCurveTo(x, y, x + k, y);
  ctx.closePath();
}

// rounded rect with one diagonal cut corner — the sporty "technical" shape
export function notch(ctx, x, y, w, h, r = 8, cut = 26, corner = 'tr') {
  const k = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  if (corner === 'tr') {
    ctx.moveTo(x + k, y);
    ctx.lineTo(x + w - cut, y); ctx.lineTo(x + w, y + cut);
    ctx.lineTo(x + w, y + h - k); ctx.quadraticCurveTo(x + w, y + h, x + w - k, y + h);
    ctx.lineTo(x + k, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - k);
    ctx.lineTo(x, y + k); ctx.quadraticCurveTo(x, y, x + k, y);
  } else { // bl
    ctx.moveTo(x + k, y);
    ctx.lineTo(x + w - k, y); ctx.quadraticCurveTo(x + w, y, x + w, y + k);
    ctx.lineTo(x + w, y + h - k); ctx.quadraticCurveTo(x + w, y + h, x + w - k, y + h);
    ctx.lineTo(x + cut, y + h); ctx.lineTo(x, y + h - cut);
    ctx.lineTo(x, y + k); ctx.quadraticCurveTo(x, y, x + k, y);
  }
  ctx.closePath();
}

export function para(ctx, x, y, w, h, skew) {
  ctx.beginPath();
  ctx.moveTo(x + skew, y); ctx.lineTo(x + w + skew, y);
  ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h);
  ctx.closePath();
}

/* ---------------------------------------------------------------- panels */

export function panel(ctx, x, y, w, h, o = {}) {
  const {
    fill = C.panel, fill2 = null, border = null, r = 14, cut = 0,
    corner = 'tr', alpha = 1, topLight = 0.14, accent = null, accentW = 4, shadow = 26,
    sheen = 0.05, edgeGlow = 0, ticks = false, borderW = 1.5,
  } = o;
  const shape = () => { if (cut) notch(ctx, x, y, w, h, r, cut, corner); else rrect(ctx, x, y, w, h, r); };
  ctx.save();
  ctx.globalAlpha = alpha;
  if (edgeGlow) { ctx.save(); ctx.shadowColor = hexa(C.violet, edgeGlow); ctx.shadowBlur = 46; shape(); ctx.fillStyle = hexa(C.violetInk, 0.9); ctx.fill(); ctx.restore(); }
  if (shadow) { ctx.shadowColor = 'rgba(0,0,0,.62)'; ctx.shadowBlur = shadow; ctx.shadowOffsetY = shadow * 0.32; }
  shape();
  if (fill2) {
    const g = ctx.createLinearGradient(x, y, x + w * 0.35, y + h);
    g.addColorStop(0, fill); g.addColorStop(1, fill2); ctx.fillStyle = g;
  } else ctx.fillStyle = fill;
  ctx.fill();
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;

  if (sheen || topLight || accent) {
    ctx.save(); shape(); ctx.clip();
    if (topLight) {
      const g = ctx.createLinearGradient(x, y, x, y + Math.min(h, 120));
      g.addColorStop(0, hexa(C.violetLite, topLight)); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(x, y, w, Math.min(h, 120));
    }
    if (sheen && SETTINGS.geometry) {
      const bw = [Math.max(10, h * 0.10), Math.max(5, h * 0.045), 4];
      let bx = x + w * 0.58;
      for (let i = 0; i < bw.length; i++) {
        ctx.fillStyle = hexa(i ? C.violetLite : C.violetMid, sheen * (1 - i * 0.28));
        para(ctx, bx, y, bw[i], h, h * 0.34); ctx.fill();
        bx += bw[i] + h * 0.10;
      }
    }
    if (accent) { ctx.fillStyle = accent; ctx.fillRect(x, y, accentW, h); }
    ctx.restore();
  }
  if (border !== null || borderW) {
    shape();
    ctx.strokeStyle = border ?? hexa(C.violetMid, 0.30);
    ctx.lineWidth = borderW; ctx.stroke();
  }
  if (ticks) cornerTicks(ctx, x, y, w, h, o.tickColor ?? hexa(C.violetLite, 0.55));
  ctx.restore();
}

/** Small technical L-marks at the corners. */
export function cornerTicks(ctx, x, y, w, h, color, len = 18, inset = 12) {
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineCap = 'square';
  const p = [[x + inset, y + inset, 1, 1], [x + w - inset, y + inset, -1, 1], [x + inset, y + h - inset, 1, -1], [x + w - inset, y + h - inset, -1, -1]];
  for (const [px, py, sx, sy] of p) {
    ctx.beginPath();
    ctx.moveTo(px + sx * len, py); ctx.lineTo(px, py); ctx.lineTo(px, py + sy * len);
    ctx.stroke();
  }
  ctx.restore();
}

export function hexa(hex, a) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function line(ctx, x1, y1, x2, y2, color, w = 1) {
  ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = w;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.restore();
}

/* ------------------------------------------------------------ background */

export function background(ctx, g, o = {}) {
  const { W, H } = g;
  const grad = ctx.createLinearGradient(0, 0, W * 0.4, H);
  grad.addColorStop(0, C.bg1); grad.addColorStop(0.55, C.bg0); grad.addColorStop(1, C.bg2);
  ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);

  // controlled violet glows
  glow(ctx, W * 0.88, H * 0.04, W * 0.95, C.violet, o.glowTop ?? 0.30);
  glow(ctx, W * 0.02, H * 0.88, W * 0.85, C.violetDeep, o.glowBottom ?? 0.38);
  glow(ctx, W * 0.5, H * 0.46, W * 0.70, C.violetDeep, 0.16);

  if (SETTINGS.geometry) {
  // very subtle technical grid
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.030)'; ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 54) { ctx.beginPath(); ctx.moveTo(x + .5, 0); ctx.lineTo(x + .5, H); ctx.stroke(); }
  for (let y = 0; y <= H; y += 54) { ctx.beginPath(); ctx.moveTo(0, y + .5); ctx.lineTo(W, y + .5); ctx.stroke(); }
  ctx.restore();

  // full-canvas sport sweep
  ctx.save();
  ctx.translate(-W * 0.22, -H * 0.05);
  const sweep = ctx.createLinearGradient(0, 0, W * 0.9, H);
  sweep.addColorStop(0, hexa(C.violet, 0.16));
  sweep.addColorStop(0.55, hexa(C.violetMid, 0.05));
  sweep.addColorStop(1, hexa(C.violet, 0));
  ctx.fillStyle = sweep;
  para(ctx, 0, 0, W * 0.58, H * 1.1, H * 0.40); ctx.fill();
  ctx.restore();

  // sport diagonals (lower left)
  ctx.save();
  ctx.translate(-W * 0.12, H * 0.52);
  const w1 = [72, 34, 15, 7, 4];
  let cx = 0;
  for (let i = 0; i < w1.length; i++) {
    ctx.fillStyle = hexa(i < 2 ? C.violet : C.violetLite, 0.20 - i * 0.032);
    para(ctx, cx, 0, w1[i], H * 0.62, H * 0.24);
    ctx.fill();
    cx += w1[i] + 30;
  }
  ctx.restore();

  // sport diagonals (upper right)
  ctx.save();
  ctx.translate(W * 0.58, -H * 0.02);
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = hexa(i ? C.violetLite : C.violet, 0.16 - i * 0.034);
    para(ctx, i * 46, 0, 14 - i * 3, H * 0.30, H * 0.12);
    ctx.fill();
  }
  ctx.restore();
  }

  // vignette
  const v = ctx.createRadialGradient(W / 2, H * 0.45, W * 0.26, W / 2, H * 0.5, W * 0.98);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.68)');
  ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);

  // top brand edge
  const e = ctx.createLinearGradient(0, 0, W, 0);
  e.addColorStop(0, hexa(C.violet, 0)); e.addColorStop(0.35, hexa(C.violetMid, 1));
  e.addColorStop(0.7, hexa(C.violetLite, 0.7)); e.addColorStop(1, hexa(C.violet, 0));
  ctx.fillStyle = e; ctx.fillRect(0, 0, W, 4);
  ctx.fillStyle = hexa(C.violet, 0.30); ctx.fillRect(0, H - 3, W, 3);
}

export function glow(ctx, x, y, r, color, a) {
  const gr = ctx.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, hexa(color, a));
  gr.addColorStop(0.45, hexa(color, a * 0.35));
  gr.addColorStop(1, hexa(color, 0));
  ctx.fillStyle = gr;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
}

/* ----------------------------------------------------------------- text */

export function font(size, fam = 'head', weight = 500) {
  if (fam === 'display') return `${size}px ${FAM.display}`;
  if (fam === 'body') return `${weight} ${size}px ${FAM.body}`;
  return `${weight} ${size}px ${FAM.head}`;
}

function tracked(ctx, str, x, y, tr, align) {
  const chars = [...str];
  let total = 0;
  for (const c of chars) total += ctx.measureText(c).width;
  total += tr * Math.max(0, chars.length - 1);
  let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  const prev = ctx.textAlign; ctx.textAlign = 'left';
  for (const c of chars) { ctx.fillText(c, cx, y); cx += ctx.measureText(c).width + tr; }
  ctx.textAlign = prev;
  return total;
}

export function measure(ctx, str, o = {}) {
  const { size = 24, fam = 'head', weight = 500, tracking = 0, upper = false } = o;
  ctx.save(); ctx.font = font(size, fam, weight);
  const s = upper ? String(str).toUpperCase() : String(str);
  let w = ctx.measureText(s).width + tracking * Math.max(0, s.length - 1);
  ctx.restore();
  return w;
}

/** Core text primitive. Returns {w,size}. Shrinks then ellipsizes to fit maxW. */
export function txt(ctx, str, o = {}) {
  let {
    x = 0, y = 0, size = 24, fam = 'head', weight = 500, color = C.text,
    align = 'left', baseline = 'alphabetic', tracking = 0, maxW = null,
    upper = false, alpha = 1, glowColor = null, glowBlur = 0, minSize = null, lineH = null,
  } = o;
  let s = upper ? String(str).toUpperCase() : String(str);
  ctx.save();
  ctx.textBaseline = baseline; ctx.textAlign = align; ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  const floor = minSize ?? Math.max(10, size * 0.62);
  ctx.font = font(size, fam, weight);
  if (maxW) {
    let guard = 0;
    while (size > floor && ctx.measureText(s).width + tracking * (s.length - 1) > maxW && guard++ < 60) {
      size -= 1; ctx.font = font(size, fam, weight);
    }
    if (ctx.measureText(s).width + tracking * (s.length - 1) > maxW) {
      while (s.length > 2 && ctx.measureText(s + '…').width + tracking * s.length > maxW) s = s.slice(0, -1);
      s = s.trimEnd() + '…';
    }
  }
  if (glowColor && glowBlur) { ctx.shadowColor = glowColor; ctx.shadowBlur = glowBlur; }
  let w;
  if (tracking) w = tracked(ctx, s, x, y, tracking, align);
  else { ctx.fillText(s, x, y); w = ctx.measureText(s).width; }
  ctx.restore();
  return { w, size };
}

/** Fit a string into maxW: shrink a little, then break lines (up to maxLines), then shrink more.
 *  Truncation is the last resort (handled by txt's ellipsis). */
export function fitLines(ctx, str, o = {}) {
  const { size = 30, fam = 'head', weight = 600, tracking = 0, upper = false, maxW = 300, maxLines = 2 } = o;
  const floor = o.minSize ?? Math.max(15, Math.round(size * 0.60));
  const s = (upper ? String(str).toUpperCase() : String(str)).trim();
  const wOf = (t, sz) => {
    ctx.save(); ctx.font = font(sz, fam, weight);
    const w = ctx.measureText(t).width + tracking * Math.max(0, t.length - 1);
    ctx.restore(); return w;
  };
  const wrap = (sz) => {
    const out = []; let cur = '';
    for (const wd of s.split(/\s+/)) {
      const t = cur ? cur + ' ' + wd : wd;
      if (cur && wOf(t, sz) > maxW) { out.push(cur); cur = wd; } else cur = t;
    }
    if (cur) out.push(cur);
    return out;
  };
  let sz = size;
  const soft = Math.max(floor, Math.round(size * 0.86));
  const mark = (lines, s2) => ({ lines, size: s2, clipped: lines.some(l => wOf(l, s2) > maxW + 0.5) });
  while (sz > soft && wOf(s, sz) > maxW) sz -= 1;
  if (wOf(s, sz) <= maxW) return { lines: [s], size: sz, clipped: false };
  for (let L = 2; L <= maxLines; L++) {
    let s2 = Math.round(size * (L === 2 ? 0.94 : 0.88));
    while (s2 > floor) {
      const lines = wrap(s2);
      // `s2` is read synchronously by Array#every; no callback escapes this iteration.
      // eslint-disable-next-line no-loop-func
      if (lines.length <= L && lines.every(l => wOf(l, s2) <= maxW)) return { lines, size: s2, clipped: false };
      s2 -= 1;
    }
    const lines = wrap(floor);
    if (lines.length <= L) return mark(lines, floor);
  }
  while (sz > floor && wOf(s, sz) > maxW) sz -= 1;
  // genuinely does not fit: keep every word, let the last line ellipsize
  const all = wrap(sz);
  if (all.length <= maxLines) return mark(all, sz);
  const keep = all.slice(0, maxLines - 1);
  keep.push(all.slice(maxLines - 1).join(' '));
  return { lines: keep, size: sz };
}

/** Draws a fitted 1–2 line block. Pass cy to centre it vertically, or y for the first baseline. */
export function txtFit(ctx, str, o = {}) {
  const r = fitLines(ctx, str, o);
  const lh = o.lineH ?? r.size * 1.02;
  const h = r.size * 0.74 + (r.lines.length - 1) * lh;
  const first = o.cy != null ? o.cy - h / 2 + r.size * 0.74 : o.y;
  r.lines.forEach((l, i) => txt(ctx, l, {
    x: o.x, y: first + i * lh, size: r.size, fam: o.fam ?? 'head', weight: o.weight ?? 600,
    color: o.color ?? C.white, align: o.align, tracking: o.tracking ?? 0, upper: o.upper,
    maxW: o.maxW, alpha: o.alpha, glowColor: o.glowColor, glowBlur: o.glowBlur, minSize: r.size,
  }));
  return { h, size: r.size, lines: r.lines.length, bottom: first + (r.lines.length - 1) * lh };}

/** Wraps text into lines; returns bottom y. */
export function paragraph(ctx, str, o = {}) {
  const { x, y, maxW, size = 22, fam = 'body', weight = 400, color = C.muted, lineH = size * 1.4, align = 'left', maxLines = 3 } = o;
  ctx.save(); ctx.font = font(size, fam, weight);
  const words = String(str).split(/\s+/); const lines = []; let cur = '';
  for (const wd of words) {
    const t = cur ? cur + ' ' + wd : wd;
    if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = wd; } else cur = t;
  }
  if (cur) lines.push(cur);
  ctx.restore();
  const use = lines.slice(0, maxLines);
  use.forEach((l, i) => txt(ctx, l, { x, y: y + i * lineH, size, fam, weight, color, align, maxW }));
  return y + use.length * lineH;
}

/* --------------------------------------------------------- brand chrome */

export const LOGO_SRC = 'assets/arma2-torneos-logo.png';
export const LOGO_RATIO = 1452 / 168;

const TOUR_SKIP = new Set(['torneo', 'copa', 'liga', 'campeonato', 'de', 'del', 'la', 'las', 'los', 'el', 'zona', 'y']);
export function tourneyInitials(name = '') {
  const w = String(name).replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  const core = w.filter(t => !TOUR_SKIP.has(t.toLowerCase()) && !/^\d+$/.test(t));
  const src = core.length ? core : w;
  if (!src.length) return 'T';
  if (src.length === 1) return src[0].slice(0, 2).toUpperCase();
  return (src[0][0] + src[1][0]).toUpperCase();
}

/** Configurable brand destination. Codex maps the real Torneos URL here. */
export const BRAND = { torneosUrl: '' };

/** The tournament's own logo, rendered as supplied: no container, no crop.
 *  Returns the drawn rect (w = 0 when there is no asset). */
export function tournamentLogo(ctx, t, right, cy, maxH, imgs, maxW) {
  const img = t && t.logo ? imgs.get(t.logo) : null;
  if (!img) return { w: 0, h: 0 };
  const s = Math.min(maxH / img.height, maxW / img.width);
  const w = img.width * s, h = img.height * s;
  const x = right - w, y = cy - h / 2;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 2;
  ctx.drawImage(img, x, y, w, h);
  ctx.restore();
  return { w, h, x, y };
}

/** Official lockup (asset, never redrawn) + editorial tournament identity, top right. */
export function brandHeader(ctx, g, imgs, o = {}) {
  const k = sp(g);
  const h = o.h ?? k.headerH;
  const img = imgs.get(LOGO_SRC);
  const y = o.y ?? g.m * 0.58;
  const w = h * LOGO_RATIO;
  if (img) {
    ctx.save();
    ctx.shadowColor = hexa(C.violet, 0.45); ctx.shadowBlur = 26;
    ctx.drawImage(img, g.x, y, w, h);
    ctx.restore();
  }
  const t = o.tournament;
  const cyc = y + h / 2;
  let bottom = y + h;
  if (t && (t.name || t.logo)) {
    const lg = tournamentLogo(ctx, t, g.x + g.w, cyc, h * 1.5, imgs, Math.min(150, g.w * 0.17));
    if (lg.h) bottom = Math.max(bottom, cyc + lg.h / 2);
    const right = g.x + g.w - (lg.w ? lg.w + 24 : 0);
    const avail = right - (g.x + w + 44);
    if (t.name && avail > 130) {
      const nf = fitLines(ctx, t.name, {
        size: g.id === '9:16' ? 23 : 21, minSize: 15, maxW: avail, maxLines: 2,
        fam: 'head', weight: 600, tracking: 2.2, upper: true,
      });
      const lh = nf.size * 1.22;
      const catS = g.id === '9:16' ? 17 : 16;
      const nameH = nf.size * 0.76 + (nf.lines.length - 1) * lh;
      const total = nameH + (t.category ? catS + 12 : 0);
      let by = cyc - total / 2 + nf.size * 0.76;
      nf.lines.forEach((l, i) => txt(ctx, l, {
        x: right, y: by + i * lh, size: nf.size, fam: 'head', weight: 600, color: C.text,
        align: 'right', tracking: 2.2, upper: true, maxW: avail, minSize: nf.size,
      }));
      if (t.category) txt(ctx, t.category, {
        x: right, y: cyc + total / 2, size: catS, fam: 'head', weight: 400,
        color: C.dim, align: 'right', tracking: 3.4, upper: true, maxW: avail,
      });
      bottom = Math.max(bottom, cyc + total / 2 + 4);
    }
  }
  const ly = bottom + (g.id === '9:16' ? 28 : 24);
  line(ctx, g.x, ly, g.x + g.w, ly, hexa(C.violetLite, 0.14), 1);
  ctx.save();
  const gr = ctx.createLinearGradient(g.x, 0, g.x + 200, 0);
  gr.addColorStop(0, C.violet); gr.addColorStop(1, hexa(C.violet, 0));
  ctx.fillStyle = gr; ctx.fillRect(g.x, ly - 1, 200, 2);
  ctx.restore();
  return ly;
}

/** Small uppercase label with a violet tick. Returns bottom y. */
export function sectionLabel(ctx, str, x, y, o = {}) {
  const size = o.size ?? 20;
  const tickW = o.tick === false ? 0 : 26;
  if (tickW) { ctx.save(); ctx.fillStyle = C.violet; ctx.fillRect(x, y - size * 0.62, 3, size * 0.72); ctx.restore(); }
  txt(ctx, str, {
    x: x + (tickW ? 14 : 0), y, size, fam: 'head', weight: 500,
    color: o.color ?? C.violetLite, tracking: o.tracking ?? 4.5, upper: true, maxW: o.maxW,
  });
  return y + size * 0.4;
}

/** Piece title block. One shared vertical rhythm. Returns content top. */
export function pieceTitle(ctx, g, o = {}) {
  const { kicker, title, sub, y } = o;
  const k = sp(g);
  const big = o.size ?? k.title;
  let cy = y + k.headerBottom;
  if (kicker) {
    const ks = g.id === '9:16' ? 22 : 20;
    sectionLabel(ctx, kicker, g.x, cy + ks, { size: ks, maxW: g.w - 220 });
    cy += ks + k.kickerGap;
  }
  cy += big * 0.74;
  txt(ctx, title, {
    x: g.x, y: cy, size: big, fam: 'display', color: C.white, upper: true,
    maxW: g.w - (o.reserveRight ?? 130), tracking: 1,
    glowColor: hexa(C.violetLite, 0.5), glowBlur: 22,
  });
  ctx.save();
  const dx = g.x + g.w, dy = cy - big * 0.68;
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = hexa(i < 2 ? C.violet : C.violetLite, 0.85 - i * 0.15);
    para(ctx, dx - i * 24 - 14, dy, 10 - i, big * 0.78, big * 0.30);
    ctx.fill();
  }
  ctx.restore();
  if (sub) {
    cy += k.subGap;
    txt(ctx, sub, { x: g.x, y: cy, size: g.id === '9:16' ? 30 : 27, fam: 'head', weight: 500, color: C.violetLite, tracking: 5, upper: true, maxW: g.w - 120 });
  }
  return cy + k.titleBottom;
}

/** Quiet Torneos signature. Text only — no second Arma2 mark, no app CTA. */
export function footerBrand(ctx, g, imgs, o = {}) {
  const k = sp(g);
  const bottom = g.H - g.m;
  const ly = bottom - k.footerH;
  line(ctx, g.x, ly, g.x + g.w, ly, hexa(C.violetLite, 0.13), 1);

  const url = (o.url ?? BRAND.torneosUrl ?? '').trim() || '[TORNEOS_URL]';
  const tag = o.tag ?? 'Gestioná tu torneo en';
  txt(ctx, tag, {
    x: g.x, y: bottom - (g.id === '9:16' ? 32 : 28), size: g.id === '9:16' ? 16 : 15,
    fam: 'head', weight: 400, color: C.dim, tracking: 3.4, upper: true, maxW: g.w * 0.6,
  });
  txt(ctx, url, {
    x: g.x, y: bottom - 2, size: g.id === '9:16' ? 24 : 22, fam: 'head', weight: 600,
    color: C.violetLite, tracking: 2.2, upper: true, maxW: g.w * 0.6,
  });

  if (o.right) {
    txt(ctx, o.right, { x: g.x + g.w, y: bottom - 10, size: 18, fam: 'head', weight: 400, color: C.dim, align: 'right', tracking: 3.4, upper: true, maxW: g.w * 0.36 });
  } else if (SETTINGS.geometry) {
    ctx.save();
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = hexa(i ? C.violetLite : C.violet, 0.34 - i * 0.10);
      para(ctx, g.x + g.w - 10 - i * 18, bottom - 40, 7 - i * 2, 40, 14); ctx.fill();
    }
    ctx.restore();
  }
  return ly - (g.id === '9:16' ? 34 : 28);
}

/** Full chrome. Returns the content box. */
export function chrome(ctx, g, imgs, o = {}) {
  background(ctx, g, o.bg);
  const k = sp(g);
  const hy = brandHeader(ctx, g, imgs, { tournament: o.tournament });
  const top = o.title === null
    ? hy + k.headerBottom * 1.3
    : pieceTitle(ctx, g, { kicker: o.kicker, title: o.title, sub: o.sub, y: hy, size: o.titleSize, reserveRight: o.reserveRight });
  const bottom = footerBrand(ctx, g, imgs, { right: o.footerRight, tag: o.footerTag, url: o.footerUrl });
  return { x: g.x, y: top, w: g.w, h: bottom - top, bottom, top };
}

/* -------------------------------------------------------------- identity */

export function initialsOf(name = '') {
  const words = String(name).replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  const skip = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'fc', 'cf', 'ac', 'sc', 'club']);
  const core = words.filter(w => !skip.has(w.toLowerCase()));
  const src = core.length ? core : words;
  if (src.length === 0) return 'A2';
  if (src.length === 1) return src[0].slice(0, 2).toUpperCase();
  return (src[0][0] + src[src.length - 1][0]).toUpperCase();
}

/** Crest: real asset if present, generated monogram otherwise. */
export function crest(ctx, team, x, y, size, imgs, o = {}) {
  const img = team && team.crest ? imgs.get(team.crest) : null;
  const r = o.r ?? size * 0.24;
  if (img) {
    ctx.save();
    rrect(ctx, x, y, size, size, r); ctx.clip();
    const pad = size >= 150 ? size * 0.07 : 0;
    const inner = size - pad * 2;
    const s = Math.min(inner / img.width, inner / img.height);
    const dw = img.width * s, dh = img.height * s;
    ctx.drawImage(img, x + (size - dw) / 2, y + (size - dh) / 2, dw, dh);
    if (size >= 150) {
      // soften large scale-ups: contact shade + edge falloff
      const v = ctx.createRadialGradient(x + size / 2, y + size * 0.44, size * 0.30, x + size / 2, y + size / 2, size * 0.78);
      v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(6,5,12,0.42)');
      ctx.fillStyle = v; ctx.fillRect(x, y, size, size);
      const t = ctx.createLinearGradient(x, y, x, y + size);
      t.addColorStop(0, hexa(C.white, 0.07)); t.addColorStop(0.5, 'rgba(0,0,0,0)');
      ctx.fillStyle = t; ctx.fillRect(x, y, size, size);
    }
    ctx.restore();
    if (size >= 150) {
      ctx.save();
      rrect(ctx, x + 1, y + 1, size - 2, size - 2, r);
      ctx.strokeStyle = hexa(C.violetLite, 0.14); ctx.lineWidth = 1.5; ctx.stroke();
      ctx.restore();
    }
    return;
  }
  monogram(ctx, team ? team.name : '', x, y, size, { accent: team && team.color, ...o });
}

export function monogram(ctx, name, x, y, size, o = {}) {
  const accent = o.accent || C.violetMid;
  const r = o.r ?? size * 0.24;
  const text = o.text ?? initialsOf(name);
  // large fallbacks lose the plate: initials become the graphic, not a giant square
  if (o.boxless ?? size >= 200) {
    ctx.save(); glow(ctx, x + size / 2, y + size / 2, size * 0.66, accent, 0.30); ctx.restore();
    if (SETTINGS.geometry) {
      ctx.save();
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = hexa(i ? C.violetLite : accent, 0.42 - i * 0.12);
        para(ctx, x - size * 0.04 + i * 22, y + size * 0.14, 9 - i * 2, size * 0.72, size * 0.22); ctx.fill();
        para(ctx, x + size * 1.04 - i * 22, y + size * 0.14, 9 - i * 2, size * 0.72, size * 0.22); ctx.fill();
      }
      ctx.restore();
    }
    txt(ctx, text, {
      x: x + size / 2, y: y + size / 2, size: size * 0.62, fam: 'display', color: C.white,
      align: 'center', baseline: 'middle', tracking: 3, maxW: size * 0.94,
      glowColor: hexa(C.violetLite, 0.7), glowBlur: 40,
    });
    return;
  }
  ctx.save();
  rrect(ctx, x, y, size, size, r);
  const gr = ctx.createLinearGradient(x, y, x + size, y + size);
  gr.addColorStop(0, hexa(accent, 0.24)); gr.addColorStop(1, C.panelHi);
  ctx.fillStyle = gr; ctx.fill();
  ctx.strokeStyle = hexa(accent, 0.55); ctx.lineWidth = Math.max(1.5, size * 0.03); ctx.stroke();
  ctx.clip();
  ctx.fillStyle = hexa(C.white, 0.06);
  para(ctx, x - size * 0.1, y, size * 0.22, size, size * 0.28); ctx.fill();
  ctx.restore();
  txt(ctx, text, {
    x: x + size / 2, y: y + size / 2, size: size * 0.42, fam: 'head', weight: 600,
    color: C.white, align: 'center', baseline: 'middle', tracking: 1, maxW: size * 0.8,
  });
}

/** Team block: crest + name, mirrored via dir. Returns used width. */
export function teamIdentity(ctx, team, x, y, o = {}) {
  const { size = 64, dir = 'ltr', maxW = 320, nameSize = 30, gap = 18, imgs, sub = null } = o;
  const cy = y - size / 2;
  if (dir === 'ltr') {
    crest(ctx, team, x, cy, size, imgs);
    txt(ctx, team.name, { x: x + size + gap, y: y + (sub ? -6 : 10), size: nameSize, fam: 'head', weight: 600, color: C.white, upper: true, maxW: maxW - size - gap, tracking: 0.5 });
    if (sub) txt(ctx, sub, { x: x + size + gap, y: y + 22, size: 19, fam: 'head', weight: 400, color: C.dim, upper: true, tracking: 2.4, maxW: maxW - size - gap });
  } else {
    crest(ctx, team, x - size, cy, size, imgs);
    txt(ctx, team.name, { x: x - size - gap, y: y + (sub ? -6 : 10), size: nameSize, fam: 'head', weight: 600, color: C.white, upper: true, align: 'right', maxW: maxW - size - gap, tracking: 0.5 });
    if (sub) txt(ctx, sub, { x: x - size - gap, y: y + 22, size: 19, fam: 'head', weight: 400, color: C.dim, upper: true, align: 'right', tracking: 2.4, maxW: maxW - size - gap });
  }
}

/* ----------------------------------------------------------- components */

export function chip(ctx, str, x, y, o = {}) {
  const size = o.size ?? 19;
  const padX = o.padX ?? 16, h = o.h ?? 34;
  const w = o.w ?? measure(ctx, str, { size, tracking: 2.4, upper: true, weight: 500 }) + padX * 2;
  const align = o.align ?? 'left';
  const bx = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
  rrect(ctx, bx, y, w, h, o.r ?? 6);
  ctx.save();
  ctx.fillStyle = o.fill ?? hexa(C.violetLite, 0.09); ctx.fill();
  ctx.strokeStyle = o.border ?? hexa(C.violetLite, 0.22); ctx.lineWidth = 1; ctx.stroke();
  ctx.restore();
  txt(ctx, str, {
    x: bx + w / 2, y: y + h / 2 + 1, size, fam: 'head', weight: 500,
    color: o.color ?? C.violetLite, align: 'center', baseline: 'middle', tracking: 2.4, upper: true, maxW: w - padX,
  });
  return w;
}

/** Big number + label. */
export function statBlock(ctx, value, label, x, y, o = {}) {
  const vs = o.valueSize ?? 62;
  const align = o.align ?? 'left';
  txt(ctx, value, { x, y, size: vs, fam: 'display', color: o.color ?? C.white, align, glowColor: o.glow ? hexa(C.violetLite, 0.5) : null, glowBlur: o.glow ? 18 : 0 });
  txt(ctx, label, { x, y: y + 26, size: 17, fam: 'head', weight: 500, color: C.muted, tracking: 3, upper: true, align, maxW: o.maxW });
}

export function scoreBlock(ctx, a, b, cx, y, o = {}) {
  const size = o.size ?? 62;
  const gap = o.gap ?? 34;
  const win = a === b ? 0 : (a > b ? 1 : 2);
  txt(ctx, String(a), { x: cx - gap, y, size, fam: 'display', color: win === 2 ? C.muted : C.white, align: 'right', baseline: 'middle' });
  txt(ctx, String(b), { x: cx + gap, y, size, fam: 'display', color: win === 1 ? C.muted : C.white, align: 'left', baseline: 'middle' });
  ctx.save(); ctx.fillStyle = C.violet; ctx.fillRect(cx - 9, y - 2, 18, 3); ctx.restore();
}

export function vsMark(ctx, cx, y, o = {}) {
  const size = o.size ?? 32;
  txt(ctx, 'VS', { x: cx, y, size, fam: 'head', weight: 600, color: C.violetLite, align: 'center', baseline: 'middle', tracking: 2, glowColor: hexa(C.violet, 0.6), glowBlur: 16 });
}

/** Agenda metadata on one line: values carry the weight, separators stay quiet.
 *  Shrinks to fit, then drops the least critical part — it never wraps. */
export function metaLine(ctx, parts, cx, y, o = {}) {
  let list = parts.map(p => (typeof p === 'string' ? { s: p } : p)).filter(p => p && p.s);
  if (!list.length) return 0;
  const maxW = o.maxW ?? 600;
  const tr = o.tracking ?? 2.6;
  const gap = o.gap ?? 13;
  const floor = o.minSize ?? 18;
  const sepW = (s) => measure(ctx, '\u00B7', { size: s, fam: 'head', weight: 400 });
  const partW = (str, s) => measure(ctx, str, { size: s, fam: 'head', weight: 600, tracking: tr, upper: true });
  const wOf = (l, s) => l.reduce((t, p, i) => t + partW(p.s, s) + (i ? sepW(s) + gap * 2 : 0), 0);
  const shrink = (l) => { let s = o.size ?? 24; while (s > floor && wOf(l, s) > maxW) s -= 1; return s; };
  let size = shrink(list);
  // last resort before illegibility: shed the venue rather than crush the line
  if (wOf(list, size) > maxW && list.length > 2) { list = list.slice(0, 2); size = shrink(list); }
  let px = cx - wOf(list, size) / 2;
  list.forEach((p, i) => {
    if (i) {
      px += gap;
      txt(ctx, '\u00B7', { x: px, y, size, fam: 'head', weight: 400, color: hexa(C.violetLite, 0.55) });
      px += sepW(size) + gap;
    }
    const pw = partW(p.s, size);
    txt(ctx, p.s, {
      x: px, y, size, fam: 'head', weight: 600, color: p.warn ? C.yellow : (o.color ?? C.text),
      tracking: tr, upper: true, maxW: pw + 2, minSize: size,
    });
    px += pw;
  });
  return size;
}

export function overflow(ctx, str, x, y, w, o = {}) {
  const h = o.h ?? 46;
  ctx.save();
  ctx.setLineDash([7, 7]);
  rrect(ctx, x, y, w, h, 8);
  ctx.strokeStyle = hexa(C.violetLite, 0.28); ctx.lineWidth = 1.5; ctx.stroke();
  ctx.restore();
  txt(ctx, str, { x: x + w / 2, y: y + h / 2 + 1, size: 20, fam: 'head', weight: 500, color: C.violetLite, align: 'center', baseline: 'middle', tracking: 3.4, upper: true, maxW: w - 40 });
  return y + h;
}

/** Intentional empty composition: rules + type, no decorative container. */
export function emptyState(ctx, box, o = {}) {
  const tall = box.h / box.w > 1.0;
  const titleS = tall ? 62 : 54;
  const note = o.note ?? null;
  const blockH = 3 + 40 + titleS * 0.8 + (note ? 46 : 0);
  const top = box.y + Math.max(20, (box.h - blockH) * (tall ? 0.34 : 0.40));

  line(ctx, box.x, top, box.x + box.w, top, hexa(C.violetLite, 0.14), 1);
  ctx.save(); ctx.fillStyle = C.violet; ctx.fillRect(box.x, top - 1, 120, 3); ctx.restore();

  if (SETTINGS.geometry) {
    ctx.save();
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = hexa(i ? C.violetLite : C.violet, 0.32 - i * 0.07);
      para(ctx, box.x + box.w - 14 - i * 20, top + 26, 8 - i * 2, titleS * 1.05, titleS * 0.34); ctx.fill();
    }
    ctx.restore();
  }

  let y = top + 40;
  txt(ctx, o.kicker ?? 'Estado', {
    x: box.x, y, size: tall ? 21 : 19, fam: 'head', weight: 500, color: C.violetLite,
    tracking: 5, upper: true, maxW: box.w - 160,
  });
  y += 22;
  const t = txtFit(ctx, o.title ?? '', {
    x: box.x, y: y + titleS * 0.76, size: titleS, minSize: 34, maxW: box.w - 150, maxLines: 2,
    fam: 'head', weight: 500, color: C.white, upper: true, tracking: 1.6,
  });
  y = y + titleS * 0.76 + (t.lines - 1) * titleS * 1.02;
  if (note) {
    y += 44;
    txt(ctx, note, { x: box.x, y, size: tall ? 23 : 21, fam: 'body', weight: 400, color: C.muted, maxW: box.w * 0.78 });
  }
  line(ctx, box.x, y + 34, box.x + box.w, y + 34, hexa(C.violetLite, 0.10), 1);
}

/** Distributes n rows inside a box: clamps row height and centres the stack. */
export function rowLayout(box, n, o = {}) {
  const { min = 74, max = 150, gap = 12 } = o;
  const raw = (box.h - gap * (n - 1)) / n;
  const h = Math.max(min, Math.min(max, raw));
  const total = h * n + gap * (n - 1);
  const y = box.y + Math.max(0, (box.h - total) / 2);
  return { h, gap, y, total };
}

export function cardImage(ctx, img, x, y, w, h, o = {}) {
  ctx.save();
  if (o.cut) notch(ctx, x, y, w, h, o.r ?? 14, o.cut, o.corner ?? 'tr'); else rrect(ctx, x, y, w, h, o.r ?? 14);
  ctx.clip();
  if (img) {
    const s = Math.max(w / img.width, h / img.height);
    const dw = img.width * s, dh = img.height * s;
    ctx.drawImage(img, x + (w - dw) / 2 + (o.offsetX ?? 0), y + (h - dh) * (o.anchorY ?? 0), dw, dh);
  } else {
    ctx.fillStyle = C.panelAlt; ctx.fillRect(x, y, w, h);
  }
  if (o.scrim !== false) {
    const gr = ctx.createLinearGradient(0, y + h * 0.30, 0, y + h);
    gr.addColorStop(0, 'rgba(7,7,12,0)'); gr.addColorStop(1, hexa(C.bg0, o.scrimA ?? 0.92));
    ctx.fillStyle = gr; ctx.fillRect(x, y, w, h);
  }
  ctx.restore();
  ctx.save();
  if (o.cut) notch(ctx, x, y, w, h, o.r ?? 14, o.cut, o.corner ?? 'tr'); else rrect(ctx, x, y, w, h, o.r ?? 14);
  ctx.strokeStyle = hexa(C.violetLite, 0.18); ctx.lineWidth = 1.5; ctx.stroke();
  ctx.restore();
}

export function cardIcon(ctx, x, y, w, h, color) {
  ctx.save();
  ctx.fillStyle = color;
  rrect(ctx, x, y, w, h, 3); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.restore();
}
