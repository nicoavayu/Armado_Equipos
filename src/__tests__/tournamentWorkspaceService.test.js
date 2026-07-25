import { supabase } from '../services/api/supabase';
import {
  checkTournamentOrganizationSlugAvailability,
  createTournamentOrganization,
  listTournamentOrganizationMembers,
  loadTournamentWorkspaceContext,
  setTournamentWorkspacePreference,
  TournamentWorkspaceError,
} from '../features/torneos/api/tournamentWorkspaceService';

jest.mock('../services/api/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
    from: jest.fn(),
  },
}));

describe('tournamentWorkspaceService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('loads the server-authoritative context through the scoped RPC', async () => {
    const payload = {
      preference: { workspaceType: 'personal', activeOrganizationId: null },
      organizations: [],
    };
    supabase.rpc.mockResolvedValue({ data: payload, error: null });

    await expect(loadTournamentWorkspaceContext()).resolves.toEqual(payload);
    expect(supabase.rpc).toHaveBeenCalledWith('get_tournament_workspace_context');
  });

  test('never accepts a client user id when creating an organization', async () => {
    supabase.rpc.mockResolvedValue({ data: { organization: { id: 'org' } }, error: null });

    await createTournamentOrganization({
      name: 'Liga Devoto',
      slug: 'liga-devoto',
      idempotencyKey: 'request-key',
      userId: 'forged-user',
    });

    expect(supabase.rpc).toHaveBeenCalledWith(
      'create_tournament_organization',
      {
        p_name: 'Liga Devoto',
        p_slug: 'liga-devoto',
        p_idempotency_key: 'request-key',
      },
    );
  });

  test('maps database tokens to safe user messages', async () => {
    supabase.rpc.mockResolvedValue({
      data: null,
      error: { message: 'TORNEOS_WORKSPACE_FORBIDDEN', code: '42501' },
    });

    await expect(
      setTournamentWorkspacePreference(
        'tournament_organization',
        'foreign-organization',
      ),
    ).rejects.toEqual(expect.objectContaining({
      name: 'TournamentWorkspaceError',
      code: 'TORNEOS_WORKSPACE_FORBIDDEN',
      message: 'Ya no tenés acceso a ese espacio.',
    }));
  });

  test('checks slug availability without fetching organization data', async () => {
    supabase.rpc.mockResolvedValue({ data: true, error: null });

    await expect(
      checkTournamentOrganizationSlugAvailability('liga-nueva'),
    ).resolves.toBe(true);
    expect(supabase.rpc).toHaveBeenCalledWith(
      'is_tournament_organization_slug_available',
      { p_slug: 'liga-nueva' },
    );
  });

  test('returns a typed generic error without exposing backend details', async () => {
    supabase.rpc.mockResolvedValue({
      data: null,
      error: { message: 'relation internal_secret does not exist' },
    });

    await expect(loadTournamentWorkspaceContext()).rejects.toBeInstanceOf(
      TournamentWorkspaceError,
    );
    await expect(loadTournamentWorkspaceContext()).rejects.not.toThrow(
      /internal_secret/,
    );
  });

  test('selects only the allowlisted membership fields', async () => {
    const order = jest.fn().mockResolvedValue({ data: [], error: null });
    const eq = jest.fn(() => ({ order }));
    const select = jest.fn(() => ({ eq }));
    supabase.from.mockReturnValue({ select });

    await expect(listTournamentOrganizationMembers('org-a')).resolves.toEqual([]);
    expect(supabase.from).toHaveBeenCalledWith('tournament_organization_members');
    expect(select).toHaveBeenCalledWith(
      'id,user_id,role,status,joined_at,created_at',
    );
    expect(eq).toHaveBeenCalledWith('organization_id', 'org-a');
  });
});
