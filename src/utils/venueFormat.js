const normalizeSpaces = (value = '') => String(value || '').replace(/\s+/g, ' ').trim();

const stripNoise = (value = '') => normalizeSpaces(
  String(value || '')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\b[A-Z0-9]{4,8}\+[A-Z0-9]{2,}\b/gi, ' ')
    .replace(/-?\d{1,2}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}/g, ' ')
    .replace(/[\p{Extended_Pictographic}\u2600-\u27BF]/gu, ' '),
);

const normalizeToken = (value = '') => stripNoise(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase();

const LOCATION_TOKENS = [
  'argentina',
  'buenos aires',
  'capital federal',
  'caba',
  'ciudad autonoma de buenos aires',
  'provincia de',
  'provincia',
  'bs as',
  'bs. as',
  'republica argentina',
];

const ADDRESS_HINT_RE = /\b(av\.?|avenida|calle|ruta|km|n[°ºo]?|esquina|altura|cp|codigo postal|piso|dpto|departamento|diag\.?|boulevard|blvd\.?)\b/i;
const POSTAL_CODE_RE = /\b([A-Z]\d{4}[A-Z]{0,3}|\d{4,5})\b/i;
const PURE_POSTAL_CODE_RE = /^([A-Z]\d{4}[A-Z]{0,3}|\d{4,5})$/i;
const COORDS_RE = /-?\d{1,2}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}/;

const looksLikeLocationToken = (value = '') => {
  const normalized = normalizeToken(value);
  if (!normalized) return false;
  if (PURE_POSTAL_CODE_RE.test(normalized)) return true;
  return LOCATION_TOKENS.some((token) => normalized === token || normalized.includes(token));
};

const looksLikeAddress = (value = '') => {
  const cleaned = stripNoise(value);
  if (!cleaned) return false;
  if (COORDS_RE.test(cleaned)) return true;
  if (/\b\d{2,}\b/.test(cleaned)) return true;
  return ADDRESS_HINT_RE.test(cleaned);
};

const stripMetadataParens = (value = '') => value.replace(/\(([^)]*)\)/g, (full, inner) => {
  const token = String(inner || '').trim();
  if (!token) return ' ';
  const normalized = normalizeToken(token);
  if (!normalized) return ' ';
  if (/^[a-z]{2,3}$/i.test(normalized)) return ' ';
  if (POSTAL_CODE_RE.test(normalized)) return ' ';
  if (COORDS_RE.test(normalized)) return ' ';
  if (looksLikeLocationToken(normalized)) return ' ';
  return full;
});

const cleanupCandidate = (value = '') => {
  const stripped = stripMetadataParens(stripNoise(value));
  return normalizeSpaces(
    stripped
      .replace(/\s[-–—]\s*$/g, ' ')
      .replace(/^[,;.\-–—\s]+|[,;.\-–—\s]+$/g, ' '),
  );
};

const truncateByWord = (value = '', maxLen = 32) => {
  if (!value || value.length <= maxLen) return value;
  const slice = value.slice(0, maxLen - 1);
  const lastSpace = slice.lastIndexOf(' ');
  const safeCut = lastSpace >= Math.floor(maxLen * 0.6) ? slice.slice(0, lastSpace) : slice;
  return `${safeCut.trimEnd()}…`;
};

const pickFromCommaSeparated = (rawValue = '') => {
  const segments = String(rawValue || '')
    .split(',')
    .map((segment) => cleanupCandidate(segment))
    .filter(Boolean);
  if (!segments.length) return '';

  let primary = segments[0];
  const dashed = primary.split(/\s[-–—]\s+/).map((segment) => cleanupCandidate(segment)).filter(Boolean);
  if (dashed.length > 1 && !looksLikeAddress(dashed[0])) {
    primary = dashed[0];
  }

  if (primary && !looksLikeLocationToken(primary)) return primary;
  return segments.find((segment) => !looksLikeLocationToken(segment)) || primary;
};

const collectCandidates = (venue) => {
  if (!venue) return [];
  if (typeof venue === 'string') return [venue];
  if (Array.isArray(venue)) return venue;
  if (typeof venue !== 'object') return [String(venue)];

  const primary = [
    venue?.name,
    venue?.displayName,
    venue?.venue_name,
    venue?.place_name,
    venue?.title,
    venue?.venueName,
    venue?.formattedAddress,
    venue?.address,
    venue?.sede,
  ];

  const nestedVenue = venue?.venue && typeof venue.venue === 'object'
    ? collectCandidates(venue.venue)
    : [];

  return [...primary, ...nestedVenue];
};

export const formatVenueShort = (venue, options = {}) => {
  const maxLen = Number.isFinite(Number(options?.maxLen)) ? Number(options.maxLen) : 32;
  const candidates = collectCandidates(venue)
    .map((value) => cleanupCandidate(value))
    .filter(Boolean);

  for (const candidate of candidates) {
    const picked = pickFromCommaSeparated(candidate);
    if (!picked) continue;
    if (looksLikeLocationToken(picked)) continue;
    return truncateByWord(picked, maxLen);
  }

  return null;
};

export default formatVenueShort;
