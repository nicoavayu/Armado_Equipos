import { buildGoalkeeperMarket, isGoalkeeperMarketEligible } from '../utils/goalkeeperMarket';

// Buenos Aires reference point.
const userLocation = { lat: -34.6037, lng: -58.3816 };

const gkNear = {
  id: 'gk-near', nombre: 'Cerca', disponible_arquero: true, posiciones: ['ARQ'],
  latitud: -34.61, longitud: -58.38, // ~1 km
};
const gkFar = {
  id: 'gk-far', nombre: 'Lejos', disponible_arquero: true, posiciones: ['ARQ', 'DEF'],
  latitud: -34.90, longitud: -58.38, // ~30+ km
};
const gkNoCoords = {
  id: 'gk-nocoords', nombre: 'SinUbicacion', disponible_arquero: true, posiciones: ['ARQ'],
  latitud: null, longitud: null,
};
const notAvailable = {
  id: 'gk-off', nombre: 'NoDisponible', disponible_arquero: false, posiciones: ['ARQ'],
  latitud: -34.61, longitud: -58.38,
};
const notGoalkeeper = {
  id: 'field', nombre: 'DeCampo', disponible_arquero: true, posiciones: ['DEF', 'DEL'],
  latitud: -34.61, longitud: -58.38,
};

describe('goalkeeper market eligibility', () => {
  test('requires ARQ + disponible_arquero', () => {
    expect(isGoalkeeperMarketEligible(gkNear)).toBe(true);
    expect(isGoalkeeperMarketEligible(notAvailable)).toBe(false);
    expect(isGoalkeeperMarketEligible(notGoalkeeper)).toBe(false);
  });
});

describe('buildGoalkeeperMarket', () => {
  test('only lists ARQ + available goalkeepers', () => {
    const list = buildGoalkeeperMarket({
      goalkeepers: [gkNear, notAvailable, notGoalkeeper],
      userLocation,
    });
    expect(list.map((g) => g.id)).toEqual(['gk-near']);
  });

  test('excludes the current user', () => {
    const list = buildGoalkeeperMarket({
      goalkeepers: [gkNear, gkNoCoords],
      userLocation,
      currentUserId: 'gk-near',
    });
    expect(list.find((g) => g.id === 'gk-near')).toBeUndefined();
  });

  test('orders nearest-first, coord-less last', () => {
    const list = buildGoalkeeperMarket({
      goalkeepers: [gkNoCoords, gkFar, gkNear],
      userLocation,
      maxDistanceKm: 100,
    });
    expect(list.map((g) => g.id)).toEqual(['gk-near', 'gk-far', 'gk-nocoords']);
  });

  test('respects the radius (drops known distances beyond it)', () => {
    const list = buildGoalkeeperMarket({
      goalkeepers: [gkNear, gkFar],
      userLocation,
      maxDistanceKm: 5,
    });
    expect(list.map((g) => g.id)).toEqual(['gk-near']);
  });

  test('keeps coord-less goalkeepers even with a radius', () => {
    const list = buildGoalkeeperMarket({
      goalkeepers: [gkNear, gkNoCoords],
      userLocation,
      maxDistanceKm: 5,
    });
    expect(list.map((g) => g.id).sort()).toEqual(['gk-near', 'gk-nocoords']);
  });
});
