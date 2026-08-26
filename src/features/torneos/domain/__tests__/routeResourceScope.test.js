import {
  LEGACY_RESOLUTION,
  planLegacyResolution,
  readResourceTournamentId,
  resolveScopedResource,
  resourceBelongsToOrganization,
  resourceBelongsToTournament,
  resourceMatchesCanonicalScope,
} from '../routeResourceScope';

const ORG = 'e1000000-0000-4000-8000-000000000001';
const A = 'e2000000-0000-4000-8000-00000000000a';
const B = 'e2000000-0000-4000-8000-00000000000b';

describe('validación recurso ↔ torneo', () => {
  test('reads the tournament id in either casing the API uses', () => {
    expect(readResourceTournamentId({ tournament_id: A })).toBe(A);
    expect(readResourceTournamentId({ tournamentId: A })).toBe(A);
    expect(readResourceTournamentId({})).toBeNull();
    expect(readResourceTournamentId(null)).toBeNull();
  });

  test('a resource from another tournament never belongs', () => {
    expect(resourceBelongsToTournament({ tournament_id: A }, A)).toBe(true);
    expect(resourceBelongsToTournament({ tournament_id: B }, A)).toBe(false);
  });

  test('not being able to check is not the same as having checked', () => {
    expect(resourceBelongsToTournament({}, A)).toBe(false);
    expect(resourceBelongsToTournament(null, A)).toBe(false);
    expect(resourceBelongsToTournament({}, A, { strict: false })).toBe(true);
    expect(resourceBelongsToTournament({ tournament_id: B }, A, { strict: false })).toBe(false);
  });

  test('an empty tournament id can never validate anything', () => {
    expect(resourceBelongsToTournament({ tournament_id: A }, null)).toBe(false);
    expect(resourceBelongsToTournament({ tournament_id: A }, '')).toBe(false);
  });

  test('the canonical scope needs both ids of the URL to hold', () => {
    const operation = { tournament_id: A, organization_id: ORG };
    expect(resourceMatchesCanonicalScope(operation, { organizationId: ORG, tournamentId: A }))
      .toBe(true);
    expect(resourceMatchesCanonicalScope(operation, { organizationId: ORG, tournamentId: B }))
      .toBe(false);
    expect(resourceMatchesCanonicalScope(operation, { organizationId: 'otra', tournamentId: A }))
      .toBe(false);
  });

  test('organization membership tolerates a payload that omits it', () => {
    expect(resourceBelongsToOrganization({ tournament_id: A }, ORG, { strict: false })).toBe(true);
    expect(resourceBelongsToOrganization({ organization_id: 'otra' }, ORG, { strict: false }))
      .toBe(false);
  });

  test('distinguishes "not requested" from "requested and out of scope"', () => {
    const versions = [{ id: 'v1' }, { id: 'v2' }];
    expect(resolveScopedResource(versions, null))
      .toEqual({ found: false, resource: null, outOfScope: false });
    expect(resolveScopedResource(versions, 'v2'))
      .toEqual({ found: true, resource: { id: 'v2' }, outOfScope: false });
    expect(resolveScopedResource(versions, 'v9'))
      .toEqual({ found: false, resource: null, outOfScope: true });
    expect(resolveScopedResource(null, 'v1').outOfScope).toBe(true);
  });
});

describe('contrato del resolver legacy (preparado, todavía no cableado)', () => {
  test('a resource that names its tournament settles it outright', () => {
    expect(planLegacyResolution({
      resource: { tournament_id: B },
      tournaments: [{ id: A }, { id: B }],
      preferredTournamentId: A,
    })).toEqual({ kind: LEGACY_RESOLUTION.RESOURCE, tournamentId: B, hint: null });
  });

  test('one tournament in the organization needs no question', () => {
    expect(planLegacyResolution({ tournaments: [{ id: A }] }))
      .toEqual({ kind: LEGACY_RESOLUTION.SINGLE_TOURNAMENT, tournamentId: A, hint: null });
  });

  test('several tournaments go to a selector, with the preference only as a hint', () => {
    expect(planLegacyResolution({
      tournaments: [{ id: A }, { id: B }],
      preferredTournamentId: B,
    })).toEqual({ kind: LEGACY_RESOLUTION.SELECTOR, tournamentId: null, hint: B });
  });

  test('a stale preference does not become an answer, nor a bad hint', () => {
    expect(planLegacyResolution({
      tournaments: [{ id: A }, { id: B }],
      preferredTournamentId: 'e2000000-0000-4000-8000-0000000000ff',
    })).toEqual({ kind: LEGACY_RESOLUTION.SELECTOR, tournamentId: null, hint: null });
  });

  test('no tournaments at all still asks instead of inventing', () => {
    expect(planLegacyResolution({ tournaments: [] }).kind).toBe(LEGACY_RESOLUTION.SELECTOR);
    expect(planLegacyResolution({}).tournamentId).toBeNull();
  });
});
