import fs from 'node:fs';
import path from 'node:path';

const css = fs.readFileSync(
  path.join(
    process.cwd(),
    'src/features/torneos/components/TorneosShell.module.css',
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
});
