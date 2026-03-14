import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import usePlacesAutocomplete, { getGeocode } from 'use-places-autocomplete';
import { notifyBlockingError } from '../../../utils/notifyBlockingError';

const MIN_AUTOCOMPLETE_CHARS = 1;
const NEIGHBORHOOD_TYPE_PRIORITY = [
  'neighborhood',
  'sublocality_level_1',
  'sublocality',
  'sublocality_level_2',
  'sublocality_level_3',
  'sublocality_level_4',
  'sublocality_level_5',
];

const sanitizeNeighborhoodText = (value) => String(value || '')
  .replace(/\b(CP|CABA)\b/gi, '')
  .replace(/\d+/g, '')
  .replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ\s.'-]/g, ' ')
  .replace(/\s{2,}/g, ' ')
  .trim();

const isNeighborhoodLabel = (value) => {
  const normalized = sanitizeNeighborhoodText(value);
  if (!normalized) return false;
  if (normalized.length < 2 || normalized.length > 40) return false;
  return !/\d/.test(normalized);
};

const extractNeighborhoodFromGeocode = (results) => {
  if (!Array.isArray(results)) return null;

  for (const result of results) {
    const components = Array.isArray(result?.address_components) ? result.address_components : [];

    for (const type of NEIGHBORHOOD_TYPE_PRIORITY) {
      const component = components.find((item) => Array.isArray(item?.types) && item.types.includes(type));
      if (!component) continue;

      const label = sanitizeNeighborhoodText(component.long_name || component.short_name || '');
      if (isNeighborhoodLabel(label)) {
        return label;
      }
    }
  }

  return null;
};

const mapSuggestionToLabel = (suggestion) => {
  const mainText = sanitizeNeighborhoodText(suggestion?.structured_formatting?.main_text || '');
  if (isNeighborhoodLabel(mainText)) return mainText;
  return sanitizeNeighborhoodText(suggestion?.description || '');
};

const isSuggestionForArgentina = (suggestion) => {
  const text = String(suggestion?.description || '').toLowerCase();
  return text.includes('argentina');
};

const isPlacesApiReady = () => (
  typeof window !== 'undefined'
  && Boolean(window.google?.maps?.places?.AutocompleteService)
);

const normalizePredictions = (predictions = [], limit = 8, query = '') => {
  const seen = new Set();
  const normalizedQuery = sanitizeNeighborhoodText(query).toLowerCase();

  return predictions
    .map((item) => ({ ...item, label: mapSuggestionToLabel(item) }))
    .filter((item) => item.label)
    .filter((item) => isSuggestionForArgentina(item))
    .filter((item) => (
      !normalizedQuery
      || item.label.toLowerCase().includes(normalizedQuery)
      || String(item?.description || '').toLowerCase().includes(normalizedQuery)
    ))
    .filter((item) => {
      const key = item.label.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      const aLabel = String(a.label || '').toLowerCase();
      const bLabel = String(b.label || '').toLowerCase();
      const aStarts = normalizedQuery && aLabel.startsWith(normalizedQuery) ? 1 : 0;
      const bStarts = normalizedQuery && bLabel.startsWith(normalizedQuery) ? 1 : 0;
      if (aStarts !== bStarts) return bStarts - aStarts;
      return aLabel.localeCompare(bLabel, 'es');
    })
    .slice(0, limit);
};

