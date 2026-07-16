import { closePrivateWebAccess } from '../utils/privateWebAccess';

describe('private web access client action', () => {
  test('clears the web gate cookie through the dedicated server endpoint', async () => {
    const fetchImplementation = jest.fn().mockResolvedValue({ ok: true });

    await closePrivateWebAccess(fetchImplementation);

    expect(fetchImplementation).toHaveBeenCalledWith('/api/private-web-logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
      },
    });
  });

  test('surfaces a generic error without touching the Supabase session', async () => {
    const fetchImplementation = jest.fn().mockResolvedValue({ ok: false });

    await expect(closePrivateWebAccess(fetchImplementation)).rejects.toThrow(
      'No pudimos cerrar el acceso web. Intentá nuevamente.',
    );
  });
});
