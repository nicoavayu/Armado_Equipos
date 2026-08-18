import fs from 'node:fs';

const migration = fs.readFileSync(
  'supabase/migrations/20260818120000_tournament_player_portrait_ux.sql',
  'utf8',
);
// Los comentarios —y los COMMENT ON— explican de qué se abstiene la migración;
// las aserciones negativas tienen que mirar el SQL ejecutable, no la prosa.
const sql = migration
  .replace(/^\s*--.*$/gm, '')
  .replace(/COMMENT ON [\s\S]*?;/g, '');
const service = fs.readFileSync(
  'src/features/torneos/api/tournamentPlayerPortraitService.js',
  'utf8',
);
const dialog = fs.readFileSync(
  'src/features/torneos/components/PlayerPortraitDialog.jsx',
  'utf8',
);
const editor = fs.readFileSync(
  'src/features/torneos/components/PlayerPortraitCropEditor.jsx',
  'utf8',
);
const domain = fs.readFileSync(
  'src/features/torneos/domain/playerPortraits.js',
  'utf8',
);
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const actions = fs.readFileSync(
  'src/features/torneos/components/PlayerPortraitActions.jsx',
  'utf8',
);
const editorCss = fs.readFileSync(
  'src/features/torneos/components/PlayerPortraitEditor.module.css',
  'utf8',
);
const brandingCss = fs.readFileSync(
  'src/features/torneos/components/BrandingAssetField.module.css',
  'utf8',
);
const plantelCss = fs.readFileSync(
  'src/features/torneos/components/TeamRegistration.module.css',
  'utf8',
);
const rosterCss = fs.readFileSync(
  'src/features/torneos/components/RosterPlayerPortrait.module.css',
  'utf8',
);

