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

  test('collapses desktop plan layouts into native-friendly vertical cards', () => {
    expect(css).toMatch(/grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
    expect(css).toMatch(
      /@media \(max-width:\s*760px\)[\s\S]*?\.planCards,[\s\S]*?grid-template-columns:\s*1fr/,
    );
    expect(css).toMatch(
      /@media \(max-width:\s*520px\)[\s\S]*?\.metrics\s*\{[\s\S]*?grid-template-columns:\s*1fr/,
    );
    expect(navigationCss).toMatch(
      /@media \(max-width:\s*520px\)[\s\S]*?\.nav\s*\{[\s\S]*?width:\s*100%/,
    );
  });

  test('keeps touch targets, focus affordances and reduced motion explicit', () => {
    expect(css).toMatch(/min-height:\s*46px/);
    expect(css).toMatch(/width:\s*44px;[\s\S]*?height:\s*44px/);
    expect(navigationCss).toMatch(/min-height:\s*44px/);
    expect(navigationCss).toMatch(/:focus-visible/);
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
  });

  test('avoids fixed plan widths that would overflow 320px and 390px runtimes', () => {
    expect(css).toMatch(/width:\s*min\(100%,\s*480px\)/);
    expect(css).not.toMatch(/min-width:\s*[4-9][0-9]{2}px/);
  });
});
