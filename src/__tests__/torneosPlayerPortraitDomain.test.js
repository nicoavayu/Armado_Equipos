import {
  PLAYER_PORTRAIT_DEFAULT_CROP,
  PLAYER_PORTRAIT_DEFAULT_FOCAL,
  PLAYER_PORTRAIT_EDITOR_FRAME,
  PLAYER_PORTRAIT_FRAMES,
  PLAYER_PORTRAIT_MAX_ZOOM,
  PLAYER_PORTRAIT_MIN_ZOOM,
  PLAYER_PORTRAIT_PREVIEW_FRAMES,
  PLAYER_PORTRAIT_LIMITS,
  PLAYER_PORTRAIT_MAX_FILE_BYTES,
  clampCrop,
  cropExtent,
  cropFocalBounds,
  cropImageStyle,
  cropPlacement,
  focalObjectPosition,
  isDefaultFocalPoint,
  normalizeCrop,
  normalizeFocalPoint,
  panCrop,
  playerMonogram,
  validatePlayerPortraitFile,
  zoomCrop,
} from '../features/torneos/domain/playerPortraits';

function file(name, type, size) {
  return { name, type, size };
}

describe('player portrait selection rules', () => {
  test.each([
    ['retrato.jpg', 'image/jpeg'],
    ['retrato.jpeg', 'image/jpeg'],
    ['retrato.png', 'image/png'],
    ['retrato.webp', 'image/webp'],
  ])('accepts %s', (name, type) => {
    expect(validatePlayerPortraitFile(file(name, type, 2048))).toMatchObject({ valid: true });
  });

  test.each([
    ['retrato.svg', 'image/svg+xml'],
    ['retrato.html', 'text/html'],
    ['retrato.heic', 'image/heic'],
    ['retrato.heif', 'image/heif'],
    ['retrato.gif', 'image/gif'],
  ])('rejects %s because no real conversion exists', (name, type) => {
    const result = validatePlayerPortraitFile(file(name, type, 2048));
    expect(result.valid).toBe(false);
    expect(result.code).toBe('mime');
    expect(result.message).toMatch(/JPEG, PNG o WebP/);
  });

  test('rejects a file whose extension contradicts its declared type', () => {
    expect(validatePlayerPortraitFile(file('retrato.png', 'image/jpeg', 2048)))
      .toMatchObject({ valid: false, code: 'extension' });
  });

  test('rejects an empty file and one above 8 MiB', () => {
    expect(validatePlayerPortraitFile(file('retrato.jpg', 'image/jpeg', 0)))
      .toMatchObject({ valid: false, code: 'size' });
    expect(validatePlayerPortraitFile(
      file('retrato.jpg', 'image/jpeg', PLAYER_PORTRAIT_MAX_FILE_BYTES + 1),
    )).toMatchObject({ valid: false, code: 'size' });
    expect(validatePlayerPortraitFile(
      file('retrato.jpg', 'image/jpeg', PLAYER_PORTRAIT_MAX_FILE_BYTES),
    )).toMatchObject({ valid: true });
  });

  test('never promises a HEIC transcode it cannot perform', () => {
    expect(PLAYER_PORTRAIT_LIMITS.allowHeicTranscode).toBe(false);
    expect(PLAYER_PORTRAIT_LIMITS.maxFileBytes).toBe(PLAYER_PORTRAIT_MAX_FILE_BYTES);
  });

  test('normalizes within the 1C.2A contract ceiling', () => {
    expect(PLAYER_PORTRAIT_LIMITS.maxEdge).toBeLessThanOrEqual(12000);
    expect(PLAYER_PORTRAIT_LIMITS.maxPixels).toBeLessThanOrEqual(36_000_000);
  });
});