/** El código sin la prosa: las aserciones negativas miran lo ejecutable. */
function code(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** Las declaraciones de un bloque, sin los comentarios que lo explican. */
function block(css, selector) {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no existe el bloque ${selector}`);
  const end = css.indexOf('}', start);
  return css.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, '');
}

test('1C.2B extiende el modelo por adición y nada más', () => {
  expect(sql).not.toMatch(/CREATE TABLE|DROP TABLE|DROP COLUMN|DROP CONSTRAINT/i);
  expect(sql).not.toMatch(/CREATE POLICY|DROP POLICY|storage\.objects|storage\.buckets/i);
  // Las operaciones de 1C.2A quedan intactas.
  expect(sql).not.toMatch(/request_tournament_player_portrait_upload|finalize_|begin_.*_delete/);
  expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.set_tournament_player_portrait_crop/);
  expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.list_tournament_player_portrait_refs/);

  // Lo único que toca la tabla: la columna del zoom y su límite. Aditivas las
  // dos, y con el default correcto para toda fila que ya existía.
  const alters = sql.match(/ALTER TABLE[\s\S]*?;/g) || [];
  expect(alters).toHaveLength(2);
  expect(alters[0]).toMatch(
    /ADD COLUMN IF NOT EXISTS crop_zoom numeric\(6,4\) NOT NULL DEFAULT 1\.0/,
  );
  expect(alters[1]).toMatch(/ADD CONSTRAINT tournament_player_portraits_crop_zoom_check/);
  expect(alters[1]).toMatch(/CHECK \(crop_zoom BETWEEN 1 AND 4\)/);
  // Ninguna otra columna del retrato se redefine.
  expect(sql).not.toMatch(/ALTER COLUMN|RENAME/i);
});

test('el encuadre se valida en el servidor y no toca el objeto de Storage', () => {
  expect(migration).toMatch(/p_focal_x < 0 OR p_focal_x > 1/);
  expect(migration).toMatch(/p_focal_y < 0 OR p_focal_y > 1/);
  expect(migration).toMatch(/TORNEOS_PORTRAIT_FOCAL_INVALID/);
  // El zoom es parte del mismo encuadre: se guarda con él o no se guarda.
  expect(migration).toMatch(/p_zoom IS NULL OR p_zoom < 1 OR p_zoom > 4/);
  expect(migration).toMatch(/TORNEOS_PORTRAIT_ZOOM_INVALID/);
  expect(migration).toMatch(/SET focal_x = v_focal_x, focal_y = v_focal_y, crop_zoom = v_zoom/);
  // La forma parcial —punto focal sin zoom— no queda habilitada.
  expect(migration).toMatch(
    /DROP FUNCTION IF EXISTS public\.set_tournament_player_portrait_focal_point/,
  );
  expect(migration).toMatch(/can_manage_tournament_player_portrait_as/);
  expect(migration).toMatch(/lifecycle_status = 'active'/);
  expect(sql).not.toMatch(/object_path|bucket|byte_size|mime_type/);
  expect(migration).toMatch(/portrait\.crop_updated/);
});

test('la lectura por equipo devuelve ImageRef y capability, nunca ruta ni firma', () => {
  expect(migration).toMatch(/'kind', 'player_portrait'/);
  // El encuadre viaja entero: sin el zoom, recargar reconstruiría otro marco.
  expect(migration).toMatch(/'cropZoom', portrait\.crop_zoom/);
  expect(sql).not.toMatch(/signed|signUrl|createSignedUrl|object_path/i);
  expect(migration).toMatch(/can_read_tournament_team_entry/);
  expect(migration).toMatch(/can_read_tournament_player_portrait_as/);
});

test('el consentimiento y el estado editorial siguen fuera del alcance de 1C.2B', () => {
  expect(sql).not.toMatch(/publication_consent\s*=|editorial_status\s*=/);
  expect(sql).not.toMatch(/'approved'|'granted'|public_page|social_export/);
  expect(service).not.toMatch(/set_tournament_player_portrait_editorial_status/);
  expect(service).not.toMatch(/revoke_tournament_player_portrait_publication/);
  expect(actions).not.toMatch(/aprobar|publicar|consentimiento/i);
});

test('la firma es efímera: no se guarda ni viaja como identidad de la foto', () => {
  expect(service).toMatch(/PORTRAIT_FUNCTION/);
  expect(service).not.toMatch(/localStorage|sessionStorage|indexedDB/);
  expect(service).not.toMatch(/supabase\.storage/);
  expect(service).toMatch(/audience = PLAYER_PORTRAIT_ENABLED_AUDIENCES\[0\]/);
});

test('la UI no ofrece el avatar global de Arma2 todavía', () => {
  expect(dialog).not.toMatch(/avatar_url|avatarUrl|avatar de Arma2/);
  expect(actions).not.toMatch(/avatar_url|avatarUrl/);
});

// El diálogo se portalea a `body`, fuera de `.shell`: ahí lo que se hereda es
// la Oswald editorial de `body`, así que la familia de los botones no se puede
// dar por heredada. Éstas son las tres superficies con CTA de retrato/branding.
test('los botones de acción llevan la tipografía estándar, nunca la editorial', () => {
  const STANDARD = /font-family:\s*Inter,\s*ui-sans-serif,\s*system-ui,\s*sans-serif/;
  // Los CTA del retrato —Cambiar, Quitar, Subir foto, Guardar foto, Cancelar,
  // Elegir otra foto— se declaran juntos: una sola regla, una sola familia.
  const portraitButtons = block(editorCss, '.rowActions button,\n.dialogActions button,\n.fileButton');
  expect(portraitButtons).toMatch(STANDARD);

  const surfaces = [
    portraitButtons,
    block(brandingCss, '.actions button'),
    block(plantelCss, '.portraitNotice button'),
  ];
  for (const surface of surfaces) {
    expect(surface).toMatch(STANDARD);
    // Bebas y Oswald siguen siendo de los títulos: acá no entran.
    expect(surface).not.toMatch(/Bebas|Oswald/);
  }
});

// Arma2 no tiene `box-sizing: border-box` global: lo declara cada superficie
// para su propio árbol. El diálogo se portalea a `body` y no cae dentro de
// ninguno, así que sin esto medía 42px más que su hueco y en un teléfono se
// cortaban 7px de cada lado.
test('el portal declara su propio box-sizing y el diálogo entra en la pantalla', () => {
  expect(editorCss).toMatch(
    /\.overlay,\s*\n\.overlay \*,\s*\n\.overlay \*::before,\s*\n\.overlay \*::after \{\s*\n\s*box-sizing: border-box;/,
  );
  // El techo de alto acompaña al padding del overlay en cada breakpoint.
  expect(block(editorCss, '.dialog')).toMatch(/max-height:\s*calc\(100dvh - 32px\)/);
  expect(editorCss).toMatch(/max-height:\s*calc\(100dvh - 20px\)/);
});

test('el selector de archivo se presenta con UI propia sin perder el input real', () => {
  // El nativo no se ve…
  expect(block(editorCss, '.fileInput')).toMatch(/clip-path:\s*inset\(50%\)/);
  // …pero sigue existiendo, enfocable y con anillo de foco visible: ocultarlo
  // con `display: none` lo sacaría del foco y del lector de pantalla.
  expect(block(editorCss, '.fileInput')).not.toMatch(/display:\s*none|visibility:\s*hidden/);
  expect(editorCss).toMatch(/\.fileInput:focus-visible \+ \.fileButton/);

  // La etiqueta asociada es la que hace de botón, y el nombre del archivo
  // elegido —lo único que comunicaba el control nativo— se dice en castellano.
  expect(dialog).toMatch(/type="file"/);
  expect(dialog).toMatch(/className=\{styles\.fileInput\}/);
  expect(dialog).toMatch(/<label className=\{styles\.fileButton\} htmlFor="player-portrait-file">/);
  expect(dialog).toMatch(/Elegir otra foto/);
  expect(dialog).toMatch(/className=\{styles\.fileName\}/);
});


/*
 * 1C.2B.3: el usuario acomoda una foto, no edita coordenadas. Lo que sigue no es
 * estética: son las tres promesas que sostienen esa frase.
 */
test('el editor no expone ninguna coordenada: los deslizadores de X e Y no existen', () => {
  expect(editor).not.toMatch(/Punto focal/);
  expect(dialog).not.toMatch(/Punto focal|PlayerPortraitFocalPicker/);
  expect(editorCss).not.toMatch(/focalSliders|focalHandle/);
  expect(fs.existsSync('src/features/torneos/components/PlayerPortraitFocalPicker.jsx'))
    .toBe(false);
  // Un único control de zoom, y el copy habla de la foto, no de ejes.
  expect(editor.match(/type="range"/g)).toHaveLength(1);
  expect(editor).toMatch(/aria-label="Zoom"/);
  expect(editor).toMatch(/Ajustá la foto/);
  expect(editor).toMatch(/Arrastrá para mover/);
  // El copy aprobado de privacidad no se toca.
  expect(dialog).toMatch(/Foto privada del plantel\. Tenerla no la publica en ningún lado\./);
});

test('el marco es el que no se mueve, y el gesto no scrollea el diálogo', () => {
  const frame = block(editorCss, '.cropFrame');
  expect(frame).toMatch(/aspect-ratio: 4 \/ 5/);
  expect(frame).toMatch(/overflow: hidden/);
  expect(frame).toMatch(/position: relative/);
  // El gesto le pertenece a la foto sólo dentro del marco: nada bloquea el
  // scroll del diálogo ni del documento.
  expect(frame).toMatch(/touch-action: none/);
  // El filo no es un borde: un borde encogería la caja contra la que se
  // resuelven los porcentajes del encuadre y el marco dejaría de ser el mismo
  // rectángulo del que habla la geometría.
  expect(frame).not.toMatch(/border:\s*\d/);
  expect(frame).toMatch(/box-shadow: inset 0 0 0 1px/);
  expect(code(editor)).not.toMatch(/document\.body\.style|preventScroll|overscroll/);
  // Y es la única regla de `touch-action` de la hoja: el marco, y nada más.
  expect(code(editorCss).match(/touch-action:[^;]+;/g)).toEqual(['touch-action: none;']);
  // Enfocable y manejable sin mouse.
  expect(editor).toMatch(/tabIndex=\{disabled \? -1 : 0\}/);
  expect(editor).toMatch(/ArrowLeft|ArrowRight/);
  expect(editor).toMatch(/shiftKey/);
  expect(editor).toMatch(/aria-describedby=/);
});

test('el encuadre es metadata determinista, no píxeles ni una librería de crop', () => {
  // Ni recorte físico ni canvas: la original queda intacta y el encuadre son
  // fracciones que cualquier marco puede volver a aplicar.
  expect(code(editor)).not.toMatch(/canvas|toBlob|toDataURL|drawImage/i);
  expect(code(domain)).not.toMatch(/canvas|toBlob|drawImage/i);
  expect(domain).toMatch(/export function cropPlacement/);
  // La geometría no mide el viewport: no hay `getBoundingClientRect` fuera de la
  // traducción del gesto, ni un observer que la haga depender del tamaño.
  expect(code(domain)).not.toMatch(/getBoundingClientRect|ResizeObserver/);
  expect((code(editor).match(/getBoundingClientRect/g) || []).length).toBe(1);
  // Sin dependencia nueva: pointer events, transforms y dos divisiones por eje.
  const dependencies = Object.keys(packageJson.dependencies || {});
  expect(dependencies.filter((name) => /crop|cropper|gesture|zoom|pinch/i.test(name)))
    .toEqual([]);
});

/*
 * El preflight de Tailwind declara `img, video { max-width: 100%; height: auto }`
 * para todo el documento. Una foto acercada mide, por definición, más que su
 * marco: sin desactivar ese techo la imagen se recortaba al 100% del marco y
 * aparecía el borde vacío que el encuadre garantiza que no existe. No es un
 * detalle de estilo, es la geometría, y jsdom no puede verlo porque no hace
 * layout.
 */
test('ninguna imagen encuadrada hereda el techo de ancho del reset global', () => {
  for (const [css, selector] of [
    [editorCss, '.cropImage'],
    [editorCss, '.framePreview img'],
    [rosterCss, '.image'],
  ]) {
    expect(block(css, selector)).toMatch(/max-width:\s*none/);
    expect(block(css, selector)).toMatch(/max-height:\s*none/);
  }
});
