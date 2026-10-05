// SOCIAL-V1 browser certification of the Estudio Social (real Chromium, real renderers, real PNG export).
// Build first: `node scripts/qa/social-studio/build.cjs`. Then `node scripts/qa/social-studio/browser-check.cjs`.
// It serves the offline fixture itself on an ephemeral loopback port, so no other worktree's server is ever measured.
//
// Fails on the first deviation. Network: only this server and the Google Fonts faces the app itself uses
// (src/styles.css); anything else is recorded and fails the run. Evidence: artifacts/social-studio/evidence.json.
//
// SOCIAL_QA_PROFILE=ci is the deterministic subset the Prelaunch Quality Gate runs on every PR (`npm run
// test:torneos:social:browser`): Social OFF, FREE, PREMIUM (every style, both formats), branding, real exports,
// Editorial pages and the phone layouts at 390 and 320 px. Without it (the certification before gate A) every
// section runs in full: 11 pieces × 5 styles × 2 formats, Figura, Equipo ideal 5–11 and six widths.
const { chromium, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { start } = require('./serve.cjs');

const ROOT = path.resolve(__dirname, '../../..');
const OUT = path.join(ROOT, 'artifacts/social-studio');
const DOWNLOADS = path.join(OUT, 'downloads');
const ALLOWED_REMOTE = new Set(['fonts.gstatic.com', 'fonts.googleapis.com']);
const PIECES = [
  ['round_results', 'Resultados de la fecha'], ['next_fixture', 'Próxima fecha'], ['standings', 'Tabla de posiciones'],
  ['scorers', 'Goleadores'], ['discipline', 'Sancionados'], ['best_eleven', 'Equipo de la fecha'], ['mvp', 'Figura'],
  ['round_summary', 'Resumen de fecha'], ['semifinals', 'Semifinales'], ['final', 'Final'], ['champion', 'Campeón'],
];
const FREE_PIECES = ['round_results', 'next_fixture', 'standings'];
const STYLES = ['Base', 'Heritage', 'Street', 'Scoreboard', 'Editorial'];
const FORMATS = [['Feed 4:5', 'feed-4x5', 1080, 1350], ['Historia 9:16', 'historia-9x16', 1080, 1920]];
// SOCIAL_QA_ONLY=premium,figura runs a subset while iterating; a certification run sets nothing (all sections).
const ONLY = (process.env.SOCIAL_QA_ONLY || '').split(',').filter(Boolean);
const want = (section) => !ONLY.length || ONLY.includes(section);
const CI = process.env.SOCIAL_QA_PROFILE === 'ci';
const PROFILE = {
  premiumPieces: CI ? ['standings', 'mvp', 'best_eleven'] : PIECES.map(([id]) => id),
  figuraStyles: CI ? ['Base'] : ['Base', 'Heritage'],
  teamSizes: CI ? [] : [5, 6, 7, 8, 9, 11],
  editorialRows: CI ? [[16, 2]] : [[16, 2], [24, 2]],
  // [width, height]: real phones first, so a regression there fails fast.
  widths: CI ? [[320, 740], [390, 844]] : [[320, 740], [390, 844], [540, 900], [700, 900], [1024, 768], [1440, 1000]],
};
const evidence = { startedAt: new Date().toISOString(), profile: CI ? 'ci' : 'full', sections: ONLY.length ? ONLY : 'all', exports: [], checks: [] };
const check = (name, detail = {}) => evidence.checks.push({ name, ...detail });

// ── PNG inspection ──────────────────────────────────────────────────────────────────────────────────────────────
function inspectPng(buffer) {
  if (buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('not a PNG');
  const chunks = [];
  for (let offset = 8; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    chunks.push({ type, data: buffer.subarray(offset + 8, offset + 8 + length) });
    offset += 12 + length;
  }
  const ihdr = chunks.find((c) => c.type === 'IHDR').data;
  const text = chunks.filter((c) => /^(tEXt|iTXt|zTXt|eXIf)$/.test(c.type)).map((c) => c.data.toString('latin1')).join(' ');
  return { width: ihdr.readUInt32BE(0), height: ihdr.readUInt32BE(4), types: chunks.map((c) => c.type), text, bytes: buffer.length };
}
function assertCleanPng(buffer, width, height, label) {
  const info = inspectPng(buffer);
  if (info.width !== width || info.height !== height) throw new Error(`${label}: ${info.width}x${info.height}, expected ${width}x${height}`);
  // No credential, URL or storage path may travel inside the file.
  if (/https?:|token|bearer|supabase|apikey|eyJ/i.test(info.text)) throw new Error(`${label}: metadata leaks ${info.text.slice(0, 80)}`);
  const raw = buffer.toString('latin1');
  for (const leak of ['https://', 'Bearer ', 'supabase.co', 'apikey', 'access_token']) if (raw.includes(leak)) throw new Error(`${label}: contains ${leak}`);
  // A blank 1080 px canvas compresses to a few KB: a real piece is far larger.
  if (info.bytes < 12000) throw new Error(`${label}: suspiciously small PNG (${info.bytes} bytes)`);
  return info;
}

// A synthetic portrait for the Figura local photo (no network, no Multimedia).
function writeTestPhoto(file) {
  const width = 600; const height = 800;
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x += 1) {
      const inHead = (x - 300) ** 2 + (y - 260) ** 2 < 110 ** 2;
      const inBody = y > 420 && Math.abs(x - 300) < 80 + (y - 420) * 0.6;
      row[1 + x * 3] = inHead ? 216 : inBody ? 110 : 20 + Math.round((x / width) * 60);
      row[2 + x * 3] = inHead ? 165 : inBody ? 43 : 10 + Math.round((y / height) * 40);
      row[3 + x * 3] = inHead ? 123 : inBody ? 255 : 60 + Math.round(((x + y) / (width + height)) * 120);
    }
    rows.push(row);
  }
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0); out.write(type, 4, 'latin1'); data.copy(out, 8);
    out.writeUInt32BE(zlib.crc32 ? zlib.crc32(Buffer.concat([Buffer.from(type, 'latin1'), data])) : crc32(Buffer.concat([Buffer.from(type, 'latin1'), data])), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(file, Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]));
}
function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) { crc ^= byte; for (let k = 0; k < 8; k += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ -1) >>> 0;
}

