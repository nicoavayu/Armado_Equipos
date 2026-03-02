// src/AutocompleteSede.js
import React from 'react';
import usePlacesAutocomplete, { getGeocode, getLatLng } from 'use-places-autocomplete';

export default function AutocompleteSede({ value, onSelect, dense = false, rectangular = false }) {
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
            background: rectangular ? 'rgba(13,22,53,0.98)' : '#fff',
            zIndex: 50,
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
                  borderBottom: rectangular ? '1px solid rgba(101,122,192,0.35)' : '1px solid #eceaf1',
                  background: rectangular ? 'rgba(17,30,66,0.86)' : '#fff',
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                <span style={{ fontWeight: 700, color: rectangular ? 'rgba(248,250,255,0.94)' : '#2a2a2a', fontSize: 18 }}>
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
