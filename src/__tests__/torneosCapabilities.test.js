import {
  getCapabilitiesForRole,
  hasCapability,
  TOURNAMENT_CAPABILITIES,
  TOURNAMENT_ROLES,
} from '../features/torneos/domain/capabilities';

const COMPETITION_CAPABILITIES = [
  'seasons.read',
  'seasons.create',
  'seasons.update',
  'seasons.archive',
  'tournaments.read',
  'tournaments.create',
  'tournaments.update',
  'tournaments.change_status',
  'tournaments.archive',
  'categories.read',
  'categories.create',
  'categories.update',
  'categories.archive',
  'competition_rules.read',
  'competition_rules.update',
];

describe('Torneos role capabilities', () => {
  test.each([
    [TOURNAMENT_ROLES.OWNER, TOURNAMENT_CAPABILITIES.ORGANIZATION_ARCHIVE, true],
    [TOURNAMENT_ROLES.OWNER, TOURNAMENT_CAPABILITIES.MEMBERS_UPDATE_ROLE, true],
    [TOURNAMENT_ROLES.ADMIN, TOURNAMENT_CAPABILITIES.ORGANIZATION_UPDATE, true],
    [TOURNAMENT_ROLES.ADMIN, TOURNAMENT_CAPABILITIES.ORGANIZATION_ARCHIVE, false],
    [TOURNAMENT_ROLES.ADMIN, TOURNAMENT_CAPABILITIES.TOURNAMENTS_ARCHIVE, true],
    [TOURNAMENT_ROLES.OWNER, TOURNAMENT_CAPABILITIES.COMPETITION_RULES_UPDATE, true],
    [TOURNAMENT_ROLES.COLLABORATOR, TOURNAMENT_CAPABILITIES.MEMBERS_READ, true],
    [TOURNAMENT_ROLES.COLLABORATOR, TOURNAMENT_CAPABILITIES.TOURNAMENTS_READ, true],
    [TOURNAMENT_ROLES.COLLABORATOR, TOURNAMENT_CAPABILITIES.CATEGORIES_READ, true],
    [TOURNAMENT_ROLES.COLLABORATOR, TOURNAMENT_CAPABILITIES.TOURNAMENTS_CREATE, false],
    [TOURNAMENT_ROLES.COLLABORATOR, TOURNAMENT_CAPABILITIES.COMPETITION_RULES_UPDATE, false],
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

  test.each([
    [TOURNAMENT_ROLES.OWNER, COMPETITION_CAPABILITIES],
    [TOURNAMENT_ROLES.ADMIN, COMPETITION_CAPABILITIES],
    [TOURNAMENT_ROLES.COLLABORATOR, [
      'seasons.read',
      'tournaments.read',
      'categories.read',
      'competition_rules.read',
    ]],
  ])('keeps the exact competition capability contract for %s', (role, expected) => {
    const actual = getCapabilitiesForRole(role)
      .filter((capability) => COMPETITION_CAPABILITIES.includes(capability))
      .sort();
    expect(actual).toEqual([...expected].sort());
  });
});
