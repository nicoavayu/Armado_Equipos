#!/usr/bin/env node
// MEDIA-V1 lab journey in a real browser (Playwright Chromium) against the media lab app (127.0.0.1:3120 → bridge →
// media lab gateway). LOCAL ONLY, own accounts. Every scenario prints JSON evidence (statuses, byte counts, timings) and
// writes screenshots to $MEDIA_LAB_EVIDENCE. Tokens never leave the browser context.
//
//   node media-browser.mjs organizer <mobile|desktop>    create a gallery, upload the lab photo set, approve, cover, publish
//   node media-browser.mjs participant <mobile|desktop>  open the tournament's Fotos as the captain; grid, lightbox, swipe
//   node media-browser.mjs slow-upload                    one upload under a throttled uplink (Chrome network emulation)
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';
import { loginUrl, state, save } from './media-journey.mjs';

const EVIDENCE = process.env.MEDIA_LAB_EVIDENCE;
const PHOTOS = process.env.MEDIA_LAB_PHOTOS;
const APP = process.env.MEDIA_LAB_APP_ORIGIN || 'http://localhost:3120';
if (!EVIDENCE || !PHOTOS) throw new Error('MEDIA_LAB_EVIDENCE and MEDIA_LAB_PHOTOS are required');
fs.mkdirSync(EVIDENCE, { recursive: true });
const VIEWPORTS = {
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
};
const evidence = [];
const note = (entry) => { evidence.push(entry); console.log(JSON.stringify(entry)); };

async function open(role, form) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...VIEWPORTS[form], locale: 'es-AR' });
  const page = await context.newPage();
  const traffic = [];
  page.on('requestfinished', async (request) => {
    const url = request.url();
    if (!/58445|58447/.test(url)) return;
    const sizes = await request.sizes().catch(() => null);
    const response = await request.response();
    traffic.push({ method: request.method(), route: url.replace(/\?.*$/, '').replace(/^https?:\/\/[^/]+/, '').replace(/[0-9a-f-]{36}/g, ':id'),
      status: response?.status() ?? null, requestBytes: sizes ? sizes.requestBodySize + sizes.requestHeadersSize : null,
      responseBytes: sizes ? sizes.responseBodySize + sizes.responseHeadersSize : null, kind: /58445/.test(url) ? 'storage' : 'gateway' });
  });
  await page.goto(await loginUrl(role, APP));
  await page.waitForURL((url) => !url.hash.includes('access_token'), { timeout: 30000 });
  return { browser, context, page, traffic };
}
const shot = async (page, name, { full = false } = {}) => {
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(EVIDENCE, `${name}.png`), fullPage: full });
};
const sum = (rows, field) => rows.reduce((total, row) => total + (row[field] || 0), 0);

// MEDIA_LAB_ORG=other runs the organizer as the PREMIUM organization's owner (Lab Galería's FREE season may be full).
const ORGANIZER = process.env.MEDIA_LAB_ORG === 'other'
  ? { role: 'other', organizationId: state.otherOrganizationId } : { role: 'owner', organizationId: state.organizationId };

async function overview(form) {
  const { browser, page } = await open('owner', form);
  await page.goto(`${APP}/torneos/organizacion/${state.organizationId}/multimedia`);
  await page.getByRole('heading', { name: 'Centro Multimedia' }).waitFor({ timeout: 30000 });
  await page.waitForTimeout(2500);
  await shot(page, `${form}-20-centro-cuota-llena`, { full: true });
  note({ scenario: 'overview', form, quota: await page.locator('[aria-label^="Fotos de la temporada"]').getAttribute('aria-label').catch(() => null) });
  await browser.close();
}

