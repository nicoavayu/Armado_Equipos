import fs from 'fs';
import path from 'path';

/**
 * 1C.3A.1 — Torneos tiene dos tipografías y hacen cosas distintas.
 *
 * La editorial (Bebas, y la Oswald condensada que la acompaña) es identidad:
 * titulares grandes, en mayúsculas, con función inequívoca de encabezado. La de
 * interfaz es Inter, y es la que corresponde a todo lo que se toca: botones,
 * CTAs, opciones de radio, labels, inputs, tabs, steps, badges, links
 * funcionales, mensajes de estado, ayudas, nombres de archivo, controles.
 *
 * Estos tests no miran píxeles ni capturas: leen el CSS y afirman dos cosas
 * verificables. Que ningún selector de control declare la familia editorial, y
 * que los botones de estas pantallas salgan de los mismos tokens en vez de
 * volver a inventar altura, radio y escala. Es lo que impide que la próxima
 * feature vuelva a traer su propio botón.
 */

const read = (relative) => fs.readFileSync(path.join(process.cwd(), relative), 'utf8');

const TORNEOS_CSS = 'src/features/torneos/components';

const SHELL = read(`${TORNEOS_CSS}/TorneosShell.module.css`);

// Los archivos que esta pasada normaliza: Configuración del torneo, Multimedia,
// Branding, Player Portrait y el panel de autogestión. El resto de Torneos
// queda auditado y reportado, no tocado.
const SCOPED_FILES = Object.freeze([
  'CompetitionCore.module.css',
  'TournamentPublicPageSettings.module.css',
  'TeamVisualPolicySettings.module.css',
  'BrandingAssetField.module.css',
  'PlayerPortraitEditor.module.css',
  'TeamRegistration.module.css',
  'MediaAdminPage.module.css',
]);

const EDITORIAL_FAMILY = /bebas|oswald/i;

/**
 * Las excepciones, enumeradas a propósito. No son controles: son cifras y
 * marcas de display que viven adentro de un control y cumplen función
 * editorial. El rótulo del control —lo que se lee y se acciona— sigue siendo de
 * interfaz en los tres casos. Cualquier excepción nueva tiene que pasar por
 * acá, que es justamente el punto.
 */
const EDITORIAL_INSIDE_A_CONTROL = Object.freeze([
  // El `01` / `02` de 34px de las tarjetas de Modalidad y Formato.
  '.optionGrid button > span',
  '.formatGrid button > span',
]);

// Un control: algo que se toca, se enfoca o se completa. Un `h1`, un `h2` o un
// pseudo-elemento decorativo no entran, y son los únicos que pueden llevar la
// familia editorial.
const CONTROL_SELECTOR = new RegExp([
  'button',
  'input',
  'select',
  'textarea',
  'label',
  '\\.retry\\b',
  '\\.publish\\b',
  '\\.unpublish\\b',
  '\\.fileButton\\b',
  '\\.option\\b',
  '\\.stepper\\b',
  '\\.actions\\b',
  '\\.rowActions\\b',
  '\\.dialogActions\\b',
  '\\.primaryAction\\b',
  '\\.secondaryAction\\b',
  '\\.ghostAction\\b',
  '\\.dangerAction\\b',
  '\\.primaryButton\\b',
  '\\.secondaryButton\\b',
  '\\.dangerButton\\b',
  '\\.iconButton\\b',
].join('|'), 'i');

/** Cada regla del archivo como `{ selector, body }`, sin at-rules ni comentarios. */
const rulesOf = (css) => {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let match = pattern.exec(withoutComments);
  while (match) {
    const selector = match[1].trim();
    if (selector && !selector.startsWith('@') && !selector.startsWith('%')) {
      rules.push({ selector, body: match[2] });
    }
    match = pattern.exec(withoutComments);
  }
  return rules;
};

/** `font-family: …` y también el atajo `font: 700 13px …`. */
const declaredFamilies = (body) => (
  body.match(/(?:^|;)\s*font(?:-family)?\s*:[^;]+/g) || []
);