const NeighborhoodAutocomplete = ({
  value,
  onChange,
  placeholder = 'Ej: Palermo',
  inputClassName = '',
  panelClassName = '',
  itemClassName = '',
  limit = 8,
}) => {
  const placesServiceRef = useRef(null);
  const [serviceSuggestions, setServiceSuggestions] = useState([]);

  const {
    ready,
    value: query,
    setValue,
    suggestions: { status, data },
    clearSuggestions,
  } = usePlacesAutocomplete({
    debounce: 280,
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
    const nextQuery = String(rawQuery || '').trim();
    if (nextQuery.length < MIN_AUTOCOMPLETE_CHARS) {
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
            runRequest({ input: nextQuery }, 'relaxed');
            return;
          }

          setServiceSuggestions(safePredictions);
        },
      );
    };

    runRequest(
      {
        input: nextQuery,
        componentRestrictions: { country: 'ar' },
      },
      'primary',
    );
  }, [initPlacesService]);

  useEffect(() => {
    const externalValue = String(value || '');
    const internalValue = String(query || '');
    if (externalValue !== internalValue) {
      setValue(externalValue, false);
    }
  }, [query, setValue, value]);

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
    const timeoutId = window.setTimeout(() => {
      runPlacesProbe(query);
    }, 260);
    return () => window.clearTimeout(timeoutId);
  }, [query, runPlacesProbe]);

  const hookSuggestions = useMemo(() => {
    if (status !== 'OK') return [];
    return normalizePredictions(data, limit, query);
  }, [data, limit, query, status]);

  const serviceMappedSuggestions = useMemo(() => {
    if (!Array.isArray(serviceSuggestions) || serviceSuggestions.length === 0) return [];

    const mapped = normalizePredictions(serviceSuggestions, limit, query);
    if (mapped.length > 0) return mapped;

    return serviceSuggestions
      .map((item) => ({ ...item, label: mapSuggestionToLabel(item) }))
      .filter((item) => item.label)
      .slice(0, limit);
  }, [limit, query, serviceSuggestions]);

  const suggestions = useMemo(
    () => (hookSuggestions.length > 0 ? hookSuggestions : serviceMappedSuggestions),
    [hookSuggestions, serviceMappedSuggestions],
  );

  const handleSelect = async (suggestion) => {
    const fallbackNeighborhood = sanitizeNeighborhoodText(suggestion?.label || mapSuggestionToLabel(suggestion));

    try {
      const results = await getGeocode({ placeId: suggestion.place_id });
      const extractedNeighborhood = extractNeighborhoodFromGeocode(results);
      const neighborhood = sanitizeNeighborhoodText(extractedNeighborhood || fallbackNeighborhood);

      if (!isNeighborhoodLabel(neighborhood)) {
        notifyBlockingError('Selecciona un barrio valido de la lista.');
        return;
      }

      setValue(neighborhood, false);
      clearSuggestions();
      onChange(neighborhood);
    } catch {
      if (isNeighborhoodLabel(fallbackNeighborhood)) {
        setValue(fallbackNeighborhood, false);
        clearSuggestions();
        onChange(fallbackNeighborhood);
        return;
      }
      notifyBlockingError('No pudimos validar ese barrio en Google Maps.');
    }
  };

  const handleBlur = () => {
    window.setTimeout(() => {
      const currentValue = String(value || '').trim();
      const currentQuery = String(query || '').trim();

      if (!currentQuery) {
        onChange('');
        setValue('', false);
        clearSuggestions();
        return;
      }

      if (currentQuery !== currentValue) {
        onChange(currentQuery);
        setValue(currentQuery, false);
      }

      clearSuggestions();
    }, 120);
  };

  return (
    <div className="relative">
      <input
        type="text"
        value={query}
        onChange={(event) => {
          const nextValue = event.target.value;
          setValue(nextValue);
          onChange(nextValue);
        }}
        onBlur={handleBlur}
        placeholder={ready ? placeholder : 'Cargando barrios... (podes escribir manual)'}
        className={inputClassName}
      />

      {suggestions.length > 0 ? (
        <div className={`absolute left-0 right-0 top-[calc(100%+6px)] z-40 rounded-xl border border-white/15 bg-[#0f172a] shadow-[0_12px_30px_rgba(0,0,0,0.45)] max-h-56 overflow-y-auto ${panelClassName}`}>
          {suggestions.map((item) => (
            <button
              key={item.place_id}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => handleSelect(item)}
              className={`w-full text-left px-3 py-2 text-sm text-white/90 hover:bg-white/10 border-b border-white/10 last:border-b-0 ${itemClassName}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
};

export default NeighborhoodAutocomplete;
