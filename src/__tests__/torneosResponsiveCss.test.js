import fs from 'node:fs';
import path from 'node:path';

const css = fs.readFileSync(
  path.join(
    process.cwd(),
    'src/features/torneos/components/TorneosShell.module.css',
  ),
  'utf8',
);
const competitionCss = fs.readFileSync(
  path.join(
    process.cwd(),
    'src/features/torneos/components/CompetitionCore.module.css',
  ),
  'utf8',
);
const matchOperationsCss = fs.readFileSync(
  path.join(
    process.cwd(),
    'src/features/torneos/components/MatchOperations.module.css',
  ),
  'utf8',
);
const competitionCenterCss = fs.readFileSync(
  path.join(
    process.cwd(),
    'src/features/torneos/components/CompetitionCenter.module.css',
  ),
  'utf8',
);
const teamRegistrationCss = fs.readFileSync(
  path.join(
    process.cwd(),
    'src/features/torneos/components/TeamRegistration.module.css',
  ),
  'utf8',
);

const TEAM_FILTERS = [
  'Todos',
  'Presentados',
  'Observados',
  'Aprobados',
  'Incompletos',
];

const TOUCH_SCROLL_SOURCES = [
  'FixtureWorkspacePage.jsx',
  'CompetitionCenterPage.jsx',
  'MatchOperationsPage.jsx',
  'TorneosShell.jsx',
  'TournamentHubPage.jsx',
  'PublicTournamentPage.jsx',
  'TeamsPage.jsx',
  'TeamRegistrationPage.jsx',
  'TournamentWizardPage.jsx',
  'MediaAdminPage.jsx',
  'CommunicationsAdminPage.jsx',
];

function getTeamFilterStyles(viewport) {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: viewport.width,
  });
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    value: viewport.height,
  });

  const style = document.createElement('style');
  style.textContent = teamRegistrationCss;
  const rail = document.createElement('div');
  rail.className = 'filterRail';
  TEAM_FILTERS.forEach((label) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    rail.appendChild(button);
  });
  document.head.appendChild(style);
  document.body.appendChild(rail);

  const result = {
    buttons: [...rail.querySelectorAll('button')].map((button) => ({
      label: button.textContent,
      minHeight: Number.parseFloat(getComputedStyle(button).minHeight),
      whiteSpace: getComputedStyle(button).whiteSpace,
    })),
    railOverflowX: getComputedStyle(rail).overflowX,
  };

  rail.remove();
  style.remove();
  return result;
}

describe('Torneos responsive navigation CSS', () => {
  test('keeps mobile navigation hidden until the mobile/tablet breakpoint', () => {
    expect(css).toMatch(
      /\.desktopNavigation\s*\{[^}]*display:\s*flex;/,
    );
    expect(css).toMatch(
      /\.mobileNavigation\s*\{[^}]*display:\s*none;/,
    );
    expect(css).toMatch(
      /@media \(max-width:\s*900px\)[\s\S]*?\.mobileNavigation\s*\{[\s\S]*?display:\s*grid;/,
    );
  });

  test('collapses competitive grids and keeps all six wizard steps visible', () => {
    expect(competitionCss).toMatch(
      /@media \(max-width:\s*760px\)[\s\S]*?\.contextSelector,[\s\S]*?grid-template-columns:\s*1fr;/,
    );
    expect(competitionCss).toMatch(
      /@media \(max-width:\s*520px\)[\s\S]*?\.stepper\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);[\s\S]*?overflow-x:\s*hidden;/,
    );
    expect(competitionCss).toMatch(
      /\.stepper\s*\{[\s\S]*?overflow-x:\s*auto;/,
    );
  });

  test('preserves reduced-motion support for new competition screens', () => {
    expect(competitionCss).toMatch(
      /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*?animation:\s*none;/,
    );
  });

  test('collapses match operations layouts without shrinking touch targets', () => {
    expect(css).toMatch(
      /@media \(max-width:\s*900px\)[\s\S]*?\.mobileBrand\s*\{[\s\S]*?min-width:\s*44px;[\s\S]*?min-height:\s*44px;/,
    );
    expect(css).toMatch(
      /\.mobileBrand > span:first-child\s*\{[^}]*width:\s*138px;[^}]*height:\s*32px;/s,
    );
    expect(css).toMatch(
      /\.mobileNavigationHidden\s*\{[^}]*opacity:\s*0;[^}]*pointer-events:\s*none;[^}]*transform:\s*translateY\(130%\);/s,
    );
    expect(matchOperationsCss).toMatch(
      /@media \(max-width:\s*720px\)[\s\S]*?grid-template-columns:\s*1fr;/,
    );
    expect(matchOperationsCss).toMatch(
      /@media \(max-width:\s*390px\)/,
    );
    expect(matchOperationsCss).toMatch(/min-height:\s*44px;/);
    expect(matchOperationsCss).toMatch(
      /\.page\s+button,\s*\.page\s+input,\s*\.page\s+select,\s*\.page\s+textarea\s*\{[^}]*box-sizing:\s*border-box;/s,
    );
    expect(matchOperationsCss).toMatch(
      /\.detailCard\s+a\s*\{[^}]*min-height:\s*44px;/s,
    );
    expect(matchOperationsCss).toMatch(
      /@media \(prefers-reduced-motion:\s*reduce\)/,
    );
  });

  test('keeps the competition table usable without mandatory mobile overflow', () => {
    expect(competitionCenterCss).toMatch(
      /@media \(max-width:\s*680px\)[\s\S]*?\.table\s*\{[^}]*min-width:\s*0;[^}]*table-layout:\s*fixed;/,
    );
    expect(competitionCenterCss).toMatch(
      /\.teamDetail\s*\{[^}]*display:\s*none;[\s\S]*?@media \(max-width:\s*680px\)[\s\S]*?\.teamDetail\s*\{[^}]*display:\s*block;/,
    );
    expect(competitionCenterCss).toMatch(/min-height:\s*44px;/);
    expect(competitionCenterCss).toMatch(/:focus-visible/);
    expect(competitionCenterCss).toMatch(
      /@media \(prefers-reduced-motion:\s*reduce\)/,
    );
  });

  test.each([
    { width: 320, height: 700 },
    { width: 390, height: 844 },
  ])('keeps all five team filters at least 44px tall at $width × $height', (viewport) => {
    const { buttons, railOverflowX } = getTeamFilterStyles(viewport);

    expect(buttons.map(({ label }) => label)).toEqual(TEAM_FILTERS);
    expect(buttons).toHaveLength(5);
    buttons.forEach(({ minHeight, whiteSpace }) => {
      expect(minHeight).toBeGreaterThanOrEqual(44);
      expect(whiteSpace).toBe('nowrap');
    });
    expect(railOverflowX).toBe('auto');
  });

  test.each(TOUCH_SCROLL_SOURCES)('%s opts horizontal rails into the global touch contract', (fileName) => {
    const source = fs.readFileSync(path.join(
      process.cwd(),
      'src/features/torneos/components',
      fileName,
    ), 'utf8');

    expect(source).toContain('data-allow-horizontal-scroll');
  });
});
