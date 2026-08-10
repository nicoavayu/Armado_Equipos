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
});
