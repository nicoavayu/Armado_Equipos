export const TOURNAMENT_ROLES = Object.freeze({
  OWNER: 'owner',
  ADMIN: 'admin',
  COLLABORATOR: 'collaborator',
});

export const TOURNAMENT_CAPABILITIES = Object.freeze({
  ORGANIZATION_READ: 'organization.read',
  ORGANIZATION_UPDATE: 'organization.update',
  ORGANIZATION_ARCHIVE: 'organization.archive',
  MEMBERS_READ: 'members.read',
  MEMBERS_INVITE: 'members.invite',
  MEMBERS_UPDATE_ROLE: 'members.update_role',
  MEMBERS_REMOVE: 'members.remove',
  WORKSPACE_ACCESS: 'workspace.access',
  WORKSPACE_MANAGE: 'workspace.manage',
});

const commonMemberCapabilities = [
  TOURNAMENT_CAPABILITIES.ORGANIZATION_READ,
  TOURNAMENT_CAPABILITIES.MEMBERS_READ,
  TOURNAMENT_CAPABILITIES.WORKSPACE_ACCESS,
];

export const ROLE_CAPABILITIES = Object.freeze({
  [TOURNAMENT_ROLES.OWNER]: Object.freeze([
    ...commonMemberCapabilities,
    TOURNAMENT_CAPABILITIES.ORGANIZATION_UPDATE,
    TOURNAMENT_CAPABILITIES.ORGANIZATION_ARCHIVE,
    TOURNAMENT_CAPABILITIES.MEMBERS_INVITE,
    TOURNAMENT_CAPABILITIES.MEMBERS_UPDATE_ROLE,
    TOURNAMENT_CAPABILITIES.MEMBERS_REMOVE,
    TOURNAMENT_CAPABILITIES.WORKSPACE_MANAGE,
  ]),
  [TOURNAMENT_ROLES.ADMIN]: Object.freeze([
    ...commonMemberCapabilities,
    TOURNAMENT_CAPABILITIES.ORGANIZATION_UPDATE,
    TOURNAMENT_CAPABILITIES.MEMBERS_INVITE,
    TOURNAMENT_CAPABILITIES.MEMBERS_UPDATE_ROLE,
    TOURNAMENT_CAPABILITIES.MEMBERS_REMOVE,
    TOURNAMENT_CAPABILITIES.WORKSPACE_MANAGE,
  ]),
  [TOURNAMENT_ROLES.COLLABORATOR]: Object.freeze([
    ...commonMemberCapabilities,
  ]),
});

export function getCapabilitiesForRole(role) {
  return ROLE_CAPABILITIES[role] || [];
}

export function hasCapability(subject, capability) {
  if (!capability) return false;
  const capabilities = Array.isArray(subject)
    ? subject
    : (subject?.capabilities || getCapabilitiesForRole(subject?.role || subject));
  return capabilities.includes(capability);
}

export function getRoleLabel(role) {
  const labels = {
    [TOURNAMENT_ROLES.OWNER]: 'Owner',
    [TOURNAMENT_ROLES.ADMIN]: 'Admin',
    [TOURNAMENT_ROLES.COLLABORATOR]: 'Colaborador',
  };
  return labels[role] || 'Sin rol';
}
