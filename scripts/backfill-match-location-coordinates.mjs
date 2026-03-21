import fs from 'node:fs';
import process from 'node:process';
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const SHOW_HELP = process.argv.includes('--help') || process.argv.includes('-h');
const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_READ_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.REACT_APP_SUPABASE_SERVICE_ROLE_KEY
  || process.env.REACT_APP_SUPABASE_ANON_KEY;
const SUPABASE_WRITE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.REACT_APP_SUPABASE_SERVICE_ROLE_KEY;
const GOOGLE_MAPS_API_KEY = process.env.REACT_APP_GOOGLE_MAPS_API_KEY || '';
const APPLY = process.argv.includes('--apply');
const EMIT_SQL = process.argv.includes('--emit-sql');
const INCLUDE_TEMPLATES = process.argv.includes('--include-templates');
const PROVIDER = (
  process.argv.find((arg) => arg.startsWith('--provider='))?.split('=')[1]
  || 'auto'
).toLowerCase();
const OUTPUT_SQL_FILE = (
  process.argv.find((arg) => arg.startsWith('--sql-file='))?.split('=')[1]
  || '/tmp/arma2_match_location_backfill.sql'
);
const ARGENTINA_BOUNDS = {
  minLat: -55.5,
  maxLat: -21,
  minLng: -73.8,
  maxLng: -53,
};
const VALID_PROVIDERS = new Set(['auto', 'google', 'nominatim']);

const usageText = `
Usage:
  node scripts/backfill-match-location-coordinates.mjs [flags]

What it does:
  - Reads partidos without persisted sede_latitud/sede_longitud
  - Tries to resolve coordinates from place_id or normalized address
  - Validates that results look Argentine before accepting them
  - Can preview results, emit SQL, or patch rows directly

Flags:
  --help, -h             Show this help
  --provider=auto        auto|google|nominatim
  --emit-sql             Write SQL updates instead of patching the DB
  --sql-file=/tmp/x.sql  Output path used with --emit-sql
  --apply                PATCH rows directly via Supabase REST
  --include-templates    Also process partidos_frecuentes

Provider behavior:
  auto       Try Google first. If unavailable or denied, fall back to Nominatim.
  google     Use only Google Geocoding (requires REACT_APP_GOOGLE_MAPS_API_KEY).
  nominatim  Use only OpenStreetMap Nominatim with 1 request/second pacing.

Safety notes:
  - Default mode is dry-run preview. It does not modify the DB.
  - --apply requires SUPABASE_SERVICE_ROLE_KEY.
  - --emit-sql is the safest review path for historical backfills.
  - Nominatim may resolve a road or city center when the venue is ambiguous; review emitted SQL before applying.
`.trim();

if (SHOW_HELP) {
  console.log(usageText);
  process.exit(0);
}

if (!SUPABASE_URL) {
  throw new Error('Missing REACT_APP_SUPABASE_URL');
}

if (!SUPABASE_READ_KEY) {
  throw new Error('Missing Supabase read key (service role or anon key)');
}

if (APPLY && !SUPABASE_WRITE_KEY) {
  throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY for --apply mode');
}

if (!VALID_PROVIDERS.has(PROVIDER)) {
  throw new Error(`Invalid --provider value "${PROVIDER}". Expected one of: ${Array.from(VALID_PROVIDERS).join(', ')}`);
}

const readHeaders = {
  apikey: SUPABASE_READ_KEY,
  Authorization: `Bearer ${SUPABASE_READ_KEY}`,
};

const writeHeaders = SUPABASE_WRITE_KEY
  ? {
    apikey: SUPABASE_WRITE_KEY,
    Authorization: `Bearer ${SUPABASE_WRITE_KEY}`,
  }
  : null;

const selectColumns = [
  'id',
  'sede',
  'sede_place_id',
  'sede_latitud',
  'sede_longitud',
  'sede_direccion_normalizada',
  'sedeMaps',
].join(',');

const sleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const parseMapsData = (value) => {
  if (!value) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch (_error) {
    return null;
  }
};

