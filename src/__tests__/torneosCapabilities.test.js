import {
  getCapabilitiesForRole,
  hasCapability,
  TOURNAMENT_CAPABILITIES,
  TOURNAMENT_ROLES,
} from '../features/torneos/domain/capabilities';

describe('Torneos role capabilities', () => {
  test.each([
    [TOURNAMENT_ROLES.OWNER, TOURNAMENT_CAPABILITIES.ORGANIZATION_ARCHIVE, true],
    [TOURNAMENT_ROLES.OWNER, TOURNAMENT_CAPABILITIES.MEMBERS_UPDATE_ROLE, true],
    [TOURNAMENT_ROLES.ADMIN, TOURNAMENT_CAPABILITIES.ORGANIZATION_UPDATE, true],
    [TOURNAMENT_ROLES.ADMIN, TOURNAMENT_CAPABILITIES.ORGANIZATION_ARCHIVE, false],
    [TOURNAMENT_ROLES.COLLABORATOR, TOURNAMENT_CAPABILITIES.MEMBERS_READ, true],
    [TOURNAMENT_ROLES.COLLABORATOR, TOURNAMENT_CAPABILITIES.MEMBERS_INVITE, false],
    [TOURNAMENT_ROLES.COLLABORATOR, TOURNAMENT_CAPABILITIES.ORGANIZATION_UPDATE, false],
  ])('%s / %s resolves to %s', (role, capability, expected) => {
    expect(hasCapability(role, capability)).toBe(expected);
  });

  test('fails closed for unknown roles, capabilities, and missing subjects', () => {
    expect(getCapabilitiesForRole('super-admin')).toEqual([]);
    expect(hasCapability('super-admin', 'organization.archive')).toBe(false);
    expect(hasCapability(null, 'workspace.access')).toBe(false);
    expect(hasCapability(TOURNAMENT_ROLES.OWNER, 'future.capability')).toBe(false);
  });

  test('uses server-provided capabilities without inferring extra privileges', () => {
    expect(hasCapability({
      role: 'owner',
      capabilities: ['organization.read'],
    }, 'organization.archive')).toBe(false);
  });
});
