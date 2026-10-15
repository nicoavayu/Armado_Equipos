// Premium placas show the tournament's own data, never the approved sample's: the sample was Copa Horizonte, Fecha 9,
// 4 matches, 18 teams, a champion with 42 points after 18 rounds. This fixture is none of that (Fecha 7, 2 matches,
// 4 teams, season 2027), so any sample literal that survives in a layout shows up here.
import { createPremiumDomRender, releasePremiumDomRender } from '../features/torneos/social/premium/premiumDomRenderer';
import {
  createPremiumViewModel,
  joinPremiumLabel,
  tournamentInitials,
} from '../features/torneos/social/premium/premiumDataAdapter';
import { SOCIAL_PIECE_IDS } from '../features/torneos/social/socialContracts';
import {
  EDITORIAL_SOCIAL_THEME,
  HERITAGE_SOCIAL_THEME,
  SCOREBOARD_SOCIAL_THEME,
  STREET_SOCIAL_THEME,
} from '../features/torneos/social/socialThemes';

const PREMIUM_THEMES = [HERITAGE_SOCIAL_THEME, STREET_SOCIAL_THEME, SCOREBOARD_SOCIAL_THEME, EDITORIAL_SOCIAL_THEME];
const FORMATS = ['portrait', 'story'];
const LOGO = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/%3E';

const SAMPLE_LITERALS = [
  /FECHA 9\b/, /FECHA 17\b/, /FECHA 18\b/, /\b09\b/, /\b4 PARTIDOS\b/,
  /\b18 EQUIPOS\b/, /\b18 FECHAS\b/, /\b42 PUNTOS\b/, /\+18\b/, /\b2026\b/, /\bMMXXVI\b/, /Copa Horizonte/i,
];

const teams = [
  { participantId: 'gal', name: 'Los Galácticos', shortName: 'GAL', primaryColor: '#1B4E8C', secondaryColor: '#F2F2F2' },
  { participantId: 'tik', name: 'Tiki-Taka', shortName: 'TIK', primaryColor: '#7C1C2E', secondaryColor: '#F2F2F2' },
  { participantId: 'tap', name: 'Deportivo Tapita', shortName: 'TAP', primaryColor: '#146C94', secondaryColor: '#F2F2F2' },
  { participantId: 'tan', name: 'El Tanque', shortName: 'TAN', primaryColor: '#0B6E4F', secondaryColor: '#F2F2F2' },
];

function players() {
  return ['ARQ', 'DEF', 'DEF', 'MED', 'DEL'].map((position, index) => ({
    rosterPlayerId: `player-${index}`,
    name: ['Pipe Gómez', 'Facu Ruiz', 'Gonza Paz', 'Lucho Sosa', 'Nico Vera'][index],
    position,
    isGoalkeeper: position === 'ARQ',
    team: teams[index % teams.length],
    goals: 7 - index,
    appearances: 7,
    yellowCards: index % 2,
    directReds: 0,
  }));
}

