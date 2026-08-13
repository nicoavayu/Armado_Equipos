import { tournamentWorkspaceService } from './tournamentWorkspaceService';

const EMPTY_PAGE = Object.freeze({
  items: [],
  pagination: { limit: 50, offset: 0, total: 0, hasMore: false },
});

// Local visual-review adapter only. It deliberately supplies no invented user,
// organization, tournament or match data. Real LOCAL/staging sessions continue
// to use tournamentWorkspaceService and all authoritative permission gates.
export const localReviewWorkspaceService = Object.freeze({
  ...tournamentWorkspaceService,
  loadContext: async () => ({
    organizations: [],
    preference: { workspaceType: 'personal', activeOrganizationId: null },
  }),
  setPreference: async () => ({
    workspaceType: 'personal',
    activeOrganizationId: null,
  }),
  loadExperienceRelations: async () => EMPTY_PAGE,
  loadMyTournaments: async () => EMPTY_PAGE,
  loadPlayerMatches: async () => EMPTY_PAGE,
  loadCommunicationsInbox: async () => EMPTY_PAGE,
});

