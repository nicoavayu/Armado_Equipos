// src/AutocompleteSede.js
import React from "react";
import usePlacesAutocomplete, { getGeocode, getLatLng } from "use-places-autocomplete";

export default function AutocompleteSede({ value, onSelect }) {
  const {
    ready,
    value: inputValue,
    setValue,
    suggestions: { status, data },
    clearSuggestions,
  } = usePlacesAutocomplete({
    debounce: 300,
    defaultValue: value || "",
    requestOptions: {
      componentRestrictions: { country: "ar" }
    }
  });

  return (
    <div style={{ position: "relative", marginBottom: 24, width: "100%" }}>
      <input
        className="input-modern"
        type="text"
        placeholder="Sede, club o dirección"
        value={inputValue}
        onChange={e => setValue(e.target.value)}
        disabled={!ready}
        style={{ width: "100%" }}
      />
      {status === "OK" && (
        <div
          style={{
            position: "absolute",
            background: "#fff",
            zIndex: 50,
            left: 0,
            right: 0,
            boxShadow: "0 2px 8px 0 #0001",
            borderRadius: 8,
            top: 48,
            padding: "3px 0",
            maxHeight: 220,
            overflowY: "auto"
          }}
        >
          {data
            .filter(
              s =>
                s.description &&
                s.description.toLowerCase().includes("argentina")
            )
            .map(({ place_id, description }) => (
              <div
                key={place_id}
                onClick={async () => {
                  setValue(description, false);
                  clearSuggestions();
                  const results = await getGeocode({ address: description });
                  const { lat, lng } = await getLatLng(results[0]);
                  onSelect({ description, place_id, lat, lng });
                }}
                style={{
                  padding: "8px 18px",
                  cursor: "pointer",
                  fontSize: 18,
                  borderBottom: "1px solid #eceaf1"
                }}
              >
                {description}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
