import buildMatchSummaryShareCardData, {
  MATCH_SUMMARY_CARD_TITLE,
  canShareMatchSummary,
  canShowSurveyResultsSummary,
  getWinnerDisplayLabel,
  getShortVenueLabel,
  normalizeResultStatus,
  normalizeWinnerTeam,
} from '../utils/matchSummaryShare';
import { SHARE_CARD_WEBSITE } from '../utils/buildTeamsShareCardData';

const roster = [
  { id: 1, uuid: 'uuid-1', usuario_id: 'user-1', nombre: 'Nico' },
  { id: 2, uuid: 'uuid-2', usuario_id: 'user-2', nombre: 'Rama' },
  { id: 3, uuid: 'uuid-3', usuario_id: 'user-3', nombre: 'Lucho' },
  { id: 4, uuid: 'uuid-4', usuario_id: 'user-4', nombre: 'Tomi' },
];

const readyResults = (overrides = {}) => ({
  results_ready: true,
  awards_status: 'ready',
  mvp: 'uuid-1',
  mvp_nombre: 'Nico',
  golden_glove: 'uuid-2',
  golden_glove_nombre: 'Rama',
  winner_team: 'A',
  result_status: 'finished',
  scoreline: '3-2',
  ...overrides,
});

const basePartido = (overrides = {}) => ({
  nombre: 'Jueves F5',
  fecha: '2026-06-25',
  hora: '21:00',
  modalidad: 'F5',
  sede: 'La Terraza Fútbol 5, Av. Siempreviva 742, Buenos Aires, Argentina',
  survey_team_a: ['uuid-1', 'uuid-2'],
  survey_team_b: ['uuid-3', 'uuid-4'],
  ...overrides,
});

describe('canShareMatchSummary', () => {
  test('true only with ready results that carry real award data', () => {
    expect(canShareMatchSummary(readyResults())).toBe(true);
  });

  test('false when results are missing or not ready', () => {
    expect(canShareMatchSummary(null)).toBe(false);
    expect(canShareMatchSummary(readyResults({ results_ready: false }))).toBe(false);
  });

  test('false when awards are not eligible (not enough votes)', () => {
    expect(canShareMatchSummary(readyResults({ awards_status: 'not_eligible', awards_generated: false }))).toBe(false);
    expect(canShareMatchSummary(readyResults({ awards_status: 'insufficient_voters', awards_generated: false }))).toBe(false);
  });

  test('valid persisted awards remain shareable when the optional status lags', () => {
    expect(canShareMatchSummary(readyResults({ awards_status: 'pending', awards_generated: false }))).toBe(true);
    expect(canShareMatchSummary(readyResults({ awards_status: null, awards_generated: false }))).toBe(true);
  });

  test('errored awards are not shareable', () => {
    expect(canShareMatchSummary(readyResults({ awards_status: 'failed', awards_generated: false }))).toBe(false);
  });

  test('false when there is no award payload at all', () => {
    expect(canShareMatchSummary({
      results_ready: true,
      awards_status: 'ready',
    })).toBe(false);
  });

  test('canShowSurveyResultsSummary is the same gate', () => {
    expect(canShowSurveyResultsSummary).toBe(canShareMatchSummary);
  });
});

describe('normalizers', () => {
  test('winner team accepts service aliases', () => {
    expect(normalizeWinnerTeam('a')).toBe('A');
    expect(normalizeWinnerTeam('team_b')).toBe('B');
    expect(normalizeWinnerTeam('x')).toBeNull();
    expect(normalizeWinnerTeam('')).toBeNull();
  });

  test('result status accepts service aliases', () => {
    expect(normalizeResultStatus('finished')).toBe('finished');
    expect(normalizeResultStatus('empate')).toBe('draw');
    expect(normalizeResultStatus('no_jugado')).toBe('not_played');
    expect(normalizeResultStatus('???')).toBeNull();
  });
});

