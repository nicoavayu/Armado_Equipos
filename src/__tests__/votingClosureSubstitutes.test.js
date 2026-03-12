let mockSupabaseApi = null;

jest.mock('../lib/supabaseClient', () => ({
  supabase: {
    from: (...args) => mockSupabaseApi.from(...args),
    rpc: (...args) => mockSupabaseApi.rpc(...args),
  },
}));

const { closeVotingAndCalculateScores, removePlayerVotesFromMatch } = require('../services/db/matches');

const clone = (value) => JSON.parse(JSON.stringify(value));

class QueryBuilder {
  constructor({ state, table }) {
    this.state = state;
    this.table = table;
    this.action = null;
    this.payload = null;
    this.selectOptions = null;
    this.filters = [];
  }

  select(_columns, options = {}) {
    this.action = 'select';
    this.selectOptions = options || {};
    return this;
  }

  update(payload) {
    this.action = 'update';
    this.payload = payload || {};
    return this;
  }

  delete() {
    this.action = 'delete';
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
      if (this.selectOptions?.head && this.selectOptions?.count === 'exact') {
        return { data: null, error: null, count: selectedRows.length };
      }
      return { data: clone(selectedRows), error: null };
    }

    if (this.action === 'update') {
      selectedRows.forEach((row) => Object.assign(row, this.payload || {}));
      this.state.updates.push({
        table: this.table,
        filters: clone(this.filters),
        payload: clone(this.payload || {}),
        affected: selectedRows.map((row) => row.uuid || row.id),
      });
      return { data: clone(selectedRows), error: null };
    }

    if (this.action === 'delete') {
      const remaining = [];
      const removed = [];
      rows.forEach((row) => {
        if (this.matches(row)) removed.push(row);
        else remaining.push(row);
      });
      this.state.tables[this.table] = remaining;
      this.state.deletes.push({
        table: this.table,
        filters: clone(this.filters),
        removed: removed.map((row) => row.id ?? row.uuid ?? null),
      });
      return { data: clone(removed), error: null };
    }

    return { data: null, error: null };
  }
}

const buildState = (overrides = {}) => ({
  tables: {
    votos: [],
    votos_publicos: [],
    public_voters: [],
    jugadores: [],
    ...clone(overrides),
  },
  updates: [],
  deletes: [],
});

const buildSupabaseMock = (state) => ({
  from: jest.fn((table) => new QueryBuilder({ state, table })),
  rpc: jest.fn(),
});

const baseRoster = ({ sub3 = true, sub2 = false } = {}) => ([
  {
    id: 1,
    partido_id: 500,
    uuid: 'uuid-1',
    usuario_id: 'user-1',
    nombre: 'Titular 1',
    is_goalkeeper: false,
    is_substitute: false,
    score: 5,
  },
  {
    id: 2,
    partido_id: 500,
    uuid: 'uuid-2',
    usuario_id: 'user-2',
    nombre: 'Titular 2',
    is_goalkeeper: false,
    is_substitute: Boolean(sub2),
    score: 5,
  },
  {
    id: 3,
    partido_id: 500,
    uuid: 'uuid-3',
    usuario_id: 'user-3',
    nombre: 'Suplente 3',
    is_goalkeeper: false,
    is_substitute: Boolean(sub3),
    score: 5,
  },
]);

describe('closeVotingAndCalculateScores - suplentes', () => {
  let state = null;

  beforeEach(() => {
    state = buildState();
    mockSupabaseApi = buildSupabaseMock(state);
  });

  test('suplente vota y no bloquea cierre', async () => {
    state.tables.jugadores = baseRoster({ sub3: true });
    state.tables.votos = [
      { id: 101, partido_id: 500, votante_id: 'user-3', votado_id: 'user-1', puntaje: 9 },
    ];

    const result = await closeVotingAndCalculateScores(500);

    expect(result.playersTotal).toBe(2);
    expect(result.votesProcessed).toBe(0);
    expect(state.updates.filter((u) => u.table === 'jugadores')).toHaveLength(2);
  });

  test('votos de suplentes no entran al score (solo titulares)', async () => {
    state.tables.jugadores = baseRoster({ sub3: true });
    state.tables.votos = [
      { id: 102, partido_id: 500, votante_id: 'user-2', votado_id: 'user-1', puntaje: 10 },
      { id: 103, partido_id: 500, votante_id: 'user-3', votado_id: 'user-1', puntaje: 1 },
    ];

    await closeVotingAndCalculateScores(500);

    const titularUno = state.tables.jugadores.find((player) => player.uuid === 'uuid-1');
    expect(titularUno.score).toBe(10);
  });

  test('jugador que pasa de titular a suplente deja de contar', async () => {
    state.tables.jugadores = baseRoster({ sub2: true, sub3: true });
    state.tables.votos = [
      { id: 104, partido_id: 500, votante_id: 'user-2', votado_id: 'user-1', puntaje: 8 },
    ];

    await closeVotingAndCalculateScores(500);

    const titularUno = state.tables.jugadores.find((player) => player.uuid === 'uuid-1');
    expect(titularUno.score).toBe(5);
  });

  test('jugador que pasa de suplente a titular vuelve a contar', async () => {
    state.tables.jugadores = baseRoster({ sub3: false });
    state.tables.votos = [
      { id: 105, partido_id: 500, votante_id: 'user-3', votado_id: 'user-1', puntaje: 7 },
    ];

    await closeVotingAndCalculateScores(500);

    const titularUno = state.tables.jugadores.find((player) => player.uuid === 'uuid-1');
    expect(titularUno.score).toBe(7);
  });
});

describe('removePlayerVotesFromMatch - expulsión sin reset global', () => {
  let state = null;

  beforeEach(() => {
    state = buildState({
      votos: [
        { id: 201, partido_id: 500, votante_id: 'user-3', votado_id: 'user-1', puntaje: 8 },
        { id: 202, partido_id: 500, votante_id: 'user-1', votado_id: 'user-3', puntaje: 4 },
        { id: 203, partido_id: 500, votante_id: 'user-2', votado_id: 'user-1', puntaje: 9 },
      ],
      votos_publicos: [
        { id: 301, partido_id: 500, votado_id: 'user-3', puntaje: 5 },
        { id: 302, partido_id: 500, votado_id: 'user-1', puntaje: 6 },
      ],
    });
    mockSupabaseApi = buildSupabaseMock(state);
  });

  test('limpia solo votos asociados al expulsado y no exige reset global', async () => {
    const removed = await removePlayerVotesFromMatch(500, {
      id: 3,
      uuid: 'uuid-3',
      usuario_id: 'user-3',
      is_substitute: true,
    });

    expect(removed.ok).toBe(true);
    expect(state.tables.votos.map((row) => row.id)).toEqual([203]);
    expect(state.tables.votos_publicos.map((row) => row.id)).toEqual([302]);
    expect(mockSupabaseApi.rpc).not.toHaveBeenCalled();
  });
});
