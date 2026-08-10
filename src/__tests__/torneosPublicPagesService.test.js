import { supabase } from '../services/api/supabase';
import {
  loadPublicTournamentPage,
  resolvePublicTeamShieldUrl,
} from '../features/torneos/api/publicTournamentService';
import {
  loadTournamentPublicPageSettings,
  setTournamentPublicPagePublished,
} from '../features/torneos/api/tournamentWorkspaceService';

const mockGetPublicUrl = jest.fn();

jest.mock('../services/api/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
    from: jest.fn(),
    storage: {
      from: jest.fn(() => ({ getPublicUrl: mockGetPublicUrl })),
    },
  },
}));

describe('public tournament service contracts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    supabase.rpc.mockResolvedValue({ data: { tournament: { name: 'Apertura' } }, error: null });
    supabase.storage.from.mockReturnValue({ getPublicUrl: mockGetPublicUrl });
    mockGetPublicUrl.mockReturnValue({ data: { publicUrl: 'https://cdn.example/crest.png' } });
  });

  test('calls only the explicit anonymous projection with public slugs', async () => {
    await loadPublicTournamentPage({ publicSlug: 'liga-apertura-a1b2c3d4e5', categorySlug: 'primera' });
    expect(supabase.rpc).toHaveBeenCalledWith('get_public_tournament_page', {
      p_public_slug: 'liga-apertura-a1b2c3d4e5',
      p_category_slug: 'primera',
    });
  });

  test.each([
    ['', null],
    ['UPPERCASE', null],
    ['a/../../secret', null],
    ['liga-valida', 'bad/category'],
  ])('fails closed before the network for invalid slug %s', async (publicSlug, categorySlug) => {
    await expect(loadPublicTournamentPage({ publicSlug, categorySlug })).resolves.toBeNull();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  test('does not load arbitrary remote crest URLs', () => {
    expect(resolvePublicTeamShieldUrl('https://attacker.example/tracker.png')).toBeNull();
    expect(supabase.storage.from).not.toHaveBeenCalled();
  });

  test('resolves relative crests only through the known public bucket', () => {
    expect(resolvePublicTeamShieldUrl('org/team.png')).toBe('https://cdn.example/crest.png');
    expect(supabase.storage.from).toHaveBeenCalledWith('team-crests');
    expect(mockGetPublicUrl).toHaveBeenCalledWith('org/team.png');
  });

  test('uses separately scoped authenticated RPCs for settings and publication', async () => {
    await loadTournamentPublicPageSettings({ organizationId: 'org-a', tournamentId: 'tournament-a' });
    await setTournamentPublicPagePublished({ organizationId: 'org-a', tournamentId: 'tournament-a', published: true });
    expect(supabase.rpc).toHaveBeenNthCalledWith(1, 'get_tournament_public_page_settings', {
      p_organization_id: 'org-a',
      p_tournament_id: 'tournament-a',
    });
    expect(supabase.rpc).toHaveBeenNthCalledWith(2, 'set_tournament_public_page_published', {
      p_organization_id: 'org-a',
      p_tournament_id: 'tournament-a',
      p_published: true,
    });
  });
});
