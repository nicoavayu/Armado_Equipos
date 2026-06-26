import React, { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MapPinOff } from 'lucide-react';
import logger from '../../utils/logger';
import { useVenuesFromOpenMatches } from '../../hooks/useVenuesFromOpenMatches';
import { buildVenuesGeoJSON } from '../../utils/venuesFromOpenMatches';
import VenueMatchesSheet from './VenueMatchesSheet';

// MapLibre map for Jugar > PARTIDOS "Mapa". Loaded only via React.lazy so the
// ~map engine stays off the cold-start bundle and out of the test runner.
//
// Tiles/style: OpenFreeMap keyless "dark" style (attribution embedded in the
// style + kept visible via MapLibre's AttributionControl). Custom violet/neon
// clusters whose number is the SUM of active matches (not venue count), premium
// single pins, and a premium bottom sheet on tap.

const OPENFREEMAP_DARK_STYLE = 'https://tiles.openfreemap.org/styles/dark';
const OPENFREEMAP_ATTRIBUTION = 'OpenFreeMap © OpenMapTiles Data from OpenStreetMap';
// Buenos Aires / CABA — default center when no user location is available.
const DEFAULT_CENTER = [-58.3816, -34.6037];
const DEFAULT_ZOOM = 10.5;
const SOURCE_ID = 'arma2-venues';

const todayLocalISODate = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const getDistinctFormats = (matches) => {
  const seen = new Set();
  (Array.isArray(matches) ? matches : []).forEach((match) => {
    const value = String(match?.modalidad || '').trim();
    if (value) seen.add(value);
  });
  return Array.from(seen).sort();
};

const FilterChip = ({ active, disabled, onClick, children, hint }) => (
  <button
    type="button"
    disabled={disabled}
    onClick={onClick}
    aria-pressed={active}
    className={`relative whitespace-nowrap rounded-full border px-3 py-1.5 font-sans text-[12px] font-bold uppercase tracking-[0.03em] transition-all ${
      disabled
        ? 'cursor-not-allowed border-[rgba(148,134,255,0.14)] bg-white/[0.03] text-white/35'
        : active
          ? 'border-[rgba(148,134,255,0.5)] bg-[rgba(106,67,255,0.25)] text-white shadow-[0_0_12px_rgba(106,67,255,0.25)]'
          : 'border-[rgba(148,134,255,0.18)] bg-white/[0.04] text-white/55 hover:bg-white/[0.08] hover:text-white/80'
    }`}
  >
    {children}
    {hint ? (
      <span className="ml-1.5 rounded-full bg-white/10 px-1.5 py-px text-[9px] font-bold tracking-[0.04em] text-white/50">
        {hint}
      </span>
    ) : null}
  </button>
);