describe('1C.3A.1 — la tipografía editorial no es tipografía de interfaz', () => {
  test.each(SCOPED_FILES)('%s no declara Bebas/Oswald sobre ningún control', (file) => {
    const offenders = rulesOf(read(`${TORNEOS_CSS}/${file}`))
      .filter((rule) => CONTROL_SELECTOR.test(rule.selector))
      .filter((rule) => !EDITORIAL_INSIDE_A_CONTROL.includes(rule.selector))
      .flatMap((rule) => declaredFamilies(rule.body)
        .filter((declaration) => EDITORIAL_FAMILY.test(declaration))
        .map((declaration) => `${rule.selector} { ${declaration.trim()} }`));

    expect(offenders).toEqual([]);
  });

  test('la familia de interfaz y la editorial existen como tokens, no como literales sueltos', () => {
    expect(SHELL).toMatch(/--torneos-ui-font:\s*Inter,/);
    expect(SHELL).toMatch(/--torneos-editorial-font:\s*"Bebas Neue"/);
    // En `:root` y no sólo en `.shell`: los diálogos de retrato se montan con
    // createPortal fuera de `.shell`, y sin esto vuelven a heredar la Oswald de
    // `body`, que es exactamente cómo empezó la inconsistencia.
    expect(SHELL).toMatch(/:global\(:root\)\s*\{[^}]*--torneos-ui-font/);
  });

  test('el shell viste Torneos con la fuente de interfaz', () => {
    const shellRule = SHELL.match(/\.shell\s*\{([\s\S]*?)\n\}/);
    expect(shellRule).not.toBeNull();
    expect(shellRule[1]).toMatch(/font-family:\s*var\(--torneos-ui-font\)/);
  });
});

