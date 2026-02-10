// normalizePartidoForHeader.js
// Normalize incoming "partido" objects (DB rows or view-models) into a canonical header shape

function firstPresent(obj, keys) {
  if (!obj || !Array.isArray(keys)) return null;
  for (const k of keys) {
    if (!k) continue;
    const v = obj[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return null;
}

function normalizeYmdDate(value) {
  if (value === undefined || value === null) return null;
  const str = String(value).trim();
  if (!str) return null;
  // Keep only YYYY-MM-DD part when receiving full ISO timestamps.
  const isoDate = str.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoDate) return isoDate[1];
  return str;
}

export default function normalizePartidoForHeader(raw) {
  // If raw is falsy, return a canonical empty object (avoid returning null)
  if (!raw || typeof raw !== 'object') {
    return {
      nombre: null,
      fecha: null,
      hora: null,
      sede: null,
      modalidad: null,
      tipo_partido: null,
      precio: null,
      valor_cancha: null,
    };
  }

  // Prefer nested raw.PARTIDO when present
  const base = (raw.PARTIDO && typeof raw.PARTIDO === 'object') ? raw.PARTIDO : raw;

  // Candidate keys for simple fields
  const nameKeys = ['nombre', 'NOMBRE', 'name', 'NAME'];
  const fechaKeys = ['fecha', 'FECHA'];
  const horaKeys = ['hora', 'HORA'];
  const sedeKeys = ['sede', 'SEDE', 'lugar', 'LUGAR'];
  const modalidadKeys = ['modalidad', 'MODALIDAD', 'modalidadPartido', 'MODALIDAD_PARTIDO'];
  const tipoKeys = ['tipo_partido', 'TIPO_PARTIDO', 'tipo', 'TIPO'];

  const priceKeys = [
    'precio','PRECIO',
    'valor_cancha','VALOR_CANCHA',
    'precio_cancha','PRECIO_CANCHA',
    'precio_cancha_por_persona','PRECIO_CANCHA_POR_PERSONA',
    'monto','MONTO',
    'costo','COSTO','cost','COST',
    'valor','VALOR',
    'price','PRICE',
    'cancha_valor','CANCHA_VALOR',
  ];

  const nombre = firstPresent(base, nameKeys) || null;
  const fecha = normalizeYmdDate(firstPresent(base, fechaKeys)) || null;
  const hora = firstPresent(base, horaKeys) || null;
  const sede = firstPresent(base, sedeKeys) || null;
  const modalidad = firstPresent(base, modalidadKeys) || null;
  const tipo_partido = firstPresent(base, tipoKeys) || null;

  const precioRaw = firstPresent(base, priceKeys);

  // Build canonical object (do not mutate original)
  const canonical = {
    nombre: nombre || null,
    fecha: fecha || null,
    hora: hora || null,
    sede: sede || null,
    modalidad: modalidad || null,
    tipo_partido: tipo_partido || null,
    precio: precioRaw !== undefined && precioRaw !== null && String(precioRaw).trim() !== '' ? precioRaw : null,
    valor_cancha: precioRaw !== undefined && precioRaw !== null && String(precioRaw).trim() !== '' ? precioRaw : null,
  };

  if (base.id !== undefined) canonical.id = base.id;

  return canonical;
}
