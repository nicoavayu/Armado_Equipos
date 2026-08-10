const PARTICIPANT_RELATION_ROLES = new Set([
  'player',
  'captain',
  'delegate',
  'assistant',
  'team_manager',
]);

export function isTournamentParticipantRelation(relation) {
  if (!relation || !relation.teamEntryId) return false;
  return PARTICIPANT_RELATION_ROLES.has(String(relation.role || '').toLowerCase());
}

export function resolveTorneosUserExperience({
  organizations = [],
  tournamentRelations = [],
} = {}) {
  const administrativeOrganizations = Array.isArray(organizations)
    ? organizations.filter((organization) => (
      organization?.id
      && organization?.status === 'active'
      && organization?.membershipStatus !== 'inactive'
    ))
    : [];
  const participantRelations = Array.isArray(tournamentRelations)
    ? tournamentRelations.filter(isTournamentParticipantRelation)
    : [];

  return {
    administrativeOrganizations,
    participantRelations,
    hasAdministration: administrativeOrganizations.length > 0,
    hasParticipantActivity: participantRelations.length > 0,
    hasAnyRelationship: (
      administrativeOrganizations.length > 0
      || participantRelations.length > 0
    ),
  };
}