describe('1C.3A.1 — un solo sistema de botones', () => {
  const REQUIRED_TOKENS = Object.freeze([
    '--torneos-action-height',
    '--torneos-action-radius',
    '--torneos-action-padding-x',
    '--torneos-action-gap',
    '--torneos-action-font-size',
    '--torneos-action-font-weight',
    '--torneos-action-height-sm',
    '--torneos-action-radius-sm',
    '--torneos-focus-ring',
  ]);

  test('los tokens de control existen y describen la geometría de `Continuar`', () => {
    REQUIRED_TOKENS.forEach((token) => {
      expect(SHELL).toMatch(new RegExp(`${token}:`));
    });
    expect(SHELL).toMatch(/--torneos-action-height:\s*48px/);
    expect(SHELL).toMatch(/--torneos-action-radius:\s*16px/);
  });

  test('`Continuar` es la base y la base sale de los tokens', () => {
    const core = read(`${TORNEOS_CSS}/CompetitionCore.module.css`);
    const base = core.match(
      /\.primaryAction,\s*\n\.secondaryAction,\s*\n\.ghostAction,\s*\n\.dangerAction\s*\{([\s\S]*?)\n\}/,
    );
    expect(base).not.toBeNull();
    ['height', 'radius', 'padding-x', 'gap', 'font-size', 'font-weight'].forEach((part) => {
      expect(base[1]).toMatch(new RegExp(`var\\(--torneos-action-${part}\\)`));
    });
    expect(base[1]).toMatch(/font-family:\s*var\(--torneos-ui-font\)/);
    expect(base[1]).toMatch(/white-space:\s*nowrap/);
  });

  test('las acciones multimedia mantienen label e icono en una sola línea', () => {
    const media = read(`${TORNEOS_CSS}/MediaAdminPage.module.css`);
    const action = media.match(/\.assetActions button\s*\{([\s\S]*?)\n\}/);
    expect(action).not.toBeNull();
    expect(action[1]).toMatch(/display:\s*inline-flex/);
    expect(action[1]).toMatch(/align-items:\s*center/);
    expect(action[1]).toMatch(/white-space:\s*nowrap/);
    expect(media).toMatch(/\.assetActions button > svg[\s\S]*?flex:\s*0 0 auto/);
  });

  test('los tabs de Configuración usan radios consistentes y un activo sólido', () => {
    const settingsNav = read(`${TORNEOS_CSS}/OrganizationSettingsNav.module.css`);
    expect(settingsNav).toMatch(/\.nav\s*\{[\s\S]*?border-radius:\s*16px/);
    expect(settingsNav).toMatch(/\.nav a\s*\{[\s\S]*?border-radius:\s*12px/);
    expect(settingsNav).toMatch(/\.nav a\s*\{[\s\S]*?white-space:\s*nowrap/);
    expect(settingsNav).toMatch(/\.nav a svg\s*\{\s*flex:\s*0 0 auto/);
    expect(settingsNav).toMatch(/\.nav a\.active\s*\{[\s\S]*?linear-gradient/);
    expect(settingsNav).not.toMatch(/border-radius:\s*\d+px\s+\d+px/);
  });

  // Segundo patrón opcional para los archivos donde la familia se declara en una
  // regla compartida y la geometría en la propia del botón.
  test.each([
    ['TournamentPublicPageSettings.module.css', /\.actions > button,[\s\S]*?\n\}/, null],
    ['TeamVisualPolicySettings.module.css', /\.retry\s*\{[\s\S]*?\n\}/, null],
    ['BrandingAssetField.module.css', /\.actions button\s*\{[\s\S]*?\n\}/, null],
    [
      'PlayerPortraitEditor.module.css',
      /\.rowActions button\s*\{[\s\S]*?\n\}/,
      /\.rowActions button,\s*\n\.dialogActions button,\s*\n\.fileButton\s*\{[\s\S]*?\n\}/,
    ],
    ['TeamRegistration.module.css', /\.primaryButton,\s*\n\.secondaryButton,[\s\S]*?\n\}/, null],
  ])('%s toma la geometría del sistema y no la suya', (file, geometry, family) => {
    const css = read(`${TORNEOS_CSS}/${file}`);
    const rule = css.match(geometry);
    expect(rule).not.toBeNull();
    expect(rule[0]).toMatch(/border-radius:\s*var\(--torneos-action-radius/);
    expect(rule[0]).toMatch(/min-height:\s*var\(--torneos-action-height/);

    const familyRule = family ? css.match(family) : rule;
    expect(familyRule).not.toBeNull();
    expect(familyRule[0]).toMatch(/font-family:\s*var\(--torneos-ui-font/);
  });

  test('ningún CTA de estas pantallas vuelve a ser un chip', () => {
    // El radio pill y el círculo son excepciones semánticas —chips, badges,
    // controles segmentados, indicadores redondos—, no la forma de un botón con
    // texto. Van enumerados para que sea una decisión y no un descuido.
    const SEMANTIC_ROUND = Object.freeze([
      '.filterRail button', // Filtro segmentado de Equipos.
      '.stepper button > span', // El número redondo de cada paso del wizard.
      '.galleryRail button[aria-pressed="true"]',
    ]);
    const offenders = SCOPED_FILES.flatMap((file) => rulesOf(read(`${TORNEOS_CSS}/${file}`))
      .filter((rule) => /button|\.retry\b|\.fileButton\b/i.test(rule.selector))
      .filter((rule) => !SEMANTIC_ROUND.includes(rule.selector))
      .filter((rule) => /border-radius\s*:\s*(?:99+|50)(?:px|%)/.test(rule.body))
      .map((rule) => `${file}: ${rule.selector}`));

    expect(offenders).toEqual([]);
  });
});

describe('1C.3A.1 — las opciones de la política son controles, no titulares', () => {
  const policy = read(`${TORNEOS_CSS}/TeamVisualPolicySettings.module.css`);

  test('el nombre de cada opción usa la tipografía de interfaz', () => {
    const label = policy.match(/\.option b\s*\{([^}]*)\}/);
    expect(label).not.toBeNull();
    expect(label[1]).toMatch(/font-family:\s*var\(--torneos-ui-font\)/);
    expect(label[1]).not.toMatch(EDITORIAL_FAMILY);
  });

  test('el titular del panel sí es editorial', () => {
    const heading = policy.match(/\.copy h2\s*\{([^}]*)\}/);
    expect(heading).not.toBeNull();
    expect(heading[1]).toMatch(/font-family:\s*var\(--torneos-editorial-font\)/);
  });

  test('la card sigue siendo cómoda de tocar después de bajar la densidad', () => {
    const option = policy.match(/\n\.option\s*\{([^}]*)\}/);
    expect(option).not.toBeNull();
    const padding = option[1].match(/padding:\s*(\d+)px\s+(\d+)px/);
    expect(padding).not.toBeNull();
    expect(Number(padding[1])).toBeGreaterThanOrEqual(8);
    expect(option[1]).toMatch(/cursor:\s*pointer/);
    expect(policy).toMatch(/\.option:focus-within\s*\{[^}]*outline:\s*var\(--torneos-focus-ring\)/);
  });
});
