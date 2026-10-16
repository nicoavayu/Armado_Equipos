// PREMIUM SPONSORS — the render half (social/socialStudio.js). FREE is untouched: without sponsors the render key is the
// very key the Studio produced before sponsors existed, and Base draws the same operations whatever sponsors are passed.
// A Premium style preloads each logo into a bitmap (the signed URL never reaches the composition), draws at most three,
// and keys them by identity, name and logo object — a replaced logo changes the key, a re-signed URL does not.
import {
  createSocialRenderKey,
  prepareSocialRender,
  releasePreparedSocialRender,
  resolveDrawnSponsors,
} from '../features/torneos/social/socialStudio';
import { SOCIAL_FORMATS, createEditorialState } from '../features/torneos/social/socialContracts';
import { normalizeSocialBranding } from '../features/torneos/social/socialBranding';
import { resolveSocialTheme } from '../features/torneos/social/socialThemes';
import { socialQaSnapshot } from '../testUtils/socialStudioSnapshots';

// The Premium DOM renderer is replaced by a recorder (jsdom lays nothing out); what it receives is what it would draw.
const mockPremium = { calls: [] };
jest.mock('../features/torneos/social/premiumRenderer', () => ({
  createPremiumDomRender: (options) => {
    mockPremium.calls.push(options);
    const node = global.document.createElement('div');
    node.style.width = '1080px';
    node.style.height = '1350px';
    return { node, root: { unmount() {} }, format: { id: options.editorial.format } };
  },
  ensurePremiumSocialFonts: async () => {},
  premiumDomToPngBlob: async () => new Blob(['png'], { type: 'image/png' }),
  releasePremiumDomRender: () => {},
  waitForPremiumDomAssets: async () => {},
}));

const ORG = '10000000-0000-4000-8000-000000000001';
const IDS = {
  organizationId: ORG,
  tournamentId: '30000000-0000-4000-8000-000000000001',
  categoryId: '40000000-0000-4000-8000-000000000001',
  phaseId: '50000000-0000-4000-8000-000000000001',
  roundId: '60000000-0000-4000-8000-000000000001',
};
const logo = (n) => `${ORG}/organizations/${ORG}/7100000${n}-0000-4000-8000-000000000001.png`;
const SPONSORS = [1, 2, 3, 4].map((n) => ({
  id: `70000000-0000-4000-8000-00000000000${n}`,
  name: ['Ferretería El Tornillo', 'Panadería La Espiga', 'Gimnasio Fénix', 'Kiosco Doble Siete'][n - 1],
  logoPath: logo(n),
  image: `https://gateway.example.test/storage/v1/object/sign/tournament-branding/${logo(n)}?token=t${n}`,
}));

// The render key exactly as the Studio computed it before sponsors had a logo (sponsors keyed by id || name).
function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stableValue(value[key]);
    return result;
  }, {});
}
function legacyRenderKey({ snapshot, content, editorial, format, theme, variant, assetPlan, branding, sponsors = [] }) {
  return JSON.stringify(stableValue({
    piece: snapshot.piece,
    content: content || snapshot,
    editorial,
    format: format.id,
    theme,
    variant,
    branding: normalizeSocialBranding(branding, content),
    sponsors: sponsors.map((entry) => entry?.id || entry?.name || null),
    assets: assetPlan,
  }));
}

function recordingCanvas(log) {
  const state = { font: '' };
  const ctx = new Proxy({}, {
    get(target, key) {
      if (key === 'measureText') return (text) => ({ width: String(text).length * Number((state.font.match(/(\d+)px/) || [0, 16])[1]) * 0.52 });
      if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => ({ addColorStop: (...args) => log.push(`stop(${args})`) });
      if (key in state) return state[key];
      return (...args) => log.push(`${String(key)}(${args.map((value) => (typeof value === 'object' && value !== null ? '[obj]' : String(value))).join(',')})`);
    },
    set(target, key, value) { state[key] = value; log.push(`set:${String(key)}=${String(value)}`); return true; },
  });
  return (width, height) => ({ width, height, setAttribute() {}, getContext: () => ctx, toBlob: (cb) => cb(new Blob(['png'])) });
}

const bitmaps = [];
beforeEach(() => {
  mockPremium.calls = [];
  bitmaps.length = 0;
  global.fetch = async (url) => ({
    ok: !String(url).includes('broken'),
    blob: async () => Object.assign(new Blob(['png'], { type: 'image/png' }), { sourceUrl: String(url) }),
  });
  global.createImageBitmap = async (blob) => {
    const bitmap = { width: 360, height: 140, source: blob.sourceUrl, closed: false, close() { this.closed = true; } };
    bitmaps.push(bitmap);
    return bitmap;
  };
});
afterEach(() => {
  delete global.fetch;
  delete global.createImageBitmap;
});

const standings = () => socialQaSnapshot('standings', IDS);

