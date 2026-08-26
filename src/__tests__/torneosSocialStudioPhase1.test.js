import { createEditorialState, SOCIAL_FORMATS } from '../features/torneos/social/socialContracts';
import { formatSocialDateTime } from '../features/torneos/social/socialDateTime';
import { adaptSnapshotToResultsContent } from '../features/torneos/social/resultsContent';
import { resolveResultsVariant } from '../features/torneos/social/resultsVariants';
import { ensureSocialFonts } from '../features/torneos/social/socialRenderer';
import { DEFAULT_SOCIAL_THEME } from '../features/torneos/social/socialThemes';
import {
  createSocialAssetPlan,
  createSocialRenderKey,
  exportSocialPiece,
  prepareSocialRender,
  releasePreparedSocialRender,
  replacePreparedSocialRender,
} from '../features/torneos/social/socialStudio';

const ORGANIZATION = '11111111-1111-4111-8111-111111111111';

const team = (name, shieldPath) => ({
  participantId: `p-${name}`, name, shortName: name.slice(0, 12), shieldPath,
});

function resultsSnapshot(matches = null) {
  return {
    schemaVersion: 1,
    piece: 'round_results',
    generatedAt: '2026-08-03T12:00:00.000Z',
    source: {
      organizationId: ORGANIZATION,
      tournamentId: 't-1',
      categoryId: 'c-1',
      phaseId: 'p-1',
      roundId: 'r-6',
      fixtureVersionId: 'f-1',
    },
    competition: {
      organizationName: 'Liga Horizonte',
      tournamentName: 'Copa Horizonte',
      categoryName: 'Primera',
      phaseName: 'Fase regular',
      roundName: 'Fecha 6',
      roundNumber: 6,
      timezone: 'America/Argentina/Buenos_Aires',
    },
    official: {
      matches: matches || [{
        id: 'm-1',
        status: 'played',
        home: team('Deportivo Belgrano', 'shields/belgrano.png'),
        away: team('Atlético Sur', 'shields/sur.png'),
        result: {
          homeScore: 3, awayScore: 1, homePenalties: null, awayPenalties: null,
        },
      }],
    },
    capabilities: ['social.read', 'social.create', 'social.export'],
  };
}

