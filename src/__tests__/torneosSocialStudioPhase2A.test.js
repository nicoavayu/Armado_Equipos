import { createEditorialState, SOCIAL_FORMATS } from '../features/torneos/social/socialContracts';
import { adaptSnapshotToResultsContent } from '../features/torneos/social/resultsContent';
import {
  resolveResultsDensityTuning,
  resolveResultsVariant,
} from '../features/torneos/social/resultsVariants';
import {
  CLASSIC_SOCIAL_THEME,
  DEFAULT_SOCIAL_THEME,
  EDITORIAL_SOCIAL_THEME,
  STREET_SOCIAL_THEME,
} from '../features/torneos/social/socialThemes';
import {
  RESULTS_CANVAS_SIZE,
  RESULTS_LAYOUT_TUNING,
  RESULTS_MIN_SAFE_INSET,
  resolveResultsLayoutTuning,
} from '../features/torneos/social/resultsLayoutTuning';
import {
  createSocialAssetPlan,
  createSocialRenderKey,
  prepareSocialRender,
  releasePreparedSocialRender,
  replacePreparedSocialRender,
} from '../features/torneos/social/socialStudio';

const ORGANIZATION = '11111111-1111-4111-8111-111111111111';

const team = (name, shieldPath = null) => ({
  participantId: `p-${name}`, name, shortName: name.slice(0, 12), shieldPath,
});

function resultsSnapshot(matchCount = 2) {
  return {
    schemaVersion: 1,
    piece: 'round_results',
    generatedAt: '2026-08-03T12:00:00.000Z',
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
      matches: Array.from({ length: matchCount }, (_unused, index) => ({
        id: `m-${index}`, status: 'played',
        home: team(`Deportivo Belgrano ${index + 1}`, index === 0 ? 'home.png' : null),
        away: team(`Atlético Social del Sur ${index + 1}`),
        result: { homeScore: index + 1, awayScore: index, homePenalties: null, awayPenalties: null },
      })),
    },
    capabilities: ['social.read', 'social.create', 'social.export'],
  };
}

function standingsSnapshot() {
  const snapshot = resultsSnapshot(0);
  return {
    ...snapshot,
    piece: 'standings',
    official: { rows: [] },
  };
}

