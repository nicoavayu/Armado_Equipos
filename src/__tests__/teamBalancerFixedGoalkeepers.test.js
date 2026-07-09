import { buildBalancedTeams } from '../utils/teamBalancer';

const buildPlayers = (scores) => scores.map((score, index) => ({
  id: index + 1,
  uuid: `player-${index + 1}`,
  nombre: `Jugador ${index + 1}`,
  score,
  is_substitute: false,
}));

const findTeamOf = (result, playerKey) => (
  result.teams.find((team) => team.players.includes(playerKey))
);

describe('buildBalancedTeams fixed goalkeepers rule', () => {
  test('sin arqueros: el armado y la diferencia funcionan igual que antes', () => {
    const players = buildPlayers([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const baseline = buildBalancedTeams({ players });
    const withEmptyGoalkeepers = buildBalancedTeams({ players, fixedGoalkeepers: [] });

    expect(withEmptyGoalkeepers).toEqual(baseline);
    // Todos los puntajes cuentan: 55 total, mejor partición 27/28
    expect(baseline.teams[0].score + baseline.teams[1].score).toBe(55);
    expect(baseline.diff).toBe(1);
  });

  test('un solo arquero: no se activa la regla y su puntaje cuenta', () => {
    const players = buildPlayers([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const baseline = buildBalancedTeams({ players });
    const withOneGoalkeeper = buildBalancedTeams({ players, fixedGoalkeepers: ['player-10'] });

    expect(withOneGoalkeeper).toEqual(baseline);
    expect(withOneGoalkeeper.teams[0].score + withOneGoalkeeper.teams[1].score).toBe(55);
  });

  test('un arquero seleccionado + uno inexistente: tampoco activa la regla', () => {
    const players = buildPlayers([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const baseline = buildBalancedTeams({ players });
    const result = buildBalancedTeams({
      players,
      fixedGoalkeepers: ['player-10', 'no-existe'],
    });

    expect(result).toEqual(baseline);
  });

  test('dos arqueros: quedan separados uno por equipo', () => {
    const players = buildPlayers([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const result = buildBalancedTeams({
      players,
      fixedGoalkeepers: ['player-1', 'player-10'],
    });

    const teamOfGkOne = findTeamOf(result, 'player-1');
    const teamOfGkTwo = findTeamOf(result, 'player-10');
    expect(teamOfGkOne).toBeDefined();
    expect(teamOfGkTwo).toBeDefined();
    expect(teamOfGkOne.id).not.toBe(teamOfGkTwo.id);
    expect(result.teams[0].players).toHaveLength(5);
    expect(result.teams[1].players).toHaveLength(5);
  });

  test('dos arqueros: sus puntajes no cuentan y el balance es solo de campo', () => {
    // Campo: 2..9 suma 44 → mejor partición 22/22, diff 0.
    const players = buildPlayers([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const result = buildBalancedTeams({
      players,
      fixedGoalkeepers: ['player-1', 'player-10'],
    });

    expect(result.diff).toBe(0);
    expect(result.teams[0].score).toBe(22);
    expect(result.teams[1].score).toBe(22);
  });

  test('dos arqueros con puntajes muy distintos: igual separados y diff de campo', () => {
    // Arqueros 10 y 1 (muy dispares). Campo: 5, 5, 3, 3 → 8/8, diff 0.
    const players = buildPlayers([10, 1, 5, 5, 3, 3]);
    const result = buildBalancedTeams({
      players,
      fixedGoalkeepers: ['player-1', 'player-2'],
    });

    const teamOfGkOne = findTeamOf(result, 'player-1');
    const teamOfGkTwo = findTeamOf(result, 'player-2');
    expect(teamOfGkOne.id).not.toBe(teamOfGkTwo.id);
    expect(result.diff).toBe(0);
    expect(result.teams[0].score).toBe(8);
    expect(result.teams[1].score).toBe(8);
  });

  test('dos arqueros respetan un bloqueo previo de equipo', () => {
    const players = buildPlayers([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const result = buildBalancedTeams({
      players,
      fixedGoalkeepers: ['player-1', 'player-10'],
      lockedAssignments: { 'player-1': 'equipoB' },
    });

    expect(findTeamOf(result, 'player-1').id).toBe('equipoB');
    expect(findTeamOf(result, 'player-10').id).toBe('equipoA');
  });

  test('arqueros suplentes no cuentan para activar la regla', () => {
    const players = [
      ...buildPlayers([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
      {
        id: 99,
        uuid: 'substitute-1',
        nombre: 'Suplente 1',
        score: 10,
        is_substitute: true,
      },
    ];
    const baseline = buildBalancedTeams({ players });
    const result = buildBalancedTeams({
      players,
      fixedGoalkeepers: ['player-1', 'substitute-1'],
    });

    expect(result).toEqual(baseline);
  });
});
