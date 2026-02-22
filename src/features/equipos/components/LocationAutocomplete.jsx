import React, { useEffect, useMemo } from 'react';
import usePlacesAutocomplete from 'use-places-autocomplete';

const isArgentinaSuggestion = (suggestion) => String(suggestion?.description || '')
  .toLowerCase()
  .includes('argentina');

const buildLabel = (suggestion) => (
  suggestion?.description
  || suggestion?.structured_formatting?.main_text
  || ''
).trim();

const LocationAutocomplete = ({
  value,
  onChange,
  placeholder = 'Cancha o direccion',
  inputClassName = '',
  panelClassName = '',
  itemClassName = '',
  limit = 8,
  disabled = false,
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
    },
  });

  useEffect(() => {
    setValue(value || '', false);
  }, [setValue, value]);

  const suggestions = useMemo(() => {
    if (status !== 'OK') return [];

    const seen = new Set();
    return data
      .filter((item) => isArgentinaSuggestion(item))
      .map((item) => ({
        ...item,
        label: buildLabel(item),
      }))
      .filter((item) => item.label)
      .filter((item) => {
        const key = item.label.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, limit);
  }, [data, limit, status]);

  const handleSelect = (suggestion) => {
    const label = buildLabel(suggestion);
    setValue(label, false);
    clearSuggestions();
    onChange(label);
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

  const inputDisabled = disabled || !ready;

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
        placeholder={ready ? placeholder : 'Cargando ubicaciones...'}
        disabled={inputDisabled}
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

export default LocationAutocomplete;
