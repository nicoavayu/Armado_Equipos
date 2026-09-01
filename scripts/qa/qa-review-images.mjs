//
// Imágenes QA determinísticas, generadas en memoria.
//
// El dataset de revisión necesita objetos REALES en Storage (escudos, retratos,
// fotos de galería). Traerlos de afuera —o de un archivo temporal que nadie
// versiona— rompe dos requisitos a la vez: reproducibilidad y ausencia de
// dependencias externas. Acá los bytes se derivan de una etiqueta por SHA-256,
// así que la misma etiqueta produce siempre el mismo archivo, con el mismo
// checksum, en cualquier máquina.
//
// El codificador es PNG mínimo (RGB de 8 bits, sin filtros): no hay
// dependencias nuevas y el resultado es un PNG válido que Storage y el pipeline
// aceptan sin tratamiento especial.

import crypto from 'node:crypto';
import zlib from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, pixelAt) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filtro "None": determinístico y sin estado previo.
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = pixelAt(x, y);
      const offset = rowStart + 1 + x * 3;
      raw[offset] = r & 0xff;
      raw[offset + 1] = g & 0xff;
      raw[offset + 2] = b & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // profundidad de bits
  ihdr[9] = 2; // truecolor RGB
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    // El nivel se fija para que el byte a byte no dependa del default de zlib.
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function paletteFor(label) {
  const digest = crypto.createHash('sha256').update(label).digest();
  const base = [digest[0], digest[1], digest[2]];
  const accent = [digest[3], digest[4], digest[5]];
  // Un fondo demasiado claro y una figura demasiado oscura se ven igual de mal
  // en las dos superficies, así que se separan por luminancia a propósito.
  const dark = base.map((value) => Math.round(value * 0.45));
  const light = accent.map((value) => 140 + Math.round((value / 255) * 115));
  return { dark, light };
}

/** Escudo cuadrado: banda diagonal sobre fondo sólido. */
export function teamCrestPng(label, size = 256) {
  const { dark, light } = paletteFor(`crest:${label}`);
  return encodePng(size, size, (x, y) => {
    const band = ((x + y) % Math.max(24, Math.round(size / 6))) < Math.round(size / 12);
    const border = x < 6 || y < 6 || x >= size - 6 || y >= size - 6;
    if (border) return light;
    return band ? light : dark;
  });
}

/** Retrato 4:5, con una figura centrada para que el encuadre se note. */
export function playerPortraitPng(label, width = 800, height = 1000) {
  const { dark, light } = paletteFor(`portrait:${label}`);
  const cx = width / 2;
  const cy = height * 0.38;
  const radius = width * 0.26;
  return encodePng(width, height, (x, y) => {
    const dx = x - cx;
    const dy = y - cy;
    if (dx * dx + dy * dy <= radius * radius) return light;
    // Hombros: una elipse ancha que arranca por debajo de la cabeza.
    const sx = (x - cx) / (width * 0.42);
    const sy = (y - height * 0.98) / (height * 0.42);
    if (sx * sx + sy * sy <= 1) return light;
    return dark;
  });
}

/** Foto de galería apaisada; se mantiene chica para el tier MVP_SIMPLE. */
export function galleryPhotoPng(label, width = 640, height = 480) {
  const { dark, light } = paletteFor(`gallery:${label}`);
  const digest = crypto.createHash('sha256').update(`gallery:${label}`).digest();
  const stripes = 4 + (digest[6] % 5);
  const bandHeight = height / stripes;
  return encodePng(width, height, (x, y) => {
    const band = Math.floor(y / bandHeight);
    const wave = Math.round((Math.sin((x / width) * Math.PI * (2 + (digest[7] % 3))) + 1) * 40);
    const base = band % 2 === 0 ? dark : light;
    return [base[0] + wave, base[1] + wave, base[2] + wave].map((v) => Math.min(255, v));
  });
}

export function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}
