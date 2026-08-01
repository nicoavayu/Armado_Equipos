import { createHash } from 'node:crypto';

const UUID_NAMESPACE = 'arma2-torneos-qa-foundation-v1';

export function stableUuid(label) {
  const hex = createHash('sha256')
    .update(`${UUID_NAMESPACE}:${label}`)
    .digest('hex')
    .slice(0, 32)
    .split('');
  hex[12] = '5';
  hex[16] = ['8', '9', 'a', 'b'][Number.parseInt(hex[16], 16) % 4];
  const value = hex.join('');
  return [
    value.slice(0, 8),
    value.slice(8, 12),
    value.slice(12, 16),
    value.slice(16, 20),
    value.slice(20),
  ].join('-');
}

const teamDefinitions = [
  ['Barrio Norte FC', 'BNO', '/qa/shields/barrio-norte.svg'],
  ['Club Atlético Horizonte', 'HOR', '/qa/shields/horizonte.svg'],
  ['Deportivo La Ribera', 'RIB', '/qa/shields/la-ribera.svg'],
  ['Los Pibes del Parque Central y Biblioteca Popular', 'PPC', null],
  ['Estrella del Sur', 'EDS', '/qa/shields/estrella-sur.svg'],
  ['Ferroviarios Unidos', 'FER', '/qa/shields/ferroviarios.svg'],
  ['Social y Deportivo Constitución', 'SDC', null],
  ['Villa Real 1912', 'VIL', '/qa/shields/villa-real.svg'],
];

const givenNames = [
  'Alejandro', 'Bruno', 'Cristian', 'Diego', 'Emiliano',
  'Facundo', 'Gabriel', 'Hernán', 'Ignacio', 'Joaquín',
];
const surnames = [
  'Fernández', 'Giménez', 'Rodríguez', 'Sosa', 'Martínez',
  'Pereyra', 'Quiroga', 'Benítez', 'Acosta', 'Domínguez',
];

function buildTeam([name, shortName, shieldPath], teamIndex) {
  const id = stableUuid(`team:${shortName}`);
  const roster = Array.from({ length: 10 }, (_, playerIndex) => {
    const givenName = givenNames[(teamIndex + playerIndex) % givenNames.length];
    const surname = surnames[(teamIndex * 2 + playerIndex) % surnames.length];
    const longName = teamIndex === 3 && playerIndex === 9
      ? 'Maximiliano de los Santos Fernández Rodríguez'
      : `${givenName} ${surname}`;
    return {
      id: stableUuid(`player:${shortName}:${playerIndex + 1}`),
      teamId: id,
      displayName: longName,
      shirtNumber: playerIndex + 1,
      position: playerIndex === 0 ? 'goalkeeper' : 'field',
      source: playerIndex < 7 ? 'arma2_profile' : 'provisional',
      avatarUrl: playerIndex % 4 === 0 ? null : `/qa/avatars/${shortName.toLowerCase()}-${playerIndex + 1}.png`,
      eligibility: playerIndex === 9 && teamIndex === 6 ? 'pending_review' : 'eligible',
    };
  });
  return {
    id,
    name,
    shortName,
    shieldPath,
    status: 'approved',
    roster,
  };
}

function roundRobin(teamIds) {
  const rotating = [...teamIds];
  const rounds = [];
  for (let roundIndex = 0; roundIndex < teamIds.length - 1; roundIndex += 1) {
    const matches = [];
    for (let pairIndex = 0; pairIndex < teamIds.length / 2; pairIndex += 1) {
      const homeTeamId = rotating[pairIndex];
      const awayTeamId = rotating[rotating.length - 1 - pairIndex];
      matches.push({
        id: stableUuid(`round:${roundIndex + 1}:match:${pairIndex + 1}`),
        stage: 'league',
        round: roundIndex + 1,
        order: pairIndex + 1,
        homeTeamId,
        awayTeamId,
        state: 'official',
        outcome: 'played',
        homeScore: (roundIndex + pairIndex + 1) % 5,
        awayScore: (roundIndex * 2 + pairIndex) % 4,
        homePenalties: null,
        awayPenalties: null,
      });
    }
    rounds.push({
      id: stableUuid(`round:${roundIndex + 1}`),
      number: roundIndex + 1,
      label: `Fecha ${roundIndex + 1}`,
      matches,
    });
    rotating.splice(1, 0, rotating.pop());
  }
  return rounds;
}

