import {
  buildCanonicalAwardCounts,
  buildUserIdentityTokenSet,
  entityMatchesIdentitySet,
  normalizeAwardType,
  resolveStablePlayerRef,
} from '../services/db/userIdentity';

describe('user identity helpers', () => {
  test('prefers stable usuario_id over roster uuid for registered players', () => {
    expect(resolveStablePlayerRef({
      id: 99,
      uuid: 'roster-uuid-1',
      usuario_id: 'stable-user-id-1',
    })).toBe('stable-user-id-1');
  });

  test('keeps roster uuid for guests without registered user id', () => {
    expect(resolveStablePlayerRef({
      id: 42,
      uuid: 'guest-roster-uuid',
      usuario_id: null,
    })).toBe('guest-roster-uuid');
  });

  test('normalizes current and legacy award aliases', () => {
    expect(normalizeAwardType('mvp')).toBe('mvp');
    expect(normalizeAwardType('golden_glove')).toBe('best_gk');
    expect(normalizeAwardType('best_goalkeeper')).toBe('best_gk');
    expect(normalizeAwardType('mejor arquero')).toBe('best_gk');
    expect(normalizeAwardType('negative_fair_play')).toBe('red_card');
    expect(normalizeAwardType('tarjeta roja')).toBe('red_card');
    expect(normalizeAwardType('mas_sucio')).toBe('red_card');
  });

  test('matches roster aliases against the same registered user identity set', () => {
    const identitySet = buildUserIdentityTokenSet({
      user: {
        id: 'stable-user-id-1',
        email: 'nico@example.com',
        user_metadata: { name: 'Nico' },
      },
      aliasRefs: ['legacy-roster-uuid-1', 'legacy-roster-uuid-2'],
    });

    expect(entityMatchesIdentitySet({
      usuario_id: 'stable-user-id-1',
      uuid: 'legacy-roster-uuid-2',
    }, identitySet)).toBe(true);

    expect(entityMatchesIdentitySet({
      uuid: 'legacy-roster-uuid-1',
      nombre: 'Nico',
    }, identitySet)).toBe(true);

    expect(entityMatchesIdentitySet({
      uuid: 'someone-else',
      nombre: 'Otra persona',
    }, identitySet)).toBe(false);
  });

  test('aggregates award rows under canonical visible counters', () => {
    expect(buildCanonicalAwardCounts([
      { award_type: 'mvp' },
      { award_type: 'golden_glove' },
      { award_type: 'best_gk' },
      { award_type: 'negative_fair_play' },
      { award_type: 'mas_sucio' },
    ])).toEqual({
      mvps: 1,
      guantes_dorados: 2,
      tarjetas_rojas: 2,
    });
  });
});
