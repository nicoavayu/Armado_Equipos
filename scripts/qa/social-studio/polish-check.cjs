// Estudio Social polish certification (real Chromium, real renderers): the studio layout at six widths, the Premium
// preview lock of FREE seasons and the top anchoring of sparse pieces in every style and format.
// Build first: `node scripts/qa/social-studio/build.cjs`. Then `POLISH_LABEL=after node scripts/qa/social-studio/polish-check.cjs`.
// Evidence (metrics + screenshots) goes to artifacts/social-studio/polish/<label>/. POLISH_STRICT=1 fails on the
// first deviation (the certification of the polish PR); without it the run only measures (the audit of main).
const { chromium, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { start } = require('./serve.cjs');

const ROOT = path.resolve(__dirname, '../../..');
const LABEL = process.env.POLISH_LABEL || 'run';
const OUT = path.join(ROOT, 'artifacts/social-studio/polish', LABEL);
const STRICT = process.env.POLISH_STRICT === '1';
const ONLY = (process.env.POLISH_ONLY || '').split(',').filter(Boolean);
const want = (section) => !ONLY.length || ONLY.includes(section);
const ALLOWED_REMOTE = new Set(['fonts.gstatic.com', 'fonts.googleapis.com']);
const WIDTHS = [[320, 740], [390, 844], [540, 900], [700, 900], [1024, 768], [1440, 1000]];
const STYLES = ['Base', 'Heritage', 'Street', 'Scoreboard', 'Editorial'];
const FORMATS = [['Feed 4:5', 'feed'], ['Historia 9:16', 'story']];
// The pieces whose amount of content varies: lists, tables, brackets and rankings.
const SPARSE_PIECES = [
  ['round_results', 'Resultados de la fecha'], ['next_fixture', 'Próxima fecha'], ['standings', 'Tabla de posiciones'],
  ['scorers', 'Goleadores'], ['discipline', 'Sancionados'], ['semifinals', 'Semifinales'], ['round_summary', 'Resumen de fecha'],
];
// Sparse: what a small league really publishes. Dense: a full round. The anchor must not move between them.
const SPARSE = 'rows=2&matches=2&scorers=2&discipline=2&semis=2';
const SPARSER = 'rows=2&matches=1&scorers=1&discipline=1&semis=1';
// The same layouts filled to the capacity they were drawn for (4:5 tables switch layout above 8 rows, results above 4).
const FULL_FEED = 'rows=8&matches=4&scorers=8&discipline=8&semis=2';
const FULL_STORY = 'rows=12&matches=4&scorers=10&discipline=10&semis=2';
const report = { label: LABEL, strict: STRICT, startedAt: new Date().toISOString(), layout: [], anchoring: [], lock: [], failures: [] };
fs.mkdirSync(OUT, { recursive: true });

function fail(message, detail = {}) {
  report.failures.push({ message, ...detail });
  if (STRICT) throw new Error(`${message} ${JSON.stringify(detail)}`);
}

// ── page helpers (same network contract as browser-check.cjs) ─────────────────────────────────────────────────────
// A download runs through the route of the context that asked first, so it dies with that context: closed early (a
// section that ends on another page with a font still on its way), the next context asking for the same file must not
// inherit that failure (its page would log "Failed to load resource" for a font that is fine) and downloads it again
// through its own route. A real network failure still fails the page.
const fontCache = new Map();
const sessionClosed = (error) => /has been closed|has been disposed/.test(error?.message || '');
function downloadFont(route, url) {
  return (async () => {
    let lastError = null;
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      try {
        const response = await route.fetch({ timeout: 15000 });
        if (response.ok()) {
          const headers = response.headers();
          return {
            status: response.status(),
            body: await response.body(),
            headers: Object.fromEntries(['content-type', 'access-control-allow-origin', 'timing-allow-origin']
              .filter((name) => headers[name]).map((name) => [name, headers[name]])),
          };
        }
        lastError = new Error(`HTTP ${response.status()}`);
      } catch (error) {
        lastError = error;
        // Its session is gone: retrying through its route can only fail again.
        if (sessionClosed(error)) break;
      }
      await new Promise((resolve) => { setTimeout(resolve, 750 * attempt); });
    }
    throw new Error(`font ${url}: ${lastError?.message}`);
  })();
}
async function serveFont(route) {
  const url = route.request().url();
  let entry = fontCache.get(url);
  if (!entry) {
    entry = { route, font: downloadFont(route, url) };
    fontCache.set(url, entry);
  }
  let font;
  try {
    font = await entry.font;
  } catch (error) {
    if (fontCache.get(url) === entry) fontCache.delete(url);
    // Another context's download died with that context: this one downloads the font again through its own route.
    if (entry.route !== route) return serveFont(route);
    return route.abort().catch(() => {});
  }
  // This context may close while the font is on its way: then there is no page left to answer.
  return route.fulfill(font).catch(() => {});
}
async function open(browser, base, query, viewport, device = {}) {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce', ...device });
  const page = await context.newPage();
  const errors = []; const remote = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Download the React DevTools/.test(m.text())) errors.push(m.text()); });
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin === base) return route.continue();
    if (ALLOWED_REMOTE.has(url.hostname)) return serveFont(route);
    remote.push(url.href); return route.abort();
  });
  await page.goto(`${base}/?${query}`);
  await expect(page.getByRole('heading', { name: 'Estudio Social', exact: true })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('plan de la temporada')).toBeVisible({ timeout: 15000 });
  return { page, context, errors, remote };
}
async function close({ context, errors, remote }, label) {
  await context.close();
  const appErrors = errors.filter((e) => !/fonts\.(gstatic|googleapis)/.test(e));
  if (appErrors.length || remote.length) fail(`${label}: page errors or remote requests`, { errors: appErrors, remote });
}
// The controls are queried by role and name only, so the same check reads the old chips and any new control.
async function choose(page, group, label) {
  const radio = page.getByRole('radiogroup', { name: group }).getByRole('radio', { name: new RegExp(`^${label}`) });
  // On one column the pieces fold into one line that opens them.
  if (group === 'Plantilla') await openPieces(page);
  if (await radio.count()) { await radio.first().click(); return; }
  const select = page.getByRole('combobox', { name: group });
  if (await select.count()) {
    const value = await select.evaluate((el, wanted) => [...el.options].find((o) => o.textContent.trim().startsWith(wanted))?.value, label);
    await select.selectOption(value);
    return;
  }
  throw new Error(`no control "${group}" with "${label}"`);
}
async function previewReady(page, piece, format, style) {
  await page.waitForFunction(({ piece: p, format: f, style: s }) => {
    const surface = document.querySelector('[role="img"][aria-label^="Vista previa"]');
    const label = surface?.getAttribute('aria-label') || '';
    const stage = surface?.closest('section');
    return label.includes(`de ${p} en ${f}`) && label.endsWith(`estilo ${s}`) && !/Generando/.test(stage?.innerText || '');
  }, { piece, format, style }, { timeout: 30000 });
  await page.waitForTimeout(150);
}

