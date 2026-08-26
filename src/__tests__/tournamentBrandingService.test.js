import { supabase } from '../services/api/supabase';
import {
  removeTournamentBrandingAsset,
  uploadTournamentBrandingAsset,
} from '../features/torneos/api/tournamentBrandingService';
import { prepareBrandingFile } from '../features/torneos/domain/brandingAssets';

const mockUpload = jest.fn();
const mockRemove = jest.fn();

jest.mock('../services/api/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
    storage: { from: jest.fn(() => ({ upload: mockUpload, remove: mockRemove })) },
  },
}));

jest.mock('../features/torneos/domain/brandingAssets', () => ({
  ...jest.requireActual('../features/torneos/domain/brandingAssets'),
  prepareBrandingFile: jest.fn(),
}));

const organizationId = '11111111-1111-4111-8111-111111111111';
const tournamentId = '22222222-2222-4222-8222-222222222222';
const previousPath = `${organizationId}/tournaments/${tournamentId}/33333333-3333-4333-8333-333333333333.png`;

describe('tournament branding write service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    supabase.storage.from.mockReturnValue({ upload: mockUpload, remove: mockRemove });
    prepareBrandingFile.mockResolvedValue({
      source: new Blob(['png']),
      mime: 'image/png',
      width: 900,
      height: 620,
    });
    mockUpload.mockResolvedValue({ data: {}, error: null });
    mockRemove.mockImplementation(async ([path]) => ({ data: [{ name: path }], error: null }));
  });

  test('uploads an immutable version, persists the durable path, then removes the old object', async () => {
    supabase.rpc.mockResolvedValue({
      data: { previousPath, path: 'server-value' },
      error: null,
    });

    const result = await uploadTournamentBrandingAsset({
      organizationId,
      kind: 'tournament',
      entityId: tournamentId,
      file: { name: 'logo.png' },
    });

    const uploadedPath = mockUpload.mock.calls[0][0];
    expect(uploadedPath).toMatch(new RegExp(`^${organizationId}/tournaments/${tournamentId}/`));
    expect(mockUpload).toHaveBeenCalledWith(uploadedPath, expect.any(Blob), {
      cacheControl: '31536000',
      contentType: 'image/png',
      upsert: false,
    });
    expect(supabase.rpc).toHaveBeenCalledWith('set_tournament_branding_reference', {
      p_organization_id: organizationId,
      p_entity_kind: 'tournament',
      p_entity_id: tournamentId,
      p_path: uploadedPath,
    });
    expect(mockRemove).toHaveBeenCalledWith([previousPath]);
    expect(result).toEqual(expect.objectContaining({
      path: uploadedPath,
      width: 900,
      height: 620,
    }));
  });

  test('rolls back the newly uploaded object when the reference RPC is denied', async () => {
    supabase.rpc.mockResolvedValue({
      data: null,
      error: { message: 'TORNEOS_BRANDING_FORBIDDEN' },
    });

    await expect(uploadTournamentBrandingAsset({
      organizationId,
      kind: 'tournament',
      entityId: tournamentId,
      file: { name: 'logo.png' },
    })).rejects.toThrow('No tenés permiso');

    expect(mockRemove).toHaveBeenCalledWith([mockUpload.mock.calls[0][0]]);
  });

  test('clears the reference before deleting its immutable object', async () => {
    supabase.rpc.mockResolvedValue({
      data: { previousPath, path: null },
      error: null,
    });
    await expect(removeTournamentBrandingAsset({
      organizationId,
      kind: 'tournament',
      entityId: tournamentId,
    })).resolves.toEqual({ previousPath, path: null });
    expect(supabase.rpc).toHaveBeenCalledWith('set_tournament_branding_reference', {
      p_organization_id: organizationId,
      p_entity_kind: 'tournament',
      p_entity_id: tournamentId,
      p_path: null,
    });
    expect(mockRemove).toHaveBeenCalledWith([previousPath]);
  });

  test('does not report a successful removal when Storage hides the object behind RLS', async () => {
    supabase.rpc.mockResolvedValue({
      data: { previousPath, path: null },
      error: null,
    });
    mockRemove.mockResolvedValue({ data: [], error: null });

    await expect(removeTournamentBrandingAsset({
      organizationId,
      kind: 'tournament',
      entityId: tournamentId,
    })).rejects.toThrow('TORNEOS_BRANDING_OBJECT_NOT_REMOVED');
  });
});