describe('focal point contract', () => {
  test('defaults to the centre', () => {
    expect(PLAYER_PORTRAIT_DEFAULT_FOCAL).toEqual({ x: 0.5, y: 0.5 });
    expect(normalizeFocalPoint(null)).toEqual({ x: 0.5, y: 0.5 });
    expect(isDefaultFocalPoint(undefined)).toBe(true);
  });

  test('clamps every value into 0..1', () => {
    expect(normalizeFocalPoint({ x: -3, y: 42 })).toEqual({ x: 0, y: 1 });
    expect(normalizeFocalPoint({ x: 1.0001, y: -0.0001 })).toEqual({ x: 1, y: 0 });
    expect(normalizeFocalPoint({ x: NaN, y: 'nope' })).toEqual({ x: 0.5, y: 0.5 });
  });

  test('rounds to the four decimals numeric(5,4) accepts', () => {
    expect(normalizeFocalPoint({ x: 0.123456, y: 0.987654 }))
      .toEqual({ x: 0.1235, y: 0.9877 });
  });

  test('translates into a CSS frame without cropping the source', () => {
    expect(focalObjectPosition({ x: 0.25, y: 0.75 })).toBe('25.00% 75.00%');
    expect(PLAYER_PORTRAIT_FRAMES.map((frame) => frame.key)).toEqual(['square', 'portrait']);
  });
});

describe('monogram fallback', () => {
  test.each([
    ['Francisco González', 'FG'],
    ['Alejandro Fernández', 'AF'],
    ['Cher', 'C'],
    ['  Ana   María  López ', 'AM'],
    ['Ñandú Ávila', 'ÑÁ'],
  ])('%s renders as %s', (name, expected) => {
    expect(playerMonogram(name)).toBe(expected);
  });

  test('never returns an empty or technical placeholder', () => {
    expect(playerMonogram('')).toBe('?');
    expect(playerMonogram(null)).toBe('?');
  });
});

/*
 * La geometría del encuadre: acá se prueba lo que en el navegador es un gesto.
 * Nada de esto mide píxeles —son fracciones del marco—, así que se puede
 * afirmar sin un layout real.
 */
const PORTRAIT_FRAME = PLAYER_PORTRAIT_EDITOR_FRAME.ratio;
const SQUARE_FRAME = 1;
const TALL = { width: 900, height: 1200 };
const WIDE = { width: 1600, height: 900 };
const EPSILON = 1e-9;

/** El marco tapado por completo: ningún borde vacío, en ningún eje. */
function covered(placement) {
  return placement.left <= EPSILON
    && placement.top <= EPSILON
    && placement.left + placement.width >= 1 - EPSILON
    && placement.top + placement.height >= 1 - EPSILON;
}

describe('crop model', () => {
  test('is three fractions and nothing else', () => {
    expect(PLAYER_PORTRAIT_DEFAULT_CROP).toEqual({ x: 0.5, y: 0.5, zoom: 1 });
    expect(normalizeCrop({ x: 0.123456, y: 0.987654, zoom: 1.23456 }))
      .toEqual({ x: 0.1235, y: 0.9877, zoom: 1.2346 });
    expect(normalizeCrop(null)).toEqual(PLAYER_PORTRAIT_DEFAULT_CROP);
  });

  test('the editor frame is 4:5 and the only preview left is the square one', () => {
    expect(PLAYER_PORTRAIT_EDITOR_FRAME).toMatchObject({ key: 'portrait', ratio: 0.8 });
    expect(PLAYER_PORTRAIT_PREVIEW_FRAMES.map((frame) => frame.key)).toEqual(['square']);
    expect(PLAYER_PORTRAIT_FRAMES.find((frame) => frame.key === 'square'))
      .toMatchObject({ ratio: 1, aspectRatio: '1 / 1' });
  });
});

describe('minimum zoom covers the frame whatever the photo is', () => {
  test('zoom 1 is the covering scale, and it is not the same scale for every photo', () => {
    const tall = cropExtent({ natural: TALL, frameRatio: PORTRAIT_FRAME, zoom: 1 });
    const wide = cropExtent({ natural: WIDE, frameRatio: PORTRAIT_FRAME, zoom: 1 });
    // Una vertical desborda por arriba y abajo; una horizontal, por los lados.
    expect(tall).toEqual({ width: 1, height: expect.closeTo(1.0667, 4) });
    expect(wide).toEqual({ width: expect.closeTo(2.2222, 4), height: 1 });
    // El mínimo visual de una horizontal no es el de una vertical: se calcula.
    expect(wide.width).toBeGreaterThan(tall.width);
  });

  test('never goes below the covering scale, however hard it is asked', () => {
    expect(normalizeCrop({ zoom: 0.2 }).zoom).toBe(PLAYER_PORTRAIT_MIN_ZOOM);
    expect(normalizeCrop({ zoom: -5 }).zoom).toBe(PLAYER_PORTRAIT_MIN_ZOOM);
    expect(normalizeCrop({ zoom: 'nope' }).zoom).toBe(PLAYER_PORTRAIT_MIN_ZOOM);
    const extent = cropExtent({ natural: WIDE, frameRatio: SQUARE_FRAME, zoom: 0.1 });
    expect(extent.width).toBeGreaterThanOrEqual(1);
    expect(extent.height).toBeGreaterThanOrEqual(1);
  });

  test('stops at a practical maximum instead of an absurd one', () => {
    expect(PLAYER_PORTRAIT_MAX_ZOOM).toBe(4);
    expect(normalizeCrop({ zoom: 40 }).zoom).toBe(PLAYER_PORTRAIT_MAX_ZOOM);
    expect(zoomCrop({ x: 0.5, y: 0.5, zoom: 3.9 }, {
      natural: TALL, frameRatio: PORTRAIT_FRAME, zoom: 12,
    }).zoom).toBe(PLAYER_PORTRAIT_MAX_ZOOM);
  });
});

