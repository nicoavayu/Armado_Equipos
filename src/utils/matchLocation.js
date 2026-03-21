const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();

export const toCoordinateNumber = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const normalized = value.trim().replace(',', '.');
    if (!normalized) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

export const hasValidCoordinates = (lat, lng) => {
  const parsedLat = toCoordinateNumber(lat);
  const parsedLng = toCoordinateNumber(lng);

  if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLng)) return false;
  if (parsedLat < -90 || parsedLat > 90 || parsedLng < -180 || parsedLng > 180) return false;
  if (Math.abs(parsedLat) < 0.0001 && Math.abs(parsedLng) < 0.0001) return false;
  return true;
};

export const normalizePlaceId = (value) => {
  const normalized = normalizeText(value);
  return normalized || null;
};

const parseMapsData = (value) => {
  if (!value) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_error) {
    return null;
  }
};

export const extractPersistedLocation = (row = null) => {
  const mapsData = parseMapsData(row?.sedeMaps || row?.sede_maps || row?.sedeMapsJson || null);
  const placeId = normalizePlaceId(
    row?.sede_place_id
    || row?.place_id
    || mapsData?.place_id
    || mapsData?.placeId
    || null,
  );

  const directPairs = [
    [row?.sede_latitud, row?.sede_longitud],
    [row?.latitud, row?.longitud],
    [row?.latitude, row?.longitude],
    [mapsData?.lat, mapsData?.lng],
    [mapsData?.latitude, mapsData?.longitude],
    [mapsData?.geometry?.location?.lat, mapsData?.geometry?.location?.lng],
  ];

  let lat = null;
  let lng = null;
  for (const [rawLat, rawLng] of directPairs) {
    const nextLat = toCoordinateNumber(rawLat);
    const nextLng = toCoordinateNumber(rawLng);
    if (hasValidCoordinates(nextLat, nextLng)) {
      lat = nextLat;
      lng = nextLng;
      break;
    }
  }

  return {
    description: normalizeText(row?.sede_direccion_normalizada || row?.sede || ''),
    placeId,
    lat,
    lng,
  };
};

const buildMapsPayload = (placeId) => ({ place_id: placeId || '' });

export const buildPersistedLocationPayload = ({
  locationText,
  locationInfo = null,
  existingLocation = null,
}) => {
  const description = normalizeText(locationText);
  const selectedPlaceId = normalizePlaceId(locationInfo?.place_id || locationInfo?.placeId || null);
  const selectedLat = toCoordinateNumber(locationInfo?.lat ?? locationInfo?.latitude);
  const selectedLng = toCoordinateNumber(locationInfo?.lng ?? locationInfo?.longitude);

  const previous = extractPersistedLocation(existingLocation);
  const canReusePrevious = (
    description
    && previous.description
    && description === previous.description
    && !selectedPlaceId
    && !hasValidCoordinates(selectedLat, selectedLng)
  );

  const placeId = selectedPlaceId || (canReusePrevious ? previous.placeId : null);
  const hasSelectedCoordinates = hasValidCoordinates(selectedLat, selectedLng);
  const lat = hasSelectedCoordinates ? selectedLat : (canReusePrevious ? previous.lat : null);
  const lng = hasSelectedCoordinates ? selectedLng : (canReusePrevious ? previous.lng : null);

  return {
    description,
    placeId,
    lat: hasValidCoordinates(lat, lng) ? lat : null,
    lng: hasValidCoordinates(lat, lng) ? lng : null,
    mapsData: buildMapsPayload(placeId),
  };
};

export const buildMatchLocationFields = (params) => {
  const payload = buildPersistedLocationPayload(params);

  return {
    sede: payload.description,
    sedeMaps: payload.mapsData,
    sede_place_id: payload.placeId,
    sede_direccion_normalizada: payload.description || null,
    sede_latitud: payload.lat,
    sede_longitud: payload.lng,
  };
};

export const buildFrequentMatchLocationFields = (params) => {
  const payload = buildPersistedLocationPayload(params);

  return {
    sede: payload.description,
    sede_place_id: payload.placeId,
    sede_direccion_normalizada: payload.description || null,
    sede_latitud: payload.lat,
    sede_longitud: payload.lng,
  };
};
