// Premium placas fit their canvas and their data: no layer drawn outside 1080×1350 / 1080×1920, team names that break
// only between words, both scores of a draw, a Figura without photo that shows a whole first name and labels its
// numbers as what they are, and Base (FREE) drawn exactly as on main. jsdom has no layout, so what needs one is
// measured in real Chromium by scripts/qa/social-studio/browser-check.cjs (the "Premium placas fit" check); here the
// geometry that is fixed by the templates (positioned layers, negative margins) is computed from their styles.
import { createHash } from 'crypto';
import { createPremiumDomRender, releasePremiumDomRender } from '../features/torneos/social/premium/premiumDomRenderer';
import { createPremiumViewModel, figureDisplayName } from '../features/torneos/social/premium/premiumDataAdapter';
import { SOCIAL_FORMATS, SOCIAL_PIECE_IDS, createEditorialState } from '../features/torneos/social/socialContracts';
import { drawSocialPiece } from '../features/torneos/social/socialStudio';
import {
  BASE_SOCIAL_THEME,
  EDITORIAL_SOCIAL_THEME,
  HERITAGE_SOCIAL_THEME,
  SCOREBOARD_SOCIAL_THEME,
  STREET_SOCIAL_THEME,
} from '../features/torneos/social/socialThemes';
import { socialQaSnapshot } from '../testUtils/socialStudioSnapshots';

const PREMIUM_THEMES = [HERITAGE_SOCIAL_THEME, STREET_SOCIAL_THEME, SCOREBOARD_SOCIAL_THEME, EDITORIAL_SOCIAL_THEME];
const FORMATS = ['portrait', 'story'];
const CANVAS = { portrait: [1080, 1350], story: [1080, 1920] };

const teams = [
  { participantId: 'gal', name: 'Los Galácticos', shortName: 'GAL' },
  { participantId: 'tik', name: 'Tiki-Taka', shortName: 'TIK' },
  { participantId: 'tap', name: 'Deportivo Tapita', shortName: 'TAP' },
  { participantId: 'tan', name: 'El Tanque', shortName: 'TAN' },
];

function primavera(piece, { longNames = false } = {}) {
  const candidates = ['Nico', 'Fran Ruiz', 'Juani Paz', 'Santi Sosa', 'Pipe Gómez'].map((name, index) => ({
    rosterPlayerId: `player-${index}`,
    name,
    position: ['DEL', 'DEL', 'DEL', 'MED', 'ARQ'][index],
    isGoalkeeper: index === 4,
    team: teams[index % teams.length],
    goals: 7 - index,
    appearances: 7,
  }));
  const home = longNames
    ? [{ ...teams[0], name: 'Los Galácticos Deportivo' }, { ...teams[2], name: 'Defensores Unidos de Villa Constitución' }]
    : [teams[0], teams[2]];
  const unplayed = piece === 'next_fixture';
  return {
    schemaVersion: 2,
    piece,
    generatedAt: '2027-10-17T23:00:00.000Z',
    competition: {
      tournamentName: 'Copa Primavera', categoryName: 'Libre', seasonName: '2027', phaseName: 'Fase regular',
      roundName: 'Fecha 7', roundNumber: 7, timezone: 'America/Argentina/Buenos_Aires', teamSize: 5,
    },
    official: {
      matches: [
        {
          id: 'm1', scheduledAt: '2027-10-17T21:00:00.000Z', venueName: 'Sede Norte · Cancha 1',
          home: home[0], away: teams[1], result: unplayed ? null : { homeScore: 3, awayScore: 1 },
        },
        {
          id: 'm2', scheduledAt: '2027-10-17T22:00:00.000Z', venueName: 'Sede Norte · Cancha 2',
          home: home[1], away: teams[3], result: unplayed ? null : { homeScore: 3, awayScore: 3 },
        },
      ],
      rows: teams.map((team, index) => ({
        ...team, position: index + 1, played: 7, won: 5 - index, drawn: 1, lost: index + 1,
        goalsFor: 20 - index, goalsAgainst: 8 + index, goalDifference: 12 - index * 3, points: 16 - index * 3,
      })),
      players: candidates,
      candidates,
      teamSize: 5,
      officialChampion: { ...teams[0], points: 16, goalDifference: 12, played: 7 },
    },
  };
}

function render(theme, piece, format, options = {}) {
  const snapshot = options.snapshot || primavera(piece, options);
  return createPremiumDomRender({
    snapshot,
    editorial: { format, selection: snapshot.official.candidates.map(({ rosterPlayerId }) => rosterPlayerId) },
    assets: { shields: {}, photo: null, branding: {} },
    branding: { tournamentName: snapshot.competition.tournamentName, showArma2Branding: false },
    sponsors: [],
    theme,
  });
}