describe('pan limits: the frame is always full', () => {
  test('the focal point cannot leave the covering range', () => {
    const bounds = cropFocalBounds({ natural: WIDE, frameRatio: PORTRAIT_FRAME, zoom: 1 });
    // 0.225 y 0.775 son el límite exacto; se cierran hacia adentro al mismo
    // redondeo que se persiste, así que el valor guardado nunca deja un hueco
    // de fracción de píxel al volver a abrirlo.
    expect(bounds.x.low).toBeGreaterThanOrEqual(0.225);
    expect(bounds.x.low).toBeCloseTo(0.225, 3);
    expect(bounds.x.high).toBeLessThanOrEqual(0.775);
    expect(bounds.x.high).toBeCloseTo(0.775, 3);
    // Sin desborde no hay nada que elegir: el eje queda clavado en el centro.
    expect(bounds.y).toMatchObject({ low: 0.5, high: 0.5, locked: true });
    expect(clampCrop({ x: 0, y: 0, zoom: 1 }, {
      natural: WIDE, frameRatio: PORTRAIT_FRAME,
    })).toEqual({ x: bounds.x.low, y: 0.5, zoom: 1 });
  });

  test('dragging horizontally moves the photo and stops at the edge', () => {
    const start = normalizeCrop({ x: 0.5, y: 0.5, zoom: 1 });
    const context = { natural: WIDE, frameRatio: PORTRAIT_FRAME };
    // Arrastrar hacia la derecha trae al centro lo que estaba a la izquierda.
    const dragged = panCrop(start, { ...context, dx: 0.25 });
    expect(dragged.x).toBeLessThan(start.x);
    expect(covered(cropPlacement({ ...context, crop: dragged }))).toBe(true);
    // Y por más que se insista, el borde no entra en el marco.
    const forced = panCrop(start, { ...context, dx: 40 });
    expect(forced.x).toBeCloseTo(0.225, 3);
    expect(cropPlacement({ ...context, crop: forced }).left).toBeLessThanOrEqual(EPSILON);
  });

  test('dragging vertically moves the photo and stops at the edge', () => {
    const context = { natural: TALL, frameRatio: PORTRAIT_FRAME };
    const start = normalizeCrop({ x: 0.5, y: 0.5, zoom: 1 });
    const dragged = panCrop(start, { ...context, dy: 0.02 });
    expect(dragged.y).toBeLessThan(start.y);
    const forced = panCrop(start, { ...context, dy: -50 });
    const placement = cropPlacement({ ...context, crop: forced });
    expect(placement.top + placement.height).toBeGreaterThanOrEqual(1 - EPSILON);
    expect(covered(placement)).toBe(true);
  });

  test('no photo, frame or zoom leaves an empty edge', () => {
    const sizes = [TALL, WIDE, { width: 1000, height: 1000 }, { width: 4000, height: 1200 },
      { width: 640, height: 1600 }];
    const zooms = [1, 1.0001, 1.37, 2.5, 4];
    const focals = [0, 0.1, 0.5, 0.9, 1];
    for (const natural of sizes) {
      for (const frameRatio of [PORTRAIT_FRAME, SQUARE_FRAME]) {
        for (const zoom of zooms) {
          for (const value of focals) {
            const placement = cropPlacement({
              natural, frameRatio, crop: { x: value, y: 1 - value, zoom },
            });
            expect(covered(placement)).toBe(true);
          }
        }
      }
    }
  });

  test('without natural dimensions it falls back to the plain focal frame', () => {
    expect(cropPlacement({ natural: null, frameRatio: PORTRAIT_FRAME, crop: { x: 0.3, y: 0.2 } }))
      .toBeNull();
    expect(cropImageStyle({ natural: null, frameRatio: PORTRAIT_FRAME, crop: { x: 0.3, y: 0.2 } }))
      .toEqual({ width: '100%', height: '100%', objectPosition: '30.00% 20.00%' });
  });
});

