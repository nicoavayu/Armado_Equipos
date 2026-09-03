import { createPremiumDomRender, releasePremiumDomRender } from '../features/torneos/social/premium/premiumDomRenderer';
import { createPremiumViewModel } from '../features/torneos/social/premium/premiumDataAdapter';
import { ensurePremiumSocialFonts, PREMIUM_REQUIRED_FONTS } from '../features/torneos/social/premium/premiumFonts';
import { resolveAdaptiveTableMetrics } from '../features/torneos/social/premium/premiumLayoutHardening';
import {
  EDITORIAL_STANDINGS_PAGE_SIZE,
  resolveEditorialStandingsPagination,
} from '../features/torneos/social/premium/premiumPagination';
import {
  SOCIAL_FORMATS,
  SOCIAL_PIECE_IDS,
  SOCIAL_TEAM_SIZES,
  createEditorialState,
  resolveFiguraDragFocal,
} from '../features/torneos/social/socialContracts';
import {
  EDITORIAL_SOCIAL_THEME,
  HERITAGE_SOCIAL_THEME,
  SCOREBOARD_SOCIAL_THEME,
  STREET_SOCIAL_THEME,
} from '../features/torneos/social/socialThemes';

const PREMIUM_THEMES = [
  HERITAGE_SOCIAL_THEME,
  STREET_SOCIAL_THEME,
  SCOREBOARD_SOCIAL_THEME,
  EDITORIAL_SOCIAL_THEME,
];
const FORMATS = ['portrait', 'story'];

const teams = Array.from({ length: 12 }, (_unused, index) => ({
  participantId: `club-${index}`,
  name: `Club Identidad ${index + 1}`,
  shortName: `C${index + 1}`,
  primaryColor: index % 2 ? '#146C94' : '#7C1C2E',
  secondaryColor: '#F4F0E5',
}));

function playersFor(size = 11) {
  const positions = size === 5
    ? ['ARQ', 'DEF', 'DEF', 'MED', 'DEL']
    : ['ARQ', ...Array(Math.max(2, Math.floor((size - 1) * 0.42))).fill('DEF')];
  while (positions.length < size - 2) positions.push('MED');
  while (positions.length < size) positions.push('DEL');
  return positions.slice(0, size).map((position, index) => ({
    rosterPlayerId: `player-${size}-${index}`,
    name: `Jugador Real ${index + 1}`,
    position,
    isGoalkeeper: position === 'ARQ',
    team: teams[index],
    goals: Math.max(0, 9 - index),
    assists: Math.max(0, 5 - index),
    appearances: 12,
    yellowCards: index % 4,
    directReds: index === 2 ? 1 : 0,
  }));
}

function matches(pending = false, count = 4) {
  return Array.from({ length: count }, (_unused, index) => ({
    id: `match-${index}`,
    scheduledAt: `2026-09-${String(12 + index).padStart(2, '0')}T18:30:00.000Z`,
    venueName: index === 0 ? 'Estadio Central' : `Cancha ${index + 1}`,
    home: index === 0
      ? { ...teams[index], name: 'Defensores de Villa Constitución del Norte' }
      : teams[index % teams.length],
    away: teams[(index + 4) % teams.length],
    result: pending ? null : { homeScore: index + 1, awayScore: index % 2 },
  }));
}

function snapshot(piece, size = 11) {
  const candidates = playersFor(size);
  return {
    schemaVersion: 1,
    piece,
    generatedAt: '2026-09-01T12:00:00.000Z',
    competition: {
      tournamentName: 'Copa Horizonte 2026', categoryName: 'Primera División',
      phaseName: 'Fase regular', roundName: 'Fecha 9', roundNumber: 9,
      timezone: 'America/Argentina/Buenos_Aires', teamSize: size,
    },
    official: {
      matches: matches(piece === 'next_fixture'),
      rows: teams.map((team, index) => ({
        ...team, position: index + 1, played: 11, won: 9 - Math.min(index, 8),
        drawn: index % 3, lost: index % 4, goalsFor: 28 - index,
        goalsAgainst: 9 + index, goalDifference: 19 - index * 2, points: 30 - index,
      })),
      players: candidates,
      candidates,
      teamSize: size,
      officialChampion: { ...teams[0], points: 30, goalDifference: 19, played: 11 },
    },
  };
}

