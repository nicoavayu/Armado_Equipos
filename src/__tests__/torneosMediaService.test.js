import { supabase } from '../services/api/supabase';
import {
  createTournamentMediaGallery,
  loadPublishedTournamentMedia,
  loadTournamentMediaAdminContext,
  reportTournamentMediaAsset,
  requestTournamentMediaUploadSession,
  transitionTournamentMediaAsset,
} from '../features/torneos/api/tournamentWorkspaceService';

jest.mock('../services/api/supabase', () => ({
  supabase: { rpc: jest.fn(), from: jest.fn() },
}));

describe('tournament media service contracts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    supabase.rpc.mockResolvedValue({ data: { ok: true }, error: null });
  });

  test('loads bounded admin metadata without requesting internal storage fields', async () => {
    await loadTournamentMediaAdminContext({
      organizationId: 'org-a',
      tournamentId: 'tournament-a',
      status: 'published',
      limit: 30,
      offset: 60,
    });
    expect(supabase.rpc).toHaveBeenCalledWith('get_tournament_media_admin_context', {
      p_organization_id: 'org-a',
      p_tournament_id: 'tournament-a',
      p_status: 'published',
      p_limit: 30,
      p_offset: 60,
    });
  });

  test('creates a scoped gallery without trusting actor or storage path', async () => {
    await createTournamentMediaGallery({
      organizationId: 'org-a',
      tournamentId: 'tournament-a',
      categoryId: 'category-a',
      roundId: 'round-a',
      matchId: 'match-a',
      title: 'Fecha 1',
      description: 'Galería',
      visibility: 'match_participants',
      idempotencyKey: 'key-a',
      actorUserId: 'forged-user',
      bucket: 'avatars',
      path: 'chosen/by/client.jpg',
    });
    expect(supabase.rpc).toHaveBeenCalledWith('create_tournament_media_gallery', {
      p_organization_id: 'org-a',
      p_tournament_id: 'tournament-a',
      p_category_id: 'category-a',
      p_round_id: 'round-a',
      p_match_id: 'match-a',
      p_title: 'Fecha 1',
      p_description: 'Galería',
      p_visibility: 'match_participants',
      p_idempotency_key: 'key-a',
    });
  });

  test('requests an intent from file metadata but never accepts a client path', async () => {
    await requestTournamentMediaUploadSession({
      galleryId: 'gallery-a',
      fileName: 'foto.jpg',
      mime: 'image/jpeg',
      byteSize: 4096,
      idempotencyKey: 'key-a',
      path: 'forged/path.jpg',
      upsert: true,
    });
    expect(supabase.rpc).toHaveBeenCalledWith('request_tournament_media_upload_session', {
      p_gallery_id: 'gallery-a',
      p_file_name: 'foto.jpg',
      p_declared_mime: 'image/jpeg',
      p_byte_size: 4096,
      p_idempotency_key: 'key-a',
    });
  });

  test('moderates and reports by opaque resource ID only', async () => {
    await transitionTournamentMediaAsset({
      assetId: 'asset-a',
      action: 'hide',
      reason: 'Privacidad',
      actor: 'forged-user',
    });
    await reportTournamentMediaAsset({
      assetId: 'asset-a',
      reason: 'privacy',
      detail: 'Detalle',
      requestHide: true,
      idempotencyKey: 'key-a',
      reporterUserId: 'forged-user',
    });
    expect(supabase.rpc).toHaveBeenNthCalledWith(1, 'transition_tournament_media_asset', {
      p_asset_id: 'asset-a',
      p_action: 'hide',
      p_reason: 'Privacidad',
    });
    expect(supabase.rpc).toHaveBeenNthCalledWith(2, 'report_tournament_media_asset', {
      p_asset_id: 'asset-a',
      p_reason: 'privacy',
      p_detail: 'Detalle',
      p_request_hide: true,
      p_idempotency_key: 'key-a',
    });
  });

  test('participant query is paginated and relation-scoped', async () => {
    await loadPublishedTournamentMedia({
      tournamentId: 'tournament-a',
      categoryId: 'category-a',
      matchId: 'match-a',
      limit: 20,
      offset: 40,
      userId: 'forged-user',
    });
    expect(supabase.rpc).toHaveBeenCalledWith('get_published_tournament_media', {
      p_tournament_id: 'tournament-a',
      p_category_id: 'category-a',
      p_match_id: 'match-a',
      p_limit: 20,
      p_offset: 40,
    });
  });
});
