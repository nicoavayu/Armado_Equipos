// PREMIUM SPONSORS — the band never touches a piece without sponsors, and with them it is the prominent band. Every Premium composition (4 styles × 2 formats)
// of every piece and its density variants is rendered to static markup WITHOUT sponsors and compared with the markup
// the renderer produced before the prominent sponsor band existed (PR #212 @ 9279f9df): byte for byte, through its
// sha256. A FREE piece is the Base canvas, which the band never reaches (torneosSocialSponsorsRender.test.js).
//
// The baseline is fixtures/premium-no-sponsors-markup.json. It is only ever regenerated on purpose, from the commit a
// change must stay identical to: `UPDATE_PREMIUM_NO_SPONSORS_BASELINE=1 npx react-scripts test --watchAll=false
// torneosSocialPremiumNoSponsorsRegression`.
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import PremiumRenderer from '../features/torneos/social/premium/PremiumRenderer';
import { sponsorLogoTone } from '../features/torneos/social/premium/premiumDataAdapter';
import { SOCIAL_PIECE_IDS, createEditorialState } from '../features/torneos/social/socialContracts';
import { socialQaSelection, socialQaSnapshot } from '../testUtils/socialStudioSnapshots';

const BASELINE = path.join(__dirname, 'fixtures/premium-no-sponsors-markup.json');
const THEMES = ['heritage', 'street', 'scoreboard', 'editorial'];
const FORMATS = ['portrait', 'story'];
// A tiny opaque PNG: the photo variants (Figura and Campeón with a photo) without any file or network.
const PHOTO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function cases() {
  const list = [];
  for (const themeId of THEMES) {
    for (const format of FORMATS) {
      const add = (name, snapshot, extra = {}) => list.push({
        name: `${themeId}:${format}:${name}`, themeId, format, snapshot, ...extra,
      });
      SOCIAL_PIECE_IDS.forEach((piece) => add(piece, socialQaSnapshot(piece)));
      add('standings-4', socialQaSnapshot('standings', { standingsRows: 4 }));
      add('standings-16-page-1', socialQaSnapshot('standings', { standingsRows: 16 }), { page: 1 });
      add('standings-16-page-2', socialQaSnapshot('standings', { standingsRows: 16 }), { page: 2 });
      add('round_results-2', socialQaSnapshot('round_results', { listSize: 2 }));
      add('next_fixture-1', socialQaSnapshot('next_fixture', { listSize: 1 }));
      add('scorers-2', socialQaSnapshot('scorers', { listSize: 2 }));
      add('best_eleven-11', socialQaSnapshot('best_eleven', { teamSize: 11 }));
      add('mvp-photo', socialQaSnapshot('mvp'), { photo: true });
      add('champion-photo', socialQaSnapshot('champion'), { photo: true });
    }
  }
  return list;
}

function render({ themeId, format, snapshot, page, photo }, sponsors) {
  const editorial = {
    ...createEditorialState(snapshot, { format }),
    selection: socialQaSelection(snapshot),
    ...(page ? { page } : {}),
  };
  return renderToStaticMarkup(
    <PremiumRenderer
      snapshot={snapshot}
      content={null}
      editorial={editorial}
      assets={photo ? { photo: PHOTO } : {}}
      branding={{}}
      theme={themeId}
      {...(sponsors === undefined ? {} : { sponsors })}
    />,
  );
}

const sha = (value) => createHash('sha256').update(value).digest('hex');

// Static markup is the composition before the in-browser layout pass (premiumLayoutHardening runs in a layout effect,
// which a server render skips on purpose); React says so once per render, and only that is silenced.
let consoleError;
beforeAll(() => {
  const original = console.error;
  consoleError = jest.spyOn(console, 'error').mockImplementation((message, ...rest) => {
    if (String(message).includes('useLayoutEffect does nothing on the server')) return;
    original(message, ...rest);
  });
});
afterAll(() => consoleError.mockRestore());

