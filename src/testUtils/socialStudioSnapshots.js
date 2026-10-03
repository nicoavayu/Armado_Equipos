// Product-valid Estudio Social snapshots (what get_tournament_social_snapshot answers, schema V2) for the 11 pieces.
// Shared by the page tests and the offline browser harness (scripts/qa/social-studio). Deliberately WITHOUT crests,
// tournament logo or photos: every piece must render with the Multimedia pipeline off.
export const SOCIAL_QA_ORGANIZATION_ID = '10000000-0000-4000-8000-000000000001';
export const SOCIAL_QA_GENERATED_AT = '2026-08-23T12:00:00.000Z';

const TEAM_NAMES = Object.freeze([
  'Deportivo Horizonte', 'Atlético del Sur', 'Biblioteca Popular Central', 'Social y Deportivo Constitución',
  'Club Unión de los Trabajadores del Sur', 'Racing del Oeste', 'Defensores de Villa Constitución del Norte',
  'Juventud Unida', 'Sportivo Barracas', 'Estrella de Boedo', 'Ferro Oeste', 'Almagro Norte',
  'Independiente del Parque', 'Talleres Metropolitano', 'Argentinos del Centro', 'San Telmo Sur',
  'Villa Crespo Juniors', 'Liniers FC', 'Palermo Chico', 'Floresta Unida', 'Caballito Central',
  'Boca del Riachuelo', 'Saavedra Athletic', 'Nuñez del Río',
]);
const PLAYER_NAMES = Object.freeze([
  'Valentina Ferreyra', 'Martín Quiroga', 'Lucía Benítez', 'Santiago Roldán', 'Camila Álvarez', 'Tomás Sosa',
  'Julieta Núñez', 'Facundo Giménez', 'Agustina Pereyra', 'Mateo Cabrera', 'Renata Fernández', 'Bruno Ledesma',
  'Sofía Aguirre', 'Ignacio Paz',
]);

export function socialQaTeam(index) {
  const name = TEAM_NAMES[index % TEAM_NAMES.length];
  return {
    participantId: `team-${index + 1}`,
    teamEntryId: `entry-${index + 1}`,
    name,
    shortName: name.split(' ').slice(-1)[0].slice(0, 12),
    shieldPath: null,
  };
}

function player(index) {
  const team = socialQaTeam(index % 6);
  return {
    rosterPlayerId: `player-${index + 1}`,
    teamEntryId: team.teamEntryId,
    name: PLAYER_NAMES[index % PLAYER_NAMES.length],
    position: index === 0 ? 'ARQ' : index < 5 ? 'DEF' : index < 9 ? 'MED' : 'DEL',
    isGoalkeeper: index === 0,
    team,
    portraitRef: null,
    goals: Math.max(0, 9 - index),
    ownGoals: 0,
    assists: Math.max(0, 6 - Math.floor(index / 2)),
    appearances: 9,
    starts: 8,
    substituteAppearances: 1,
    yellowCards: index % 3,
    secondYellows: 0,
    redCards: 0,
    captaincies: 0,
  };
}

function match(id, home, away, homeScore, awayScore, scheduledAt) {
  return {
    id,
    matchNumber: Number(id.replace(/\D/g, '')) || 1,
    scheduledAt,
    timezone: 'America/Argentina/Buenos_Aires',
    venueName: 'Estadio Parque Metropolitano',
    home: socialQaTeam(home),
    away: socialQaTeam(away),
    result: homeScore == null ? null : { homeScore, awayScore, homePenalties: null, awayPenalties: null },
  };
}

const PLAYED = [
  match('m-1', 0, 1, 3, 1, '2026-08-22T18:30:00.000Z'),
  match('m-2', 2, 3, 2, 2, '2026-08-22T20:30:00.000Z'),
  match('m-3', 1, 2, 0, 1, '2026-08-23T09:30:00.000Z'),
  match('m-4', 3, 0, 1, 4, '2026-08-23T10:30:00.000Z'),
];
const NEXT = [
  match('n-1', 0, 2, null, null, '2026-08-29T18:30:00.000Z'),
  match('n-2', 1, 3, null, null, '2026-08-29T20:30:00.000Z'),
  match('n-3', 4, 5, null, null, '2026-08-30T18:30:00.000Z'),
];

