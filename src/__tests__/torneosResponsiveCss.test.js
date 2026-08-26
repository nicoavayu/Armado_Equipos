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
    // Los seis pasos entran porque las columnas pueden achicarse hasta cero
    // (`minmax(0, 1fr)`), no porque un rail horizontal los tape. Con un mínimo
    // por columna —el `minmax(100px, 1fr)` que esto reemplazó— seis pasos piden
    // 600px y en 320px se iban de la caja: de ahí venían el `overflow-x: auto`
    // de base y el `overflow-x: hidden` del breakpoint, que recortaban el
    // síntoma. El stepper actual elimina la causa, así que el contrato es que
    // NO exista ese mínimo ni ese rail.
    expect(competitionCss).toMatch(
      /\.stepper\s*\{[\s\S]*?grid-template-columns:\s*repeat\(6,\s*minmax\(0,\s*1fr\)\);/,
    );
    expect(competitionCss).not.toMatch(
      /\.stepper\s*\{[^}]*grid-template-columns:\s*repeat\(6,\s*minmax\((?!0[,)])/,
    );
    expect(competitionCss).not.toMatch(/\.stepper\s*\{[^}]*overflow-x:\s*auto;/);
    // `overflow: hidden` (los dos ejes, en la regla base) es lo que garantiza
    // cero scroll horizontal en TODO ancho, no sólo por debajo de 520px.
    expect(competitionCss).toMatch(/\.stepper\s*\{[^}]*overflow:\s*hidden;/);
    expect(competitionCss).toMatch(
      /@media \(max-width:\s*520px\)[\s\S]*?\.stepper\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/,
    );
    // Los títulos se ven enteros o pasan de renglón: nunca `nowrap` ni ellipsis.
    expect(competitionCss).toMatch(
      /\.stepper em\s*\{[^}]*white-space:\s*normal;/,
    );
    expect(competitionCss).not.toMatch(
      /\.stepper em\s*\{[^}]*(white-space:\s*nowrap|text-overflow:\s*ellipsis)/,
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
      /\.mobileBrand \.brandLogo\s*\{[^}]*width:\s*50px;[^}]*height:\s*44px;/s,
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
});
