import {
  C, hexa, frame, panel, rrect, notch, para, line, txt, measure, chrome, chip, crest, monogram,
  initialsOf, scoreBlock, vsMark, statBlock, sectionLabel, overflow, emptyState, rowLayout,
  cardImage, cardIcon, glow, font, teamIdentity, paragraph, sp, clamp, background, brandHeader,
  footerBrand, cornerTicks, txtFit, fitLines, metaLine,
} from './core.js';

const brand = (d) => ({ tournament: { name: d.tournament, category: d.category, logo: d.tournamentLogo } });
const nameColor = (win) => (win === false ? '#9C9CB4' : C.white);

/** Splits a row into two name lanes around a measured centre block.
 *  A long name first claims line count, then spacing, then a smaller crest;
 *  truncation is the last resort. Options rank by "never truncates" first,
 *  largest type second — size alone saturates at the floor and goes blind. */
function lanes(ctx, o) {
  const { x, w, pad, centerHalf, clear, gap, crest: csMax, names, size, minSize, room } = o;
  const cx = x + w / 2;
  const fits = room ? Math.max(2, Math.floor(room / (size * 1.06))) : 3;
  const maxL = Math.min(o.maxLines ?? 3, fits);
  const fit = (cs, g, L) => {
    const lane = (cx - centerHalf - clear) - (x + pad + cs + g);
    const r = names.map(n => fitLines(ctx, n, {
      size, minSize, maxW: lane, maxLines: L, fam: 'head', weight: 600, tracking: 0.4, upper: true,
    }));
    return {
      cs, gap: g, lane, lines: L,
      worst: Math.min(...r.map(v => v.size)), clipped: r.some(v => v.clipped),
    };
  };
  const pick = (a, b) => (!a ? b : a.clipped !== b.clipped ? (a.clipped ? b : a) : (b.worst > a.worst ? b : a));
  const solve = (cs, g) => { let r = null; for (let L = 2; L <= maxL; L++) r = pick(r, fit(cs, g, L)); return r; };
  const best = solve(csMax, gap);
  // only a truncated or crushed name makes the crest give up width
  if (!best.clipped && best.worst >= size * 0.66) return best;
  return pick(best, solve(Math.round(csMax * 0.74), Math.max(12, gap - 6)));
}

/* ------------------------------------------------------------- match row */

function matchRow(ctx, m, x, y, w, h, imgs, o = {}) {
  const dense = h < 92;
  panel(ctx, x, y, w, h, {
    fill: '#15121F', fill2: hexa(C.violetInk, 0.95), r: 12,
    cut: dense ? 0 : 24, border: hexa(C.violetMid, dense ? 0.24 : 0.34),
    topLight: dense ? 0.09 : 0.17, sheen: dense ? 0.04 : 0.07, shadow: dense ? 12 : 26,
    ticks: h > 150,
  });
  const cy = y + h / 2;
  const cx = x + w / 2;
  const pad = dense ? 16 : 20;
  const played = o.played !== false && m.homeScore != null;
  const hw = played ? m.homeScore > m.awayScore : null;
  const aw = played ? m.awayScore > m.homeScore : null;

  // the centre block is measured, never guessed: names get whatever it leaves.
  // if a name would still truncate, the score itself yields width — last tier
  // before cutting words.
  const vsSize = dense ? 26 : Math.min(48, 30 + h * 0.045);
  const nameSize = dense ? 26 : Math.min(40, 26 + h * 0.05);
  const minName = dense ? 18 : 21;
  const solve = (mult) => {
    const ss = (dense ? 50 : Math.min(120, h * 0.40)) * mult;
    const sg = (dense ? 28 : Math.min(50, 30 + h * 0.04)) * mult;
    const ch = played
      ? sg + Math.max(
          measure(ctx, String(m.homeScore), { size: ss, fam: 'display' }),
          measure(ctx, String(m.awayScore), { size: ss, fam: 'display' }))
      : measure(ctx, 'VS', { size: vsSize, weight: 600, tracking: 2 }) / 2 + 12;
    return {
      ss, sg, ch,
      L: lanes(ctx, {
        x, w, pad, centerHalf: ch, clear: dense ? 14 : 18, gap: dense ? 14 : 18,
        crest: Math.min(h * 0.46, 118), names: [m.home.name, m.away.name],
        size: nameSize, minSize: minName, maxLines: dense ? 2 : 3, room: h - 24,
      }),
    };
  };
  let S = solve(1);
  if (S.L.clipped && played) {
    const alt = solve(0.78);
    if (!alt.L.clipped) S = alt;
  }
  const { ss: scoreSize, sg: scoreGap, ch: centerHalf, L } = S;

  const nx = cx - centerHalf - L.gap;
  const nOpt = { maxW: L.lane, size: nameSize, minSize: minName, maxLines: L.lines, fam: 'head', weight: 600, upper: true, tracking: 0.4, cy };
  crest(ctx, m.home, x + pad, cy - L.cs / 2, L.cs, imgs);
  txtFit(ctx, m.home.name, { ...nOpt, x: nx, align: 'right', color: played ? nameColor(hw !== false) : C.white });
  crest(ctx, m.away, x + w - pad - L.cs, cy - L.cs / 2, L.cs, imgs);
  txtFit(ctx, m.away.name, { ...nOpt, x: x + w - (nx - x), align: 'left', color: played ? nameColor(aw !== false) : C.white });

  if (played) scoreBlock(ctx, m.homeScore, m.awayScore, cx, cy, { size: scoreSize, gap: scoreGap });
  else vsMark(ctx, cx, cy, { size: vsSize });
  return y + h;
}

/* ------------------------------------------------------------- 1. results */

/* ------------------------------------------------- hero match (1–2 items) */

const metaParts = (m, played) => [m.date, m.time ?? (played ? null : 'Horario a confirmar'), m.venue].filter(Boolean);

function metaBar(ctx, box, parts, k, o = {}) {
  const cs = Math.max(21, Math.round(24 * k));
  const ch = Math.max(40, Math.round(48 * k));
  const iy = box.y + box.h - ch - Math.max(22, 30 * k);
  line(ctx, box.x + 56, iy - Math.max(24, 32 * k), box.x + box.w - 56, iy - Math.max(24, 32 * k), hexa(C.violetLite, 0.16), 1);
  const widths = parts.map(p => measure(ctx, p, { size: cs, tracking: 2.6, upper: true, weight: 500 }) + 36);
  const total = widths.reduce((a, b) => a + b, 0) + (parts.length - 1) * 12;
  let px = box.x + (box.w - total) / 2;
  parts.forEach((p, i) => {
    const warn = p === 'Horario a confirmar';
    chip(ctx, p, px, iy, {
      size: cs, h: ch, w: widths[i], color: warn ? C.yellow : C.white,
      fill: hexa(warn ? C.yellow : C.violet, warn ? 0.10 : 0.18), border: hexa(warn ? C.yellow : C.violetLite, warn ? 0.34 : 0.42),
    });
    px += widths[i] + 12;
  });
}

function heroH(ctx, box, m, imgs, o) {
  const { played, k } = o;
  const cx = box.x + box.w / 2;
  const twoDigit = played && (String(m.homeScore).length > 1 || String(m.awayScore).length > 1);
  const scoreSize = Math.round((twoDigit ? 152 : 186) * k);
  const gap = Math.round(70 * k);
  let halfBlock;
  if (played) {
    const dw = Math.max(
      measure(ctx, String(m.homeScore), { size: scoreSize, fam: 'display' }),
      measure(ctx, String(m.awayScore), { size: scoreSize, fam: 'display' }),
    );
    halfBlock = gap + dw;
  } else halfBlock = measure(ctx, 'VS', { size: 92 * k, tracking: 2 }) / 2 + 22;
  const outer = box.x + 40;
  const lane = (cx - halfBlock - 28) - outer;
  const nameSize = Math.max(24, Math.round(42 * k));
  const nameGap = Math.max(38, 58 * k);
  const cs = Math.max(88, Math.min(box.w * 0.30, 250 * k, lane, box.h - nameSize - nameGap - 20));
  const cy = box.y + (box.h - (cs + nameGap + nameSize * 0.8)) / 2 + cs / 2;
  const hx = outer + lane / 2;
  const ax = box.x + box.w - (hx - box.x);
  ctx.save();
  glow(ctx, hx, cy, cs * 0.85, C.violet, 0.22);
  glow(ctx, ax, cy, cs * 0.85, C.violet, 0.22);
  ctx.restore();
  crest(ctx, m.home, hx - cs / 2, cy - cs / 2, cs, imgs, { r: cs * 0.2 });
  crest(ctx, m.away, ax - cs / 2, cy - cs / 2, cs, imgs, { r: cs * 0.2 });
  if (played) scoreBlock(ctx, m.homeScore, m.awayScore, cx, cy, { size: scoreSize, gap });
  else vsMark(ctx, cx, cy, { size: 92 * k });
  const ny = cy + cs / 2 + nameGap;
  const nOpt = { y: ny, size: nameSize, minSize: 22, maxLines: 2, fam: 'head', weight: 600, color: C.white, align: 'center', upper: true, maxW: lane + 44, tracking: 0.4 };
  txtFit(ctx, m.home.name, { ...nOpt, x: hx });
  txtFit(ctx, m.away.name, { ...nOpt, x: ax });
}

