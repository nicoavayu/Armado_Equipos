// Table routes of the certified gateway contract that the hybrid composition reads directly
// (`GET /torneos/rest/v1/<table>`, RLS with the bridge bearer). Phase 2D exposes no
// membership RPC, so the collaborators screen lists members from the table exactly
// as R5 exercised it; COMPETITION-V1 adds the organization's venues and courts, which
// have no read RPC either (RLS: venues.read / courts.read of the active membership).
// Nothing else; writes never go through table routes.
const tables = {
  tournament_organization_members: Object.freeze({
    columns: Object.freeze(['id', 'user_id', 'role', 'status', 'joined_at', 'created_at']),
    feature: 'collaborators',
  }),
  tournament_venues: Object.freeze({
    columns: Object.freeze(['id', 'name', 'address', 'place_id', 'latitude', 'longitude', 'locality', 'timezone', 'status', 'notes']),
    feature: 'fixtures',
  }),
  tournament_courts: Object.freeze({
    columns: Object.freeze(['id', 'venue_id', 'name', 'sport_modality', 'status', 'notes']),
    feature: 'fixtures',
  }),
};

export const stagingV1Tables = Object.freeze(Object.fromEntries(
  Object.entries(tables).map(([name, definition]) => [name, Object.freeze(definition)]),
));
export const isStagingV1Table = (name) => typeof name === 'string'
  && Object.prototype.hasOwnProperty.call(stagingV1Tables, name);
