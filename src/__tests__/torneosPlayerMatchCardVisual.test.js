import fs from 'node:fs';
import path from 'node:path';

describe('Torneos player match card visual contract', () => {
  const css = fs.readFileSync(
    path.join(
      process.cwd(),
      'src/features/torneos/components/MatchOperations.module.css',
    ),
    'utf8',
  );

  test('keeps the unscheduled time on one line inside a deliberate rail', () => {
    expect(css).toMatch(
      /\.playerMatchCard\s*\{[^}]*grid-template-columns:\s*clamp\(176px,\s*18vw,\s*196px\)\s+minmax\(0,\s*1fr\);/s,
    );
    expect(css).toMatch(
      /\.matchRail strong\s*\{[^}]*font-family:\s*Inter,[^}]*white-space:\s*nowrap;/s,
    );
    expect(css).toMatch(/\.matchRail span\s*\{[^}]*white-space:\s*nowrap;/s);
    expect(css).toMatch(
      /\.matchRail\s*\{[^}]*border-radius:\s*0;[^}]*box-shadow:\s*none;/s,
    );
  });

  test('uses the Torneos UI family across the match header and internal labels', () => {
    expect(css).toMatch(
      /\.playerMatchHeading h2\s*\{[^}]*font-family:\s*Inter,[^}]*font-weight:\s*800;/s,
    );
    expect(css).toMatch(
      /\.playerMatchHeading small\s*\{[^}]*font-family:\s*Inter,/s,
    );
    expect(css).toMatch(
      /\.matchFacts dt\s*\{[^}]*font-family:\s*Inter,/s,
    );
    expect(css).toMatch(
      /\.matchFacts dd\s*\{[^}]*font-family:\s*Inter,/s,
    );
  });

  test('keeps the compact rail horizontal at the mobile breakpoint', () => {
    expect(css).toMatch(
      /@media \(max-width:\s*720px\)[\s\S]*?\.matchRail\s*\{[^}]*grid-template-columns:\s*1fr auto auto;/,
    );
  });
});