function heroV(ctx, box, m, imgs, o) {
  const { played, k } = o;
  const cx = box.x + box.w / 2;
  const bandH = Math.max(84, 104 * k);
  const rowH = (box.h - bandH) / 2;
  const cs = Math.min(box.w * 0.32, rowH * 0.78, 300);
  const nameSize = Math.round(clamp(rowH * 0.16, 34, 74));
  const scoreSize = Math.round(clamp(rowH * 0.34, 78, 150));
  const win = played ? (m.homeScore === m.awayScore ? 0 : m.homeScore > m.awayScore ? 1 : 2) : 0;
  [[m.home, m.homeScore, box.y, 1], [m.away, m.awayScore, box.y + rowH + bandH, 2]].forEach(([team, score, ry, side]) => {
    const cy = ry + rowH / 2;
    ctx.save(); glow(ctx, box.x + 44 + cs / 2, cy, cs * 0.9, C.violet, 0.20); ctx.restore();
    crest(ctx, team, box.x + 44, cy - cs / 2, cs, imgs, { r: cs * 0.2 });
    const nx = box.x + 44 + cs + 34;
    const reserve = played ? Math.round(scoreSize * 0.72) + 56 : 40;
    txtFit(ctx, team.name, {
      x: nx, cy, size: nameSize, minSize: 26, maxLines: 2, fam: 'head', weight: 600,
      color: win && win !== side ? '#9C9CB4' : C.white, upper: true,
      maxW: box.w - (nx - box.x) - reserve, tracking: 0.4,
    });
    if (played) txt(ctx, String(score), {
      x: box.x + box.w - 44, y: cy + scoreSize * 0.34, size: scoreSize, fam: 'display',
      color: win && win !== side ? C.muted : C.white, align: 'right',
      glowColor: hexa(C.violetLite, 0.5), glowBlur: 24,
    });
  });
  const mid = box.y + rowH + bandH / 2;
  const label = played ? 'Final' : 'VS';
  const ls = Math.max(30, 40 * k);
  const lw = measure(ctx, label, { size: ls, weight: 600, tracking: 5, upper: true });
  line(ctx, box.x + 44, mid, cx - lw / 2 - 28, mid, hexa(C.violetLite, 0.20), 1);
  line(ctx, cx + lw / 2 + 28, mid, box.x + box.w - 44, mid, hexa(C.violetLite, 0.20), 1);
  txt(ctx, label, {
    x: cx, y: mid, size: ls, fam: 'head', weight: 600, color: C.violetLite, align: 'center',
    baseline: 'middle', tracking: 5, upper: true, glowColor: hexa(C.violet, 0.6), glowBlur: 18,
  });
}

/** One match, given real presence: horizontal in wide boxes, stacked in tall ones. */
function matchHero(ctx, box, m, imgs, o = {}) {
  const played = o.played !== false && m.homeScore != null;
  const parts = metaParts(m, played);
  // the horizontal cluster is width-bound: above this aspect it can no longer
  // fill the card, so the stacked composition takes over
  const vertical = box.h / box.w > 0.75;
  const k = clamp(box.h / (vertical ? 1140 : 620), 0.58, 1.16);
  const cut = Math.round(clamp(48 * k, 24, 56));
  panel(ctx, box.x, box.y, box.w, box.h, {
    fill: '#14111F', fill2: hexa(C.violetInk, 0.96), r: 20, cut,
    border: hexa(C.violet, 0.52), topLight: 0.20, sheen: 0.09, edgeGlow: 0.34, ticks: true,
  });
  ctx.save();
  notch(ctx, box.x, box.y, box.w, box.h, 20, cut); ctx.clip();
  glow(ctx, box.x + box.w / 2, box.y + box.h * (vertical ? 0.5 : 0.38), box.w * 0.85, C.violet, 0.26);
  ctx.restore();
  const labelH = Math.max(46, 56 * k);
  if (o.label) sectionLabel(ctx, o.label, box.x + 30, box.y + labelH * 0.66, { size: Math.max(18, 21 * k), maxW: box.w * 0.6 });
  const metaH = parts.length ? Math.max(40, 48 * k) + Math.max(46, 62 * k) : Math.max(20, 28 * k);
  const core = { x: box.x, y: box.y + (o.label ? labelH : Math.max(18, 26 * k)), w: box.w };
  core.h = box.y + box.h - core.y - metaH;
  (vertical ? heroV : heroH)(ctx, core, m, imgs, { played, k });
  if (parts.length) metaBar(ctx, box, parts, k);
}

/* ------------------------------------------------------------- 1. results */

export function resultados(ctx, g, d, imgs) {
  const box = chrome(ctx, g, imgs, { kicker: d.round ?? 'Fecha', title: 'Resultados', sub: d.category, ...brand(d) });
  const MAX = g.id === '9:16' ? 9 : 8;
  const shown = d.matches.slice(0, MAX);
  const rest = d.matches.length - shown.length;
  const area = { ...box, h: box.h - (rest > 0 ? 76 : 0) };
  const n = shown.length;
  if (n <= 2) {
    const gap = 20;
    const h = (area.h - gap * (n - 1)) / n;
    shown.forEach((m, i) => matchHero(ctx, { ...area, y: area.y + i * (h + gap), h }, m, imgs,
      { played: true, label: n === 1 ? (d.round ?? 'Resultado') : `Partido ${i + 1}` }));
    return;
  }
  const tall = g.id === '9:16';
  // density mode: the cap is what stops a sparse fixture from becoming stretched cards
  const cap = n === 3 ? (tall ? 400 : 320) : n === 4 ? (tall ? 300 : 250) : n <= 6 ? (tall ? 212 : 180) : (tall ? 158 : 138);
  const L = rowLayout(area, n, { min: 76, max: cap, gap: n > 6 ? 10 : 14 });
  let y = L.y;
  for (const m of shown) {
    matchRow(ctx, m, box.x, y, box.w, L.h, imgs);
    y += L.h + L.gap;
  }
  if (rest > 0) overflow(ctx, `+${rest} partidos más`, box.x, y + 6, box.w);
}

/* ------------------------------------------------------------ 2. upcoming */

