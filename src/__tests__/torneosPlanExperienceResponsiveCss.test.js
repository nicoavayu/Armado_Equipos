import fs from 'node:fs';
import path from 'node:path';

describe('Torneos plan experience responsive CSS', () => {
  const css = fs.readFileSync(
    path.join(
      process.cwd(),
      'src/features/torneos/components/PlanExperiencePage.module.css',
    ),
    'utf8',
  );
  const navigationCss = fs.readFileSync(
    path.join(
      process.cwd(),
      'src/features/torneos/components/OrganizationSettingsNav.module.css',
    ),
    'utf8',
  );
  const competitionSelector = fs.readFileSync(
    path.join(
      process.cwd(),
      'src/features/torneos/components/CompetitionSelector.jsx',
    ),
    'utf8',
  );

  test('collapses desktop plan layouts into native-friendly vertical cards', () => {
    expect(css).toMatch(/grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
    expect(css).toMatch(
      /@media \(max-width:\s*760px\)[\s\S]*?\.planCards,[\s\S]*?grid-template-columns:\s*1fr/,
    );
    expect(css).toMatch(
      /@media \(max-width:\s*760px\)[\s\S]*?\.premiumBenefits\s*\{[\s\S]*?grid-template-columns:\s*1fr/,
    );
    expect(css).toMatch(
      /@media \(max-width:\s*520px\)[\s\S]*?\.planSignal\s*\{[\s\S]*?display:\s*none/,
    );
    expect(navigationCss).toMatch(
      /@media \(max-width:\s*520px\)[\s\S]*?\.nav\s*\{[\s\S]*?width:\s*100%/,
    );
  });

  test('keeps touch targets, focus affordances and reduced motion explicit', () => {
    expect(css).toMatch(/\.errorBanner button\s*\{[\s\S]*?min-height:\s*44px/);
    expect(navigationCss).toMatch(/min-height:\s*44px/);
    expect(navigationCss).toMatch(/:focus-visible/);
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
  });

  test('avoids fixed plan widths that would overflow 320px and 390px runtimes', () => {
    expect(css).toMatch(/min-width:\s*0/);
    expect(css).not.toMatch(/min-width:\s*[4-9][0-9]{2}px/);
  });

  test('does not present an empty tournament option when a tournament is active', () => {
    expect(competitionSelector).toMatch(
      /!preference\.activeTournamentId[\s\S]*?<option value="">Elegí un torneo<\/option>/,
    );
    expect(competitionSelector).not.toContain('Sin torneo seleccionado');
  });
});
