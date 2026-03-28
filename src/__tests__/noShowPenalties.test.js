let mockSupabaseApi = null;

jest.mock('../lib/supabaseClient', () => ({
  supabase: {
    from: (...args) => mockSupabaseApi.from(...args),
    rpc: (...args) => mockSupabaseApi.rpc(...args),
  },
}));

const { applyNoShowPenalties, listMatchNoShowSummary } = require('../services/db/penalties');

const clone = (value) => JSON.parse(JSON.stringify(value));

class QueryBuilder {
  constructor({ state, table }) {
    this.state = state;
    this.table = table;
    this.action = null;
    this.payload = null;
    this.filters = [];
    this.expectSingle = false;
    this.expectMaybeSingle = false;
  }

  select(_columns, _options = {}) {
    if (this.action === 'insert') return this;
    this.action = 'select';
    return this;
  }

  insert(payload) {
    this.action = 'insert';
    this.payload = Array.isArray(payload) ? payload : [payload];
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
    const selectedRows = rows.filter((row) => this.matches(row));

    if (this.action === 'select') {
      if (this.expectSingle) {
        return { data: clone(selectedRows[0] || null), error: null };
      }
      if (this.expectMaybeSingle) {
        return { data: clone(selectedRows[0] || null), error: null };
      }
      return { data: clone(selectedRows), error: null };
    }

    if (this.action === 'insert') {
      const nextRows = this.payload.map((row, index) => ({
        id: row?.id ?? `${this.table}-${rows.length + index + 1}`,
        ...row,
      }));
      this.state.tables[this.table] = [...rows, ...nextRows];
      return { data: clone(nextRows), error: null };
    }

    return { data: null, error: null };
  }
}

const buildState = (overrides = {}) => ({
  tables: {
    partidos: [{ id: 10, nombre: 'Partido test' }],
    post_match_surveys: [],
    jugadores: [],
    usuarios: [],
    rating_adjustments: [],
    notifications: [],
    ...clone(overrides),
  },
});

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

    const row = (state.tables.usuarios || []).find((user) => String(user?.id) === String(userId));
    if (!row) return { error: new Error('user_not_found') };

    if (fnName === 'dec_numeric') {
      row[column] = Number(row[column] || 0) - amount;
      return { error: null };
    }

    if (fnName === 'inc_numeric') {
      row[column] = Number(row[column] || 0) + amount;
      return { error: null };
    }

    return { error: null };
  }),
});

const baseState = (surveyOverrides = []) => buildState({
  post_match_surveys: surveyOverrides,
  jugadores: [
    { id: 1, partido_id: 10, usuario_id: 'user-1' },
    { id: 2, partido_id: 10, usuario_id: 'user-2' },
    { id: 3, partido_id: 10, usuario_id: 'user-3' },
  ],
  usuarios: [
    { id: 'user-1', ranking: 5, partidos_abandonados: 0 },
    { id: 'user-2', ranking: 5, partidos_abandonados: 0 },
    { id: 'user-3', ranking: 5, partidos_abandonados: 0 },
  ],
});

