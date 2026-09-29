import fs from 'fs';
import path from 'path';

describe('public tournament responsive contract', () => {
  const css = fs.readFileSync(path.join(
    process.cwd(),
    'src/features/torneos/components/PublicTournamentPage.module.css',
  ), 'utf8');
  const settingsCss = fs.readFileSync(path.join(
    process.cwd(),
    'src/features/torneos/components/TournamentPublicPageSettings.module.css',
  ), 'utf8');

  test('defines tablet, mobile and reduced-motion states', () => {
    expect(css).toMatch(/@media \(max-width: 820px\)/);
    expect(css).toMatch(/@media \(max-width: 560px\)/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });

  test('limits horizontal scrolling to data-heavy navigation and tables', () => {
    expect(css).toMatch(/\.tableScroll[^}]*overflow-x: auto/s);
    expect(css).toMatch(/\.tabs[^}]*overflow-x: auto/s);
    expect(css).toMatch(/\.publicPage[^}]*overflow-x: clip/s);
  });

  test('the tab bar keeps every tab whole and on one line, scrolling only itself', () => {
    expect(css).toMatch(/\.tabs button \{[^}]*flex: 0 0 auto/s);
    expect(css).toMatch(/\.tabs button \{[^}]*white-space: nowrap/s);
    expect(css).toMatch(/\.tabs \{[^}]*overscroll-behavior-x: contain/s);
  });

  test('the brand is the official lockup bitmap on its dark plate, never styled text', () => {
    expect(css).not.toMatch(/\.brand b\b/);
    expect(css).toMatch(/\.brandOfficial \{[^}]*background: #21114e/s);
    expect(css).toMatch(/\.brandOfficialImage \{[^}]*object-fit: contain/s);
    expect(css).toMatch(/\.brandOwnImage \{[^}]*object-fit: contain/s);
  });

  test('the standalone page owns the top safe area: padded, a dark status plate, tabs stick below it', () => {
    expect(css).toMatch(/\.publicPage \{[^}]*padding-top: var\(--safe-top, 0px\)/s);
    expect(css).toMatch(/\.publicPage::before \{[^}]*position: fixed[^}]*height: var\(--safe-top, 0px\)[^}]*background: #21114e/s);
    expect(css).toMatch(/\.tabs \{[^}]*top: var\(--safe-top, 0px\)/s);
  });

  test('keeps interactive controls at accessible touch sizes', () => {
    expect(css).toMatch(/\.tabs button[^}]*min-height: 52px/s);
    expect(settingsCss).toMatch(/\.linkBox button[^}]*min-height: 44px/s);
  });

  test('declares the public route before the authenticated wrapper', () => {
    const app = fs.readFileSync(path.join(process.cwd(), 'src/App.js'), 'utf8');
    const publicRoute = app.indexOf('<Route path="/torneos/publico/:publicSlug"');
    const authenticatedWrapper = app.indexOf('<Route path="/" element={<AppAuthWrapper />}>');
    expect(publicRoute).toBeGreaterThan(-1);
    expect(authenticatedWrapper).toBeGreaterThan(publicRoute);
  });

  test.each([
    '/votar-equipos',
    '/partido/:partidoId/invitacion',
    '/i/:token',
    '/encuesta/:partidoId',
    '/resultados-encuesta/:partidoId',
    '/resultados/:partidoId',
    '/pagos/:partidoId',
    'partido-publico/:partidoId',
  ])('preserves standalone route %s', (route) => {
    const app = fs.readFileSync(path.join(process.cwd(), 'src/App.js'), 'utf8');
    expect(app).toContain(`path="${route}"`);
  });

  // Horizontal bars across Torneos: when their items do not fit they scroll
  // (the global swipe guard lets any real horizontal scroller through), so the
  // items must stay whole, never shrink into a wrapped or clipped label.
  test.each([
    ['CompetitionCenter.module.css', '.subnav a'],
    ['FixtureWorkspace.module.css', '.subnav a'],
    ['ParticipantHub.module.css', '.hubNav a'],
    ['TeamRegistration.module.css', '.detailTabs a'],
    ['MatchOperations.module.css', '.matchSubnav a'],
  ])('%s %s items never shrink inside their scrolling bar', (file, selector) => {
    const moduleCss = fs.readFileSync(path.join(
      process.cwd(),
      'src/features/torneos/components',
      file,
    ), 'utf8');
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    expect(moduleCss).toMatch(new RegExp(`${escaped} \\{[^}]*flex: 0 0 auto`, 's'));
  });
});
