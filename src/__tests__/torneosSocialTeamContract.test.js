import fs from 'fs';
import path from 'path';
import {
  assertNoPrivateData,
  createEditorialState,
  describeCurationGap,
  findSocialPiece,
  selectionSizeForSnapshot,
  validateSocialSelection,
  validateSocialSnapshot,
} from '../features/torneos/social/socialContracts';
import { adaptSnapshotToCuratedContent } from '../features/torneos/social/curatedContent';

const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';
const GENERATED_AT = '2026-08-23T12:00:00.000Z';
const migration = fs.readFileSync(path.join(
  process.cwd(),
  'supabase/migrations/20260823120000_tournament_social_team_contract.sql',
), 'utf8');

function candidate(index, overrides = {}) {
  const teamEntryId = overrides.teamEntryId || `team-${index % 2}`;
  return {
    rosterPlayerId: `player-${index}`,
    teamEntryId,
    name: `Jugador ${index}`,
    position: index === 0 ? 'ARQ' : 'DEF',
    isGoalkeeper: index === 0,
    team: {
      teamEntryId,
      name: `Equipo ${index % 2}`,
      shortName: `EQ${index % 2}`,
      shieldPath: index % 2 ? null : `qa/shields/team-${index % 2}.svg`,
    },
    portraitRef: null,
    goals: index,
    ownGoals: 0,
    assists: 2,
    appearances: 4,
    starts: 3,
    substituteAppearances: 1,
    yellowCards: 1,
    secondYellows: 0,
    redCards: 0,
    captaincies: 0,
    ...overrides,
  };
}

function snapshot(piece, official, competition = {}) {
  return {
    schemaVersion: 2,
    piece,
    generatedAt: GENERATED_AT,
    source: {
      organizationId: ORGANIZATION_ID,
      tournamentId: 'tournament-1',
      categoryId: 'category-1',
      phaseId: 'phase-1',
      groupId: null,
      roundId: 'round-1',
      fixtureVersionId: 'fixture-1',
      standingsRevisionId: 'revision-1',
    },
    competition: {
      tournamentName: 'Copa Base',
      categoryName: 'Primera',
      phaseName: 'Liga',
      roundName: 'Fecha 4',
      ...competition,
    },
    official,
    capabilities: ['social.read', 'social.create'],
  };
}

function teamOfRound(teamSize, sportModality = `football_${teamSize}`) {
  return snapshot('best_eleven', {
    requiresHumanSelection: true,
    sportModality,
    teamSize,
    candidates: Array.from({ length: 14 }, (_value, index) => candidate(index)),
  });
}

describe('Equipo de la fecha V2 contract', () => {
  test.each([
    ['football_5', 5],
    ['football_8', 8],
    ['football_11', 11],
  ])('%s accepts exactly its effective team size', (sportModality, teamSize) => {
    const value = teamOfRound(teamSize, sportModality);
    const selection = value.official.candidates.slice(0, teamSize)
      .map((entry) => entry.rosterPlayerId);
    expect(selectionSizeForSnapshot(value)).toBe(teamSize);
    expect(validateSocialSelection(value, { selection })).toMatchObject({ valid: true });
    expect(() => validateSocialSnapshot(value, { organizationId: ORGANIZATION_ID }))
      .not.toThrow();
  });

  test('football_5 rejects four and six selections', () => {
    const value = teamOfRound(5);
    const ids = value.official.candidates.map((entry) => entry.rosterPlayerId);
    expect(validateSocialSelection(value, { selection: ids.slice(0, 4) }))
      .toMatchObject({ valid: false, code: 'SELECTION_COUNT_INVALID', needed: 5, chosen: 4 });
    expect(validateSocialSelection(value, { selection: ids.slice(0, 6) }))
      .toMatchObject({ valid: false, code: 'SELECTION_COUNT_INVALID', needed: 5, chosen: 6 });
    expect(describeCurationGap(value, { selection: ids.slice(0, 6) })).toMatch(/6\/5/);
  });

  test('rejects duplicated and out-of-scope candidate ids', () => {
    const value = teamOfRound(5);
    const ids = value.official.candidates.map((entry) => entry.rosterPlayerId);
    expect(validateSocialSelection(value, { selection: [...ids.slice(0, 4), ids[0]] }))
      .toMatchObject({ valid: false, code: 'SELECTION_DUPLICATED' });
    expect(validateSocialSelection(value, { selection: [...ids.slice(0, 4), 'not-a-candidate'] }))
      .toMatchObject({ valid: false, code: 'SELECTION_CANDIDATE_INVALID' });
  });

  test('normalizes canonical roster and frozen team identity without fabricating media', () => {
    const value = teamOfRound(5);
    const editorial = createEditorialState(value, {
      selection: value.official.candidates.slice(0, 5).map((entry) => entry.rosterPlayerId),
    });
    const content = adaptSnapshotToCuratedContent(value, editorial);
    expect(content).toMatchObject({
      kind: 'teamOfRound', sportModality: 'football_5', teamSize: 5,
    });
    expect(content.candidates[0]).toMatchObject({
      rosterPlayerId: 'player-0', teamEntryId: 'team-0', position: 'ARQ',
      isGoalkeeper: true,
      team: { teamEntryId: 'team-0', name: 'Equipo 0', shortName: 'EQ0' },
      portraitRef: null,
    });
    expect(content.candidates[1].team.shieldPath).toBeNull();
    expect(() => assertNoPrivateData(value)).not.toThrow();
  });

  test('keeps historical V1 best_eleven readable with the eleven-player fallback', () => {
    const historical = { ...teamOfRound(11), schemaVersion: 1 };
    delete historical.official.sportModality;
    delete historical.official.teamSize;
    expect(selectionSizeForSnapshot(historical)).toBe(11);
    expect(() => validateSocialSnapshot(historical, { organizationId: ORGANIZATION_ID }))
      .not.toThrow();
  });

  test('keeps the compatibility key while using customer-facing wording', () => {
    expect(findSocialPiece('best_eleven')).toMatchObject({
      id: 'best_eleven', label: 'Equipo de la fecha',
    });
    expect(findSocialPiece('team_of_round')).toBeNull();
  });
});

