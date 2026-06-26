import {
  buildVenuesGeoJSON,
  countActiveMatchesForVenues,
  getVenueKey,
  groupVenuesFromOpenMatches,
  matchNeedsGoalkeeper,
} from '../utils/venuesFromOpenMatches';

const makeMatch = (overrides = {}) => ({
  id: Math.random().toString(36).slice(2),
  sede: 'Cancha',
  sede_place_id: null,
  sede_latitud: -34.6037,
  sede_longitud: -58.3816,
  cupo_jugadores: 10,
  jugadores_count: 6,
  falta_jugadores: 4,
  modalidad: 'F5',
  ...overrides,
});

describe('venuesFromOpenMatches', () => {
  test('agrupa por sede_place_id aunque las coordenadas difieran levemente', () => {
    const matches = [
      makeMatch({ id: 'a', sede_place_id: 'ChIJ-place-1', sede_latitud: -34.6037, sede_longitud: -58.3816 }),
      makeMatch({ id: 'b', sede_place_id: 'ChIJ-place-1', sede_latitud: -34.60375, sede_longitud: -58.38168 }),
      makeMatch({ id: 'c', sede_place_id: 'ChIJ-place-2', sede_latitud: -34.70, sede_longitud: -58.50 }),
    ];

    const { venues } = groupVenuesFromOpenMatches(matches);

    expect(venues).toHaveLength(2);
    const placeOne = venues.find((venue) => venue.placeId === 'ChIJ-place-1');
    expect(placeOne.matches.map((m) => m.id).sort()).toEqual(['a', 'b']);
    expect(placeOne.activeMatchCount).toBe(2);
    expect(getVenueKey(matches[0])).toBe('place:ChIJ-place-1');
  });

  test('cae a coordenadas redondeadas cuando no hay place_id', () => {
    const matches = [
      makeMatch({ id: 'a', sede_place_id: null, sede_latitud: -34.6037, sede_longitud: -58.3816 }),
      // Within the ~11m rounding grid → same venue.
      makeMatch({ id: 'b', sede_place_id: null, sede_latitud: -34.60371, sede_longitud: -58.38162 }),
      // Far away → its own venue.
      makeMatch({ id: 'c', sede_place_id: null, sede_latitud: -34.9000, sede_longitud: -58.9000 }),
    ];

    const { venues } = groupVenuesFromOpenMatches(matches);

    expect(venues).toHaveLength(2);
    const grouped = venues.find((venue) => venue.activeMatchCount === 2);
    expect(grouped.matches.map((m) => m.id).sort()).toEqual(['a', 'b']);
    expect(getVenueKey(matches[0])).toMatch(/^geo:/);
  });

  test('excluye del mapa los partidos sin coordenadas válidas pero los reporta', () => {
    const matches = [
      makeMatch({ id: 'mapped', sede_place_id: 'ChIJ-place-1' }),
      makeMatch({ id: 'no-coords', sede_latitud: null, sede_longitud: null }),
      makeMatch({ id: 'zero-coords', sede_latitud: 0, sede_longitud: 0 }),
    ];

    const { venues, unmappableMatches, unmappableCount } = groupVenuesFromOpenMatches(matches);

    expect(venues).toHaveLength(1);
    expect(venues[0].matches.map((m) => m.id)).toEqual(['mapped']);
    expect(unmappableCount).toBe(2);
    expect(unmappableMatches.map((m) => m.id).sort()).toEqual(['no-coords', 'zero-coords']);
  });

  test('cuenta partidos activos, no sedes', () => {
    const matches = [
      makeMatch({ id: 'a', sede_place_id: 'p1' }),
      makeMatch({ id: 'b', sede_place_id: 'p1' }),
      makeMatch({ id: 'c', sede_place_id: 'p1' }),
      makeMatch({ id: 'd', sede_place_id: 'p2', sede_latitud: -34.8, sede_longitud: -58.7 }),
    ];

    const { venues } = groupVenuesFromOpenMatches(matches);

    expect(venues).toHaveLength(2);
    expect(countActiveMatchesForVenues(venues)).toBe(4);
    // A single venue with 3 matches contributes 3, not 1.
    expect(countActiveMatchesForVenues(venues)).not.toBe(venues.length);
  });

  test('buildVenuesGeoJSON expone matchCount por sede para clustering por partidos', () => {
    const matches = [
      makeMatch({ id: 'a', sede_place_id: 'p1' }),
      makeMatch({ id: 'b', sede_place_id: 'p1' }),
      makeMatch({ id: 'c', sede_place_id: 'p2', sede_latitud: -34.8, sede_longitud: -58.7 }),
    ];
    const { venues } = groupVenuesFromOpenMatches(matches);
    const geojson = buildVenuesGeoJSON(venues);

    expect(geojson.type).toBe('FeatureCollection');
    expect(geojson.features).toHaveLength(2);
    const counts = geojson.features.map((f) => f.properties.matchCount).sort();
    expect(counts).toEqual([1, 2]);
    geojson.features.forEach((feature) => {
      expect(feature.geometry.type).toBe('Point');
      expect(feature.geometry.coordinates).toHaveLength(2);
    });
  });

  describe('matchNeedsGoalkeeper', () => {
    test('no produce falsos positivos a partir de datos existentes', () => {
      expect(matchNeedsGoalkeeper(makeMatch({ falta_jugadores: 5 }))).toBe(false);
      expect(matchNeedsGoalkeeper(makeMatch({ jugadores: [{ is_goalkeeper: false }, { is_substitute: true }] }))).toBe(false);
      expect(matchNeedsGoalkeeper({})).toBe(false);
      expect(matchNeedsGoalkeeper(null)).toBe(false);
      expect(matchNeedsGoalkeeper(undefined)).toBe(false);
    });

    test('solo es true ante un opt-in explícito (campo de Fase B)', () => {
      expect(matchNeedsGoalkeeper({ busca_arquero: true })).toBe(true);
      expect(matchNeedsGoalkeeper({ busca_arquero: false })).toBe(false);
    });
  });
});