function upcomingRow(ctx, m, x, y, w, h, imgs) {
  panel(ctx, x, y, w, h, { fill: '#15121F', fill2: hexa(C.violetInk, 0.95), r: 12, cut: 24, border: hexa(C.violetMid, 0.34), topLight: 0.17, sheen: 0.07, shadow: 24, ticks: h > 170 });
  const topH = h * 0.64;
  const cy = y + topH / 2;
  const cx = x + w / 2;
  const pad = 22;
  const uvs = Math.min(46, 30 + h * 0.05);
  const centerHalf = measure(ctx, 'VS', { size: uvs, weight: 600, tracking: 2 }) / 2 + (h < 200 ? 26 : 34);
  const uns = Math.min(42, 26 + h * 0.055);
  const L = lanes(ctx, {
    x, w, pad, centerHalf, clear: 14, gap: 18, crest: Math.min(topH * 0.66, 122),
    names: [m.home.name, m.away.name], size: uns, minSize: 20, maxLines: 3, room: topH - 16,
  });
  const nOpt = { cy, size: uns, minSize: 20, maxLines: L.lines, fam: 'head', weight: 600, color: C.white, upper: true, maxW: L.lane, tracking: 0.4 };
  crest(ctx, m.home, x + pad, cy - L.cs / 2, L.cs, imgs);
  txtFit(ctx, m.home.name, { ...nOpt, x: cx - centerHalf - L.gap, align: 'right' });
  crest(ctx, m.away, x + w - pad - L.cs, cy - L.cs / 2, L.cs, imgs);
  txtFit(ctx, m.away.name, { ...nOpt, x: cx + centerHalf + L.gap, align: 'left' });
  vsMark(ctx, cx, cy, { size: uvs });

  line(ctx, x + pad, y + topH, x + w - pad, y + topH, hexa(C.violetLite, 0.10), 1);
  const chH = h - topH >= 62 ? 40 : 38;
  const my = y + topH + (h - topH) / 2 - chH / 2;
  const parts = [];
  if (m.date) parts.push({ s: m.date });
  parts.push(m.time ? { s: m.time } : { s: 'Horario a confirmar', warn: true });
  if (m.venue) parts.push({ s: m.venue, soft: true });
  let mx = x + pad;
  for (const p of parts) {
    const wdt = chip(ctx, p.s, mx, my, {
      size: chH >= 40 ? 21 : 19, h: chH,
      fill: p.warn ? hexa(C.yellow, 0.10) : p.soft ? hexa(C.white, 0.04) : hexa(C.violetLite, 0.09),
      border: p.warn ? hexa(C.yellow, 0.30) : p.soft ? hexa(C.white, 0.10) : hexa(C.violetLite, 0.22),
      color: p.warn ? C.yellow : p.soft ? C.muted : C.violetLite,
    });
    mx += wdt + 10;
    if (mx > x + w - pad - 60) break;
  }
  return y + h;
}

export function proximos(ctx, g, d, imgs) {
  const box = chrome(ctx, g, imgs, { kicker: 'Próximos partidos', title: d.round ?? 'Próxima fecha', sub: d.category, ...brand(d) });
  const shown = d.matches.slice(0, g.id === '9:16' ? 6 : 5);
  const rest = d.matches.length - shown.length;
  const area = { ...box, h: box.h - (rest > 0 ? 64 : 0) };
  const n = shown.length;
  if (n <= 2) {
    const gap = 20;
    const h = (area.h - gap * (n - 1)) / n;
    shown.forEach((m, i) => matchHero(ctx, { ...area, y: area.y + i * (h + gap), h }, m, imgs,
      { played: false, label: n === 1 ? 'Próximo partido' : `Partido ${i + 1}` }));
    return;
  }
  const tall = g.id === '9:16';
  const cap = n === 3 ? (tall ? 400 : 300) : n === 4 ? (tall ? 300 : 232) : (tall ? 214 : 172);
  const L = rowLayout(area, n, { min: 124, max: cap, gap: 14 });
  let y = L.y;
  for (const m of shown) {
    upcomingRow(ctx, m, box.x, y, box.w, L.h, imgs);
    y += L.h + L.gap;
  }
  if (rest > 0) overflow(ctx, `+${rest} partidos más`, box.x, y + 4, box.w);
}

/* -------------------------------------------------------------- 3. figure */

function figureStats(p) {
  const out = [];
  const add = (v, l) => { if (v != null) out.push([String(v), l]); };
  add(p.goals, p.goals === 1 ? 'Gol' : 'Goles');
  add(p.assists, p.assists === 1 ? 'Asistencia' : 'Asistencias');
  add(p.appearances, 'Apariciones');
  add(p.starts, 'Titularidades');
  add(p.captaincies, 'Capitanías');
  return out;
}

function nameParts(full) {
  const w = String(full).trim().split(/\s+/);
  return w.length === 1 ? ['', w[0]] : [w.slice(0, -1).join(' '), w[w.length - 1]];
}

export function figura(ctx, g, d, imgs) {
  const p = d.player;
  const box = chrome(ctx, g, imgs, { kicker: d.round, title: 'Figura', sub: 'de la fecha', ...brand(d) });
  const stats = figureStats(p).slice(0, 4);
  const railH = g.id === '9:16' ? 124 : 108;
  const [first, last] = nameParts(p.name);
  const photo = p.photo ? imgs.get(p.photo) : null;

  if (photo) {
    const ph = box.h - railH - 22;
    cardImage(ctx, photo, box.x, box.y, box.w, ph, { cut: 34, anchorY: 0.04, scrimA: 0.95 });
    const by = box.y + ph;
    txt(ctx, p.position ?? '', { x: box.x + 36, y: by - 262, size: 20, fam: 'head', weight: 500, color: C.violetLite, tracking: 5.5, upper: true, maxW: box.w - 320 });
    line(ctx, box.x + 36, by - 232, box.x + 126, by - 232, hexa(C.violet, 0.85), 3);
    if (first) txt(ctx, first, { x: box.x + 36, y: by - 182, size: 40, fam: 'head', weight: 300, color: C.text, upper: true, tracking: 3, maxW: box.w - 320 });
    txt(ctx, last, { x: box.x + 32, y: by - 58, size: 98, fam: 'display', color: C.white, upper: true, maxW: box.w - 300, glowColor: hexa(C.violetLite, 0.55), glowBlur: 26 });
    // team badge, bottom-right of the photo
    const cs = 62;
    crest(ctx, p.team, box.x + box.w - 36 - cs, by - 56 - cs, cs, imgs);
    txt(ctx, p.team.name, { x: box.x + box.w - 36 - cs - 18, y: by - 82, size: 22, fam: 'head', weight: 500, color: C.text, align: 'right', upper: true, tracking: 2, maxW: 250 });
    statRail(ctx, stats, box.x, box.y + box.h - railH, box.w, railH);
  } else {
    const cardH = box.h - railH - 22;
    panel(ctx, box.x, box.y, box.w, cardH, {
      fill: '#14111F', fill2: hexa(C.violetInk, 0.96), r: 20, cut: 48,
      border: hexa(C.violet, 0.46), topLight: 0.18, sheen: 0.07, edgeGlow: 0.30, ticks: true,
    });

    // identity plate — the deliberate stand-in for the portrait
    const pw = Math.min(box.w * 0.42, 400);
    const ph = cardH - 84;
    const pxp = box.x + box.w - pw - 40;
    const pyp = box.y + 42;
    ctx.save();
    glow(ctx, pxp + pw / 2, pyp + ph * 0.42, pw * 1.0, C.violet, 0.45);
    ctx.restore();
    panel(ctx, pxp, pyp, pw, ph, {
      fill: hexa(C.violet, 0.34), fill2: hexa(C.violetDeep, 0.92), r: 18, cut: 40,
      border: hexa(C.violetLite, 0.55), topLight: 0.26, sheen: 0.16, shadow: 30,
    });
    ctx.save();
    notch(ctx, pxp, pyp, pw, ph, 18, 40); ctx.clip();
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = hexa(C.white, 0.06 - i * 0.008);
      para(ctx, pxp + pw * 0.02 + i * 46, pyp, 18 - i * 2.4, ph, ph * 0.26); ctx.fill();
    }
    ctx.fillStyle = hexa(C.white, 0.028);
    for (let hy = pyp; hy < pyp + ph; hy += 9) ctx.fillRect(pxp, hy, pw, 1);
    ctx.restore();
    txt(ctx, initialsOf(p.name), {
      x: pxp + pw / 2, y: pyp + ph * 0.46, size: pw * 0.66, fam: 'display',
      color: C.white, align: 'center', baseline: 'middle', tracking: 4,
      glowColor: hexa(C.violetLite, 0.75), glowBlur: 38,
    });
    line(ctx, pxp + pw * 0.30, pyp + ph - 74, pxp + pw * 0.70, pyp + ph - 74, hexa(C.white, 0.30), 2);
    txt(ctx, p.position ?? 'Jugador', {
      x: pxp + pw / 2, y: pyp + ph - 36, size: 21, fam: 'head', weight: 500,
      color: hexa(C.white, 0.86), align: 'center', tracking: 5.5, upper: true, maxW: pw - 60,
    });
    const bs = 84;
    crest(ctx, p.team, pxp - bs * 0.42, pyp + ph - bs - 6, bs, imgs, { r: bs * 0.26 });

    // name block
    const lx = box.x + 44;
    const lw = pw ? pxp - lx - 46 : box.w - 90;
    const nameSize = Math.min(104, lw * 0.42);
    const blockH = (first ? 84 : 0) + nameSize * 0.78 + 104;
    let py = box.y + (cardH - blockH) / 2 + 44;
    chip(ctx, 'Figura de la fecha', lx, py - 106, { size: 17, h: 34, color: C.violetLite });
    if (first) { txt(ctx, first, { x: lx, y: py, size: 42, fam: 'head', weight: 300, color: C.text, upper: true, tracking: 2.5, maxW: lw }); py += 84; }
    txt(ctx, last, { x: lx - 2, y: py + nameSize * 0.74, size: nameSize, fam: 'display', color: C.white, upper: true, maxW: lw, glowColor: hexa(C.violetLite, 0.55), glowBlur: 26 });
    py += nameSize * 0.74 + 42;
    line(ctx, lx, py, lx + Math.min(lw, 150), py, hexa(C.violet, 0.8), 3);
    py += 46;
    txt(ctx, p.team.name, { x: lx, y: py, size: 25, fam: 'head', weight: 500, color: C.violetLite, upper: true, tracking: 2.4, maxW: lw });
    statRail(ctx, stats, box.x, box.y + box.h - railH, box.w, railH);
  }
}

