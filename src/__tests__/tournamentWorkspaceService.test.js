import { supabase } from '../services/api/supabase';
import {
  checkTournamentOrganizationSlugAvailability,
  createTournamentOrganization,
  listTournamentOrganizationMembers,
  loadTournamentPurchase,
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

  test('purchase projection must match the organization and tournament in the route', async () => {
    supabase.rpc.mockResolvedValue({
      data: {
        id: 'purchase-a',
        organizationId: 'organization-a',
        tournamentId: 'tournament-a',
      },
      error: null,
    });

    await expect(loadTournamentPurchase({
      purchaseId: 'purchase-a',
      organizationId: 'organization-a',
      tournamentId: 'tournament-b',
    })).rejects.toEqual(expect.objectContaining({
      code: 'TORNEOS_PURCHASE_FORBIDDEN',
    }));
    expect(supabase.rpc).toHaveBeenCalledWith('get_tournament_purchase', {
      p_purchase_id: 'purchase-a',
    });
  });

  test('purchase projection is returned only for the exact route scope', async () => {
    const purchase = {
      id: 'purchase-a',
      organizationId: 'organization-a',
      tournamentId: 'tournament-a',
    };
    supabase.rpc.mockResolvedValue({ data: purchase, error: null });

    await expect(loadTournamentPurchase({
      purchaseId: 'purchase-a',
      organizationId: 'organization-a',
      tournamentId: 'tournament-a',
    })).resolves.toBe(purchase);
  });

  // Las reglas de negocio de los flujos core del ciclo de vida dejaron de
  // viajar como `55000`/HTTP 500. Lo que importa acá es lo que ve el
  // organizador: una explicación en lenguaje de producto, nunca el código.
  describe('reglas de negocio de los flujos core', () => {
    const CASES = [
      ['TORNEOS_STANDINGS_DRAFT_EXISTS', /borrador/i],
      ['TORNEOS_STANDINGS_STALE', /recalcul/i],
      ['TORNEOS_STANDINGS_NOT_PUBLISHABLE', /publicarse/i],
      ['TORNEOS_MATCH_OPERATION_ACTIVE', /acta activa/i],
      ['TORNEOS_MATCH_NOT_OPENABLE', /condiciones para abrir el acta/i],
      ['TORNEOS_MATCH_ALREADY_OFFICIAL', /resultado oficial/i],
    ];

    const failWith = (code) => {
      supabase.rpc.mockResolvedValue({
        data: null,
        error: { code: '22023', message: code, details: null, hint: null },
      });
      return loadTournamentWorkspaceContext().catch((error) => error);
    };

    test.each(CASES)('%s se traduce a una explicación accionable', async (code, matcher) => {
      const failure = await failWith(code);
      expect(failure).toBeInstanceOf(TournamentWorkspaceError);
      expect(failure.code).toBe(code);
      expect(failure.message).toMatch(matcher);
    });

    test.each(CASES)('%s no filtra nada técnico a la pantalla', async (code) => {
      const { message } = await failWith(code);
      expect(message).not.toMatch(/TORNEOS_/);
      expect(message).not.toMatch(/55000|22023|SQLSTATE/i);
      expect(message).not.toMatch(/rpc|postgrest|supabase/i);
      expect(message).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    });
  });
});
