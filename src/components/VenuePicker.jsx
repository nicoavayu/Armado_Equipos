import React, { Suspense, lazy } from 'react';
import { MapPin, Pencil } from 'lucide-react';
import AutocompleteSede from './AutocompleteSede';
import { hasValidCoordinates } from '../utils/matchLocation';

// MapLibre stays off the cold-start bundle: the preview is only imported the
// first time a venue with coordinates is actually selected.
const MapPinPreview = lazy(() => import('./MapPinPreview'));

// Venue picker for "Crear partido": a clean autocomplete that, once a place is
// chosen, collapses into a confirmation state (name + address + a small dark map
// pin preview + "Cambiar"). It is fully controlled — the parent owns `value`
// (sede text) and `info` (the selected place metadata) so the same fields keep
// flowing into the existing match payload with zero backend changes.
const VenuePicker = ({
  value,
  info,
  onChange,
  onSelect,
  onClear,
}) => {
  const hasSelectedVenue = Boolean(info?.place_id);

  if (!hasSelectedVenue) {
    return (
      <AutocompleteSede
        value={value}
        onChange={onChange}
        onSelect={onSelect}
        wizard
        dense
      />
    );
  }

  const venueName = String(info?.mainText || info?.description || value || '').trim();
  const venueAddress = String(info?.secondaryText || '').trim();
  const showAddress = Boolean(venueAddress) && venueAddress.toLowerCase() !== venueName.toLowerCase();
  const showPreview = hasValidCoordinates(info?.lat, info?.lng);

  return (
    <div data-testid="selected-venue">
      <div className="flex items-start gap-3 rounded-2xl border border-[rgba(148,134,255,0.34)] bg-[rgba(13,10,30,0.78)] px-4 py-3">
        <span className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-full bg-[#6a43ff]/18 text-[#b6a4ff]">
          <MapPin size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-oswald text-[17px] font-semibold text-white" data-testid="selected-venue-name">
            {venueName}
          </div>
          {showAddress ? (
            <div className="mt-0.5 truncate font-sans text-[13px] text-white/55" data-testid="selected-venue-address">
              {venueAddress}
            </div>
          ) : null}
        </div>
      </div>

      {showPreview ? (
        <Suspense
          fallback={(
            <div
              className="mt-3 h-[150px] w-full animate-pulse rounded-2xl border border-[rgba(148,134,255,0.18)] bg-[#0c0a1d]"
              aria-hidden="true"
            />
          )}
        >
          <MapPinPreview lat={info.lat} lng={info.lng} />
        </Suspense>
      ) : null}

      <button
        type="button"
        onClick={onClear}
        className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-full border border-[rgba(148,134,255,0.3)] bg-white/[0.05] px-4 font-oswald text-[13px] font-semibold uppercase tracking-[0.06em] text-white/75 transition-colors hover:bg-white/[0.1] hover:text-white"
      >
        <Pencil size={14} className="text-[#b6a4ff]" />
        Cambiar
      </button>
    </div>
  );
};

export default VenuePicker;