function primavera(piece, { tournamentName = 'Copa Primavera', longNames = false } = {}) {
  const candidates = players();
  const home = longNames
    ? [{ ...teams[0], name: 'Los Galácticos Deportivo' }, { ...teams[2], name: 'Defensores Unidos de Villa Constitución' }]
    : [teams[0], teams[2]];
  return {
    schemaVersion: 2,
    piece,
    generatedAt: '2027-10-17T23:00:00.000Z',
    competition: {
      tournamentName, categoryName: 'Libre', seasonName: '2027', phaseName: 'Fase regular',
      roundName: 'Fecha 7', roundNumber: 7, timezone: 'America/Argentina/Buenos_Aires', teamSize: 5,
    },
    official: {
      matches: [
        {
          id: 'm1', scheduledAt: '2027-10-17T21:00:00.000Z', venueName: 'Sede Norte · Cancha 1',
          home: home[0], away: teams[1], result: piece === 'next_fixture' ? null : { homeScore: 3, awayScore: 1 },
        },
        {
          id: 'm2', scheduledAt: '2027-10-17T22:00:00.000Z', venueName: 'Sede Norte · Cancha 2',
          home: home[1], away: teams[3], result: piece === 'next_fixture' ? null : { homeScore: 3, awayScore: 3 },
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
    assets: { shields: {}, photo: null, branding: options.logo ? { tournamentLogo: { src: options.logo } } : {} },
    branding: { tournamentName: snapshot.competition.tournamentName, showArma2Branding: false },
    sponsors: [],
    theme,
  });
}

function leafTexts(node) {
  return Array.from(node.querySelectorAll('*'))
    .filter((element) => element.children.length === 0)
    .map((element) => element.textContent.trim())
    .filter(Boolean);
}

const EVERY_CASE = PREMIUM_THEMES.flatMap((theme) => SOCIAL_PIECE_IDS.flatMap((piece) => FORMATS.map((format) => (
  [theme.id, piece, format, theme]
))));
const THEME_FORMATS = PREMIUM_THEMES.flatMap((theme) => FORMATS.map((format) => [theme.id, format, theme]));

describe('Premium placas bind the snapshot, not the approved sample', () => {
  test.each(EVERY_CASE)('%s %s/%s shows no sample literal and no sample crest', (_id, piece, format, theme) => {
    const rendered = render(theme, piece, format);
    const texts = leafTexts(rendered.node);
    const whole = texts.join(' | ');
    SAMPLE_LITERALS.forEach((literal) => expect(whole).not.toMatch(literal));
    expect(texts).not.toContain('CH');
    releasePremiumDomRender(rendered);
  });

  test.each(FORMATS)('Heritage results %s say Fecha 7', (format) => {
    const rendered = render(HERITAGE_SOCIAL_THEME, 'round_results', format);
    const texts = leafTexts(rendered.node);
    expect(texts.some((value) => /^fecha 7$/i.test(value))).toBe(true);
    if (format === 'story') {
      expect(texts).toContain('2 PARTIDOS');
      expect(texts.join(' ')).not.toMatch(/JORNADA COMPLETA/);
    }
    releasePremiumDomRender(rendered);
  });

  test('Street results story badge says FECHA 7', () => {
    const rendered = render(STREET_SOCIAL_THEME, 'round_results', 'story');
    expect(leafTexts(rendered.node)).toContain('FECHA 7');
    releasePremiumDomRender(rendered);
  });

  test('Scoreboard results story says 07 and FECHA 7 · 2 PARTIDOS', () => {
    const rendered = render(SCOREBOARD_SOCIAL_THEME, 'round_results', 'story');
    const texts = leafTexts(rendered.node);
    expect(texts).toContain('07');
    expect(texts).toContain('FECHA 7 · 2 PARTIDOS');
    releasePremiumDomRender(rendered);
  });

  test('Editorial results story says 07', () => {
    const rendered = render(EDITORIAL_SOCIAL_THEME, 'round_results', 'story');
    expect(leafTexts(rendered.node)).toContain('07');
    releasePremiumDomRender(rendered);
  });

  test('standings stories count the real teams', () => {
    const heritage = render(HERITAGE_SOCIAL_THEME, 'standings', 'story');
    const scoreboard = render(SCOREBOARD_SOCIAL_THEME, 'standings', 'story');
    const editorial = render(EDITORIAL_SOCIAL_THEME, 'standings', 'story');
    expect(leafTexts(heritage.node)).toContain('4 EQUIPOS · TABLA COMPLETA');
    expect(leafTexts(scoreboard.node)).toContain('FECHA 7 · 4 EQUIPOS');
    expect(leafTexts(editorial.node)).toContain('TABLA GENERAL · 4 EQUIPOS');
    [heritage, scoreboard, editorial].forEach(releasePremiumDomRender);
  });

  test('a paginated Editorial table counts every team, not the page', () => {
    const snapshot = primavera('standings');
    snapshot.official.rows = Array.from({ length: 20 }, (_unused, index) => ({
      ...teams[index % teams.length], participantId: `row-${index}`, name: `Equipo ${index + 1}`,
      position: index + 1, played: 7, points: 20 - index,
    }));
    const rendered = render(EDITORIAL_SOCIAL_THEME, 'standings', 'story', { snapshot });
    expect(leafTexts(rendered.node)).toContain('TABLA GENERAL · 20 EQUIPOS');
    releasePremiumDomRender(rendered);
  });

  test.each(FORMATS)('Editorial champion %s states the champion record and season from the snapshot', (format) => {
    const rendered = render(EDITORIAL_SOCIAL_THEME, 'champion', format);
    const texts = leafTexts(rendered.node);
    expect(texts.some((value) => value.startsWith('7 FECHAS · 16 PUNTOS'))).toBe(true);
    expect(texts).toContain('MMXXVII');
    releasePremiumDomRender(rendered);
  });

  test.each(FORMATS)('Heritage champion %s closes on the real round and season', (format) => {
    const rendered = render(HERITAGE_SOCIAL_THEME, 'champion', format);
    const texts = leafTexts(rendered.node);
    expect(texts).toContain('TORNEO FINALIZADO · FECHA 7');
    releasePremiumDomRender(rendered);
  });
});

describe('Premium tournament crest', () => {
  test('initials come from the tournament name, without year or connectors', () => {
    expect(tournamentInitials('Copa Primavera 2026')).toBe('CP');
    expect(tournamentInitials('Liga de Fútbol del Oeste')).toBe('LFO');
    expect(tournamentInitials('Apertura')).toBe('AP');
    expect(tournamentInitials('')).toBe('');
    expect(joinPremiumLabel('TORNEO FINALIZADO', '')).toBe('TORNEO FINALIZADO');
  });

  test.each(THEME_FORMATS)('%s %s results show the tournament initials without a logo', (_id, format, theme) => {
    const rendered = render(theme, 'round_results', format);
    expect(leafTexts(rendered.node)).toContain('CP');
    expect(rendered.node.querySelectorAll('img')).toHaveLength(0);
    releasePremiumDomRender(rendered);
  });

  test.each(THEME_FORMATS)('%s %s results show the tournament logo when there is one', (_id, format, theme) => {
    const rendered = render(theme, 'round_results', format, { logo: LOGO });
    const logos = Array.from(rendered.node.querySelectorAll('img')).filter((image) => image.getAttribute('src') === LOGO);
    expect(logos.length).toBeGreaterThan(0);
    expect(leafTexts(rendered.node)).not.toContain('CP');
    releasePremiumDomRender(rendered);
  });

  test.each(THEME_FORMATS)('%s %s results hide the crest without logo and name', (_id, format, theme) => {
    const snapshot = primavera('round_results', { tournamentName: '' });
    const rendered = render(theme, 'round_results', format, { snapshot });
    const viewModel = createPremiumViewModel({
      snapshot, editorial: { format }, themeId: theme.id, formatId: format,
    });
    expect(viewModel.tournamentIni).toBe('');
    expect(viewModel.hasLogo).toBe(false);
    expect(viewModel.noLogo).toBe(false);
    expect(rendered.node.querySelectorAll('img')).toHaveLength(0);
    releasePremiumDomRender(rendered);
  });

  test('a team whose initials are CH never lends its crest to the tournament', () => {
    const snapshot = primavera('round_results');
    snapshot.official.matches[0].home = { ...teams[0], name: 'Chacarita', shortName: 'CH', shieldPath: 'ch.png' };
    const viewModel = createPremiumViewModel({
      snapshot,
      editorial: { format: 'story' },
      assets: { shields: { 'ch.png': { src: LOGO } }, branding: {} },
      themeId: 'heritage',
      formatId: 'story',
    });
    expect(viewModel.tournamentLogoSrc).toBeNull();
    expect(viewModel.tournamentIni).toBe('CP');
  });
});

describe('Premium scorers title', () => {
  test.each(THEME_FORMATS)('%s %s names the accumulated table "goleadores del torneo"', (_id, format, theme) => {
    const viewModel = createPremiumViewModel({
      snapshot: primavera('scorers'), editorial: { format }, themeId: theme.id, formatId: format,
    });
    expect([viewModel.t1, viewModel.t2]).toEqual(['GOLEADORES', 'DEL TORNEO']);
  });
});

describe('Premium story team names break only between words', () => {
  // jsdom has no layout: a deterministic box model stands in for it. Each character is 0.6em wide and the name cell
  // is 220px, so "GALÁCTICOS" (10 letters) fits only at 36px or less and "CONSTITUCIÓN" (12) only at 30px or less.
  const CELL = 220;
  const longestWord = (node) => Math.max(...node.textContent.trim().split(/\s+/).map((word) => word.length));
  let restore;
  beforeEach(() => {
    const scrollWidth = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollWidth');
    const clientWidth = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth');
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
    restore = () => {
      delete HTMLElement.prototype.clientWidth;
      delete HTMLElement.prototype.scrollWidth;
      expect(Object.getOwnPropertyDescriptor(Element.prototype, 'scrollWidth')).toEqual(scrollWidth);
      expect(Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth')).toEqual(clientWidth);
    };
  });
  afterEach(() => restore());

  test.each(PREMIUM_THEMES.map((theme) => [theme.id, theme]))('%s story shrinks long names until every word fits', (_id, theme) => {
    const rendered = render(theme, 'round_results', 'story', { longNames: true });
    const leaves = Array.from(rendered.node.querySelectorAll('[data-premium-name-fit]'));
    expect(leaves).toHaveLength(4);
    leaves.forEach((leaf) => {
      expect(leaf.dataset.premiumNameFit).toBe('words');
      expect(leaf.style.overflowWrap).toBe('normal');
      const size = Number.parseFloat(leaf.style.fontSize);
      expect(longestWord(leaf) * size * 0.6).toBeLessThanOrEqual(CELL + 1);
    });
    const constitucion = leaves.find((leaf) => leaf.textContent.includes('Constitución'));
    expect(Number.parseFloat(constitucion.style.fontSize)).toBeLessThanOrEqual(30);
    releasePremiumDomRender(rendered);
  });
});