function recordingContext(log) {
  const state = { font: '', fillStyle: '', textAlign: '', letterSpacing: '' };
  const record = (name) => (...args) => log.push(`${name}(${args.map(String).join(',')})`);
  return new Proxy({
    measureText: (text) => {
      const size = Number((state.font.match(/(\d+)px/) || [0, 16])[1]);
      return { width: String(text).length * size * 0.52 };
    },
    createRadialGradient: () => ({ addColorStop: record('gradient.stop') }),
    createLinearGradient: () => ({ addColorStop: record('gradient.stop') }),
    save: record('save'),
    restore: record('restore'),
    beginPath: record('beginPath'),
    closePath: record('closePath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    quadraticCurveTo: record('quadraticCurveTo'),
    arc: record('arc'),
    fill: record('fill'),
    stroke: record('stroke'),
    clip: record('clip'),
    fillRect: record('fillRect'),
    fillText: record('fillText'),
    drawImage: record('drawImage'),
  }, {
    get(target, key) { return key in target ? target[key] : state[key]; },
    set(_target, key, value) {
      state[key] = value;
      log.push(`set:${String(key)}=${String(value)}`);
      return true;
    },
  });
}

function canvasFactory(log, toBlob = jest.fn((callback) => (
  callback(new Blob(['png'], { type: 'image/png' }))
))) {
  return (width, height) => ({
    width,
    height,
    setAttribute: jest.fn(),
    getContext: () => recordingContext(log),
    toBlob,
  });
}

describe('Social Studio Phase 1 results pipeline', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    delete global.fetch;
    delete global.createImageBitmap;
  });

  test('adapts one official snapshot without mutation or theme knowledge', () => {
    const snapshot = resultsSnapshot();
    const before = JSON.stringify(snapshot);
    const content = adaptSnapshotToResultsContent(snapshot, { note: 'Cierre de la fecha' });

    expect(content).toEqual(expect.objectContaining({
      kind: 'results',
      competition: expect.objectContaining({
        tournamentName: 'Copa Horizonte',
        stageName: 'Fase regular',
        roundNumber: 6,
        timezone: 'America/Argentina/Buenos_Aires',
      }),
      additionalNote: 'Cierre de la fecha',
    }));
    expect(content.matches[0]).toEqual(expect.objectContaining({
      id: 'm-1', status: 'played', score: { home: 3, away: 1, homePenalties: null, awayPenalties: null },
    }));
    expect(content).not.toHaveProperty('theme');
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  test.each([
    [2, 'portrait', 'compact'],
    [4, 'portrait', 'standard'],
    [5, 'portrait', 'standard'],
    [6, 'portrait', 'dense'],
    [8, 'portrait', 'dense'],
    [9, 'portrait', 'overflow'],
    [4, 'story', 'compact'],
    [8, 'story', 'standard'],
    [10, 'story', 'dense'],
  ])('resolves %i %s matches as %s', (matchCount, format, expected) => {
    expect(resolveResultsVariant({ matchCount, format }).id).toBe(expected);
  });

  test('results receives the theme explicitly', async () => {
    const snapshot = resultsSnapshot([{
      id: 'm-1', status: 'played',
      home: team('Local', null), away: team('Visita', null),
      result: { homeScore: 1, awayScore: 0 },
    }]);
    const theme = { ...DEFAULT_SOCIAL_THEME, surface: '#123456' };
    const log = [];
    await prepareSocialRender({
      snapshot,
      editorial: createEditorialState(snapshot),
      organizationId: ORGANIZATION,
      theme,
      createCanvas: canvasFactory(log),
      skipFonts: true,
    });
    expect(log).toContain('set:fillStyle=#123456');
  });

  test('schedule formatting is independent from the process timezone', () => {
    const previous = process.env.TZ;
    process.env.TZ = 'UTC';
    const first = formatSocialDateTime(
      '2026-08-09T21:00:00.000Z', 'America/Argentina/Buenos_Aires',
    );
    process.env.TZ = 'Pacific/Honolulu';
    const second = formatSocialDateTime(
      '2026-08-09T21:00:00.000Z', 'America/Argentina/Buenos_Aires',
    );
    process.env.TZ = previous;
    expect(second).toBe(first);
    expect(first).not.toBe(formatSocialDateTime('2026-08-09T21:00:00.000Z', 'UTC'));
  });

  test('font readiness fails closed when a required face is missing', async () => {
    const originalFonts = document.fonts;
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: {
        load: jest.fn().mockResolvedValue([]),
        check: jest.fn(() => false),
        ready: Promise.resolve(),
      },
    });
    await expect(ensureSocialFonts()).rejects.toMatchObject({
      code: 'SOCIAL_FONTS_UNAVAILABLE',
    });
    Object.defineProperty(document, 'fonts', { configurable: true, value: originalFonts });
  });

  test('render keys are stable and change with content, format and theme', () => {
    const snapshot = resultsSnapshot();
    const editorial = createEditorialState(snapshot);
    const content = adaptSnapshotToResultsContent(snapshot, editorial);
    const variant = resolveResultsVariant({ matchCount: 1, format: editorial.format });
    const assetPlan = createSocialAssetPlan(snapshot, editorial, content);
    const input = {
      snapshot,
      content,
      editorial,
      format: SOCIAL_FORMATS.portrait,
      theme: DEFAULT_SOCIAL_THEME,
      variant,
      assetPlan,
    };
    const key = createSocialRenderKey(input);
    expect(createSocialRenderKey(input)).toBe(key);
    expect(createSocialRenderKey({
      ...input, theme: { ...DEFAULT_SOCIAL_THEME, id: 'changed' },
    })).not.toBe(key);
    expect(createSocialRenderKey({
      ...input, format: SOCIAL_FORMATS.story,
    })).not.toBe(key);
    expect(createSocialRenderKey({
      ...input, content: { ...content, additionalNote: 'Otra nota' },
    })).not.toBe(key);
  });

  test('replacement and unmount release the bitmaps prepared by the real flow', async () => {
    const firstClose = jest.fn();
    const secondClose = jest.fn();
    let generation = 0;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, blob: async () => new Blob(['crest'], { type: 'image/png' }),
    });
    global.createImageBitmap = jest.fn().mockImplementation(async () => ({
      width: 40,
      height: 40,
      close: generation++ < 2 ? firstClose : secondClose,
    }));
    const snapshot = resultsSnapshot();
    const options = {
      snapshot,
      editorial: createEditorialState(snapshot),
      organizationId: ORGANIZATION,
      resolveShieldUrl: (path) => `https://crest.local/${path}`,
      createCanvas: canvasFactory([]),
      skipFonts: true,
    };
    const first = await prepareSocialRender(options);
    const second = await prepareSocialRender(options);
    const ref = { current: null };
    replacePreparedSocialRender(ref, first);
    replacePreparedSocialRender(ref, second);
    expect(firstClose).toHaveBeenCalledTimes(2);
    expect(secondClose).not.toHaveBeenCalled();
    releasePreparedSocialRender(ref.current);
    ref.current = null;
    expect(secondClose).toHaveBeenCalledTimes(2);
  });

  test('export encodes the prepared preview canvas without loading assets again', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, blob: async () => new Blob(['crest'], { type: 'image/png' }),
    });
    global.createImageBitmap = jest.fn().mockResolvedValue({
      width: 40, height: 40, close: jest.fn(),
    });
    const snapshot = resultsSnapshot();
    const editorial = createEditorialState(snapshot);
    const toBlob = jest.fn((callback) => callback(new Blob(['png'], { type: 'image/png' })));
    const prepared = await prepareSocialRender({
      snapshot,
      editorial,
      organizationId: ORGANIZATION,
      resolveShieldUrl: (path) => `https://crest.local/${path}`,
      createCanvas: canvasFactory([], toBlob),
      skipFonts: true,
    });
    const fetchesAfterPreview = global.fetch.mock.calls.length;
    const result = await exportSocialPiece({ prepared, snapshot, editorial });
    expect(result.blob.type).toBe('image/png');
    expect(toBlob).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledTimes(fetchesAfterPreview);
    releasePreparedSocialRender(prepared);
  });
});