function stressedResultsSnapshot(matchCount = 2) {
  const snapshot = resultsSnapshot(matchCount);
  const longHome = 'LOS PIBES DEL PARQUE CENTRAL Y BIBLIOTECA POPULAR';
  const longAway = 'SOCIAL Y DEPORTIVO CONSTITUCIÓN';
  return {
    ...snapshot,
    competition: {
      ...snapshot.competition,
      organizationName: 'ASOCIACIÓN METROPOLITANA DE FÚTBOL AMATEUR DEL RÍO DE LA PLATA',
      tournamentName: 'TORNEO METROPOLITANO DE FÚTBOL AMATEUR 2026',
    },
    official: {
      matches: snapshot.official.matches.map((match, index) => ({
        ...match,
        home: { ...match.home, name: `${longHome} ${index + 1}`, shortName: null, shieldPath: null },
        away: { ...match.away, name: `${longAway} ${index + 1}`, shortName: null, shieldPath: null },
      })),
    },
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
}

function canvasFactory(log, createSpy = null) {
  return (width, height) => {
    createSpy?.();
    return {
      width, height, setAttribute: jest.fn(), getContext: () => recordingContext(log),
      toBlob: (callback) => callback(new Blob(['png'], { type: 'image/png' })),
    };
  };
}

function renderOptions(overrides = {}) {
  const snapshot = overrides.snapshot || resultsSnapshot();
  return {
    snapshot,
    editorial: createEditorialState(snapshot),
    organizationId: ORGANIZATION,
    createCanvas: canvasFactory(overrides.log || []),
    skipFonts: true,
    ...overrides,
  };
}

describe('Social Studio Phase 2A themes and branding', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    delete global.fetch;
    delete global.createImageBitmap;
  });

  test('Base is the default and exposes the approved visual tokens', async () => {
    expect(DEFAULT_SOCIAL_THEME).toBe(CLASSIC_SOCIAL_THEME);
    expect(CLASSIC_SOCIAL_THEME).toMatchObject({
      id: 'base', background: '#08090C', backgroundDeep: '#11131A',
      surface: 'rgba(255, 255, 255, 0.035)', display: 'Bebas Neue', heading: 'Oswald',
      body: 'Inter', radii: { card: 0, match: 0 },
    });
    const log = [];
    await prepareSocialRender(renderOptions({ log, theme: CLASSIC_SOCIAL_THEME }));
    expect(log.length).toBeGreaterThan(100);
    expect(log.some((entry) => entry.startsWith('fillText('))).toBe(true);
  });

  test('Street renders a structurally aggressive score-led composition', async () => {
    const log = [];
    const prepared = await prepareSocialRender(renderOptions({ log, theme: STREET_SOCIAL_THEME }));
    expect(prepared.theme.id).toBe('street');
    expect(log.some((entry) => entry.startsWith('fillText(Resultados,48,'))).toBe(true);
    expect(log.some((entry) => entry.startsWith('fillText(:,'))).toBe(true);
  });

  test('Editorial renders its independent broadcast column composition', async () => {
    const log = [];
    const prepared = await prepareSocialRender(renderOptions({ log, theme: EDITORIAL_SOCIAL_THEME }));
    expect(prepared.theme.id).toBe('editorial');
    expect(log).toContain('fillRect(0,0,238,1350)');
    expect(log.some((entry) => entry.startsWith('fillText(EDICIÓN DEPORTIVA,'))).toBe(true);
    expect(log.some((entry) => entry.startsWith('fillText(MARCADOR,'))).toBe(false);
  });

  test('changing theme changes renderKey', async () => {
    const classic = await prepareSocialRender(renderOptions({ theme: CLASSIC_SOCIAL_THEME }));
    const street = await prepareSocialRender(renderOptions({ theme: STREET_SOCIAL_THEME }));
    expect(street.renderKey).not.toBe(classic.renderKey);
  });

  test('changing branding changes renderKey', async () => {
    const first = await prepareSocialRender(renderOptions({ branding: { tournamentName: 'Copa Uno' } }));
    const second = await prepareSocialRender(renderOptions({ branding: { tournamentName: 'Copa Dos' } }));
    expect(second.renderKey).not.toBe(first.renderKey);
  });

  test('equal content and inputs produce deterministic output and keys', async () => {
    const firstLog = [];
    const secondLog = [];
    const first = await prepareSocialRender(renderOptions({ log: firstLog, theme: STREET_SOCIAL_THEME }));
    const second = await prepareSocialRender(renderOptions({ log: secondLog, theme: STREET_SOCIAL_THEME }));
    expect(second.renderKey).toBe(first.renderKey);
    expect(secondLog).toEqual(firstLog);
  });

  test('approved brand assets are planned for every Base family', () => {
    const snapshot = resultsSnapshot();
    const editorial = createEditorialState(snapshot);
    const content = adaptSnapshotToResultsContent(snapshot, editorial);
    const urls = { lockup: '/assets/social-studio/Logo%20Arma2_torneo.png' };
    const resultsPlan = createSocialAssetPlan(snapshot, editorial, content, { brandAssetUrls: urls });
    const other = standingsSnapshot();
    const standingsPlan = createSocialAssetPlan(other, createEditorialState(other), null, { brandAssetUrls: urls });
    expect(resultsPlan.branding).toEqual({
      tournamentLogoUrl: null,
      officialLockupUrl: '/assets/social-studio/Logo%20Arma2_torneo.png',
    });
    expect(standingsPlan.branding).toEqual({
      tournamentLogoUrl: null,
      officialLockupUrl: '/assets/social-studio/Logo%20Arma2_torneo.png',
    });
    expect(JSON.stringify(resultsPlan)).not.toMatch(/street|editorial/);
  });

  test('font and required-brand readiness fail closed before a canvas becomes exportable', async () => {
    const originalFonts = document.fonts;
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { load: jest.fn().mockResolvedValue([]), check: jest.fn(() => false), ready: Promise.resolve() },
    });
    const createSpy = jest.fn();
    await expect(prepareSocialRender(renderOptions({
      skipFonts: false, createCanvas: canvasFactory([], createSpy),
    }))).rejects.toMatchObject({ code: 'SOCIAL_FONTS_UNAVAILABLE' });
    expect(createSpy).not.toHaveBeenCalled();
    Object.defineProperty(document, 'fonts', { configurable: true, value: originalFonts });

    global.fetch = jest.fn().mockResolvedValue({ ok: false });
    await expect(prepareSocialRender(renderOptions({
      brandAssetUrls: { lockup: '/missing-official-lockup.png' },
      createCanvas: canvasFactory([], createSpy),
    }))).rejects.toMatchObject({ code: 'ASSET_BRAND_UNAVAILABLE' });
    expect(createSpy).not.toHaveBeenCalled();
  });

  test('an invalid theme falls back to Base deterministically', async () => {
    const invalidLog = [];
    const classicLog = [];
    const invalid = await prepareSocialRender(renderOptions({ log: invalidLog, theme: 'unknown-theme' }));
    const classic = await prepareSocialRender(renderOptions({ log: classicLog, theme: 'classic' }));
    expect(invalid.theme.id).toBe('base');
    expect(invalid.renderKey).toBe(classic.renderKey);
    expect(invalidLog).toEqual(classicLog);
  });

  test('replacement and unmount release official branding resources', async () => {
    const closes = Array.from({ length: 2 }, () => jest.fn());
    let bitmapIndex = 0;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, blob: async () => new Blob(['brand'], { type: 'image/png' }),
    });
    global.createImageBitmap = jest.fn().mockImplementation(async () => ({
      width: 100, height: 50, close: closes[bitmapIndex++],
    }));
    const options = renderOptions({
      snapshot: resultsSnapshot(0),
      brandAssetUrls: { lockup: '/official-lockup.png' },
    });
    const first = await prepareSocialRender(options);
    const second = await prepareSocialRender(options);
    const ref = { current: null };
    replacePreparedSocialRender(ref, first);
    replacePreparedSocialRender(ref, second);
    expect(closes[0]).toHaveBeenCalledTimes(1);
    expect(closes[1]).not.toHaveBeenCalled();
    releasePreparedSocialRender(ref.current);
    ref.current = null;
    expect(closes[1]).toHaveBeenCalledTimes(1);
  });

  test('missing tournament logo and crests render branded fallbacks without breaking layout', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false });
    const log = [];
    await expect(prepareSocialRender(renderOptions({
      log,
      theme: EDITORIAL_SOCIAL_THEME,
      branding: { tournamentName: 'Copa Horizonte', tournamentLogo: '/missing-tournament.png' },
    }))).resolves.toMatchObject({ theme: { id: 'editorial' } });
    expect(log.some((entry) => entry.startsWith('fillText(CH,337,'))).toBe(true);
    expect(log.some((entry) => entry.startsWith('fillText(DB'))).toBe(true);
  });

  test('each Results theme keeps critical regions inside its own 4:5 safe areas', () => {
    expect(resolveResultsLayoutTuning('unknown')).toBe(RESULTS_LAYOUT_TUNING.classic);
    Object.values(RESULTS_LAYOUT_TUNING).forEach((tuning) => {
      expect(tuning.safeInset).toBeGreaterThanOrEqual(RESULTS_MIN_SAFE_INSET);
      expect(tuning.body.x).toBeGreaterThanOrEqual(RESULTS_MIN_SAFE_INSET);
      expect(tuning.body.x + tuning.body.width)
        .toBeLessThanOrEqual(RESULTS_CANVAS_SIZE.width - RESULTS_MIN_SAFE_INSET);
      expect(tuning.body.bottom).toBeLessThan(tuning.footer.lockup.y);
      expect(tuning.footer.lockup.y + tuning.footer.lockup.height)
        .toBeLessThanOrEqual(RESULTS_CANVAS_SIZE.height - RESULTS_MIN_SAFE_INSET);
    });
    expect(new Set(Object.values(RESULTS_LAYOUT_TUNING).map((tuning) => tuning.body.x)).size)
      .toBeGreaterThan(1);
  });

  test.each([
    ['Street', STREET_SOCIAL_THEME],
    ['Editorial', EDITORIAL_SOCIAL_THEME],
  ])('%s renders long tournament and team fixtures with controlled fallbacks', async (_label, theme) => {
    const snapshot = stressedResultsSnapshot();
    const log = [];
    await prepareSocialRender(renderOptions({ snapshot, log, theme }));
    const drawing = log.filter((entry) => entry.startsWith('fillText(')).join('\n');
    expect(drawing).toContain('fillText(TM,');
    expect(drawing).toContain('fillText(TORNEO METROPOLITANO');
    expect(drawing).toMatch(/…|LOS PIBES DEL PARQUE CENTRAL/);
    expect(drawing).not.toMatch(/NaN|Infinity|undefined/);
  });

  test('4:5 density tokens make standard material and leave Story untouched', () => {
    const standard = resolveResultsVariant({ matchCount: 4, format: 'portrait' });
    const dense = resolveResultsVariant({ matchCount: 8, format: 'portrait' });
    const story = resolveResultsVariant({ matchCount: 4, format: 'story' });
    expect(resolveResultsDensityTuning(standard, 'editorial')).toMatchObject({
      id: 'standard', teamSize: 36, scoreSize: 92, maxRowHeight: 198,
    });
    expect(resolveResultsDensityTuning(dense, 'editorial')).toMatchObject({
      id: 'dense', teamSize: 26, scoreSize: 70, maxRowHeight: 128,
    });
    expect(resolveResultsDensityTuning(story, 'editorial')).toBeNull();
  });

  test.each([
    { label: 'Street', theme: STREET_SOCIAL_THEME, matchCount: 2, expectedVariant: 'compact' },
    { label: 'Street', theme: STREET_SOCIAL_THEME, matchCount: 4, expectedVariant: 'standard' },
    { label: 'Street', theme: STREET_SOCIAL_THEME, matchCount: 6, expectedVariant: 'dense' },
    { label: 'Street', theme: STREET_SOCIAL_THEME, matchCount: 8, expectedVariant: 'dense' },
    { label: 'Editorial', theme: EDITORIAL_SOCIAL_THEME, matchCount: 2, expectedVariant: 'compact' },
    { label: 'Editorial', theme: EDITORIAL_SOCIAL_THEME, matchCount: 4, expectedVariant: 'standard' },
    { label: 'Editorial', theme: EDITORIAL_SOCIAL_THEME, matchCount: 6, expectedVariant: 'dense' },
    { label: 'Editorial', theme: EDITORIAL_SOCIAL_THEME, matchCount: 8, expectedVariant: 'dense' },
  ])('$label keeps $matchCount-match $expectedVariant stress fixtures legible in 4:5', async ({
    theme, matchCount, expectedVariant,
  }) => {
    const snapshot = stressedResultsSnapshot(matchCount);
    const log = [];
    const prepared = await prepareSocialRender(renderOptions({ snapshot, log, theme }));
    const drawing = log.filter((entry) => entry.startsWith('fillText(')).join('\n');
    const teamLines = log.filter((entry) => (
      entry.startsWith('fillText(')
      && /(LOS|Los|PIBES|Pibes|PARQUE|Parque|CENTRAL|Central|BIBLIOTECA|Biblioteca|POPULAR|Popular|SOCIAL|Social|DEPORTIVO|Deportivo|CONSTITUCIÓN|Constitución)/.test(entry)
    ));
    expect(prepared.variant.id).toBe(expectedVariant);
    expect(drawing).not.toContain('…');
    expect(teamLines.length).toBeGreaterThanOrEqual(matchCount * 2);
    expect(teamLines.length).toBeLessThanOrEqual(matchCount * 4);
    expect(drawing).toContain('fillText(1');
    expect(log.join('\n')).not.toMatch(/NaN|Infinity|undefined/);
    releasePreparedSocialRender(prepared);
  });

  test.each([2, 4, 6, 8])(
    'Base keeps %i-match stress fixtures bounded in 4:5',
    async (matchCount) => {
      const snapshot = stressedResultsSnapshot(matchCount);
      const log = [];
      const prepared = await prepareSocialRender(renderOptions({
        snapshot, log, theme: CLASSIC_SOCIAL_THEME,
      }));
      expect(prepared.theme.id).toBe('base');
      expect(log.some((entry) => entry.startsWith('fillText('))).toBe(true);
      expect(log.join('\n')).not.toMatch(/NaN|Infinity|undefined/);
      releasePreparedSocialRender(prepared);
    },
  );

  test('branding is optional and stable key construction remains available directly', async () => {
    const prepared = await prepareSocialRender(renderOptions({ branding: undefined }));
    expect(prepared.branding).toEqual({
      tournamentName: 'Copa Horizonte', tournamentLogo: null,
      primaryColor: null, secondaryColor: null,
      showArma2Branding: true,
    });
    const key = createSocialRenderKey({
      snapshot: resultsSnapshot(),
      content: prepared.content,
      editorial: createEditorialState(resultsSnapshot()),
      format: SOCIAL_FORMATS.portrait,
      theme: prepared.theme,
      variant: resolveResultsVariant({ matchCount: 2, format: 'portrait' }),
      assetPlan: prepared.assetPlan,
    });
    expect(typeof key).toBe('string');
  });
});
