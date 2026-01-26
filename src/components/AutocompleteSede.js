// src/AutocompleteSede.js
import React from 'react';
import usePlacesAutocomplete, { getGeocode, getLatLng } from 'use-places-autocomplete';

export default function AutocompleteSede({ value, onSelect }) {
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

  return (
    <div style={{ position: 'relative', marginBottom: 24, width: '100%', boxSizing: 'border-box' }}>
      <input
        className="appearance-none bg-white/10 border-2 border-white/30 text-white font-oswald text-lg px-4 py-3 rounded-lg w-full h-12 transition-all focus:outline-none focus:border-[#0ea9c6cc] focus:shadow-[0_0_0_2px_rgba(14,169,198,0.2)] placeholder:text-white/60 focus:bg-white/10 mb-2 box-border shadow-none"
        type="text"
        placeholder="Sede, club o dirección"
        value={inputValue}
        onChange={(e) => setValue(e.target.value)}
        disabled={!ready}
        style={{ width: '100%', boxSizing: 'border-box' }}
      />
      {status === 'OK' && (
        <div
          style={{
            position: 'absolute',
            background: '#fff',
            zIndex: 50,
            left: 0,
            right: 0,
            boxShadow: '0 2px 8px 0 #0001',
            borderRadius: 8,
            top: 48,
            padding: '3px 0',
            maxHeight: 220,
            overflowY: 'auto',
            width: '100%',
            boxSizing: 'border-box',
          }}
        >
          {data
            .filter(
              (s) =>
                s.description &&
                s.description.toLowerCase().includes('argentina'),
            )
            .map((s) => (
              <div
                key={s.place_id}
                onClick={async () => {
                  setValue(s.description, false);
                  clearSuggestions();
                  const results = await getGeocode({ address: s.description });
                  const { lat, lng } = await getLatLng(results[0]);
                  onSelect({ description: s.description, place_id: s.place_id, lat, lng });
                }}
                style={{
                  padding: '8px 18px',
                  cursor: 'pointer',
                  fontSize: 18,
                  borderBottom: '1px solid #eceaf1',
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                <span style={{ fontWeight: 700, color: '#2a2a2a', fontSize: 18 }}>
                  {s.structured_formatting?.main_text || s.description}
                </span>
                {/* 
                  // Si algún día querés mostrar la dirección abajo:
                  {s.structured_formatting?.secondary_text && (
                    <span style={{ color: '#bbb', fontSize: 13, fontWeight: 400 }}>
                      {s.structured_formatting.secondary_text}
                    </span>
                  )}
                */}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
