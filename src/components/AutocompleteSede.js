// src/AutocompleteSede.js
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import usePlacesAutocomplete, { getGeocode, getLatLng } from 'use-places-autocomplete';
import { useAuth } from './AuthProvider';
import { supabase } from '../supabase';
import { distanceInMeters } from '../services/locationService';
import { hasValidCoordinates, toCoordinateNumber } from '../utils/matchLocation';

const MIN_AUTOCOMPLETE_CHARS = 1;
const SUGGESTION_METADATA_LIMIT = 8;
const AREA_COMPONENT_PRIORITY = [
  'neighborhood',
  'sublocality_level_1',
  'sublocality',
  'administrative_area_level_3',
  'locality',
  'administrative_area_level_2',
  'administrative_area_level_1',
];

const isPlacesApiReady = () => (
  typeof window !== 'undefined'
  && Boolean(window.google?.maps?.places?.AutocompleteService)
);

const sanitizeAreaText = (value) => String(value || '')
  .replace(/\bargentina\b/gi, '')
  .replace(/\s{2,}/g, ' ')
  .replace(/(^[\s,.-]+|[\s,.-]+$)/g, '')
  .trim();

const extractFallbackSecondaryText = (suggestion) => {
  const directSecondary = sanitizeAreaText(suggestion?.structured_formatting?.secondary_text || '');
  if (directSecondary) return directSecondary;

  const mainText = String(suggestion?.structured_formatting?.main_text || '').trim();
  const description = String(suggestion?.description || '').trim();
  if (!description) return '';

  if (mainText && description.toLowerCase().startsWith(mainText.toLowerCase())) {
    return sanitizeAreaText(description.slice(mainText.length).replace(/^,\s*/, ''));
  }

  return sanitizeAreaText(description);
};

const extractAreaLabelFromResults = (results, suggestion) => {
  const safeResults = Array.isArray(results) ? results : [];

  for (const result of safeResults) {
    const components = Array.isArray(result?.address_components) ? result.address_components : [];
    for (const type of AREA_COMPONENT_PRIORITY) {
      const component = components.find((item) => Array.isArray(item?.types) && item.types.includes(type));
      const label = sanitizeAreaText(component?.long_name || component?.short_name || '');
      if (label) return label;
    }
  }

  return extractFallbackSecondaryText(suggestion);
};

const formatDistanceLabel = (fromLocation, toLocation) => {
  if (!hasValidCoordinates(fromLocation?.lat, fromLocation?.lng)) return null;
  if (!hasValidCoordinates(toLocation?.lat, toLocation?.lng)) return null;

  const distanceM = distanceInMeters(
    fromLocation.lat,
    fromLocation.lng,
    toLocation.lat,
    toLocation.lng,
  );

  if (!Number.isFinite(distanceM)) return null;

  const distanceKm = distanceM / 1000;
  if (distanceKm >= 10) return `${Math.round(distanceKm)} km`;

  const rounded = Math.round(distanceKm * 10) / 10;
  return `${String(rounded.toFixed(1)).replace('.0', '')} km`;
};