function statRail(ctx, stats, x, y, w, h) {
  panel(ctx, x, y, w, h, { fill: '#16131F', fill2: hexa(C.violetInk, 0.9), r: 14, border: hexa(C.violetMid, 0.34), topLight: 0.16, sheen: 0.06, shadow: 22 });
  const n = Math.max(1, stats.length);
  const cw = w / n;
  stats.forEach(([v, l], i) => {
    const cx = x + cw * i + cw / 2;
    if (i) line(ctx, x + cw * i, y + 22, x + cw * i, y + h - 22, hexa(C.violetLite, 0.12), 1);
    txt(ctx, v, { x: cx, y: y + h * 0.58, size: 62, fam: 'display', color: C.white, align: 'center', baseline: 'alphabetic', glowColor: hexa(C.violetLite, 0.55), glowBlur: 20 });
    txt(ctx, l, { x: cx, y: y + h - 24, size: 17, fam: 'head', weight: 500, color: C.muted, align: 'center', tracking: 2.6, upper: true, maxW: cw - 24 });
  });
}

/* ------------------------------------------------------- 4/5/6. team of the round */

const POS_ORDER = ['ARQ', 'DEF', 'MED', 'DEL'];

function pitch(ctx, x, y, w, h) {
  panel(ctx, x, y, w, h, { fill: '#0D0A18', fill2: hexa(C.violetInk, 0.95), r: 16, border: hexa(C.violetMid, 0.36), topLight: 0.14, sheen: 0.05, shadow: 28, ticks: true });
  ctx.save();
  rrect(ctx, x, y, w, h, 16); ctx.clip();
  glow(ctx, x + w / 2, y + h * 0.5, w * 0.85, C.violet, 0.24);
  const ln = hexa(C.violetLite, 0.24);
  const pad = 26;
  ctx.strokeStyle = ln; ctx.lineWidth = 1.5;
  ctx.strokeRect(x + pad, y + pad, w - pad * 2, h - pad * 2);
  ctx.beginPath(); ctx.moveTo(x + pad, y + h / 2); ctx.lineTo(x + w - pad, y + h / 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(x + w / 2, y + h / 2, w * 0.13, 0, Math.PI * 2); ctx.stroke();
  const bw = w * 0.42, bh = h * 0.13;
  ctx.strokeRect(x + (w - bw) / 2, y + pad, bw, bh);
  ctx.strokeRect(x + (w - bw) / 2, y + h - pad - bh, bw, bh);
  const gw = w * 0.20, gh = h * 0.055;
  ctx.strokeRect(x + (w - gw) / 2, y + pad, gw, gh);
  ctx.strokeRect(x + (w - gw) / 2, y + h - pad - gh, gw, gh);
  ctx.restore();
}

function pitchPlayer(ctx, p, cx, cy, size, colW, rowH, imgs) {
  ctx.save();
  glow(ctx, cx, cy, size * 1.05, C.violet, 0.45);
  ctx.restore();
  monogram(ctx, p.name, cx - size / 2, cy - size / 2, size, {
    accent: p.isGoalkeeper ? C.violetLite : C.violetMid, r: size * 0.28, boxless: false,
  });
  ctx.save();
  rrect(ctx, cx - size / 2 - 5, cy - size / 2 - 5, size + 10, size + 10, size * 0.31);
  ctx.strokeStyle = hexa(C.violetLite, 0.35); ctx.lineWidth = 1.5; ctx.stroke();
  ctx.restore();
  const bs = size * 0.46;
  crest(ctx, p.team, cx + size / 2 - bs * 0.62, cy + size / 2 - bs * 0.62, bs, imgs, { r: bs * 0.3 });
  // density-specific type scale: F11 columns are narrow, F5 rows are tall
  const ns = Math.max(16, Math.min(29, colW * 0.145, rowH * 0.15));
  const maxW = colW - 14;
  let disp = p.name;
  if (measure(ctx, disp, { size: ns, weight: 600, upper: true }) > maxW) {
    const parts = String(p.name).trim().split(/\s+/);
    if (parts.length > 1) disp = parts[0][0] + '. ' + parts.slice(1).join(' ');
  }
  const nameY = cy + size / 2 + Math.max(20, Math.min(42, rowH * 0.13)) + ns * 0.4;
  txt(ctx, disp, { x: cx, y: nameY, size: ns, fam: 'head', weight: 600, color: C.white, align: 'center', upper: true, maxW, minSize: 15, tracking: 0.3 });
  txt(ctx, p.pos, { x: cx, y: nameY + ns * 1.35, size: Math.max(14, ns * 0.66), fam: 'head', weight: 500, color: C.violetLite, align: 'center', upper: true, tracking: 3, maxW });
}

export function equipo(ctx, g, d, imgs) {
  const box = chrome(ctx, g, imgs, { kicker: d.round, title: 'Equipo de la fecha', sub: d.modality, ...brand(d), titleSize: g.id === '9:16' ? 88 : 78 });
  const groups = POS_ORDER.map(k => d.players.filter(p => p.pos === k)).filter(gp => gp.length);
  const ph = box.h;
  pitch(ctx, box.x, box.y, box.w, ph);
  const rows = groups.length;
  const inset = g.id === '9:16' ? 40 : 30;
  const rowH = (ph - inset * 2) / rows;
  groups.slice().reverse().forEach((gp, i) => {
    const cy = box.y + inset + rowH * (i + 0.5);
    const colW = (box.w - 28) / gp.length;
    const size = Math.min(126, colW * 0.54, rowH * 0.40);
    gp.forEach((p, j) => pitchPlayer(ctx, p, box.x + 14 + colW * j + colW / 2, cy - rowH * 0.08, size, colW, rowH, imgs));
  });
}

/* ------------------------------------------------------------ 7. standings */

export function tabla(ctx, g, d, imgs) {
  const box = chrome(ctx, g, imgs, { kicker: d.category, title: 'Tabla de posiciones', ...brand(d), titleSize: g.id === '9:16' ? 88 : 76 });
  const MAX = g.id === '9:16' ? 20 : 14;
  const rows = d.rows.slice(0, MAX);
  const rest = d.rows.length - rows.length;
  const wide = rows.length <= 12;
  const cols = wide
    ? [['pj', 'PJ'], ['pg', 'PG'], ['pe', 'PE'], ['pp', 'PP'], ['gf', 'GF'], ['gc', 'GC'], ['dg', 'DG'], ['pts', 'PTS']]
    : [['pj', 'PJ'], ['pg', 'PG'], ['pe', 'PE'], ['pp', 'PP'], ['dg', 'DG'], ['pts', 'PTS']];
  const numW = wide ? 58 : 62;
  const ptsW = 74;
  const numTotal = (cols.length - 1) * numW + ptsW;
  const headH = 40;
  const gap = rows.length > 12 ? 5 : 9;
  const availH = box.h - headH - 10 - (rest > 0 ? 58 : 0);
  const rowH = Math.min(rows.length > 12 ? 78 : 150, (availH - gap * (rows.length - 1)) / rows.length);
  const totalH = rowH * rows.length + gap * (rows.length - 1);
  const startY = box.y + headH + 10 + Math.max(0, (availH - totalH) / 2);

  // header
  const colX = (i) => box.x + box.w - numTotal + (i * numW) + (i === cols.length - 1 ? 0 : 0) + numW / 2;
  const xFor = (i) => (i === cols.length - 1 ? box.x + box.w - ptsW / 2 : box.x + box.w - numTotal + i * numW + numW / 2);
  txt(ctx, '#', { x: box.x + 10, y: box.y + 22, size: 17, fam: 'head', weight: 500, color: C.dim, tracking: 2.4, upper: true });
  txt(ctx, 'Equipo', { x: box.x + 62, y: box.y + 22, size: 17, fam: 'head', weight: 500, color: C.dim, tracking: 2.4, upper: true });
  cols.forEach(([k, l], i) => txt(ctx, l, { x: xFor(i), y: box.y + 22, size: 17, fam: 'head', weight: 500, color: k === 'pts' ? C.violetLite : C.dim, align: 'center', tracking: 1.8, upper: true }));
  line(ctx, box.x, box.y + 34, box.x + box.w, box.y + 34, hexa(C.violetLite, 0.14), 1);

  const dense = rowH < 70;
  rows.forEach((r, i) => {
    const y = startY + i * (rowH + gap);
    const top4 = r.pos <= 4;
    panel(ctx, box.x, y, box.w, rowH, {
      fill: top4 ? hexa(C.violetInk, 0.92) : hexa(C.panel, i % 2 ? 0.92 : 0.7),
      r: 8, border: top4 ? hexa(C.violet, 0.42) : hexa(C.borderSoft, 0.9), topLight: 0,
      accent: top4 ? C.violet : null, accentW: 3,
    });
    const cy = y + rowH / 2;
    txt(ctx, String(r.pos), { x: box.x + 26, y: cy + (dense ? 8 : 10), size: dense ? 26 : 32, fam: 'display', color: top4 ? C.violetLite : C.muted, align: 'center' });
    const cs = Math.min(rowH * 0.62, 46);
    crest(ctx, r.team, box.x + 46, cy - cs / 2, cs, imgs, { r: cs * 0.26 });
    txt(ctx, r.team.name, {
      x: box.x + 46 + cs + 14, y: cy + (dense ? 7 : 9), size: dense ? 22 : 27, fam: 'head', weight: 600,
      color: C.white, upper: true, maxW: box.w - numTotal - (46 + cs + 30), minSize: dense ? 16 : 18, tracking: 0.3,
    });
    cols.forEach(([k], j) => {
      const isPts = k === 'pts';
      const v = k === 'dg' ? (r.dg > 0 ? `+${r.dg}` : String(r.dg)) : String(r[k]);
      txt(ctx, v, {
        x: xFor(j), y: cy + (dense ? 8 : 10), size: isPts ? (dense ? 28 : 34) : (dense ? 22 : 26),
        fam: isPts ? 'display' : 'head', weight: 500,
        color: isPts ? C.white : k === 'dg' ? (r.dg >= 0 ? C.text : C.dim) : C.muted, align: 'center',
      });
    });
  });
  if (rest > 0) overflow(ctx, `+${rest} equipos en la tabla completa`, box.x, startY + totalH + 14, box.w, { h: 44 });
}

/* ----------------------------------------------------------- 8. goalscorers */

export function goleadores(ctx, g, d, imgs) {
  const box = chrome(ctx, g, imgs, { kicker: d.category, title: 'Goleadores', ...brand(d) });
  const players = d.players.slice(0, g.id === '9:16' ? 12 : 10);
  const rest = d.players.length - players.length;
  const hasPhotos = players.some(p => p.photo && imgs.get(p.photo));
  const area = { ...box, h: box.h - (rest > 0 ? 58 : 0) };
  const nP = players.length;
  const tall = g.id === '9:16';
  const capP = nP <= 3 ? (tall ? 400 : 330) : nP <= 5 ? (tall ? 250 : 208) : nP <= 8 ? (tall ? 186 : 158) : (tall ? 148 : 128);
  const L = rowLayout(area, nP, { min: 58, max: capP, gap: nP > 6 ? 8 : 12 });
  let y = L.y;
  const dense = L.h < 88;
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    const lead = i === 0;
    panel(ctx, box.x, y, box.w, L.h, {
      fill: lead ? hexa(C.violet, 0.22) : '#15121F', fill2: lead ? hexa(C.violetDeep, 0.88) : hexa(C.violetInk, 0.92),
      r: 10, cut: dense ? 0 : 22, border: lead ? hexa(C.violet, 0.65) : hexa(C.violetMid, 0.28),
      topLight: lead ? 0.24 : 0.12, sheen: dense ? 0.04 : lead ? 0.11 : 0.06,
      shadow: dense ? 10 : 24, accent: lead ? C.violet : null, accentW: 4,
      edgeGlow: lead && !dense ? 0.28 : 0, ticks: lead && L.h > 140,
    });
    const cy = y + L.h / 2;
    let cx = box.x + (dense ? 18 : 24);
    const rankSize = dense ? 32 : Math.min(96, 40 + L.h * 0.11);
    txt(ctx, String(i + 1), { x: cx + rankSize * 0.34, y: cy + rankSize * 0.32, size: rankSize, fam: 'display', color: lead ? C.violetLite : C.dim, align: 'center' });
    cx += dense ? 40 : rankSize * 0.8 + 16;
    const av = Math.min(L.h - (dense ? 14 : 40), dense ? 44 : 118);
    // photo → crest → monogram: siempre hay identidad visual
    const img = p.photo ? imgs.get(p.photo) : null;
    if (img) cardImage(ctx, img, cx, cy - av / 2, av, av, { r: av * 0.26, scrim: false });
    else if (p.team) crest(ctx, p.team, cx, cy - av / 2, av, imgs, { r: av * 0.26 });
    else monogram(ctx, p.name, cx, cy - av / 2, av, { r: av * 0.26 });
    if (!dense) {
      ctx.save();
      rrect(ctx, cx - 4, cy - av / 2 - 4, av + 8, av + 8, av * 0.3);
      ctx.strokeStyle = hexa(lead ? C.violetLite : C.violetMid, lead ? 0.7 : 0.34); ctx.lineWidth = 1.5; ctx.stroke();
      ctx.restore();
    }
    cx += av + 18;
    const rightW = dense ? 130 : 220;
    const nameMax = box.x + box.w - rightW - cx - 16;
    const hasTeam = !!p.team;
    const nameSize = dense ? 24 : Math.min(44, 28 + L.h * 0.045);
    txtFit(ctx, p.name, {
      x: cx, y: cy + (hasTeam ? (dense ? 0 : -6) : (dense ? 8 : 10)), size: nameSize, minSize: dense ? 18 : 21,
      maxLines: !dense && L.h > 150 ? 2 : 1, fam: 'head', weight: 600, color: C.white, upper: true, maxW: nameMax, tracking: 0.3,
    });
    if (hasTeam) txt(ctx, p.team.name, { x: cx, y: cy + (dense ? 20 : nameSize * 0.86), size: dense ? 17 : 21, fam: 'head', weight: 400, color: C.muted, upper: true, tracking: 2.4, maxW: nameMax });

    const gx = box.x + box.w - (dense ? 24 : 32);
    const goalSize = dense ? 38 : Math.min(92, 46 + L.h * 0.12);
    txt(ctx, String(p.goals), { x: gx, y: cy + goalSize * 0.20, size: goalSize, fam: 'display', color: C.white, align: 'right', glowColor: hexa(C.violetLite, 0.45), glowBlur: 16 });
    if (!dense) {
      txt(ctx, p.goals === 1 ? 'Gol' : 'Goles', { x: gx, y: cy + goalSize * 0.20 + 26, size: 16, fam: 'head', weight: 500, color: C.violetLite, align: 'right', tracking: 2.6, upper: true });
      if (p.assists != null) txt(ctx, `${p.assists} AS`, { x: gx - goalSize * 0.72 - 40, y: cy + 8, size: 24, fam: 'head', weight: 500, color: C.muted, align: 'right' });
    }
    y += L.h + L.gap;
  }
  if (rest > 0) overflow(ctx, `+${rest} goleadores más`, box.x, y + 4, box.w);
}

