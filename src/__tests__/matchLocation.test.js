import {
  buildFrequentMatchLocationFields,
  buildMatchLocationFields,
  extractPersistedLocation,
  hasValidCoordinates,
} from '../utils/matchLocation';

describe('matchLocation', () => {
  test('extrae una ubicación persistida desde columnas explícitas', () => {
    const location = extractPersistedLocation({
      sede: 'Nuñez, Buenos Aires, Argentina',
      sede_place_id: 'place-123',
      sede_latitud: '-34.552',
      sede_longitud: '-58.456',
    });

    expect(location).toEqual({
      description: 'Nuñez, Buenos Aires, Argentina',
      placeId: 'place-123',
      lat: -34.552,
      lng: -58.456,
    });
  });

  test('persiste place_id y coordenadas nuevas cuando el usuario selecciona una sede', () => {
    const payload = buildMatchLocationFields({
      locationText: 'La Terraza Fútbol',
      locationInfo: {
        description: 'La Terraza Fútbol',
        place_id: 'place-456',
        lat: -34.57,
        lng: -58.43,
      },
    });

    expect(payload).toMatchObject({
      sede: 'La Terraza Fútbol',
      sede_place_id: 'place-456',
      sede_direccion_normalizada: 'La Terraza Fútbol',
      sede_latitud: -34.57,
      sede_longitud: -58.43,
    });
    expect(payload.sedeMaps).toEqual({ place_id: 'place-456' });
  });

  test('reutiliza coordenadas previas si el texto no cambió y no hubo nueva selección', () => {
    const payload = buildFrequentMatchLocationFields({
      locationText: 'Ateneo Felix Marino',
      existingLocation: {
        sede: 'Ateneo Felix Marino',
        sede_place_id: 'place-789',
        sede_latitud: -34.61,
        sede_longitud: -58.48,
      },
    });

    expect(payload).toEqual({
      sede: 'Ateneo Felix Marino',
      sede_place_id: 'place-789',
      sede_direccion_normalizada: 'Ateneo Felix Marino',
      sede_latitud: -34.61,
      sede_longitud: -58.48,
    });
  });

  test('descarta coordenadas viejas si el texto cambió sin una nueva selección válida', () => {
    const payload = buildMatchLocationFields({
      locationText: 'Pinamar, Buenos Aires, Argentina',
      existingLocation: {
        sede: 'Nuñez, Buenos Aires, Argentina',
        sede_place_id: 'place-old',
        sede_latitud: -34.55,
        sede_longitud: -58.45,
      },
    });

    expect(payload.sede).toBe('Pinamar, Buenos Aires, Argentina');
    expect(payload.sede_place_id).toBeNull();
    expect(payload.sede_latitud).toBeNull();
    expect(payload.sede_longitud).toBeNull();
    expect(hasValidCoordinates(payload.sede_latitud, payload.sede_longitud)).toBe(false);
  });
});
