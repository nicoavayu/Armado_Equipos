import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import usePlacesAutocomplete from 'use-places-autocomplete';
import { notifyBlockingError } from '../../../utils/notifyBlockingError';

const MIN_AUTOCOMPLETE_CHARS = 1;
const DEFAULT_COUNTRY = 'ar';

export const sanitizeNeighborhoodText = (value) => String(value || '')
  .replace(/\b(CP|CABA)\b/gi, '')
  .replace(/\d+/g, '')
  .replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ\s.'-]/g, ' ')
  .replace(/\s{2,}/g, ' ')
  .trim();

export const isNeighborhoodLabel = (value) => {
  const normalized = sanitizeNeighborhoodText(value);
  if (!normalized) return false;
  if (normalized.length < 2 || normalized.length > 40) return false;
  return !/\d/.test(normalized);
};

export const mapSuggestionToLabel = (suggestion) => {
  const mainText = sanitizeNeighborhoodText(suggestion?.structured_formatting?.main_text || '');
  if (isNeighborhoodLabel(mainText)) return mainText;
  return sanitizeNeighborhoodText(suggestion?.description || '');
};

// The value we store is exactly what the user tapped (the visible label). We must
// NOT reverse-geocode and overwrite it with a different administrative component:
// tapping "Cusco" used to save the surrounding neighborhood ("Amancay").
export const resolveSelectionLabel = (suggestion) => {
  const fromLabel = sanitizeNeighborhoodText(suggestion?.label || '');
  if (fromLabel) return fromLabel;
  return mapSuggestionToLabel(suggestion);
};

const isSuggestionForCountry = (suggestion, country) => {
  if (country !== DEFAULT_COUNTRY) return true; // componentRestrictions already scopes the results
  return String(suggestion?.description || '').toLowerCase().includes('argentina');
};

const isPlacesApiReady = () => (
  typeof window !== 'undefined'
  && Boolean(window.google?.maps?.places?.AutocompleteService)
);