const toCoordinate = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const parsed = Number(value.trim().replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();

const hasValidCoordinates = (lat, lng) => (
  Number.isFinite(lat)
  && Number.isFinite(lng)
  && lat >= -90
  && lat <= 90
  && lng >= -180
  && lng <= 180
  && !(Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001)
);

const isLikelyArgentineCoordinate = (lat, lng) => (
  hasValidCoordinates(lat, lng)
  && lat >= ARGENTINA_BOUNDS.minLat
  && lat <= ARGENTINA_BOUNDS.maxLat
  && lng >= ARGENTINA_BOUNDS.minLng
  && lng <= ARGENTINA_BOUNDS.maxLng
);

const isArgentineResult = ({ lat, lng, displayName }) => (
  /argentina/i.test(String(displayName || ''))
  || isLikelyArgentineCoordinate(lat, lng)
);

const sqlString = (value) => {
  if (value == null) return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
};

const buildSqlPatch = (tableName, id, payload) => (
  `UPDATE public.${tableName} `
  + `SET sede_place_id = ${sqlString(payload.sede_place_id)}, `
  + `sede_direccion_normalizada = ${sqlString(payload.sede_direccion_normalizada)}, `
  + `sede_latitud = ${payload.sede_latitud}, `
  + `sede_longitud = ${payload.sede_longitud} `
  + `WHERE id = ${sqlString(id)} `
  + `AND (sede_latitud IS NULL OR sede_longitud IS NULL);`
);

const fetchRows = async (tableName) => {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${tableName}`);
  url.searchParams.set('select', selectColumns);
  url.searchParams.set('or', '(sede_latitud.is.null,sede_longitud.is.null)');
  url.searchParams.set('limit', '1000');

  const response = await fetch(url, { headers: readHeaders });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${tableName}: ${response.status} ${await response.text()}`);
  }
  return response.json();
};

const buildBaseQueryData = (row) => {
  const mapsData = parseMapsData(row?.sedeMaps || null);
  const placeId = normalizeText(
    row?.sede_place_id
    || mapsData?.place_id
    || mapsData?.placeId
    || '',
  );
  const address = normalizeText(row?.sede_direccion_normalizada || row?.sede || '');
  return {
    placeId: placeId || null,
    address: address || null,
  };
};

const invalidAddressLabels = new Set([
  'a coordinar',
  'direccion a coordinar',
  'dirección a coordinar',
  'sin definir',
]);

const getNominatimQuery = (row) => {
  const { address } = buildBaseQueryData(row);
  if (!address) return null;
  if (invalidAddressLabels.has(address.toLowerCase())) return null;
  return address;
};

const geocodeWithGoogle = async (row) => {
  if (!GOOGLE_MAPS_API_KEY) {
    return { payload: null, reason: 'google_key_missing' };
  }

  const { placeId, address } = buildBaseQueryData(row);
  if (!placeId && !address) {
    return { payload: null, reason: 'google_missing_query' };
  }

  const requestUrl = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  if (placeId) {
    requestUrl.searchParams.set('place_id', placeId);
  } else {
    requestUrl.searchParams.set('address', address);
  }
  requestUrl.searchParams.set('key', GOOGLE_MAPS_API_KEY);

  const response = await fetch(requestUrl);
  if (!response.ok) {
    return { payload: null, reason: `google_http_${response.status}` };
  }

  const payload = await response.json();
  if (payload?.status === 'REQUEST_DENIED') {
    return { payload: null, reason: 'google_request_denied' };
  }

  const firstResult = Array.isArray(payload?.results) ? payload.results[0] : null;
  const lat = toCoordinate(firstResult?.geometry?.location?.lat);
  const lng = toCoordinate(firstResult?.geometry?.location?.lng);
  const displayName = firstResult?.formatted_address || address || null;

  if (!hasValidCoordinates(lat, lng)) {
    return { payload: null, reason: `google_${payload?.status || 'no_coords'}` };
  }

  if (!isArgentineResult({ lat, lng, displayName })) {
    return { payload: null, reason: 'google_non_argentina' };
  }

  return {
    payload: {
      sede_place_id: placeId || firstResult?.place_id || null,
      sede_direccion_normalizada: address || displayName,
      sede_latitud: lat,
      sede_longitud: lng,
    },
    reason: 'google',
  };
};

let lastNominatimRequestAt = 0;

const geocodeWithNominatim = async (row) => {
  const query = getNominatimQuery(row);
  if (!query) {
    return { payload: null, reason: 'nominatim_missing_query' };
  }

  const now = Date.now();
  const elapsed = now - lastNominatimRequestAt;
  if (elapsed < 1100) {
    await sleep(1100 - elapsed);
  }

  const requestUrl = new URL('https://nominatim.openstreetmap.org/search');
  requestUrl.searchParams.set('q', query);
  requestUrl.searchParams.set('format', 'jsonv2');
  requestUrl.searchParams.set('limit', '1');

  lastNominatimRequestAt = Date.now();
  const response = await fetch(requestUrl, {
    headers: {
      'User-Agent': 'ARMA2/1.0 (quiero-jugar backfill)',
    },
  });
  if (!response.ok) {
    return { payload: null, reason: `nominatim_http_${response.status}` };
  }

  const results = await response.json();
  const firstResult = Array.isArray(results) ? results[0] : null;
  const lat = toCoordinate(firstResult?.lat);
  const lng = toCoordinate(firstResult?.lon);
  const displayName = firstResult?.display_name || query;

  if (!hasValidCoordinates(lat, lng)) {
    return { payload: null, reason: 'nominatim_no_coords' };
  }

  if (!isArgentineResult({ lat, lng, displayName })) {
    return { payload: null, reason: 'nominatim_non_argentina' };
  }

  return {
    payload: {
      sede_place_id: buildBaseQueryData(row).placeId,
      sede_direccion_normalizada: buildBaseQueryData(row).address,
      sede_latitud: lat,
      sede_longitud: lng,
    },
    reason: 'nominatim',
  };
};

