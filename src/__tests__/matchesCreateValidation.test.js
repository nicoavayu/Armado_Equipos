import { crearPartido } from '../services/db/matches';
import { supabase } from '../lib/supabaseClient';

jest.mock('../lib/supabaseClient', () => ({
  supabase: {
    from: jest.fn(),
  },
}));

describe('crearPartido name validation', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test.each([
    [{}],
    [{ nombre: '' }],
    [{ nombre: '   ' }],
  ])('rejects missing, empty, or blank names before inserting', async (payload) => {
    await expect(crearPartido(payload)).rejects.toThrow('Poné un nombre para el partido.');
  });

  test('does not insert when the match name is invalid', async () => {
    await expect(crearPartido({ nombre: '   ' })).rejects.toThrow('Poné un nombre para el partido.');
    expect(supabase.from).not.toHaveBeenCalled();
  });

  test('trims the match name before inserting', async () => {
    const single = jest.fn(async () => ({
      data: { id: 123, nombre: 'Partido real' },
      error: null,
    }));
    const select = jest.fn(() => ({ single }));
    const insert = jest.fn(() => ({ select }));

    supabase.from.mockReturnValue({ insert });

    await expect(crearPartido({ nombre: '  Partido real  ', codigo: ' ABC123 ' })).resolves.toEqual({
      id: 123,
      nombre: 'Partido real',
    });

    expect(supabase.from).toHaveBeenCalledWith('partidos');
    expect(insert).toHaveBeenCalledWith([
      expect.objectContaining({
        nombre: 'Partido real',
        codigo: 'ABC123',
      }),
    ]);
  });
});