// ── page helpers ────────────────────────────────────────────────────────────────────────────────────────────────
// The Google Fonts faces are fetched once per run (with retries) and replayed to every context from memory: dozens of
// cold contexts no longer each depend on the CDN answering, so a network hiccup cannot fail the certification while
// the page still loads exactly the faces it asks for, from the same two hosts only.
const fontCache = new Map();
async function serveFont(route) {
  const url = route.request().url();
  if (!fontCache.has(url)) {
    fontCache.set(url, (async () => {
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
        } catch (error) { lastError = error; }
        await new Promise((resolve) => { setTimeout(resolve, 750 * attempt); });
      }
      throw new Error(`font ${url}: ${lastError?.message}`);
    })());
  }
  try {
    return await route.fulfill(await fontCache.get(url));
  } catch (error) {
    fontCache.delete(url);
    return route.abort();
  }
}
async function open(browser, base, query, viewport = { width: 1440, height: 1000 }, device = {}) {
  const context = await browser.newContext({ viewport, acceptDownloads: true, reducedMotion: 'reduce', ...device });
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
  // The season plan is read before anything is measured: its arrival re-renders the preview.
  if (/plan=(free|premium)/.test(query) && !/tournaments=0/.test(query)) await expect(page.getByText('plan de la temporada')).toBeVisible({ timeout: 15000 });
  return { page, context, errors, remote };
}
async function close({ context, errors, remote }, label) {
  await context.close();
  const fontErrors = errors.filter((e) => !/fonts\.(gstatic|googleapis)/.test(e));
  if (fontErrors.length || remote.length) throw new Error(`${label}: ${JSON.stringify({ errors: fontErrors, remote })}`);
}
const pieces = (page) => page.getByRole('radiogroup', { name: 'Plantilla' });
const pieceRadio = (page, label) => pieces(page).getByRole('radio', { name: new RegExp(`^${label}`) });
const styleRadio = (page, label) => page.getByRole('radiogroup', { name: 'Estilo' }).getByRole('radio', { name: new RegExp(`^${label}`) });
const preview = (page) => page.getByRole('img', { name: /^Vista previa de / });

// The page replaces the preview surface wholesale on every render: marking the current one and waiting for an
// unmarked surface proves the preview really re-rendered after an action.
async function markRender(page) {
  await page.evaluate(() => document.querySelectorAll('[role="img"][aria-label^="Vista previa"]').forEach((el) => { el.dataset.qaPrevious = '1'; }));
}
async function previewReady(page, { piece, style, format }) {
  const label = `Vista previa de ${piece} en ${format}, estilo ${style}`;
  await page.waitForFunction((expected) => {
    const surface = document.querySelector('[role="img"][aria-label^="Vista previa"]');
    const busy = [...document.querySelectorAll('[role="status"]')].some((el) => el.textContent.includes('Generando'));
    return surface && !surface.dataset.qaPrevious && surface.getAttribute('aria-label') === expected && !busy;
  }, label, { timeout: 30000 }).catch(async (error) => {
    const state = await page.evaluate(() => ({
      surface: document.querySelector('[role="img"][aria-label^="Vista previa"]')?.getAttribute('aria-label') || null,
      previous: Boolean(document.querySelector('[role="img"][aria-label^="Vista previa"]')?.dataset.qaPrevious),
      status: [...document.querySelectorAll('[role="status"], [role="alert"]')].map((el) => el.textContent.trim()),
    })).catch(() => null);
    throw new Error(`preview never became "${label}": ${JSON.stringify(state)} (${error.message.split('\n')[0]})`);
  });
}
async function selectCuration(page, id, count) {
  if (!['mvp', 'best_eleven', 'champion'].includes(id)) return false;
  const boxes = page.getByRole('group', { name: /Selección manual/ }).getByRole('checkbox');
  let changed = false;
  for (let i = 0; i < count; i += 1) if (!(await boxes.nth(i).isChecked())) { await boxes.nth(i).check(); changed = true; }
  return changed;
}
// The preview settles before anything is compared: no "Generando…" and a surface on screen (or nothing to render).
async function settled(page) {
  await page.waitForFunction(() => ![...document.querySelectorAll('[role="status"]')].some((el) => el.textContent.includes('Generando')), null, { timeout: 30000 });
  return page.evaluate(() => document.querySelector('[role="img"][aria-label^="Vista previa"]')?.getAttribute('aria-label') || null);
}
async function configure(page, { id, label, style, format, teamSize = 5 }) {
  const expected = `Vista previa de ${label} en ${format}, estilo ${style}`;
  const before = await settled(page);
  await markRender(page);
  await pieceRadio(page, label).click();
  const curationChanged = await selectCuration(page, id, id === 'best_eleven' ? teamSize : 1);
  await styleRadio(page, style).click();
  await page.getByRole('radiogroup', { name: 'Formato' }).getByRole('radio', { name: format }).click();
  // Asking for what was already on screen re-renders nothing: only a real change has to produce a new surface.
  if (before === expected && !curationChanged) {
    await page.evaluate(() => document.querySelectorAll('[role="img"][aria-label^="Vista previa"]').forEach((el) => { delete el.dataset.qaPrevious; }));
  }
  await previewReady(page, { piece: label, style, format });
}
async function download(page, label, buttonName = /^Descargar PNG$/) {
  const button = page.getByRole('button', { name: buttonName });
  await expect(button).toBeEnabled({ timeout: 30000 });
  const expected = Number((String(buttonName).match(/Descargar (\d+) PNG/) || [])[1] || 1);
  const downloads = [];
  const listener = (d) => downloads.push(d);
  page.on('download', listener);
  await button.click();
  await expect.poll(() => downloads.length, { timeout: 60000 }).toBe(expected);
  await expect(button).toBeEnabled({ timeout: 30000 });
  page.off('download', listener);
  if (downloads.length !== expected) throw new Error(`${label}: ${downloads.length} downloads, expected ${expected}`);
  const files = [];
  for (const d of downloads) {
    const target = path.join(DOWNLOADS, d.suggestedFilename());
    await d.saveAs(target);
    files.push({ name: d.suggestedFilename(), buffer: fs.readFileSync(target) });
  }
  if (!files.length) throw new Error(`${label}: no download`);
  return files;
}
// Base is a canvas: the file must be byte-for-byte the canvas on screen.
async function previewCanvasPng(page) {
  const dataUrl = await page.locator('canvas[role="img"]').evaluate((canvas) => { canvas.dataset.qaCaptured = '1'; return canvas.toDataURL('image/png'); });
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}
// The file must come from the very canvas that was captured (no re-render in between), so the comparison is fair.
async function assertSameRender(page, label) {
  if (!(await page.evaluate(() => document.querySelector('canvas[role="img"]')?.dataset.qaCaptured === '1'))) throw new Error(`${label}: the preview re-rendered between capture and export`);
}
const sha = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16);

