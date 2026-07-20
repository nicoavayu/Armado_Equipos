import {
  QUIERO_JUGAR_OPEN_MATCHES_VIEW,
  QUIERO_JUGAR_OPEN_MATCHES_RPC,
  QUIERO_JUGAR_AUDIT_RPC,
} from '../services/db/openMatches';

// The new client must consume the goalkeeper-aware v2 surface, never the legacy
// objects (which are frozen for apps already installed).
describe('Quiero Jugar open-matches surface', () => {
  test('the new client points at the v2 view and RPCs', () => {
    expect(QUIERO_JUGAR_OPEN_MATCHES_VIEW).toBe('partidos_abiertos_operativos_v2');
    expect(QUIERO_JUGAR_OPEN_MATCHES_RPC).toBe('get_open_matches_for_quiero_jugar_v2');
    expect(QUIERO_JUGAR_AUDIT_RPC).toBe('debug_quiero_jugar_match_audit_v2');
  });

  test('the new client never references the legacy (frozen) objects', () => {
    const surface = [
      QUIERO_JUGAR_OPEN_MATCHES_VIEW,
      QUIERO_JUGAR_OPEN_MATCHES_RPC,
      QUIERO_JUGAR_AUDIT_RPC,
    ];
    for (const name of surface) {
      expect(name.endsWith('_v2')).toBe(true);
    }
  });
});
