// Table routes of the certified gateway contract that staging v1 reads directly
// (`GET /torneos/rest/v1/<table>`, RLS with the bridge bearer). Phase 2D exposes no
// membership RPC, so the collaborators screen lists members from the table exactly
// as R5 exercised it. Nothing else; writes never go through table routes.
const tables = {
  tournament_organization_members: Object.freeze({
    columns: Object.freeze(['id', 'user_id', 'role', 'status', 'joined_at', 'created_at']),
    feature: 'collaborators',
  }),
};

export const stagingV1Tables = Object.freeze(Object.fromEntries(
  Object.entries(tables).map(([name, definition]) => [name, Object.freeze(definition)]),
));
export const isStagingV1Table = (name) => typeof name === 'string'
  && Object.prototype.hasOwnProperty.call(stagingV1Tables, name);
