/**
 * Retrato de un jugador del plantel (Multimedia 1C.2).
 *
 * La referencia durable es `ImageRef`: nunca un bucket, un path ni una URL
 * firmada. El encuadre viaja aparte como punto focal normalizado, de modo que
 * la imagen original permanece intacta y cada consumidor decide su recorte.
 */

import { MediaClientError, prepareUploadPayload } from './mediaImageClient';

export const PLAYER_PORTRAIT_KIND = 'player_portrait';
export const PLAYER_PORTRAIT_VARIANTS = Object.freeze([
  'original', 'square', 'portrait', 'social',
]);
export const PLAYER_PORTRAIT_ENABLED_AUDIENCES = Object.freeze([
  'authenticated_roster',
]);

export const PLAYER_PORTRAIT_BUCKET = 'tournament-player-portraits';
export const PLAYER_PORTRAIT_MAX_FILE_BYTES = 8 * 1024 * 1024;
export const PLAYER_PORTRAIT_ALLOWED_MIME = Object.freeze([
  'image/jpeg', 'image/png', 'image/webp',
]);

/**
 * El techo real del contrato 1C.2A es 12000 px de arista y 36 MP, pero eso no
 * es un objetivo: es el límite que el servidor rechaza. La normalización del
 * navegador se queda muy por debajo para que el original guardado sea
 * manejable y siga alcanzando para derivar variantes cuadrada, 4:5 y social
 * más adelante. Bajar de acá no recorta la foto, sólo la escala.
 */