export default function AutocompleteSede({
  value,
  onSelect,
  onChange,
  dense = false,
  rectangular = false,
}) {
  const { user } = useAuth();
  const placesServiceRef = useRef(null);
  const suggestionMetadataCacheRef = useRef(new Map());
  const [serviceSuggestions, setServiceSuggestions] = useState([]);
  const [hasUserEdited, setHasUserEdited] = useState(false);
  const [referenceLocation, setReferenceLocation] = useState(null);
  const [suggestionMetadata, setSuggestionMetadata] = useState({});

  const {
    ready,
    value: inputValue,
    setValue,
    suggestions: { status, data },
    clearSuggestions,
  } = usePlacesAutocomplete({
    debounce: 300,
    defaultValue: value || '',
    requestOptions: {
      componentRestrictions: { country: 'ar' },
    },
  });

  const initPlacesService = useCallback(() => {
    if (!isPlacesApiReady()) return false;
    if (placesServiceRef.current) return true;

    try {
      placesServiceRef.current = new window.google.maps.places.AutocompleteService();
      return true;
    } catch {
      return false;
    }
  }, []);

  const runPlacesProbe = useCallback((rawQuery) => {
    const query = String(rawQuery || '').trim();
    if (query.length < MIN_AUTOCOMPLETE_CHARS) {
      setServiceSuggestions([]);
      return;
    }

    if (!initPlacesService() || !placesServiceRef.current) {
      setServiceSuggestions([]);
      return;
    }

    const runRequest = (requestOptions, stage = 'primary') => {
      placesServiceRef.current.getPlacePredictions(
        requestOptions,
        (predictions, serviceStatus) => {
          const normalizedStatus = String(serviceStatus || 'UNKNOWN');
          const safePredictions = Array.isArray(predictions) ? predictions : [];

          if (stage === 'primary' && normalizedStatus === 'ZERO_RESULTS') {
            runRequest({ input: query }, 'relaxed');
            return;
          }

          setServiceSuggestions(safePredictions);
        },
      );
    };

    runRequest(
      {
        input: query,
        componentRestrictions: { country: 'ar' },
      },
      'primary',
    );
  }, [initPlacesService]);

  useEffect(() => {
    const externalValue = String(value || '');
    const internalValue = String(inputValue || '');
    if (externalValue !== internalValue) {
      setValue(externalValue, false);
    }
  }, [inputValue, setValue, value]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    initPlacesService();
    const intervalId = window.setInterval(() => {
      if (!placesServiceRef.current) {
        initPlacesService();
      }
    }, 1500);
    return () => window.clearInterval(intervalId);
  }, [initPlacesService]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    if (!hasUserEdited) {
      clearSuggestions();
      setServiceSuggestions([]);
      return undefined;
    }
    const timeoutId = window.setTimeout(() => {
      runPlacesProbe(inputValue);
    }, 260);
    return () => window.clearTimeout(timeoutId);
  }, [clearSuggestions, hasUserEdited, inputValue, runPlacesProbe]);

  const hookSuggestions = useMemo(
    () => (status === 'OK'
      ? data.filter((s) => String(s?.description || '').trim().length > 0)
      : []),
    [data, status],
  );

  const suggestions = useMemo(
    () => (hookSuggestions.length > 0
      ? hookSuggestions
      : serviceSuggestions.filter((s) => String(s?.description || '').trim().length > 0)),
    [hookSuggestions, serviceSuggestions],
  );

  useEffect(() => {
    let cancelled = false;

    const loadReferenceLocation = async () => {
      if (!user?.id) {
        if (!cancelled) setReferenceLocation(null);
        return;
      }

      try {
        const { data, error } = await supabase
          .from('usuarios')
          .select('latitud, longitud')
          .eq('id', user.id)
          .single();

        if (cancelled) return;
        if (error) throw error;

        if (hasValidCoordinates(data?.latitud, data?.longitud)) {
          setReferenceLocation({
            lat: toCoordinateNumber(data.latitud),
            lng: toCoordinateNumber(data.longitud),
          });
          return;
        }
      } catch {
      }

      if (!cancelled) {
        setReferenceLocation(null);
      }
    };

    loadReferenceLocation();

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  useEffect(() => {
    let cancelled = false;

    const targetSuggestions = suggestions
      .slice(0, SUGGESTION_METADATA_LIMIT)
      .filter((item) => item?.place_id && !suggestionMetadataCacheRef.current.has(item.place_id));

    if (targetSuggestions.length === 0) return undefined;

    const hydrateSuggestionMetadata = async () => {
      const nextEntries = await Promise.all(targetSuggestions.map(async (item) => {
        try {
          const results = await getGeocode({ placeId: item.place_id });
          const firstResult = Array.isArray(results) ? results[0] : null;
          const latLng = firstResult ? await getLatLng(firstResult) : { lat: null, lng: null };

          return [
            item.place_id,
            {
              areaLabel: extractAreaLabelFromResults(results, item),
              lat: toCoordinateNumber(latLng?.lat),
              lng: toCoordinateNumber(latLng?.lng),
            },
          ];
        } catch {
          return [
            item.place_id,
            {
              areaLabel: extractFallbackSecondaryText(item),
              lat: null,
              lng: null,
            },
          ];
        }
      }));

      if (cancelled) return;

      const nextMetadata = {};
      nextEntries.forEach(([placeId, metadata]) => {
        suggestionMetadataCacheRef.current.set(placeId, metadata);
        nextMetadata[placeId] = metadata;
      });

      setSuggestionMetadata((current) => ({ ...current, ...nextMetadata }));
    };

    hydrateSuggestionMetadata();

    return () => {
      cancelled = true;
    };
  }, [suggestions]);

  const containerMarginBottom = dense ? 8 : 24;
  const inputMarginBottomClass = dense ? 'mb-1' : 'mb-2';
  const inputClassName = rectangular
    ? `appearance-none bg-[rgba(53,58,102,0.88)] border border-[rgba(133,149,208,0.5)] text-white font-sans text-lg px-4 py-3 rounded-none w-full h-12 transition-all focus:outline-none focus:border-[#7f8dff] focus:ring-2 focus:ring-[#6f7dff]/30 placeholder:text-white/45 focus:bg-[rgba(62,67,114,0.95)] box-border shadow-none ${inputMarginBottomClass}`
    : `appearance-none bg-white/10 border-2 border-white/30 text-white font-oswald text-lg px-4 py-3 rounded-lg w-full h-12 transition-all focus:outline-none focus:border-[#0ea9c6cc] focus:shadow-[0_0_0_2px_rgba(14,169,198,0.2)] placeholder:text-white/60 focus:bg-white/10 box-border shadow-none ${inputMarginBottomClass}`;

  return (
    <div style={{ position: 'relative', marginBottom: containerMarginBottom, width: '100%', boxSizing: 'border-box' }}>
      <input
        className={inputClassName}
        type="text"
        placeholder={ready ? 'Sede, club o direccion' : 'Sede, club o direccion (cargando sugerencias...)'}
        value={inputValue}
        onChange={(e) => {
          const nextValue = e.target.value;
          setHasUserEdited(true);
          setValue(nextValue);
          onChange?.(nextValue);
        }}
        onBlur={() => {
          window.setTimeout(() => clearSuggestions(), 120);
        }}
        style={{ width: '100%', boxSizing: 'border-box' }}
      />
      {suggestions.length > 0 && (
        <div
          style={{
            position: 'absolute',
            background: rectangular ? 'rgba(13,22,53,0.98)' : '#fff',
            zIndex: 120,
            left: 0,
            right: 0,
            boxShadow: rectangular ? '0 8px 22px rgba(0,0,0,0.38)' : '0 2px 8px 0 #0001',
            borderRadius: 0,
            border: rectangular ? '1px solid rgba(118,137,204,0.45)' : '1px solid #eceaf1',
            top: 48,
            padding: '3px 0',
            maxHeight: 220,
            overflowY: 'auto',
            width: '100%',
            boxSizing: 'border-box',
          }}
        >
          {suggestions.map((s) => (
            (() => {
              const metadata = suggestionMetadata[s.place_id] || suggestionMetadataCacheRef.current.get(s.place_id) || null;
              const secondaryText = metadata?.areaLabel || extractFallbackSecondaryText(s);
              const distanceLabel = metadata
                ? formatDistanceLabel(referenceLocation, metadata)
                : null;

              return (
                <div
                  key={s.place_id}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={async () => {
                    const description = String(s.description || '').trim();
                    setHasUserEdited(false);
                    setValue(description, false);
                    clearSuggestions();
                    setServiceSuggestions([]);
                    onChange?.(description);

                    try {
                      const results = await getGeocode({ placeId: s.place_id });
                      const firstResult = Array.isArray(results) ? results[0] : null;
                      if (!firstResult) throw new Error('Missing geocode result');
                      const { lat, lng } = await getLatLng(firstResult);
                      onSelect({ description, place_id: s.place_id, lat, lng });
                    } catch {
                      onSelect({ description, place_id: s.place_id, lat: null, lng: null });
                    }
                  }}
                  style={{
                    padding: '8px 18px',
                    cursor: 'pointer',
                    fontSize: 18,
                    borderBottom: rectangular ? '1px solid rgba(101,122,192,0.35)' : '1px solid #eceaf1',
                    background: rectangular ? 'rgba(17,30,66,0.86)' : '#fff',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                    <span style={{ fontWeight: 700, color: rectangular ? 'rgba(248,250,255,0.94)' : '#2a2a2a', fontSize: 18, flex: 1, minWidth: 0 }}>
                      {s.structured_formatting?.main_text || s.description}
                    </span>
                    <span
                      style={{
                        minWidth: 56,
                        textAlign: 'right',
                        color: rectangular ? 'rgba(158,211,255,0.92)' : '#4b5563',
                        fontSize: 14,
                        fontWeight: 600,
                        visibility: distanceLabel ? 'visible' : 'hidden',
                      }}
                    >
                      {distanceLabel || '0 km'}
                    </span>
                  </div>
                  {secondaryText ? (
                    <span
                      style={{
                        color: rectangular ? 'rgba(221,230,255,0.7)' : '#6b7280',
                        fontSize: 14,
                        lineHeight: 1.2,
                      }}
                    >
                      {secondaryText}
                    </span>
                  ) : null}
                </div>
              );
            })()
          ))}
        </div>
      )}
    </div>
  );
}