describe('getShortVenueLabel', () => {
  test('keeps short venue names as-is', () => {
    expect(getShortVenueLabel({ sede: 'La Terraza Fútbol 5' })).toBe('La Terraza Fútbol 5');
  });

  test('reduces a long address to its first meaningful block', () => {
    const label = getShortVenueLabel({
      sede: 'Ateneo Félix Marino, Av. Directorio 2454, C1406 CABA, Buenos Aires, Argentina',
    });
    expect(label).toBe('Ateneo Félix Marino');
  });

  test('returns null when there is nothing usable', () => {
    expect(getShortVenueLabel({ sede: '' })).toBeNull();
    expect(getShortVenueLabel({})).toBeNull();
  });
});

describe('getWinnerDisplayLabel', () => {
  test('prefers a real persisted team name', () => {
    expect(getWinnerDisplayLabel({
      equipos_json: [
        { id: 'equipoA', name: 'Aston Birra', players: ['uuid-1'] },
        { id: 'equipoB', name: 'Los Troncos', players: ['uuid-3'] },
      ],
    }, 'B', roster)).toBe('Ganó Los Troncos');
  });

  test('falls back to the first winning player, never Equipo A/B', () => {
    const label = getWinnerDisplayLabel(basePartido(), 'B', roster);
    expect(label).toBe('Victoria del equipo de Lucho');
    expect(label).not.toMatch(/equipo [ab]$/i);
  });

  test('uses a human fallback when the winning roster is unavailable', () => {
    expect(getWinnerDisplayLabel({}, 'A', [])).toBe('Victoria confirmada');
  });
});