describe('applyNoShowPenalties', () => {
  let state = null;

  beforeEach(() => {
    state = buildState();
    mockSupabaseApi = buildSupabaseMock(state);
  });

  test('penaliza ausencia sin aviso aunque se_jugo sea false', async () => {
    state = baseState([
      { partido_id: 10, votante_id: 1, se_jugo: false, motivo_no_jugado: 'absence_without_notice', jugadores_ausentes: [3] },
      { partido_id: 10, votante_id: 2, se_jugo: false, motivo_no_jugado: 'absence_without_notice', jugadores_ausentes: [3] },
    ]);
    mockSupabaseApi = buildSupabaseMock(state);

    const result = await applyNoShowPenalties(10, { emitNotifications: false });

    expect(result.error).toBeNull();
    expect(result.data).toEqual(['user-3']);
    expect(state.tables.rating_adjustments).toHaveLength(1);
    expect(state.tables.rating_adjustments[0]).toMatchObject({
      user_id: 'user-3',
      partido_id: 10,
      type: 'no_show_penalty',
      amount: -0.5,
    });
    expect(state.tables.usuarios.find((row) => row.id === 'user-3')).toMatchObject({
      ranking: 4.5,
      partidos_abandonados: 1,
    });
  });

  test('no penaliza si no se jugó por clima o cancha', async () => {
    state = baseState([
      { partido_id: 10, votante_id: 1, se_jugo: false, motivo_no_jugado: 'weather_or_pitch', jugadores_ausentes: [3] },
      { partido_id: 10, votante_id: 2, se_jugo: false, motivo_no_jugado: 'weather_or_pitch', jugadores_ausentes: [3] },
    ]);
    mockSupabaseApi = buildSupabaseMock(state);

    const result = await applyNoShowPenalties(10, { emitNotifications: false });

    expect(result.error).toBeNull();
    expect(result.data).toEqual([]);
    expect(state.tables.rating_adjustments).toHaveLength(0);
    expect(state.tables.usuarios.find((row) => row.id === 'user-3')).toMatchObject({
      ranking: 5,
      partidos_abandonados: 0,
    });
  });

  test('no penaliza si no se jugó por problemas de organización', async () => {
    state = baseState([
      { partido_id: 10, votante_id: 1, se_jugo: false, motivo_no_jugado: 'organization_issues', jugadores_ausentes: [3] },
      { partido_id: 10, votante_id: 2, se_jugo: false, motivo_no_jugado: 'organization_issues', jugadores_ausentes: [3] },
    ]);
    mockSupabaseApi = buildSupabaseMock(state);

    const result = await applyNoShowPenalties(10, { emitNotifications: false });

    expect(result.error).toBeNull();
    expect(result.data).toEqual([]);
    expect(state.tables.rating_adjustments).toHaveLength(0);
    expect(state.tables.usuarios.find((row) => row.id === 'user-3')).toMatchObject({
      ranking: 5,
      partidos_abandonados: 0,
    });
  });

  test('mantiene el caso existente de partido jugado con ausencias', async () => {
    state = baseState([
      { partido_id: 10, votante_id: 1, se_jugo: true, motivo_no_jugado: null, jugadores_ausentes: [3] },
      { partido_id: 10, votante_id: 2, se_jugo: true, motivo_no_jugado: null, jugadores_ausentes: [3] },
    ]);
    mockSupabaseApi = buildSupabaseMock(state);

    const result = await applyNoShowPenalties(10, { emitNotifications: false });

    expect(result.error).toBeNull();
    expect(result.data).toEqual(['user-3']);
    expect(state.tables.rating_adjustments).toHaveLength(1);
    expect(state.tables.usuarios.find((row) => row.id === 'user-3')).toMatchObject({
      ranking: 4.5,
      partidos_abandonados: 1,
    });
  });
});

describe('listMatchNoShowSummary', () => {
  let state = null;

  beforeEach(() => {
    state = buildState();
    mockSupabaseApi = buildSupabaseMock(state);
  });

  test('resume la ausencia confirmada y la penalidad aplicada para el partido', async () => {
    state = baseState([
      { partido_id: 10, votante_id: 1, se_jugo: true, motivo_no_jugado: null, jugadores_ausentes: [3] },
      { partido_id: 10, votante_id: 2, se_jugo: true, motivo_no_jugado: null, jugadores_ausentes: [3] },
    ]);
    state.tables.rating_adjustments = [
      { user_id: 'user-3', partido_id: 10, type: 'no_show_penalty', amount: -0.5 },
    ];
    mockSupabaseApi = buildSupabaseMock(state);

    const result = await listMatchNoShowSummary(10);

    expect(result.error).toBeNull();
    expect(result.data).toEqual([
      {
        playerId: 3,
        userId: 'user-3',
        confirmationCount: 2,
        penaltyApplied: true,
        penaltyAmount: -0.5,
        recoveryApplied: false,
      },
    ]);
  });

  test('no devuelve ausencias si el partido no fue elegible para penalidad', async () => {
    state = baseState([
      { partido_id: 10, votante_id: 1, se_jugo: false, motivo_no_jugado: 'weather_or_pitch', jugadores_ausentes: [3] },
      { partido_id: 10, votante_id: 2, se_jugo: false, motivo_no_jugado: 'weather_or_pitch', jugadores_ausentes: [3] },
    ]);
    mockSupabaseApi = buildSupabaseMock(state);

    const result = await listMatchNoShowSummary(10);

    expect(result.error).toBeNull();
    expect(result.data).toEqual([]);
  });
});