const geocodeRow = async (row) => {
  if (PROVIDER === 'google') {
    return geocodeWithGoogle(row);
  }

  if (PROVIDER === 'nominatim') {
    return geocodeWithNominatim(row);
  }

  const googleResult = await geocodeWithGoogle(row);
  if (googleResult.payload) return googleResult;

  const nominatimResult = await geocodeWithNominatim(row);
  if (nominatimResult.payload) return nominatimResult;

  return {
    payload: null,
    reason: `${googleResult.reason}->${nominatimResult.reason}`,
  };
};

const patchRow = async (tableName, id, payload) => {
  if (!writeHeaders) {
    throw new Error('patchRow requires service role credentials');
  }

  const url = `${SUPABASE_URL}/rest/v1/${tableName}?id=eq.${encodeURIComponent(id)}`;
  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      ...writeHeaders,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Failed to patch ${tableName}#${id}: ${response.status} ${await response.text()}`);
  }

  return response.json();
};

const runBackfill = async (tableName) => {
  const rows = await fetchRows(tableName);
  const summary = {
    tableName,
    totalCandidates: rows.length,
    resolved: 0,
    skipped: 0,
    patched: 0,
    reasons: {},
  };
  const sqlLines = [];

  for (const row of rows) {
    const lat = toCoordinate(row?.sede_latitud);
    const lng = toCoordinate(row?.sede_longitud);
    if (hasValidCoordinates(lat, lng)) {
      summary.skipped += 1;
      summary.reasons.already_has_coordinates = (summary.reasons.already_has_coordinates || 0) + 1;
      continue;
    }

    const resolved = await geocodeRow(row);
    if (!resolved.payload) {
      summary.skipped += 1;
      summary.reasons[resolved.reason || 'unresolved'] = (summary.reasons[resolved.reason || 'unresolved'] || 0) + 1;
      continue;
    }

    summary.resolved += 1;
    summary.reasons[resolved.reason] = (summary.reasons[resolved.reason] || 0) + 1;

    if (APPLY) {
      await patchRow(tableName, row.id, resolved.payload);
      summary.patched += 1;
    }

    if (EMIT_SQL) {
      sqlLines.push(buildSqlPatch(tableName, row.id, resolved.payload));
    }

    if (!APPLY && !EMIT_SQL) {
      console.log(JSON.stringify({
        tableName,
        id: row.id,
        payload: resolved.payload,
        provider: resolved.reason,
      }, null, 2));
    }
  }

  return {
    summary,
    sqlLines,
  };
};

const main = async () => {
  if (APPLY) {
    console.warn('[backfill-match-location-coordinates] Running in APPLY mode. Rows will be patched directly in Supabase.');
  } else if (EMIT_SQL) {
    console.warn('[backfill-match-location-coordinates] Running in EMIT_SQL mode. Review the generated SQL before executing it.');
  } else {
    console.warn('[backfill-match-location-coordinates] Running in DRY_RUN mode. No database rows will be modified.');
  }

  const tables = ['partidos'];
  if (INCLUDE_TEMPLATES) {
    tables.push('partidos_frecuentes');
  }

  const summaries = [];
  const sqlLines = ['BEGIN;'];

  for (const tableName of tables) {
    const result = await runBackfill(tableName);
    summaries.push(result.summary);
    sqlLines.push(...result.sqlLines);
  }

  sqlLines.push('COMMIT;');

  if (EMIT_SQL) {
    fs.writeFileSync(OUTPUT_SQL_FILE, `${sqlLines.join('\n')}\n`);
  }

  console.log(JSON.stringify({
    mode: APPLY ? 'apply' : (EMIT_SQL ? 'emit_sql' : 'dry_run'),
    apply: APPLY,
    emitSql: EMIT_SQL,
    provider: PROVIDER,
    includeTemplates: INCLUDE_TEMPLATES,
    outputSqlFile: EMIT_SQL ? OUTPUT_SQL_FILE : null,
    summaries,
  }, null, 2));
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