describe('zoom keeps what the user was looking at', () => {
  const context = { natural: WIDE, frameRatio: PORTRAIT_FRAME };

  test('zooming from the slider holds the centre of the frame', () => {
    const start = normalizeCrop({ x: 0.4, y: 0.5, zoom: 1 });
    const closer = zoomCrop(start, { ...context, zoom: 2 });
    expect(closer.zoom).toBe(2);
    expect(closer.x).toBeCloseTo(start.x, 4);
    expect(covered(cropPlacement({ ...context, crop: closer }))).toBe(true);
  });

  test('pinching holds the point between the two fingers', () => {
    const start = normalizeCrop({ x: 0.5, y: 0.5, zoom: 1 });
    const anchor = { x: 0.25, y: 0.5 };
    const before = cropPlacement({ ...context, crop: start });
    const pointUnderAnchor = (placement) => (anchor.x - placement.left) / placement.width;
    const zoomed = zoomCrop(start, { ...context, zoom: 2.4, anchor });
    const after = cropPlacement({ ...context, crop: zoomed });
    expect(pointUnderAnchor(after)).toBeCloseTo(pointUnderAnchor(before), 3);
    expect(covered(after)).toBe(true);
  });

  test('zooming out lands back on a legal crop instead of an empty edge', () => {
    const zoomedIn = normalizeCrop({ x: 0.95, y: 0.5, zoom: 3 });
    const legal = clampCrop(zoomedIn, context);
    const out = zoomCrop(legal, { ...context, zoom: 1 });
    expect(out.zoom).toBe(1);
    expect(covered(cropPlacement({ ...context, crop: out }))).toBe(true);
  });
});

describe('reload rebuilds the very same frame', () => {
  test('the stored crop survives the numeric round trip untouched', () => {
    const context = { natural: WIDE, frameRatio: PORTRAIT_FRAME };
    const edited = panCrop(zoomCrop(normalizeCrop(PLAYER_PORTRAIT_DEFAULT_CROP), {
      ...context, zoom: 1.84,
    }), { ...context, dx: 0.17, dy: -0.09 });

    // Lo que vuelve de la base son cadenas `numeric`: el mismo encuadre.
    const stored = {
      x: edited.x.toFixed(4), y: edited.y.toFixed(4), zoom: edited.zoom.toFixed(4),
    };
    const reloaded = normalizeCrop(stored);
    expect(reloaded).toEqual(edited);
    expect(cropPlacement({ ...context, crop: reloaded }))
      .toEqual(cropPlacement({ ...context, crop: edited }));
  });

  test('the same crop draws both frames without a second edit', () => {
    const crop = { x: 0.62, y: 0.3, zoom: 1.5 };
    const square = cropPlacement({ natural: WIDE, frameRatio: SQUARE_FRAME, crop });
    const portrait = cropPlacement({ natural: WIDE, frameRatio: PORTRAIT_FRAME, crop });
    // El cuadrado tiene menos margen que el 4:5, así que el mismo dato se
    // ajusta a cada marco en vez de dejar un borde vacío en el más angosto.
    expect(covered(square)).toBe(true);
    expect(covered(portrait)).toBe(true);
    expect(square.crop.zoom).toBe(portrait.crop.zoom);
  });

  test('the placement is pure geometry: no pixels, no viewport', () => {
    const style = cropImageStyle({
      natural: WIDE, frameRatio: PORTRAIT_FRAME, crop: { x: 0.5, y: 0.5, zoom: 1 },
    });
    expect(style).toEqual({
      position: 'absolute',
      width: '222.2222%',
      height: '100%',
      left: '-61.1111%',
      top: '0%',
    });
  });
});
