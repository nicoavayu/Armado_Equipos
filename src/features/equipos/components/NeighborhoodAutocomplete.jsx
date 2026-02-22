import React, { useEffect, useMemo } from 'react';
import usePlacesAutocomplete, { getGeocode } from 'use-places-autocomplete';
import { notifyBlockingError } from '../../../utils/notifyBlockingError';

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

const NeighborhoodAutocomplete = ({
  value,
  onChange,
  placeholder = 'Ej: Palermo',
  inputClassName = '',
  panelClassName = '',
  itemClassName = '',
  limit = 8,
}) => {
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
      types: ['(regions)'],
    },
  });

  useEffect(() => {
    setValue(value || '', false);
  }, [value, setValue]);

  const suggestions = useMemo(() => {
    if (status !== 'OK') return [];

    const seen = new Set();
    return data
      .map((item) => ({ ...item, label: mapSuggestionToLabel(item) }))
      .filter((item) => isNeighborhoodLabel(item.label))
      .filter((item) => isSuggestionForArgentina(item))
      .filter((item) => {
        const key = item.label.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, limit);
  }, [data, limit, status]);

  const handleSelect = async (suggestion) => {
    try {
      const results = await getGeocode({ placeId: suggestion.place_id });
      const extractedNeighborhood = extractNeighborhoodFromGeocode(results);
      const fallbackNeighborhood = mapSuggestionToLabel(suggestion);
      const neighborhood = sanitizeNeighborhoodText(extractedNeighborhood || fallbackNeighborhood);

      if (!isNeighborhoodLabel(neighborhood)) {
        notifyBlockingError('Selecciona un barrio valido de la lista.');
        return;
      }

      setValue(neighborhood, false);
      clearSuggestions();
      onChange(neighborhood);
    } catch (error) {
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
        setValue(currentValue, false);
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
          if (!nextValue.trim()) {
            onChange('');
          }
        }}
        onBlur={handleBlur}
        placeholder={ready ? placeholder : 'Cargando barrios...'}
        disabled={!ready}
        className={inputClassName}
      />

      {status === 'OK' && suggestions.length > 0 ? (
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
