// Tests for the WhatsApp-import roster save (src/services/db/importedMatchPlayers.js).
//
// The rule under test: when the match was created but part of the confirmed
// roster could not be saved, the caller must learn exactly which players
// landed and which failed — never a silent "all good" — and a retry must
// never double-insert manual players (they have no unique constraint).

let mockDb = null;

jest.mock('../lib/supabaseClient', () => ({
  supabase: {
    from: (...args) => mockDb.from(...args),
  },
}));

jest.mock('../utils/logger', () => ({
  error: jest.fn(),
  log: jest.fn(),
  warn: jest.fn(),
}));

const {
  buildImportedPlayerRows,
  saveImportedPlayers,
} = require('../services/db/importedMatchPlayers');

const PARTIDO = { id: 77, match_ref: 'ref-77' };

// Minimal jugadores table double: rows live in `state.rows`; behaviour is
// steered per-test through `state.batchInsertError` / `state.rowErrorsFor`
// (names whose individual insert fails) / `state.selectError`.
const makeDb = (overrides = {}) => {
  const state = {
    rows: [],
    batchInsertError: null,
    rowErrorsFor: [],
    selectError: null,
    insertCalls: [],
    ...overrides,
  };

  state.from = (table) => {
    if (table !== 'jugadores') throw new Error(`unexpected table ${table}`);
    return {
      insert: async (payload) => {
        const batch = Array.isArray(payload) ? payload : [payload];
        state.insertCalls.push(batch);
        if (batch.length > 1 && state.batchInsertError) {
          return { error: state.batchInsertError };
        }
        const failing = batch.find((row) => state.rowErrorsFor.includes(row.nombre));
        if (batch.length === 1 && failing) {
          return { error: { code: '23514', message: `check violation for ${failing.nombre}` } };
        }
        if (batch.length > 1 && failing) {
          return { error: { code: '23514', message: `check violation for ${failing.nombre}` } };
        }
        state.rows.push(...batch);
        return { error: null };
      },
      select: () => ({
        eq: async () => (state.selectError
          ? { data: null, error: state.selectError }
          : { data: state.rows.map(({ nombre, usuario_id: usuarioId }) => ({ nombre, usuario_id: usuarioId })), error: null }),
      }),
    };
  };

  return state;
};

const baseRowsInput = {
  partido: PARTIDO,
  userId: 'user-1',
  creatorName: 'Nico',
  creatorAvatarUrl: 'http://a/x.png',
  confirmedNames: ['Pato', 'Fede'],
};

describe('buildImportedPlayerRows', () => {
  test('creator first, imported players as manual rows', () => {
    const rows = buildImportedPlayerRows(baseRowsInput);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ usuario_id: 'user-1', nombre: 'Nico', partido_id: 77, match_ref: 'ref-77' });
    expect(rows[1]).toMatchObject({ usuario_id: null, nombre: 'Pato' });
    expect(rows[2]).toMatchObject({ usuario_id: null, nombre: 'Fede' });
  });

  test('drops duplicates and the organizer from the confirmed list, accent/case-insensitive', () => {
    const rows = buildImportedPlayerRows({
      ...baseRowsInput,
      confirmedNames: ['nico', 'Pato', 'pato', 'PATÓ', 'Fede', '  '],
    });
    expect(rows.map((row) => row.nombre)).toEqual(['Nico', 'Pato', 'Fede']);
  });
});

describe('saveImportedPlayers', () => {
  test('clean batch insert reports full success', async () => {
    mockDb = makeDb();
    const rows = buildImportedPlayerRows(baseRowsInput);
    const result = await saveImportedPlayers({ partidoId: PARTIDO.id, rows });

    expect(result.failedRows).toEqual([]);
    expect(result.verified).toBe(true);
    expect(mockDb.rows).toHaveLength(3);
  });

  test('batch failure salvages row by row and reports exactly who failed', async () => {
    mockDb = makeDb({
      batchInsertError: { code: '23514', message: 'batch rejected' },
      rowErrorsFor: ['Fede'],
    });
    const rows = buildImportedPlayerRows(baseRowsInput);
    const result = await saveImportedPlayers({ partidoId: PARTIDO.id, rows });

    expect(result.verified).toBe(true);
    expect(result.savedRows.map((row) => row.nombre)).toEqual(['Nico', 'Pato']);
    expect(result.failedRows.map((row) => row.nombre)).toEqual(['Fede']);
    // Real state, not bookkeeping: the saved players are actually in the table.
    expect(mockDb.rows.map((row) => row.nombre)).toEqual(['Nico', 'Pato']);
  });

  test('reports everything unconfirmed when the roster cannot be re-read', async () => {
    mockDb = makeDb({
      batchInsertError: { message: 'network gone' },
      selectError: { message: 'network gone' },
    });
    const rows = buildImportedPlayerRows(baseRowsInput);
    const result = await saveImportedPlayers({ partidoId: PARTIDO.id, rows });

    expect(result.verified).toBe(false);
    expect(result.failedRows).toHaveLength(3);
    // Never inserted blindly without knowing the current roster.
    expect(mockDb.rows).toHaveLength(0);
  });

  test('retry only inserts the missing players — no duplicates', async () => {
    mockDb = makeDb();
    // First attempt left the creator and Pato saved, Fede missing.
    mockDb.rows = [
      { partido_id: 77, usuario_id: 'user-1', nombre: 'Nico' },
      { partido_id: 77, usuario_id: null, nombre: 'Pato' },
    ];
    const rows = buildImportedPlayerRows(baseRowsInput);
    const result = await saveImportedPlayers({ partidoId: PARTIDO.id, rows, retry: true });

    expect(result.failedRows).toEqual([]);
    expect(result.verified).toBe(true);
    expect(mockDb.rows.map((row) => row.nombre)).toEqual(['Nico', 'Pato', 'Fede']);
    // Exactly one insert call, with only the missing player.
    expect(mockDb.insertCalls).toHaveLength(1);
    expect(mockDb.insertCalls[0].map((row) => row.nombre)).toEqual(['Fede']);
  });

  test('retry with everything already saved inserts nothing', async () => {
    mockDb = makeDb();
    mockDb.rows = [
      { partido_id: 77, usuario_id: 'user-1', nombre: 'Nico' },
      { partido_id: 77, usuario_id: null, nombre: 'Pato' },
      { partido_id: 77, usuario_id: null, nombre: 'Fede' },
    ];
    const rows = buildImportedPlayerRows(baseRowsInput);
    const result = await saveImportedPlayers({ partidoId: PARTIDO.id, rows, retry: true });

    expect(result.failedRows).toEqual([]);
    expect(mockDb.insertCalls).toHaveLength(0);
  });
});