export const PLAYER_PORTRAIT_LIMITS = Object.freeze({
  maxFileBytes: PLAYER_PORTRAIT_MAX_FILE_BYTES,
  maxSelectedFileBytes: PLAYER_PORTRAIT_MAX_FILE_BYTES,
  maxPixels: 9_000_000,
  maxEdge: 3000,
  resizeToFit: true,
  // No hay decodificador HEIC/HEIF confiable en el navegador: sin conversión
  // real, se rechaza en vez de prometer una que no existe.
  allowHeicTranscode: false,
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FILE_EXTENSIONS = Object.freeze({
  'image/jpeg': Object.freeze(['jpg', 'jpeg']),
  'image/png': Object.freeze(['png']),
  'image/webp': Object.freeze(['webp']),
});

export function playerPortraitRef(id, variant = 'original') {
  if (!UUID_RE.test(String(id)) || !PLAYER_PORTRAIT_VARIANTS.includes(variant)) {
    throw new TypeError('Invalid player portrait reference.');
  }
  return Object.freeze({ kind: PLAYER_PORTRAIT_KIND, id, variant });
}

export function isPlayerPortraitRef(value) {
  return value?.kind === PLAYER_PORTRAIT_KIND
    && UUID_RE.test(String(value.id))
    && PLAYER_PORTRAIT_VARIANTS.includes(value.variant);
}

function extensionOf(name = '') {
  return String(name).trim().toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || '';
}

/**
 * Pre-flight de la selección. No es la frontera de seguridad —el Edge function
 * y la base vuelven a validar todo— pero evita mandar al servidor lo que ya se
 * sabe que va a rechazar y permite explicar el motivo en castellano.
 */
export function validatePlayerPortraitFile(file) {
  if (!file) return { valid: false, code: 'missing', message: 'Elegí una imagen.' };
  const mime = String(file.type || '').toLowerCase();
  if (!PLAYER_PORTRAIT_ALLOWED_MIME.includes(mime)) {
    return {
      valid: false,
      code: 'mime',
      message: 'Formato no admitido. Usá JPEG, PNG o WebP.',
    };
  }
  if (!FILE_EXTENSIONS[mime].includes(extensionOf(file.name))) {
    return {
      valid: false,
      code: 'extension',
      message: 'La extensión no coincide con el formato de la imagen.',
    };
  }
  if (!Number.isFinite(file.size) || file.size < 1) {
    return { valid: false, code: 'size', message: 'La imagen está vacía.' };
  }
  if (file.size > PLAYER_PORTRAIT_MAX_FILE_BYTES) {
    return { valid: false, code: 'size', message: 'La foto supera los 8 MB.' };
  }
  return { valid: true, code: null, message: '' };
}

export async function preparePlayerPortraitFile(file) {
  const validation = validatePlayerPortraitFile(file);
  if (!validation.valid) {
    throw new MediaClientError(validation.code, validation.message);
  }
  return prepareUploadPayload(file, { limits: PLAYER_PORTRAIT_LIMITS });
}

export const PLAYER_PORTRAIT_DEFAULT_FOCAL = Object.freeze({ x: 0.5, y: 0.5 });

function clampUnit(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(1, Math.max(0, number));
}

/** Redondeo a 4 decimales: exactamente lo que acepta `numeric(5,4)`. */
export function normalizeFocalPoint(focal) {
  return Object.freeze({
    x: Math.round(clampUnit(focal?.x, PLAYER_PORTRAIT_DEFAULT_FOCAL.x) * 10000) / 10000,
    y: Math.round(clampUnit(focal?.y, PLAYER_PORTRAIT_DEFAULT_FOCAL.y) * 10000) / 10000,
  });
}

export function isDefaultFocalPoint(focal) {
  const normalized = normalizeFocalPoint(focal);
  return normalized.x === PLAYER_PORTRAIT_DEFAULT_FOCAL.x
    && normalized.y === PLAYER_PORTRAIT_DEFAULT_FOCAL.y;
}

/** `object-position` equivalente al punto focal, para encuadrar sin recortar. */
export function focalObjectPosition(focal) {
  const { x, y } = normalizeFocalPoint(focal);
  return `${(x * 100).toFixed(2)}% ${(y * 100).toFixed(2)}%`;
}

/**
 * Los encuadres que 1C.2D va a derivar físicamente. Acá sólo se previsualizan
 * sobre la misma imagen: no se genera ninguna variante. `aspectRatio` es la
 * forma que entiende CSS; `ratio` es el mismo encuadre como número, que es lo
 * que necesita la geometría del editor.
 */
export const PLAYER_PORTRAIT_FRAMES = Object.freeze([
  Object.freeze({ key: 'square', label: 'Avatar', aspectRatio: '1 / 1', ratio: 1 }),
  Object.freeze({ key: 'portrait', label: 'Retrato 4:5', aspectRatio: '4 / 5', ratio: 0.8 }),
]);

/**
 * El editor encuadra en 4:5 vertical: es el formato más representativo de un
 * retrato deportivo y el que Social Studio va a pedir. El cuadrado no se edita
 * aparte —se deriva del mismo encuadre—, así que nadie acomoda la misma foto
 * dos veces.
 */
export const PLAYER_PORTRAIT_EDITOR_FRAME = PLAYER_PORTRAIT_FRAMES
  .find((frame) => frame.key === 'portrait');

/** Los otros encuadres, que se previsualizan sin editarse. */
export const PLAYER_PORTRAIT_PREVIEW_FRAMES = Object.freeze(
  PLAYER_PORTRAIT_FRAMES.filter((frame) => frame.key !== PLAYER_PORTRAIT_EDITOR_FRAME.key),
);

/*
 * Encuadre = punto focal + zoom, y nada más.
 *
 * El punto focal es el punto de la foto que queda en el centro del marco, y el
 * zoom se mide contra el mínimo que cubre ese marco: `zoom = 1` no es «tamaño
 * original», es «lo más lejos que se puede ir sin dejar un hueco». La escala
 * visual de ese mínimo la decide la foto —una horizontal necesita agrandarse
 * más que una vertical para tapar un 4:5— y se calcula, no se hardcodea.
 *
 * Los dos números son fracciones, así que el mismo par reconstruye el encuadre
 * en cualquier tamaño de pantalla y en cualquier marco: el avatar cuadrado sale
 * del mismo dato que el 4:5. Nunca se persiste un píxel dependiente del
 * viewport, y la imagen original nunca se recorta.
 */

export const PLAYER_PORTRAIT_MIN_ZOOM = 1;

/**
 * 4× sobre el mínimo que cubre el marco. Es el techo práctico, no un límite
 * técnico: el original normalizado tiene hasta 3000 px de arista, así que a 4×
 * un 4:5 de 1080 px de ancho todavía se dibuja con ~750 px reales. Más zoom que
 * eso ya es interpolación visible, y para eso no hace falta ofrecerlo.
 */
export const PLAYER_PORTRAIT_MAX_ZOOM = 4;

/** El paso del deslizador y el de las flechas: fino, pero no imperceptible. */
export const PLAYER_PORTRAIT_ZOOM_STEP = 0.02;
export const PLAYER_PORTRAIT_PAN_STEP = 0.02;
export const PLAYER_PORTRAIT_PAN_STEP_COARSE = 0.1;

export const PLAYER_PORTRAIT_DEFAULT_CROP = Object.freeze({
  x: PLAYER_PORTRAIT_DEFAULT_FOCAL.x,
  y: PLAYER_PORTRAIT_DEFAULT_FOCAL.y,
  zoom: PLAYER_PORTRAIT_MIN_ZOOM,
});

const UNIT_SCALE = 10000;
const round4 = (value) => Math.round(value * UNIT_SCALE) / UNIT_SCALE;

/** Redondeo a 4 decimales en las tres componentes: lo que acepta la base. */
export function normalizeCrop(crop) {
  const { x, y } = normalizeFocalPoint(crop);
  const raw = Number(crop?.zoom);
  const zoom = Number.isFinite(raw)
    ? Math.min(PLAYER_PORTRAIT_MAX_ZOOM, Math.max(PLAYER_PORTRAIT_MIN_ZOOM, raw))
    : PLAYER_PORTRAIT_MIN_ZOOM;
  return Object.freeze({ x, y, zoom: round4(zoom) });
}

export function isDefaultCrop(crop) {
  const normalized = normalizeCrop(crop);
  return normalized.x === PLAYER_PORTRAIT_DEFAULT_CROP.x
    && normalized.y === PLAYER_PORTRAIT_DEFAULT_CROP.y
    && normalized.zoom === PLAYER_PORTRAIT_DEFAULT_CROP.zoom;
}

function naturalRatio(natural) {
  const width = Number(natural?.width);
  const height = Number(natural?.height);
  if (![width, height].every((value) => Number.isFinite(value) && value > 0)) return null;
  return width / height;
}

/**
 * Cuánto mide la imagen dentro del marco, en fracciones del marco. Siempre
 * ≥ 1 en los dos ejes: por construcción el marco queda cubierto, y por eso el
 * zoom mínimo no necesita conocer ningún offset del fixture de QA.
 */
export function cropExtent({ natural, frameRatio, zoom = PLAYER_PORTRAIT_MIN_ZOOM }) {
  const imageRatio = naturalRatio(natural);
  const frame = Number(frameRatio);
  if (!imageRatio || !Number.isFinite(frame) || frame <= 0) return null;
  const { zoom: scale } = normalizeCrop({ zoom });
  return {
    width: Math.max(1, imageRatio / frame) * scale,
    height: Math.max(1, frame / imageRatio) * scale,
  };
}

/**
 * Hasta dónde puede llegar el punto focal sin que asome un borde vacío. Los
 * límites se cierran hacia adentro al mismo redondeo que se persiste, así que
 * el valor guardado nunca deja un hueco de fracción de píxel al volver.
 */
function axisBounds(extent) {
  const low = Math.ceil((0.5 / extent) * UNIT_SCALE) / UNIT_SCALE;
  const high = Math.floor((1 - 0.5 / extent) * UNIT_SCALE) / UNIT_SCALE;
  if (!(high > low)) return { low: 0.5, high: 0.5, locked: true };
  return { low, high, locked: false };
}

export function cropFocalBounds({ natural, frameRatio, zoom }) {
  const extent = cropExtent({ natural, frameRatio, zoom });
  if (!extent) return null;
  return { x: axisBounds(extent.width), y: axisBounds(extent.height) };
}

/** El encuadre más cercano al pedido que todavía cubre el marco por completo. */
export function clampCrop(crop, { natural, frameRatio }) {
  const normalized = normalizeCrop(crop);
  const bounds = cropFocalBounds({ natural, frameRatio, zoom: normalized.zoom });
  if (!bounds) return normalized;
  return Object.freeze({
    x: Math.min(bounds.x.high, Math.max(bounds.x.low, normalized.x)),
    y: Math.min(bounds.y.high, Math.max(bounds.y.low, normalized.y)),
    zoom: normalized.zoom,
  });
}

/**
 * La imagen colocada dentro del marco, en fracciones: ancho, alto y esquina.
 * No hay ningún píxel medido acá —ni `getBoundingClientRect`, ni observer— así
 * que el mismo encuadre se dibuja idéntico en el editor grande y en el avatar
 * de 42 px, y volver a abrirlo después de recargar da exactamente lo mismo.
 */
export function cropPlacement({ natural, frameRatio, crop }) {
  const clamped = clampCrop(crop, { natural, frameRatio });
  const extent = cropExtent({ natural, frameRatio, zoom: clamped.zoom });
  if (!extent) return null;
  return {
    crop: clamped,
    width: extent.width,
    height: extent.height,
    left: 0.5 - clamped.x * extent.width,
    top: 0.5 - clamped.y * extent.height,
  };
}

const percent = (value) => `${round4(value * 100)}%`;

/**
 * Estilo del `<img>` para un marco `position: relative; overflow: hidden`.
 *
 * Sin las dimensiones naturales todavía no hay geometría posible, y en ese caso
 * el encuadre cae al `object-position` de siempre: el mismo punto focal, sin
 * zoom, que es exactamente lo que hacía 1C.2B. Nunca un marco vacío.
 */
export function cropImageStyle({ natural, frameRatio, crop }) {
  const placement = cropPlacement({ natural, frameRatio, crop });
  if (!placement) {
    return {
      width: '100%',
      height: '100%',
      objectPosition: focalObjectPosition(crop),
    };
  }
  return {
    position: 'absolute',
    width: percent(placement.width),
    height: percent(placement.height),
    left: percent(placement.left),
    top: percent(placement.top),
  };
}

/**
 * Arrastrar la foto. El gesto llega en fracciones del marco, no en píxeles: la
 * imagen se mueve con el dedo y el marco se queda quieto.
 */
export function panCrop(crop, { natural, frameRatio, dx = 0, dy = 0 }) {
  const normalized = normalizeCrop(crop);
  const extent = cropExtent({ natural, frameRatio, zoom: normalized.zoom });
  if (!extent) return normalized;
  const shift = (value, size) => (Number.isFinite(Number(value)) ? Number(value) / size : 0);
  return clampCrop({
    x: normalized.x - shift(dx, extent.width),
    y: normalized.y - shift(dy, extent.height),
    zoom: normalized.zoom,
  }, { natural, frameRatio });
}

/**
 * Zoom anclado: el punto de la foto que está debajo de `anchor` no se mueve.
 * Con el ancla en el centro es el deslizador; con el ancla en el punto medio de
 * dos dedos es el pellizco.
 */
export function zoomCrop(crop, { natural, frameRatio, zoom, anchor }) {
  const from = normalizeCrop(crop);
  const to = normalizeCrop({ ...from, zoom });
  const before = cropExtent({ natural, frameRatio, zoom: from.zoom });
  const after = cropExtent({ natural, frameRatio, zoom: to.zoom });
  if (!before || !after) return to;
  const axis = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0.5);
  const anchorX = axis(anchor?.x) - 0.5;
  const anchorY = axis(anchor?.y) - 0.5;
  return clampCrop({
    x: from.x + anchorX / before.width - anchorX / after.width,
    y: from.y + anchorY / before.height - anchorY / after.height,
    zoom: to.zoom,
  }, { natural, frameRatio });
}

/** `Francisco González` → `FG`. Nunca un ícono roto ni un cuadro vacío. */
export function playerMonogram(name) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return parts
    .slice(0, 2)
    .map((part) => Array.from(part)[0])
    .join('')
    .toUpperCase();
}
