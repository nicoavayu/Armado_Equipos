import { formatVenueShort } from '../utils/venueFormat';

describe('formatVenueShort', () => {
  test('keeps clean venue name and drops address/city/country metadata', () => {
    expect(
      formatVenueShort('Ateneo Félix Marino, Av. Rivadavia 1234, CABA, Buenos Aires, Argentina (C1424)'),
    ).toBe('Ateneo Félix Marino');
  });

  test('keeps venue title before dash metadata', () => {
    expect(
      formatVenueShort('La Terraza Fútbol 5 - Canchas, Urquiza 1050, San Isidro, Buenos Aires'),
    ).toBe('La Terraza Fútbol 5');
  });

  test('keeps venue name and removes postal/city tail', () => {
    expect(
      formatVenueShort('Urquiza Futbol, C1424, Buenos Aires, Argentina'),
    ).toBe('Urquiza Futbol');
  });

  test('falls back to first address segment when no venue name exists', () => {
    expect(
      formatVenueShort('Av. Rivadavia 1234, CABA, Buenos Aires, Argentina'),
    ).toBe('Av. Rivadavia 1234');
  });

  test('prefers structured name over formatted address', () => {
    expect(
      formatVenueShort({
        name: 'Ateneo Félix Marino',
        formattedAddress: 'Av. Rivadavia 1234, CABA, Buenos Aires, Argentina',
      }),
    ).toBe('Ateneo Félix Marino');
  });

  test('removes postal metadata in parenthesis', () => {
    expect(formatVenueShort('Ateneo Félix Marino (C1424)')).toBe('Ateneo Félix Marino');
  });

  test('truncates long names by word', () => {
    expect(formatVenueShort('Complejo Deportivo Súper Largo Con Varias Palabras', { maxLen: 24 })).toBe('Complejo Deportivo…');
  });
});
