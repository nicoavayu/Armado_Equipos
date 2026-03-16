import {
  buildJugadoresIdentityFilters,
  buildMatchPlayerIdentityMaps,
  resolveTargetPlayerUuid,
} from '../services/db/matches';

describe('vote target identity resolution', () => {
  const jugadores = [
    { id: 11, uuid: 'uuid-player-1', usuario_id: 'user-1' },
    { id: 12, uuid: 'uuid-player-2', usuario_id: null },
  ];

  test('resolves authenticated vote by stable usuario_id', () => {
    const maps = buildMatchPlayerIdentityMaps(jugadores);
    const row = { votado_id: 'user-1' };
    expect(resolveTargetPlayerUuid(row, maps)).toBe('uuid-player-1');
  });

  test('resolves public vote by numeric jugador id', () => {
    const maps = buildMatchPlayerIdentityMaps(jugadores);
    const row = { votado_jugador_id: 12 };
    expect(resolveTargetPlayerUuid(row, maps)).toBe('uuid-player-2');
  });

  test('resolves public vote by persisted votado_uuid when available', () => {
    const maps = buildMatchPlayerIdentityMaps(jugadores);
    const row = { votado_uuid: 'uuid-player-1', votado_jugador_id: 999 };
    expect(resolveTargetPlayerUuid(row, maps)).toBe('uuid-player-1');
  });

  test('returns null when vote target cannot be mapped to current roster', () => {
    const maps = buildMatchPlayerIdentityMaps(jugadores);
    const row = { votado_id: 'unknown-target' };
    expect(resolveTargetPlayerUuid(row, maps)).toBeNull();
  });

  test('builds only numeric jugador filter for numeric identities', () => {
    expect(buildJugadoresIdentityFilters('1643')).toEqual(['id.eq.1643']);
  });

  test('builds uuid-safe filters for uuid identities', () => {
    expect(buildJugadoresIdentityFilters('6ecdfeea-a005-4fdd-a80a-58c5974f0656')).toEqual([
      'usuario_id.eq.6ecdfeea-a005-4fdd-a80a-58c5974f0656',
      'uuid.eq.6ecdfeea-a005-4fdd-a80a-58c5974f0656',
    ]);
  });
});
