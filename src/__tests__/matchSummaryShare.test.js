import buildMatchSummaryShareCardData, {
  MATCH_SUMMARY_CARD_TITLE,
  canShareMatchSummary,
  canShowSurveyResultsSummary,
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

  test('false while awards are still pending or errored', () => {
    expect(canShareMatchSummary(readyResults({ awards_status: 'pending', awards_generated: false }))).toBe(false);
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
      label: 'GANÓ EQUIPO A',
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
});