async function openPieces(page) {
  const grid = page.getByRole('radiogroup', { name: 'Plantilla' });
  if (await grid.isVisible()) return false;
  await page.getByRole('group', { name: 'Pieza' }).getByRole('button').click();
  await grid.waitFor({ state: 'visible' });
  return true;
}

// ── 1. layout at six widths ──────────────────────────────────────────────────────────────────────────────────────
function measureLayout() {
  const doc = document.documentElement;
  const controls = document.querySelector('section[aria-label="Configuración de la pieza"]');
  const previewPanel = document.querySelector('section[aria-label="Vista previa"]');
  const surface = previewPanel?.querySelector('[role="img"]');
  const rect = (el) => el.getBoundingClientRect();
  const cr = controls ? rect(controls) : null;
  const visible = (el) => { const r = rect(el); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  // Anything poking out of its own group box, or out of the controls column.
  const outside = [];
  for (const group of controls ? controls.querySelectorAll('fieldset, [role="radiogroup"]') : []) {
    const box = rect(group);
    for (const el of group.querySelectorAll('button, select, input, label, [role="radio"], small, span')) {
      if (!visible(el)) continue;
      const r = rect(el);
      if (r.right > box.right + 1 || r.left < box.left - 1) {
        outside.push({ group: group.getAttribute('aria-label') || group.querySelector('legend')?.innerText || group.tagName, el: (el.innerText || el.getAttribute('aria-label') || el.tagName).slice(0, 40), right: Math.round(r.right - box.right) });
      }
    }
  }
  const groups = controls ? [...controls.children].filter(visible).map((el) => ({
    name: (el.querySelector('legend')?.innerText || el.getAttribute('aria-label') || el.tagName).replace(/\s+/g, ' ').slice(0, 30),
    height: Math.round(rect(el).height),
  })) : [];
  // A chip whose short name does not fit inside it (it would spill over its border or its neighbour).
  const chipOverflow = [...document.querySelectorAll('[role="radiogroup"][aria-label="Plantilla"] [role="radio"], [role="radiogroup"][aria-label="Formato"] [role="radio"]')]
    .filter((b) => visible(b) && b.scrollWidth > b.clientWidth + 1).map((b) => `${b.getAttribute('aria-label')} ${b.scrollWidth}>${b.clientWidth}`);
  const stage = surface?.parentElement?.parentElement || surface;
  return {
    viewport: [window.innerWidth, window.innerHeight],
    docOverflowX: doc.scrollWidth - doc.clientWidth,
    controlsHeight: cr ? Math.round(cr.height) : null,
    groups,
    outside: outside.slice(0, 12),
    chipOverflow,
    previewTop: stage ? Math.round(rect(stage).top + window.scrollY) : null,
    previewTopInViewports: stage ? Math.round(((rect(stage).top + window.scrollY) / window.innerHeight) * 100) / 100 : null,
    exportButtonsTop: (() => { const b = [...document.querySelectorAll('button')].find((x) => /^Descargar/.test(x.innerText.trim())); return b ? Math.round(rect(b).top + window.scrollY) : null; })(),
  };
}

// ── 2. anchoring of sparse pieces ───────────────────────────────────────────────────────────────────────────────
// Locates every official item of the piece on the rendered art and reports, in 1080-wide art pixels, where the first
// row starts, how tall the rows are and how far apart, plus the title's bottom edge (the header the rows hang from).
function measureAnchoring() {
  const surface = document.querySelector('[role="img"][aria-label^="Vista previa"]');
  const snapshot = window.__social.lastSnapshot;
  if (!surface || !snapshot) return { error: 'no surface or snapshot' };
  const sr = surface.getBoundingClientRect();
  const scale = sr.width / 1080;
  const art = (r) => ({ top: Math.round((r.top - sr.top) / scale), bottom: Math.round((r.bottom - sr.top) / scale), height: Math.round(r.height / scale) });
  if (surface.tagName === 'CANVAS') return { kind: 'canvas', artHeight: Math.round(sr.height / scale) };
  const official = snapshot.official || {};
  const piece = snapshot.piece;
  // The discipline table lists each player's club; its recap of suspended players (lower on the art) lists players.
  const items = (piece === 'standings' ? (official.rows || []).map((r) => [r.teamName || r.name])
    : piece === 'scorers' ? (official.players || []).map((p) => [p.name])
      : piece === 'discipline' ? (official.players || []).map((p) => [p.team?.name || p.teamName || p.name])
        : (official.matches || []).map((m) => [m.home?.name, m.away?.name]));
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const all = [...surface.querySelectorAll('*')];
  const leafFor = (keys) => {
    const ks = keys.map(norm).filter(Boolean);
    let best = null;
    // On equal text the deepest element wins (a frame holding a single card reads exactly like the card).
    for (const el of all) {
      const t = norm(el.textContent);
      if (!ks.every((k) => t.includes(k))) continue;
      const bestLength = best ? norm(best.textContent).length : Infinity;
      if (t.length < bestLength || (t.length === bestLength && best.contains(el))) best = el;
    }
    if (best) return best;
    // Abbreviated names: the longest word of each name.
    const words = keys.map((k) => String(k || '').split(/\s+/).sort((a, b) => b.length - a.length)[0]).map(norm).filter(Boolean);
    for (const el of all) {
      const t = norm(el.textContent);
      if (words.every((k) => t.includes(k)) && (!best || t.length < norm(best.textContent).length)) best = el;
    }
    return best;
  };
  const leaves = items.map(leafFor);
  const found = leaves.filter(Boolean);
  if (!found.length) return { error: 'rows not found', items: items.length };
  // Rows: hardened rows when the layout marked them, otherwise the children of the leaves' common parent.
  let rows = [...surface.querySelectorAll('[data-premium-row]')];
  if (rows.length < found.length) {
    const holdsAll = (candidate) => found.every((leaf) => candidate.contains(leaf));
    let parent = found[0].parentElement;
    while (parent && !holdsAll(parent)) parent = parent.parentElement;
    rows = found.length > 1 && parent
      ? found.map((leaf) => { let n = leaf; while (n.parentElement && n.parentElement !== parent) n = n.parentElement; return n; })
      : found;
  }
  const rowBoxes = rows.map((r) => art(r.getBoundingClientRect()));
  // The title: the biggest type in the upper half of the art.
  let title = null; let titleSize = 0;
  for (const el of all) {
    if (el.children.length || !el.textContent.trim()) continue;
    const r = el.getBoundingClientRect();
    if ((r.top - sr.top) / scale > (sr.height / scale) * 0.5) continue;
    const size = Number.parseFloat(getComputedStyle(el).fontSize);
    if (size > titleSize) { titleSize = size; title = el; }
  }
  // The footer: the lowest text on the art. Anchoring the body must never pull it up.
  let footerBottom = 0;
  for (const el of all) {
    if (el.children.length || !el.textContent.trim()) continue;
    footerBottom = Math.max(footerBottom, art(el.getBoundingClientRect()).bottom);
  }
  const frame = (() => {
    let n = rows[0]?.parentElement;
    while (n && n !== surface) {
      const s = getComputedStyle(n);
      if (s.display === 'flex' && s.flexDirection === 'column' && Number.parseFloat(s.flexGrow) > 0) return { justify: s.justifyContent, align: s.alignContent };
      n = n.parentElement;
    }
    return null;
  })();
  return {
    kind: 'dom',
    items: items.length,
    located: found.length,
    titleBottom: title ? art(title.getBoundingClientRect()).bottom : null,
    firstRowTop: rowBoxes[0]?.top ?? null,
    firstLeafTop: found[0] ? art(found[0].getBoundingClientRect()).top : null,
    lastRowBottom: rowBoxes.at(-1)?.bottom ?? null,
    rowHeights: rowBoxes.map((b) => b.height),
    pitch: rowBoxes.length > 1 ? Math.round((rowBoxes.at(-1).top - rowBoxes[0].top) / (rowBoxes.length - 1)) : null,
    artHeight: Math.round(sr.height / scale),
    footerBottom,
    frame,
  };
}

// ── 3. the Premium lock of FREE previews ────────────────────────────────────────────────────────────────────────
// What a FREE season may download is shown clean; Premium art (a Premium style or a Premium piece) is a teaser under
// the veil, and no file is offered. PREMIUM never sees the veil.
const LOCK_CASES = [
  ['free', 'Tabla de posiciones', 'Heritage', true],
  ['free', 'Tabla de posiciones', 'Street', true],
  ['free', 'Tabla de posiciones', 'Scoreboard', true],
  ['free', 'Tabla de posiciones', 'Editorial', true],
  ['free', 'Goleadores', 'Base', true],
  ['free', 'Resultados de la fecha', 'Base', false],
  ['free', 'Tabla de posiciones', 'Base', false],
  ['free', 'Próxima fecha', 'Base', false],
  ['premium', 'Goleadores', 'Heritage', false],
  ['premium', 'Tabla de posiciones', 'Editorial', false],
];
function measureLock() {
  const panel = document.querySelector('section[aria-label="Vista previa"]');
  const stage = panel?.querySelector('[data-format]');
  const surface = panel?.querySelector('[role="img"][aria-label^="Vista previa"]');
  const veil = stage?.querySelector(':scope > [aria-hidden="true"]') || null;
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
  const art = box(surface);
  // What a tap, a long press or a right click on the art reaches: the veil, never the art under it.
  const hit = art ? document.elementFromPoint(art.x + art.w / 2, art.y + art.h / 2) : null;
  let contextMenuBlocked = null;
  if (veil) {
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    veil.dispatchEvent(event);
    contextMenuBlocked = event.defaultPrevented;
  }
  const buttons = [...document.querySelectorAll('button')].filter((b) => b.offsetParent).map((b) => b.innerText.trim());
  return {
    locked: stage?.dataset.premiumLocked === 'true',
    veil: box(veil),
    art,
    badge: veil?.firstElementChild ? getComputedStyle(veil.firstElementChild, '::after').content : null,
    lockIcon: Boolean(veil?.querySelector('svg')),
    watermark: veil ? getComputedStyle(veil).backgroundImage.includes('PREMIUM') : false,
    pointerOnVeil: Boolean(veil && hit && veil.contains(hit)),
    contextMenuBlocked,
    download: buttons.some((text) => /^Descargar/.test(text)),
    share: buttons.includes('Compartir'),
  };
}

async function shoot(page, file) {
  const surface = page.locator('[role="img"][aria-label^="Vista previa"]').first();
  const box = await surface.boundingBox();
  if (box) await page.screenshot({ path: path.join(OUT, file), clip: box });
}

(async () => {
  const server = await start(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  const classic = await chromium.launch({ headless: true, ignoreDefaultArgs: ['--hide-scrollbars'] });
  try {
    if (want('layout')) {
      for (const plan of ['free', 'premium']) {
        for (const [width, height] of WIDTHS) {
          const phone = width <= 540;
          const session = await open(phone ? browser : classic, base, `plan=${plan}`, { width, height }, phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {});
          const { page } = session;
          await previewReady(page, 'Tabla de posiciones', 'Feed 4:5', 'Base');
          const metrics = await page.evaluate(measureLayout);
          await page.screenshot({ path: path.join(OUT, `layout-${plan}-${width}.png`), fullPage: true });
          // Folded pieces: their chips are measured open (fit, nothing outside its group), then folded again.
          if (await openPieces(page)) {
            const opened = await page.evaluate(measureLayout);
            await page.screenshot({ path: path.join(OUT, `layout-${plan}-${width}-pieces-open.png`), fullPage: true });
            metrics.piecesFolded = true;
            metrics.openedControlsHeight = opened.controlsHeight;
            metrics.outside.push(...opened.outside);
            metrics.chipOverflow.push(...opened.chipOverflow);
            await page.getByRole('group', { name: 'Pieza' }).getByRole('button').click();
          }
          report.layout.push({ plan, width, ...metrics });
          if (metrics.controlsHeight > height / 2) fail(`the controls take more than half the screen at ${width}`, { plan, controlsHeight: metrics.controlsHeight, height });
          if (metrics.docOverflowX > 0) fail(`horizontal overflow at ${width}`, { plan, docOverflowX: metrics.docOverflowX });
          if (metrics.outside.length) fail(`controls outside their group at ${width}`, { plan, outside: metrics.outside });
          if (metrics.chipOverflow.length) fail(`a chip label does not fit at ${width}`, { plan, chips: metrics.chipOverflow });
          await close(session, `layout ${plan} ${width}`);
        }
      }
    }
    if (want('lock')) {
      const devices = [['desktop', { width: 1440, height: 1000 }, {}], ['phone', { width: 390, height: 844 }, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]];
      for (const [deviceName, viewport, device] of devices) {
        for (const plan of ['free', 'premium']) {
          const session = await open(browser, base, `plan=${plan}`, viewport, device);
          const { page } = session;
          for (const [casePlan, pieceLabel, style, locked] of LOCK_CASES) {
            if (casePlan !== plan) continue;
            await choose(page, 'Plantilla', pieceLabel);
            await choose(page, 'Estilo', style);
            await previewReady(page, pieceLabel, 'Feed 4:5', style);
            await page.locator('[role="img"][aria-label^="Vista previa"]').first().scrollIntoViewIfNeeded();
            const metrics = await page.evaluate(measureLock);
            const where = { plan, device: deviceName, piece: pieceLabel, style };
            report.lock.push({ ...where, expectLocked: locked, ...metrics });
            await page.locator('section[aria-label="Vista previa"]').screenshot({ path: path.join(OUT, `lock-${deviceName}-${plan}-${pieceLabel.replace(/\s+/g, '_')}-${style}.png`) });
            const near = (p, q) => Math.abs(p - q) <= 1.5;
            if (locked) {
              const covers = metrics.veil && metrics.art && near(metrics.veil.x, metrics.art.x) && near(metrics.veil.y, metrics.art.y)
                && near(metrics.veil.w, metrics.art.w) && near(metrics.veil.h, metrics.art.h);
              if (!metrics.locked || !covers) fail('a Premium preview is not covered by the veil', { ...where, veil: metrics.veil, art: metrics.art });
              if (!/PREMIUM/.test(metrics.badge || '') || !metrics.lockIcon || !metrics.watermark) fail('the veil lacks its lock, badge or watermark', { ...where, badge: metrics.badge, lockIcon: metrics.lockIcon, watermark: metrics.watermark });
              if (!metrics.pointerOnVeil || metrics.contextMenuBlocked !== true) fail('the art under the veil can be reached', { ...where, pointerOnVeil: metrics.pointerOnVeil, contextMenuBlocked: metrics.contextMenuBlocked });
              if (metrics.download || metrics.share) fail('a Premium preview offers a file', { ...where, download: metrics.download, share: metrics.share });
            } else {
              if (metrics.locked || metrics.veil) fail('an allowed preview carries the veil', where);
              if (!metrics.download || !metrics.share) fail('an allowed preview does not offer its file', { ...where, download: metrics.download, share: metrics.share });
            }
          }
          await close(session, `lock ${plan} ${deviceName}`);
        }
      }
    }
    if (want('anchoring')) {
      for (const [setName, query] of [['sparse', SPARSE], ['sparser', SPARSER], ['full-feed', FULL_FEED], ['full-story', FULL_STORY]]) {
        const session = await open(browser, base, `plan=premium&${query}`, { width: 1440, height: 1000 }, { deviceScaleFactor: 2 });
        const { page } = session;
        for (const [, pieceLabel] of SPARSE_PIECES) {
          await choose(page, 'Plantilla', pieceLabel);
          for (const [formatLabel, formatId] of FORMATS) {
            await choose(page, 'Formato', formatLabel);
            for (const style of STYLES) {
              await choose(page, 'Estilo', style);
              await previewReady(page, pieceLabel, formatLabel, style);
              const metrics = await page.evaluate(measureAnchoring);
              report.anchoring.push({ set: setName, piece: pieceLabel, format: formatId, style, ...metrics });
              if (!setName.startsWith('full') || formatId === setName.slice(5)) await shoot(page, `anchor-${setName}-${pieceLabel.replace(/\s+/g, '_')}-${style}-${formatId}.png`);
            }
          }
        }
        await close(session, `anchoring ${setName}`);
      }
      // Rule: a sparse piece starts where the same layout starts when full (same gap under the title), and no item is
      // stretched beyond the rhythm of the full list. With one item the item's own text is compared (it sits inside a
      // row whose height may differ), so the tolerance grows by half the row-height difference.
      for (const sparse of report.anchoring.filter((r) => !r.set.startsWith('full') && r.kind === 'dom')) {
        const full = report.anchoring.find((r) => r.set === `full-${sparse.format}` && r.piece === sparse.piece && r.format === sparse.format && r.style === sparse.style);
        if (!full || full.kind !== 'dom') continue;
        const single = sparse.items === 1;
        const mine = single ? sparse.firstLeafTop : sparse.firstRowTop;
        const theirs = single ? full.firstLeafTop : full.firstRowTop;
        if (mine == null || theirs == null) continue;
        sparse.anchorShift = mine - theirs;
        const rowDelta = Math.max(0, (sparse.rowHeights?.[0] || 0) - (full.rowHeights?.[0] || 0));
        sparse.tolerance = 24 + (single ? Math.ceil(rowDelta / 2) : 0);
        sparse.fullRowHeight = full.rowHeights?.[0] ?? null;
        if (Math.abs(sparse.anchorShift) > sparse.tolerance) fail('sparse piece does not start where the full one does', { piece: sparse.piece, style: sparse.style, format: sparse.format, set: sparse.set, shift: sparse.anchorShift, tolerance: sparse.tolerance });
        const stretched = !single && sparse.rowHeights?.[0] > Math.max(1.6 * (full.rowHeights?.[0] || 0), (full.rowHeights?.[0] || 0) + 48);
        if (Math.abs((sparse.footerBottom || 0) - (full.footerBottom || 0)) > 4) fail('the footer moved', { piece: sparse.piece, style: sparse.style, format: sparse.format, set: sparse.set, footer: sparse.footerBottom, full: full.footerBottom });
        if (stretched) fail('sparse items stretched beyond the full rhythm', { piece: sparse.piece, style: sparse.style, format: sparse.format, rows: sparse.rowHeights, full: full.rowHeights?.[0] });
      }
    }
  } finally {
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(OUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    await browser.close();
    await classic.close();
    server.close();
  }
  console.log(JSON.stringify({ result: report.failures.length ? 'POLISH_DEVIATIONS' : 'POLISH_PASS', label: LABEL, layout: report.layout.length, lock: report.lock.length, anchoring: report.anchoring.length, failures: report.failures.length }));
  if (STRICT && report.failures.length) process.exitCode = 1;
})().catch((error) => { console.error(error); process.exitCode = 1; });