function applyEdgeCases(rounds) {
  Object.assign(rounds[0].matches[0], {
    homeScore: 3,
    awayScore: 1,
  });
  Object.assign(rounds[0].matches[1], {
    homeScore: 2,
    awayScore: 2,
    outcome: 'draw',
  });
  Object.assign(rounds[0].matches[2], {
    homeScore: 3,
    awayScore: 0,
    state: 'official',
    outcome: 'walkover',
    walkoverWinner: 'home',
  });
  Object.assign(rounds[0].matches[3], {
    homeScore: 1,
    awayScore: 1,
    state: 'suspended',
    outcome: 'suspended',
    suspendedMinute: 63,
  });
  Object.assign(rounds[1].matches[0], {
    homeScore: null,
    awayScore: null,
    state: 'postponed',
    outcome: 'postponed',
  });
  Object.assign(rounds[1].matches[1], {
    homeScore: 1,
    awayScore: 0,
    state: 'under_review',
    outcome: 'played',
  });
}

function matchEvents(teams, rounds) {
  const target = rounds[0].matches[0];
  const home = teams.find((team) => team.id === target.homeTeamId);
  const away = teams.find((team) => team.id === target.awayTeamId);
  return [
    {
      id: stableUuid('event:goal:1'),
      matchId: target.id,
      type: 'goal',
      minute: 8,
      playerId: home.roster[1].id,
      assistPlayerId: home.roster[2].id,
    },
    {
      id: stableUuid('event:yellow:1'),
      matchId: target.id,
      type: 'yellow_card',
      minute: 27,
      playerId: away.roster[4].id,
      assistPlayerId: null,
    },
    {
      id: stableUuid('event:goal:2'),
      matchId: target.id,
      type: 'goal',
      minute: 34,
      playerId: away.roster[3].id,
      assistPlayerId: away.roster[5].id,
    },
    {
      id: stableUuid('event:red:1'),
      matchId: target.id,
      type: 'red_card',
      minute: 58,
      playerId: away.roster[4].id,
      assistPlayerId: null,
    },
    {
      id: stableUuid('event:goal:3'),
      matchId: target.id,
      type: 'goal',
      minute: 69,
      playerId: home.roster[1].id,
      assistPlayerId: home.roster[6].id,
    },
    {
      id: stableUuid('event:goal:4'),
      matchId: target.id,
      type: 'goal',
      minute: 78,
      playerId: home.roster[7].id,
      assistPlayerId: null,
    },
  ];
}