export function socialQaStandings(count) {
  return Array.from({ length: count }, (_unused, index) => ({
    ...socialQaTeam(index),
    teamName: socialQaTeam(index).name,
    position: index + 1,
    played: 15,
    won: Math.max(0, 13 - index),
    drawn: index % 4,
    lost: Math.min(9, index),
    goalsFor: 38 - index,
    goalsAgainst: 12 + index,
    goalDifference: 26 - index * 2,
    points: 60 - index * 2,
  }));
}

function snapshot(piece, official, { organizationId, tournamentId, categoryId, phaseId, roundId }) {
  return {
    schemaVersion: 2,
    piece,
    generatedAt: SOCIAL_QA_GENERATED_AT,
    source: {
      organizationId,
      tournamentId,
      categoryId,
      phaseId,
      groupId: null,
      roundId,
      fixtureVersionId: 'fixture-version-1',
      standingsRevisionId: 'revision-9',
      standingsRevisionNumber: '9',
    },
    competition: {
      organizationName: 'Liga Devoto',
      tournamentName: 'Copa Horizonte 2026',
      categoryName: 'Primera División',
      phaseName: 'Fase regular',
      roundName: 'Fecha 9',
      roundNumber: 9,
      timezone: 'America/Argentina/Buenos_Aires',
    },
    official,
    capabilities: ['social.read', 'social.create', 'social.export'],
  };
}

/**
 * The official payload of each piece. `teamSize` drives the Equipo ideal (5, 6, 7, 8, 9 or 11), `standingsRows` the
 * table (Editorial paginates above 15).
 */
export function socialQaSnapshot(piece, {
  organizationId = SOCIAL_QA_ORGANIZATION_ID,
  tournamentId = '30000000-0000-4000-8000-000000000001',
  categoryId = '40000000-0000-4000-8000-000000000001',
  phaseId = '50000000-0000-4000-8000-000000000001',
  roundId = '60000000-0000-4000-8000-000000000001',
  teamSize = 5,
  standingsRows = 8,
} = {}) {
  const scope = { organizationId, tournamentId, categoryId, phaseId, roundId };
  const players = Array.from({ length: 14 }, (_unused, index) => player(index));
  const official = {
    round_results: { matches: PLAYED },
    next_fixture: { semantics: 'next_scheduled_unplayed_round', matches: NEXT },
    standings: { revision: { id: 'revision-9', number: 9 }, rows: socialQaStandings(standingsRows) },
    scorers: { revisionId: 'revision-9', players: players.slice(0, 8) },
    discipline: {
      revisionId: 'revision-9',
      players: players.slice(2, 7).map((entry, index) => ({
        ...entry,
        yellowCards: 4 - Math.min(index, 3),
        directReds: index === 0 ? 1 : 0,
        fairPlayPoints: 7 - index,
        suspensions: index < 2 ? [{ remainingMatches: 2 - index }] : [],
      })),
    },
    best_eleven: {
      requiresHumanSelection: true,
      sportModality: `football_${teamSize}`,
      teamSize,
      candidates: players,
    },
    mvp: { requiresHumanSelection: true, candidates: players },
    round_summary: {
      matches: PLAYED,
      leaders: players.slice(0, 3),
      topOfTable: { position: 1, teamName: socialQaTeam(0).name, points: 60 },
    },
    semifinals: { matches: PLAYED.slice(0, 2) },
    final: { matches: PLAYED.slice(0, 1) },
    champion: {
      requiresHumanSelection: true,
      officialChampion: { ...socialQaTeam(0), teamName: socialQaTeam(0).name },
      candidates: [{ ...socialQaTeam(0), teamName: socialQaTeam(0).name, points: 60 }],
    },
  }[piece];
  if (!official) throw new Error(`Unknown QA piece ${piece}`);
  return snapshot(piece, official, scope);
}

/** The human selection a curated piece needs before it renders (first N candidates). */
export function socialQaSelection(snapshotValue) {
  const official = snapshotValue.official;
  if (snapshotValue.piece === 'best_eleven') return official.candidates.slice(0, official.teamSize).map((c) => c.rosterPlayerId);
  if (snapshotValue.piece === 'mvp') return [official.candidates[0].rosterPlayerId];
  if (snapshotValue.piece === 'champion') return [official.candidates[0].participantId];
  return [];
}
