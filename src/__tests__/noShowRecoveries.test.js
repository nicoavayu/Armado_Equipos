// Tests for the no-show RECOVERY rule (src/services/db/penalties.js).
//
// Business rule under test (GRADUAL recovery — a no-show is a serious sanction that
// takes several matches to fully shake off, but it is never permanent):
//   * A confirmed no-show applies a -0.5 penalty (e.g. 5.0 → 4.5).
//   * Every 3 correctly-played matches after the penalty restore +0.2, capped by the
//     remaining debt, so the final cycle only returns the leftover (+0.1 here):
//       - after 3 correct matches: 4.5 → 4.7
//       - after 6 correct matches: 4.7 → 4.9
//       - after 9 correct matches: 4.9 → 5.0 (final +0.1, debt cleared)
//   * Recovery never pushes the player above their pre-penalty ranking.
//   * Re-running a closing match is idempotent (never double-restores).
//   * Cancelled / not-played matches and matches where the player was confirmed
//     absent again do NOT advance the streak.

let mockSupabaseApi = null;

jest.mock('../lib/supabaseClient', () => ({
  supabase: {
    from: (...args) => mockSupabaseApi.from(...args),
    rpc: (...args) => mockSupabaseApi.rpc(...args),
  },
}));

const { applyNoShowRecoveries, applyNoShowPenalties } = require('../services/db/penalties');

const clone = (value) => JSON.parse(JSON.stringify(value));

class QueryBuilder {
  constructor({ state, table }) {
    this.state = state;
    this.table = table;
    this.action = null;
    this.payload = null;
    this.conflictKeys = null;
    this.filters = [];
    this.limitN = null;
    this.expectSingle = false;
    this.expectMaybeSingle = false;
  }

  select() {
    if (this.action == null) this.action = 'select';
    return this;
  }

  insert(payload) {
    this.action = 'insert';
    this.payload = Array.isArray(payload) ? payload : [payload];
    return this;
  }

  upsert(payload, options = {}) {
    this.action = 'upsert';
    this.payload = Array.isArray(payload) ? payload : [payload];
    const onConflict = options.onConflict || 'user_id';
    this.conflictKeys = onConflict.split(',').map((k) => k.trim());
    return this;
  }

  eq(column, value) {
    this.filters.push({ type: 'eq', column, value });
    return this;
  }

  in(column, values) {
    this.filters.push({ type: 'in', column, values: Array.isArray(values) ? values : [] });
    return this;
  }

  limit(n) {
    this.limitN = n;
    return this;
  }

  single() {
    this.expectSingle = true;
    return this;
  }

  maybeSingle() {
    this.expectMaybeSingle = true;
    return this;
  }

  then(resolve, reject) {
    Promise.resolve(this.exec()).then(resolve, reject);
  }

  matches(row) {
    return this.filters.every((filter) => {
      if (filter.type === 'eq') {
        return String(row?.[filter.column]) === String(filter.value);
      }
      if (filter.type === 'in') {
        const allowed = new Set((filter.values || []).map((value) => String(value)));
        return allowed.has(String(row?.[filter.column]));
      }
      return true;
    });
  }

  exec() {
    const rows = this.state.tables[this.table] || [];

    if (this.action === 'select') {
      let selected = rows.filter((row) => this.matches(row));
      if (this.limitN != null) selected = selected.slice(0, this.limitN);
      if (this.expectSingle || this.expectMaybeSingle) {
        return { data: clone(selected[0] || null), error: null };
      }
      return { data: clone(selected), error: null };
    }

    if (this.action === 'insert') {
      const nextRows = this.payload.map((row, index) => ({
        id: row?.id ?? `${this.table}-${rows.length + index + 1}`,
        ...row,
      }));
      this.state.tables[this.table] = [...rows, ...nextRows];
      return { data: clone(nextRows), error: null };
    }

    if (this.action === 'upsert') {
      const current = [...rows];
      this.payload.forEach((row) => {
        const idx = current.findIndex((existing) =>
          this.conflictKeys.every((key) => String(existing?.[key]) === String(row?.[key])));
        if (idx >= 0) {
          current[idx] = { ...current[idx], ...row };
        } else {
          current.push({ ...row });
        }
      });
      this.state.tables[this.table] = current;
      return { data: clone(this.payload), error: null };
    }

    return { data: null, error: null };
  }
}

const buildSupabaseMock = (state) => ({
  from: jest.fn((table) => new QueryBuilder({ state, table })),
  rpc: jest.fn(async (fnName, params) => {
    const table = params?.p_table;
    const column = params?.p_column;
    const userId = params?.p_id;
    const amount = Number(params?.p_amount || 0);
    if (table !== 'usuarios' || !['ranking', 'partidos_abandonados'].includes(column)) {
      return { error: null };
    }
    const row = (state.tables.usuarios || []).find((u) => String(u?.id) === String(userId));
    if (!row) return { error: new Error('user_not_found') };
    if (fnName === 'dec_numeric') row[column] = Number((Number(row[column] || 0) - amount).toFixed(2));
    if (fnName === 'inc_numeric') row[column] = Number((Number(row[column] || 0) + amount).toFixed(2));
    return { error: null };
  }),
});