/* ----------------------------------------------------------- 9. sanctioned */

export function sancionados(ctx, g, d, imgs) {
  const box = chrome(ctx, g, imgs, { kicker: d.round, title: 'Sancionados', sub: d.category, ...brand(d) });
  if (!d.players.length) {
    emptyState(ctx, box, {
      kicker: d.round ?? 'Fecha',
      title: 'Sin sanciones en esta fecha',
      note: 'Ningún jugador queda suspendido para la próxima fecha.',
    });
    return;
  }
  const players = d.players.slice(0, g.id === '9:16' ? 8 : 6);
  const tallS = g.id === '9:16';
  const capS = players.length <= 4 ? (tallS ? 290 : 240) : players.length <= 6 ? (tallS ? 212 : 172) : (tallS ? 172 : 150);
  const L = rowLayout(box, players.length, { min: 92, max: capS, gap: 12 });
  let y = L.y;
  for (const p of players) {
    panel(ctx, box.x, y, box.w, L.h, { fill: hexa(C.panel, 0.94), fill2: hexa(C.violetInk, 0.5), r: 12, cut: 20, border: hexa(C.border, 0.95), topLight: 0.05 });
    const cy = y + L.h / 2;
    const cs = Math.min(L.h * 0.5, 92);
    crest(ctx, p.team, box.x + 22, cy - cs / 2, cs, imgs);
    const nx = box.x + 22 + cs + 20;
    const nameMax = box.w - (nx - box.x) - 300;
    const ns = Math.min(36, 22 + L.h * 0.05);
    txt(ctx, p.name, { x: nx, y: cy - 8, size: ns, fam: 'head', weight: 600, color: C.white, upper: true, maxW: nameMax, minSize: 19, tracking: 0.3 });
    txt(ctx, p.team.name, { x: nx, y: cy + 26, size: 19, fam: 'head', weight: 400, color: C.muted, upper: true, tracking: 2.4, maxW: nameMax, minSize: 15 });

    let rx = box.x + box.w - 24;
    const pill = chip(ctx, p.matchesLeft === 1 ? '1 fecha' : `${p.matchesLeft} fechas`, rx, cy - 19, {
      align: 'right', size: 19, h: 38, fill: hexa(C.violet, 0.16), border: hexa(C.violet, 0.5), color: C.white,
    });
    rx -= pill + 22;
    if (p.reds) {
      txt(ctx, String(p.reds), { x: rx, y: cy + 9, size: 26, fam: 'head', weight: 600, color: C.white, align: 'right' });
      cardIcon(ctx, rx - 24 - 22, cy - 18, 24, 34, C.red);
      rx -= 24 + 22 + 20;
    }
    if (p.yellows) {
      txt(ctx, String(p.yellows), { x: rx, y: cy + 9, size: 26, fam: 'head', weight: 600, color: C.white, align: 'right' });
      cardIcon(ctx, rx - 24 - 22, cy - 18, 24, 34, C.yellow);
    }
    y += L.h + L.gap;
  }
}

