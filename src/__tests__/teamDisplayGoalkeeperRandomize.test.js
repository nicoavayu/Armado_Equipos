import {
  buildBalancedTeams,
  resolveFixedGoalkeepers,
  shouldExcludeGoalkeeperScores,
} from '../utils/teamBalancer';

// Simula el camino de Randomizar de TeamDisplay: resuelve los arqueros fijos
// a partir de is_goalkeeper y se los pasa a buildBalancedTeams.
const buildPlayers = (scores, goalkeeperKeys = []) => scores.map((score, index) => ({
  key: `player-${index + 1}`,
  score,
  is_goalkeeper: goalkeeperKeys.includes(`player-${index + 1}`),
}));

const randomizeLike = (players, lockedAssignments = {}) => buildBalancedTeams({
  players,
  lockedAssignments,
  fixedGoalkeepers: resolveFixedGoalkeepers({
    playerKeys: players.map((player) => player.key),
    isGoalkeeper: (key) => Boolean(players.find((player) => player.key === key)?.is_goalkeeper),
    lockedAssignments,
  }),
  getPlayerKey: (player) => player?.key,
  getPlayerScore: (player) => player?.score,
  preferRandomTies: true,
});

const findTeamOf = (result, playerKey) => (
  result.teams.find((team) => team.players.includes(playerKey))
);

describe('Randomizar con arqueros fijos (TeamDisplay)', () => {
  test('con 2 arqueros quedan separados uno por equipo', () => {
    const players = buildPlayers([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], ['player-1', 'player-10']);

    for (let run = 0; run < 10; run += 1) {
      const result = randomizeLike(players);
      const teamOfGkOne = findTeamOf(result, 'player-1');
      const teamOfGkTwo = findTeamOf(result, 'player-10');
      expect(teamOfGkOne.id).not.toBe(teamOfGkTwo.id);
      expect(result.teams[0].players).toHaveLength(5);
      expect(result.teams[1].players).toHaveLength(5);
    }
  });

  test('con 2 arqueros la diferencia excluye sus puntajes', () => {
    // Campo perfectamente balanceable (5 puntos por jugador); arqueros con
    // puntajes muy distintos que romperían la paridad si contaran.
    const players = buildPlayers([5, 5, 5, 5, 5, 5, 1, 10], ['player-7', 'player-8']);
    const result = randomizeLike(players);

    // Solo cuentan los 6 jugadores de campo (30 puntos): 15 por lado, diff 0.
    expect(result.teams[0].score).toBe(15);
    expect(result.teams[1].score).toBe(15);
    expect(result.diff).toBe(0);
  });

  test('con 0 o 1 arquero el resultado es idéntico al comportamiento actual', () => {
    const noGoalkeepers = buildPlayers([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const oneGoalkeeper = buildPlayers([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], ['player-10']);

    [noGoalkeepers, oneGoalkeeper].forEach((players) => {
      expect(resolveFixedGoalkeepers({
        playerKeys: players.map((player) => player.key),
        isGoalkeeper: (key) => Boolean(players.find((player) => player.key === key)?.is_goalkeeper),
      })).toEqual([]);

      const baseline = buildBalancedTeams({
        players,
        getPlayerKey: (player) => player?.key,
        getPlayerScore: (player) => player?.score,
      });
      const withResolvedGoalkeepers = buildBalancedTeams({
        players,
        fixedGoalkeepers: [],
        getPlayerKey: (player) => player?.key,
        getPlayerScore: (player) => player?.score,
      });
      expect(withResolvedGoalkeepers).toEqual(baseline);
      // Todos los puntajes siguen contando en la paridad.
      expect(baseline.teams[0].score + baseline.teams[1].score).toBe(55);
    });
  });

  test('si el admin bloqueó a los 2 arqueros en el mismo equipo, gana el lock y se randomiza normal', () => {
    const players = buildPlayers([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], ['player-1', 'player-2']);
    const lockedAssignments = { 'player-1': 'equipoA', 'player-2': 'equipoA' };

    expect(resolveFixedGoalkeepers({
      playerKeys: players.map((player) => player.key),
      isGoalkeeper: (key) => Boolean(players.find((player) => player.key === key)?.is_goalkeeper),
      lockedAssignments,
    })).toEqual([]);

    const result = randomizeLike(players, lockedAssignments);
    expect(findTeamOf(result, 'player-1').id).toBe('equipoA');
    expect(findTeamOf(result, 'player-2').id).toBe('equipoA');
    // Sin regla de arqueros, todos los puntajes cuentan.
    expect(result.teams[0].score + result.teams[1].score).toBe(55);
  });

  test('con un solo arquero bloqueado, la regla sigue activa y respeta ese lock', () => {
    const players = buildPlayers([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], ['player-1', 'player-2']);
    const lockedAssignments = { 'player-1': 'equipoB' };

    const result = randomizeLike(players, lockedAssignments);
    expect(findTeamOf(result, 'player-1').id).toBe('equipoB');
    expect(findTeamOf(result, 'player-2').id).toBe('equipoA');
    // Los arqueros no cuentan: quedan 3+4+...+10 = 52 entre los dos equipos.
    expect(result.teams[0].score + result.teams[1].score).toBe(52);
  });
});

describe('shouldExcludeGoalkeeperScores (diferencia visual tras movimientos manuales)', () => {
  const isGoalkeeper = (key) => key.startsWith('gk');

  test('un arquero por equipo: se excluyen del cálculo', () => {
    expect(shouldExcludeGoalkeeperScores({
      teamAKeys: ['gk-1', 'p-1', 'p-2'],
      teamBKeys: ['gk-2', 'p-3', 'p-4'],
      isGoalkeeper,
    })).toBe(true);
  });

  test('los dos arqueros en el mismo equipo: cálculo normal', () => {
    expect(shouldExcludeGoalkeeperScores({
      teamAKeys: ['gk-1', 'gk-2', 'p-1'],
      teamBKeys: ['p-2', 'p-3', 'p-4'],
      isGoalkeeper,
    })).toBe(false);
  });

  test('con 0 o 1 arquero: cálculo normal', () => {
    expect(shouldExcludeGoalkeeperScores({
      teamAKeys: ['p-1', 'p-2'],
      teamBKeys: ['p-3', 'p-4'],
      isGoalkeeper,
    })).toBe(false);
    expect(shouldExcludeGoalkeeperScores({
      teamAKeys: ['gk-1', 'p-1'],
      teamBKeys: ['p-2', 'p-3'],
      isGoalkeeper,
    })).toBe(false);
  });
});