const MatchesMapView = ({
  matches = [],
  userLocation = null,
  currentUserId = null,
  onSelectMatch,
}) => {
  const containerRef = useRef(null);
  const cardRef = useRef(null);
  const mapRef = useRef(null);
  const didFitRef = useRef(false);
  const [mapError, setMapError] = useState(false);
  const [mapHeight, setMapHeight] = useState(null);
  const [selectedVenue, setSelectedVenue] = useState(null);

  const [onlyToday, setOnlyToday] = useState(false);
  const [formatFilter, setFormatFilter] = useState('all');

  const availableFormats = useMemo(() => getDistinctFormats(matches), [matches]);

  const filteredMatches = useMemo(() => {
    const today = todayLocalISODate();
    return (Array.isArray(matches) ? matches : []).filter((match) => {
      if (onlyToday && match?.fecha !== today) return false;
      if (formatFilter !== 'all' && String(match?.modalidad || '').trim() !== formatFilter) return false;
      return true;
    });
  }, [matches, onlyToday, formatFilter]);

  const { venues, unmappableCount } = useVenuesFromOpenMatches(filteredMatches);
  const geojson = useMemo(() => buildVenuesGeoJSON(venues), [venues]);

  // Size the map to fill from the card's top down to just above the fixed
  // TabBar (safe-area aware) so the map gets protagonism while its bottom edge
  // and zoom controls always stay clear of the bottom navigation.
  useEffect(() => {
    const computeHeight = () => {
      const el = cardRef.current;
      if (!el) return;
      const viewport = window.visualViewport?.height || window.innerHeight || 0;
      const { top } = el.getBoundingClientRect();
      // Matches MainLayout's reserved bottom padding (~104px) for the TabBar,
      // plus a small gap so the card clearly ends above the bar.
      const TAB_BAR_CLEARANCE = 116;
      const next = Math.round(viewport - top - TAB_BAR_CLEARANCE);
      setMapHeight(Math.max(340, next));
    };

    computeHeight();
    const raf = window.requestAnimationFrame(computeHeight);
    window.addEventListener('resize', computeHeight);
    window.addEventListener('orientationchange', computeHeight);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', computeHeight);
      window.removeEventListener('orientationchange', computeHeight);
    };
  }, []);

  // Keep the MapLibre canvas in sync with the computed height.
  useEffect(() => {
    mapRef.current?.resize?.();
  }, [mapHeight]);

  // Keep an up-to-date venue lookup for click handlers without re-binding them.
  const venuesByKeyRef = useRef(new Map());
  useEffect(() => {
    venuesByKeyRef.current = new Map(venues.map((venue) => [venue.key, venue]));
  }, [venues]);

  // Initialize the map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return undefined;

    let map;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: OPENFREEMAP_DARK_STYLE,
        center: userLocation?.lng != null && userLocation?.lat != null
          ? [userLocation.lng, userLocation.lat]
          : DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        attributionControl: false,
        // We never auto-request geolocation here; centering uses already-resolved data only.
      });
    } catch (error) {
      logger.warn('[MatchesMapView] MapLibre init failed', error);
      setMapError(true);
      return undefined;
    }

    mapRef.current = map;

    map.addControl(
      new maplibregl.AttributionControl({ compact: true, customAttribution: OPENFREEMAP_ATTRIBUTION }),
      'bottom-right',
    );
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    map.on('error', (event) => {
      logger.warn('[MatchesMapView] MapLibre runtime error', event?.error || event);
    });

    map.on('load', () => {
      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        cluster: true,
        clusterRadius: 52,
        clusterMaxZoom: 15,
        // SUM active matches across venues so the cluster badge counts matches, not venues.
        clusterProperties: {
          matchCount: ['+', ['get', 'matchCount']],
        },
      });

      // Cluster glow.
      map.addLayer({
        id: 'venue-cluster-glow',
        type: 'circle',
        source: SOURCE_ID,
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': 'rgba(124, 92, 255, 0.28)',
          'circle-blur': 0.9,
          'circle-radius': ['interpolate', ['linear'], ['get', 'matchCount'], 1, 24, 6, 34, 16, 48],
        },
      });
      // Cluster core.
      map.addLayer({
        id: 'venue-cluster-core',
        type: 'circle',
        source: SOURCE_ID,
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': ['interpolate', ['linear'], ['get', 'matchCount'], 1, '#7c5cff', 8, '#a855f7', 16, '#ec007d'],
          'circle-radius': ['interpolate', ['linear'], ['get', 'matchCount'], 1, 16, 6, 22, 16, 30],
          'circle-stroke-width': 2,
          'circle-stroke-color': 'rgba(239, 233, 255, 0.85)',
        },
      });
      // Cluster count (SUM of active matches).
      map.addLayer({
        id: 'venue-cluster-count',
        type: 'symbol',
        source: SOURCE_ID,
        filter: ['has', 'point_count'],
        layout: {
          'text-field': ['to-string', ['get', 'matchCount']],
          'text-font': ['Noto Sans Bold'],
          'text-size': 14,
          'text-allow-overlap': true,
        },
        paint: { 'text-color': '#ffffff' },
      });

      // Single venue glow.
      map.addLayer({
        id: 'venue-point-glow',
        type: 'circle',
        source: SOURCE_ID,
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': 'rgba(124, 92, 255, 0.32)',
          'circle-blur': 0.8,
          'circle-radius': 20,
        },
      });
      // Single venue core — Arma2 violet (a brighter violet when the venue holds
      // more than one open match). No green: keeps the pin on-brand over the
      // dark map with a light violet/white halo.
      map.addLayer({
        id: 'venue-point-core',
        type: 'circle',
        source: SOURCE_ID,
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': ['case', ['>', ['get', 'matchCount'], 1], '#a855f7', '#7c5cff'],
          'circle-radius': 12,
          'circle-stroke-width': 2,
          'circle-stroke-color': 'rgba(239, 233, 255, 0.92)',
        },
      });
      // Single venue count — only when the venue holds more than one match.
      map.addLayer({
        id: 'venue-point-count',
        type: 'symbol',
        source: SOURCE_ID,
        filter: ['all', ['!', ['has', 'point_count']], ['>', ['get', 'matchCount'], 1]],
        layout: {
          'text-field': ['to-string', ['get', 'matchCount']],
          'text-font': ['Noto Sans Bold'],
          'text-size': 12,
          'text-allow-overlap': true,
        },
        paint: { 'text-color': '#ffffff' },
      });

      const pointerLayers = ['venue-cluster-core', 'venue-cluster-glow', 'venue-point-core', 'venue-point-glow'];
      pointerLayers.forEach((layerId) => {
        map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; });
      });

      // Tap a cluster → zoom in to break it apart.
      const handleClusterClick = (event) => {
        const features = map.queryRenderedFeatures(event.point, { layers: ['venue-cluster-core'] });
        const clusterId = features?.[0]?.properties?.cluster_id;
        if (clusterId == null) return;
        const source = map.getSource(SOURCE_ID);
        const center = features[0].geometry.coordinates;
        const result = source.getClusterExpansionZoom(clusterId);
        if (result && typeof result.then === 'function') {
          result.then((zoom) => map.easeTo({ center, zoom })).catch(() => {});
        } else {
          source.getClusterExpansionZoom(clusterId, (err, zoom) => {
            if (!err) map.easeTo({ center, zoom });
          });
        }
      };
      map.on('click', 'venue-cluster-core', handleClusterClick);
      map.on('click', 'venue-cluster-glow', handleClusterClick);

      // Tap a single venue → open the bottom sheet.
      const handlePointClick = (event) => {
        const venueKey = event.features?.[0]?.properties?.venueKey;
        const venue = venuesByKeyRef.current.get(venueKey);
        if (venue) setSelectedVenue(venue);
      };
      map.on('click', 'venue-point-core', handlePointClick);
      map.on('click', 'venue-point-glow', handlePointClick);

      // The container may have been zero-sized at construction; settle the size.
      window.setTimeout(() => map.resize(), 0);
    });

    return () => {
      map.remove();
      mapRef.current = null;
      didFitRef.current = false;
    };
    // Intentionally run once; data + center updates are handled in effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push venue data into the source and fit the viewport once.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const applyData = () => {
      const source = map.getSource(SOURCE_ID);
      if (!source) return;
      source.setData(geojson);

      if (!didFitRef.current && geojson.features.length > 0) {
        didFitRef.current = true;
        if (geojson.features.length === 1) {
          map.easeTo({ center: geojson.features[0].geometry.coordinates, zoom: 13 });
        } else {
          const bounds = new maplibregl.LngLatBounds();
          geojson.features.forEach((feature) => bounds.extend(feature.geometry.coordinates));
          map.fitBounds(bounds, { padding: 64, maxZoom: 14, duration: 400 });
        }
      }
    };

    if (map.isStyleLoaded() && map.getSource(SOURCE_ID)) {
      applyData();
    } else {
      map.once('load', applyData);
    }
  }, [geojson]);

  const handleSelectMatch = (match, meta) => {
    setSelectedVenue(null);
    onSelectMatch?.(match, meta);
  };

  const hasMappableVenues = venues.length > 0;

  return (
    <div className="w-full max-w-[520px]">
      {/* Filters — kept simple & honest. A goalkeeper filter is intentionally NOT
          shown in Phase A: there is no real match-level "needs GK" field yet
          (the matchNeedsGoalkeeper helper stays defensive/false), so the UI never
          surfaces a fabricated state. */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <FilterChip active={onlyToday} onClick={() => setOnlyToday((value) => !value)}>
          Hoy
        </FilterChip>
        {availableFormats.length > 1 ? (
          <>
            <FilterChip active={formatFilter === 'all'} onClick={() => setFormatFilter('all')}>
              Todos
            </FilterChip>
            {availableFormats.map((format) => (
              <FilterChip
                key={format}
                active={formatFilter === format}
                onClick={() => setFormatFilter(format)}
              >
                {format}
              </FilterChip>
            ))}
          </>
        ) : null}
      </div>

      <div
        ref={cardRef}
        className="relative overflow-hidden rounded-card border border-[rgba(148,134,255,0.18)] shadow-elev-2"
        style={mapHeight ? { height: `${mapHeight}px` } : undefined}
      >
        <div
          ref={containerRef}
          className={`w-full bg-[#0c0a1d] ${mapHeight ? 'h-full' : 'h-[62vh] min-h-[360px]'}`}
          aria-label="Mapa de partidos abiertos"
        />

        {/* Subtle Arma2 violet glow over the map edges (does not block interaction). */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-card shadow-[inset_0_0_120px_rgba(106,67,255,0.18)]"
        />

        {mapError ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#0c0a1d]/92 px-6 text-center">
            <MapPinOff size={28} className="text-[#b0a0ff]" />
            <p className="font-oswald text-base font-bold text-white">No pudimos cargar el mapa</p>
            <p className="font-sans text-sm text-white/55">Probá con la vista Lista mientras tanto.</p>
          </div>
        ) : null}

        {!mapError && !hasMappableVenues ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#0c0a1d]/82 px-6 text-center">
            <MapPinOff size={28} className="text-[#b0a0ff]" />
            <p className="font-oswald text-base font-bold text-white">Sin partidos para mostrar en el mapa</p>
            <p className="font-sans text-sm text-white/55">
              {unmappableCount > 0
                ? 'Los partidos sin ubicación aparecen solo en la Lista.'
                : 'Cuando haya partidos con ubicación cercana, los vas a ver acá.'}
            </p>
          </div>
        ) : null}
      </div>

      {unmappableCount > 0 && hasMappableVenues ? (
        <p className="mt-2 px-1 font-sans text-[12px] text-white/45">
          {`${unmappableCount} ${unmappableCount === 1 ? 'partido sin ubicación aparece' : 'partidos sin ubicación aparecen'} solo en Lista.`}
        </p>
      ) : null}

      <VenueMatchesSheet
        venue={selectedVenue}
        currentUserId={currentUserId}
        onClose={() => setSelectedVenue(null)}
        onSelectMatch={handleSelectMatch}
      />
    </div>
  );
};

export default MatchesMapView;