/* -------------------------------------------------------------- 10. recap */

export function resumen(ctx, g, d, imgs) {
  const box = chrome(ctx, g, imgs, { kicker: d.round, title: 'Resumen', sub: 'de la fecha', ...brand(d) });
  const leaders = (d.leaders ?? []).slice(0, 3);
  const leadH = leaders.length ? (g.id === '9:16' ? 300 : 250) : 0;
  const resH = box.h - leadH - (leaders.length ? 34 : 0);

  let y = box.y + 6;
  sectionLabel(ctx, 'Resultados', box.x, y + 14);
  y += 38;
  const shown = d.matches.slice(0, 6);
  const rest = d.matches.length - shown.length;
  const area = { x: box.x, y, w: box.w, h: resH - 44 - (rest > 0 ? 52 : 0) };
  const L = rowLayout(area, shown.length, { min: 66, max: g.id === '9:16' ? 200 : 150, gap: 8 });
  let ry = L.y;
  for (const m of shown) { matchRow(ctx, m, box.x, ry, box.w, L.h, imgs); ry += L.h + L.gap; }
  if (rest > 0) { overflow(ctx, `+${rest} partidos más`, box.x, ry + 2, box.w, { h: 40 }); ry += 44; }

  if (!leaders.length) return;
  const ly = box.y + box.h - leadH;
  line(ctx, box.x, ly - 22, box.x + box.w, ly - 22, hexa(C.violetLite, 0.12), 1);
  sectionLabel(ctx, 'Goleadores de la fecha', box.x, ly + 6);
  const cardY = ly + 26;
  const cardH = leadH - 26;
  const cw = (box.w - 16) / leaders.length;
  leaders.forEach((p, i) => {
    const x = box.x + i * (cw + 8);
    panel(ctx, x, cardY, cw - 8, cardH, { fill: hexa(C.panel, 0.94), fill2: hexa(C.violetInk, 0.6), r: 12, cut: 18, border: hexa(C.border, 0.95), topLight: 0.06 });
    const cx = x + (cw - 8) / 2;
    const cs = 52;
    if (p.team) crest(ctx, p.team, cx - cs / 2, cardY + 22, cs, imgs, { r: cs * 0.26 });
    txt(ctx, String(p.goals), { x: cx, y: cardY + cardH - 78, size: 62, fam: 'display', color: C.white, align: 'center', glowColor: hexa(C.violetLite, 0.45), glowBlur: 18 });
    txt(ctx, p.goals === 1 ? 'Gol' : 'Goles', { x: cx, y: cardY + cardH - 52, size: 15, fam: 'head', weight: 500, color: C.violetLite, align: 'center', tracking: 2.6, upper: true });
    txt(ctx, p.name, { x: cx, y: cardY + cardH - 22, size: 21, fam: 'head', weight: 600, color: C.white, align: 'center', upper: true, maxW: cw - 34, tracking: 0.3 });
  });
}

/* ---------------------------------------------------------- 11/12. knockout */

function knockoutRow(ctx, m, label, x, y, w, h, imgs) {
  panel(ctx, x, y, w, h, {
    fill: '#15121F', fill2: hexa(C.violetInk, 0.96), r: 16, cut: 30,
    border: hexa(C.violet, 0.50), topLight: 0.20, sheen: 0.09, shadow: 28, edgeGlow: 0.22, ticks: true,
  });
  ctx.save();
  notch(ctx, x, y, w, h, 16, 30); ctx.clip();
  glow(ctx, x + w / 2, y + h * 0.42, w * 0.6, C.violet, 0.20);
  ctx.restore();
  sectionLabel(ctx, label, x + 26, y + 42, { size: 21 });
  const dense = h < 300;
  const metaH = Math.max(58, h * 0.20);
  const topY = y + (dense ? 58 : 64);
  const topH = (y + h - metaH) - topY;
  const cy = topY + topH / 2;
  const cx = x + w / 2;
  const pad = 26;
  const vs = Math.min(52, 32 + h * 0.06);
  const centerHalf = measure(ctx, 'VS', { size: vs, weight: 600, tracking: 2 }) / 2 + (dense ? 30 : 40);
  const ns = Math.round(clamp(topH * 0.26, dense ? 27 : 32, 42));
  const L = lanes(ctx, {
    x, w, pad, centerHalf, clear: 16, gap: dense ? 18 : 24,
    crest: Math.min(topH * (dense ? 0.68 : 0.74), dense ? 104 : 122),
    names: [m.home.name, m.away.name], size: ns, minSize: 22, maxLines: 3, room: topH - 14,
  });
  const nOpt = { cy, size: ns, minSize: 22, maxLines: L.lines, fam: 'head', weight: 600, color: C.white, upper: true, maxW: L.lane, tracking: 0.4 };
  crest(ctx, m.home, x + pad, cy - L.cs / 2, L.cs, imgs);
  txtFit(ctx, m.home.name, { ...nOpt, x: cx - centerHalf - L.gap, align: 'right' });
  crest(ctx, m.away, x + w - pad - L.cs, cy - L.cs / 2, L.cs, imgs);
  txtFit(ctx, m.away.name, { ...nOpt, x: cx + centerHalf + L.gap, align: 'left' });
  vsMark(ctx, cx, cy, { size: vs });
  line(ctx, x + pad + 20, y + h - metaH, x + w - pad - 20, y + h - metaH, hexa(C.violetLite, 0.10), 1);
  metaLine(ctx, [m.date, m.time ? { s: m.time } : { s: 'Horario a confirmar', warn: true }, m.venue],
    cx, y + h - metaH / 2 + (dense ? 9 : 10), { size: dense ? 24 : 26, minSize: 19, maxW: w - 72 });
}

