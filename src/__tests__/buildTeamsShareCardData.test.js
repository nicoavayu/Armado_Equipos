import buildTeamsShareCardData, {
  SHARE_CARD_TITLE,
  SHARE_CARD_WEBSITE,
} from '../utils/buildTeamsShareCardData';

const makeTeams = ({
  aName,
  bName,
  aPlayers = ['a1', 'a2', 'a3', 'a4', 'a5'],
  bPlayers = ['b1', 'b2', 'b3', 'b4', 'b5'],
} = {}) => ([
  { id: 'equipoA', name: aName, players: aPlayers, score: 12.34 },
  { id: 'equipoB', name: bName, players: bPlayers, score: 11.98 },
]);

// Simple resolver that just upper-cases the id so names are deterministic.
const nameById = (id) => `Jugador ${id}`;

describe('buildTeamsShareCardData', () => {
  test('builds the canonical title/website and Equipo A / Equipo B fallbacks', () => {
    const data = buildTeamsShareCardData(
      { modalidad: 'F5', fecha: '2026-06-21', hora: '21:00', sede: 'Cancha Norte' },
      makeTeams(),
      { resolvePlayerName: nameById },
    );

    expect(data.title).toBe(SHARE_CARD_TITLE);
    expect(data.website).toBe(SHARE_CARD_WEBSITE);
    expect(data.teamA.name).toBe('Equipo A');
    expect(data.teamB.name).toBe('Equipo B');
    expect(data.teamA.players).toEqual([
      'Jugador a1', 'Jugador a2', 'Jugador a3', 'Jugador a4', 'Jugador a5',
    ]);
    expect(data.isShareable).toBe(true);
  });

  test('uses custom team names when present', () => {
    const data = buildTeamsShareCardData(
      {},
      makeTeams({ aName: 'Los Galácticos', bName: '  Furia Roja  ' }),
      { resolvePlayerName: nameById },
    );

    expect(data.teamA.name).toBe('Los Galácticos');
    expect(data.teamB.name).toBe('Furia Roja'); // trimmed
  });

  test('formats date as dd/mm/yy and joins date · time', () => {
    const data = buildTeamsShareCardData(
      { modalidad: 'F7', fecha: '2026-06-21', hora: '21:30', sede: 'Club Sur' },
      makeTeams(),
      { resolvePlayerName: nameById },
    );

    expect(data.format).toBe('F7');
    expect(data.date).toBe('21/06/26');
    expect(data.time).toBe('21:30');
    expect(data.dateTime).toBe('21/06/26 · 21:30');
    expect(data.venue).toBe('Club Sur');
  });

  test('shortens long venue addresses to the place name block', () => {
    const data = buildTeamsShareCardData(
      { sede: 'La Terraza Fútbol 5, Av. Siempreviva 742, C1406 CABA, Buenos Aires, Argentina' },
      makeTeams(),
      { resolvePlayerName: nameById },
    );

    expect(data.venue).toBe('La Terraza Fútbol 5');
  });

  test('prefers an explicit venue name over the address', () => {
    const data = buildTeamsShareCardData(
      { venue_name: 'Ateneo Félix Marino', sede: 'Av. Directorio 2454, CABA, Argentina' },
      makeTeams(),
      { resolvePlayerName: nameById },
    );

    expect(data.venue).toBe('Ateneo Félix Marino');
  });

  test('tolerates empty date, time, venue and format (null, never throws)', () => {
    const data = buildTeamsShareCardData(
      { modalidad: '', fecha: '', hora: '', sede: '' },
      makeTeams(),
      { resolvePlayerName: nameById },
    );

    expect(data.format).toBeNull();
    expect(data.date).toBeNull();
    expect(data.time).toBeNull();
    expect(data.dateTime).toBeNull();
    expect(data.venue).toBeNull();
    expect(data.isShareable).toBe(true);
  });

  test('keeps long player names intact (no truncation in data)', () => {
    const longName = 'Juan Sebastián Verón de la Cruz Martínez';
    const data = buildTeamsShareCardData(
      {},
      makeTeams({ aPlayers: ['x'] }),
      { resolvePlayerName: () => longName },
    );

    expect(data.teamA.players[0]).toBe(longName);
  });

  test('does not depend on scores / promedios (no score in output)', () => {
    const data = buildTeamsShareCardData({}, makeTeams(), { resolvePlayerName: nameById });
    const serialized = JSON.stringify(data);

    expect(serialized).not.toContain('score');
    expect(serialized).not.toContain('12.34');
    expect(data.teamA).not.toHaveProperty('score');
  });

  test('supports F5 through F11 squad sizes', () => {
    const f5 = buildTeamsShareCardData({}, makeTeams(), { resolvePlayerName: nameById });
    expect(f5.maxTeamSize).toBe(5);
    expect(f5.totalPlayers).toBe(10);

    const elevenA = Array.from({ length: 11 }, (_, i) => `a${i}`);
    const elevenB = Array.from({ length: 11 }, (_, i) => `b${i}`);
    const f11 = buildTeamsShareCardData(
      { modalidad: 'F11' },
      makeTeams({ aPlayers: elevenA, bPlayers: elevenB }),
      { resolvePlayerName: nameById },
    );
    expect(f11.maxTeamSize).toBe(11);
    expect(f11.totalPlayers).toBe(22);
    expect(f11.teamA.players).toHaveLength(11);
    expect(f11.isShareable).toBe(true);
  });

  test('falls back to positional teams when ids are missing', () => {
    const data = buildTeamsShareCardData(
      {},
      [
        { name: 'Rojo', players: ['p1'] },
        { name: 'Azul', players: ['p2'] },
      ],
      { resolvePlayerName: nameById },
    );

    expect(data.teamA.name).toBe('Rojo');
    expect(data.teamB.name).toBe('Azul');
  });

  test('is not shareable when a team is missing or empty', () => {
    const onlyOne = buildTeamsShareCardData(
      {},
      [{ id: 'equipoA', name: 'Solo', players: ['p1'] }],
      { resolvePlayerName: nameById },
    );
    expect(onlyOne.isShareable).toBe(false);

    const emptyTeam = buildTeamsShareCardData(
      {},
      makeTeams({ bPlayers: [] }),
      { resolvePlayerName: nameById },
    );
    expect(emptyTeam.isShareable).toBe(false);
  });

  test('drops player ids that resolve to empty names', () => {
    const data = buildTeamsShareCardData(
      {},
      makeTeams({ aPlayers: ['p1', 'missing', 'p3'] }),
      { resolvePlayerName: (id) => (id === 'missing' ? '' : `N-${id}`) },
    );

    expect(data.teamA.players).toEqual(['N-p1', 'N-p3']);
  });
});