async function organizer(form) {
  const { browser, page, traffic } = await open(ORGANIZER.role, form);
  await page.goto(`${APP}/torneos/organizacion/${ORGANIZER.organizationId}/multimedia`);
  await page.getByRole('heading', { name: 'Centro Multimedia' }).waitFor({ timeout: 30000 });
  await shot(page, `${form}-01-centro-vacio`);
  const title = `Fecha 1 · ${form}`;
  await page.getByRole('button', { name: 'Crear galería' }).click();
  await page.getByLabel('Título').fill(title);
  await page.getByRole('button', { name: 'Crear borrador' }).click();
  await page.getByText('Galería creada.').waitFor({ timeout: 20000 });
  const files = ['camera-12mp.jpg', 'iphone-portrait-orient6.jpg', 'camera-24mp.jpg', 'screenshot-like.png', 'iphone-original.heic', 'roto.jpg']
    .map((name) => path.join(PHOTOS, name));
  await page.getByLabel('Seleccionar fotos').setInputFiles(files);
  await page.getByText(/HEIC del iPhone no se pueden subir así/).waitFor({ timeout: 10000 });
  await shot(page, `${form}-02-seleccion`);
  const started = Date.now();
  await page.getByRole('button', { name: 'Subir todas' }).click();
  await page.waitForFunction(() => {
    const rows = [...document.querySelectorAll('[data-status]')].filter((el) => el.closest('[aria-live]'));
    return rows.length > 0 && rows.every((row) => !['ready', 'preparing', 'uploading', 'processing'].includes(row.dataset.status));
  }, null, { timeout: 120000 });
  const queue = await page.$$eval('[aria-live] article', (rows) => rows.map((row) => ({ status: row.dataset.status,
    error: row.querySelector('em')?.textContent?.trim() || null })));
  note({ scenario: 'organizer-upload', form, elapsedMs: Date.now() - started, queue });
  await shot(page, `${form}-03-cola-terminada`, { full: true });
  const uploads = traffic.filter((row) => row.route.endsWith('/torneos/media/v1/upload'));
  note({ scenario: 'organizer-upload-traffic', form, uploads: uploads.map(({ status, requestBytes }) => ({ status, requestBytes })) });
  // Review: approve every pending photo, choose a cover, publish.
  for (;;) {
    const approve = page.getByRole('button', { name: 'Aprobar' }).first();
    if (!(await approve.count())) break;
    await approve.click();
    await page.waitForTimeout(600);
  }
  await page.getByRole('button', { name: 'Portada' }).first().click();
  await page.waitForTimeout(800);
  await shot(page, `${form}-04-aprobadas`, { full: true });
  await page.getByRole('button', { name: 'Publicar galería' }).click();
  await page.getByText('Galería publicada para su audiencia autorizada.').waitFor({ timeout: 20000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, `${form}-05-publicada`, { full: true });
  const thumbs = traffic.filter((row) => row.kind === 'storage' && row.method === 'GET');
  note({ scenario: 'organizer-admin-thumbnails', form, images: thumbs.length, bytes: sum(thumbs, 'responseBytes') });
  state[`gallery_${form}`] = title; save();
  await browser.close();
}

async function participant(form) {
  const { browser, page, traffic } = await open('captain', form);
  await page.goto(`${APP}/torneos/torneo/${state.tournamentId}/fotos?categoria=${state.categoryId}`);
  await page.getByRole('region', { name: 'Fotos del torneo' }).waitFor({ timeout: 30000 });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  const grid = traffic.filter((row) => row.kind === 'storage' && row.method === 'GET');
  note({ scenario: 'participant-grid', form, images: grid.length, bytes: sum(grid, 'responseBytes'), perImage: grid.map((row) => row.responseBytes) });
  await shot(page, `${form}-10-participante-grilla`);
  const before = traffic.length;
  await page.getByRole('button', { name: /Abrir portada de/ }).first().click();
  await page.getByRole('dialog').waitFor();
  await page.waitForTimeout(1500);
  await shot(page, `${form}-11-participante-visor`);
  const stage = page.getByRole('dialog').locator('[data-loading]');
  if (form === 'mobile') {
    const box = await stage.boundingBox();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await stage.dispatchEvent('touchstart', { touches: [{ identifier: 1, clientX: box.x + box.width * 0.8, clientY: box.y + box.height / 2 }] });
    await stage.dispatchEvent('touchend', { changedTouches: [{ identifier: 1, clientX: box.x + box.width * 0.15, clientY: box.y + box.height / 2 + 6 }] });
  } else {
    await page.keyboard.press('ArrowRight');
  }
  await page.waitForTimeout(1500);
  const label = await page.getByRole('dialog').getAttribute('aria-label');
  await shot(page, `${form}-12-participante-siguiente`);
  const opened = traffic.slice(before).filter((row) => row.kind === 'storage' && row.method === 'GET');
  note({ scenario: 'participant-lightbox', form, afterNavigation: label, images: opened.length, bytes: sum(opened, 'responseBytes') });
  await browser.close();
}

const queueSettled = (page, timeout = 60000) => page.waitForFunction(() => {
  const rows = [...document.querySelectorAll('[aria-live] article')];
  return rows.length > 0 && rows.every((row) => ['pending_review', 'error', 'invalid', 'cancelled'].includes(row.dataset.status));
}, null, { timeout }).catch(() => null);

// Slow uplink and a cut connection, through Chrome's own network emulation (CDP), on the PREMIUM organization.
async function slowUpload(form) {
  const { browser, context, page, traffic } = await open('other', form);
  const cdp = await context.newCDPSession(page);
  await page.goto(`${APP}/torneos/organizacion/${state.otherOrganizationId}/multimedia`);
  await page.getByRole('heading', { name: 'Centro Multimedia' }).waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: 'Crear galería' }).click();
  const title = `Conexión lenta · ${Date.now() % 100000}`;
  await page.getByLabel('Título').fill(title);
  await page.getByRole('button', { name: 'Crear borrador' }).click();
  await page.getByText('Galería creada.').waitFor({ timeout: 20000 });
  for (const [label, kbps] of process.env.MEDIA_LAB_ONLY_CUT ? [] : [['3G lento (400 kbit/s de subida)', 400], ['1 Mbit/s de subida', 1000]]) {
    const photoFile = kbps === 400 ? 'slow-a-12mp.jpg' : 'slow-b-24mp.jpg';
    await page.getByLabel('Seleccionar fotos').setInputFiles(path.join(PHOTOS, photoFile));
    await page.getByRole('button', { name: 'Subir', exact: true }).waitFor();
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 300, downloadThroughput: 1.6e6 / 8, uploadThroughput: (kbps * 1000) / 8 });
    const started = Date.now();
    const progress = [];
    const poll = setInterval(async () => {
      const value = await page.getByRole('progressbar').first().getAttribute('aria-valuenow').catch(() => null);
      if (value !== null && progress.at(-1) !== value) progress.push(value);
    }, 250);
    await page.getByRole('button', { name: 'Subir', exact: true }).click();
    await queueSettled(page);
    clearInterval(poll);
    const statusNow = await page.$$eval('[aria-live] article', (rows) => rows.map((row) => row.dataset.status));
    const upload = traffic.filter((row) => row.route.endsWith('/torneos/media/v1/upload')).at(-1);
    note({ scenario: 'slow-upload', form, link: label, photo: photoFile, elapsedMs: Date.now() - started, finalStatus: statusNow, progressSeen: progress, httpStatus: upload?.status ?? null });
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await page.getByRole('button', { name: /^Quitar Foto/ }).first().click().catch(() => null);
  }
  // A connection cut in the middle of the upload, then a retry with the same key once it is back.
  await page.getByLabel('Seleccionar fotos').setInputFiles(path.join(PHOTOS, 'slow-c-portrait.jpg'));
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 300, downloadThroughput: 1.6e6 / 8, uploadThroughput: 200000 / 8 });
  await page.getByRole('button', { name: 'Subir', exact: true }).click();
  // Cut as soon as real bytes are moving (the bar has left 0 %).
  await page.waitForFunction(() => Number(document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow') || 0) > 5, null, { timeout: 30000 }).catch(() => null);
  const cutAt = await page.getByRole('progressbar').first().getAttribute('aria-valuenow').catch(() => null);
  // CDP's offline mode does not cut a request already on the wire: the real cut is the lab gateway dying mid-upload.
  const { spawnSync } = await import('node:child_process');
  const DOCKER = '/Applications/Docker.app/Contents/Resources/bin/docker';
  spawnSync(DOCKER, ['kill', 'arma2-media-lab-gateway'], { encoding: 'utf8' });
  const failed = [];
  page.on('requestfailed', (request) => failed.push(`${request.method()} ${request.url().replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, '').replace(/[0-9a-f-]{36}/g, ':id')} ${request.failure()?.errorText}`));
  const before = traffic.length;
  await page.locator('[aria-live] article').getByRole('button', { name: 'Reintentar' }).first().waitFor({ timeout: 90000 });
  note({ scenario: 'slow-upload-debug', failed, finishedWhileOffline: traffic.slice(before).map((row) => `${row.method} ${row.route} ${row.status}`) });
  const cutMessage = await page.$$eval('[aria-live] article em', (rows) => rows.map((row) => row.textContent.trim()));
  await shot(page, `${form}-30-corte-de-red`, { full: false });
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  spawnSync(DOCKER, ['start', 'arma2-media-lab-gateway'], { encoding: 'utf8' });
  await page.waitForTimeout(5000);
  await page.locator('[aria-live] article').getByRole('button', { name: 'Reintentar' }).first().click();
  await page.waitForTimeout(500);
  await queueSettled(page);
  const after = await page.$$eval('[aria-live] article', (rows) => rows.map((row) => row.dataset.status));
  note({ scenario: 'slow-upload', form, link: 'connection cut mid-upload, then retry', cutAtPercent: cutAt, messageWhileCut: cutMessage, finalStatus: after });
  state.slowGallery = title; save();
  await browser.close();
}

const [scenario, form = 'mobile'] = process.argv.slice(2);
if (scenario === 'organizer') await organizer(form);
else if (scenario === 'participant') await participant(form);
else if (scenario === 'overview') await overview(form);
else if (scenario === 'slow-upload') await slowUpload(form);
else { console.error('usage: media-browser.mjs organizer|participant [mobile|desktop]'); process.exit(2); }
fs.writeFileSync(path.join(EVIDENCE, `evidence-${scenario}-${form}.json`), JSON.stringify(evidence, null, 2));