// ── on-screen inspection ────────────────────────────────────────────────────────────────────────────────────────
// The app clips horizontal overflow globally (html { overflow-x: clip }), so scrollWidth stays equal to the viewport
// even when a control is pushed half off the screen. What counts is each element's real box: every functional part
// of the Studio must be rendered (not hidden, not 0×0), inside the layout viewport (the scrollbar excluded), not cut
// by any clipping ancestor, and the topmost element at its points once it is scrolled into view.
function inspectInPage(node) {
  const describe = (el) => `${el.tagName.toLowerCase()}${el.getAttribute('aria-label') ? `[${el.getAttribute('aria-label')}]` : ''}${el.textContent ? ` "${el.textContent.trim().slice(0, 30)}"` : ''}`;
  const problems = [];
  node.scrollIntoView({ block: 'center', inline: 'nearest' });
  // The usable width excludes every scrollbar on screen: the viewport's, and the body's if a page ever shows one again
  // (src/styles.css hides the body's dead bar, D2).
  const vw = Math.min(document.documentElement.clientWidth, document.body.clientWidth);
  const vh = window.innerHeight;
  if (typeof node.checkVisibility === 'function' && !node.checkVisibility({ opacityProperty: true, visibilityProperty: true })) problems.push('hidden');
  const r = node.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) problems.push(`${r.width}×${r.height}`);
  if (r.left < -0.5 || r.right > vw + 0.5) problems.push(`outside the screen sideways (${Math.round(r.left)}→${Math.round(r.right)} of ${vw})`);
  for (let a = node.parentElement; a && a !== document.documentElement; a = a.parentElement) {
    const cs = getComputedStyle(a);
    const clipsX = cs.overflowX !== 'visible';
    const clipsY = cs.overflowY !== 'visible' && a !== document.body;
    if (!clipsX && !clipsY) continue;
    const box = a.getBoundingClientRect();
    const left = box.left + a.clientLeft; const top = box.top + a.clientTop;
    if (clipsX && (r.left < left - 0.5 || r.right > left + a.clientWidth + 0.5)) problems.push(`cut sideways by ${describe(a)}`);
    if (clipsY && (r.top < top - 0.5 || r.bottom > top + a.clientHeight + 0.5)) problems.push(`cut vertically by ${describe(a)}`);
  }
  const points = [[0.5, 0.5], [0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8]]
    .map(([fx, fy]) => [r.left + r.width * fx, r.top + r.height * fy])
    .filter(([x, y]) => x >= 0 && y >= 0 && x < vw && y < vh);
  if (!points.length && !problems.length) problems.push('never on screen');
  for (const [x, y] of points) {
    const hit = document.elementFromPoint(x, y);
    if (hit && hit !== node && !node.contains(hit)) { problems.push(`covered by ${describe(hit)}`); break; }
  }
  return { problems, box: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } };
}
async function assertOnScreen(page, label, name, locator, { min = 1 } = {}) {
  const count = await locator.count();
  if (count < min) throw new Error(`${label}: ${name} is missing (${count} found, ${min} expected)`);
  for (let i = 0; i < count; i += 1) {
    const { problems } = await locator.nth(i).evaluate(inspectInPage);
    if (problems.length) throw new Error(`${label}: ${name}${count > 1 ? ` #${i + 1}` : ''} — ${problems.join('; ')}`);
  }
  return count;
}
// Nothing inside the Studio may stick out of the screen, named or not (a control nobody listed included).
async function assertNothingOffScreen(page, label) {
  const offenders = await page.evaluate(() => {
    const vw = Math.min(document.documentElement.clientWidth, document.body.clientWidth);
    const root = document.querySelector('main');
    const clippedInside = (el, r) => {
      for (let a = el.parentElement; a && a !== root.parentElement; a = a.parentElement) {
        if (getComputedStyle(a).overflowX === 'visible') continue;
        const box = a.getBoundingClientRect();
        if (box.left >= -0.5 && box.right <= vw + 0.5 && (r.left < box.left - 0.5 || r.right > box.right + 0.5)) return true;
      }
      return false;
    };
    return [root, ...root.querySelectorAll('*')].map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ el, r }) => r.width > 0 && r.height > 0 && (r.left < -0.5 || r.right > vw + 0.5) && !clippedInside(el, r)
        && (typeof el.checkVisibility !== 'function' || el.checkVisibility({ visibilityProperty: true })))
      .slice(0, 5)
      .map(({ el, r }) => `${el.tagName.toLowerCase()}${el.getAttribute('aria-label') ? `[${el.getAttribute('aria-label')}]` : ''} ${Math.round(r.left)}→${Math.round(r.right)} of ${vw}`);
  });
  if (offenders.length) throw new Error(`${label}: off the screen: ${offenders.join(' | ')}`);
}
// The preview shows the whole piece: the art fills the stage exactly, at the format's proportions, nothing cropped.
async function assertWholeArt(page, label, [, , width, height]) {
  const art = await preview(page).evaluate((surface) => {
    const stage = surface.parentElement.parentElement;
    // Fractional inner box (clientWidth/clientHeight are rounded to whole pixels).
    const s = stage.getBoundingClientRect(); const a = surface.getBoundingClientRect(); const cs = getComputedStyle(stage);
    const [bt, br, bb, bl] = ['Top', 'Right', 'Bottom', 'Left'].map((side) => Number.parseFloat(cs[`border${side}Width`]));
    return { stage: { x: s.left + bl, y: s.top + bt, w: s.width - bl - br, h: s.height - bt - bb }, art: { x: a.left, y: a.top, w: a.width, h: a.height } };
  });
  const near = (p, q) => Math.abs(p - q) <= 1.5;
  if (!near(art.art.x, art.stage.x) || !near(art.art.y, art.stage.y) || !near(art.art.w, art.stage.w) || !near(art.art.h, art.stage.h)) {
    throw new Error(`${label}: the art does not fill its stage ${JSON.stringify(art)}`);
  }
  if (Math.abs(art.art.w / art.art.h - width / height) > 0.01) throw new Error(`${label}: preview proportions ${art.art.w}×${art.art.h}, expected ${width}:${height}`);
  return art.art;
}

