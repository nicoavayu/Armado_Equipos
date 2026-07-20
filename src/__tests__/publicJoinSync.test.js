import { resolvePostSyncJoinState } from '../utils/publicJoinSync';

describe('resolvePostSyncJoinState (public "sincronizando" settle)', () => {
  test('membership finally visible → queda aprobado', () => {
    expect(resolvePostSyncJoinState({ isMember: true, latestStatus: 'approved' }))
      .toEqual({ status: 'approved', outcome: 'joined' });
  });

  test('expulsado: la solicitud dejó de estar approved (rejected) → sale del sync como removido', () => {
    expect(resolvePostSyncJoinState({ isMember: false, latestStatus: 'rejected' }))
      .toEqual({ status: 'none', outcome: 'removed' });
  });

  test('cancelled también settlea como removido (no loop)', () => {
    expect(resolvePostSyncJoinState({ isMember: false, latestStatus: 'cancelled' }))
      .toEqual({ status: 'none', outcome: 'removed' });
  });

  test('solicitud SIGUE approved pero sin membership → inconsistencia real, se surfacea (no se enmascara)', () => {
    expect(resolvePostSyncJoinState({ isMember: false, latestStatus: 'approved' }))
      .toEqual({ status: 'none', outcome: 'unresolved' });
  });

  test('sin solicitud (null) y sin membership → no se queda en sync', () => {
    expect(resolvePostSyncJoinState({ isMember: false, latestStatus: null }))
      .toEqual({ status: 'none', outcome: 'unresolved' });
  });

  test('nunca devuelve approved_pending_sync (no puede loopear)', () => {
    const cases = [
      { isMember: true, latestStatus: 'approved' },
      { isMember: false, latestStatus: 'approved' },
      { isMember: false, latestStatus: 'rejected' },
      { isMember: false, latestStatus: 'cancelled' },
      { isMember: false, latestStatus: null },
      { isMember: false, latestStatus: 'REJECTED ' },
    ];
    for (const c of cases) {
      expect(resolvePostSyncJoinState(c).status).not.toBe('approved_pending_sync');
    }
  });

  test('normaliza mayúsculas/espacios del status del servidor', () => {
    expect(resolvePostSyncJoinState({ isMember: false, latestStatus: '  REJECTED  ' }))
      .toEqual({ status: 'none', outcome: 'removed' });
  });
});
