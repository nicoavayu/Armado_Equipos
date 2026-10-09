import {
  buildCeremonyEntries,
  ceremonySeenKey,
  hasSeenCeremony,
  isAwardConfirmed,
  markCeremonySeen,
  resolveAwardChip,
  resolveAwardCounter,
  resolveCollectionNote,
} from '../utils/awardsCeremony';

const ANA = 'aaaaaaaa-0000-0000-0000-000000000001';
const BETO = 'bbbbbbbb-0000-0000-0000-000000000002';

const row = (jugadorId, type, matchId, createdAt) => ({
  jugador_id: jugadorId,
  award_type: type,
  partido_id: matchId,
  created_at: createdAt,
});

describe('awards ceremony data', () => {
  test('a counter is shown only when player_awards confirms the award for that player and match', () => {
    const player = { usuario_id: ANA, mvps: 3 };
    expect(resolveAwardCounter({ type: 'mvp', player, matchId: 8, awardRows: [] })).toBeNull();
    expect(resolveAwardCounter({
      type: 'mvp', player, matchId: 8, awardRows: [row(ANA, 'mvp', 7, '2026-10-01T00:00:00Z')],
    })).toBeNull();
    expect(resolveAwardCounter({
      type: 'mvp', player, matchId: 8, awardRows: [row(BETO, 'mvp', 8, '2026-10-01T00:00:00Z')],
    })).toBeNull();
    expect(isAwardConfirmed({ type: 'mvp', player, matchId: '8', awardRows: [row(ANA, 'mvp', 8)] })).toBe(true);
  });

  test('the latest award animates total - 1 → total from the real profile counter (no local +1)', () => {
    const counter = resolveAwardCounter({
      type: 'mvp',
      player: { usuario_id: ANA, mvps: 2 },
      matchId: 8,
      awardRows: [row(ANA, 'mvp', 7, '2026-10-01T00:00:00Z'), row(ANA, 'mvp', 8, '2026-10-07T00:00:00Z')],
    });
    expect(counter).toEqual({ total: 2, before: 2 - 1, isLatest: true, label: 'MVP' });
  });

  test('an older match does not pretend the counter moved now', () => {
    const counter = resolveAwardCounter({
      type: 'mvp',
      player: { usuario_id: ANA, mvps: 2 },
      matchId: 7,
      awardRows: [row(ANA, 'mvp', 7, '2026-10-01T00:00:00Z'), row(ANA, 'mvp', 8, '2026-10-07T00:00:00Z')],
    });
    expect(counter).toMatchObject({ total: 2, before: 2, isLatest: false });
    expect(resolveCollectionNote({ type: 'mvp', isMine: false, isGuest: false, counter })).toBe('Ya está en su colección');
  });

  test('guests and penalties never get an invented total', () => {
    const guest = { nombre: 'Juan', uuid: 'g-1' };
    expect(resolveAwardCounter({ type: 'mvp', player: guest, matchId: 8, awardRows: [row(null, 'mvp', 8)] })).toBeNull();
    expect(resolveCollectionNote({ type: 'mvp', isMine: false, isGuest: true, counter: null }))
      .toBe('Jugó como invitado: el premio queda en este partido');
    expect(resolveAwardCounter({
      type: 'penalty', player: { usuario_id: ANA }, matchId: 8, awardRows: [row(ANA, 'penalty', 8)],
    })).toBeNull();
    expect(resolveAwardCounter({
      type: 'mvp', player: { usuario_id: ANA, mvps: 0 }, matchId: 8, awardRows: [row(ANA, 'mvp', 8)],
    })).toBeNull();
  });

  test('"Ganaste" only for the watcher\'s own positive awards; negatives read as sanctions', () => {
    expect(resolveAwardChip({ type: 'mvp', isMine: true })).toBe('Ganaste');
    expect(resolveAwardChip({ type: 'mvp', isMine: false })).toBe('Premio');
    expect(resolveAwardChip({ type: 'red_card', isMine: true })).toBe('Sanción para vos');
    expect(resolveAwardChip({ type: 'penalty', isMine: false })).toBe('Sanción');
  });

  test('entries keep homonyms apart, mark only the watcher and use profile counters', () => {
    const anaPlayer = { uuid: 'j-1', usuario_id: ANA, nombre: 'Juan Pérez', avatar_url: null };
    const guestPlayer = { uuid: 'j-2', usuario_id: null, nombre: 'Juan Pérez' };
    const entries = buildCeremonyEntries({
      slides: [
        { key: 'mvp', type: 'mvp', player: anaPlayer, votes: 4 },
        { key: 'best_gk', type: 'best_gk', player: guestPlayer, votes: 1 },
        { key: 'penalty', type: 'penalty', player: { uuid: 'j-3', usuario_id: BETO, nombre: 'Beto' }, penalty: { from: '5.0', to: '4.5' } },
        { key: 'bogus', type: 'unknown', player: anaPlayer },
      ],
      matchId: 8,
      currentUserId: ANA.toUpperCase(),
      awardRows: [row(ANA, 'mvp', 8, '2026-10-07T00:00:00Z')],
      profilesById: { [ANA]: { id: ANA, mvps: 5 } },
      hints: new Map([['j-1', 'Con cuenta'], ['j-2', 'Invitado']]),
    });

    expect(entries.map((entry) => entry.type)).toEqual(['mvp', 'best_gk', 'penalty']);
    expect(entries[0]).toMatchObject({
      name: 'Juan Pérez', hint: 'Con cuenta', isMine: true, chip: 'Ganaste', votesLabel: '4 votos',
      counter: { total: 5, before: 4 }, collectionNote: 'Sumado a tu colección',
    });
    expect(entries[1]).toMatchObject({
      hint: 'Invitado', isMine: false, chip: 'Premio', votesLabel: '1 voto', counter: null,
    });
    expect(entries[2]).toMatchObject({ chip: 'Sanción', penalty: { from: '5.0', to: '4.5' }, counter: null });
  });

  test('building entries twice (replay, reload) yields the same counters', () => {
    const args = {
      slides: [{ key: 'mvp', type: 'mvp', player: { uuid: 'j-1', usuario_id: ANA, nombre: 'Ana' }, votes: 3 }],
      matchId: 8,
      currentUserId: null,
      awardRows: [row(ANA, 'mvp', 8, '2026-10-07T00:00:00Z')],
      profilesById: { [ANA]: { id: ANA, mvps: 1 } },
    };
    expect(buildCeremonyEntries(args)).toEqual(buildCeremonyEntries(args));
    expect(buildCeremonyEntries(args)[0].counter.total).toBe(1);
  });

  test('the "seen" mark is per account and match', () => {
    window.localStorage.clear();
    expect(hasSeenCeremony(ANA, 8)).toBe(false);
    markCeremonySeen(ANA, 8);
    expect(hasSeenCeremony(ANA, 8)).toBe(true);
    expect(hasSeenCeremony(BETO, 8)).toBe(false);
    expect(hasSeenCeremony(ANA, 9)).toBe(false);
    expect(ceremonySeenKey(ANA, 8)).toContain(ANA);
  });
});

describe('cardProfileAt', () => {
  // eslint-disable-next-line global-require
  const { cardProfileAt } = require('../utils/awardsCeremony');
  const entry = {
    type: 'best_gk',
    counter: { total: 3, before: 2 },
    cardProfile: { nombre: 'Diego', mvps: 1, guantes_dorados: 3, gk_badges: 3, mvp_badges: 1 },
  };

  test('moves only the awarded counter, from before to the real total', () => {
    expect(cardProfileAt(entry, false)).toMatchObject({ guantes_dorados: 2, gk_badges: 2, mvps: 1 });
    expect(cardProfileAt(entry, true)).toMatchObject({ guantes_dorados: 3, gk_badges: 3, mvps: 1 });
  });

  test('without a confirmed counter the card keeps its values', () => {
    expect(cardProfileAt({ ...entry, counter: null }, false)).toMatchObject({ guantes_dorados: 3 });
  });
});
