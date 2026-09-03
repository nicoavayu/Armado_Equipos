import { createEditorialState, SOCIAL_FORMATS, SOCIAL_PIECE_IDS } from '../features/torneos/social/socialContracts';
import {
  BASE_SOCIAL_THEME,
  EDITORIAL_SOCIAL_THEME,
  HERITAGE_SOCIAL_THEME,
  SCOREBOARD_SOCIAL_THEME,
  SOCIAL_THEME_REGISTRY,
  STREET_SOCIAL_THEME,
  resolveSocialThemeLayout,
} from '../features/torneos/social/socialThemes';
import { prepareSocialRender, releasePreparedSocialRender } from '../features/torneos/social/socialStudio';

const ORGANIZATION = '11111111-1111-4111-8111-111111111111';

function snapshot() {
  return {
    schemaVersion: 1,
    piece: 'round_results',
    generatedAt: '2026-09-01T12:00:00.000Z',
    source: {
      organizationId: ORGANIZATION,
      tournamentId: 't-1', categoryId: 'c-1', phaseId: 'p-1', roundId: 'r-6',
      fixtureVersionId: 'f-1',
    },
    competition: {
      organizationName: 'Liga Horizonte', tournamentName: 'Copa Horizonte',
      categoryName: 'Primera', phaseName: 'Fase regular', roundName: 'Fecha 6',
      roundNumber: 6, timezone: 'America/Argentina/Buenos_Aires',
    },
    official: {
      matches: [{
        id: 'm-1', status: 'played',
        home: { participantId: 'home', name: 'Deportivo Belgrano', shieldPath: null },
        away: { participantId: 'away', name: 'Atlético Social del Sur', shieldPath: null },
        result: { homeScore: 3, awayScore: 1, homePenalties: null, awayPenalties: null },
      }],
    },
    capabilities: ['social.read', 'social.create', 'social.export'],
  };
}

function recordingCanvas(log) {
  const state = { font: '', fillStyle: '', textAlign: '', letterSpacing: '' };
  const record = (name) => (...args) => log.push(`${name}(${args.map(String).join(',')})`);
  const ctx = new Proxy({
    measureText: (text) => {
      const size = Number((state.font.match(/(\d+)px/) || [0, 16])[1]);
      return { width: String(text).length * size * 0.52 };
    },
    createRadialGradient: () => ({ addColorStop: record('gradient.stop') }),
    createLinearGradient: () => ({ addColorStop: record('gradient.stop') }),
    save: record('save'), restore: record('restore'), beginPath: record('beginPath'),
    closePath: record('closePath'), moveTo: record('moveTo'), lineTo: record('lineTo'),
    translate: record('translate'), rotate: record('rotate'), scale: record('scale'),
    quadraticCurveTo: record('quadraticCurveTo'), arc: record('arc'), fill: record('fill'),
    stroke: record('stroke'), clip: record('clip'), fillRect: record('fillRect'),
    strokeRect: record('strokeRect'), setLineDash: record('setLineDash'),
    fillText: record('fillText'), drawImage: record('drawImage'),
  }, {
    get(target, key) { return key in target ? target[key] : state[key]; },
    set(_target, key, value) { state[key] = value; log.push(`set:${String(key)}=${String(value)}`); return true; },
  });
  return (width, height) => ({
    width, height, setAttribute: jest.fn(), getContext: () => ctx,
    toBlob: (callback) => callback(new Blob(['png'], { type: 'image/png' })),
  });
}

async function render(theme, format = 'portrait') {
  const source = snapshot();
  const log = [];
  const prepared = await prepareSocialRender({
    snapshot: source,
    editorial: createEditorialState(source, { format }),
    organizationId: ORGANIZATION,
    theme,
    branding: { showArma2Branding: theme.id === 'base' },
    createCanvas: recordingCanvas(log),
    skipFonts: true,
  });
  return { prepared, log };
}

describe('Social Studio midpoint theme registry and renderer boundary', () => {
  test('registers five themes with eleven families and both exact formats', () => {
    expect(SOCIAL_THEME_REGISTRY.map(({ id }) => id)).toEqual([
      'base', 'heritage', 'street', 'scoreboard', 'editorial',
    ]);
    SOCIAL_THEME_REGISTRY.forEach((theme) => {
      expect(Object.keys(theme.families)).toEqual(SOCIAL_PIECE_IDS);
      SOCIAL_PIECE_IDS.forEach((familyId) => {
        expect(theme.families[familyId].layouts).toEqual({
          portrait: `${familyId}:portrait`, story: `${familyId}:story`,
        });
        expect(resolveSocialThemeLayout(theme.id, familyId, 'portrait'))
          .toBe(`${familyId}:portrait`);
      });
    });
  });

  test('keeps Base visual tokens and its Canvas implementation stable', async () => {
    expect(BASE_SOCIAL_THEME).toMatchObject({
      id: 'base', background: '#08090C', backgroundDeep: '#11131A',
      surface: 'rgba(255, 255, 255, 0.035)', display: 'Bebas Neue',
      heading: 'Oswald', body: 'Inter',
    });
    const { prepared, log } = await render(BASE_SOCIAL_THEME);
    expect(prepared.theme.id).toBe('base');
    expect(log.length).toBeGreaterThan(100);
    releasePreparedSocialRender(prepared);
  });

  test.each([
    ['Heritage', HERITAGE_SOCIAL_THEME, 'Anton'],
    ['Street', STREET_SOCIAL_THEME, 'Archivo Black'],
    ['Scoreboard', SCOREBOARD_SOCIAL_THEME, 'IBM Plex Sans Condensed'],
    ['Editorial', EDITORIAL_SOCIAL_THEME, 'Libre Franklin'],
  ])('%s uses its independent renderer in both exact export sizes', async (_label, theme, face) => {
    const portrait = await render(theme, 'portrait');
    const story = await render(theme, 'story');
    expect(portrait.prepared.canvas).toBeNull();
    expect(portrait.prepared.node.style).toMatchObject({
      width: `${SOCIAL_FORMATS.portrait.width}px`, height: `${SOCIAL_FORMATS.portrait.height}px`,
    });
    expect(story.prepared.node.style).toMatchObject({
      width: `${SOCIAL_FORMATS.story.width}px`, height: `${SOCIAL_FORMATS.story.height}px`,
    });
    expect(portrait.prepared.node.innerHTML).toContain(face);
    expect(portrait.prepared.node.innerHTML).not.toMatch(/NaN|Infinity|undefined/);
    expect(story.prepared.node.innerHTML).not.toMatch(/NaN|Infinity|undefined/);
    releasePreparedSocialRender(portrait.prepared);
    releasePreparedSocialRender(story.prepared);
  });

  test('preview and export share deterministic theme output and keys', async () => {
    const first = await render(HERITAGE_SOCIAL_THEME);
    const second = await render(HERITAGE_SOCIAL_THEME);
    expect(second.prepared.renderKey).toBe(first.prepared.renderKey);
    expect(second.prepared.node.innerHTML).toBe(first.prepared.node.innerHTML);
    releasePreparedSocialRender(first.prepared);
    releasePreparedSocialRender(second.prepared);
  });

  test('Premium dispatcher never falls back to Base Canvas', async () => {
    const rendered = await render(SCOREBOARD_SOCIAL_THEME);
    expect(rendered.prepared.canvas).toBeNull();
    expect(rendered.log).toEqual([]);
    expect(rendered.prepared.node.dataset.theme).toBe('scoreboard');
    releasePreparedSocialRender(rendered.prepared);
  });
});