function renderCase(theme, piece, format, size = 11, options = {}) {
  const source = options.source || snapshot(piece, size);
  return createPremiumDomRender({
    snapshot: source,
    editorial: {
      format,
      selection: source.official.candidates.map(({ rosterPlayerId }) => rosterPlayerId),
      figuraFocalX: 0.82,
      figuraFocalY: 0.18,
      figuraZoom: 1,
      ...options.editorial,
    },
    assets: { shields: {}, photo: options.photo || null, branding: {} },
    branding: { tournamentName: source.competition.tournamentName, showArma2Branding: false },
    sponsors: options.sponsors || [],
    theme,
  });
}

const IMAGE_DATA_URL = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="8" height="8"%3E%3Cpath fill="%23000" d="M0 0h8v8H0z"/%3E%3C/svg%3E';

describe('Social Studio V2 product renderer', () => {
  test.each(PREMIUM_THEMES.flatMap((theme) => (
    SOCIAL_PIECE_IDS.flatMap((piece) => FORMATS.map((format) => [theme, piece, format]))
  )))('$theme.id renders $piece/$format through its V2 DOM root', (theme, piece, format) => {
    const rendered = renderCase(theme, piece, format);
    const expected = SOCIAL_FORMATS[format];
    expect(rendered.node.dataset).toMatchObject({
      premiumRenderer: 'v2', theme: theme.id, format,
    });
    expect(rendered.node.style.width).toBe(`${expected.width}px`);
    expect(rendered.node.style.height).toBe(`${expected.height}px`);
    expect(rendered.node.firstElementChild.style.width).toBe(`${expected.width}px`);
    expect(rendered.node.firstElementChild.style.height).toBe(`${expected.height}px`);
    expect(rendered.node.innerHTML).not.toMatch(/x-dc|dc-import|image-slot|qaPhoto|xiSquad/);
    releasePremiumDomRender(rendered);
  });

  test.each(PREMIUM_THEMES.flatMap((theme) => (
    FORMATS.flatMap((format) => SOCIAL_TEAM_SIZES.map((size) => [theme, format, size]))
  )))('$theme.id Equipo Ideal $format F$size keeps player and club identity', (theme, format, size) => {
    const rendered = renderCase(theme, 'best_eleven', format, size);
    const markup = rendered.node.textContent;
    expect(markup).toContain('Jugador Real 1');
    expect(markup).toContain('C1');
    expect(markup).toContain('ARQUERO');
    expect(markup).toContain('DEFENSA');
    expect(markup).toContain('DELANTEROS');
    playersFor(size).forEach((player) => expect(markup).toContain(player.name));
    releasePremiumDomRender(rendered);
  });

  test('Street Next Story measures the required long name instead of truncating it', () => {
    const source = snapshot('next_fixture');
    const viewModel = createPremiumViewModel({
      snapshot: source,
      editorial: { format: 'story' },
      themeId: 'street',
      formatId: 'story',
    });
    expect(viewModel.fixtures[0].h.name).toBe('Defensores de Villa Constitución del Norte');
    expect(viewModel.fixtures[0].hFS).toBeLessThan(38);
  });

  test.each(PREMIUM_THEMES.flatMap((theme) => (
    FORMATS.flatMap((format) => [0, 1, 2, 3].map((count) => [theme, format, count]))
  )))('$theme.id $format renders exactly $count real sponsor assets', (theme, format, count) => {
    const sponsors = Array.from({ length: count }, (_unused, index) => ({
      id: `sponsor-${index}`,
      name: `Sponsor ${index + 1}`,
      src: IMAGE_DATA_URL,
    }));
    const rendered = renderCase(theme, 'round_summary', format, 11, { sponsors });
    expect(rendered.node.querySelectorAll('img')).toHaveLength(count);
    sponsors.forEach((sponsor) => {
      expect(rendered.node.querySelector(`img[alt="${sponsor.name}"]`)).not.toBeNull();
    });
    releasePremiumDomRender(rendered);
  });

  test.each(PREMIUM_THEMES.flatMap((theme) => FORMATS.map((format) => [theme, format])))('$theme.id $format applies the real 82/18 image focal point', (theme, format) => {
    const rendered = renderCase(theme, 'mvp', format, 11, { photo: { src: IMAGE_DATA_URL } });
    const photo = rendered.node.querySelector('img');
    expect(photo).not.toBeNull();
    expect(photo.style.objectPosition).toBe('82% 18%');
    releasePremiumDomRender(rendered);
  });

  test.each(PREMIUM_THEMES.flatMap((theme) => (
    FORMATS.flatMap((format) => [4, 8, 12, 16, 18, 20, 24].map((count) => [theme, format, count]))
  )))('$theme.id table $format flows its safe page for $count rows', (theme, format, count) => {
    const source = snapshot('standings');
    source.official.rows = Array.from({ length: count }, (_unused, index) => ({
      ...teams[index % teams.length],
      participantId: `table-${count}-${index}`,
      name: `${teams[index % teams.length].name} ${index + 1}`,
      position: index + 1,
      played: 18,
      won: Math.max(0, 16 - index),
      drawn: index % 4,
      lost: Math.min(index, 9),
      goalsFor: 40 - index,
      goalsAgainst: 8 + index,
      goalDifference: 32 - index * 2,
      points: 48 - index,
    }));
    const viewModel = createPremiumViewModel({
      snapshot: source, editorial: { format }, themeId: theme.id, formatId: format,
    });
    expect(viewModel.std).toHaveLength(count);
    const rendered = renderCase(theme, 'standings', format, 11, { source });
    const flow = rendered.node.querySelector('[data-premium-flow="standings"]');
    const expectedCount = theme.id === 'editorial' && count > EDITORIAL_STANDINGS_PAGE_SIZE
      ? EDITORIAL_STANDINGS_PAGE_SIZE
      : count;
    expect(flow).not.toBeNull();
    expect(flow.dataset.rowCount).toBe(String(expectedCount));
    expect(flow.style.justifyContent).toBe('flex-start');
    expect(flow.querySelectorAll('[data-premium-row="standings"]')).toHaveLength(expectedCount);
    expect(Number(flow.dataset.contentHeight)).toBeLessThanOrEqual(
      Number(flow.dataset.availableBodyHeight),
    );
    expect(rendered.node.querySelector('[data-premium-flow-frame="standings"]')?.style.justifyContent)
      .toBe('flex-start');
    releasePremiumDomRender(rendered);
  });

  test('adaptive density gives sparse tables air and compacts only dense tables', () => {
    const sparse = resolveAdaptiveTableMetrics({
      rowCount: 4, availableBodyHeight: 760, headerHeight: 46, formatId: 'portrait',
      wrappedLineCounts: [1, 1, 1, 1],
    });
    const medium = resolveAdaptiveTableMetrics({
      rowCount: 8, availableBodyHeight: 760, headerHeight: 46, formatId: 'portrait',
      wrappedLineCounts: Array(8).fill(1),
    });
    const dense = resolveAdaptiveTableMetrics({
      rowCount: 18, availableBodyHeight: 760, headerHeight: 46, formatId: 'portrait',
      wrappedLineCounts: Array(18).fill(2),
    });
    const maximum = resolveAdaptiveTableMetrics({
      rowCount: 24, availableBodyHeight: 760, headerHeight: 46, formatId: 'portrait',
      wrappedLineCounts: Array(24).fill(2),
    });
    expect(sparse.rowHeight).toBeGreaterThan(medium.rowHeight);
    expect(medium.rowHeight).toBeGreaterThan(dense.rowHeight);
    expect(dense.rowHeight).toBeGreaterThan(maximum.rowHeight);
    expect(dense.fontSizes[0] * 2 * 1.08).toBeLessThanOrEqual(dense.rowHeight - 4);
    expect(maximum.contentHeight).toBeLessThanOrEqual(760);
  });

  test.each(FORMATS.flatMap((format) => (
    [4, 8, 12, 16, 18].map((count) => [format, count])
  )))('Scoreboard standings %s keeps every PTS contrasted for %i rows', (format, count) => {
    const source = snapshot('standings');
    source.official.rows = Array.from({ length: count }, (_unused, index) => ({
      ...teams[index % teams.length],
      participantId: `scoreboard-${format}-${count}-${index}`,
      name: `${teams[index % teams.length].name} ${index + 1}`,
      position: index + 1,
      points: 40 - index,
    }));
    const rendered = renderCase(SCOREBOARD_SOCIAL_THEME, 'standings', format, 11, { source });
    const points = rendered.node.querySelectorAll('[data-premium-contrast="scoreboard-points"]');
    expect(points).toHaveLength(count);
    points.forEach((point) => {
      expect(point.dataset.premiumRowBackground).toMatch(/^rgb\(/);
      expect(['dark', 'light']).toContain(point.dataset.premiumContrastTone);
      expect(point.style.color).toBe('rgb(244, 241, 232)');
      expect(point.style.backgroundColor).toBe('rgb(6, 70, 47)');
      expect(point.style.mixBlendMode).toBe('normal');
      expect(point.style.opacity).toBe('1');
    });
    releasePremiumDomRender(rendered);
  });

  test('Editorial standings Portrait uses measured one-line team names', () => {
    const source = snapshot('standings');
    source.official.rows = Array.from({ length: 24 }, (_unused, index) => ({
      ...teams[index % teams.length],
      participantId: `editorial-dense-${index}`,
      name: `Defensores de Villa Constitución del Norte ${index + 1}`,
      position: index + 1,
      points: 40 - index,
    }));
    const rendered = renderCase(EDITORIAL_SOCIAL_THEME, 'standings', 'portrait', 11, { source });
    const fittedNames = rendered.node.querySelectorAll('[data-premium-single-line-autofit="true"]');
    expect(fittedNames).toHaveLength(15);
    fittedNames.forEach((name) => expect(name.style.whiteSpace).toBe('nowrap'));
    expect(rendered.node.querySelector('[data-premium-pagination="editorial-standings"]')?.textContent)
      .toBe('PÁGINA 1 DE 2');
    releasePremiumDomRender(rendered);
  });

  test.each(FORMATS)('Editorial standings %s continues after row 15 on page 2', (format) => {
    const source = snapshot('standings');
    source.official.rows = Array.from({ length: 18 }, (_unused, index) => ({
      ...teams[index % teams.length],
      participantId: `editorial-page-${index}`,
      name: `Club de continuación ${index + 1}`,
      position: index + 1,
      points: 40 - index,
    }));
    const pagination = resolveEditorialStandingsPagination(
      source,
      { page: 2 },
      EDITORIAL_SOCIAL_THEME,
    );
    expect(pagination).toMatchObject({ enabled: true, page: 2, pageCount: 2, start: 15, end: 18 });
    expect(pagination.snapshot.official.rows.map(({ position }) => position)).toEqual([16, 17, 18]);

    const rendered = renderCase(EDITORIAL_SOCIAL_THEME, 'standings', format, 11, {
      source,
      editorial: { page: 2 },
    });
    const rows = rendered.node.querySelectorAll('[data-premium-row="standings"]');
    expect(rows).toHaveLength(3);
    expect(rendered.node.textContent).toContain('Club de continuación 16');
    expect(rendered.node.textContent).not.toContain('Club de continuación 15');
    const markers = rendered.node.querySelectorAll('[data-premium-pagination="editorial-standings"]');
    expect(markers).toHaveLength(1);
    expect(markers[0].textContent).toBe('PÁGINA 2 DE 2');
    const flow = rendered.node.querySelector('[data-premium-continuation-anchor="top"]');
    expect(flow).not.toBeNull();
    expect(flow.style.transform).toBe('none');
    expect(flow.style.transformOrigin).toBe('top left');
    releasePremiumDomRender(rendered);
  });

  test.each(FORMATS.flatMap((format) => ([
    [format, 16, 2, 1, 16],
    [format, 18, 2, 3, 16],
    [format, 24, 2, 9, 16],
    [format, 31, 3, 1, 31],
  ])))('Editorial standings %s top-anchors %i rows on page %i', (
    format,
    totalRows,
    page,
    expectedRows,
    firstPosition,
  ) => {
    const source = snapshot('standings');
    source.official.rows = Array.from({ length: totalRows }, (_unused, index) => ({
      ...teams[index % teams.length],
      participantId: `editorial-top-anchor-${totalRows}-${index}`,
      name: `Club de continuación ${index + 1}`,
      position: index + 1,
      points: 60 - index,
    }));
    const rendered = renderCase(EDITORIAL_SOCIAL_THEME, 'standings', format, 11, {
      source,
      editorial: { page },
    });
    const flow = rendered.node.querySelector('[data-premium-flow="standings"]');
    const rows = flow.querySelectorAll('[data-premium-row="standings"]');
    expect(rows).toHaveLength(expectedRows);
    expect(flow.dataset.premiumContinuationAnchor).toBe('top');
    expect(flow.style.justifyContent).toBe('flex-start');
    expect(flow.style.transform).toBe('none');
    expect(Number(flow.dataset.contentHeight)).toBeLessThanOrEqual(
      Number(flow.dataset.availableBodyHeight),
    );
    expect(rendered.node.textContent).toContain(`Club de continuación ${firstPosition}`);
    expect(rendered.node.querySelector('[data-premium-pagination="editorial-standings"]')?.textContent)
      .toBe(`PÁGINA ${page} DE ${Math.ceil(totalRows / EDITORIAL_STANDINGS_PAGE_SIZE)}`);
    releasePremiumDomRender(rendered);
  });

  test.each(PREMIUM_THEMES)('$id keeps eight Story results below the title in five reserved columns', (theme) => {
    const source = snapshot('round_results');
    source.official.matches = matches(false, 8);
    const rendered = renderCase(theme, 'round_results', 'story', 11, { source });
    const flow = rendered.node.querySelector('[data-premium-flow="results"]');
    const rows = flow?.querySelectorAll('[data-premium-row="result"]') || [];
    expect(flow).not.toBeNull();
    expect(flow.dataset.rowCount).toBe('8');
    expect(flow.style.justifyContent).toBe('flex-start');
    expect(rows).toHaveLength(8);
    rows.forEach((row) => {
      if (theme.id === 'scoreboard') {
        const halves = Array.from(row.children);
        expect(halves).toHaveLength(2);
        halves.forEach((half) => expect(half.style.gridTemplateColumns).toContain('minmax(0,1fr)'));
      } else if (theme.id === 'street') {
        const contentRow = Array.from(row.querySelectorAll('*')).find((node) => (
          node.children.length === 5 && node.style.display === 'grid'
        ));
        expect(contentRow).toBeDefined();
        expect(contentRow.style.gridTemplateColumns.match(/minmax/g)).toHaveLength(2);
      } else {
        expect(row.style.gridTemplateColumns.match(/minmax/g)).toHaveLength(2);
      }
      expect(row.style.overflow).toBe('hidden');
      expect(Number.parseFloat(row.style.height)).toBeGreaterThan(0);
    });
    releasePremiumDomRender(rendered);
  });

  test.each(FORMATS)('Editorial Next Fixture $format balances home / VS / away', (format) => {
    const source = snapshot('next_fixture');
    const rendered = renderCase(EDITORIAL_SOCIAL_THEME, 'next_fixture', format, 11, { source });
    const fixtures = rendered.node.querySelectorAll('[data-premium-fixture-balance="true"]');
    expect(fixtures).toHaveLength(source.official.matches.length);
    fixtures.forEach((fixture) => {
      expect(fixture.style.gridTemplateColumns).toBe('minmax(0,1fr) 72px minmax(0,1fr)');
    });
    releasePremiumDomRender(rendered);
  });

  test.each(FORMATS)('Heritage Semifinals $format uses the approved cream score contrast', (format) => {
    const rendered = renderCase(HERITAGE_SOCIAL_THEME, 'semifinals', format);
    const scores = rendered.node.querySelectorAll('[data-premium-contrast="heritage-score"]');
    expect(scores).toHaveLength(2);
    scores.forEach((score) => expect(score.style.color).toBe('rgb(239, 230, 216)'));
    releasePremiumDomRender(rendered);
  });

  test.each(PREMIUM_THEMES)('$id removes the empty suspension block instead of centering it', (theme) => {
    const source = snapshot('discipline');
    source.official.players = source.official.players.map((player) => ({
      ...player, suspensions: [],
    }));
    const rendered = renderCase(theme, 'discipline', 'story', 11, { source });
    const hidden = rendered.node.querySelector('[data-premium-empty-block="hidden"]');
    expect(hidden).not.toBeNull();
    expect(hidden.style.display).toBe('none');
    const flow = rendered.node.querySelector('[data-premium-flow="discipline"]');
    expect(flow.style.justifyContent).toBe('flex-start');
    releasePremiumDomRender(rendered);
  });

  test.each(PREMIUM_THEMES.flatMap((theme) => FORMATS.map((format) => [theme, format])))('$theme.id discipline empty $format omits its isolated table header and starts below the title', (theme, format) => {
    const source = snapshot('discipline');
    source.official.players = [];
    source.official.candidates = [];
    const rendered = renderCase(theme, 'discipline', format, 11, { source });
    expect(rendered.node.querySelector('[data-premium-empty-header="hidden"]')?.style.display)
      .toBe('none');
    expect(rendered.node.querySelector('[data-premium-empty-state="discipline"]')).not.toBeNull();
    expect(rendered.node.querySelector('[data-premium-empty-state="discipline"]')?.textContent)
      .toBe('SIN SANCIONES REGISTRADAS');
    expect(rendered.node.querySelector('[data-premium-flow-frame="discipline-empty"]')?.style.justifyContent)
      .toBe('flex-start');
    releasePremiumDomRender(rendered);
  });

  test.each(PREMIUM_THEMES)('$id Figura without-photo Story reuses a theme-specific intentional fallback', (theme) => {
    const rendered = renderCase(theme, 'mvp', 'story', 11, { photo: null });
    const fallback = rendered.node.querySelector(`[data-premium-figure-fallback="${theme.id}"]`);
    expect(fallback).not.toBeNull();
    expect(fallback.textContent).toContain('JR');
    expect(rendered.node.querySelector('[data-premium-figure-frame="true"] > span')).toBeNull();
    expect(rendered.node.querySelector('[data-premium-figure-no-photo="compact"]')).not.toBeNull();
    expect(rendered.node.querySelector('[data-premium-figure-composition="no-photo-compact"]'))
      .not.toBeNull();
    releasePremiumDomRender(rendered);
  });

  test('Equipo Ideal uses piece-specific manual lines and drops missing line bands', () => {
    const source = snapshot('best_eleven', 5);
    const selection = source.official.candidates.map(({ rosterPlayerId }) => rosterPlayerId);
    const selectedLines = Object.fromEntries(selection.map((id, index) => (
      [id, index === 0 ? 'ARQ' : 'DEF']
    )));
    const manual = createPremiumViewModel({
      snapshot: source,
      editorial: { format: 'story', selection, selectedLines },
      themeId: 'heritage',
      formatId: 'story',
    });
    expect(manual.pitch.map(({ id }) => id)).toEqual(['DEF', 'ARQ']);

    const legacy = createPremiumViewModel({
      snapshot: source,
      editorial: { format: 'story', selection },
      themeId: 'heritage',
      formatId: 'story',
    });
    expect(legacy.pitch.map(({ id }) => id)).toEqual(['DEL', 'MED', 'DEF', 'ARQ']);
  });

  test('Figura drag is directional, zoom-aware and clamped', () => {
    expect(resolveFiguraDragFocal({
      focalX: 0.5, focalY: 0.5, deltaX: 100, deltaY: -50,
      frameWidth: 200, frameHeight: 100, zoom: 2,
    })).toEqual({ figuraFocalX: 0.25, figuraFocalY: 0.75 });
    expect(resolveFiguraDragFocal({
      focalX: 0.1, focalY: 0.9, deltaX: 9999, deltaY: -9999,
      frameWidth: 200, frameHeight: 100, zoom: 1,
    })).toEqual({ figuraFocalX: 0, figuraFocalY: 1 });
  });

  test.each(PREMIUM_THEMES.flatMap((theme) => FORMATS.map((format) => [theme, format])))('$theme.id Figura $format keeps focal/zoom on the export renderer frame', (theme, format) => {
    const source = snapshot('mvp');
    const editorial = createEditorialState(source, {
      format, selection: [source.official.candidates[0].rosterPlayerId],
      photoAssetId: 'qa-photo', figuraFocalX: 0.67, figuraFocalY: 0.31, figuraZoom: 2.25,
    });
    const rendered = renderCase(theme, 'mvp', format, 11, {
      source, photo: { src: IMAGE_DATA_URL }, editorial,
    });
    const frame = rendered.node.querySelector('[data-premium-figure-frame="true"]');
    const image = frame.querySelector('img');
    expect(image.style.objectFit).toBe('cover');
    expect(image.style.objectPosition).toBe('67% 31%');
    expect(image.style.transform).toBe('scale(var(--figura-zoom, 1))');
    expect(rendered.node.firstElementChild.style.getPropertyValue('--figura-zoom')).toBe('2.25');
    releasePremiumDomRender(rendered);
  });

  test.each(PREMIUM_THEMES)('$id waits for every declared font and fails closed', async (theme) => {
    const load = jest.fn(async () => []);
    const check = jest.fn(() => true);
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { load, check, ready: Promise.resolve() },
    });
    await ensurePremiumSocialFonts(theme.id);
    expect(load).toHaveBeenCalledTimes(PREMIUM_REQUIRED_FONTS[theme.id].length);
    expect(check).toHaveBeenCalledTimes(PREMIUM_REQUIRED_FONTS[theme.id].length);
  });
});
