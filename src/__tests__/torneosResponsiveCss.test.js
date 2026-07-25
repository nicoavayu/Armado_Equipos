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

  test('collapses competitive grids and keeps the six-step wizard horizontally scrollable', () => {
    expect(competitionCss).toMatch(
      /@media \(max-width:\s*760px\)[\s\S]*?\.contextSelector,[\s\S]*?grid-template-columns:\s*1fr;/,
    );
    expect(competitionCss).toMatch(
      /@media \(max-width:\s*520px\)[\s\S]*?\.stepper\s*\{[\s\S]*?grid-template-columns:\s*repeat\(6,\s*108px\);/,
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
});