export const normalizePredictions = (predictions = [], limit = 8, query = '', country = DEFAULT_COUNTRY) => {
  const seen = new Set();
  const normalizedQuery = sanitizeNeighborhoodText(query).toLowerCase();

  return predictions
    .map((item) => ({ ...item, label: mapSuggestionToLabel(item) }))
    .filter((item) => item.label)
    .filter((item) => isSuggestionForCountry(item, country))
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
  country = DEFAULT_COUNTRY,
}) => {
  const normalizedCountry = String(country || DEFAULT_COUNTRY).toLowerCase() || DEFAULT_COUNTRY;

  const placesServiceRef = useRef(null);
  const inputRef = useRef(null);
  const containerRef = useRef(null);
  const probeRequestIdRef = useRef(0);
  const [serviceSuggestions, setServiceSuggestions] = useState([]);
  const [hasUserEdited, setHasUserEdited] = useState(false);

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
      componentRestrictions: { country: normalizedCountry },
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

  const clearServiceSuggestions = useCallback(() => {
    // Invalidate any in-flight prediction request so a late response can't repopulate.
    probeRequestIdRef.current += 1;
    setServiceSuggestions([]);
  }, []);

  const runPlacesProbe = useCallback((rawQuery) => {
    const nextQuery = String(rawQuery || '').trim();
    if (nextQuery.length < MIN_AUTOCOMPLETE_CHARS) {
      clearServiceSuggestions();
      return;
    }

    if (!initPlacesService() || !placesServiceRef.current) {
      clearServiceSuggestions();
      return;
    }

    probeRequestIdRef.current += 1;
    const requestId = probeRequestIdRef.current;

    const runRequest = (requestOptions, stage = 'primary') => {
      placesServiceRef.current.getPlacePredictions(
        requestOptions,
        (predictions, serviceStatus) => {
          // Ignore stale responses: a newer keystroke or a selection happened.
          if (requestId !== probeRequestIdRef.current) return;

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
        componentRestrictions: { country: normalizedCountry },
      },
      'primary',
    );
  }, [clearServiceSuggestions, initPlacesService, normalizedCountry]);

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
    // Only probe once the user has actually typed. After a selection we set
    // hasUserEdited=false, which clears suggestions instead of re-fetching and
    // re-opening the dropdown with the value the user just picked.
    if (!hasUserEdited) {
      clearSuggestions();
      clearServiceSuggestions();
      return undefined;
    }
    const timeoutId = window.setTimeout(() => {
      runPlacesProbe(query);
    }, 260);
    return () => window.clearTimeout(timeoutId);
  }, [clearServiceSuggestions, clearSuggestions, hasUserEdited, query, runPlacesProbe]);

  const hookSuggestions = useMemo(() => {
    if (status !== 'OK') return [];
    return normalizePredictions(data, limit, query, normalizedCountry);
  }, [data, limit, normalizedCountry, query, status]);

  const serviceMappedSuggestions = useMemo(() => {
    if (!Array.isArray(serviceSuggestions) || serviceSuggestions.length === 0) return [];

    const mapped = normalizePredictions(serviceSuggestions, limit, query, normalizedCountry);
    if (mapped.length > 0) return mapped;

    return serviceSuggestions
      .map((item) => ({ ...item, label: mapSuggestionToLabel(item) }))
      .filter((item) => item.label)
      .slice(0, limit);
  }, [limit, normalizedCountry, query, serviceSuggestions]);

  const suggestions = useMemo(() => {
    // For Argentina keep the previous hook-first behaviour. For other countries the
    // hook is locked to its initial restriction, so prefer the live probe results.
    if (normalizedCountry === DEFAULT_COUNTRY && hookSuggestions.length > 0) return hookSuggestions;
    if (serviceMappedSuggestions.length > 0) return serviceMappedSuggestions;
    return hookSuggestions;
  }, [hookSuggestions, normalizedCountry, serviceMappedSuggestions]);

  const closeSuggestions = useCallback(() => {
    setHasUserEdited(false);
    clearSuggestions();
    clearServiceSuggestions();
  }, [clearServiceSuggestions, clearSuggestions]);

  const handleSelect = (suggestion) => {
    const label = resolveSelectionLabel(suggestion);

    if (!isNeighborhoodLabel(label)) {
      notifyBlockingError('Selecciona una zona válida de la lista.');
      return;
    }

    // Suppress the probe effect first so updating the value can't re-open the panel.
    setHasUserEdited(false);
    setValue(label, false);
    clearSuggestions();
    clearServiceSuggestions();
    inputRef.current?.blur();
    onChange(label);
  };

  const handleBlur = () => {
    window.setTimeout(() => {
      const currentValue = String(value || '').trim();
      const currentQuery = String(query || '').trim();

      if (!currentQuery) {
        onChange('');
        setValue('', false);
        closeSuggestions();
        return;
      }

      if (currentQuery !== currentValue) {
        onChange(currentQuery);
        setValue(currentQuery, false);
      }

      closeSuggestions();
    }, 120);
  };

  // Close when tapping/clicking outside the field.
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const handlePointerDown = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        closeSuggestions();
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
    };
  }, [closeSuggestions]);

  return (
    <div className="relative" ref={containerRef}>
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(event) => {
          const nextValue = event.target.value;
          setHasUserEdited(true);
          setValue(nextValue);
          onChange(nextValue);
        }}
        onBlur={handleBlur}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            closeSuggestions();
          }
        }}
        placeholder={ready ? placeholder : 'Cargando zonas... (podes escribir manual)'}
        className={inputClassName}
      />

      {suggestions.length > 0 ? (
        <div className={`absolute left-0 right-0 top-[calc(100%+6px)] z-40 rounded-xl border border-white/15 bg-[#0f172a] shadow-[0_12px_30px_rgba(0,0,0,0.45)] max-h-56 overflow-y-auto ${panelClassName}`}>
          {suggestions.map((item) => (
            <button
              key={item.place_id || item.label}
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