describe('buildMatchSummaryShareCardData', () => {
  test('builds a full shareable summary (winner, teams, awards, short venue)', () => {
    const data = buildMatchSummaryShareCardData({
      partido: basePartido(),
      results: readyResults(),
      jugadores: roster,
    });

    expect(data.title).toBe(MATCH_SUMMARY_CARD_TITLE);
    expect(data.website).toBe(SHARE_CARD_WEBSITE);
    expect(data.matchName).toBe('Jueves F5');
    expect(data.format).toBe('F5');
    expect(data.dateTime).toBe('25/06/26 · 21:00');
    expect(data.venue).toBe('La Terraza Fútbol 5');

    expect(data.result).toEqual({
      outcome: 'winner',
      winnerTeam: 'A',
      heading: 'EQUIPO GANADOR',
      players: ['Nico', 'Rama'],
      label: 'Nico · Rama',
      scoreline: '3-2',
    });

    expect(data.teams.teamA.players).toEqual(['Nico', 'Rama']);
    expect(data.teams.teamB.players).toEqual(['Lucho', 'Tomi']);
    expect(data.maxTeamSize).toBe(2);

    expect(data.awards).toEqual([
      expect.objectContaining({ kind: 'mvp', label: 'MVP', playerName: 'Nico' }),
      expect.objectContaining({ kind: 'glove', label: 'MEJOR ARQUERO', playerName: 'Rama' }),
    ]);
    expect(data.isShareable).toBe(true);
  });

  test('draw is reported as EMPATE without inventing a winner', () => {
    const data = buildMatchSummaryShareCardData({
      partido: basePartido(),
      results: readyResults({ result_status: 'draw', winner_team: null, scoreline: null }),
      jugadores: roster,
    });

    expect(data.result).toEqual({
      outcome: 'draw',
      winnerTeam: null,
      heading: null,
      players: [],
      label: 'EMPATE',
      scoreline: null,
    });
  });

  test('no recorded result -> result section omitted (never invented)', () => {
    const data = buildMatchSummaryShareCardData({
      partido: basePartido(),
      results: readyResults({ result_status: 'pending', winner_team: null }),
      jugadores: roster,
    });
    expect(data.result).toBeNull();
    // Awards still exist, so the summary remains shareable.
    expect(data.isShareable).toBe(true);
  });

  test('finished without winner does not invent one', () => {
    const data = buildMatchSummaryShareCardData({
      partido: basePartido(),
      results: readyResults({ result_status: 'finished', winner_team: null }),
      jugadores: roster,
    });
    expect(data.result).toBeNull();
  });

  test('falls back to final_team_a/b when survey teams are missing', () => {
    const data = buildMatchSummaryShareCardData({
      partido: basePartido({
        survey_team_a: [],
        survey_team_b: [],
        final_team_a: ['user-1', 'user-3'],
        final_team_b: ['user-2', 'user-4'],
      }),
      results: readyResults(),
      jugadores: roster,
    });

    expect(data.teams.teamA.players).toEqual(['Nico', 'Lucho']);
    expect(data.teams.teamB.players).toEqual(['Rama', 'Tomi']);
  });

  test('the share result lists winning players even when the team has a real name', () => {
    const data = buildMatchSummaryShareCardData({
      partido: basePartido({
        equipos_json: [
          { id: 'equipoA', name: 'Aston Birra', players: ['uuid-1', 'uuid-2'] },
          { id: 'equipoB', name: 'Los Troncos', players: ['uuid-3', 'uuid-4'] },
        ],
      }),
      results: readyResults({ winner_team: 'B' }),
      jugadores: roster,
    });

    expect(data.result.label).toBe('Lucho · Tomi');
    expect(data.result.players).toEqual(['Lucho', 'Tomi']);
    expect(data.teams.teamA.name).toBe('Aston Birra');
    expect(data.teams.teamB.name).toBe('Los Troncos');
  });

  test('keeps five winning names in roster order for the wrapped result block', () => {
    const extendedRoster = [
      ...roster,
      { id: 5, uuid: 'uuid-5', usuario_id: 'user-5', nombre: 'Fede' },
      { id: 6, uuid: 'uuid-6', usuario_id: 'user-6', nombre: 'Juan Pablo Largo' },
      { id: 7, uuid: 'uuid-7', usuario_id: 'user-7', nombre: 'Mati' },
    ];
    const data = buildMatchSummaryShareCardData({
      partido: basePartido({
        survey_team_a: ['uuid-1', 'uuid-2', 'uuid-5', 'uuid-6', 'uuid-7'],
        survey_team_b: ['uuid-3', 'uuid-4'],
      }),
      results: readyResults(),
      jugadores: extendedRoster,
    });

    expect(data.result.players).toEqual(['Nico', 'Rama', 'Fede', 'Juan Pablo Largo', 'Mati']);
    expect(data.result.label).toBe('Nico · Rama · Fede · Juan Pablo Largo · Mati');
  });

  test('uses a human fallback when the winning roster is unavailable', () => {
    const data = buildMatchSummaryShareCardData({
      partido: basePartido({ survey_team_a: [], survey_team_b: [] }),
      results: readyResults(),
      jugadores: roster,
    });

    expect(data.result).toEqual({
      outcome: 'winner',
      winnerTeam: 'A',
      heading: null,
      players: [],
      label: 'Victoria confirmada',
      scoreline: '3-2',
    });
  });

  test('optional match metadata and photos do not block sharing', () => {
    const data = buildMatchSummaryShareCardData({
      partido: basePartido({
        nombre: null,
        fecha: null,
        hora: null,
        modalidad: null,
        sede: null,
      }),
      results: readyResults({ awards_status: 'pending', awards_generated: false }),
      jugadores: roster.map((player) => ({ ...player, avatar_url: null })),
    });

    expect(data.isShareable).toBe(true);
    expect(data.awards[0]).toEqual(expect.objectContaining({
      playerName: 'Nico',
      playerAvatarUrl: null,
      playerInitial: 'N',
    }));
  });

  test('teams section omitted when no split exists (no fake rosters)', () => {
    const data = buildMatchSummaryShareCardData({
      partido: basePartido({ survey_team_a: [], survey_team_b: [] }),
      results: readyResults(),
      jugadores: roster,
    });

    expect(data.teams).toBeNull();
    expect(data.maxTeamSize).toBe(0);
    expect(data.isShareable).toBe(true); // result + awards still real
  });

  test('only real awards are included (no empty entries)', () => {
    const data = buildMatchSummaryShareCardData({
      partido: basePartido(),
      results: readyResults({ golden_glove: null, golden_glove_nombre: null }),
      jugadores: roster,
    });

    expect(data.awards.map((a) => a.kind)).toEqual(['mvp']);
  });

  test('award name falls back to the roster when *_nombre is missing', () => {
    const data = buildMatchSummaryShareCardData({
      partido: basePartido(),
      results: readyResults({ mvp_nombre: null }),
      jugadores: roster,
    });

    expect(data.awards[0]).toEqual(expect.objectContaining({ kind: 'mvp', playerName: 'Nico' }));
  });

  test('dirty player award resolves from red_cards fallback', () => {
    const data = buildMatchSummaryShareCardData({
      partido: basePartido(),
      results: readyResults({ dirty_player: null, red_cards: ['uuid-3'] }),
      jugadores: roster,
    });

    expect(data.awards.map((a) => a.kind)).toContain('dirty');
    expect(data.awards.find((a) => a.kind === 'dirty').playerName).toBe('Lucho');
  });

  test('not shareable when results are not valid, even with teams', () => {
    const data = buildMatchSummaryShareCardData({
      partido: basePartido(),
      results: readyResults({ awards_status: 'not_eligible', awards_generated: false }),
      jugadores: roster,
    });
    expect(data.isShareable).toBe(false);
  });

  test('never throws on empty input', () => {
    const data = buildMatchSummaryShareCardData();
    expect(data.isShareable).toBe(false);
    expect(data.result).toBeNull();
    expect(data.teams).toBeNull();
    expect(data.awards).toEqual([]);
  });

  test('awards carry avatar url when the roster has one, initial fallback otherwise', () => {
    const data = buildMatchSummaryShareCardData({
      partido: basePartido(),
      results: readyResults(),
      jugadores: [
        { ...roster[0], avatar_url: 'https://cdn/avatars/nico.png' },
        ...roster.slice(1),
      ],
    });

    const mvp = data.awards.find((a) => a.kind === 'mvp');
    expect(mvp.playerAvatarUrl).toBe('https://cdn/avatars/nico.png');
    expect(mvp.playerInitial).toBe('N');

    const glove = data.awards.find((a) => a.kind === 'glove');
    expect(glove.playerAvatarUrl).toBeNull();
    expect(glove.playerInitial).toBe('R');
  });

  test('applied penalties join the awards mosaic as PENALIZACIÓN blocks', () => {
    const data = buildMatchSummaryShareCardData({
      partido: basePartido(),
      results: readyResults(),
      jugadores: roster,
      penalized: [
        { penaltyApplied: true, nombre: 'Tomi', usuario_id: 'user-4', avatar_url: null },
        { penaltyApplied: false, nombre: 'Lucho', usuario_id: 'user-3' },
      ],
    });

    const penaltyBlocks = data.awards.filter((a) => a.kind === 'penalty');
    expect(penaltyBlocks).toHaveLength(1);
    expect(penaltyBlocks[0]).toEqual(expect.objectContaining({
      label: 'PENALIZACIÓN',
      playerName: 'Tomi',
      playerInitial: 'T',
    }));
  });

  test('teams alone no longer make the piece shareable (social layout leads with result/awards)', () => {
    const data = buildMatchSummaryShareCardData({
      partido: basePartido(),
      results: readyResults({
        mvp: null,
        mvp_nombre: null,
        golden_glove: null,
        golden_glove_nombre: null,
        result_status: 'pending',
        winner_team: null,
        // hasAnyAwardData still true via red_cards, but nothing resolves.
        red_cards: [],
        awards_generated: true,
      }),
      jugadores: roster,
    });

    expect(data.teams).not.toBeNull();
    expect(data.awards).toEqual([]);
    expect(data.result).toBeNull();
    expect(data.isShareable).toBe(false);
  });
});