export function semis(ctx, g, d, imgs) {
  const box = chrome(ctx, g, imgs, { kicker: d.category, title: 'Semifinales', ...brand(d) });
  const ms = d.matches.slice(0, 4);
  const tall = g.id === '9:16';
  // important, but deliberately below the Gran Final in scale
  const cap = ms.length <= 2 ? (tall ? 545 : 385) : (tall ? 300 : 232);
  const L = rowLayout(box, ms.length, { min: 150, max: cap, gap: tall ? 26 : 20 });
  let y = L.y;
  ms.forEach((m, i) => {
    knockoutRow(ctx, m, `Semifinal ${i + 1}`, box.x, y, box.w, L.h, imgs);
    y += L.h + L.gap;
  });
}

/** Label + value cells, divided. Used by the Final's event plate. */
function infoBar(ctx, x, y, w, h, cells) {
  panel(ctx, x, y, w, h, { fill: '#17141F', fill2: hexa(C.violetInk, 0.92), r: 14, border: hexa(C.violetMid, 0.42), topLight: 0.16, sheen: 0.06, shadow: 26 });
  const cw = w / cells.length;
  cells.forEach(([label, value, warn], i) => {
    const cx = x + cw * i + cw / 2;
    if (i) line(ctx, x + cw * i, y + 24, x + cw * i, y + h - 24, hexa(C.violetLite, 0.14), 1);
    txt(ctx, label, { x: cx, y: y + 40, size: 17, fam: 'head', weight: 500, color: C.dim, align: 'center', tracking: 4.5, upper: true, maxW: cw - 26 });
    txt(ctx, value, { x: cx, y: y + h - 30, size: 34, fam: 'head', weight: 600, color: warn ? C.yellow : C.white, align: 'center', tracking: 1.4, upper: true, maxW: cw - 28 });
  });
}

/** The Final is an event plate, not a card: split field, violet gash, oversized names. */
function finalHero(ctx, g, d, imgs) {
  const m = d.matches[0];
  const tall = g.id === '9:16';
  background(ctx, g, { glowTop: 0.34, glowBottom: 0.42 });
  const hy = brandHeader(ctx, g, imgs, { tournament: brand(d).tournament });
  const floor = footerBrand(ctx, g, imgs, {});
  const top = hy + (tall ? 46 : 36);
  const box = { x: g.x, y: top, w: g.w, h: floor - top };
  const cxm = g.W / 2;

  let cy = box.y + 26;
  txt(ctx, d.category ?? 'Instancia decisiva', {
    x: cxm, y: cy + 22, size: 22, fam: 'head', weight: 500, color: C.violetLite,
    align: 'center', tracking: 6.5, upper: true, maxW: box.w - 220,
  });
  cy += 22 + (tall ? 46 : 38);
  const big = tall ? 156 : 132;
  const titleY = cy + big * 0.72;
  txt(ctx, 'Gran final', {
    x: cxm, y: titleY, size: big, fam: 'display', color: C.white, align: 'center',
    upper: true, tracking: 4, maxW: box.w - 170, glowColor: hexa(C.violetLite, 0.8), glowBlur: 46,
  });
  ctx.save();
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = hexa(i ? C.violetLite : C.violet, 0.68 - i * 0.18);
    para(ctx, box.x + 4 + i * 22, titleY - big * 0.62, 9 - i * 2, big * 0.56, big * 0.20); ctx.fill();
    para(ctx, box.x + box.w - 13 - i * 22, titleY - big * 0.62, 9 - i * 2, big * 0.56, big * 0.20); ctx.fill();
  }
  ctx.restore();
  cy = titleY + (tall ? 42 : 34);

  const infoH = tall ? 148 : 132;
  const infoY = box.y + box.h - infoH;
  const cz = { x: box.x, y: cy + 10, w: box.w, h: infoY - 36 - (cy + 10) };
  const bandT = tall ? 118 : 100;
  const skew = cz.h * 0.11;
  const midY = cz.y + cz.h * 0.5;
  const yAt = (px, off) => midY + skew - (px - cz.x) / cz.w * skew * 2 + off;

  ctx.save();
  rrect(ctx, cz.x, cz.y, cz.w, cz.h, 20); ctx.clip();
  const field = (offA, offB, colorA, colorB) => {
    ctx.beginPath();
    if (offA === null) {
      ctx.moveTo(cz.x, cz.y); ctx.lineTo(cz.x + cz.w, cz.y);
      ctx.lineTo(cz.x + cz.w, yAt(cz.x + cz.w, offB)); ctx.lineTo(cz.x, yAt(cz.x, offB));
    } else {
      ctx.moveTo(cz.x, yAt(cz.x, offA)); ctx.lineTo(cz.x + cz.w, yAt(cz.x + cz.w, offA));
      ctx.lineTo(cz.x + cz.w, cz.y + cz.h); ctx.lineTo(cz.x, cz.y + cz.h);
    }
    ctx.closePath();
    const gr = ctx.createLinearGradient(cz.x, cz.y, cz.x + cz.w * 0.4, cz.y + cz.h);
    gr.addColorStop(0, colorA); gr.addColorStop(1, colorB);
    ctx.fillStyle = gr; ctx.fill();
  };
  field(null, -bandT / 2, hexa(C.violet, 0.16), hexa(C.violetInk, 0.55));
  field(bandT / 2, null, hexa(C.violetInk, 0.55), hexa(C.violetDeep, 0.42));
  ctx.beginPath();
  ctx.moveTo(cz.x, yAt(cz.x, -bandT / 2)); ctx.lineTo(cz.x + cz.w, yAt(cz.x + cz.w, -bandT / 2));
  ctx.lineTo(cz.x + cz.w, yAt(cz.x + cz.w, bandT / 2)); ctx.lineTo(cz.x, yAt(cz.x, bandT / 2));
  ctx.closePath();
  const bg = ctx.createLinearGradient(cz.x, 0, cz.x + cz.w, 0);
  bg.addColorStop(0, hexa(C.violet, 0.30)); bg.addColorStop(0.5, hexa(C.violet, 0.52)); bg.addColorStop(1, hexa(C.violet, 0.30));
  ctx.fillStyle = bg; ctx.fill();
  ctx.save();
  ctx.clip();
  for (let i = 0; i < 26; i++) {
    ctx.fillStyle = hexa(C.white, 0.05);
    para(ctx, cz.x + i * 46, cz.y, 10, cz.h, cz.h * 0.2); ctx.fill();
  }
  ctx.restore();
  ctx.strokeStyle = hexa(C.violetLite, 0.75); ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(cz.x, yAt(cz.x, -bandT / 2)); ctx.lineTo(cz.x + cz.w, yAt(cz.x + cz.w, -bandT / 2)); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cz.x, yAt(cz.x, bandT / 2)); ctx.lineTo(cz.x + cz.w, yAt(cz.x + cz.w, bandT / 2)); ctx.stroke();
  glow(ctx, cxm, midY, cz.w * 0.42, C.violetLite, 0.20);
  ctx.restore();
  cornerTicks(ctx, cz.x, cz.y, cz.w, cz.h, hexa(C.violetLite, 0.5), 24, 14);

  const topH = (midY - bandT / 2) - cz.y;
  const cs = Math.min(cz.w * 0.30, topH * 0.72, 300);
  const nameSize = tall ? 84 : 72;
  [[m.home, cz.x + cz.w * 0.25, cz.y + topH * 0.5, 'ltr'],
   [m.away, cz.x + cz.w * 0.75, cz.y + cz.h - topH * 0.5, 'rtl']].forEach(([team, tcx, tcy, dir]) => {
    ctx.save(); glow(ctx, tcx, tcy, cs * 0.95, C.violet, 0.28); ctx.restore();
    crest(ctx, team, tcx - cs / 2, tcy - cs / 2, cs, imgs, { r: cs * 0.2 });
    const nx = dir === 'ltr' ? tcx + cs / 2 + 34 : tcx - cs / 2 - 34;
    txtFit(ctx, team.name, {
      x: nx, cy: tcy, size: nameSize, minSize: 44, maxLines: 2, fam: 'display', color: C.white,
      align: dir === 'ltr' ? 'left' : 'right', upper: true, tracking: 1.5,
      maxW: dir === 'ltr' ? cz.x + cz.w - 24 - nx : nx - cz.x - 24,
      glowColor: hexa(C.violetLite, 0.5), glowBlur: 26,
    });
  });
  txt(ctx, 'VS', {
    x: cxm, y: midY + 2, size: bandT * 0.66, fam: 'head', weight: 600, color: C.white,
    align: 'center', baseline: 'middle', tracking: 3, glowColor: hexa(C.violet, 0.9), glowBlur: 26,
  });

  const cells = [['Fecha', m.date ?? 'A confirmar', !m.date], ['Hora', m.time ?? 'A confirmar', !m.time]];
  if (m.venue) cells.push(['Sede', m.venue, false]);
  infoBar(ctx, box.x, infoY, box.w, infoH, cells);
}