// A "correct" match: it was played (se_jugo true) and the tracked user is NOT among
// the confirmed absentees. Two voters keep absence confirmation possible.
const playedMatch = (partidoId, { absentPlayerIds = [] } = {}) => ([
  { partido_id: partidoId, votante_id: 1, se_jugo: true, motivo_no_jugado: null, jugadores_ausentes: absentPlayerIds },
  { partido_id: partidoId, votante_id: 2, se_jugo: true, motivo_no_jugado: null, jugadores_ausentes: absentPlayerIds },
]);

// Nine correct matches are enough to fully recover a single -0.5 penalty (0.2/0.2/0.1).
const NINE_MATCH_IDS = [11, 12, 13, 14, 15, 16, 17, 18, 19];

const buildState = ({ penalties = 1, startRanking = 4.5, matchIds = NINE_MATCH_IDS } = {}) => {
  const penaltyRows = Array.from({ length: penalties }, (_, i) => ({
    user_id: 'user-3',
    partido_id: 100 + i, // historical penalty matches
    type: 'no_show_penalty',
    amount: -0.5,
  }));
  return {
    tables: {
      partidos: matchIds.map((id) => ({ id, nombre: `Partido ${id}` })),
      // jugador 3 (user-3) is registered in every correct match; jugador 9 keeps the
      // match populated so absences can be "confirmed" against user-3 when needed.
      jugadores: matchIds.flatMap((id) => ([
        { id: 3, partido_id: id, usuario_id: 'user-3' },
        { id: 9, partido_id: id, usuario_id: 'user-9' },
      ])),
      usuarios: [
        { id: 'user-3', ranking: startRanking, partidos_abandonados: penalties },
        { id: 'user-9', ranking: 5, partidos_abandonados: 0 },
      ],
      rating_adjustments: penaltyRows,
      no_show_recovery_state: [],
      post_match_surveys: [],
      notifications: [],
    },
  };
};

const getRanking = (state, userId = 'user-3') =>
  state.tables.usuarios.find((u) => u.id === userId)?.ranking;
const getStreak = (state, userId = 'user-3') =>
  state.tables.no_show_recovery_state.find((s) => s.user_id === userId)?.current_streak ?? 0;
const recoveryRows = (state, userId = 'user-3') =>
  state.tables.rating_adjustments.filter((r) => r.user_id === userId && r.type === 'no_show_recovery');
const recoveryAmounts = (state, userId = 'user-3') =>
  recoveryRows(state, userId).map((r) => r.amount);

const playCorrect = async (state, partidoId, absentPlayerIds = []) => {
  state.tables.post_match_surveys = playedMatch(partidoId, { absentPlayerIds });
  return applyNoShowRecoveries(partidoId, { emitNotifications: false });
};

