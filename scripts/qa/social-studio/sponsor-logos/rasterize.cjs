// Rasterizes the fictional sponsor logos of the offline harness (sponsor-logos/*.svg → *.png, 1200 px wide, alpha
// kept) with the same Chromium the browser gate uses, so their wordmarks are drawn with the Google Fonts faces they
// name. `node scripts/qa/social-studio/sponsor-logos/rasterize.cjs [outDir]`. The PNGs are committed: the gate never
// rasterizes, it serves these files.
const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const OUT = path.resolve(process.argv[2] || HERE);

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 1200 }, deviceScaleFactor: 1 });
    for (const file of fs.readdirSync(HERE).filter((name) => name.endsWith('.svg')).sort()) {
      const svg = fs.readFileSync(path.join(HERE, file), 'utf8');
      await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`, { waitUntil: 'networkidle' });
      await page.evaluate(async () => {
        await document.fonts.ready;
        const families = [...document.fonts].map((face) => face.status);
        if (families.some((status) => status === 'error')) throw new Error('a logo font failed to load');
      });
      const target = path.join(OUT, file.replace(/\.svg$/, '.png'));
      await page.locator('svg').first().screenshot({ path: target, omitBackground: true });
      console.log(path.relative(process.cwd(), target), fs.statSync(target).size);
    }
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exit(1); });