(async () => {
  fs.rmSync(DOWNLOADS, { recursive: true, force: true });
  fs.mkdirSync(DOWNLOADS, { recursive: true });
  const photo = path.join(OUT, 'figura-local-photo.png');
  writeTestPhoto(photo);
  const server = await start(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  try {
    // ── FREE: Base + 3 pieces with the Arma2 signature, everything else previewable and locked ────────────────
    if (want('free')) {
      const s = await open(browser, base, 'plan=free');
      const { page } = s;
      await expect(page.getByText('plan de la temporada')).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Navegación de la organización' }).getByRole('link', { name: 'Estudio Social' })).toBeVisible();
      const signature = page.getByRole('checkbox', { name: 'Mostrar la firma Arma2 en la placa' });
      await expect(signature).toBeChecked(); await expect(signature).toBeDisabled();
      for (const [id, label] of PIECES.filter(([pid]) => FREE_PIECES.includes(pid))) {
        for (const [format, slug, width, height] of FORMATS) {
          await configure(page, { id, label, style: 'Base', format });
          const shown = await previewCanvasPng(page);
          const [file] = await download(page, `FREE ${id} ${slug}`);
          assertCleanPng(file.buffer, width, height, file.name);
          if (!file.name.endsWith(`-base-${slug}.png`)) throw new Error(`file name ${file.name}`);
          await assertSameRender(page, `FREE ${id} ${slug}`);
          if (!shown.equals(file.buffer)) throw new Error(`FREE ${id} ${slug}: exported PNG differs from the preview canvas`);
          evidence.exports.push({ plan: 'FREE', piece: id, style: 'base', format: slug, file: file.name, sha: sha(file.buffer), previewIdentical: true });
        }
      }
      // D3: the format is the person's choice. Historia 9:16 survives switching to Resultados and refreshing it, in the
      // preview and in the 1080×1920 file.
      await configure(page, { id: 'standings', label: 'Tabla de posiciones', style: 'Base', format: 'Historia 9:16' });
      await markRender(page);
      await pieceRadio(page, 'Resultados de la fecha').click();
      await previewReady(page, { piece: 'Resultados de la fecha', style: 'Base', format: 'Historia 9:16' });
      await markRender(page);
      await page.getByRole('button', { name: 'Actualizar datos oficiales' }).click();
      await previewReady(page, { piece: 'Resultados de la fecha', style: 'Base', format: 'Historia 9:16' });
      await expect(page.getByRole('radiogroup', { name: 'Formato' }).getByRole('radio', { name: 'Historia 9:16' })).toHaveAttribute('aria-checked', 'true');
      const keptShown = await previewCanvasPng(page);
      const [kept] = await download(page, 'FREE Resultados keeps 9:16');
      assertCleanPng(kept.buffer, 1080, 1920, kept.name);
      await assertSameRender(page, 'FREE Resultados keeps 9:16');
      if (!kept.name.endsWith('-resultados-de-la-fecha-base-historia-9x16.png') || !keptShown.equals(kept.buffer)) throw new Error(`FREE Resultados keeps 9:16: ${kept.name}`);
      check('FREE: Resultados keeps the chosen format (switch and refresh)', { sha: sha(kept.buffer) });
      for (const [id, label] of PIECES.filter(([pid]) => !FREE_PIECES.includes(pid))) {
        await pieceRadio(page, label).click();
        await expect(pieceRadio(page, label)).toContainText('Premium');
        await expect(page.getByRole('button', { name: /Descargar/ })).toHaveCount(0);
        await expect(page.getByRole('note').filter({ hasText: `${label} es Premium` })).toBeVisible();
        check('FREE premium piece locked', { piece: id });
      }
      await pieceRadio(page, 'Tabla de posiciones').click();
      for (const style of STYLES.slice(1)) {
        await styleRadio(page, style).click();
        await previewReady(page, { piece: 'Tabla de posiciones', style, format: 'Historia 9:16' });
        await expect(page.locator(`div[data-premium-renderer="v2"][data-theme="${style.toLowerCase()}"]`)).toHaveCount(1);
        await expect(page.getByRole('button', { name: /Descargar/ })).toHaveCount(0);
        await expect(page.getByText(`El estilo ${style} es Premium`)).toBeVisible();
        await expect(page.getByRole('dialog')).toHaveCount(0);
        check('FREE premium style previewed and locked', { style });
      }
      const social = await page.evaluate(() => window.__social);
      if (social.refusals.length) throw new Error(`FREE: the page asked for something the database refuses: ${social.refusals}`);
      if (!social.authorize.every((a) => a.theme === 'base' && FREE_PIECES.includes(a.piece) && a.includeArma2Branding === true)) throw new Error('FREE authorize payloads');
      check('FREE authorize payloads', { calls: social.authorize.length });
      // The Premium lock leads to Mi plan, without checkout.
      await page.getByRole('note').getByRole('button', { name: 'Ver Premium' }).click();
      await expect(page.getByRole('heading', { name: 'FREE · Temporada 2026', exact: true })).toBeVisible();
      await expect(page.getByRole('row', { name: /Estudio Social/ })).toBeVisible();
      await expect(page.getByRole('button', { name: /Comprar|Checkout|Pagar/ })).toHaveCount(0);
      check('Ver Premium → Mi plan with the Studio in the comparison');
      await close(s, 'FREE');
    }

    // ── PREMIUM: 11 pieces × 5 styles × 2 formats, real PNG of exact size ─────────────────────────────────────
    if (want('premium')) {
      const s = await open(browser, base, 'plan=premium');
      const { page } = s;
      for (const [id, label] of PIECES.filter(([pid]) => PROFILE.premiumPieces.includes(pid))) {
        for (const style of STYLES) {
          for (const [format, slug, width, height] of FORMATS) {
            await configure(page, { id, label, style, format });
            const shown = style === 'Base' ? await previewCanvasPng(page) : null;
            const [file] = await download(page, `PREMIUM ${id} ${style} ${slug}`);
            assertCleanPng(file.buffer, width, height, file.name);
            if (!file.name.endsWith(`-${style.toLowerCase()}-${slug}.png`)) throw new Error(`file name ${file.name}`);
            if (shown) await assertSameRender(page, `PREMIUM ${id} Base ${slug}`);
            if (shown && !shown.equals(file.buffer)) throw new Error(`PREMIUM ${id} Base ${slug}: export differs from the preview canvas`);
            evidence.exports.push({ plan: 'PREMIUM', piece: id, style: style.toLowerCase(), format: slug, file: file.name, sha: sha(file.buffer), previewIdentical: Boolean(shown) });
          }
        }
      }
      // Base without the Arma2 signature (PREMIUM only): a different file, authorized as such.
      await configure(page, { id: 'standings', label: 'Tabla de posiciones', style: 'Base', format: 'Feed 4:5' });
      const [signed] = await download(page, 'PREMIUM signed');
      await markRender(page);
      await page.getByRole('checkbox', { name: 'Mostrar la firma Arma2 en la placa' }).uncheck();
      await previewReady(page, { piece: 'Tabla de posiciones', style: 'Base', format: 'Feed 4:5' });
      const unsignedPreview = await previewCanvasPng(page);
      const [unsigned] = await download(page, 'PREMIUM unsigned');
      assertCleanPng(unsigned.buffer, 1080, 1350, unsigned.name);
      if (signed.buffer.equals(unsigned.buffer)) throw new Error('removing the Arma2 signature did not change the file');
      if (!unsignedPreview.equals(unsigned.buffer)) throw new Error('unsigned export differs from preview');
      const social = await page.evaluate(() => window.__social);
      if (social.refusals.length) throw new Error(`PREMIUM refusals ${social.refusals}`);
      const last = social.authorize.at(-1);
      if (last.includeArma2Branding !== false || last.theme !== 'base') throw new Error('unsigned authorize payload');
      if (!social.authorize.filter((a) => a.theme !== 'base').every((a) => a.includeArma2Branding === false)) throw new Error('Premium styles must be authorized white-label');
      check('PREMIUM Base signature optional; Premium styles white-label', { authorizeCalls: social.authorize.length });
      await page.getByRole('checkbox', { name: 'Mostrar la firma Arma2 en la placa' }).check();
      await close(s, 'PREMIUM');
    }

    // ── Figura: local photo, drag of the focal point, zoom, reset; preview = export; fallback without photo ─────
    if (want('figura')) {
      const s = await open(browser, base, 'plan=premium');
      const { page } = s;
      for (const style of PROFILE.figuraStyles) {
        await configure(page, { id: 'mvp', label: 'Figura', style, format: 'Feed 4:5' });
        const [withoutPhoto] = await download(page, `Figura ${style} sin foto`);
        assertCleanPng(withoutPhoto.buffer, 1080, 1350, withoutPhoto.name);
        await markRender(page);
        await page.getByLabel('Elegir foto de la figura').setInputFiles(photo);
        await previewReady(page, { piece: 'Figura', style, format: 'Feed 4:5' });
        const [centered] = await download(page, `Figura ${style} foto centrada`);
        if (centered.buffer.equals(withoutPhoto.buffer)) throw new Error(`Figura ${style}: the photo did not reach the file`);
        const stage = page.locator('canvas[role="img"], div[data-premium-renderer="v2"]').first();
        // The photo tools sit under the preview: the art being framed is on screen while it is dragged.
        await stage.evaluate((el) => el.scrollIntoView({ block: 'start' }));
        const box = await stage.boundingBox();
        const tools = await page.getByRole('button', { name: 'Restablecer encuadre' }).boundingBox();
        const viewport = page.viewportSize();
        if (box.y < -1 || box.y + box.height > viewport.height || tools.y + tools.height > viewport.height) {
          throw new Error(`Figura ${style}: the preview and its photo tools do not fit on screen together (${Math.round(box.y)}, ${Math.round(tools.y + tools.height)})`);
        }
        await markRender(page);
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 6 });
        await page.mouse.up();
        await previewReady(page, { piece: 'Figura', style, format: 'Feed 4:5' });
        const [dragged] = await download(page, `Figura ${style} drag`);
        if (dragged.buffer.equals(centered.buffer)) throw new Error(`Figura ${style}: dragging the focal point changed nothing`);
        await markRender(page);
        await page.getByRole('slider').fill('2');
        await previewReady(page, { piece: 'Figura', style, format: 'Feed 4:5' });
        const shownZoom = style === 'Base' ? await previewCanvasPng(page) : null;
        const [zoomed] = await download(page, `Figura ${style} zoom`);
        if (zoomed.buffer.equals(dragged.buffer)) throw new Error(`Figura ${style}: zoom changed nothing`);
        if (shownZoom && !shownZoom.equals(zoomed.buffer)) throw new Error('Figura zoom: export differs from preview');
        await markRender(page);
        await page.getByRole('button', { name: 'Restablecer encuadre' }).click();
        await previewReady(page, { piece: 'Figura', style, format: 'Feed 4:5' });
        const [reset] = await download(page, `Figura ${style} reset`);
        if (!reset.buffer.equals(centered.buffer)) throw new Error(`Figura ${style}: reset did not return to the centered file`);
        check('Figura photo/drag/zoom/reset', { style, shas: [withoutPhoto, centered, dragged, zoomed, reset].map((f) => sha(f.buffer)) });
        await page.reload();
        await expect(page.getByRole('heading', { name: 'Estudio Social', exact: true })).toBeVisible();
      }
      await close(s, 'Figura');
    }

    // ── Equipo ideal: 5, 6, 7, 8, 9 and 11 players, manual lines, both formats ─────────────────────────────────
    for (const teamSize of want('xi') ? PROFILE.teamSizes : []) {
      const s = await open(browser, base, `plan=premium&teamSize=${teamSize}`);
      const { page } = s;
      for (const style of ['Base', 'Street']) {
        for (const [format, slug, width, height] of FORMATS) {
          await configure(page, { id: 'best_eleven', label: 'Equipo de la fecha', style, format, teamSize });
          const [file] = await download(page, `XI ${teamSize} ${style} ${slug}`);
          assertCleanPng(file.buffer, width, height, file.name);
          evidence.exports.push({ plan: 'PREMIUM', piece: 'best_eleven', teamSize, style: style.toLowerCase(), format: slug, sha: sha(file.buffer) });
        }
      }
      // The editorial line of a player is the person's decision and reaches the file.
      const before = (await download(page, `XI ${teamSize} before line`))[0].buffer;
      const lineSelect = page.getByRole('combobox', { name: /^Línea de / }).last();
      const current = await lineSelect.inputValue();
      await markRender(page);
      await lineSelect.selectOption(current === 'DEL' ? 'DEF' : 'DEL');
      await previewReady(page, { piece: 'Equipo de la fecha', style: 'Street', format: 'Historia 9:16' });
      const after = (await download(page, `XI ${teamSize} after line`))[0].buffer;
      if (before.equals(after)) throw new Error(`XI ${teamSize}: changing a line did not change the file`);
      check('Equipo ideal', { teamSize, lineChangeReachesFile: true });
      await close(s, `XI ${teamSize}`);
    }

    // ── Editorial standings: 15 rows per page, no duplicate or missing row, top-aligned, every page exported ───
    for (const [rows, pageCount] of want('editorial') ? PROFILE.editorialRows : []) {
      const s = await open(browser, base, `plan=premium&rows=${rows}`);
      const { page } = s;
      for (const [format, slug, width, height] of FORMATS) {
        await configure(page, { id: 'standings', label: 'Tabla de posiciones', style: 'Editorial', format });
        await expect(page.getByRole('navigation', { name: 'Páginas de la tabla de posiciones' }).getByText(`Página 1 de ${pageCount}`)).toBeVisible();
        const seen = []; const tops = []; let rowDepth = null;
        for (let p = 1; p <= pageCount; p += 1) {
          if (p > 1) {
            await markRender(page);
            await page.getByRole('button', { name: 'Siguiente' }).click();
            await expect(page.getByRole('navigation', { name: 'Páginas de la tabla de posiciones' }).getByText(`Página ${p} de ${pageCount}`)).toBeVisible();
            await previewReady(page, { piece: 'Tabla de posiciones', style: 'Editorial', format });
          }
          const pageRows = await page.locator('div[data-premium-renderer="v2"]').evaluate((node, { total, rowDepth }) => {
            const names = window.__socialTeamNames(total);
            const leaves = [...node.querySelectorAll('*')].filter((el) => !el.children.length);
            const top = node.getBoundingClientRect().top;
            const present = names.filter((name) => leaves.some((el) => el.textContent.trim() === name));
            // The row edge (not its text, which is centered in a row whose height follows the page density) must line
            // up. Page 1 (many rows) fixes the row's depth unambiguously: the outermost ancestor holding one team
            // inside the element holding all of them; continuation pages are measured at that same depth.
            const path = [];
            for (let el = leaves.find((leaf) => leaf.textContent.trim() === present[0]); el && el !== node; el = el.parentElement) path.unshift(el);
            const depth = rowDepth ?? path.findIndex((el) => present.filter((name) => el.textContent.includes(name)).length === 1
              && present.every((name) => el.parentElement.textContent.includes(name)));
            const row = depth >= 0 ? path[depth] : null;
            return { present, depth, firstTop: row ? row.getBoundingClientRect().top - top : null };
          }, { total: rows, rowDepth: p === 1 ? null : rowDepth });
          if (p === 1) rowDepth = pageRows.depth;
          seen.push(...pageRows.present); tops.push(pageRows.firstTop);
          if (pageRows.present.length > 15) throw new Error(`Editorial ${rows}: page ${p} has ${pageRows.present.length} rows`);
        }
        const expected = await page.evaluate((total) => window.__socialTeamNames(total), rows);
        if (JSON.stringify(seen) !== JSON.stringify(expected)) throw new Error(`Editorial ${rows} ${slug}: rows duplicated/omitted/out of order ${JSON.stringify(seen)}`);
        if (tops.some((top) => top === null)) throw new Error(`Editorial ${rows} ${slug}: rows list not found`);
        if (tops.some((top) => Math.abs(top - tops[0]) > 1)) throw new Error(`Editorial ${rows} ${slug}: continuation pages are not top-aligned ${tops}`);
        const files = await download(page, `Editorial ${rows} ${slug}`, new RegExp(`^Descargar ${pageCount} PNG$`));
        if (files.length !== pageCount) throw new Error(`Editorial ${rows}: ${files.length} files`);
        files.forEach((file, index) => {
          assertCleanPng(file.buffer, width, height, file.name);
          if (!file.name.endsWith(`-editorial-${slug}-pagina-${index + 1}-de-${pageCount}.png`)) throw new Error(`file ${file.name}`);
        });
        if (new Set(files.map((f) => sha(f.buffer))).size !== pageCount) throw new Error('two pages produced the same file');
        check('Editorial multi-page', { rows, format: slug, files: files.map((f) => f.name), topOffsets: tops });
        await page.reload();
        await expect(page.getByRole('heading', { name: 'Estudio Social', exact: true })).toBeVisible();
      }
      await close(s, `Editorial ${rows}`);
    }

    // ── Responsive: every functional part of the Studio on screen at phone, tablet and desktop widths ───────────
    // Phones run twice: with a classic 15 px scrollbar (the narrowest layout, 305 px at 320) and as a touch phone.
    const devices = (width) => (width <= 390 ? [['scrollbar', {}], ['phone', { isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]] : [['desktop', {}]]);
    for (const [width, height] of want('responsive') ? PROFILE.widths : []) {
      for (const [deviceName, device] of devices(width)) {
        for (const plan of ['free', 'premium']) {
          // PREMIUM reads a 16-row table so the Editorial pages and their navigation are measured too.
          const s = await open(browser, base, `plan=${plan}${plan === 'premium' ? '&rows=16' : ''}`, { width, height }, device);
          const { page } = s;
          const at = `${plan} ${width} ${deviceName}`;
          for (const fmt of FORMATS) {
            const [format, slug, fw, fh] = fmt;
            for (const style of plan === 'free' ? ['Base', 'Street'] : ['Base', 'Street', 'Editorial']) {
              const where = `${at} ${style} ${slug}`;
              await configure(page, { id: 'standings', label: 'Tabla de posiciones', style, format });
              await assertNothingOffScreen(page, where);
              await assertOnScreen(page, where, 'preview', preview(page));
              const art = await assertWholeArt(page, where, fmt);
              await assertOnScreen(page, where, 'piece selector', pieces(page).getByRole('radio'), { min: PIECES.length });
              await assertOnScreen(page, where, 'format selector', page.getByRole('radiogroup', { name: 'Formato' }).getByRole('radio'), { min: FORMATS.length });
              await assertOnScreen(page, where, 'style selector', page.getByRole('radiogroup', { name: 'Estilo' }).getByRole('radio'), { min: STYLES.length });
              await assertOnScreen(page, where, 'refresh', page.getByRole('button', { name: 'Actualizar datos oficiales' }));
              if (style === 'Base') await assertOnScreen(page, where, 'Arma2 signature', page.getByRole('checkbox', { name: 'Mostrar la firma Arma2 en la placa' }));
              let pageCount = 1;
              if (style === 'Editorial') {
                const nav = page.getByRole('navigation', { name: 'Páginas de la tabla de posiciones' });
                await assertOnScreen(page, where, 'page navigation', nav);
                await assertOnScreen(page, where, 'page buttons', nav.getByRole('button'), { min: 2 });
                // The page survives a change of format: turn to whichever page is not on screen.
                const onFirst = await nav.getByText('Página 1 de 2').count();
                await markRender(page);
                await nav.getByRole('button', { name: onFirst ? 'Siguiente' : 'Anterior' }).click();
                await expect(nav.getByText(`Página ${onFirst ? 2 : 1} de 2`)).toBeVisible();
                await previewReady(page, { piece: 'Tabla de posiciones', style, format });
                await assertWholeArt(page, `${where} other page`, fmt);
                await assertNothingOffScreen(page, `${where} other page`);
                pageCount = 2;
              }
              const downloadButton = page.getByRole('button', { name: /^Descargar( \d+)? PNG$/ });
              if (plan === 'premium' || style === 'Base') {
                await assertOnScreen(page, where, 'download', downloadButton);
                await assertOnScreen(page, where, 'share', page.getByRole('button', { name: 'Compartir' }));
                // The phone preview is the export scaled down: the files keep their exact size (and, for the Base
                // canvas, are byte-for-byte the preview).
                const shown = style === 'Base' ? await previewCanvasPng(page) : null;
                const files = await download(page, where, pageCount > 1 ? new RegExp(`^Descargar ${pageCount} PNG$`) : /^Descargar PNG$/);
                if (files.length !== pageCount) throw new Error(`${where}: ${files.length} files, expected ${pageCount}`);
                files.forEach((file) => assertCleanPng(file.buffer, fw, fh, file.name));
                if (shown) {
                  await assertSameRender(page, where);
                  if (!shown.equals(files[0].buffer)) throw new Error(`${where}: exported PNG differs from the preview canvas`);
                }
                files.forEach((file) => evidence.exports.push({ plan: plan.toUpperCase(), piece: 'standings', style: style.toLowerCase(), format: slug, viewport: `${width} ${deviceName}`, file: file.name, sha: sha(file.buffer), previewIdentical: Boolean(shown) }));
              } else {
                await expect(downloadButton).toHaveCount(0);
                const lock = page.getByRole('note').filter({ hasText: `El estilo ${style} es Premium` });
                await assertOnScreen(page, where, 'Premium lock', lock);
                await assertOnScreen(page, where, 'Ver Premium', lock.getByRole('button', { name: 'Ver Premium' }));
              }
              check('responsive', { plan, width, device: deviceName, style, format: slug, preview: { w: Math.round(art.w), h: Math.round(art.h) } });
            }
          }

          // Figura: the photo tools sit under the preview and fit on screen with the art they frame.
          const figura = `${at} Figura`;
          if (plan === 'free') {
            await styleRadio(page, 'Base').click();
            await pieceRadio(page, 'Figura').click();
            const lock = page.getByRole('note').filter({ hasText: 'Figura es Premium' });
            await assertOnScreen(page, figura, 'Premium lock', lock);
            await assertOnScreen(page, figura, 'Ver Premium', lock.getByRole('button', { name: 'Ver Premium' }));
            await assertNothingOffScreen(page, figura);
          } else {
            await configure(page, { id: 'mvp', label: 'Figura', style: 'Base', format: 'Feed 4:5' });
            await assertOnScreen(page, figura, 'manual selection', page.getByRole('group', { name: /Selección manual/ }).getByRole('checkbox'));
            await assertOnScreen(page, figura, 'choose photo', page.getByRole('button', { name: 'Elegir o subir foto' }));
            await markRender(page);
            await page.getByLabel('Elegir foto de la figura').setInputFiles(photo);
            await previewReady(page, { piece: 'Figura', style: 'Base', format: 'Feed 4:5' });
            await assertWholeArt(page, figura, FORMATS[0]);
            await assertNothingOffScreen(page, figura);
            for (const [name, locator] of [
              ['change photo', page.getByRole('button', { name: 'Cambiar foto' })],
              ['zoom', page.getByRole('slider')],
              ['reset', page.getByRole('button', { name: 'Restablecer encuadre' })],
              ['download', page.getByRole('button', { name: 'Descargar PNG' })],
              ['share', page.getByRole('button', { name: 'Compartir' })],
            ]) await assertOnScreen(page, figura, name, locator);
            const stage = preview(page);
            await stage.evaluate((el) => el.scrollIntoView({ block: 'start' }));
            const box = await stage.boundingBox();
            const tools = await page.getByRole('button', { name: 'Restablecer encuadre' }).boundingBox();
            if (box.y < -1 || tools.y + tools.height > height) throw new Error(`${figura}: the preview and its photo tools do not fit on screen together (${JSON.stringify({ box, tools, height })})`);
            const [file] = await download(page, figura);
            assertCleanPng(file.buffer, 1080, 1350, file.name);
          }
          if (width <= 390) {
            const mobileNav = page.getByRole('navigation', { name: 'Navegación móvil de la organización' });
            await assertOnScreen(page, at, 'mobile navigation', mobileNav);
            await assertOnScreen(page, at, 'mobile Estudio link', mobileNav.getByRole('link', { name: 'Estudio' }));
            // D2: at most one scrollbar (the viewport's): no dead gutter on the body, and the fixed bar sits symmetric
            // inside the usable width instead of 3–7 px under a second bar.
            const geometry = await mobileNav.evaluate((nav) => {
              const r = nav.getBoundingClientRect();
              const usable = Math.min(document.documentElement.clientWidth, document.body.clientWidth);
              return { deadGutter: document.body.offsetWidth - document.body.clientWidth, left: Math.round(r.left * 10) / 10, right: Math.round((usable - r.right) * 10) / 10 };
            });
            if (geometry.deadGutter !== 0 || geometry.right < 0 || Math.abs(geometry.left - geometry.right) > 1) {
              throw new Error(`${at}: mobile navigation ${JSON.stringify(geometry)}`);
            }
            check('D2 mobile navigation symmetric, no dead body gutter', { plan, width, device: deviceName, ...geometry });
          }
          await page.screenshot({ path: path.join(OUT, `studio-${plan}-${width}-${deviceName}.png`), fullPage: true });
          await close(s, `responsive ${at}`);
        }
      }
    }

    // ── Roles, empty states, and the Studio OFF ───────────────────────────────────────────────────────────────
    if (want('roles')) {
      let s = await open(browser, base, 'plan=premium&role=collaborator');
      await expect(s.page.getByText('Modo lectura')).toBeVisible();
      await expect(s.page.getByRole('button', { name: /Descargar/ })).toHaveCount(0);
      if ((await s.page.evaluate(() => window.__social.authorize.length)) !== 0) throw new Error('collaborator authorized');
      await close(s, 'collaborator');
      s = await open(browser, base, 'plan=free&tournaments=0');
      await expect(s.page.getByText('Todavía no hay torneos para generar placas')).toBeVisible();
      await close(s, 'no tournaments');
      s = await open(browser, base, 'plan=free&fixture=none');
      await expect(s.page.getByText(/todavía no tiene un fixture publicado/)).toBeVisible();
      if ((await s.page.evaluate(() => window.__social.snapshots.length)) !== 0) throw new Error('snapshot requested without a fixture');
      await close(s, 'no fixture');
      check('roles and empty states');

      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      const page = await context.newPage();
      const remote = [];
      await page.route('**/*', (route) => {
        const u = new URL(route.request().url());
        if (u.origin === base) return route.continue();
        if (ALLOWED_REMOTE.has(u.hostname)) return serveFont(route);
        remote.push(u.href); return route.abort();
      });
      await page.goto(`${base}/?social=off&path=inicio`);
      const nav = page.getByRole('navigation', { name: 'Navegación de la organización' });
      await expect(nav.getByRole('link', { name: 'Mi plan' })).toBeVisible({ timeout: 15000 });
      await expect(nav.getByRole('link', { name: 'Estudio Social' })).toHaveCount(0);
      await page.goto(`${base}/?social=off&path=estudio-social`);
      await expect(page.getByRole('heading', { name: 'Estudio Social todavía no está habilitada' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Estudio Social', exact: true })).toHaveCount(0);
      await page.goto(`${base}/?social=off&path=mi-plan`);
      await expect(page.getByRole('heading', { name: 'FREE · Temporada 2026', exact: true })).toBeVisible();
      await expect(page.locator('section[aria-labelledby="plan-comparison-title"]')).not.toContainText('Estudio');
      await expect(page.locator('section[aria-labelledby="plan-upcoming-title"]').getByRole('heading', { name: 'Estudio Social' })).toBeVisible();
      if ((await page.evaluate(() => window.__social.authorize.length + window.__social.snapshots.length)) !== 0) throw new Error('Studio OFF made Social requests');
      if (remote.length) throw new Error(`Studio OFF remote ${remote}`);
      await context.close();
      check('Studio OFF: no nav, no route, Mi plan keeps it in Próximamente, zero Social requests');
    }
    evidence.finishedAt = new Date().toISOString();
    evidence.summary = { exports: evidence.exports.length, checks: evidence.checks.length };
    fs.writeFileSync(path.join(OUT, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(JSON.stringify({ result: 'SOCIAL_STUDIO_BROWSER_PASS', ...evidence.summary }));
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