describe('applyNoShowRecoveries — gradual restore (+0.2/+0.2/+0.1 over 9 matches)', () => {
  test('recovers in three steps: 4.5 → 4.7 (3) → 4.9 (6) → 5.0 (9), never above 5.0', async () => {
    // Seed a 10th match (20) to prove the cleared-debt branch keeps 5.0 and resets.
    const state = buildState({ penalties: 1, startRanking: 4.5, matchIds: [...NINE_MATCH_IDS, 20] });
    mockSupabaseApi = buildSupabaseMock(state);

    // Matches 1 & 2: still penalized, streak builds, no recovery yet.
    await playCorrect(state, 11);
    await playCorrect(state, 12);
    expect(getRanking(state)).toBe(4.5);
    expect(getStreak(state)).toBe(2);
    expect(recoveryRows(state)).toHaveLength(0);

    // Match 3: first cycle → +0.2 → 4.7.
    await playCorrect(state, 13);
    expect(getRanking(state)).toBe(4.7);
    expect(recoveryAmounts(state)).toEqual([0.2]);

    // Matches 4 & 5: holds at 4.7.
    await playCorrect(state, 14);
    await playCorrect(state, 15);
    expect(getRanking(state)).toBe(4.7);

    // Match 6: second cycle → +0.2 → 4.9.
    await playCorrect(state, 16);
    expect(getRanking(state)).toBe(4.9);
    expect(recoveryAmounts(state)).toEqual([0.2, 0.2]);

    // Matches 7 & 8: holds at 4.9.
    await playCorrect(state, 17);
    await playCorrect(state, 18);
    expect(getRanking(state)).toBe(4.9);

    // Match 9: final cycle restores only the leftover +0.1 → exactly 5.0.
    const res = await playCorrect(state, 19);
    expect(res.error).toBeNull();
    expect(res.data).toEqual(['user-3']);
    expect(getRanking(state)).toBe(5);
    expect(recoveryAmounts(state)).toEqual([0.2, 0.2, 0.1]);

    // Once the debt is cleared the ranking never climbs past the pre-penalty 5.0,
    // and the streak stops accumulating.
    const after = await playCorrect(state, 20);
    expect(after.data).toEqual([]);
    expect(getRanking(state)).toBe(5);
    expect(getStreak(state)).toBe(0);
    expect(recoveryRows(state)).toHaveLength(3);
  });

  test('no recovery before the first full 3-match cycle', async () => {
    const state = buildState({ penalties: 1, startRanking: 4.5 });
    mockSupabaseApi = buildSupabaseMock(state);

    await playCorrect(state, 11);
    expect(getStreak(state)).toBe(1);
    expect(recoveryRows(state)).toHaveLength(0);
    expect(getRanking(state)).toBe(4.5);
  });

  test('re-running the same cycle-closing match does not double-restore', async () => {
    const state = buildState({ penalties: 1, startRanking: 4.5 });
    mockSupabaseApi = buildSupabaseMock(state);

    await playCorrect(state, 11);
    await playCorrect(state, 12);
    await playCorrect(state, 13);
    expect(getRanking(state)).toBe(4.7);
    expect(recoveryRows(state)).toHaveLength(1);

    // Idempotent re-run of the same finalize: no new row, no extra ranking.
    const res = await playCorrect(state, 13);
    expect(res.error).toBeNull();
    expect(res.data).toEqual([]);
    expect(getRanking(state)).toBe(4.7);
    expect(recoveryRows(state)).toHaveLength(1);
  });

  test('a not-played (cancelled) match does not advance recovery', async () => {
    const state = buildState({ penalties: 1, startRanking: 4.5 });
    mockSupabaseApi = buildSupabaseMock(state);

    state.tables.post_match_surveys = [
      { partido_id: 11, votante_id: 1, se_jugo: false, motivo_no_jugado: 'weather_or_pitch', jugadores_ausentes: [] },
      { partido_id: 11, votante_id: 2, se_jugo: false, motivo_no_jugado: 'weather_or_pitch', jugadores_ausentes: [] },
    ];
    const res = await applyNoShowRecoveries(11, { emitNotifications: false });

    expect(res.error).toBeNull();
    expect(getStreak(state)).toBe(0);
    expect(recoveryRows(state)).toHaveLength(0);
    expect(getRanking(state)).toBe(4.5);
  });

  test('being marked absent again resets the streak and recovery resumes consistently', async () => {
    const state = buildState({ penalties: 1, startRanking: 4.5 });
    mockSupabaseApi = buildSupabaseMock(state);

    // Two correct matches build a streak of 2…
    await playCorrect(state, 11);
    await playCorrect(state, 12);
    expect(getStreak(state)).toBe(2);

    // …then user-3 (player id 3) is confirmed absent by 2 voters → streak resets,
    // ranking unchanged (no recovery awarded for this match).
    await playCorrect(state, 13, [3]);
    expect(getStreak(state)).toBe(0);
    expect(recoveryRows(state)).toHaveLength(0);
    expect(getRanking(state)).toBe(4.5);

    // Recovery resumes cleanly: three fresh correct matches earn the first +0.2.
    await playCorrect(state, 14);
    await playCorrect(state, 15);
    await playCorrect(state, 16);
    expect(getStreak(state)).toBe(3);
    expect(getRanking(state)).toBe(4.7);
    expect(recoveryAmounts(state)).toEqual([0.2]);
  });

  test('each cycle only restores up to the remaining debt (never over-restores stacked debt)', async () => {
    // Two penalties → ranking 4.0, debt 1.0. A single cycle still only gives +0.2.
    const state = buildState({ penalties: 2, startRanking: 4.0 });
    mockSupabaseApi = buildSupabaseMock(state);

    await playCorrect(state, 11);
    await playCorrect(state, 12);
    await playCorrect(state, 13);
    expect(getRanking(state)).toBe(4.2);
    expect(recoveryAmounts(state)).toEqual([0.2]);
  });
});

describe('penalty + gradual recovery, end to end', () => {
  test('a confirmed no-show drops 5.0 → 4.5, then 9 correct matches restore it to 5.0', async () => {
    // Start clean at 5.0 with no prior penalty rows; the penalty match (10) confirms
    // player 3 (user-3) absent via two voters.
    const matchIds = [10, ...NINE_MATCH_IDS];
    const state = buildState({ penalties: 0, startRanking: 5, matchIds });
    state.tables.usuarios.find((u) => u.id === 'user-3').partidos_abandonados = 0;
    mockSupabaseApi = buildSupabaseMock(state);

    state.tables.post_match_surveys = playedMatch(10, { absentPlayerIds: [3] });
    const pen = await applyNoShowPenalties(10, { emitNotifications: false });
    expect(pen.error).toBeNull();
    expect(getRanking(state)).toBe(4.5);
    expect(
      state.tables.rating_adjustments.filter((r) => r.user_id === 'user-3' && r.type === 'no_show_penalty'),
    ).toHaveLength(1);

    for (const id of NINE_MATCH_IDS) {
      await playCorrect(state, id);
    }
    expect(getRanking(state)).toBe(5);
    expect(recoveryAmounts(state)).toEqual([0.2, 0.2, 0.1]);
  });
});