describe('Figura V2 contract', () => {
  test('preserves official stats and adds scoped player/team identity', () => {
    const value = snapshot('mvp', {
      requiresHumanSelection: true,
      candidates: [candidate(3, { position: 'DEL', goals: 7, assists: 5, appearances: 6 })],
    });
    const content = adaptSnapshotToCuratedContent(value, { selection: ['player-3'] });
    expect(content).toMatchObject({
      kind: 'figure',
      selectedPlayer: {
        rosterPlayerId: 'player-3', position: 'DEL', portraitRef: null,
        stats: { goals: 7, assists: 5, appearances: 6 },
        team: { teamEntryId: 'team-1', name: 'Equipo 1' },
      },
    });
    expect(() => validateSocialSnapshot(value, { organizationId: ORGANIZATION_ID }))
      .not.toThrow();
    expect(() => assertNoPrivateData(value)).not.toThrow();
  });
});

describe('Próxima fecha V2 contract', () => {
  test('accepts only the explicit future, unplayed scheduling semantics', () => {
    const value = snapshot('next_fixture', {
      semantics: 'next_scheduled_unplayed_round',
      matches: [{
        id: 'match-1', scheduledAt: '2026-08-24T12:00:00.000Z',
        timezone: 'America/Argentina/Buenos_Aires', result: null,
      }],
    });
    expect(() => validateSocialSnapshot(value, { organizationId: ORGANIZATION_ID }))
      .not.toThrow();
  });

  test('does not allow a past or already played match to be called Próxima fecha', () => {
    const past = snapshot('next_fixture', {
      semantics: 'next_scheduled_unplayed_round',
      matches: [{ id: 'match-1', scheduledAt: '2026-08-22T12:00:00.000Z', result: null }],
    });
    const played = snapshot('next_fixture', {
      semantics: 'next_scheduled_unplayed_round',
      matches: [{
        id: 'match-1', scheduledAt: '2026-08-24T12:00:00.000Z',
        result: { homeScore: 1, awayScore: 0 },
      }],
    });
    expect(() => validateSocialSnapshot(past)).toThrow(/SNAPSHOT_FIXTURE_NOT_UPCOMING/);
    expect(() => validateSocialSnapshot(played)).toThrow(/SNAPSHOT_FIXTURE_NOT_UPCOMING/);
  });
});

describe('Social snapshot SQL V2 projection', () => {
  test('category format overrides tournament format via canonical fallback', () => {
    expect(migration).toMatch(
      /coalesce\(category\.sport_modality, tournament\.sport_modality\)[\s\S]*coalesce\(category\.team_size, tournament\.team_size\)/,
    );
  });

  test('projects position, goalkeeper and frozen participant team identity', () => {
    expect(migration).toMatch(/'position', player\.primary_position/);
    expect(migration).toMatch(/'isGoalkeeper', player\.is_goalkeeper/);
    expect(migration).toMatch(/participant\.participant_set_id = fixture\.participant_set_id/);
    expect(migration).toMatch(/'shieldPath', participant\.snapshot_shield_path/);
  });

  test('keeps portrait optional and does not expose private storage details', () => {
    expect(migration).toMatch(/'portraitRef', null/);
    const candidateFunction = migration.match(
      /CREATE OR REPLACE FUNCTION public\.tournament_social_player_candidates[\s\S]+?\$\$;/,
    )?.[0] || '';
    expect(candidateFunction).not.toMatch(/object_path|bucket|avatar_url|internal_path/);
  });

  test('selects scheduled future matches without an official operation', () => {
    expect(migration).toMatch(/match_row\.status IN \('scheduled', 'ready'\)/);
    expect(migration).toMatch(/match_row\.scheduled_at >= now\(\)/);
    expect(migration).toMatch(/operation\.status = 'official'/);
    expect(migration).toMatch(/'timezone', venue\.timezone/);
  });

  test('does not introduce formations, coordinates or playoff bracket data', () => {
    expect(migration).not.toMatch(/formation|coordinate|tactical|bracket|advancement/i);
  });
});