describe('Premium without sponsors: the very markup it rendered before the sponsor band', () => {
  const all = cases();

  if (process.env.UPDATE_PREMIUM_NO_SPONSORS_BASELINE === '1') {
    test('baseline regenerated on purpose', () => {
      const baseline = Object.fromEntries(all.map((entry) => [entry.name, sha(render(entry, []))]));
      fs.writeFileSync(BASELINE, `${JSON.stringify(baseline, null, 2)}\n`);
      expect(Object.keys(baseline)).toHaveLength(all.length);
    });
    return;
  }

  const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));

  test('the baseline covers every case (4 styles × 2 formats × 20 piece variants)', () => {
    expect(all).toHaveLength(4 * 2 * (SOCIAL_PIECE_IDS.length + 9));
    expect(Object.keys(baseline).sort()).toEqual(all.map((entry) => entry.name).sort());
  });

  test.each(all.map((entry) => [entry.name, entry]))('%s: identical with no sponsors and with an empty list', (name, entry) => {
    const withEmptyList = render(entry, []);
    expect(sha(withEmptyList)).toBe(baseline[name]);
    expect(render(entry, undefined)).toBe(withEmptyList);
    // Sponsors without a drawable logo are no sponsors either.
    expect(render(entry, [{ id: 'sin-logo', name: 'Sin logo' }])).toBe(withEmptyList);
    expect(withEmptyList).not.toContain('data-premium-sponsor');
  });
});

describe('Premium with sponsors: the prominent band', () => {
  const logo = (n) => `data:image/png;base64,${Buffer.from(`logo-${n}`).toString('base64')}`;
  const sponsors = (count) => [1, 2, 3, 4].slice(0, count).map((n) => ({ id: `s${n}`, name: `Sponsor ${n}`, src: logo(n) }));
  const tiles = (markup) => markup.match(/data-premium-sponsor-tile="true"/g) || [];
  const WITHOUT_BAND = ['final', 'champion'];

  test.each(THEMES.flatMap((themeId) => FORMATS.map((format) => [themeId, format])))('%s %s: one band, a tile per sponsor (at most three), a legible label', (themeId, format) => {
    for (const piece of SOCIAL_PIECE_IDS) {
      const snapshot = socialQaSnapshot(piece);
      // Final and Campeón are full-bleed posters: their approved compositions never carried a sponsor row.
      if (WITHOUT_BAND.includes(piece)) {
        expect(render({ themeId, format, snapshot }, sponsors(3))).not.toContain('data-premium-sponsor');
        continue;
      }
      [1, 2, 3, 4].forEach((count) => {
        const markup = render({ themeId, format, snapshot }, sponsors(count));
        expect(markup.match(/data-premium-sponsor-band="(\d)"/g)).toEqual([`data-premium-sponsor-band="${Math.min(count, 3)}"`]);
        expect(tiles(markup)).toHaveLength(Math.min(count, 3));
        expect(markup).toContain(themeId === 'street' ? '>APOYAN</span>' : '>CON EL APOYO DE</span>');
        expect(markup).toContain(`font-size:${format === 'story' ? 24 : 19}px`);
        expect(markup).toContain(`height:${format === 'story' ? 216 : 160}px`);
        expect(markup).toContain('object-fit:contain');
      });
    }
  });

  test('a logo marked dark-toned gets the style ink as its tile; any other stays white', () => {
    const snapshot = socialQaSnapshot('standings');
    const markup = render({ themeId: 'editorial', format: 'portrait', snapshot }, [
      { id: 'a', name: 'Claro', src: logo(1), tone: 'dark' }, { id: 'b', name: 'Oscuro', src: logo(2) },
    ]);
    expect(markup).toMatch(/data-tone="dark" style="[^"]*background:#1B2A46/);
    expect(markup).toMatch(/data-tone="light" style="[^"]*background:#FFFFFF/);
  });
});

describe('sponsorLogoTone', () => {
  const pixels = (list) => Uint8ClampedArray.from(list.flat());
  const transparent = [0, 0, 0, 0];
  test('white ink on a transparent background is dark-toned (it needs a dark tile)', () => {
    expect(sponsorLogoTone(pixels([...Array(60).fill(transparent), ...Array(40).fill([255, 255, 255, 255])]))).toBe('dark');
  });
  test('dark ink, coloured fields and fully opaque logos keep the white tile', () => {
    expect(sponsorLogoTone(pixels([...Array(60).fill(transparent), ...Array(40).fill([31, 35, 40, 255])]))).toBe('light');
    expect(sponsorLogoTone(pixels(Array(100).fill([255, 255, 255, 255])))).toBe('light');
    expect(sponsorLogoTone(pixels([...Array(5).fill(transparent), ...Array(95).fill([180, 84, 31, 255])]))).toBe('light');
    expect(sponsorLogoTone(pixels(Array(100).fill(transparent)))).toBe('light');
  });
});