/** One match → the flagship event poster. Several → a scalable Finales listing. */
export function final(ctx, g, d, imgs) {
  if (d.matches.length === 1) { finalHero(ctx, g, d, imgs); return; }
  const box = chrome(ctx, g, imgs, { kicker: d.category, title: 'Finales', ...brand(d) });
  const ms = d.matches.slice(0, 4);
  const tall = g.id === '9:16';
  const cap = ms.length === 2 ? (tall ? 545 : 385) : (tall ? 360 : 262);
  const L = rowLayout(box, ms.length, { min: 150, max: cap, gap: tall ? 26 : 20 });
  let y = L.y;
  ms.forEach((m, i) => {
    knockoutRow(ctx, m, `Final ${i + 1}`, box.x, y, box.w, L.h, imgs);
    y += L.h + L.gap;
  });
}

/* ------------------------------------------------------------ 13. champion */

export function campeon(ctx, g, d, imgs) {
  const box = chrome(ctx, g, imgs, { title: null, ...brand(d) });
  const tall = g.id === '9:16';
  const cs = Math.min(g.w * (tall ? 0.46 : 0.38), tall ? 430 : 328);
  const titleSize = tall ? 212 : 168;
  const gapCT = tall ? 150 : 120;
  const gapTP = tall ? 58 : 44;
  const plateH = tall ? 92 : 78;
  const blockH = cs + gapCT + titleSize * 0.74 + gapTP + plateH + 64;
  const free = Math.max(26, box.h - blockH);
  const cy = box.y + free * (tall ? 0.60 : 0.5) + cs / 2;
  const cxm = g.W / 2;

  // celebratory light column
  ctx.save();
  const beam = ctx.createLinearGradient(0, box.y, 0, box.y + box.h);
  beam.addColorStop(0, hexa(C.violet, 0.17));
  beam.addColorStop(0.55, hexa(C.violet, 0.05));
  beam.addColorStop(1, hexa(C.violet, 0));
  ctx.fillStyle = beam;
  ctx.beginPath();
  ctx.moveTo(cxm - cs * 0.52, box.y - 40); ctx.lineTo(cxm + cs * 0.52, box.y - 40);
  ctx.lineTo(cxm + cs * 1.25, box.y + box.h); ctx.lineTo(cxm - cs * 1.25, box.y + box.h);
  ctx.closePath(); ctx.fill();
  ctx.restore();

  ctx.save();
  glow(ctx, cxm, cy, g.W * 0.92, C.violet, 0.26);
  ctx.restore();

  // radiating rays
  ctx.save();
  ctx.translate(cxm, cy);
  for (let i = 0; i < 24; i++) {
    ctx.save();
    ctx.rotate((i / 24) * Math.PI * 2 + 0.13);
    ctx.fillStyle = hexa(i % 2 ? C.violetLite : C.violet, i % 2 ? 0.11 : 0.06);
    ctx.fillRect(cs * 0.66, -(i % 2 ? 3 : 6), (200 + (i % 4) * 120) * (tall ? 1.5 : 1), i % 2 ? 6 : 12);
    ctx.restore();
  }
  ctx.restore();

  // crest is the hero: light and glow only, no frame
  ctx.save();
  glow(ctx, cxm, cy, cs * 1.05, C.violetLite, 0.30);
  ctx.restore();
  crest(ctx, d.team, cxm - cs / 2, cy - cs / 2, cs, imgs, { r: cs * 0.18 });

  const ty = cy + cs / 2 + gapCT + titleSize * 0.74;

  // flanking sport bars
  ctx.save();
  const barY = ty - titleSize * 0.36;
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = hexa(i ? C.violetLite : C.violet, 0.65 - i * 0.18);
    para(ctx, g.x + 4 + i * 22, barY - titleSize * 0.24, 9 - i * 2, titleSize * 0.5, titleSize * 0.18); ctx.fill();
    para(ctx, g.x + g.w - 13 - i * 22, barY - titleSize * 0.24, 9 - i * 2, titleSize * 0.5, titleSize * 0.18); ctx.fill();
  }
  ctx.restore();

  txt(ctx, 'Campeón', {
    x: cxm, y: ty, size: titleSize, fam: 'display', color: C.white,
    align: 'center', upper: true, maxW: g.w - 120, tracking: 3,
    glowColor: hexa(C.violetLite, 0.75), glowBlur: 46,
  });

  // team name: a plate only while the name genuinely fits one line
  const nameSize = tall ? 58 : 50;
  const nf = fitLines(ctx, d.team.name, {
    size: nameSize, minSize: 34, maxW: g.w - 130, maxLines: 2,
    fam: 'head', weight: 600, tracking: 3, upper: true,
  });
  const plateY = ty + gapTP;
  let nameBottom;
  if (nf.lines.length === 1) {
    const plateW = Math.min(g.w, measure(ctx, d.team.name, { size: nf.size, weight: 600, tracking: 3, upper: true }) + 92);
    panel(ctx, cxm - plateW / 2, plateY, plateW, plateH, {
      fill: hexa(C.violet, 0.26), fill2: hexa(C.violetDeep, 0.85), r: 10, cut: 24,
      border: hexa(C.violetLite, 0.55), topLight: 0.24, sheen: 0.12, shadow: 24,
    });
    txt(ctx, d.team.name, {
      x: cxm, y: plateY + plateH * 0.70, size: nf.size, fam: 'head', weight: 600, color: C.white,
      align: 'center', upper: true, tracking: 3, maxW: plateW - 44,
    });
    nameBottom = plateY + plateH;
  } else {
    const lh = nf.size * 1.16;
    nf.lines.forEach((l, i) => txt(ctx, l, {
      x: cxm, y: plateY + nf.size * 0.86 + i * lh, size: nf.size, fam: 'head', weight: 600,
      color: C.white, align: 'center', upper: true, tracking: 3, maxW: g.w - 130, minSize: nf.size,
      glowColor: hexa(C.violetLite, 0.45), glowBlur: 22,
    }));
    nameBottom = plateY + nf.size * 0.86 + lh * (nf.lines.length - 1) + 22;
    const rw = Math.min(160, g.w * 0.2);
    line(ctx, cxm - rw / 2, nameBottom, cxm + rw / 2, nameBottom, hexa(C.violet, 0.85), 3);
  }
  txt(ctx, d.category, {
    x: cxm, y: nameBottom + 52, size: 22, fam: 'head', weight: 400, color: C.violetLite,
    align: 'center', upper: true, tracking: 4.5, maxW: g.w - 60,
  });
}

/* ------------------------------------------------------------------ index */

export const PIECES = [
  { id: 'resultados', label: 'Resultados de la fecha', render: resultados },
  { id: 'proximos', label: 'Próxima fecha', render: proximos },
  { id: 'figura', label: 'Figura de la fecha', render: figura },
  { id: 'equipo', label: 'Equipo de la fecha', render: equipo },
  { id: 'tabla', label: 'Tabla de posiciones', render: tabla },
  { id: 'goleadores', label: 'Goleadores', render: goleadores },
  { id: 'sancionados', label: 'Sancionados', render: sancionados },
  { id: 'resumen', label: 'Resumen de la fecha', render: resumen },
  { id: 'semis', label: 'Semifinales', render: semis },
  { id: 'final', label: 'Final', render: final },
  { id: 'campeon', label: 'Campeón', render: campeon },
];
