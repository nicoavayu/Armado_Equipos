import {
  buildBalancedTeams,
  splitMatchPlayersForVotingAndTeams,
} from '../utils/teamBalancer';

const buildPlayers = ({ starters = 10, substitutes = 0 } = {}) => ([
  ...Array.from({ length: starters }, (_, index) => ({
    id: index + 1,
    uuid: `starter-${index + 1}`,
    nombre: `Titular ${index + 1}`,
    score: index + 1,
    is_substitute: false,
  })),
  ...Array.from({ length: substitutes }, (_, index) => ({
    id: starters + index + 1,
    uuid: `substitute-${index + 1}`,
    nombre: `Suplente ${index + 1}`,
    score: 10,
    is_substitute: true,
  })),
]);

describe('splitMatchPlayersForVotingAndTeams', () => {
  test('keeps substitutes votable but out of team formation', () => {
    const groups = splitMatchPlayersForVotingAndTeams(buildPlayers({ starters: 10, substitutes: 1 }));

    expect(groups.allPlayers).toHaveLength(11);
    expect(groups.votablePlayers).toHaveLength(11);
    expect(groups.voters).toHaveLength(10);
    expect(groups.activePlayers).toHaveLength(10);
    expect(groups.teamPlayers).toHaveLength(10);
    expect(groups.substitutePlayers).toHaveLength(1);
    expect(groups.droppedPlayers).toHaveLength(0);
  });

  test('validates team parity with active players, not total players', () => {
    const { teamPlayers } = splitMatchPlayersForVotingAndTeams(buildPlayers({ starters: 10, substitutes: 1 }));
    const result = buildBalancedTeams({ players: teamPlayers });

    expect(result.teams[0].players).toHaveLength(5);
    expect(result.teams[1].players).toHaveLength(5);
    expect(result.teams.flatMap((team) => team.players)).not.toContain('substitute-1');
  });

  test('team balancer ignores substitute rows even if passed directly', () => {
    const result = buildBalancedTeams({ players: buildPlayers({ starters: 10, substitutes: 1 }) });

    expect(result.teams[0].players).toHaveLength(5);
    expect(result.teams[1].players).toHaveLength(5);
    expect(result.teams.flatMap((team) => team.players)).not.toContain('substitute-1');
  });

  test('does not treat a substitute as active when starters are still incomplete', () => {
    const { teamPlayers } = splitMatchPlayersForVotingAndTeams(buildPlayers({ starters: 9, substitutes: 1 }));

    expect(teamPlayers).toHaveLength(9);
    expect(() => buildBalancedTeams({ players: teamPlayers }))
      .toThrow('Se necesita un número par de jugadores para formar equipos.');
  });
});