const leaves = (node) => Array.from(node.querySelectorAll('*')).filter((element) => element.children.length === 0);
const leafTexts = (node) => leaves(node).map((element) => element.textContent.trim()).filter(Boolean);

const EVERY_CASE = PREMIUM_THEMES.flatMap((theme) => SOCIAL_PIECE_IDS.flatMap((piece) => FORMATS.map((format) => (
  [theme.id, piece, format, theme]
))));
const THEME_FORMATS = PREMIUM_THEMES.flatMap((theme) => FORMATS.map((format) => [theme.id, format, theme]));

// ── canvas bounds ──────────────────────────────────────────────────────────────────────────────────────────────────
function px(value) {
  const normalized = String(value ?? '').trim();
  if (normalized === '0') return 0;
  const match = /^(-?[\d.]+)px$/.exec(normalized);
  return match ? Number(match[1]) : null;
}

// The width of a positioned layer: its own width, or (a row of bars) the sum of its children and their gaps.
function layerSize(element, axis) {
  const own = px(axis === 'x' ? element.style.width : element.style.height);
  if (own != null) return own;
  if (element.style.display !== 'flex' || !element.children.length) return null;
  const row = (element.style.flexDirection || 'row') === 'row';
  const sizes = Array.from(element.children).map((child) => px(axis === 'x' ? child.style.width : child.style.height));
  if (sizes.some((size) => size == null)) return null;
  const gap = px(element.style.gap) || 0;
  return (row === (axis === 'x'))
    ? sizes.reduce((sum, size) => sum + size, 0) + gap * (sizes.length - 1)
    : Math.max(...sizes);
}

// The box a positioned layer of the composition covers, rotation included (transform-origin is the centre).
function layerBox(element, [width, height]) {
  const w = layerSize(element, 'x');
  const h = layerSize(element, 'y');
  if (w == null || h == null) return null;
  const left = px(element.style.left) ?? (px(element.style.right) != null ? width - px(element.style.right) - w : null);
  const top = px(element.style.top) ?? (px(element.style.bottom) != null ? height - px(element.style.bottom) - h : null);
  if (left == null || top == null) return null;
  const angle = Number((/rotate\((-?[\d.]+)deg\)/.exec(element.style.transform) || [0, 0])[1]) * (Math.PI / 180);
  const halfW = (Math.abs(Math.cos(angle)) * w + Math.abs(Math.sin(angle)) * h) / 2;
  const halfH = (Math.abs(Math.sin(angle)) * w + Math.abs(Math.cos(angle)) * h) / 2;
  const cx = left + w / 2;
  const cy = top + h / 2;
  return { left: cx - halfW, top: cy - halfH, right: cx + halfW, bottom: cy + halfH };
}

describe('Premium placas stay inside their canvas', () => {
  test.each(EVERY_CASE)('%s %s/%s: no layer of the composition is placed outside the canvas', (_id, piece, format, theme) => {
    const rendered = render(theme, piece, format);
    const composition = rendered.node.firstElementChild;
    const canvas = CANVAS[format];
    expect([px(composition.style.width), px(composition.style.height)]).toEqual(canvas);
    const layers = Array.from(composition.children).filter((child) => child.style.position === 'absolute');
    const measured = layers.map((layer) => [layer, layerBox(layer, canvas)]).filter(([, box]) => box);
    // Heritage and Street draw decoration layers (halftones, stripes, bars) at fixed coordinates: they are measured.
    if (['heritage', 'street'].includes(theme.id)) expect(measured.length).toBeGreaterThan(0);
    measured.forEach(([layer, box]) => {
      expect({ layer: layer.getAttribute('style'), box }).toEqual({
        layer: layer.getAttribute('style'),
        box: {
          left: expect.toBeWithin(-0.5, canvas[0]),
          top: expect.toBeWithin(-0.5, canvas[1]),
          right: expect.toBeWithin(0, canvas[0] + 0.5),
          bottom: expect.toBeWithin(0, canvas[1] + 0.5),
        },
      });
    });
    // A band that bleeds with a negative margin never reaches past the page column's own padding.
    const page = Array.from(composition.children).find((child) => child.style.position !== 'absolute' && child.children.length);
    Array.from(page?.children || []).forEach((child) => {
      ['Left', 'Right'].forEach((side) => {
        const margin = px(child.style[`margin${side}`]);
        if (margin == null || margin >= 0) return;
        expect({ side, margin, padding: px(page.style[`padding${side}`]) })
          .toEqual({ side, margin, padding: expect.toBeWithin(-margin, Number.POSITIVE_INFINITY) });
      });
    });
    releasePremiumDomRender(rendered);
  });

  test('Street keeps its halftones exactly where they were drawn, only cut at the canvas edge', () => {
    const feed = render(STREET_SOCIAL_THEME, 'standings', 'portrait');
    const [topLeft, bottomRight] = Array.from(feed.node.firstElementChild.children)
      .filter((child) => child.style.maskImage);
    expect(topLeft.style).toMatchObject({
      left: '0px', top: '0px', width: '280px', height: '190px',
      backgroundPosition: '-40px -30px', maskSize: '320px 220px', maskPosition: '-40px -30px',
    });
    expect(bottomRight.style).toMatchObject({
      right: '0px', bottom: '0px', width: '300px', height: '260px', maskSize: '360px 300px',
    });
    releasePremiumDomRender(feed);
  });
});

