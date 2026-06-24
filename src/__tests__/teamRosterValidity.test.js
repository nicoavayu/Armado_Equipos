import { buildBalancedTeams } from '../utils/teamBalancer';
import {
  analyzeTeamsAgainstRoster,
  findRosterPlayerByTeamReference,
} from '../utils/teamRosterValidity';

const originalRoster = [
  { id: 1, uuid: 'player-1', usuario_id: 'user-1', nombre: 'Ana' },
  { id: 2, uuid: 'player-2', usuario_id: 'user-2', nombre: 'Beto' },
  { id: 3, uuid: 'player-3', usuario_id: 'user-3', nombre: 'Cami' },
  { id: 4, uuid: 'player-4', usuario_id: 'user-4', nombre: 'Dani' },
];

const originalTeams = [
  { id: 'equipoA', name: 'Equipo A', players: ['player-1', 'player-3'], score: 10 },
  { id: 'equipoB', name: 'Equipo B', players: ['player-2', 'player-4'], score: 10 },
];

describe('team roster validity', () => {
  test('accepts formed teams that exactly match the current starter roster', () => {
    expect(analyzeTeamsAgainstRoster(originalTeams, originalRoster)).toMatchObject({
      hasTeamShape: true,
      isValid: true,
      isStale: false,
      missingTeamPlayerReferences: [],
      unassignedRosterPlayers: [],
    });
  });

  test('marks teams stale after removing a player instead of resolving an unknown player', () => {
    const rosterAfterRemoval = originalRoster.filter((player) => player.uuid !== 'player-2');
    const result = analyzeTeamsAgainstRoster(originalTeams, rosterAfterRemoval);

    expect(result.isStale).toBe(true);
    expect(result.missingTeamPlayerReferences).toEqual(['player-2']);
    expect(findRosterPlayerByTeamReference(rosterAfterRemoval, 'player-2')).toBeNull();
  });

  test('marks teams stale after adding a starter and preserves the new roster identity', () => {
    const newPlayer = {
      id: 5,
      uuid: 'player-5',
      usuario_id: 'user-5',
      nombre: 'Eva',
      avatar_url: 'https://example.com/eva.png',
    };
    const rosterAfterAddition = [...originalRoster, newPlayer];
    const result = analyzeTeamsAgainstRoster(originalTeams, rosterAfterAddition);

    expect(result.isStale).toBe(true);
    expect(result.unassignedRosterPlayers).toEqual([newPlayer]);
    expect(result.unassignedRosterPlayers[0]).toMatchObject({
      nombre: 'Eva',
      avatar_url: 'https://example.com/eva.png',
    });
  });

  test('marks replacement teams stale when one player leaves and another joins', () => {
    const replacement = { id: 5, uuid: 'player-5', usuario_id: 'user-5', nombre: 'Eva' };
    const replacedRoster = [
      ...originalRoster.filter((player) => player.uuid !== 'player-2'),
      replacement,
    ];
    const result = analyzeTeamsAgainstRoster(originalTeams, replacedRoster);

    expect(result.isValid).toBe(false);
    expect(result.missingTeamPlayerReferences).toEqual(['player-2']);
    expect(result.unassignedRosterPlayers).toEqual([replacement]);
  });

  test('accepts newly rebuilt teams from the current roster after reset', () => {
    const currentRoster = [
      ...originalRoster.filter((player) => player.uuid !== 'player-2'),
      { id: 5, uuid: 'player-5', usuario_id: 'user-5', nombre: 'Eva', score: 5 },
    ];
    const rebuilt = buildBalancedTeams({
      players: currentRoster,
      getPlayerKey: (player) => player.uuid,
      getPlayerScore: (player) => player.score,
      getPlayerName: (player) => player.nombre,
    }).teams;

    expect(analyzeTeamsAgainstRoster(rebuilt, currentRoster).isValid).toBe(true);
  });

  test('matches legacy team references by usuario_id and ignores substitutes', () => {
    const roster = [
      ...originalRoster,
      { id: 9, uuid: 'sub-9', usuario_id: 'sub-user-9', nombre: 'Suplente', is_substitute: true },
    ];
    const teamsByUserId = originalTeams.map((team) => ({
      ...team,
      players: team.players.map((uuid) => (
        originalRoster.find((player) => player.uuid === uuid)?.usuario_id
      )),
    }));

    expect(analyzeTeamsAgainstRoster(teamsByUserId, roster).isValid).toBe(true);
    expect(findRosterPlayerByTeamReference(roster, 'user-1')?.nombre).toBe('Ana');
  });
});