export function buildTorneosDemoDataset() {
  const organizationId = stableUuid('organization:qa');
  const teams = teamDefinitions.map(buildTeam);
  const rounds = roundRobin(teams.map((team) => team.id));
  applyEdgeCases(rounds);

  const semifinals = [
    {
      id: stableUuid('semifinal:1'),
      stage: 'semifinal',
      order: 1,
      homeTeamId: teams[0].id,
      awayTeamId: teams[3].id,
      state: 'official',
      outcome: 'penalties',
      homeScore: 2,
      awayScore: 2,
      homePenalties: 5,
      awayPenalties: 4,
    },
    {
      id: stableUuid('semifinal:2'),
      stage: 'semifinal',
      order: 2,
      homeTeamId: teams[1].id,
      awayTeamId: teams[2].id,
      state: 'official',
      outcome: 'played',
      homeScore: 1,
      awayScore: 0,
      homePenalties: null,
      awayPenalties: null,
    },
  ];
  const final = {
    id: stableUuid('final:1'),
    stage: 'final',
    order: 1,
    homeTeamId: teams[0].id,
    awayTeamId: teams[1].id,
    state: 'official',
    outcome: 'played',
    homeScore: 3,
    awayScore: 2,
    homePenalties: null,
    awayPenalties: null,
  };
  const events = matchEvents(teams, rounds);

  return {
    version: 1,
    seedKey: 'torneos-demo-v1',
    organization: {
      id: organizationId,
      name: 'Asociación Metropolitana de Fútbol Amateur del Río de la Plata',
      slug: 'qa-metropolitana',
      logoPath: null,
    },
    tournaments: [
      {
        id: stableUuid('tournament:active'),
        organizationId,
        name: 'Torneo Apertura QA 2026',
        status: 'in_progress',
        isPrimaryDataset: true,
      },
      {
        id: stableUuid('tournament:draft'),
        organizationId,
        name: 'Copa Relámpago en Preparación',
        status: 'draft',
        isPrimaryDataset: false,
      },
      {
        id: stableUuid('tournament:completed'),
        organizationId,
        name: 'Torneo de Verano Finalizado',
        status: 'completed',
        isPrimaryDataset: false,
      },
      {
        id: stableUuid('tournament:archived'),
        organizationId,
        name: 'Clausura Histórico Archivado',
        status: 'archived',
        isPrimaryDataset: false,
      },
    ],
    teams,
    rounds,
    playoffs: {
      semifinals,
      final,
    },
    events,
    sanctions: [
      {
        id: stableUuid('sanction:red-card'),
        playerId: teams[1].roster[4].id,
        reason: 'direct_red_card',
        matches: 2,
        served: 0,
        status: 'active',
      },
      {
        id: stableUuid('sanction:accumulated-yellow'),
        playerId: teams[4].roster[2].id,
        reason: 'yellow_card_accumulation',
        matches: 1,
        served: 1,
        status: 'served',
      },
    ],
    manualIdealTeam: {
      id: stableUuid('manual-ideal-team:round-1'),
      round: 1,
      selectionMode: 'manual',
      selectedByRole: 'owner',
      playerIds: teams.slice(0, 7).map((team, index) => team.roster[index + 1].id),
      published: false,
    },
  };
}

export function buildIdempotentSeedPlan(dataset = buildTorneosDemoDataset()) {
  const primaryTournament = dataset.tournaments.find((item) => item.isPrimaryDataset);
  const matches = [
    ...dataset.rounds.flatMap((round) => round.matches),
    ...dataset.playoffs.semifinals,
    dataset.playoffs.final,
  ];
  return [
    {
      entity: 'organization',
      conflictTarget: 'id',
      records: [dataset.organization],
    },
    {
      entity: 'tournament',
      conflictTarget: 'id',
      records: dataset.tournaments,
    },
    {
      entity: 'team',
      conflictTarget: 'id',
      records: dataset.teams.map(({ roster, ...team }) => ({
        ...team,
        tournamentId: primaryTournament.id,
      })),
    },
    {
      entity: 'player',
      conflictTarget: 'id',
      records: dataset.teams.flatMap((team) => team.roster),
    },
    {
      entity: 'round',
      conflictTarget: 'id',
      records: dataset.rounds.map(({ matches: omitted, ...round }) => ({
        ...round,
        tournamentId: primaryTournament.id,
      })),
    },
    {
      entity: 'match',
      conflictTarget: 'id',
      records: matches.map((match) => ({
        ...match,
        tournamentId: primaryTournament.id,
      })),
    },
    {
      entity: 'match_event',
      conflictTarget: 'id',
      records: dataset.events,
    },
    {
      entity: 'sanction',
      conflictTarget: 'id',
      records: dataset.sanctions,
    },
    {
      entity: 'manual_ideal_team',
      conflictTarget: 'id',
      records: [dataset.manualIdealTeam],
    },
  ];
}