// expect.toBeWithin for the bounds above (inclusive).
expect.extend({
  toBeWithin(received, floor, ceiling) {
    const pass = typeof received === 'number' && received >= floor && received <= ceiling;
    return { pass, message: () => `expected ${received} to be within [${floor}, ${ceiling}]` };
  },
});

// ── team names ──────────────────────────────────────────────────────────────────────────────────────────────────────
describe('Premium team names break only between words', () => {
  // Same deterministic box model as torneosSocialPremiumSnapshotBinding: 0.6em per character, a 220px name cell.
  const CELL = 220;
  const longestWord = (node) => Math.max(...node.textContent.trim().split(/\s+/).map((word) => word.length));
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get() { return this.dataset?.premiumNameFit ? CELL : 0; },
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
      configurable: true,
      get() {
        if (!this.dataset?.premiumNameFit) return 0;
        const size = Number.parseFloat(this.style.fontSize) || 16;
        return Math.max(CELL, Math.ceil(longestWord(this) * size * 0.6));
      },
    });
  });
  afterEach(() => {
    delete HTMLElement.prototype.clientWidth;
    delete HTMLElement.prototype.scrollWidth;
  });

  const assertWordsFit = (rendered, expected) => {
    const fitted = Array.from(rendered.node.querySelectorAll('[data-premium-name-fit]'));
    expect(fitted.length).toBeGreaterThanOrEqual(expected);
    fitted.forEach((leaf) => {
      expect(leaf.dataset.premiumNameFit).toBe('words');
      expect(leaf.style.overflowWrap).toBe('normal');
      expect(longestWord(leaf) * Number.parseFloat(leaf.style.fontSize) * 0.6).toBeLessThanOrEqual(CELL + 1);
    });
  };

  test.each(THEME_FORMATS)('%s %s semifinals shrink long names instead of breaking a word', (_id, format, theme) => {
    const rendered = render(theme, 'semifinals', format, { longNames: true });
    assertWordsFit(rendered, 4);
    releasePremiumDomRender(rendered);
  });

  test.each(THEME_FORMATS)('%s %s next fixture never breaks a name at any letter', (_id, format, theme) => {
    const rendered = render(theme, 'next_fixture', format, { longNames: true });
    assertWordsFit(rendered, 4);
    expect(Array.from(rendered.node.querySelectorAll('*')).some((node) => node.style.overflowWrap === 'anywhere'))
      .toBe(false);
    releasePremiumDomRender(rendered);
  });
});

// ── scores ──────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('Scoreboard story results size both scores of a draw', () => {
  test('3 – 3: the second 3 gets the same size as the first, inside its own half-row', () => {
    const rendered = render(SCOREBOARD_SOCIAL_THEME, 'round_results', 'story');
    const cells = Array.from(rendered.node.querySelectorAll('[data-premium-score="fitted"]'));
    expect(cells).toHaveLength(4);
    expect(cells.map((cell) => cell.textContent.trim())).toEqual(['3', '1', '3', '3']);
    const sizes = cells.flatMap((cell) => [cell, ...cell.querySelectorAll('*')].map((node) => node.style.fontSize));
    expect(new Set(sizes)).toEqual(new Set(['68px']));
    cells.forEach((cell) => expect(cell.style.overflow).toBe('hidden'));
    releasePremiumDomRender(rendered);
  });
});

