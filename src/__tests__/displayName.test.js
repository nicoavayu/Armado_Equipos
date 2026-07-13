import { firstName } from '../utils/displayName';

describe('firstName (Home welcome greeting)', () => {
  test('name + surname => only the first name', () => {
    expect(firstName('Juanito Ferreri')).toBe('Juanito');
  });

  test('a single name is returned as-is', () => {
    expect(firstName('Juanito')).toBe('Juanito');
  });

  test('leading and inner whitespace is trimmed/collapsed', () => {
    expect(firstName('   Juan   Perez')).toBe('Juan');
    expect(firstName('\tMartina  Gómez López')).toBe('Martina');
  });

  test('empty / null / undefined fall back safely', () => {
    expect(firstName('')).toBe('Jugador');
    expect(firstName('   ')).toBe('Jugador');
    expect(firstName(null)).toBe('Jugador');
    expect(firstName(undefined)).toBe('Jugador');
  });

  test('a custom fallback is honoured', () => {
    expect(firstName('', 'Usuario')).toBe('Usuario');
    expect(firstName(null, 'Usuario')).toBe('Usuario');
    // Un nombre real ignora el fallback.
    expect(firstName('Lucía Fernández', 'Usuario')).toBe('Lucía');
  });
});
