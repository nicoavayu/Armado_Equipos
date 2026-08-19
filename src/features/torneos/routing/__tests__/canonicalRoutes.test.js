import {
  CANONICAL_TOURNAMENT_ROUTE_PATTERN,
  CATEGORY_QUERY_PARAM,
  canonicalRoutes,
  categoryQuery,
  organizationVenue,
  organizationVenues,
  readCategoryId,
  tournamentFixture,
  tournamentFixtureRound,
  tournamentFixtureVersion,
  tournamentMatch,
  tournamentMatchReport,
  tournamentMatches,
  tournamentRoot,
  tournamentSchedule,
  tournamentTable,
} from '../canonicalRoutes';

const ORG = '51000000-0000-4000-8000-000000000001';
const TOURNAMENT = '53000000-0000-4000-8000-000000000001';
const CATEGORY = '54000000-0000-4000-8000-000000000001';
const MATCH = '55000000-0000-4000-8000-000000000001';

describe('canonical torneos route builders', () => {
  test('builds the approved canonical shape', () => {
    expect(tournamentRoot(ORG, TOURNAMENT))
      .toBe(`/torneos/organizacion/${ORG}/torneo/${TOURNAMENT}`);
    expect(tournamentFixture(ORG, TOURNAMENT))
      .toBe(`/torneos/organizacion/${ORG}/torneo/${TOURNAMENT}/fixture`);
    expect(tournamentSchedule(ORG, TOURNAMENT))
      .toBe(`/torneos/organizacion/${ORG}/torneo/${TOURNAMENT}/programacion`);
    expect(tournamentMatches(ORG, TOURNAMENT))
      .toBe(`/torneos/organizacion/${ORG}/torneo/${TOURNAMENT}/partidos`);
    expect(tournamentTable(ORG, TOURNAMENT))
      .toBe(`/torneos/organizacion/${ORG}/torneo/${TOURNAMENT}/competencia/tabla`);
  });

  test('keeps ?categoria= on every surface that accepts it', () => {
    expect(tournamentFixture(ORG, TOURNAMENT, { categoryId: CATEGORY }))
      .toBe(`/torneos/organizacion/${ORG}/torneo/${TOURNAMENT}/fixture?${CATEGORY_QUERY_PARAM}=${CATEGORY}`);
    expect(tournamentMatchReport(ORG, TOURNAMENT, MATCH, { categoryId: CATEGORY }))
      .toBe(`/torneos/organizacion/${ORG}/torneo/${TOURNAMENT}/partidos/${MATCH}/acta?${CATEGORY_QUERY_PARAM}=${CATEGORY}`);
    expect(tournamentTable(ORG, TOURNAMENT, { categoryId: CATEGORY }))
      .toContain(`?${CATEGORY_QUERY_PARAM}=${CATEGORY}`);
  });

  test('omits the query when no category is supplied', () => {
    expect(tournamentFixture(ORG, TOURNAMENT)).not.toContain('?');
    expect(tournamentFixture(ORG, TOURNAMENT, {})).not.toContain('?');
    expect(tournamentFixture(ORG, TOURNAMENT, { categoryId: null })).not.toContain('?');
    expect(tournamentFixture(ORG, TOURNAMENT, { categoryId: '   ' })).not.toContain('?');
  });

  test('resource builders nest the resource under its tournament', () => {
    expect(tournamentMatch(ORG, TOURNAMENT, MATCH))
      .toBe(`/torneos/organizacion/${ORG}/torneo/${TOURNAMENT}/partidos/${MATCH}`);
    expect(tournamentFixtureRound(ORG, TOURNAMENT, 'round-7'))
      .toBe(`/torneos/organizacion/${ORG}/torneo/${TOURNAMENT}/fixture/jornadas/round-7`);
    expect(tournamentFixtureVersion(ORG, TOURNAMENT, 'version-2'))
      .toBe(`/torneos/organizacion/${ORG}/torneo/${TOURNAMENT}/fixture/version/version-2`);
  });

  test('sedes stay organization-scoped, outside the tournament nesting', () => {
    expect(organizationVenues(ORG)).toBe(`/torneos/organizacion/${ORG}/sedes`);
    expect(organizationVenue(ORG, 'venue-1')).toBe(`/torneos/organizacion/${ORG}/sedes/venue-1`);
    expect(organizationVenues(ORG)).not.toContain('/torneo/');
  });

  test('team entry routes stay outside the tournament nesting', () => {
    expect(canonicalRoutes.organizationTeamEntryRoster(ORG, 'entry-1'))
      .toBe(`/torneos/organizacion/${ORG}/equipos/entry-1/plantel`);
    expect(canonicalRoutes.organizationTeamEntryRoster(ORG, 'entry-1'))
      .not.toContain('/torneo/');
  });

  test('fails closed on ids that could escape their segment', () => {
    expect(() => tournamentFixture(ORG, '')).toThrow(/tournamentId/);
    expect(() => tournamentFixture(ORG, null)).toThrow(/tournamentId/);
    expect(() => tournamentFixture('', TOURNAMENT)).toThrow(/organizationId/);
    expect(() => tournamentFixture(ORG, '../otro')).toThrow(/inválido/);
    expect(() => tournamentFixture(ORG, 'a/b')).toThrow(/inválido/);
    expect(() => tournamentFixture(ORG, 'a?b=c')).toThrow(/inválido/);
    expect(() => tournamentFixture(ORG, 'a#b')).toThrow(/inválido/);
    expect(() => tournamentMatch(ORG, TOURNAMENT, 'x/y')).toThrow(/inválido/);
  });

  test('never lets a malformed category id reach the query string', () => {
    expect(categoryQuery('a/b')).toBe('');
    expect(categoryQuery('a&b=c')).toBe('');
    expect(categoryQuery(undefined)).toBe('');
    expect(categoryQuery(CATEGORY)).toBe(`?${CATEGORY_QUERY_PARAM}=${CATEGORY}`);
  });

  test('reads ?categoria= back from a search string or URLSearchParams', () => {
    expect(readCategoryId(`?${CATEGORY_QUERY_PARAM}=${CATEGORY}`)).toBe(CATEGORY);
    expect(readCategoryId(`${CATEGORY_QUERY_PARAM}=${CATEGORY}`)).toBe(CATEGORY);
    expect(readCategoryId(new URLSearchParams({ [CATEGORY_QUERY_PARAM]: CATEGORY })))
      .toBe(CATEGORY);
    expect(readCategoryId('?otra=cosa')).toBeNull();
    expect(readCategoryId('')).toBeNull();
    expect(readCategoryId(`?${CATEGORY_QUERY_PARAM}=`)).toBeNull();
    expect(readCategoryId(`?${CATEGORY_QUERY_PARAM}=a/b`)).toBeNull();
  });

  test('round-trips every tournament builder through the canonical pattern', () => {
    const pattern = new RegExp(
      `^/torneos/organizacion/${ORG}/torneo/${TOURNAMENT}(?:[/?]|$)`,
    );
    const tournamentBuilders = [
      'tournamentRoot', 'tournamentConfiguration', 'tournamentFixture',
      'tournamentFixtureParticipants', 'tournamentFixturePots', 'tournamentFixtureDraw',
      'tournamentFixtureGroups', 'tournamentFixtureGenerate', 'tournamentFixtureRounds',
      'tournamentFixtureBracket', 'tournamentSchedule', 'tournamentMatches',
      'tournamentTable', 'tournamentStatistics', 'tournamentQualification',
      'tournamentDiscipline',
    ];
    tournamentBuilders.forEach((name) => {
      const path = canonicalRoutes[name](ORG, TOURNAMENT, { categoryId: CATEGORY });
      expect(path).toMatch(pattern);
      expect(readCategoryId(path.slice(path.indexOf('?')))).toBe(CATEGORY);
    });
  });

  test('exposes the route pattern the guard chain matches on', () => {
    expect(CANONICAL_TOURNAMENT_ROUTE_PATTERN)
      .toBe('/torneos/organizacion/:organizationId/torneo/:tournamentId/*');
  });
});