// ── Figura ──────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('Figura without photo', () => {
  test('the display name is the whole first name, never a three-letter stub', () => {
    expect(figureDisplayName('Nico', 'heritage')).toBe('NICO');
    expect(figureDisplayName('Nico Vera', 'street')).toBe('NICO');
    expect(figureDisplayName('Maximiliano', 'scoreboard')).toBe('MAXIMILIANO');
    expect(figureDisplayName('Nico', 'editorial')).toBe('Nico');
    expect(figureDisplayName('', 'heritage')).toBe('');
  });

  test.each(THEME_FORMATS)('%s %s shows NICO whole and labels the numbers as the tournament\'s', (_id, format, theme) => {
    const rendered = render(theme, 'mvp', format);
    const texts = leafTexts(rendered.node);
    const name = theme.id === 'editorial' ? 'Nico' : 'NICO';
    expect(texts).toContain(name);
    expect(texts).not.toContain('NIC');
    expect(texts).not.toContain('N');
    expect(texts).toEqual(expect.arrayContaining(['GOLES EN EL TORNEO', 'PARTIDOS EN EL TORNEO']));
    expect(texts).not.toContain('GOLES');
    expect(texts).not.toContain('PARTIDOS');
    const display = leaves(rendered.node).filter((leaf) => leaf.textContent.trim() === name
      && Number.parseFloat(leaf.style.fontSize) >= 150);
    expect(display.length).toBe(1);
    expect(display[0].dataset.premiumFigureName).toBe('fit');
    expect(display[0].style.whiteSpace).toBe('nowrap');
    releasePremiumDomRender(rendered);
  });

  test('the round selection keeps its title; the numbers come from the snapshot candidate', () => {
    const viewModel = createPremiumViewModel({
      snapshot: primavera('mvp'), editorial: { format: 'portrait' }, themeId: 'heritage', formatId: 'portrait',
    });
    expect([viewModel.t1, viewModel.t2]).toEqual(['FIGURA', 'DE LA FECHA']);
    expect(viewModel.figStats).toEqual([
      { v: '7', l: 'GOLES EN EL TORNEO' },
      { v: '7', l: 'PARTIDOS EN EL TORNEO' },
    ]);
  });
});

// ── Base (FREE) unchanged ───────────────────────────────────────────────────────────────────────────────────────────
// The sequence of canvas operations of every FREE piece, hashed. The pins were computed on main (b4fb150a) with this
// same recorder: Base is not part of this change and must draw exactly what it drew.
function recordingContext(log) {
  const state = { font: '' };
  const record = (name) => (...args) => {
    log.push(`${name}(${args.map((value) => (typeof value === 'object' && value !== null ? '[obj]' : String(value))).join(',')})`);
  };
  return new Proxy({
    measureText: (value) => {
      const size = Number((String(state.font).match(/(\d+(?:\.\d+)?)px/) || [0, 16])[1]);
      return { width: String(value).length * size * 0.52, actualBoundingBoxAscent: size * 0.72, actualBoundingBoxDescent: size * 0.2 };
    },
    createRadialGradient: (...args) => { record('radialGradient')(...args); return { addColorStop: record('stop') }; },
    createLinearGradient: (...args) => { record('linearGradient')(...args); return { addColorStop: record('stop') }; },
    createPattern: () => ({}),
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
  }, {
    get(target, key) {
      if (key in target) return target[key];
      if (typeof key === 'string' && /^[a-z][A-Za-z]*$/.test(key) && !(key in state)) return record(key);
      return state[key];
    },
    set(_target, key, value) {
      state[key] = value;
      log.push(`set:${String(key)}=${typeof value === 'object' && value !== null ? '[obj]' : String(value)}`);
      return true;
    },
  });
}

const FREE_PINS = {
  'round_results:portrait': '996dc37e47844862567ca81a',
  'round_results:story': '16bb4601f04212496b3e0414',
  'standings:portrait': '61af00d7f272dd025b2bfbf9',
  'standings:story': 'c8d1d1be084f9fae19382675',
  'next_fixture:portrait': '91471238eafe3316a434bc4b',
  'next_fixture:story': 'e17e91a0e8565e288a137235',
};

describe('Base (FREE) placas are drawn exactly as on main', () => {
  test.each(Object.keys(FREE_PINS))('%s', (key) => {
    const [piece, format] = key.split(':');
    const snapshot = socialQaSnapshot(piece);
    const log = [];
    drawSocialPiece(recordingContext(log), {
      snapshot,
      editorial: createEditorialState(snapshot, { format }),
      assets: { shields: {}, photo: null, branding: {} },
      format: SOCIAL_FORMATS[format],
      theme: BASE_SOCIAL_THEME,
      branding: { tournamentName: snapshot.competition.tournamentName, showArma2Branding: true },
    });
    expect(log.length).toBeGreaterThan(200);
    expect(createHash('sha256').update(log.join('\n')).digest('hex').slice(0, 24)).toBe(FREE_PINS[key]);
  });
});