describe('FREE is unchanged', () => {
  test('without sponsors the render key is the key computed before sponsors existed', () => {
    const snapshot = standings();
    const editorial = createEditorialState(snapshot);
    const input = {
      snapshot,
      content: null,
      editorial,
      format: SOCIAL_FORMATS.portrait,
      theme: resolveSocialTheme('base'),
      variant: null,
      assetPlan: { shieldPaths: [], photoAssetId: null, photoSourceKey: null, branding: { tournamentLogoUrl: null, officialLockupUrl: 'lockup' } },
      branding: { tournamentName: 'Copa Horizonte 2026', showArma2Branding: true },
    };
    expect(createSocialRenderKey(input)).toBe(legacyRenderKey(input));
    expect(createSocialRenderKey({ ...input, sponsors: [] })).toBe(legacyRenderKey(input));
  });

  test('Base draws the very same operations and key with or without sponsors passed in', async () => {
    const snapshot = standings();
    const editorial = createEditorialState(snapshot);
    const render = async (extra) => {
      const log = [];
      const prepared = await prepareSocialRender({
        snapshot, editorial, organizationId: ORG, createCanvas: recordingCanvas(log), skipFonts: true, theme: 'base',
        branding: { tournamentName: 'Copa Horizonte 2026', showArma2Branding: true }, ...extra,
      });
      return { log, prepared };
    };
    const without = await render({});
    const withSponsors = await render({ sponsors: SPONSORS.slice(0, 3) });
    expect(withSponsors.log).toEqual(without.log);
    expect(withSponsors.prepared.renderKey).toBe(without.prepared.renderKey);
    expect(withSponsors.prepared.sponsors).toEqual([]);
    expect(bitmaps).toEqual([]);
  });
});

describe('Premium styles', () => {
  test('only a style with sponsors draws them, at most three, each with an identity and a logo', () => {
    expect(resolveDrawnSponsors(SPONSORS, 'base')).toEqual([]);
    expect(resolveDrawnSponsors(SPONSORS, 'heritage').map((entry) => entry.name)).toEqual(SPONSORS.slice(0, 3).map((entry) => entry.name));
    expect(resolveDrawnSponsors([{ id: 'a', name: 'Sin logo' }, SPONSORS[0]], 'street').map((entry) => entry.id)).toEqual([SPONSORS[0].id]);
    expect(resolveDrawnSponsors(null, 'street')).toEqual([]);
  });

  test('logos are preloaded into bitmaps: the composition receives bitmaps, never the signed URL', async () => {
    const snapshot = standings();
    const editorial = createEditorialState(snapshot);
    const prepared = await prepareSocialRender({
      snapshot, editorial, organizationId: ORG, skipFonts: true, theme: 'heritage', sponsors: SPONSORS.slice(0, 3),
    });
    const [call] = mockPremium.calls;
    expect(call.sponsors.map((entry) => entry.name)).toEqual(SPONSORS.slice(0, 3).map((entry) => entry.name));
    call.sponsors.forEach((entry, index) => {
      expect(entry.image).toBe(bitmaps[index]);
      expect(entry.image.source).toBe(SPONSORS[index].image);
    });
    expect(JSON.stringify(call.sponsors.map(({ image, ...rest }) => rest))).not.toMatch(/token|https?:/);
    expect(prepared.sponsors).toEqual(SPONSORS.slice(0, 3).map(({ id, name, logoPath }) => ({ id, name, logoPath })));
    expect(prepared.renderKey).not.toMatch(/token=/);
    releasePreparedSocialRender(prepared);
    expect(bitmaps.every((bitmap) => bitmap.closed)).toBe(true);
  });

  test('the key follows identity, name and logo object — not a re-signed URL', () => {
    const snapshot = standings();
    const base = {
      snapshot, content: null, editorial: createEditorialState(snapshot), format: SOCIAL_FORMATS.portrait,
      theme: resolveSocialTheme('street'), variant: null, assetPlan: {}, branding: {},
    };
    const key = (sponsors) => createSocialRenderKey({ ...base, sponsors });
    const one = [{ id: SPONSORS[0].id, name: SPONSORS[0].name, logoPath: logo(1) }];
    expect(key(one)).toBe(key([{ ...one[0], image: 'https://other-signature' }]));
    expect(key(one)).not.toBe(key([{ ...one[0], logoPath: logo(9) }]));
    expect(key(one)).not.toBe(key([{ ...one[0], name: 'Otro nombre' }]));
    expect(key(one)).not.toBe(key([]));
  });

  test('a chosen logo that cannot be read stops the render instead of dropping the sponsor', async () => {
    const snapshot = standings();
    await expect(prepareSocialRender({
      snapshot, editorial: createEditorialState(snapshot), organizationId: ORG, skipFonts: true, theme: 'street',
      sponsors: [SPONSORS[0], { ...SPONSORS[1], image: 'https://broken.example.test/logo.png' }],
    })).rejects.toMatchObject({ code: 'ASSET_SPONSOR_UNAVAILABLE' });
    expect(mockPremium.calls).toEqual([]);
    expect(bitmaps.every((bitmap) => bitmap.closed)).toBe(true);
  });
});
