import React, { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { hasValidCoordinates, toCoordinateNumber } from '../utils/matchLocation';

// Small, non-interactive dark map that confirms a single selected venue with one
// Arma2 violet pin. It deliberately reuses the exact OpenFreeMap "dark" style and
// the violet pin look from the Jugar > PARTIDOS map (MatchesMapView) so a venue
// looks identical wherever it appears. This is a confirmation preview, not a full
// map screen: panning/zoom/scroll are all disabled (`interactive: false`).
//
// Loaded only via React.lazy from its parents so the MapLibre engine stays off
// the cold-start bundle and out of test runs that never render a preview.

const OPENFREEMAP_DARK_STYLE = 'https://tiles.openfreemap.org/styles/dark';
const DEFAULT_ZOOM = 14.5;

const MapPinPreview = ({ lat, lng, zoom = DEFAULT_ZOOM, height = 150 }) => {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const [mapError, setMapError] = useState(false);

  const numericLat = toCoordinateNumber(lat);
  const numericLng = toCoordinateNumber(lng);
  const valid = hasValidCoordinates(numericLat, numericLng);

  // Initialize the map once. The preview only ever mounts with valid coordinates
  // (the parent gates rendering on them), so the center is known up front.
  useEffect(() => {
    if (!valid || !containerRef.current || mapRef.current) return undefined;

    let map;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: OPENFREEMAP_DARK_STYLE,
        center: [numericLng, numericLat],
        zoom,
        interactive: false,
        attributionControl: false,
      });
    } catch (error) {
      setMapError(true);
      return undefined;
    }

    mapRef.current = map;

    // Attribution is legally required and comes straight from the style source's
    // TileJSON — we add NO customAttribution so the credit never renders twice.
    // `compact: true` keeps it to a tiny corner "ⓘ" so it never crowds the preview.
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    map.on('error', () => {});

    // Single Arma2 violet pin (glow + core) built as a DOM marker so it shows
    // immediately without waiting on style/layer load.
    const markerEl = document.createElement('div');
    markerEl.className = 'arma2-map-pin';
    markerRef.current = new maplibregl.Marker({ element: markerEl })
      .setLngLat([numericLng, numericLat])
      .addTo(map);

    // The container may be zero-sized at construction; settle the size.
    window.setTimeout(() => map.resize?.(), 0);

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // Run once; coordinate updates are handled by the recenter effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recenter (and move the pin) if the selected venue changes without remounting.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !valid) return;
    map.jumpTo?.({ center: [numericLng, numericLat], zoom });
    markerRef.current?.setLngLat?.([numericLng, numericLat]);
  }, [numericLat, numericLng, valid, zoom]);

  if (!valid) return null;

  return (
    <div
      className="arma2-pin-preview relative mt-3 overflow-hidden rounded-2xl border border-[rgba(148,134,255,0.22)] shadow-[0_12px_34px_rgba(4,2,16,0.4)]"
      style={{ height }}
      data-testid="map-pin-preview"
    >
      <div
        ref={containerRef}
        className="h-full w-full bg-[#0c0a1d]"
        aria-label="Ubicación de la cancha seleccionada"
      />

      {/* Subtle Arma2 violet glow over the edges (does not block interaction). */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-2xl shadow-[inset_0_0_70px_rgba(106,67,255,0.2)]"
      />

      {mapError ? (
        <div className="absolute inset-0 flex items-center justify-center bg-[#0c0a1d]/92 px-4 text-center font-sans text-[12px] text-white/55">
          No pudimos mostrar el mapa
        </div>
      ) : null}

      <style>{`
        .arma2-map-pin {
          width: 18px;
          height: 18px;
          border-radius: 9999px;
          background: #7c5cff;
          border: 2px solid rgba(239, 233, 255, 0.92);
          box-shadow: 0 0 0 8px rgba(124, 92, 255, 0.28), 0 4px 12px rgba(5, 3, 16, 0.45);
        }
        .arma2-pin-preview .maplibregl-ctrl-bottom-right {
          right: 6px;
          bottom: 6px;
        }
        .arma2-pin-preview .maplibregl-ctrl-attrib {
          margin: 0;
          min-height: 0;
          border-radius: 9999px;
          background: rgba(10, 8, 24, 0.5);
          -webkit-backdrop-filter: blur(6px);
          backdrop-filter: blur(6px);
          border: 1px solid rgba(148, 134, 255, 0.16);
        }
        .arma2-pin-preview .maplibregl-ctrl-attrib.maplibregl-compact {
          min-width: 24px;
          min-height: 24px;
        }
        .arma2-pin-preview .maplibregl-ctrl-attrib-inner {
          font-size: 9.5px;
          color: rgba(226, 220, 255, 0.6);
        }
      `}</style>
    </div>
  );
};

export default MapPinPreview;
